import { beforeEach, describe, expect, it } from 'vitest'
import { STARTER_WEAPON, WEAPONS, weaponStats } from '@/data/weapons'
import { useGame } from './game'
import { buyWeapon, newSave, type SaveData } from './save'
import {
  PANEL_HEIGHT,
  PANEL_WIDTH,
  describeFailure,
  shopButtons,
  upgradePips,
  useShop,
  type ShopButton,
} from './shop'

/**
 * The shop's layout, tested as data.
 *
 * "Is the buy button still offered for something you already own?", "does an upgrade you
 * cannot afford read as unaffordable rather than as broken?", "can a two-hander be put in
 * your off hand?" — all questions about a list of objects, and all miserable to answer by
 * putting a headset on and walking to a counter.
 */

const find = (buttons: ShopButton[], id: string): ShopButton | undefined =>
  buttons.find((b) => b.id === id)

const withGold = (gold: number, save: SaveData = newSave()): SaveData => ({ ...save, gold })

beforeEach(() => {
  useGame.setState({ save: newSave() })
  useShop.setState({ selected: STARTER_WEAPON, feedback: null })
})

describe('shopButtons', () => {
  it('lists every weapon in the catalogue', () => {
    const buttons = shopButtons(newSave(), STARTER_WEAPON)
    for (const id of Object.keys(WEAPONS)) {
      expect(find(buttons, `select-${id}`)).toBeDefined()
    }
  })

  it('marks the selected weapon rather than offering it again', () => {
    const buttons = shopButtons(newSave(), STARTER_WEAPON)
    expect(find(buttons, `select-${STARTER_WEAPON}`)?.state).toBe('done')
    expect(find(buttons, 'select-frostbrand-sword')?.state).toBe('available')
  })

  it('shows a price for what you do not own and "Owned" for what you do', () => {
    const buttons = shopButtons(newSave(), STARTER_WEAPON)
    expect(find(buttons, `select-${STARTER_WEAPON}`)?.detail).toBe('Owned')
    expect(find(buttons, 'select-frostbrand-sword')?.detail).toBe(
      `${WEAPONS['frostbrand-sword'].price}g`,
    )
  })

  it('offers a buy button only for an unowned weapon', () => {
    expect(find(shopButtons(newSave(), 'frostbrand-sword'), 'buy-frostbrand-sword')).toBeDefined()
    expect(find(shopButtons(newSave(), STARTER_WEAPON), `buy-${STARTER_WEAPON}`)).toBeUndefined()
  })

  it('marks a purchase you cannot afford without hiding the price', () => {
    const buttons = shopButtons(withGold(10), 'frostbrand-sword')
    const buy = find(buttons, 'buy-frostbrand-sword')
    expect(buy?.state).toBe('unaffordable')
    // Hiding it would leave the player wondering whether the weapon exists at all.
    expect(buy?.detail).toBe(`${WEAPONS['frostbrand-sword'].price}g`)
  })

  it('replaces the buy button with upgrades and equip slots once owned', () => {
    const buttons = shopButtons(newSave(), STARTER_WEAPON)
    expect(find(buttons, `upgrade-${STARTER_WEAPON}-damage`)).toBeDefined()
    expect(find(buttons, `equip-${STARTER_WEAPON}-main`)).toBeDefined()
    expect(find(buttons, `equip-${STARTER_WEAPON}-off`)).toBeDefined()
  })

  it('shows the stat change an upgrade would buy', () => {
    const button = find(shopButtons(newSave(), STARTER_WEAPON), `upgrade-${STARTER_WEAPON}-damage`)
    const before = weaponStats(STARTER_WEAPON).damage.toFixed(0)
    const after = weaponStats(STARTER_WEAPON, { damage: 1 }).damage.toFixed(0)
    // The comparison is the whole reason anyone can tell one upgrade from another.
    expect(button?.label).toContain(`${before} → ${after}`)
  })

  it('locks a maxed upgrade and stops quoting a price for it', () => {
    const track = WEAPONS[STARTER_WEAPON].upgrades[0]!
    const save: SaveData = {
      ...newSave(),
      weapons: { [STARTER_WEAPON]: { upgrades: { [track.axis]: track.maxLevel } } },
    }
    const button = find(shopButtons(save, STARTER_WEAPON), `upgrade-${STARTER_WEAPON}-${track.axis}`)
    expect(button?.state).toBe('locked')
    expect(button?.detail).toContain('Max')
    expect(button?.label).not.toContain('→')
  })

  it('marks the hand a weapon is already in', () => {
    const buttons = shopButtons(newSave(), STARTER_WEAPON)
    expect(find(buttons, `equip-${STARTER_WEAPON}-main`)?.state).toBe('done')
    expect(find(buttons, `equip-${STARTER_WEAPON}-off`)?.state).toBe('available')
  })

  it('locks a hand the weapon cannot be held in', () => {
    const bought = buyWeapon(withGold(500), 'boneshard-staff')
    expect(bought.ok).toBe(true)
    if (!bought.ok) return
    const buttons = shopButtons(bought.save, 'boneshard-staff')
    expect(find(buttons, 'equip-boneshard-staff-off')?.state).toBe('locked')
    expect(find(buttons, 'equip-boneshard-staff-main')?.state).toBe('available')
  })

  it('keeps every button inside the panel', () => {
    // A button drawn off the edge of the board is still pressable by the interaction system,
    // which is a genuinely baffling thing to run into in a headset.
    for (const id of Object.keys(WEAPONS)) {
      for (const button of shopButtons(withGold(5000), id as keyof typeof WEAPONS)) {
        expect(Math.abs(button.rect.cx) + button.rect.w / 2).toBeLessThanOrEqual(PANEL_WIDTH / 2)
        expect(Math.abs(button.rect.cy) + button.rect.h / 2).toBeLessThanOrEqual(PANEL_HEIGHT / 2)
      }
    }
  })

  it('never overlaps two buttons', () => {
    // Overlapping rectangles mean the thing you press is not the thing you aimed at.
    const buttons = shopButtons(withGold(5000), STARTER_WEAPON)
    for (let i = 0; i < buttons.length; i++) {
      for (let j = i + 1; j < buttons.length; j++) {
        const a = buttons[i]!.rect
        const b = buttons[j]!.rect
        const apart =
          Math.abs(a.cx - b.cx) >= (a.w + b.w) / 2 || Math.abs(a.cy - b.cy) >= (a.h + b.h) / 2
        expect(apart, `${buttons[i]!.id} overlaps ${buttons[j]!.id}`).toBe(true)
      }
    }
  })

  it('gives every button a stable id and a verb for a prompt', () => {
    const buttons = shopButtons(withGold(5000), STARTER_WEAPON)
    expect(new Set(buttons.map((b) => b.id)).size).toBe(buttons.length)
    for (const button of buttons) expect(button.prompt.length).toBeGreaterThan(0)
  })
})

describe('upgradePips', () => {
  it('counts levels bought against levels available', () => {
    const save: SaveData = {
      ...newSave(),
      weapons: { [STARTER_WEAPON]: { upgrades: { damage: 2 } } },
    }
    expect(upgradePips(save, STARTER_WEAPON, 'damage')).toEqual({
      filled: 2,
      total: WEAPONS[STARTER_WEAPON].upgrades[0]!.maxLevel,
    })
  })
})

describe('describeFailure', () => {
  it('says why, for every refusal the save can produce', () => {
    for (const reason of ['insufficient-gold', 'max-level', 'wrong-hand', 'not-owned']) {
      expect(describeFailure(reason)).not.toBe('Cannot do that.')
    }
    // A button that quietly does nothing is a game that looks broken.
    expect(describeFailure(undefined)).toBeTruthy()
  })
})

describe('the shop store', () => {
  it('selects without spending anything', () => {
    useShop.getState().activate({ kind: 'select', weapon: 'frostbrand-sword' })
    expect(useShop.getState().selected).toBe('frostbrand-sword')
    expect(useGame.getState().save.gold).toBe(100)
  })

  it('buys, and says so', () => {
    useShop.getState().activate({ kind: 'buy', weapon: 'frostbrand-sword' })
    expect(useGame.getState().save.weapons['frostbrand-sword']).toBeDefined()
    expect(useGame.getState().save.gold).toBe(100 - WEAPONS['frostbrand-sword'].price)
    expect(useShop.getState().feedback).toMatchObject({ ok: true })
  })

  it('refuses a purchase it cannot afford, and explains', () => {
    useGame.setState({ save: withGold(10) })
    const ok = useShop.getState().activate({ kind: 'buy', weapon: 'frostbrand-sword' })
    expect(ok).toBe(false)
    expect(useGame.getState().save.gold).toBe(10)
    expect(useShop.getState().feedback).toMatchObject({ ok: false, text: 'Not enough gold.' })
  })

  it('equips through the same path', () => {
    useShop.getState().activate({ kind: 'equip', weapon: STARTER_WEAPON, hand: 'off' })
    expect(useGame.getState().save.equipped.off).toBe(STARTER_WEAPON)
  })

  it('rebuilds its buttons from the current save', () => {
    useShop.setState({ selected: 'frostbrand-sword' })
    expect(find(useShop.getState().buttons(useGame.getState().save), 'buy-frostbrand-sword')).toBeDefined()
    useShop.getState().activate({ kind: 'buy', weapon: 'frostbrand-sword' })
    const after = useShop.getState().buttons(useGame.getState().save)
    expect(find(after, 'buy-frostbrand-sword')).toBeUndefined()
    expect(find(after, 'equip-frostbrand-sword-main')).toBeDefined()
  })
})
