/**
 * Enemy definitions.
 *
 * Data, not code — the same rule `weapons.ts` follows and for the same reason: enemy eleven
 * should be an entry in this table, never a new branch in the AI. Everything here is read by
 * the state machine in `systems/enemies/ai.ts`, which has no idea what a goblin is.
 *
 * Three enemies, and they are deliberately three *different problems* rather than three
 * numbers. A roster where every entry walks at you and hits you is a roster with one enemy in
 * it drawn three ways:
 *
 * - The **Goblin Skulker** is fast, fragile, and does not stay to trade. It closes, hits, and
 *   backs off — so the threat is being surrounded rather than being out-damaged, and standing
 *   still is what kills you.
 * - The **Skeleton Warrior** is slow and heavy with a long, readable wind-up. It is the enemy
 *   that teaches the telegraph: you *can* step out of its swing, and once you know that, it
 *   is the one you leave until last.
 * - The **Wraith** ignores the walls. It is slow and weak, and it arrives from a direction the
 *   nav grid says is impossible, which is the whole of its identity in a game about being
 *   afraid of a corridor.
 *
 * The numbers are first drafts, tuned against the Emberwand (12 damage, 3.2/s) and the
 * Frostbrand (28 damage, 1.6/s) rather than against a spreadsheet. Sprint 4.2 owns the real
 * roster and the balance pass.
 */

import type { Element } from '@/data/elements'
import type { Resistances } from '@/systems/combat/damage'
import type { ClipMapping } from '@/systems/enemies/animation'

export type EnemyId = 'goblin-skulker' | 'skeleton-warrior' | 'wraith'

/**
 * Where an enemy's model comes from, and what to do with it when it arrives.
 *
 * Sprint 2.7. The files themselves are a **CC0 Quaternius pack that Carl downloads** into
 * `public/models/` — see the README there for exactly what to fetch and what to name it.
 * Everything in this table is written so the game works before those files exist and works
 * better the moment they do: a missing GLB is not an error, it is a slot that keeps drawing
 * the primitive it has drawn since Sprint 2.3.
 *
 * The clip names are *candidates*, not requirements. Nobody here chose the names inside a CC0
 * kit, and `matchClip` will take `Attack`, `attack` or `CharacterArmature|Sword_Attack` for the
 * same thing — so the lists below are a description of what to look for rather than a contract
 * that a re-export can break.
 */
export interface EnemyModelSpec {
  /** Served from `public/`, so `/models/x.glb` is `public/models/x.glb`. */
  url: string
  /**
   * The model's own height, floor to top of head, in metres.
   *
   * Measured once when the pack lands, not trusted from the exporter. `modelScale` corrects it
   * to the definition's `height`, which is what every readability decision was tuned against.
   */
  sourceHeight: number
  /** Extra yaw in radians, for a kit whose models face +Z rather than the game's -Z. */
  yawOffset?: number
  /** Vertical nudge in metres, for a kit whose origin is not on the floor. */
  yOffset?: number
  /** Clip names to look for, per AI phase, best first. */
  clips: ClipMapping
}

export interface EnemyDefinition {
  id: EnemyId
  name: string

  hp: number
  /**
   * Hit sphere radius, in metres. Generous rather than exact — a near miss that reads as a
   * hit is a much smaller sin than a clean hit that reads as a miss, which is what a player
   * reports as "my sword went through it".
   */
  radius: number
  /**
   * Height of the hit sphere's centre above the floor.
   *
   * This is also the enemy's authoritative position: everything moves in a horizontal plane
   * at this height, and the model is drawn hanging below it. One position, no synchronising.
   */
  centre: number
  /** Drawn height, floor to top of head. Presentation only. */
  height: number

  /** Metres per second at full health and unchilled. */
  speed: number
  /**
   * How close the player must come before this notices them, in metres.
   *
   * Line of sight is checked as well — see `hasLineOfSight`. Aggro through a wall is what
   * makes a dungeon feel like a room full of trip-wires rather than a place with things in it.
   */
  aggroRadius: number
  /** How far it can reach the player from, measured centre to centre. */
  attackRange: number

  damage: number
  element: Element
  resistances?: Resistances

  /**
   * The attack, in three parts, in seconds.
   *
   * `telegraph` is the wind-up, and it is the single most important number in this file: it is
   * the window in which the player can still do something about being hit. An enemy with no
   * telegraph is not difficult, it is unfair — the player has no information to act on, and in
   * VR being hit by something you had no chance to read is the reason people take the headset
   * off. `strike` is the instant the blow lands. `recover` is the cost of having thrown it,
   * and the window the player gets to punish.
   */
  telegraph: number
  recover: number

  /**
   * Damage in a single hit that interrupts whatever it is doing.
   *
   * Absolute rather than a fraction of max HP, so a heavy weapon staggers the small things
   * reliably and has to be earned against the big ones. A telegraphing enemy that cannot be
   * interrupted turns the wind-up into a countdown rather than an opening.
   */
  staggerThreshold: number
  staggerSeconds: number

  /**
   * Metres per second *backwards* during recovery. Zero for anything that stands its ground.
   *
   * This is the Skulker's whole character and the reason it is dangerous in a pack rather than
   * alone.
   */
  retreatSpeed: number

  /**
   * Whether the walls apply.
   *
   * A phasing enemy ignores the nav grid entirely and moves straight at the player. Only the
   * Wraith does this, and it is the reason it exists.
   */
  phasing: boolean

  /** Gold paid for killing one. The wave payout is the sum of these — see `waves.ts`. */
  gold: number
  /** What one costs against the wave's budget. See `data/waves.ts`. */
  cost: number
  /** The first wave this may appear on. */
  minWave: number

  /** Body colour, and the emissive that makes it visible by torchlight. */
  colour: string
  /**
   * Emissive intensity at rest.
   *
   * Not decoration. The dungeon is lit by six torches and something approaching between two
   * of them is, at zero emissive, genuinely invisible — which is not tension, it is the game
   * failing to tell the player anything. The eyes carry most of this; see `Enemies.tsx`.
   */
  glow: number

  /**
   * The model, if there is one. Absent — or its file missing — means primitives.
   *
   * Presentation only. Nothing about hit spheres, nav or AI reads this: a model is drawing.
   */
  model?: EnemyModelSpec
}

export const ENEMIES: Record<EnemyId, EnemyDefinition> = {
  'goblin-skulker': {
    id: 'goblin-skulker',
    name: 'Goblin Skulker',
    hp: 40,
    radius: 0.34,
    centre: 0.72,
    height: 1.2,
    speed: 2.5,
    aggroRadius: 11,
    attackRange: 1.5,
    damage: 7,
    element: 'physical',
    telegraph: 0.35,
    recover: 1.1,
    staggerThreshold: 10,
    staggerSeconds: 0.45,
    // It hits and leaves. Faster than it advances, so backing off reads as a decision rather
    // than as the pathfinder losing its nerve.
    retreatSpeed: 3.0,
    phasing: false,
    gold: 8,
    cost: 1,
    minWave: 1,
    colour: '#6f8a4a',
    glow: 0.35,
    model: {
      url: '/models/goblin-skulker.glb',
      sourceHeight: 1.2,
      clips: {
        idle: ['Idle'],
        // It is the fast one, and it should look it even standing still between lunges.
        chase: ['Running', 'Run', 'Walk'],
        telegraph: ['Attack', 'Punch', 'Bite'],
        strike: ['Attack', 'Punch', 'Bite'],
        recover: ['Idle'],
        stagger: ['HitRecieve', 'HitReceive', 'Hit', 'Damage'],
        dying: ['Death', 'Die'],
      },
    },
  },
  'skeleton-warrior': {
    id: 'skeleton-warrior',
    name: 'Skeleton Warrior',
    hp: 110,
    radius: 0.42,
    centre: 1.02,
    height: 1.85,
    speed: 1.5,
    aggroRadius: 13,
    attackRange: 2.0,
    damage: 18,
    element: 'physical',
    // Long enough to be a real decision. At 1.5 m/s it cannot close the gap you make by
    // stepping back inside the wind-up, which is exactly the lesson.
    telegraph: 0.8,
    recover: 1.4,
    staggerThreshold: 26,
    staggerSeconds: 0.5,
    retreatSpeed: 0,
    phasing: false,
    // Bone: fire barely notices it, frost shatters it.
    resistances: { fire: 0.35, frost: -0.35 },
    gold: 18,
    cost: 3,
    minWave: 1,
    colour: '#d8d2c0',
    glow: 0.25,
    model: {
      url: '/models/skeleton-warrior.glb',
      sourceHeight: 1.85,
      clips: {
        idle: ['Idle'],
        // Slow and heavy. A walk, never a run — the whole lesson of this enemy is that you can
        // step back out of its swing, and a sprinting skeleton says the opposite.
        chase: ['Walk', 'Walking'],
        // Separate wind-up and strike where the kit has them, because this is the enemy whose
        // telegraph the player is being taught to read.
        telegraph: ['Attack_Windup', 'Windup', 'Attack'],
        strike: ['Attack', 'Sword_Attack', 'Slash'],
        recover: ['Idle'],
        stagger: ['HitRecieve', 'HitReceive', 'Hit', 'Damage'],
        dying: ['Death', 'Die'],
      },
    },
  },
  wraith: {
    id: 'wraith',
    name: 'Wraith',
    hp: 55,
    radius: 0.4,
    centre: 1.1,
    height: 1.9,
    // Slow, because it does not need to be fast: it is already taking the short way.
    speed: 1.15,
    aggroRadius: 16,
    attackRange: 1.7,
    damage: 12,
    element: 'frost',
    telegraph: 0.55,
    recover: 1.2,
    staggerThreshold: 14,
    staggerSeconds: 0.55,
    retreatSpeed: 0,
    phasing: true,
    // Cold thing. Fire is what you want, and the Emberwand is what everybody owns.
    resistances: { frost: 0.6, fire: -0.3, physical: 0.2 },
    gold: 22,
    cost: 4,
    minWave: 3,
    colour: '#7fa8c8',
    glow: 1.1,
    model: {
      url: '/models/wraith.glb',
      sourceHeight: 1.9,
      // It comes through the wall, so it must not also look like it is walking on the floor.
      // The float is what sells the one thing this enemy is for.
      yOffset: 0.12,
      clips: {
        idle: ['Idle', 'Flying', 'Float'],
        chase: ['Flying', 'Float', 'Idle'],
        telegraph: ['Attack', 'Cast'],
        strike: ['Attack', 'Cast'],
        recover: ['Idle', 'Flying'],
        stagger: ['HitRecieve', 'HitReceive', 'Hit', 'Damage'],
        dying: ['Death', 'Die'],
      },
    },
  },
}

export const ENEMY_IDS = Object.keys(ENEMIES) as EnemyId[]

export function isEnemyId(value: unknown): value is EnemyId {
  return typeof value === 'string' && value in ENEMIES
}

/**
 * How long a corpse lies there before its slot is recycled.
 *
 * Not zero. Something that vanishes on the frame it dies gives the player no confirmation
 * that they killed it, and in a dark corridor the difference between "it died" and "it went
 * somewhere" is the difference between relief and panic. The dissolve shader that makes this
 * look deliberate is Sprint 2.4's.
 */
export const CORPSE_SECONDS = 1.6

/**
 * How long an enemy takes to fade in at its spawn point.
 *
 * It is not hittable and cannot hit during this. Something that pops into existence already
 * swinging is the other half of the unfair-damage problem the telegraph exists to solve.
 */
export const SPAWN_SECONDS = 0.8
