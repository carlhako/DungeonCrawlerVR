import { describe, expect, it } from 'vitest'
import {
  clearHitstop,
  createHitstop,
  HITSTOP_SCALE,
  KILL_HITSTOP,
  MAX_HITSTOP,
  requestHitstop,
  stepHitstop,
  timeScale,
} from '@/systems/fx/hitstop'

const DESKTOP = { inVR: false }
const HEADSET = { inVR: true }

describe('hitstop', () => {
  it('runs at full speed with nothing requested', () => {
    const state = createHitstop()
    expect(timeScale(state, DESKTOP)).toBe(1)
  })

  it('slows the simulation while a stop is live, and restores full speed after it', () => {
    const state = createHitstop()
    requestHitstop(state, 0.05)

    expect(timeScale(state, DESKTOP)).toBe(HITSTOP_SCALE)

    stepHitstop(state, 0.03)
    expect(timeScale(state, DESKTOP)).toBe(HITSTOP_SCALE)

    stepHitstop(state, 0.03)
    expect(state.remaining).toBe(0)
    expect(timeScale(state, DESKTOP)).toBe(1)
  })

  it('never stops the world in VR, whatever has been requested', () => {
    const state = createHitstop()
    requestHitstop(state, KILL_HITSTOP)

    // The comfort rule: in a headset the camera is the player's head, and it does not slow
    // down with the world. This is the assertion that keeps that true.
    expect(timeScale(state, HEADSET)).toBe(1)
  })

  it('takes the longest request rather than summing them', () => {
    const state = createHitstop()
    requestHitstop(state, 0.05)
    requestHitstop(state, 0.02)
    expect(state.remaining).toBeCloseTo(0.05, 6)

    requestHitstop(state, 0.08)
    expect(state.remaining).toBeCloseTo(0.08, 6)
  })

  it('clamps to the maximum, so a pack dying at once is one stop', () => {
    const state = createHitstop()
    for (let i = 0; i < 5; i += 1) requestHitstop(state, MAX_HITSTOP)
    expect(state.remaining).toBeCloseTo(MAX_HITSTOP, 6)

    requestHitstop(state, 10)
    expect(state.remaining).toBeCloseTo(MAX_HITSTOP, 6)
  })

  it('ignores a request for no time at all', () => {
    const state = createHitstop()
    requestHitstop(state, 0)
    requestHitstop(state, -1)
    expect(state.remaining).toBe(0)
  })

  it('clears', () => {
    const state = createHitstop()
    requestHitstop(state, MAX_HITSTOP)
    clearHitstop(state)
    expect(state.remaining).toBe(0)
    expect(timeScale(state, DESKTOP)).toBe(1)
  })
})
