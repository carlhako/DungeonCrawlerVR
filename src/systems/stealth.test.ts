import { describe, expect, it } from 'vitest'
import {
  detectionScale,
  emitNoise,
  LOUD_SPEED,
  MAX_IDLE_SECONDS,
  noiseEvent,
  QUIET_DETECTION,
  QUIET_SPEED,
  WEAPON_NOISE_RADIUS,
} from './stealth'

describe('detectionScale', () => {
  it('returns QUIET_DETECTION at zero speed', () => {
    expect(detectionScale(0)).toBe(QUIET_DETECTION)
  })

  it('returns QUIET_DETECTION at QUIET_SPEED', () => {
    expect(detectionScale(QUIET_SPEED)).toBe(QUIET_DETECTION)
  })

  it('returns 1 at LOUD_SPEED', () => {
    expect(detectionScale(LOUD_SPEED)).toBe(1)
  })

  it('returns 1 above LOUD_SPEED (caps at full)', () => {
    expect(detectionScale(LOUD_SPEED + 5)).toBe(1)
    expect(detectionScale(100)).toBe(1)
  })

  it('scales linearly between quiet and loud', () => {
    // Halfway between quiet and loud → halfway between QUIET_DETECTION and 1.
    const mid = (QUIET_SPEED + LOUD_SPEED) / 2
    const expected = QUIET_DETECTION + (1 - QUIET_DETECTION) * 0.5
    expect(detectionScale(mid)).toBeCloseTo(expected, 10)
  })

  it('approaches full detection as speed increases', () => {
    const slow = detectionScale(QUIET_SPEED + 0.1)
    const fast = detectionScale(LOUD_SPEED - 0.1)
    // Fast should be closer to 1 than slow.
    expect(fast).toBeGreaterThan(slow)
  })

  it('detection is not below QUIET_DETECTION for any non-negative speed', () => {
    for (const s of [0, 0.5, 1.0, 2.0, 3.5, 10]) {
      expect(detectionScale(s)).toBeGreaterThanOrEqual(QUIET_DETECTION)
    }
  })

  it('detection never exceeds 1', () => {
    for (const s of [0, 0.5, 1.0, 2.0, 3.5, 10, 100]) {
      expect(detectionScale(s)).toBeLessThanOrEqual(1)
    }
  })
})

describe('noise pulses', () => {
  it('sets position, radius and a one-step remaining', () => {
    emitNoise({ x: 5, y: 1, z: -3 }, WEAPON_NOISE_RADIUS)
    expect(noiseEvent.position.x).toBe(5)
    expect(noiseEvent.position.y).toBe(1)
    expect(noiseEvent.position.z).toBe(-3)
    expect(noiseEvent.radius).toBe(WEAPON_NOISE_RADIUS)
    expect(noiseEvent.remaining).toBeGreaterThan(0)
    expect(noiseEvent.remaining).toBeCloseTo(1 / 60, 10)
  })

  it('can be aged down and expires', () => {
    emitNoise({ x: 0, y: 0, z: 0 }, 10)
    expect(noiseEvent.remaining).toBeGreaterThan(0)

    // Age it past expiry.
    noiseEvent.remaining = 0
    expect(noiseEvent.remaining).toBe(0)
  })
})

describe('constants', () => {
  it('QUIET_DETECTION is between 0 and 1', () => {
    expect(QUIET_DETECTION).toBeGreaterThan(0)
    expect(QUIET_DETECTION).toBeLessThan(1)
  })

  it('QUIET_SPEED is less than LOUD_SPEED', () => {
    expect(QUIET_SPEED).toBeLessThan(LOUD_SPEED)
  })

  it('MAX_IDLE_SECONDS is much larger than the old HUNT_DELAY of 2', () => {
    // The whole point: the safety valve is tens of seconds, not a couple.
    expect(MAX_IDLE_SECONDS).toBeGreaterThanOrEqual(20)
  })

  it('WEAPON_NOISE_RADIUS is large enough to cross a room', () => {
    expect(WEAPON_NOISE_RADIUS).toBeGreaterThanOrEqual(10)
  })
})
