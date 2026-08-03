/**
 * What an enemy decides to do, once per fixed step.
 *
 * A state machine, for the same reason the run has one: these states are genuinely exclusive
 * and the bugs from pretending otherwise are the ones that ruin a fight. An enemy that is
 * winding up a swing and also walking is an enemy whose telegraph means nothing; one that can
 * be staggered while dying dies twice.
 *
 *   spawning ─▶ idle ──sees you──▶ chase ──in reach──▶ telegraph ─▶ strike ─▶ recover ─┐
 *                                    ▲                                                 │
 *                                    └─────────────────────────────────────────────────┘
 *
 *   any of the above ──hurt enough──▶ stagger ─▶ chase
 *   any of the above ──killed───────▶ dying ──▶ gone
 *
 * Note what is missing: there is no route from `chase` back to `idle` except the player dying.
 * Once something has noticed you it does not lose interest, and it does not forget where you
 * went when you break line of sight. Losing a pursuer by stepping behind a wall is a stealth
 * mechanic, and this is a game about being cornered.
 *
 * **The telegraph is the whole design.** It is the window in which the player can still do
 * something about being hit — step back, interrupt it, get behind it. An enemy without one is
 * not difficult, it is arbitrary: damage arrives with no preceding information, and in VR
 * being hurt by something you had no chance to read is what makes people take the headset off.
 * Everything else in this file is in service of that window existing and being legible.
 *
 * Pure. It mutates the enemy record it is handed and returns an intent; it does not move
 * anything, damage anything, or know what a dungeon is. The driver in `EnemyDriver.tsx` owns
 * pathing, collision and damage, which is what makes every rule here testable without a
 * physics world, a level, or a headset.
 */

import { CORPSE_SECONDS, ENEMIES, SPAWN_SECONDS, type EnemyDefinition } from '@/data/enemies'
import { chillFactor } from '@/systems/combat/damage'
import type { Enemy } from '@/systems/enemies/pool'
import {
  blendSteering,
  followPath,
  headingOf,
  separation,
  turnTowards,
  type Neighbour,
  type Steer,
} from '@/systems/enemies/steering'

/** How far past `attackRange` an enemy will chase before it re-enters the wind-up. */
export const RANGE_HYSTERESIS = 0.4

/** How close to a waypoint counts as having reached it, in metres. */
export const ARRIVE_RADIUS = 0.45

/** How often a chasing enemy asks for a new route. */
export const REPATH_SECONDS = 0.6

/** How hard separation pulls against the path. See `blendSteering`. */
export const SEPARATION_WEIGHT = 0.85

/** Radians per second an enemy may turn. About a full circle in a second and a half. */
export const TURN_RATE = 4.2

/**
 * How long a spawned enemy waits before it starts hunting the player unprompted.
 *
 * This exists because of what these enemies *are*. Nothing in this dungeon is ambient — every
 * one of them is placed by the Wave Director as part of a wave, at the far end of a level the
 * player has to clear to finish it. Left to line of sight alone they idle sixty metres away
 * for the rest of the night, and the wave can only be completed by the player going room to
 * room hunting them. That is a different game, and a worse one.
 *
 * So aggro is *reaction*, and this is *intent*. Seeing the player inside the aggro radius —
 * or being shot — makes an enemy turn on you immediately, which is what stops the level
 * reading as a set of trip-wires. This is the fallback that guarantees the fight comes to you
 * anyway, a couple of seconds later, from wherever it started.
 */
export const HUNT_DELAY = 2

/**
 * How far an enemy will drift off the direct line during its wind-up, in m/s.
 *
 * Zero. It plants and swings, and that stillness is most of what makes the telegraph readable
 * from six metres away in a dark corridor — a moving thing that is also winding up reads as a
 * moving thing.
 */
export const TELEGRAPH_DRIFT = 0

export interface AiContext {
  /** The player's hit centre, in world space. */
  player: { x: number; y: number; z: number }
  /** Whether this enemy can currently see the player. The driver asks the nav grid. */
  visible: boolean
  /**
   * Everything alive, for separation — including this enemy, at `selfIndex`.
   *
   * One shared list rather than a filtered copy per enemy: this runs for every enemy every
   * step, and a fresh array of ten objects sixty times a second is exactly the per-frame
   * garbage the pool exists to avoid.
   */
  neighbours: readonly Neighbour[]
  /** This enemy's own index in `neighbours`, or -1 if it is not in the list. */
  selfIndex: number
  /** True while the player is alive and fightable. A dead player is not chased or hit. */
  playerAlive: boolean
}

/** What the driver should do about this enemy's decision this step. */
export interface AiIntent {
  /** Desired movement this step, in metres. Already scaled by dt and speed. */
  dx: number
  dz: number
  /** True on the single step the blow lands. */
  strike: boolean
  /** True when this enemy wants a fresh path to the player. */
  repath: boolean
  /** True on the step the corpse should be recycled. */
  expired: boolean
}

const IDLE: AiIntent = { dx: 0, dz: 0, strike: false, repath: false, expired: false }

/** Move to a new phase and reset the phase clock. The only way `phase` should ever change. */
export function enterPhase(enemy: Enemy, phase: Enemy['phase']): void {
  if (enemy.phase === phase) return
  enemy.phase = phase
  enemy.timer = 0
}

/**
 * Interrupt an enemy with a hit that was hard enough.
 *
 * Called by the driver from the damage path. Returns whether it actually staggered, so the
 * caller can make it felt — a stagger the player cannot perceive is a mechanic they will
 * never learn to aim for.
 *
 * Refused while spawning or dying: neither is a state anything can be knocked out of, and a
 * corpse that flinches is a corpse that never finishes falling over.
 */
export function staggerEnemy(enemy: Enemy, definition: EnemyDefinition, amount: number): boolean {
  if (enemy.phase === 'spawning' || enemy.phase === 'dying') return false
  if (amount < definition.staggerThreshold) return false
  enterPhase(enemy, 'stagger')
  return true
}

/** Kill an enemy: no more hits in, no more hits out, and a corpse for a moment. */
export function killEnemy(enemy: Enemy): void {
  if (enemy.phase === 'dying') return
  enterPhase(enemy, 'dying')
  enemy.target.enabled = false
  enemy.target.hp = 0
  enemy.velocity.x = 0
  enemy.velocity.z = 0
}

/**
 * One enemy, one step.
 *
 * Order matters and is the same every time: age the clock, handle death, then decide. Deciding
 * before checking death is how something gets a free swing in from beyond the grave.
 */
export function stepEnemyAi(enemy: Enemy, ctx: AiContext, dt: number): AiIntent {
  if (!enemy.active || !enemy.type) return IDLE

  const definition = ENEMIES[enemy.type]
  enemy.timer += dt
  enemy.sincePath += dt
  enemy.flash = Math.max(0, enemy.flash - dt)

  // Death is checked here rather than trusted to the damage path, because a status tick can
  // take the last point of health off between two of the driver's own calls.
  if (enemy.target.hp <= 0 && enemy.phase !== 'dying') killEnemy(enemy)

  const dx = ctx.player.x - enemy.position.x
  const dz = ctx.player.z - enemy.position.z
  const distance = Math.hypot(dx, dz)
  const toPlayer: Steer = distance > 1e-4 ? { x: dx / distance, z: dz / distance } : { x: 0, z: 1 }

  switch (enemy.phase) {
    case 'dying':
      enemy.velocity.x = 0
      enemy.velocity.z = 0
      return { ...IDLE, expired: enemy.timer >= CORPSE_SECONDS }

    case 'spawning':
      enemy.velocity.x = 0
      enemy.velocity.z = 0
      if (enemy.timer >= SPAWN_SECONDS) {
        // Hittable from the moment it is a real thing, and not before.
        enemy.target.enabled = true
        enterPhase(enemy, 'idle')
      }
      return IDLE

    case 'stagger':
      enemy.velocity.x = 0
      enemy.velocity.z = 0
      if (enemy.timer >= definition.staggerSeconds) enterPhase(enemy, 'chase')
      return IDLE

    case 'idle': {
      if (!ctx.playerAlive) return IDLE
      // Line of sight *and* range — see `hasLineOfSight`. Being shot is aggro on its own,
      // or a wand outranges every enemy in the game and sniping becomes the whole tactic.
      const noticed =
        enemy.alerted ||
        (ctx.visible && distance <= definition.aggroRadius) ||
        enemy.timer >= HUNT_DELAY
      if (!noticed) return IDLE
      enterPhase(enemy, 'chase')
      return { ...IDLE, repath: true }
    }

    case 'chase': {
      if (!ctx.playerAlive) {
        enterPhase(enemy, 'idle')
        return IDLE
      }

      // Close enough, and it can actually see what it is about to swing at. Attacking through
      // a wall you happen to be standing against is the melee version of aggro through rock.
      if (distance <= definition.attackRange && ctx.visible) {
        enterPhase(enemy, 'telegraph')
        enemy.velocity.x = 0
        enemy.velocity.z = 0
        return IDLE
      }

      const repath = enemy.sincePath >= REPATH_SECONDS || enemy.pathIndex >= enemy.path.length
      const along = followPath(enemy.position, enemy.path, enemy.pathIndex, ARRIVE_RADIUS)
      enemy.pathIndex = along.index

      // Off the end of the path, or never had one: walk at the player directly. Right whenever
      // there is nothing in the way, and harmless when there is — `resolveMove` will refuse it
      // and the next repath will supply a real route. The alternative is an enemy that stands
      // still for the rest of the wave because one path lookup failed.
      const heading =
        along.x === 0 && along.z === 0 ? toPlayer : { x: along.x, z: along.z }

      const apart = separation(enemy.position, definition.radius, ctx.neighbours, ctx.selfIndex)
      const steer = blendSteering(heading, apart, SEPARATION_WEIGHT)

      const speed = definition.speed * chillFactor(enemy.target.statuses)
      enemy.velocity.x = steer.x * speed
      enemy.velocity.z = steer.z * speed
      // Faces where it is going, not where the player is: a body that walks sideways round a
      // corner while staring at you is a body that has no weight.
      face(enemy, steer.x === 0 && steer.z === 0 ? toPlayer : steer, dt)

      return { dx: enemy.velocity.x * dt, dz: enemy.velocity.z * dt, strike: false, repath, expired: false }
    }

    case 'telegraph': {
      enemy.velocity.x = 0
      enemy.velocity.z = 0
      // It tracks the player while winding up, so stepping *sideways* is not a free dodge —
      // but it cannot move, so stepping *back* is. That is the distinction worth teaching.
      face(enemy, toPlayer, dt)

      if (enemy.timer < definition.telegraph) return IDLE

      enterPhase(enemy, 'strike')
      // The reach check happens on the strike step, not here: the player has had the whole
      // wind-up to leave, and a blow that lands because the range check ran a second ago is
      // exactly the unfair damage the telegraph exists to prevent.
      const inReach = distance <= definition.attackRange + RANGE_HYSTERESIS
      return { ...IDLE, strike: inReach && ctx.playerAlive && ctx.visible }
    }

    case 'strike':
      // A single step, and it is over. The blow was resolved on the transition above.
      enterPhase(enemy, 'recover')
      return IDLE

    case 'recover': {
      if (enemy.timer >= definition.recover) {
        enterPhase(enemy, 'chase')
        return { ...IDLE, repath: true }
      }

      // The Skulker's whole character: hit and leave. Anything with `retreatSpeed: 0` simply
      // stands in its recovery, which is the window the player gets to punish.
      if (definition.retreatSpeed <= 0) return IDLE

      const apart = separation(enemy.position, definition.radius, ctx.neighbours, ctx.selfIndex)
      const away = blendSteering({ x: -toPlayer.x, z: -toPlayer.z }, apart, SEPARATION_WEIGHT)
      const speed = definition.retreatSpeed * chillFactor(enemy.target.statuses)
      enemy.velocity.x = away.x * speed
      enemy.velocity.z = away.z * speed
      // Backing away, still facing you. It has not lost interest.
      face(enemy, toPlayer, dt)
      return { dx: away.x * speed * dt, dz: away.z * speed * dt, strike: false, repath: false, expired: false }
    }
  }
}

function face(enemy: Enemy, direction: Steer, dt: number): void {
  enemy.yaw = turnTowards(enemy.yaw, headingOf(direction.x, direction.z), TURN_RATE * dt)
}
