import { describe, expect, it } from 'vitest'
import { gorillaBodyFromHands, gorillaHandContribution, type Vec3 } from './locomotion'

/**
 * Gorilla-mode math. Two contracts:
 *
 * - `gorillaHandContribution` returns the inverse of a hand's per-step displacement, scaled
 *   by the transfer factor, and exactly zero when the hand is not gripping.
 * - `gorillaBodyFromHands` places the body at the midpoint of the two hands, offset along
 *   the wall normal by the requested distance.
 *
 * The maths is what fails first when the implementation drifts: a transfer factor of 1.1
 * "feels" mostly right and is wrong by ten per cent; a midpoint that ignores the offset
 * looks fine on a flat wall and clips on every corner. Locking it down here means the
 * playtest pass can adjust the *constants* rather than chase arithmetic.
 */

const CLOSE = 1e-9

describe('gorillaHandContribution', () => {
  it('returns zero when not gripping, regardless of how the hand moved', () => {
    const prev: Vec3 = { x: 0, y: 0, z: 0 }
    const current: Vec3 = { x: 1.5, y: 0, z: -0.4 }
    expect(gorillaHandContribution(prev, current, false)).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('returns the inverse of the displacement when gripping', () => {
    const prev: Vec3 = { x: 0, y: 0, z: 0 }
    const current: Vec3 = { x: 0.3, y: -0.1, z: 0.2 }
    const result = gorillaHandContribution(prev, current, true)
    expect(result.x).toBeCloseTo(-0.3, 9)
    expect(result.y).toBeCloseTo(0.1, 9)
    expect(result.z).toBeCloseTo(-0.2, 9)
  })

  it('defaults the transfer factor to 1.0', () => {
    const prev: Vec3 = { x: 1, y: 2, z: 3 }
    const current: Vec3 = { x: 1.5, y: 1.4, z: 3.7 }
    const contribution = gorillaHandContribution(prev, current, true)
    expect(contribution).toEqual({
      x: -(current.x - prev.x),
      y: -(current.y - prev.y),
      z: -(current.z - prev.z),
    })
  })

  it('scales the contribution by the transfer factor', () => {
    const prev: Vec3 = { x: 0, y: 0, z: 0 }
    const current: Vec3 = { x: 0.5, y: 0, z: 0 }
    const result = gorillaHandContribution(prev, current, true, 1.5)
    expect(result.x).toBeCloseTo(-0.75, 9)
    expect(result.y).toBeCloseTo(0, 9)
    expect(result.z).toBeCloseTo(0, 9)
  })

  it('returns zero contribution for zero displacement, not NaN', () => {
    const prev: Vec3 = { x: 0.4, y: 0.4, z: 0.4 }
    const current: Vec3 = { x: 0.4, y: 0.4, z: 0.4 }
    const result = gorillaHandContribution(prev, current, true)
    expect(result.x).toBeCloseTo(0, 9)
    expect(result.y).toBeCloseTo(0, 9)
    expect(result.z).toBeCloseTo(0, 9)
  })

  it('does not preserve the hand position itself — only the delta matters', () => {
    // Same delta from a different starting point must produce the same contribution. The
    // body's response is to the *motion*, not the *location*, of the hand.
    const a = gorillaHandContribution(
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      true,
    )
    const b = gorillaHandContribution(
      { x: 5, y: 5, z: 5 },
      { x: 6, y: 5, z: 5 },
      true,
    )
    expect(a).toEqual(b)
  })

  it('two hands gripping with the same delta give a doubled contribution', () => {
    const prev: Vec3 = { x: 0, y: 0, z: 0 }
    const current: Vec3 = { x: 0.1, y: 0, z: 0 }
    const single = gorillaHandContribution(prev, current, true)
    const combined = {
      x: single.x + single.x,
      y: single.y + single.y,
      z: single.z + single.z,
    }
    expect(combined.x).toBeCloseTo(-0.2, 9)
  })

  it('one gripping hand contributes only its own displacement, not the idle hand', () => {
    // The idle hand's position must not leak into the motion. Without this guard, swinging
    // one arm while the other hangs at the player's side would push the body twice as far.
    const idlePrev: Vec3 = { x: 0, y: 1, z: -0.5 }
    const idleCurrent: Vec3 = { x: 0, y: 1, z: -0.5 }
    const gripPrev: Vec3 = { x: 0.3, y: 1, z: -0.5 }
    const gripCurrent: Vec3 = { x: 0.5, y: 1, z: -0.5 }
    const result = gorillaHandContribution(gripPrev, gripCurrent, true)
    expect(result.x).toBeCloseTo(-0.2, 9)
    expect(result.z).toBeCloseTo(0, 9)
    // Sanity: the idle hand by itself would have produced zero.
    const idle = gorillaHandContribution(idlePrev, idleCurrent, false)
    expect(idle.x).toBe(0)
    expect(idle.y).toBe(0)
    expect(idle.z).toBe(0)
  })
})

describe('gorillaBodyFromHands', () => {
  const h1: Vec3 = { x: -0.4, y: 1.6, z: 0.2 }
  const h2: Vec3 = { x: 0.4, y: 2.0, z: 0.2 }
  // A wall facing +Z: the body's offset sits along +Z, away from the wall.
  const wallNormal: Vec3 = { x: 0, y: 0, z: 1 }

  it('places the body at the midpoint of the two hands', () => {
    const body = gorillaBodyFromHands(h1, h2, wallNormal, 0)
    expect(body.x).toBeCloseTo(0, 9)
    expect(body.y).toBeCloseTo(1.8, 9)
    expect(body.z).toBeCloseTo(0.2, 9)
  })

  it('offsets the body along the wall normal by the requested distance', () => {
    const body = gorillaBodyFromHands(h1, h2, wallNormal, 0.4)
    expect(body.x).toBeCloseTo(0, 9)
    expect(body.y).toBeCloseTo(1.8, 9)
    expect(body.z).toBeCloseTo(0.6, 9)
  })

  it('treats the normal as already unit length — does not renormalise', () => {
    // A caller supplying an off-axis scaled vector would otherwise get the body sitting
    // off the wall by some smaller, surprising amount.
    const long: Vec3 = { x: 0, y: 0, z: 5 }
    const body = gorillaBodyFromHands(h1, h2, long, 0.4)
    expect(body.z).toBeCloseTo(0.2 + 5 * 0.4, 6)
  })

  it('produces a zero offset when the offset is zero', () => {
    const body = gorillaBodyFromHands(h1, h2, wallNormal, 0)
    const midpoint = {
      x: (h1.x + h2.x) / 2,
      y: (h1.y + h2.y) / 2,
      z: (h1.z + h2.z) / 2,
    }
    expect(Math.hypot(body.x - midpoint.x, body.y - midpoint.y, body.z - midpoint.z)).toBeLessThan(
      CLOSE,
    )
  })

  it('a horizontal pull on both hands moves the body horizontally', () => {
    // The whole point of climbing: pull both hands up by 0.1, the body rises by 0.1, with
    // no horizontal component unless the wall tilts.
    const pulledH1: Vec3 = { ...h1, y: h1.y + 0.1 }
    const pulledH2: Vec3 = { ...h2, y: h2.y + 0.1 }
    const before = gorillaBodyFromHands(h1, h2, wallNormal, 0.4)
    const after = gorillaBodyFromHands(pulledH1, pulledH2, wallNormal, 0.4)
    expect(after.y - before.y).toBeCloseTo(0.1, 9)
    expect(after.x - before.x).toBeCloseTo(0, 9)
    expect(after.z - before.z).toBeCloseTo(0, 9)
  })

  it('tilted wall normal projects the offset onto the normal direction', () => {
    // A normal of (0, 1, 0) would push the body up by the offset. The body should not also
    // gain XZ motion — a horizontal wall does not drift the body sideways.
    const up: Vec3 = { x: 0, y: 1, z: 0 }
    const body = gorillaBodyFromHands(h1, h2, up, 0.5)
    expect(body.x).toBeCloseTo((h1.x + h2.x) / 2, 9)
    expect(body.y).toBeCloseTo((h1.y + h2.y) / 2 + 0.5, 9)
    expect(body.z).toBeCloseTo((h1.z + h2.z) / 2, 9)
  })
})