import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  SETTING_LIMITS,
  sanitiseSettings,
  type Settings,
} from './settings'
import { SURFACE_TOUCH_MARGIN } from './interaction'
import {
  SETTINGS_PANEL_HEIGHT,
  SETTINGS_PANEL_WIDTH,
  applySettingsAction,
  formatSetting,
  isDefault,
  settingsButtons,
  settingsRows,
  stepSetting,
} from './settingsPanel'

/**
 * The board a player uses *while wearing the headset*, which is the only place the comfort
 * settings matter. Everything here is about a press doing exactly what the button says.
 */

function make(overrides: Partial<Settings> = {}): Settings {
  return sanitiseSettings({ ...DEFAULT_SETTINGS, ...overrides })
}

function press(settings: Settings, id: string): Settings {
  const button = settingsButtons(settings).find((b) => b.id === id)
  if (!button) throw new Error(`no such button: ${id}`)
  return { ...settings, ...applySettingsAction(settings, button.action) }
}

describe('settingsButtons', () => {
  it('marks the chosen option as chosen, and only it', () => {
    const buttons = settingsButtons(make({ locomotion: 'smooth' }))
    expect(buttons.find((b) => b.id === 'set-locomotion-smooth')?.state).toBe('done')
    expect(buttons.find((b) => b.id === 'set-locomotion-teleport')?.state).toBe('available')
  })

  it('locks a stepper at the end of its range', () => {
    const atZero = settingsButtons(make({ comfortVignette: 0 }))
    expect(atZero.find((b) => b.id === 'set-comfortVignette-down')?.state).toBe('locked')
    expect(atZero.find((b) => b.id === 'set-comfortVignette-up')?.state).toBe('available')

    const atMax = settingsButtons(make({ comfortVignette: SETTING_LIMITS.comfortVignette.max }))
    expect(atMax.find((b) => b.id === 'set-comfortVignette-up')?.state).toBe('locked')
  })

  it('offers Restore defaults only when something has been changed', () => {
    expect(settingsButtons(make()).find((b) => b.id === 'set-defaults')?.state).toBe('locked')
    expect(
      settingsButtons(make({ moveSpeed: 4 })).find((b) => b.id === 'set-defaults')?.state,
    ).toBe('available')
  })

  it('gives every button a unique id', () => {
    // Ids key the interactable registrations. Two buttons sharing one would have the second
    // silently replace the first, and a stepper would stop responding for no visible reason.
    const ids = settingsButtons(make()).map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps every button on the board', () => {
    const halfW = SETTINGS_PANEL_WIDTH / 2
    const halfH = SETTINGS_PANEL_HEIGHT / 2
    for (const { id, rect } of settingsButtons(make())) {
      expect(Math.abs(rect.cx) + rect.w / 2, `${id} runs off the side`).toBeLessThanOrEqual(halfW)
      expect(Math.abs(rect.cy) + rect.h / 2, `${id} runs off the top or bottom`).toBeLessThanOrEqual(halfH)
    }
  })

  it('never overlaps two buttons', () => {
    // The failure this catches is not cosmetic: overlapping rectangles are overlapping
    // *pick* targets, and the player presses one thing and gets another.
    const buttons = settingsButtons(make())
    for (let i = 0; i < buttons.length; i++) {
      for (let j = i + 1; j < buttons.length; j++) {
        const first = buttons[i]!
        const second = buttons[j]!
        const a = first.rect
        const b = second.rect
        const apart =
          Math.abs(a.cx - b.cx) >= (a.w + b.w) / 2 || Math.abs(a.cy - b.cy) >= (a.h + b.h) / 2
        expect(apart, `${first.id} overlaps ${second.id}`).toBe(true)
      }
    }
  })

  it('leaves more room between two rows than the near-grab tolerance', () => {
    // Sprint 2.2 tightened the row pitch to fit the main-hand row on the same board. If two
    // rows end up closer together than twice `SURFACE_TOUCH_MARGIN`, their touch tolerances
    // overlap and a hand on one button can pick the one below — which is precisely the
    // defect that made the shop unusable on its first headset pass.
    const buttons = settingsButtons(make())
    for (const first of buttons) {
      for (const second of buttons) {
        if (first === second) continue
        const gapY = Math.abs(first.rect.cy - second.rect.cy) - (first.rect.h + second.rect.h) / 2
        // Only rows above one another; side-by-side buttons are separated horizontally.
        if (gapY < 0) continue
        expect(gapY, `${first.id} and ${second.id} are too close`).toBeGreaterThan(
          SURFACE_TOUCH_MARGIN * 2,
        )
      }
    }
  })

  it('offers the main hand as a choice', () => {
    // Without it, `main` in the save can only mean "right", and a left-handed player buys a
    // sword that appears in their weak hand.
    const buttons = settingsButtons(make({ mainHand: 'right' }))
    expect(buttons.find((b) => b.id === 'set-mainHand-right')?.state).toBe('done')
    expect(buttons.find((b) => b.id === 'set-mainHand-left')?.state).toBe('available')
  })

  it('has a row label for every option row', () => {
    const rows = settingsRows(make())
    expect(rows.map((row) => row.label)).toContain('Main hand')
  })
})

describe('applySettingsAction', () => {
  it('switches locomotion', () => {
    expect(press(make(), 'set-locomotion-teleport').locomotion).toBe('teleport')
  })

  it('changes nothing when the option is already chosen', () => {
    const settings = make({ turn: 'snap' })
    const button = settingsButtons(settings).find((b) => b.id === 'set-turn-snap')!
    expect(applySettingsAction(settings, button.action)).toEqual({})
  })

  it('steps by the setting’s own step size', () => {
    const settings = make({ snapTurnDegrees: 30 })
    expect(press(settings, 'set-snapTurnDegrees-up').snapTurnDegrees).toBe(45)
    expect(press(settings, 'set-snapTurnDegrees-down').snapTurnDegrees).toBe(15)
  })

  it('restores every default at once', () => {
    const changed = make({ locomotion: 'teleport', moveSpeed: 5, foveation: 0 })
    const restored = press(changed, 'set-defaults')
    expect(isDefault(restored)).toBe(true)
  })
})

describe('stepSetting', () => {
  it('clamps at both ends', () => {
    const { min, max } = SETTING_LIMITS.comfortVignette
    expect(stepSetting(min, 'comfortVignette', -1)).toBe(min)
    expect(stepSetting(max, 'comfortVignette', 1)).toBe(max)
  })

  it('lands exactly on the limit rather than near it', () => {
    // The bug: 0.7 - 0.05 is 0.6499999999999999 in binary floating point. Stepping down to
    // zero from the default then leaves a vignette of 5.55e-17 — the "off" button stays
    // live forever and the board draws a value that is neither 0% nor anything else.
    let value: number = DEFAULT_SETTINGS.comfortVignette
    for (let i = 0; i < 100; i++) value = stepSetting(value, 'comfortVignette', -1)
    expect(value).toBe(0)
    expect(formatSetting('comfortVignette', value)).toBe('0%')
  })

  it('keeps a stepped value clean all the way up', () => {
    let value: number = SETTING_LIMITS.moveSpeed.min
    for (let i = 0; i < 5; i++) value = stepSetting(value, 'moveSpeed', 1)
    expect(value).toBe(2)
  })
})

describe('formatSetting', () => {
  it('shows units, not raw numbers', () => {
    expect(formatSetting('snapTurnDegrees', 30)).toBe('30°')
    expect(formatSetting('smoothTurnSpeed', 120)).toBe('120°/s')
    expect(formatSetting('moveSpeed', 3)).toBe('3.0 m/s')
    expect(formatSetting('foveation', 0.5)).toBe('50%')
    expect(formatSetting('framebufferScale', 1)).toBe('1.00×')
  })
})

describe('settingsRows', () => {
  it('reads the current value onto every stepped row', () => {
    const rows = settingsRows(make({ moveSpeed: 4.5 }))
    expect(rows.find((r) => r.label === 'Walk speed')?.value).toBe('4.5 m/s')
  })

  it('flags the one setting that cannot take effect now', () => {
    const rows = settingsRows(make())
    expect(rows.find((r) => r.label === 'Render scale')?.deferred).toBe(true)
    expect(rows.find((r) => r.label === 'Walk speed')?.deferred).toBeFalsy()
  })
})
