import { describe, expect, it } from 'vitest'
import {
  addTrauma,
  clearShake,
  createShake,
  MAX_ANGLE,
  MAX_ROLL,
  sampleShake,
  stepShake,
  Trauma,
  type ShakeOffset,
} from '@/systems/fx/shake'

const DESKTOP = { inVR: false }
const HEADSET = { inVR: true }

function offset(): ShakeOffset {
  return { x: 0, y: 0, roll: 0 }
}

describe('screenshake', () => {
  it('is exactly nothing in VR, however much trauma there is', () => {
    const state = createShake()
    addTrauma(state, 1)
    stepShake(state, 0.016)

    // The rule this project has held since Sprint 0.3: nothing moves the VR camera except the
    // player's head. It is enforced here rather than at the call site so a future caller
    // cannot forget it.
    expect(sampleShake(state, offset(), HEADSET)).toEqual({ x: 0, y: 0, roll: 0 })
  })

  it('shakes on a monitor once something has added trauma', () => {
    const state = createShake()
    addTrauma(state, 1)

    let moved = false
    for (let i = 0; i < 12; i += 1) {
      stepShake(state, 1 / 60)
      const out = sampleShake(state, offset(), DESKTOP)
      if (Math.abs(out.x) > 1e-4 || Math.abs(out.y) > 1e-4 || Math.abs(out.roll) > 1e-4) {
        moved = true
      }
    }

    expect(moved).toBe(true)
  })

  it('does nothing at all when nothing has happened', () => {
    const state = createShake()
    stepShake(state, 0.5)
    expect(sampleShake(state, offset(), DESKTOP)).toEqual({ x: 0, y: 0, roll: 0 })
  })

  it('stays inside its bounds at full trauma', () => {
    const state = createShake()

    for (let i = 0; i < 200; i += 1) {
      addTrauma(state, 1)
      state.time = i * 0.017
      const out = sampleShake(state, offset(), DESKTOP)
      expect(Math.abs(out.x)).toBeLessThanOrEqual(MAX_ANGLE + 1e-9)
      expect(Math.abs(out.y)).toBeLessThanOrEqual(MAX_ANGLE + 1e-9)
      expect(Math.abs(out.roll)).toBeLessThanOrEqual(MAX_ROLL + 1e-9)
    }
  })

  it('clamps trauma to one, so stacked sources cannot exceed a full shake', () => {
    const state = createShake()
    addTrauma(state, Trauma.kill)
    addTrauma(state, Trauma.kill)
    addTrauma(state, Trauma.hurt)
    addTrauma(state, Trauma.hurt)
    expect(state.trauma).toBe(1)
  })

  it('decays to a dead stop rather than ringing on', () => {
    const state = createShake()
    addTrauma(state, 1)

    for (let i = 0; i < 120; i += 1) stepShake(state, 1 / 60)

    expect(state.trauma).toBe(0)
    expect(sampleShake(state, offset(), DESKTOP)).toEqual({ x: 0, y: 0, roll: 0 })
  })

  it('falls away faster than linearly, so a glancing hit barely registers', () => {
    const heavy = createShake()
    const light = createShake()
    addTrauma(heavy, 1)
    addTrauma(light, 0.5)
    heavy.time = 0.25
    light.time = 0.25

    const big = Math.abs(sampleShake(heavy, offset(), DESKTOP).x)
    const small = Math.abs(sampleShake(light, offset(), DESKTOP).x)

    // Trauma squared: half the trauma is a quarter of the shake.
    expect(small).toBeCloseTo(big / 4, 6)
  })

  it('is deterministic, so the same trauma at the same moment is the same shake', () => {
    const a = createShake()
    const b = createShake()
    addTrauma(a, 0.7)
    addTrauma(b, 0.7)
    stepShake(a, 0.05)
    stepShake(b, 0.05)

    expect(sampleShake(a, offset(), DESKTOP)).toEqual(sampleShake(b, offset(), DESKTOP))
  })

  it('clears', () => {
    const state = createShake()
    addTrauma(state, 1)
    clearShake(state)
    expect(state.trauma).toBe(0)
  })
})
