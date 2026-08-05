import { describe, expect, it } from 'vitest'
import { clampArmReach, combineHandMovement, gorillaHandOffset, type Vec3 } from './locomotion'

/**
 * Gorilla-mode math, ported from Another Axiom's `Player.cs`. Three contracts:
 *
 * - `gorillaHandOffset` moves the body by however far a touching hand has strayed from the
 *   world point it is stuck to, inverted — measured from the established anchor if the hand
 *   was already touching, or from the fresh contact point if it just landed.
 * - `combineHandMovement` averages two hands in contact and sums otherwise.
 * - `clampArmReach` keeps a hand within arm's length of the head.
 *
 * The maths is what fails first when the implementation drifts. The anchor rule in
 * particular is easy to "simplify" into a frame-to-frame delta, which looks equivalent for
 * one step and then quietly loses every bit of motion the body itself absorbed.
 */

describe('gorillaHandOffset', () => {
  it('moves the body opposite to how far the hand strayed from its anchor', () => {
    const anchor: Vec3 = { x: 0, y: 1, z: 0 }
    const current: Vec3 = { x: 0.3, y: 1, z: -0.2 }
    const result = gorillaHandOffset(anchor, current, anchor, true)
    expect(result.x).toBeCloseTo(-0.3, 9)
    expect(result.y).toBeCloseTo(0, 9)
    expect(result.z).toBeCloseTo(0.2, 9)
  })

  it('measures from the contact point on the step the hand lands, not from the anchor', () => {
    // The hand swept from its old anchor and stopped part-way at the surface. Only the
    // motion after that contact should move the body — the part before it happened in
    // mid-air and must not count.
    const anchor: Vec3 = { x: 0, y: 1, z: 0 }
    const contact: Vec3 = { x: 0.4, y: 1, z: 0 }
    const current: Vec3 = { x: 0.5, y: 1, z: 0 }
    const result = gorillaHandOffset(anchor, current, contact, false)
    expect(result.x).toBeCloseTo(-0.1, 9)
  })

  it('measures from the anchor once the hand is established, ignoring the contact point', () => {
    const anchor: Vec3 = { x: 0, y: 1, z: 0 }
    const contact: Vec3 = { x: 0.4, y: 1, z: 0 }
    const current: Vec3 = { x: 0.5, y: 1, z: 0 }
    const result = gorillaHandOffset(anchor, current, contact, true)
    expect(result.x).toBeCloseTo(-0.5, 9)
  })

  it('accumulates across steps — a hand held still while the body moves keeps pulling', () => {
    // This is what a frame-to-frame delta gets wrong. The hand is stationary in world space
    // but the anchor is behind it, so the body is still being dragged towards the anchor.
    const anchor: Vec3 = { x: 0, y: 1, z: 0 }
    const current: Vec3 = { x: 0.25, y: 1, z: 0 }
    const first = gorillaHandOffset(anchor, current, anchor, true)
    const second = gorillaHandOffset(anchor, current, anchor, true)
    expect(first.x).toBeCloseTo(-0.25, 9)
    expect(second.x).toBeCloseTo(-0.25, 9)
  })

  it('is zero when the hand sits exactly on its anchor', () => {
    const anchor: Vec3 = { x: 0.4, y: 0.4, z: 0.4 }
    const result = gorillaHandOffset(anchor, anchor, anchor, true)
    expect(result.x).toBeCloseTo(0, 9)
    expect(result.y).toBeCloseTo(0, 9)
    expect(result.z).toBeCloseTo(0, 9)
  })

  it('pulls the body upward when a hand is pulled down — the climb', () => {
    const anchor: Vec3 = { x: 0, y: 2, z: 0 }
    const current: Vec3 = { x: 0, y: 1.5, z: 0 }
    const result = gorillaHandOffset(anchor, current, anchor, true)
    expect(result.y).toBeCloseTo(0.5, 9)
  })
})

describe('combineHandMovement', () => {
  const left: Vec3 = { x: -0.2, y: 0.1, z: 0 }
  const right: Vec3 = { x: -0.4, y: 0.3, z: 0 }

  it('averages when both hands are in contact', () => {
    // Two hands on the same wall each ask for the full movement. Summing would move the body
    // twice as far as either hand actually pulled.
    const result = combineHandMovement(left, right, true)
    expect(result.x).toBeCloseTo(-0.3, 9)
    expect(result.y).toBeCloseTo(0.2, 9)
    expect(result.z).toBeCloseTo(0, 9)
  })

  it('sums when only one hand is in contact', () => {
    // The free hand contributes an exact zero; averaging it in would silently halve the
    // working hand's pull, so one-handed movement would be half speed for no stated reason.
    const result = combineHandMovement(left, { x: 0, y: 0, z: 0 }, false)
    expect(result.x).toBeCloseTo(-0.2, 9)
    expect(result.y).toBeCloseTo(0.1, 9)
  })

  it('is zero when neither hand contributes', () => {
    const result = combineHandMovement({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, false)
    expect(result).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('two hands pulling identically move the body by that amount, not double', () => {
    const result = combineHandMovement(left, left, true)
    expect(result.x).toBeCloseTo(left.x, 9)
    expect(result.y).toBeCloseTo(left.y, 9)
  })
})

describe('clampArmReach', () => {
  const head: Vec3 = { x: 0, y: 1.6, z: 0 }

  it('leaves a hand within reach exactly where it is', () => {
    const hand: Vec3 = { x: 0.3, y: 1.4, z: -0.2 }
    expect(clampArmReach(hand, head, 1.5)).toEqual(hand)
  })

  it('pulls a hand beyond reach back onto the end of the arm', () => {
    const hand: Vec3 = { x: 5, y: 1.6, z: 0 }
    const result = clampArmReach(hand, head, 1.5)
    expect(result.x).toBeCloseTo(1.5, 9)
    expect(result.y).toBeCloseTo(1.6, 9)
    expect(result.z).toBeCloseTo(0, 9)
  })

  it('keeps the direction to the hand, only the distance changes', () => {
    const hand: Vec3 = { x: 3, y: 1.6 + 4, z: 0 }
    const result = clampArmReach(hand, head, 1.5)
    const distance = Math.hypot(result.x - head.x, result.y - head.y, result.z - head.z)
    expect(distance).toBeCloseTo(1.5, 9)
    // Same 3-4-5 direction as the unclamped hand.
    expect((result.x - head.x) / (result.y - head.y)).toBeCloseTo(3 / 4, 9)
  })

  it('returns the head position, not NaN, for a hand exactly at the head', () => {
    const result = clampArmReach(head, head, 1.5)
    expect(result).toEqual(head)
  })
})
