import { describe, expect, it } from 'vitest'
import { DEFAULT_FLICKER, flicker } from './torch'

/**
 * A light that spikes or drops to black is unpleasant on a monitor and genuinely unpleasant
 * in a headset. It is also invisible in a screenshot, so it gets asserted here.
 */

describe('flicker', () => {
  it('stays inside its configured range over a long run', () => {
    for (let t = 0; t < 120; t += 0.01) {
      const value = flicker(t)
      expect(value).toBeGreaterThanOrEqual(DEFAULT_FLICKER.min)
      expect(value).toBeLessThanOrEqual(DEFAULT_FLICKER.max)
    }
  })

  it('is deterministic', () => {
    expect(flicker(3.5, 2)).toBe(flicker(3.5, 2))
  })

  it('never jumps far between adjacent frames', () => {
    // The failure this catches: a waveform that looks fine averaged but pops frame to frame.
    // At 90fps a step is 11ms, and the eye reads anything above a few percent as a flash.
    const step = 1 / 90
    let previous = flicker(0)
    for (let t = step; t < 30; t += step) {
      const value = flicker(t)
      expect(Math.abs(value - previous)).toBeLessThan(0.05)
      previous = value
    }
  })

  it('gives different torches different phases', () => {
    // A row of torches pulsing in unison reads as a shader, not as fire.
    const a = flicker(1.2, 0)
    const b = flicker(1.2, 1)
    expect(Math.abs(a - b)).toBeGreaterThan(0.001)
  })

  it('actually varies', () => {
    const samples = Array.from({ length: 200 }, (_, i) => flicker(i * 0.05))
    const spread = Math.max(...samples) - Math.min(...samples)
    expect(spread).toBeGreaterThan((DEFAULT_FLICKER.max - DEFAULT_FLICKER.min) * 0.5)
  })
})
