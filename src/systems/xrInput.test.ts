import { describe, expect, it } from 'vitest'
import {
  applyButtonReading,
  applyHandReadings,
  applyStickReading,
  clearHand,
  type ButtonState,
  type GamepadComponentReading,
  type HandInput,
  type StickState,
} from './xrInput'

/**
 * The edge detection is the only part of VR input that can be verified without a headset —
 * and it is also the part most likely to break gameplay subtly rather than obviously. A
 * `justPressed` that latches for two steps double-fires every weapon in the game.
 */

function button(): ButtonState {
  return { value: 0, pressed: false, touched: false, justPressed: false, justReleased: false }
}

function stick(): StickState {
  return { ...button(), x: 0, y: 0 }
}

function hand(): HandInput {
  return {
    connected: false,
    trigger: button(),
    grip: button(),
    primary: button(),
    secondary: button(),
    thumbstick: stick(),
    thumbrest: button(),
  }
}

const pressed = (value = 1): GamepadComponentReading => ({ state: 'pressed', button: value })
const released = (value = 0): GamepadComponentReading => ({ state: 'default', button: value })

describe('applyButtonReading', () => {
  it('raises justPressed for exactly one step', () => {
    const b = button()

    applyButtonReading(b, pressed())
    expect(b.pressed).toBe(true)
    expect(b.justPressed).toBe(true)

    applyButtonReading(b, pressed())
    expect(b.pressed).toBe(true)
    expect(b.justPressed).toBe(false)
  })

  it('raises justReleased for exactly one step', () => {
    const b = button()
    applyButtonReading(b, pressed())
    applyButtonReading(b, pressed())

    applyButtonReading(b, released())
    expect(b.pressed).toBe(false)
    expect(b.justReleased).toBe(true)

    applyButtonReading(b, released())
    expect(b.justReleased).toBe(false)
  })

  it('never reports both edges at once', () => {
    const b = button()
    for (const reading of [pressed(), released(), pressed(), pressed(), released()]) {
      applyButtonReading(b, reading)
      expect(b.justPressed && b.justReleased).toBe(false)
    }
  })

  it('keeps the analog value from the hardware', () => {
    const b = button()
    applyButtonReading(b, { state: 'touched', button: 0.42 })
    expect(b.value).toBeCloseTo(0.42)
    expect(b.pressed).toBe(false)
    expect(b.touched).toBe(true)
  })

  it('derives 0/1 for digital buttons that report no analog value', () => {
    const b = button()
    applyButtonReading(b, { state: 'pressed' })
    expect(b.value).toBe(1)
    applyButtonReading(b, { state: 'default' })
    expect(b.value).toBe(0)
  })

  it('treats a pressed button as touched', () => {
    const b = button()
    applyButtonReading(b, pressed())
    expect(b.touched).toBe(true)
  })

  it('treats a missing reading as released', () => {
    const b = button()
    applyButtonReading(b, pressed())
    applyButtonReading(b, undefined)
    expect(b.pressed).toBe(false)
    expect(b.justReleased).toBe(true)
    expect(b.value).toBe(0)
  })
})

describe('applyStickReading', () => {
  it('carries both axes through', () => {
    const s = stick()
    applyStickReading(s, { state: 'default', xAxis: -0.8, yAxis: 0.3 })
    expect(s.x).toBeCloseTo(-0.8)
    expect(s.y).toBeCloseTo(0.3)
  })

  it('zeroes the axes when the stick reports none', () => {
    const s = stick()
    applyStickReading(s, { state: 'default', xAxis: 0.5, yAxis: 0.5 })
    applyStickReading(s, { state: 'default' })
    expect(s.x).toBe(0)
    expect(s.y).toBe(0)
  })

  it('detects the stick click as a button', () => {
    const s = stick()
    applyStickReading(s, { state: 'pressed', xAxis: 0, yAxis: 0 })
    expect(s.justPressed).toBe(true)
  })
})

describe('applyHandReadings', () => {
  const readings: Record<string, GamepadComponentReading> = {
    'xr-standard-trigger': { state: 'pressed', button: 0.9 },
    'xr-standard-squeeze': { state: 'touched', button: 0.2 },
    'xr-standard-thumbstick': { state: 'default', xAxis: 1, yAxis: -1 },
    'a-button': { state: 'pressed' },
    'b-button': { state: 'default' },
    'x-button': { state: 'default' },
    'y-button': { state: 'pressed' },
  }
  const read = (id: string) => readings[id]

  it('maps a/b to primary/secondary on the right hand', () => {
    const h = hand()
    applyHandReadings(h, 'right', read)
    expect(h.primary.pressed).toBe(true)
    expect(h.secondary.pressed).toBe(false)
  })

  it('maps x/y to primary/secondary on the left hand', () => {
    const h = hand()
    applyHandReadings(h, 'left', read)
    expect(h.primary.pressed).toBe(false)
    expect(h.secondary.pressed).toBe(true)
  })

  it('marks the hand connected and fills every control', () => {
    const h = hand()
    applyHandReadings(h, 'right', read)
    expect(h.connected).toBe(true)
    expect(h.trigger.value).toBeCloseTo(0.9)
    expect(h.grip.touched).toBe(true)
    expect(h.grip.pressed).toBe(false)
    expect(h.thumbstick.x).toBe(1)
    expect(h.thumbstick.y).toBe(-1)
  })

  it('reports controls the layout omits as released rather than throwing', () => {
    const h = hand()
    applyHandReadings(h, 'right', () => undefined)
    expect(h.connected).toBe(true)
    expect(h.trigger.pressed).toBe(false)
    expect(h.thumbrest.pressed).toBe(false)
  })
})

describe('clearHand', () => {
  it('releases a held trigger so a disconnect cannot latch it on', () => {
    const h = hand()
    applyHandReadings(h, 'right', () => pressed())
    expect(h.trigger.pressed).toBe(true)

    clearHand(h)
    expect(h.connected).toBe(false)
    expect(h.trigger.pressed).toBe(false)
    expect(h.trigger.justReleased).toBe(true)
  })

  it('is idempotent — the release edge fires once, not every step', () => {
    const h = hand()
    applyHandReadings(h, 'right', () => pressed())
    clearHand(h)
    clearHand(h)
    expect(h.trigger.justReleased).toBe(false)
  })

  it('zeroes the thumbstick axes', () => {
    const h = hand()
    applyHandReadings(h, 'left', () => ({ state: 'default', xAxis: 1, yAxis: 1 }))
    clearHand(h)
    expect(h.thumbstick.x).toBe(0)
    expect(h.thumbstick.y).toBe(0)
  })
})
