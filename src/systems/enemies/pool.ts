/**
 * Every enemy that can exist, allocated once.
 *
 * Pooled for the same reason projectiles are, only more so: an enemy owns a hit sphere, a
 * path, a status list and a registration in the damageable registry, and building that lot on
 * a mobile GC every time something walks around a corner is a hitch that lands in the middle
 * of combat. Nothing here allocates after startup — `spawn` takes a dormant slot and fills it
 * in, and death hands the slot back.
 *
 * The registry entry is created **once per slot and never replaced**, and its `position` is
 * the same object as the enemy's own. That is deliberate: a projectile in flight holds nothing
 * but an id, and the sweep reads positions straight out of the registry, so an enemy that
 * moves needs no re-registration and no copying. It also means there is exactly one answer to
 * "where is this thing", which is the sort of question that quietly grows two answers.
 *
 * An enemy's `position` is its **hit sphere centre**, not its feet — chest height, where a
 * bolt aimed at "the skeleton" actually arrives. The model is drawn hanging below it. One
 * position, nothing to keep in sync.
 */

import { ENEMIES, type EnemyId } from '@/data/enemies'
import { MAX_CONCURRENT } from '@/data/waves'
import type { Vec3 } from '@/systems/locomotion'
import type { Damageable } from '@/systems/combat/targets'

/**
 * What an enemy is doing. The full set — the AI in `ai.ts` may not invent another one.
 *
 * `spawning` and `dying` are bookends rather than states with behaviour: neither can be hit
 * and neither can hit, which is what stops something materialising mid-swing and what gives a
 * kill a moment of confirmation before the corpse goes away.
 */
export type EnemyPhase =
  | 'spawning'
  | 'idle'
  | 'chase'
  | 'telegraph'
  | 'strike'
  | 'recover'
  | 'stagger'
  | 'dying'

/** A point on a path, in world metres. Waypoints are converted from cells when a path is baked. */
export interface Waypoint {
  x: number
  z: number
}

export interface Enemy {
  /** Slot index. Stable for the pool's lifetime; the renderer uses it as an instance id. */
  readonly slot: number
  /** Registry id, stable for the pool's lifetime. `enemy-7` is always slot 7. */
  readonly id: string
  active: boolean
  type: EnemyId | null
  phase: EnemyPhase
  /** Hit sphere centre in world space. `y` is fixed at the definition's `centre`. */
  position: Vec3
  /** Facing, radians, yaw only. Nothing here leans or looks up. */
  yaw: number
  /** This step's horizontal movement, m/s. Presentation reads it; the AI writes it. */
  velocity: Waypoint
  /** Seconds in the current phase. Reset by every transition. */
  timer: number
  /** Seconds since the path was last baked. */
  sincePath: number
  /** World waypoints, from the pathfinder. Empty means "no route" — which is a real answer. */
  path: Waypoint[]
  pathIndex: number
  /**
   * True once something has hurt it, forever after.
   *
   * Being shot from the dark is aggro even without line of sight, or a wand outranges every
   * enemy in the game and the correct way to play becomes sniping things that never look up.
   */
  alerted: boolean
  /** The registry entry. Its `position` is this record's `position`, by reference. */
  readonly target: Damageable
  /** Whether this death has been paid out. One kill, one payout. */
  counted: boolean
  /** Seconds of hit flash remaining. Presentation only. */
  flash: number
  /** Per-enemy variation, so a pack does not bob and glow in lockstep. */
  seed: number
}

export interface EnemyPool {
  items: Enemy[]
  /** Monotonic. Used as a spawn seed, so two enemies in one step are not identical. */
  spawned: number
}

function createEnemy(slot: number): Enemy {
  const position: Vec3 = { x: 0, y: 0, z: 0 }
  const target: Damageable = {
    id: `enemy-${slot}`,
    position,
    radius: 0.4,
    hp: 0,
    maxHp: 1,
    statuses: [],
    enabled: false,
  }

  return {
    slot,
    id: target.id,
    active: false,
    type: null,
    phase: 'spawning',
    position,
    yaw: 0,
    velocity: { x: 0, z: 0 },
    timer: 0,
    sincePath: 0,
    path: [],
    pathIndex: 0,
    alerted: false,
    target,
    counted: false,
    flash: 0,
    seed: 0,
  }
}

/**
 * Capacity is the concurrency cap, not the wave size.
 *
 * A wave of twenty arrives ten at a time — see `waveConcurrency` — so twenty slots would be
 * ten permanently empty ones. If the pool is ever full the director simply waits, which is
 * what it does anyway.
 */
export function createEnemyPool(capacity = MAX_CONCURRENT): EnemyPool {
  return {
    items: Array.from({ length: capacity }, (_, slot) => createEnemy(slot)),
    spawned: 0,
  }
}

/**
 * Wake a slot up as an enemy of `type`, standing at `at`.
 *
 * Returns null when every slot is busy. Unlike the projectile pool, this **refuses** rather
 * than recycling the oldest: stealing a live enemy's slot would delete something the player is
 * fighting, which is a far worse outcome than the director waiting two seconds for room.
 */
export function spawnEnemy(pool: EnemyPool, type: EnemyId, at: Waypoint): Enemy | null {
  const enemy = pool.items.find((item) => !item.active)
  if (!enemy) return null

  const definition = ENEMIES[type]
  pool.spawned += 1

  enemy.active = true
  enemy.type = type
  enemy.phase = 'spawning'
  enemy.position.x = at.x
  enemy.position.y = definition.centre
  enemy.position.z = at.z
  enemy.yaw = 0
  enemy.velocity.x = 0
  enemy.velocity.z = 0
  enemy.timer = 0
  enemy.sincePath = Number.POSITIVE_INFINITY
  enemy.path.length = 0
  enemy.pathIndex = 0
  enemy.alerted = false
  enemy.counted = false
  enemy.flash = 0
  enemy.seed = pool.spawned

  enemy.target.radius = definition.radius
  enemy.target.hp = definition.hp
  enemy.target.maxHp = definition.hp
  enemy.target.resistances = definition.resistances
  enemy.target.statuses.length = 0
  enemy.target.burnCarry = 0
  // Not hittable until it has finished arriving. See `SPAWN_SECONDS`.
  enemy.target.enabled = false

  return enemy
}

/** Put a slot away. The registry entry stays registered but disabled. */
export function despawnEnemy(enemy: Enemy): void {
  enemy.active = false
  enemy.type = null
  enemy.path.length = 0
  enemy.target.enabled = false
  enemy.target.hp = 0
  enemy.target.statuses.length = 0
}

export function activeEnemies(pool: EnemyPool): Enemy[] {
  return pool.items.filter((item) => item.active)
}

/**
 * How many are still a threat.
 *
 * Corpses are excluded, which is what makes this the number the wave-clear check reads: a
 * wave that stays unfinished for the second and a half its last skeleton spends falling over
 * is a wave that ends on a shrug.
 */
export function livingEnemies(pool: EnemyPool): number {
  return pool.items.reduce(
    (count, item) => count + (item.active && item.phase !== 'dying' ? 1 : 0),
    0,
  )
}

/** Everything away. Called when a wave ends, so nothing survives into the foyer. */
export function clearEnemyPool(pool: EnemyPool): void {
  for (const enemy of pool.items) despawnEnemy(enemy)
}
