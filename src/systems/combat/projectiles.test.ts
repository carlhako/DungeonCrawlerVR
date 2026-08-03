import { describe, expect, it } from 'vitest'
import type { Vec3 } from '@/systems/locomotion'
import {
  activeProjectiles,
  clearProjectiles,
  createProjectilePool,
  spawnProjectile,
  stepProjectiles,
  type ProjectileSpec,
} from './projectiles'

const STEP = 1 / 60

const SPEC: ProjectileSpec = {
  origin: { x: 0, y: 1.5, z: 0 },
  direction: { x: 0, y: 0, z: -1 },
  speed: 18,
  life: 3,
  base: 12,
  element: 'fire',
  critChance: 0,
  source: { kind: 'projectile', weaponId: 'emberwand', hand: 'main' },
}

/** No world at all: nothing is ever hit. */
const empty = () => null

describe('the pool', () => {
  it('reuses slots rather than allocating', () => {
    const pool = createProjectilePool(4)
    const first = spawnProjectile(pool, SPEC)
    first.active = false
    const second = spawnProjectile(pool, SPEC)
    expect(second).toBe(first)
  })

  it('recycles the oldest bolt when full rather than dropping the shot', () => {
    // A player with a full pool is holding the trigger down. The weapon appearing to stop
    // working is the one outcome that must not happen.
    const pool = createProjectilePool(3)
    const oldest = spawnProjectile(pool, SPEC)
    stepProjectiles(pool, 0.5, empty)
    spawnProjectile(pool, SPEC)
    spawnProjectile(pool, SPEC)

    const reused = spawnProjectile(pool, SPEC)
    expect(reused).toBe(oldest)
    expect(activeProjectiles(pool)).toBe(3)
  })

  it('gives every bolt its own seed, so a stream does not flicker in lockstep', () => {
    const pool = createProjectilePool(4)
    const seeds = new Set([
      spawnProjectile(pool, SPEC).seed,
      spawnProjectile(pool, SPEC).seed,
      spawnProjectile(pool, SPEC).seed,
    ])
    expect(seeds.size).toBe(3)
  })

  it('puts everything away on demand', () => {
    const pool = createProjectilePool(4)
    spawnProjectile(pool, SPEC)
    spawnProjectile(pool, SPEC)
    clearProjectiles(pool)
    expect(activeProjectiles(pool)).toBe(0)
  })
})

describe('flight', () => {
  it('travels at the speed it was launched with', () => {
    const pool = createProjectilePool(4)
    const bolt = spawnProjectile(pool, SPEC)
    for (let i = 0; i < 60; i += 1) stepProjectiles(pool, STEP, empty)
    expect(-bolt.z).toBeCloseTo(18, 0)
  })

  it('arcs, but gently enough to aim with at fighting range', () => {
    const pool = createProjectilePool(4)
    const bolt = spawnProjectile(pool, SPEC)
    // Roughly 6 metres of flight — the range most of this game is fought at.
    for (let i = 0; i < 20; i += 1) stepProjectiles(pool, STEP, empty)
    const drop = 1.5 - bolt.y
    expect(-bolt.z).toBeCloseTo(6, 0)
    expect(drop).toBeGreaterThan(0.05)
    expect(drop).toBeLessThan(0.2)
  })

  it('expires on its own, so a bolt fired into the dark is not immortal', () => {
    const pool = createProjectilePool(4)
    spawnProjectile(pool, { ...SPEC, life: 0.5 })
    for (let i = 0; i < 60; i += 1) stepProjectiles(pool, STEP, empty)
    expect(activeProjectiles(pool)).toBe(0)
  })

  it('asks the world about the whole segment, never about a point', () => {
    // The tunnelling case. At 18m/s a bolt covers 30cm per step, which is wider than the
    // things it is shot at and all of the walls.
    const pool = createProjectilePool(4)
    spawnProjectile(pool, SPEC)

    const segments: Array<{ from: Vec3; to: Vec3 }> = []
    stepProjectiles(pool, STEP, (from, to) => {
      segments.push({ from: { ...from }, to: { ...to } })
      return null
    })

    expect(segments).toHaveLength(1)
    const [segment] = segments
    const travelled = Math.abs(segment!.to.z - segment!.from.z)
    expect(travelled).toBeCloseTo(18 * STEP, 3)
  })
})

describe('impacts', () => {
  it('stops the bolt where the world said it stopped', () => {
    const pool = createProjectilePool(4)
    const bolt = spawnProjectile(pool, SPEC)
    const point = { x: 0, y: 1.5, z: -0.2 }

    const impacts = stepProjectiles(pool, STEP, () => ({ point, targetId: 'dummy-1' }))

    expect(impacts).toHaveLength(1)
    expect(impacts[0]!.targetId).toBe('dummy-1')
    expect(impacts[0]!.point).toEqual(point)
    expect(bolt.active).toBe(false)
    expect(bolt.z).toBe(-0.2)
  })

  it('reports a scenery hit with no target, so sparks can still play', () => {
    const pool = createProjectilePool(4)
    spawnProjectile(pool, SPEC)
    const impacts = stepProjectiles(pool, STEP, () => ({
      point: { x: 0, y: 1.5, z: -0.2 },
      targetId: null,
    }))
    expect(impacts[0]!.targetId).toBeNull()
  })

  it('carries the damage it was launched with, so it resolves against what it hits', () => {
    const pool = createProjectilePool(4)
    spawnProjectile(pool, { ...SPEC, base: 44, element: 'physical', critChance: 0.25 })
    const impacts = stepProjectiles(pool, STEP, () => ({
      point: { x: 0, y: 0, z: 0 },
      targetId: 'dummy-1',
    }))
    expect(impacts[0]!.projectile.base).toBe(44)
    expect(impacts[0]!.projectile.element).toBe('physical')
    expect(impacts[0]!.projectile.critChance).toBe(0.25)
  })

  it('a bolt that expires this step does not also hit anything', () => {
    const pool = createProjectilePool(4)
    spawnProjectile(pool, { ...SPEC, life: STEP / 2 })
    const impacts = stepProjectiles(pool, STEP, () => ({
      point: { x: 0, y: 0, z: 0 },
      targetId: 'dummy-1',
    }))
    expect(impacts).toHaveLength(0)
  })

  it('handles several bolts in flight independently', () => {
    const pool = createProjectilePool(8)
    const a = spawnProjectile(pool, SPEC)
    const b = spawnProjectile(pool, { ...SPEC, direction: { x: 1, y: 0, z: 0 } })

    const impacts = stepProjectiles(pool, STEP, (_from, _to, projectile) =>
      projectile === a ? { point: { x: 0, y: 0, z: 0 }, targetId: 'dummy-1' } : null,
    )

    expect(impacts).toHaveLength(1)
    expect(a.active).toBe(false)
    expect(b.active).toBe(true)
  })
})
