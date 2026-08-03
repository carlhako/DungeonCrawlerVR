import { describe, expect, it } from 'vitest'
import {
  blendSteering,
  followPath,
  headingOf,
  resolveMove,
  separation,
  turnTowards,
  type Standable,
} from './steering'

/** A room with a wall down the middle at x = 0, open everywhere else. */
const splitRoom: Standable = (x) => x < -0.5 || x > 0.5

describe('followPath', () => {
  it('walks towards the first waypoint it has not reached', () => {
    const path = [
      { x: 2, z: 0 },
      { x: 4, z: 0 },
    ]
    const along = followPath({ x: 0, z: 0 }, path, 0, 0.45)
    expect(along.index).toBe(0)
    expect(along.x).toBeCloseTo(1, 6)
    expect(along.z).toBeCloseTo(0, 6)
  })

  it('returns a unit direction, whatever the distance', () => {
    const along = followPath({ x: 0, z: 0 }, [{ x: 30, z: 40 }], 0, 0.45)
    expect(Math.hypot(along.x, along.z)).toBeCloseTo(1, 6)
  })

  it('skips waypoints it is already standing on', () => {
    // Chasing waypoint centres exactly makes a body stop dead at every corner of an L-shaped
    // corridor; the tolerance is what turns a staircase of grid cells back into a walk.
    const path = [
      { x: 0.1, z: 0 },
      { x: 0.2, z: 0 },
      { x: 5, z: 0 },
    ]
    const along = followPath({ x: 0, z: 0 }, path, 0, 0.45)
    expect(along.index).toBe(2)
  })

  it('never goes backwards along the path', () => {
    const path = [
      { x: 1, z: 0 },
      { x: 2, z: 0 },
    ]
    // Standing on the first waypoint again, but already past it.
    const along = followPath({ x: 1, z: 0 }, path, 1, 0.45)
    expect(along.index).toBe(1)
  })

  it('says nothing at the end of the path', () => {
    const along = followPath({ x: 5, z: 0 }, [{ x: 5, z: 0 }], 0, 0.45)
    expect(along).toEqual({ x: 0, z: 0, index: 1 })
  })

  it('says nothing when there is no path at all', () => {
    expect(followPath({ x: 0, z: 0 }, [], 0, 0.45)).toEqual({ x: 0, z: 0, index: 0 })
  })
})

describe('separation', () => {
  it('is nothing when nobody is close', () => {
    const push = separation({ x: 0, z: 0 }, 0.4, [{ x: 10, z: 0, radius: 0.4 }])
    expect(push).toEqual({ x: 0, z: 0 })
  })

  it('pushes directly away from a neighbour', () => {
    const push = separation({ x: 0, z: 0 }, 0.4, [{ x: 0.5, z: 0, radius: 0.4 }])
    expect(push.x).toBeLessThan(0)
    expect(push.z).toBeCloseTo(0, 6)
  })

  it('pushes harder the closer it gets', () => {
    const near = separation({ x: 0, z: 0 }, 0.4, [{ x: 0.2, z: 0, radius: 0.4 }])
    const far = separation({ x: 0, z: 0 }, 0.4, [{ x: 0.7, z: 0, radius: 0.4 }])
    expect(Math.abs(near.x)).toBeGreaterThan(Math.abs(far.x))
  })

  it('is capped, so a body wedged in a crowd is shoved rather than launched', () => {
    const crowd = Array.from({ length: 8 }, (_, i) => ({
      x: Math.cos((i / 8) * Math.PI * 2) * 0.05,
      z: Math.sin((i / 8) * Math.PI * 2) * 0.05,
      radius: 0.4,
    }))
    const push = separation({ x: 0, z: 0 }, 0.4, crowd)
    expect(Math.hypot(push.x, push.z)).toBeLessThanOrEqual(1 + 1e-9)
  })

  it('picks a direction even for two bodies in exactly the same place', () => {
    // Which happens when the director puts two enemies on one spawn cell. Any answer will
    // do; NaN will not.
    const push = separation({ x: 3, z: 3 }, 0.4, [{ x: 3, z: 3, radius: 0.4 }])
    expect(Number.isFinite(push.x)).toBe(true)
    expect(Number.isFinite(push.z)).toBe(true)
    expect(Math.hypot(push.x, push.z)).toBeGreaterThan(0)
  })
})

describe('blendSteering', () => {
  it('returns a unit heading', () => {
    const steer = blendSteering({ x: 1, z: 0 }, { x: 0, z: 1 }, 0.85)
    expect(Math.hypot(steer.x, steer.z)).toBeCloseTo(1, 6)
  })

  it('lets the path win', () => {
    // Separation is a correction, not a goal: weight them equally and a crowded fight becomes
    // everything orbiting the player instead of reaching them.
    const steer = blendSteering({ x: 1, z: 0 }, { x: 0, z: 1 }, 0.85)
    expect(steer.x).toBeGreaterThan(steer.z)
  })

  it('gives up rather than returning NaN when they cancel out', () => {
    expect(blendSteering({ x: 1, z: 0 }, { x: -1, z: 0 }, 1)).toEqual({ x: 0, z: 0 })
  })
})

describe('resolveMove', () => {
  it('takes the whole step when nothing is in the way', () => {
    expect(resolveMove({ x: -3, z: 0 }, 0.5, 0.25, 0.3, splitRoom)).toEqual({
      x: -2.5,
      z: 0.25,
    })
  })

  it('refuses to walk into a wall', () => {
    const moved = resolveMove({ x: -1, z: 0 }, 1, 0, 0.3, splitRoom)
    expect(moved).toEqual({ x: -1, z: 0 })
  })

  it('slides along a wall approached at an angle', () => {
    // Without the axis fallbacks a body walking diagonally into a corridor wall stops dead and
    // stays there, which reads as the pathfinder giving up rather than as a collision.
    const moved = resolveMove({ x: -1, z: 0 }, 1, 0.4, 0.3, splitRoom)
    expect(moved.x).toBe(-1)
    expect(moved.z).toBeCloseTo(0.4, 6)
  })

  it('accounts for the width of the body, not just its centre', () => {
    // Landing at x = -0.6 puts the centre clear of the wall's face at -0.5, but a body 0.3
    // wide reaches -0.3, which is inside it.
    expect(splitRoom(-0.6, 0)).toBe(true)
    const moved = resolveMove({ x: -1.5, z: 0 }, 0.9, 0, 0.3, splitRoom)
    expect(moved.x).toBe(-1.5)
  })

  it('stands still rather than moving into rock on either axis', () => {
    const boxed: Standable = () => false
    expect(resolveMove({ x: 0, z: 0 }, 1, 1, 0.3, boxed)).toEqual({ x: 0, z: 0 })
  })
})

describe('turnTowards', () => {
  it('reaches the target when it is within one step', () => {
    expect(turnTowards(0, 0.05, 0.1)).toBeCloseTo(0.05, 6)
  })

  it('is rate-limited, so nothing snaps round like a turret', () => {
    expect(turnTowards(0, 3, 0.1)).toBeCloseTo(0.1, 6)
  })

  it('takes the short way round the wrap', () => {
    // Without this a body turning past ±π spins most of a full circle to make a few degrees
    // of correction, which looks exactly as broken as it sounds.
    const turned = turnTowards(Math.PI - 0.05, -Math.PI + 0.05, 0.05)
    expect(turned).toBeGreaterThan(Math.PI - 0.05)
  })
})

describe('headingOf', () => {
  it('faces -Z at yaw zero, like everything else in three.js', () => {
    expect(headingOf(0, -1)).toBeCloseTo(0, 6)
  })

  it('is a quarter turn to face -X', () => {
    expect(Math.abs(headingOf(-1, 0))).toBeCloseTo(Math.PI / 2, 6)
  })

  it('round-trips: facing a direction and walking forwards goes that way', () => {
    for (const [x, z] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0.6, -0.8],
    ] as const) {
      const yaw = headingOf(x, z)
      // An object at yaw θ points along (-sin θ, -cos θ).
      expect(-Math.sin(yaw)).toBeCloseTo(x, 6)
      expect(-Math.cos(yaw)).toBeCloseTo(z, 6)
    }
  })
})
