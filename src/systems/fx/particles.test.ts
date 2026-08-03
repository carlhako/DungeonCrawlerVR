import { describe, expect, it } from 'vitest'
import {
  activeParticles,
  clearParticles,
  createParticlePool,
  hexToRgb,
  particleScale,
  spawnBurst,
  spawnParticle,
  stepParticles,
} from '@/systems/fx/particles'

/** A deterministic stand-in for `Math.random`, cycling a fixed sequence. */
function sequence(values: number[]): () => number {
  let index = 0
  return () => values[index++ % values.length]!
}

const ORIGIN = { x: 1, y: 2, z: 3 }
const WHITE = { r: 1, g: 1, b: 1 }

describe('particle pool', () => {
  it('spawns into free slots and reports how many are live', () => {
    const pool = createParticlePool(4)
    expect(activeParticles(pool)).toBe(0)

    spawnParticle(pool, { origin: ORIGIN, vx: 0, vy: 0, vz: 0, life: 1, size: 0.1, colour: WHITE })
    spawnParticle(pool, { origin: ORIGIN, vx: 0, vy: 0, vz: 0, life: 1, size: 0.1, colour: WHITE })

    expect(activeParticles(pool)).toBe(2)
  })

  it('never grows past capacity, and steals the oldest slot instead', () => {
    const pool = createParticlePool(3)
    for (let i = 0; i < 10; i += 1) {
      spawnParticle(pool, { origin: ORIGIN, vx: 0, vy: 0, vz: 0, life: 1, size: 0.1, colour: WHITE })
    }

    expect(pool.items).toHaveLength(3)
    expect(activeParticles(pool)).toBe(3)
  })

  it('recycles round-robin rather than always reusing slot 0', () => {
    const pool = createParticlePool(3)
    for (let i = 0; i < 3; i += 1) {
      spawnParticle(pool, { origin: ORIGIN, vx: 0, vy: 0, vz: 0, life: 1, size: 0.1, colour: WHITE })
    }

    // The pool is full; the next four steals should walk the slots in order.
    const stolen = [0, 1, 2, 3].map(
      () =>
        spawnParticle(pool, {
          origin: ORIGIN,
          vx: 0,
          vy: 0,
          vz: 0,
          life: 1,
          size: 0.1,
          colour: WHITE,
        }).slot,
    )

    expect(stolen).toEqual([0, 1, 2, 0])
  })

  it('retires a particle exactly when its life runs out', () => {
    const pool = createParticlePool(2)
    spawnParticle(pool, { origin: ORIGIN, vx: 0, vy: 0, vz: 0, life: 0.1, size: 0.1, colour: WHITE })

    stepParticles(pool, 0.05)
    expect(activeParticles(pool)).toBe(1)

    stepParticles(pool, 0.05)
    expect(activeParticles(pool)).toBe(0)
  })

  it('integrates velocity, gravity and drag', () => {
    const pool = createParticlePool(1)
    spawnParticle(pool, {
      origin: { x: 0, y: 0, z: 0 },
      vx: 2,
      vy: 0,
      vz: 0,
      life: 10,
      size: 0.1,
      colour: WHITE,
      gravity: 10,
      drag: 1,
    })

    stepParticles(pool, 0.5)
    const particle = pool.items[0]!

    // Drag first (2 → 1 m/s), then gravity, then the move.
    expect(particle.vx).toBeCloseTo(1, 6)
    expect(particle.x).toBeCloseTo(0.5, 6)
    expect(particle.vy).toBeCloseTo(-5, 6)
    expect(particle.y).toBeCloseTo(-2.5, 6)
  })

  it('a burst puts every particle inside the requested speed range', () => {
    const pool = createParticlePool(32)
    spawnBurst(
      pool,
      {
        origin: ORIGIN,
        direction: { x: 0, y: 1, z: 0 },
        spread: 1,
        count: 12,
        speedMin: 2,
        speedMax: 4,
        lifeMin: 0.2,
        lifeMax: 0.5,
        size: 0.02,
        colour: WHITE,
      },
      sequence([0.1, 0.35, 0.62, 0.8, 0.05, 0.5]),
    )

    expect(activeParticles(pool)).toBe(12)
    for (const particle of pool.items) {
      if (!particle.active) continue
      const speed = Math.hypot(particle.vx, particle.vy, particle.vz)
      expect(speed).toBeGreaterThanOrEqual(2 - 1e-9)
      expect(speed).toBeLessThanOrEqual(4 + 1e-9)
      expect(particle.life).toBeGreaterThanOrEqual(0.2)
      expect(particle.life).toBeLessThanOrEqual(0.5)
    }
  })

  it('a zero-spread burst throws everything along its direction', () => {
    const pool = createParticlePool(8)
    spawnBurst(
      pool,
      {
        origin: ORIGIN,
        direction: { x: 0, y: 0, z: -2 },
        spread: 0,
        count: 4,
        speedMin: 3,
        speedMax: 3,
        lifeMin: 0.2,
        lifeMax: 0.2,
        size: 0.02,
        colour: WHITE,
      },
      sequence([0.2, 0.7, 0.4, 0.9]),
    )

    for (const particle of pool.items) {
      if (!particle.active) continue
      expect(particle.vx).toBeCloseTo(0, 6)
      expect(particle.vy).toBeCloseTo(0, 6)
      expect(particle.vz).toBeCloseTo(-3, 6)
    }
  })

  it('a cone stays on the near side of its own direction', () => {
    const pool = createParticlePool(64)
    // Half spread: no particle should end up travelling backwards into the wall it came off.
    spawnBurst(
      pool,
      {
        origin: ORIGIN,
        direction: { x: 0, y: 1, z: 0 },
        spread: 0.45,
        count: 40,
        speedMin: 1,
        speedMax: 1,
        lifeMin: 0.2,
        lifeMax: 0.2,
        size: 0.02,
        colour: WHITE,
      },
      Math.random,
    )

    for (const particle of pool.items) {
      if (!particle.active) continue
      expect(particle.vy).toBeGreaterThan(0)
    }
  })

  it('a burst with no direction sprays evenly regardless of the spread asked for', () => {
    const pool = createParticlePool(64)
    spawnBurst(
      pool,
      {
        origin: ORIGIN,
        direction: { x: 0, y: 0, z: 0 },
        spread: 0,
        count: 40,
        speedMin: 1,
        speedMax: 1,
        lifeMin: 0.2,
        lifeMax: 0.2,
        size: 0.02,
        colour: WHITE,
      },
      Math.random,
    )

    // A zero direction with zero spread would otherwise leave every particle stationary at
    // the impact point, which reads as the effect not firing at all.
    let up = 0
    let down = 0
    for (const particle of pool.items) {
      if (!particle.active) continue
      expect(Math.hypot(particle.vx, particle.vy, particle.vz)).toBeCloseTo(1, 6)
      if (particle.vy > 0) up += 1
      else down += 1
    }
    expect(up).toBeGreaterThan(0)
    expect(down).toBeGreaterThan(0)
  })

  it('shrinks to nothing over its life', () => {
    const pool = createParticlePool(1)
    spawnParticle(pool, { origin: ORIGIN, vx: 0, vy: 0, vz: 0, life: 1, size: 0.2, colour: WHITE })
    const particle = pool.items[0]!

    expect(particleScale(particle)).toBeCloseTo(0.2, 6)

    stepParticles(pool, 0.5)
    const middle = particleScale(particle)
    expect(middle).toBeLessThan(0.2)
    expect(middle).toBeGreaterThan(0)

    stepParticles(pool, 0.5)
    expect(particleScale(particle)).toBe(0)
  })

  it('clears everything and resets the cursor', () => {
    const pool = createParticlePool(4)
    for (let i = 0; i < 3; i += 1) {
      spawnParticle(pool, { origin: ORIGIN, vx: 0, vy: 0, vz: 0, life: 1, size: 0.1, colour: WHITE })
    }

    clearParticles(pool)

    expect(activeParticles(pool)).toBe(0)
    expect(pool.cursor).toBe(0)
  })
})

describe('hexToRgb', () => {
  it('parses a hex colour into 0..1 components', () => {
    expect(hexToRgb('#ffffff')).toEqual({ r: 1, g: 1, b: 1 })
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 })

    const fire = hexToRgb('#ff8a3c')
    expect(fire.r).toBeCloseTo(1, 6)
    expect(fire.g).toBeCloseTo(0x8a / 255, 6)
    expect(fire.b).toBeCloseTo(0x3c / 255, 6)
  })
})
