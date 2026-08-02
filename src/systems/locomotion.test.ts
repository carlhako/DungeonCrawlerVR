import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VERTICAL,
  SNAP_TURN_ENGAGE,
  SNAP_TURN_RELEASE,
  applyDeadzone,
  createTurnLatch,
  damp,
  findArcHit,
  headingFromBasis,
  integrateVertical,
  isValidLanding,
  moveDirection,
  sampleArc,
  smoothTurn,
  snapTurn,
  vignetteTarget,
  type Vec3,
} from './locomotion'

const CLOSE = 1e-6

describe('applyDeadzone', () => {
  it('zeroes input inside the deadzone', () => {
    expect(applyDeadzone(0.1, 0.1, 0.3)).toEqual({ x: 0, y: 0 })
    expect(applyDeadzone(0, 0, 0.15)).toEqual({ x: 0, y: 0 })
  })

  it('starts from zero just outside the deadzone rather than jumping', () => {
    const result = applyDeadzone(0.16, 0, 0.15)
    expect(Math.hypot(result.x, result.y)).toBeLessThan(0.02)
  })

  it('reaches full magnitude at full deflection', () => {
    const result = applyDeadzone(1, 0, 0.15)
    expect(result.x).toBeCloseTo(1, 6)
  })

  it('does not let the diagonal outrun the cardinals', () => {
    // The classic square-deadzone bug: pushing the stick corner-to-corner gives a
    // magnitude of √2 and the player sprints diagonally.
    const diagonal = applyDeadzone(0.707, 0.707, 0.15)
    const cardinal = applyDeadzone(1, 0, 0.15)
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(
      Math.hypot(cardinal.x, cardinal.y),
      3,
    )
  })

  it('clamps hardware that over-reports past 1', () => {
    const result = applyDeadzone(1.2, 0, 0.15)
    expect(Math.hypot(result.x, result.y)).toBeLessThanOrEqual(1 + CLOSE)
  })

  it('preserves the input direction', () => {
    const result = applyDeadzone(0.6, -0.8, 0.15)
    expect(Math.atan2(result.y, result.x)).toBeCloseTo(Math.atan2(-0.8, 0.6), 6)
  })
})

describe('moveDirection', () => {
  it('sends a forward push down -Z at zero yaw', () => {
    // WebXR reports stick-forward as y = -1.
    const result = moveDirection({ x: 0, y: -1 }, 0)
    expect(result.x).toBeCloseTo(0, 6)
    expect(result.y).toBeCloseTo(-1, 6)
  })

  it('sends a right push down +X at zero yaw', () => {
    const result = moveDirection({ x: 1, y: 0 }, 0)
    expect(result.x).toBeCloseTo(1, 6)
    expect(result.y).toBeCloseTo(0, 6)
  })

  it('follows the facing: forward at 90° yaw goes down -X', () => {
    const result = moveDirection({ x: 0, y: -1 }, Math.PI / 2)
    expect(result.x).toBeCloseTo(-1, 6)
    expect(result.y).toBeCloseTo(0, 6)
  })

  it('preserves magnitude at every yaw', () => {
    for (const yaw of [0, 0.3, 1.1, Math.PI, -2.4]) {
      const result = moveDirection({ x: 0.5, y: -0.5 }, yaw)
      expect(Math.hypot(result.x, result.y)).toBeCloseTo(Math.hypot(0.5, 0.5), 6)
    }
  })
})

describe('headingFromBasis', () => {
  const UP: Vec3 = { x: 0, y: 1, z: 0 }

  it('reads zero when facing -Z', () => {
    expect(headingFromBasis({ x: 0, y: 0, z: -1 }, UP)).toBeCloseTo(0, 6)
  })

  it('reads +90° when facing -X', () => {
    expect(headingFromBasis({ x: -1, y: 0, z: 0 }, UP)).toBeCloseTo(Math.PI / 2, 6)
  })

  it('ignores pitch: looking down at the floor ahead keeps the heading', () => {
    const forward = { x: 0, y: -Math.sin(0.9), z: -Math.cos(0.9) }
    const up = { x: 0, y: Math.cos(0.9), z: -Math.sin(0.9) }
    expect(headingFromBasis(forward, up)).toBeCloseTo(0, 6)
  })

  it('falls back to the up vector when looking straight down', () => {
    // Forward has no horizontal component left to take a heading from, and what remains is
    // noise — this is the case that makes a head-relative stick jitter.
    const forward = { x: 0, y: -1, z: 0 }
    const up = { x: 0, y: 0, z: -1 }
    expect(headingFromBasis(forward, up)).toBeCloseTo(0, 6)
  })

  it('falls back correctly when looking straight up', () => {
    const forward = { x: 0, y: 1, z: 0 }
    const up = { x: 0, y: 0, z: 1 }
    expect(headingFromBasis(forward, up)).toBeCloseTo(0, 6)
  })

  it('stays continuous as the head tilts through vertical, in both directions', () => {
    // The regression this guards: past vertical, the forward vector's horizontal component
    // flips backwards, so "walk forward" silently became "walk backward" the moment a
    // player leaned their head back to look at the ceiling.
    for (let pitch = -2; pitch <= 2; pitch += 0.05) {
      const heading = headingFromBasis(
        { x: 0, y: -Math.sin(pitch), z: -Math.cos(pitch) },
        { x: 0, y: Math.cos(pitch), z: -Math.sin(pitch) },
      )
      expect(Math.abs(heading)).toBeLessThan(1e-6)
    }
  })

  it('still tracks yaw while pitched steeply', () => {
    for (const yaw of [0.7, -1.3, 2.5]) {
      const pitch = 1.4
      // A head yawed then pitched: R_y(yaw) · R_x(-pitch).
      const forward = {
        x: -Math.sin(yaw) * Math.cos(pitch),
        y: -Math.sin(pitch),
        z: -Math.cos(yaw) * Math.cos(pitch),
      }
      const up = {
        x: -Math.sin(yaw) * Math.sin(pitch),
        y: Math.cos(pitch),
        z: -Math.cos(yaw) * Math.sin(pitch),
      }
      expect(headingFromBasis(forward, up)).toBeCloseTo(yaw, 5)
    }
  })

  it('returns 0 rather than NaN for a degenerate basis', () => {
    expect(headingFromBasis({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })).toBe(0)
  })
})

describe('snapTurn', () => {
  const step = Math.PI / 6

  it('turns once per flick, however long the stick is held', () => {
    const latch = createTurnLatch()
    expect(snapTurn(latch, 1, step)).toBeCloseTo(-step, 6)
    // This is the bug the latch exists to prevent: sixty snaps a second while held.
    for (let i = 0; i < 60; i++) expect(snapTurn(latch, 1, step)).toBe(0)
  })

  it('re-arms only after the stick returns near centre', () => {
    const latch = createTurnLatch()
    snapTurn(latch, 1, step)
    // Still past the release threshold — must not re-arm.
    expect(snapTurn(latch, SNAP_TURN_RELEASE + 0.05, step)).toBe(0)
    expect(snapTurn(latch, 0, step)).toBe(0)
    expect(snapTurn(latch, 1, step)).toBeCloseTo(-step, 6)
  })

  it('does not chatter on a noisy stick resting between the thresholds', () => {
    const latch = createTurnLatch()
    const between = (SNAP_TURN_ENGAGE + SNAP_TURN_RELEASE) / 2
    for (let i = 0; i < 20; i++) {
      expect(snapTurn(latch, between + (i % 2 ? 0.01 : -0.01), step)).toBe(0)
    }
  })

  it('turns right for a right push and left for a left push', () => {
    expect(snapTurn(createTurnLatch(), 1, step)).toBeLessThan(0)
    expect(snapTurn(createTurnLatch(), -1, step)).toBeGreaterThan(0)
  })

  it('ignores deflection below the engage threshold', () => {
    const latch = createTurnLatch()
    expect(snapTurn(latch, SNAP_TURN_ENGAGE - 0.01, step)).toBe(0)
    expect(latch.armed).toBe(true)
  })
})

describe('smoothTurn', () => {
  it('scales with time so the rate is the same at any step size', () => {
    const oneBigStep = smoothTurn(1, 90, 0.1)
    let manySmallSteps = 0
    for (let i = 0; i < 10; i++) manySmallSteps += smoothTurn(1, 90, 0.01)
    expect(manySmallSteps).toBeCloseTo(oneBigStep, 6)
  })

  it('shares the sign convention with snapTurn', () => {
    expect(Math.sign(smoothTurn(1, 90, 0.016))).toBe(
      Math.sign(snapTurn(createTurnLatch(), 1, 0.5)),
    )
  })
})

describe('integrateVertical', () => {
  const dt = 1 / 60

  it('holds the character down when grounded', () => {
    const state = { velocity: 0 }
    // A grounded character with exactly zero velocity flickers between grounded and
    // airborne, because ground detection works by trying to move into the floor.
    for (let i = 0; i < 10; i++) {
      expect(integrateVertical(state, true, false, dt)).toBeLessThan(0)
    }
  })

  it('launches on a jump and comes back down', () => {
    const state = { velocity: 0 }
    expect(integrateVertical(state, true, true, dt)).toBeGreaterThan(0)

    let apexReached = false
    for (let i = 0; i < 200 && !apexReached; i++) {
      if (integrateVertical(state, false, false, dt) <= 0) apexReached = true
    }
    expect(apexReached).toBe(true)
  })

  it('ignores a jump requested in mid-air', () => {
    const state = { velocity: 0 }
    integrateVertical(state, true, true, dt)
    const rising = state.velocity
    integrateVertical(state, false, true, dt)
    expect(state.velocity).toBeLessThan(rising)
  })

  it('caps falling speed so a long drop cannot tunnel the floor', () => {
    const state = { velocity: 0 }
    for (let i = 0; i < 1000; i++) integrateVertical(state, false, false, dt)
    expect(state.velocity).toBe(DEFAULT_VERTICAL.terminalVelocity)
  })

  it('lands: touching down resets the accumulated fall speed', () => {
    const state = { velocity: 0 }
    for (let i = 0; i < 100; i++) integrateVertical(state, false, false, dt)
    expect(state.velocity).toBeLessThan(-5)
    integrateVertical(state, true, false, dt)
    expect(state.velocity).toBe(-1)
  })
})

describe('vignetteTarget', () => {
  it('is off when standing still', () => {
    expect(vignetteTarget(0, 3, false, 1)).toBe(0)
  })

  it('reaches full strength at full speed', () => {
    expect(vignetteTarget(3, 3, false, 1)).toBeCloseTo(1, 6)
  })

  it('is fully on while turning regardless of speed', () => {
    // Rotation causes far more vection than translation, so it gets no ramp.
    expect(vignetteTarget(0, 3, true, 1)).toBeCloseTo(1, 6)
  })

  it('scales with the player setting, and 0 disables it entirely', () => {
    expect(vignetteTarget(3, 3, true, 0.5)).toBeCloseTo(0.5, 6)
    expect(vignetteTarget(3, 3, true, 0)).toBe(0)
  })

  it('never exceeds the configured strength', () => {
    expect(vignetteTarget(99, 3, true, 0.8)).toBeCloseTo(0.8, 6)
  })
})

describe('damp', () => {
  it('closes half the distance in one half-life', () => {
    expect(damp(0, 1, 0.1, 0.1)).toBeCloseTo(0.5, 6)
  })

  it('is frame-rate independent', () => {
    const oneStep = damp(0, 1, 0.1, 0.1)
    let value = 0
    for (let i = 0; i < 10; i++) value = damp(value, 1, 0.1, 0.01)
    expect(value).toBeCloseTo(oneStep, 6)
  })

  it('snaps immediately at a zero half-life', () => {
    expect(damp(0, 1, 0, 0.016)).toBe(1)
  })
})

describe('sampleArc', () => {
  const origin: Vec3 = { x: 0, y: 1.2, z: 0 }

  it('starts at the origin', () => {
    expect(sampleArc(origin, { x: 0, y: 0, z: -1 })[0]).toEqual(origin)
  })

  it('falls: a level launch only ever loses height', () => {
    const heights = sampleArc(origin, { x: 0, y: 0, z: -1 }).map((p) => p.y)
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]).toBeLessThan(heights[i - 1]!)
    }
  })

  it('rises then falls when aimed upward', () => {
    const heights = sampleArc(origin, { x: 0, y: 0.6, z: -0.8 }).map((p) => p.y)
    const apex = heights.indexOf(Math.max(...heights))
    expect(apex).toBeGreaterThan(0)
    expect(apex).toBeLessThan(heights.length - 1)
  })

  it('travels in the direction it is pointed', () => {
    const last = sampleArc(origin, { x: 1, y: 0, z: 0 }).at(-1)!
    expect(last.x).toBeGreaterThan(0)
    expect(last.z).toBeCloseTo(0, 6)
  })
})

describe('findArcHit', () => {
  const points: Vec3[] = [
    { x: 0, y: 2, z: 0 },
    { x: 0, y: 1.5, z: -1 },
    { x: 0, y: 0.5, z: -2 },
    { x: 0, y: -0.5, z: -3 },
  ]

  it('returns the first hit along the arc, not the nearest or the last', () => {
    const hit = findArcHit(points, (_from, to) =>
      to.y < 1.6 ? { point: to, normal: { x: 0, y: 1, z: 0 } } : null,
    )
    expect(hit?.segment).toBe(0)
    expect(hit?.point).toEqual(points[1])
  })

  it('returns null when the arc hits nothing', () => {
    expect(findArcHit(points, () => null)).toBeNull()
  })

  it('casts every segment in order until one connects', () => {
    const seen: number[] = []
    findArcHit(points, (from) => {
      seen.push(from.y)
      return null
    })
    expect(seen).toEqual([2, 1.5, 0.5])
  })
})

describe('isValidLanding', () => {
  it('accepts a flat floor', () => {
    expect(isValidLanding({ x: 0, y: 1, z: 0 })).toBe(true)
  })

  it('rejects a wall', () => {
    expect(isValidLanding({ x: 1, y: 0, z: 0 })).toBe(false)
  })

  it('rejects a ceiling', () => {
    expect(isValidLanding({ x: 0, y: -1, z: 0 })).toBe(false)
  })

  it('accepts just inside the slope limit and rejects just outside', () => {
    const at = (deg: number): Vec3 => ({
      x: Math.sin((deg * Math.PI) / 180),
      y: Math.cos((deg * Math.PI) / 180),
      z: 0,
    })
    expect(isValidLanding(at(44), 45)).toBe(true)
    expect(isValidLanding(at(46), 45)).toBe(false)
  })

  it('handles an unnormalised normal', () => {
    expect(isValidLanding({ x: 0, y: 7, z: 0 })).toBe(true)
  })

  it('rejects a zero normal rather than dividing by zero', () => {
    expect(isValidLanding({ x: 0, y: 0, z: 0 })).toBe(false)
  })
})
