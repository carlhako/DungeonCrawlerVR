/**
 * Projectiles, pooled.
 *
 * Pooled because the alternative is allocating an object and a mesh per bolt, and a wand at
 * 3.2 shots per second held down through a wave is a few thousand short-lived allocations
 * dropped on a mobile GC that shares its budget with the frame. On a Quest that is a hitch
 * you can feel, and it arrives during combat, which is precisely when it is least affordable.
 *
 * The pool is a fixed array of slots that are reused in place. Nothing here creates or
 * destroys anything after startup; `spawn` finds a free slot, or steals the oldest one.
 *
 * Pure: the world is a `sweep` callback the caller supplies. That keeps the whole of flight,
 * lifetime, recycling and impact ordering testable without a physics world, and it means the
 * same code path handles a bolt hitting a dummy in the foyer and one hitting a dungeon wall.
 */

import type { Element } from '@/data/elements'
import type { Vec3 } from '@/systems/locomotion'
import type { DamageSource } from '@/systems/combat/damage'

/**
 * Downward acceleration, m/s².
 *
 * A quarter of real gravity, on purpose. "Rapid arcing fire bolts" wants an arc the player
 * can read and lead with, not a mortar. At 18m/s a bolt drops about 14cm over 6 metres —
 * visible as an arc, and forgiving at the range you actually fight at — rising to about 39cm
 * at 10 metres, which is where leading the shot starts to be a skill rather than a nuisance.
 * Real gravity here would make a game about swinging at skeletons in the dark into a
 * ballistics exercise.
 */
export const PROJECTILE_GRAVITY = 2.5

/** How many bolts can be in the air at once, across both hands. */
export const PROJECTILE_CAPACITY = 48

export interface Projectile {
  /** Slot index. Stable for the pool's lifetime; the renderer uses it as an instance id. */
  readonly slot: number
  active: boolean
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  /** Seconds in flight. */
  age: number
  /** Seconds before it expires on its own. */
  life: number
  /** Sweep radius, so a bolt hits what it visibly touches rather than what its centre does. */
  radius: number
  /** Damage this bolt is carrying, resolved on impact rather than at spawn. */
  base: number
  element: Element
  critChance: number
  source: DamageSource
  /** Per-bolt variation, so a stream of them doesn't flicker in lockstep. */
  seed: number
}

export interface ProjectilePool {
  items: Projectile[]
  /** Monotonic, so "oldest" is well defined when the pool is full. */
  spawned: number
}

function createProjectile(slot: number): Projectile {
  return {
    slot,
    active: false,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    age: 0,
    life: 0,
    radius: 0.12,
    base: 0,
    element: 'physical',
    critChance: 0,
    source: { kind: 'projectile', weaponId: null, hand: null },
    seed: 0,
  }
}

export function createProjectilePool(capacity = PROJECTILE_CAPACITY): ProjectilePool {
  return {
    items: Array.from({ length: capacity }, (_, slot) => createProjectile(slot)),
    spawned: 0,
  }
}

export interface ProjectileSpec {
  origin: Vec3
  /** Unit direction. Speed is applied to it; a non-unit vector is a faster bolt, quietly. */
  direction: Vec3
  speed: number
  life: number
  radius?: number
  base: number
  element: Element
  critChance: number
  source: DamageSource
  seed?: number
}

/**
 * Take a slot and launch it.
 *
 * When every slot is busy the **oldest** is recycled rather than the shot being dropped. A
 * player who has forty-eight bolts in the air is holding the trigger down, and the one thing
 * that must not happen is the weapon appearing to stop working; the bolt that vanishes is
 * the one furthest away and least likely to be looked at.
 */
export function spawnProjectile(pool: ProjectilePool, spec: ProjectileSpec): Projectile {
  let slot = pool.items.find((item) => !item.active)

  if (!slot) {
    slot = pool.items[0]!
    for (const item of pool.items) if (item.age > slot.age) slot = item
  }

  pool.spawned += 1

  slot.active = true
  slot.x = spec.origin.x
  slot.y = spec.origin.y
  slot.z = spec.origin.z
  slot.vx = spec.direction.x * spec.speed
  slot.vy = spec.direction.y * spec.speed
  slot.vz = spec.direction.z * spec.speed
  slot.age = 0
  slot.life = spec.life
  slot.radius = spec.radius ?? 0.12
  slot.base = spec.base
  slot.element = spec.element
  slot.critChance = spec.critChance
  slot.source = spec.source
  slot.seed = spec.seed ?? pool.spawned

  return slot
}

/** What the world said about the segment a projectile tried to cross. */
export interface SweepResult {
  /** Where it stopped. */
  point: Vec3
  /** The damageable it struck, or null for scenery. */
  targetId: string | null
}

export interface ProjectileImpact {
  projectile: Projectile
  point: Vec3
  targetId: string | null
}

/**
 * Advance every live projectile by one fixed step, and report what hit what.
 *
 * The order is deliberate: integrate to a candidate position, then ask the world about the
 * *segment* from where it was to where it wants to be. Never a point test at the new
 * position — a bolt at 18m/s moves 30cm per step, which is wider than most of the things it
 * is aimed at and all of the walls, so a point test tunnels through both.
 *
 * Impacts are collected and returned rather than damaging anything here, so the damage
 * pipeline stays the single place health changes, and so a bolt that kills something cannot
 * do it halfway through the pool's own iteration.
 */
export function stepProjectiles(
  pool: ProjectilePool,
  dt: number,
  sweep: (from: Vec3, to: Vec3, projectile: Projectile) => SweepResult | null,
  gravity = PROJECTILE_GRAVITY,
): ProjectileImpact[] {
  const impacts: ProjectileImpact[] = []

  for (const projectile of pool.items) {
    if (!projectile.active) continue

    projectile.age += dt
    if (projectile.age >= projectile.life) {
      projectile.active = false
      continue
    }

    projectile.vy -= gravity * dt

    const from = { x: projectile.x, y: projectile.y, z: projectile.z }
    const to = {
      x: projectile.x + projectile.vx * dt,
      y: projectile.y + projectile.vy * dt,
      z: projectile.z + projectile.vz * dt,
    }

    const hit = sweep(from, to, projectile)

    if (hit) {
      projectile.x = hit.point.x
      projectile.y = hit.point.y
      projectile.z = hit.point.z
      projectile.active = false
      impacts.push({ projectile, point: { ...hit.point }, targetId: hit.targetId })
      continue
    }

    projectile.x = to.x
    projectile.y = to.y
    projectile.z = to.z
  }

  return impacts
}

/** Put every bolt away. Called when a wave ends, so none survives into the foyer. */
export function clearProjectiles(pool: ProjectilePool): void {
  for (const projectile of pool.items) projectile.active = false
}

export function activeProjectiles(pool: ProjectilePool): number {
  return pool.items.reduce((count, item) => count + (item.active ? 1 : 0), 0)
}
