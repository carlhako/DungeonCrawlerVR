/**
 * The shop, as a layout.
 *
 * `shopButtons` turns the current save into the list of things the player can press, where
 * each one sits on the panel, and what state it is in. Everything else — the canvas
 * rasteriser, the interactables, the haptics — is presentation over that list.
 *
 * Splitting it this way is what makes the shop testable at all. "Is the buy button offered
 * for a weapon you already own?", "does an unaffordable upgrade read as unaffordable rather
 * than as broken?", "can you equip a two-hander to your off hand?" are questions about a
 * data structure, and answering them in a headset is an appalling way to spend an evening.
 *
 * Coordinates are metres in the panel's own frame, origin at its centre, +x right and +y up.
 * The same rectangles are used to draw the panel and to place the interactables, so a button
 * cannot drift away from the thing it looks like.
 */

import { create } from 'zustand'
import {
  AXIS_LABEL,
  STARTER_WEAPON,
  WEAPONS,
  WEAPON_IDS,
  formatStat,
  upgradeTrack,
  weaponStats,
  type Hand,
  type UpgradeAxis,
  type WeaponId,
} from '@/data/weapons'
import { nextUpgradeCost, ownsWeapon, upgradeLevel, type SaveData } from '@/systems/save'
import { useGame } from '@/systems/game'

export const PANEL_WIDTH = 1.3
export const PANEL_HEIGHT = 0.9

export interface Rect {
  /** Centre, in panel-local metres. */
  cx: number
  cy: number
  w: number
  h: number
}

export type ShopAction =
  | { kind: 'select'; weapon: WeaponId }
  | { kind: 'buy'; weapon: WeaponId }
  | { kind: 'upgrade'; weapon: WeaponId; axis: UpgradeAxis }
  | { kind: 'equip'; weapon: WeaponId; hand: Hand }

export type ButtonState =
  /** Pressable. */
  | 'available'
  /** Pressable, but the player cannot afford it. Shown, not hidden — the price is the point. */
  | 'unaffordable'
  /** Already true: the selected weapon, an equipped hand. */
  | 'done'
  /** Not available at all: a maxed upgrade, a hand this weapon cannot be held in. */
  | 'locked'

export interface ShopButton {
  /** Stable across redraws, so the interaction focus doesn't flicker as the panel updates. */
  id: string
  action: ShopAction
  rect: Rect
  label: string
  /** Right-aligned secondary text: a price, or a stat change. */
  detail: string
  state: ButtonState
  /** What the interaction prompt says. */
  prompt: string
}

const HAND_LABEL: Record<Hand, string> = { main: 'Main hand', off: 'Off hand' }

/** Left column: one row per weapon in the catalogue. */
const LIST_X = -0.4
const LIST_W = 0.46
const LIST_H = 0.13
const LIST_TOP = 0.16

/** Right column: the selected weapon. */
const DETAIL_X = 0.19
const DETAIL_W = 0.62

export function shopButtons(save: SaveData, selected: WeaponId): ShopButton[] {
  const buttons: ShopButton[] = []

  WEAPON_IDS.forEach((id, index) => {
    const owned = ownsWeapon(save, id)
    buttons.push({
      id: `select-${id}`,
      action: { kind: 'select', weapon: id },
      rect: { cx: LIST_X, cy: LIST_TOP - index * (LIST_H + 0.025), w: LIST_W, h: LIST_H },
      label: WEAPONS[id].name,
      detail: owned ? 'Owned' : `${WEAPONS[id].price}g`,
      state: id === selected ? 'done' : 'available',
      prompt: `Inspect the ${WEAPONS[id].name}`,
    })
  })

  const definition = WEAPONS[selected]

  if (!ownsWeapon(save, selected)) {
    buttons.push({
      id: `buy-${selected}`,
      action: { kind: 'buy', weapon: selected },
      rect: { cx: DETAIL_X, cy: -0.06, w: DETAIL_W, h: 0.15 },
      label: `Buy ${definition.name}`,
      detail: `${definition.price}g`,
      state: save.gold >= definition.price ? 'available' : 'unaffordable',
      prompt: `Buy the ${definition.name}`,
    })
    return buttons
  }

  const levels = save.weapons[selected]?.upgrades ?? {}
  const current = weaponStats(selected, levels)

  definition.upgrades.forEach((track, index) => {
    const axis = track.axis
    const level = upgradeLevel(save, selected, axis)
    const cost = nextUpgradeCost(save, selected, axis)
    const maxed = cost === null
    // What the player would be buying, shown as "12 → 14". The comparison is the reason
    // anyone can tell one upgrade from another; a bare price tells you nothing.
    const after = weaponStats(selected, { ...levels, [axis]: level + 1 })

    buttons.push({
      id: `upgrade-${selected}-${axis}`,
      action: { kind: 'upgrade', weapon: selected, axis },
      rect: { cx: DETAIL_X, cy: 0.05 - index * 0.115, w: DETAIL_W, h: 0.1 },
      label: `${AXIS_LABEL[axis]} ${formatStat(axis, current)}${
        maxed ? '' : ` → ${formatStat(axis, after)}`
      }`,
      detail: maxed ? `Max ${track.maxLevel}` : `${cost}g`,
      state: maxed ? 'locked' : save.gold >= cost ? 'available' : 'unaffordable',
      prompt: maxed ? `${AXIS_LABEL[axis]} is maxed` : `Upgrade ${AXIS_LABEL[axis]}`,
    })
  })

  const hands: Hand[] = ['main', 'off']
  hands.forEach((hand, index) => {
    const allowed = definition.hands.includes(hand)
    const equipped = save.equipped[hand] === selected
    buttons.push({
      id: `equip-${selected}-${hand}`,
      action: { kind: 'equip', weapon: selected, hand },
      // Kept clear of the message strip along the bottom of the board.
      rect: { cx: DETAIL_X - DETAIL_W / 4 + index * (DETAIL_W / 2), cy: -0.28, w: 0.29, h: 0.1 },
      label: HAND_LABEL[hand],
      detail: equipped ? 'Held' : allowed ? '' : '—',
      state: equipped ? 'done' : allowed ? 'available' : 'locked',
      prompt: equipped
        ? `Already in your ${HAND_LABEL[hand].toLowerCase()}`
        : `Hold it in your ${HAND_LABEL[hand].toLowerCase()}`,
    })
  })

  return buttons
}

/**
 * The line the panel shows after a press.
 *
 * There is no audio until Sprint 3.2, so this and the button's own flash are the whole of
 * the purchase feedback. Refusals say *why*: "not enough gold" is a game telling you the
 * rules, while a button that quietly does nothing is a game that looks broken.
 */
export interface ShopFeedback {
  text: string
  ok: boolean
  /** `performance.now()` when it was raised, so the panel can retire it. */
  at: number
}

export function describeFailure(reason: string | undefined): string {
  switch (reason) {
    case 'insufficient-gold':
      return 'Not enough gold.'
    case 'max-level':
      return 'Already at maximum.'
    case 'wrong-hand':
      return 'Not for that hand.'
    case 'not-owned':
      return 'Buy it first.'
    case 'already-owned':
      return 'You already own it.'
    default:
      return 'Cannot do that.'
  }
}

export function describeSuccess(action: ShopAction, spent: number): string {
  switch (action.kind) {
    case 'buy':
      return `Bought the ${WEAPONS[action.weapon].name} for ${spent}g.`
    case 'upgrade':
      return `${AXIS_LABEL[action.axis]} improved for ${spent}g.`
    case 'equip':
      return `${WEAPONS[action.weapon].name} in your ${HAND_LABEL[action.hand].toLowerCase()}.`
    case 'select':
      return WEAPONS[action.weapon].name
  }
}

/** Levels bought and levels available, for the panel's pips. */
export function upgradePips(
  save: SaveData,
  id: WeaponId,
  axis: UpgradeAxis,
): { filled: number; total: number } {
  const track = upgradeTrack(id, axis)
  return { filled: upgradeLevel(save, id, axis), total: track?.maxLevel ?? 0 }
}

/**
 * Which weapon the panel is showing, and what it last said.
 *
 * Not persisted: which page of a shop you were looking at is not progression, and restoring
 * it would be one more thing that can be wrong after a reload for no benefit at all.
 */
interface ShopStore {
  selected: WeaponId
  feedback: ShopFeedback | null
  /** The current layout, for the given save. */
  buttons(save: SaveData): ShopButton[]
  /** Press a button. Returns whether it did something, for the haptics. */
  activate(action: ShopAction): boolean
  clearFeedback(): void
}

export const useShop = create<ShopStore>()((set, get) => ({
  selected: STARTER_WEAPON,
  feedback: null,

  buttons: (save) => shopButtons(save, get().selected),

  activate: (action) => {
    if (action.kind === 'select') {
      set({ selected: action.weapon, feedback: null })
      return true
    }

    const game = useGame.getState()
    const result =
      action.kind === 'buy'
        ? game.buyWeapon(action.weapon)
        : action.kind === 'upgrade'
          ? game.buyUpgrade(action.weapon, action.axis)
          : game.equip(action.hand, action.weapon)

    set({
      feedback: {
        text: result.ok ? describeSuccess(action, result.spent ?? 0) : describeFailure(result.reason),
        ok: result.ok,
        at: performance.now(),
      },
    })
    return result.ok
  },

  clearFeedback: () => set({ feedback: null }),
}))
