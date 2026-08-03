import { describe, expect, it } from 'vitest'
import { DEATH_HOLD_FRACTION, DISSOLVE_MAX, dissolveAmount } from '@/systems/fx/dissolve'

const TIMING = { spawnSeconds: 0.6, corpseSeconds: 1.6 }

describe('dissolveAmount', () => {
  it('leaves a living body alone in every phase it can be alive in', () => {
    for (const phase of ['idle', 'chase', 'telegraph', 'strike', 'recover', 'stagger']) {
      expect(dissolveAmount({ phase, timer: 0.4, ...TIMING })).toBe(0)
    }
  })

  it('materialises: fully dissolved at the start of a spawn, solid by the end of it', () => {
    expect(dissolveAmount({ phase: 'spawning', timer: 0, ...TIMING })).toBeCloseTo(DISSOLVE_MAX, 6)
    expect(dissolveAmount({ phase: 'spawning', timer: 0.3, ...TIMING })).toBeCloseTo(
      DISSOLVE_MAX / 2,
      6,
    )
    expect(dissolveAmount({ phase: 'spawning', timer: 0.6, ...TIMING })).toBe(0)
  })

  it('holds a fresh corpse together while it falls over', () => {
    // The fall is half of what tells the player the thing is dead; a body that starts coming
    // apart on the frame it dies never reads as a corpse at all.
    expect(dissolveAmount({ phase: 'dying', timer: 0, ...TIMING })).toBe(0)
    const holdEnds = TIMING.corpseSeconds * DEATH_HOLD_FRACTION
    expect(dissolveAmount({ phase: 'dying', timer: holdEnds, ...TIMING })).toBe(0)
    expect(dissolveAmount({ phase: 'dying', timer: holdEnds + 0.01, ...TIMING })).toBeGreaterThan(0)
  })

  it('is fully gone before the slot is recycled', () => {
    // Overshooting 1 matters: the noise the shader samples reaches 1.0, so a threshold of
    // exactly 1 leaves a fleck of skeleton hanging in the corridor.
    expect(dissolveAmount({ phase: 'dying', timer: TIMING.corpseSeconds, ...TIMING })).toBeGreaterThan(1)
    expect(dissolveAmount({ phase: 'dying', timer: 99, ...TIMING })).toBeCloseTo(DISSOLVE_MAX, 6)
  })

  it('rises monotonically across a death', () => {
    let previous = -1
    for (let t = 0; t <= TIMING.corpseSeconds; t += TIMING.corpseSeconds / 40) {
      const amount = dissolveAmount({ phase: 'dying', timer: t, ...TIMING })
      expect(amount).toBeGreaterThanOrEqual(previous)
      previous = amount
    }
  })

  it('survives zero-length timings rather than dividing by them', () => {
    expect(dissolveAmount({ phase: 'spawning', timer: 0, spawnSeconds: 0, corpseSeconds: 0 })).toBe(0)
    expect(
      dissolveAmount({ phase: 'dying', timer: 0, spawnSeconds: 0, corpseSeconds: 0 }),
    ).toBeCloseTo(DISSOLVE_MAX, 6)
  })
})
