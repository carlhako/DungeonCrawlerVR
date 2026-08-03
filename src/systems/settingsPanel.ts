/**
 * The settings board, as a layout.
 *
 * Same split as the shop (`shop.ts`): this file turns the current settings into a list of
 * buttons with rectangles and states, and everything else — the canvas, the interactables,
 * the haptics — is presentation over that list. Which means "does the vignette stepper stop
 * at zero?" is a question about a data structure rather than an evening in a headset.
 *
 * It exists at all because the comfort settings were only reachable from a DOM dev panel.
 * That panel disappears the moment the headset takes over the page, so a player who needed
 * snap turning had to take the headset off, press F2, and put it back on — after being made
 * ill once. Comfort options that can only be changed outside VR are not comfort options.
 *
 * Coordinates are metres in the panel's own frame, origin at its centre, +x right, +y up.
 */

import {
  DEFAULT_SETTINGS,
  SETTING_LIMITS,
  SETTING_OPTIONS,
  type LocomotionMode,
  type Settings,
  type TurnMode,
} from '@/systems/settings'
import type { Rect } from '@/systems/shop'

export const SETTINGS_PANEL_WIDTH = 1.15
export const SETTINGS_PANEL_HEIGHT = 1.0

/** The numeric settings this board offers, in the order they appear. */
export type SteppedSetting = keyof typeof SETTING_LIMITS

export type SettingsAction =
  | { kind: 'locomotion'; value: LocomotionMode }
  | { kind: 'turn'; value: TurnMode }
  | { kind: 'step'; setting: SteppedSetting; delta: 1 | -1 }
  | { kind: 'defaults' }

export type SettingsButtonState =
  /** Pressable. */
  | 'available'
  /** Already the chosen option. */
  | 'done'
  /** At the end of its range, so pressing it would do nothing. */
  | 'locked'

export interface SettingsButton {
  id: string
  action: SettingsAction
  rect: Rect
  label: string
  state: SettingsButtonState
  /** What the interaction prompt says this press will do. */
  prompt: string
}

/** A row of the board: its name, its current value as text, and where to draw them. */
export interface SettingsRow {
  label: string
  value: string
  /** Row centre in panel-local metres. */
  cy: number
  /** True for the render scale, which cannot take effect until the next session. */
  deferred?: boolean
}

const ROW_TOP = 0.3
const ROW_PITCH = 0.088
const ROW_HEIGHT = 0.072

/** Option buttons: two per row, filling the right-hand column. */
const OPTION_W = 0.32
const OPTION_CX: readonly [number, number] = [0.04, 0.39]

/** Steppers: a wide-enough target at either end of the value. */
const STEP_W = 0.16
const STEP_CX = { minus: 0.03, plus: 0.47 }

/** Where a stepped row's value is drawn, between its two buttons. */
export const VALUE_CX = (STEP_CX.minus + STEP_CX.plus) / 2

/** Where a row's name is drawn. */
export const LABEL_X = -0.54

const DEFAULTS_RECT: Rect = { cx: 0, cy: -0.43, w: 0.9, h: 0.075 }

/** Where the render-scale footnote is drawn, between the last row and the defaults button. */
export const FOOTNOTE_CY = -0.372

/**
 * Said permanently rather than as a message after a press.
 *
 * The swapchain is allocated once per session, so this button genuinely cannot do anything
 * until the next VR entry — and a button that visibly does nothing is indistinguishable from
 * a broken one. It was briefly a transient strip along the bottom of the board, which sat on
 * top of the Restore defaults button; a fact that is always true should just always be on
 * the wall.
 */
export const RENDER_SCALE_NOTE = 'Render scale applies the next time you enter VR.'

interface SteppedRow {
  setting: SteppedSetting
  label: string
}

/**
 * The stepped rows, in order.
 *
 * Movement and comfort first, render knobs last: the first group decides whether somebody
 * can play at all, and the second only decides how it looks while they do.
 */
const STEPPED_ROWS: SteppedRow[] = [
  { setting: 'snapTurnDegrees', label: 'Snap size' },
  { setting: 'smoothTurnSpeed', label: 'Turn speed' },
  { setting: 'moveSpeed', label: 'Walk speed' },
  { setting: 'comfortVignette', label: 'Vignette' },
  { setting: 'foveation', label: 'Foveation' },
  { setting: 'framebufferScale', label: 'Render scale' },
]

const OPTION_LABEL: Record<string, string> = {
  smooth: 'Smooth',
  teleport: 'Teleport',
  snap: 'Snap',
}

function optionLabel(value: string): string {
  return OPTION_LABEL[value] ?? value
}

export function settingsRows(settings: Settings): SettingsRow[] {
  const rows: SettingsRow[] = [
    { label: 'Locomotion', value: '', cy: rowY(0) },
    { label: 'Turning', value: '', cy: rowY(1) },
  ]
  STEPPED_ROWS.forEach((row, index) => {
    rows.push({
      label: row.label,
      value: formatSetting(row.setting, settings[row.setting]),
      cy: rowY(index + 2),
      deferred: row.setting === 'framebufferScale',
    })
  })
  return rows
}

export function settingsButtons(settings: Settings): SettingsButton[] {
  const buttons: SettingsButton[] = []

  SETTING_OPTIONS.locomotion.forEach((value, index) => {
    buttons.push({
      id: `set-locomotion-${value}`,
      action: { kind: 'locomotion', value },
      rect: { cx: OPTION_CX[index === 0 ? 0 : 1], cy: rowY(0), w: OPTION_W, h: ROW_HEIGHT },
      label: optionLabel(value),
      state: settings.locomotion === value ? 'done' : 'available',
      prompt:
        value === 'teleport' ? 'Move by teleporting' : 'Move smoothly with the stick',
    })
  })

  for (const value of SETTING_OPTIONS.turn) {
    buttons.push({
      id: `set-turn-${value}`,
      action: { kind: 'turn', value },
      // Smooth on the left, snap on the right — next to the snap-size stepper it governs.
      // The store lists them the other way round; this is the panel's order, not the store's.
      rect: {
        cx: OPTION_CX[value === 'smooth' ? 0 : 1],
        cy: rowY(1),
        w: OPTION_W,
        h: ROW_HEIGHT,
      },
      label: optionLabel(value),
      state: settings.turn === value ? 'done' : 'available',
      prompt: value === 'snap' ? 'Turn in steps' : 'Turn smoothly',
    })
  }

  STEPPED_ROWS.forEach((row, index) => {
    const cy = rowY(index + 2)
    const current = settings[row.setting]
    const { min, max } = SETTING_LIMITS[row.setting]
    for (const delta of [-1, 1] as const) {
      const at = delta < 0 ? current <= min : current >= max
      buttons.push({
        id: `set-${row.setting}-${delta < 0 ? 'down' : 'up'}`,
        action: { kind: 'step', setting: row.setting, delta },
        rect: {
          cx: delta < 0 ? STEP_CX.minus : STEP_CX.plus,
          cy,
          w: STEP_W,
          h: ROW_HEIGHT,
        },
        label: delta < 0 ? '−' : '+',
        state: at ? 'locked' : 'available',
        prompt: `${row.label} ${delta < 0 ? 'down' : 'up'}`,
      })
    }
  })

  buttons.push({
    id: 'set-defaults',
    action: { kind: 'defaults' },
    rect: DEFAULTS_RECT,
    label: 'Restore defaults',
    state: isDefault(settings) ? 'locked' : 'available',
    prompt: 'Put every setting back to its default',
  })

  return buttons
}

function rowY(index: number): number {
  return ROW_TOP - index * ROW_PITCH
}

/**
 * What a press changes, as a patch. Empty when the press would change nothing — a stepper
 * already at its limit, or an option that is already chosen.
 */
export function applySettingsAction(
  settings: Settings,
  action: SettingsAction,
): Partial<Settings> {
  switch (action.kind) {
    case 'locomotion':
      return settings.locomotion === action.value ? {} : { locomotion: action.value }
    case 'turn':
      return settings.turn === action.value ? {} : { turn: action.value }
    case 'step': {
      const next = stepSetting(settings[action.setting], action.setting, action.delta)
      return next === settings[action.setting] ? {} : { [action.setting]: next }
    }
    case 'defaults':
      return isDefault(settings) ? {} : { ...DEFAULT_SETTINGS }
  }
}

/**
 * One step up or down, clamped, and rounded to the step size.
 *
 * The rounding is not cosmetic. `0.7 - 0.05` is `0.6499999999999999` in binary floating
 * point, and a few presses of a 0.05 stepper leave a vignette setting that can never land
 * back on its own limit — so the button that should read "off" stays live forever, and the
 * value drawn on the board grows a tail of digits.
 */
export function stepSetting(
  value: number,
  setting: SteppedSetting,
  delta: 1 | -1,
): number {
  const { min, max, step } = SETTING_LIMITS[setting]
  const raw = value + delta * step
  const clamped = Math.min(max, Math.max(min, raw))
  return round(Math.round(clamped / step) * step)
}

/** Kill floating-point tails without pretending to more precision than a step has. */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

export function isDefault(settings: Settings): boolean {
  return (Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>).every(
    (key) => settings[key] === DEFAULT_SETTINGS[key],
  )
}

/**
 * A setting as the player should read it.
 *
 * Units, always. "0.7" on a wall in a dark room is not information; "70%" is.
 */
export function formatSetting(setting: SteppedSetting, value: number): string {
  switch (setting) {
    case 'snapTurnDegrees':
      return `${Math.round(value)}°`
    case 'smoothTurnSpeed':
      return `${Math.round(value)}°/s`
    case 'moveSpeed':
      return `${value.toFixed(1)} m/s`
    case 'comfortVignette':
    case 'foveation':
      return `${Math.round(value * 100)}%`
    case 'framebufferScale':
      return `${value.toFixed(2)}×`
  }
}
