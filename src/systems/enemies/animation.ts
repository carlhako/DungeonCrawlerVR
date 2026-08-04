/**
 * Which clip an enemy should be playing, and how fast.
 *
 * Pure, and deliberately so. The mapping from AI phase to animation clip is the sort of thing
 * that grows into a switch statement inside a component, at which point "does a Skeleton
 * Warrior's wind-up animation actually finish before the blow lands" becomes a question you
 * answer by putting a headset on. It is a question about two numbers.
 *
 * Three rules hold everything here together:
 *
 * - **The clip follows the AI; the AI never follows the clip.** Playback is visual. No decision
 *   in `ai.ts` may wait on an animation event, or the game's timing becomes a property of an
 *   art asset and the telegraph — the one number the player's survival depends on — stops
 *   meaning what `enemies.ts` says it means.
 * - **A window is fitted, not hoped for.** A wind-up clip is stretched or compressed to the
 *   definition's `telegraph` exactly, so the model is furthest back at the instant the AI
 *   commits. A kit whose attack animation happens to run 1.2s would otherwise still be rearing
 *   back when the blow has already landed.
 * - **The procedural channel never switches off.** The lean, the bob, the eyes and the halo
 *   from `appearance.ts` are applied to a parent of the model, so a clip that carries a state
 *   badly — or a kit that has no clip for it at all — degrades to exactly what the capsule did,
 *   rather than to nothing. PLAN.md: a model with a beautiful idle and an unreadable wind-up is
 *   worse than the capsule.
 */

import { CORPSE_SECONDS, SPAWN_SECONDS, type EnemyDefinition } from '@/data/enemies'
import type { EnemyPhase } from '@/systems/enemies/pool'

/** Clip names to look for, per phase, best first. Matching is tolerant — see `matchClip`. */
export type ClipMapping = Partial<Record<EnemyPhase, readonly string[]>>

/**
 * Where a phase looks if the kit has no clip of its own for it.
 *
 * Conservative on purpose. `dying` terminates rather than falling back to an idle, because a
 * corpse playing a breathing loop while it dissolves is worse than a corpse holding still while
 * the procedural fall does the work — which it does, and which is the whole point of keeping
 * that channel alive.
 */
const CLIP_CHAIN: Record<EnemyPhase, readonly EnemyPhase[]> = {
  spawning: ['spawning', 'idle'],
  idle: ['idle'],
  chase: ['chase', 'idle'],
  telegraph: ['telegraph', 'strike', 'idle'],
  strike: ['strike', 'telegraph', 'idle'],
  recover: ['recover', 'idle'],
  stagger: ['stagger', 'idle'],
  dying: ['dying'],
}

/** Phases that loop. Everything else plays once and holds its last frame. */
const LOOPING: ReadonlySet<EnemyPhase> = new Set<EnemyPhase>(['idle', 'chase', 'spawning'])

/**
 * Phases that must arrive without a blend.
 *
 * A strike and a stagger are both single readable events the player is reacting to, and a
 * 120ms cross-fade into a 100ms event is the event. Everything else blends, because the
 * alternative is a pack of enemies snapping between poses every time one changes its mind.
 */
const INSTANT: ReadonlySet<EnemyPhase> = new Set<EnemyPhase>(['strike', 'stagger'])

const DEFAULT_FADE = 0.12

/**
 * How far a chase clip's playback may be pushed by the enemy's actual speed.
 *
 * The floor is not zero: a chilled enemy crawling at a fifth of its speed should visibly
 * labour, not freeze mid-stride and slide along the floor, which reads as the game having
 * broken rather than as the enemy having been slowed.
 */
export const CHASE_RATE_MIN = 0.35
export const CHASE_RATE_MAX = 2.5

/** Absolute bounds on any playback rate, so a pathological clip length cannot stop time. */
const RATE_MIN = 0.05
const RATE_MAX = 8

export interface ClipPlan {
  /** The clip to play, or null when the kit has nothing for this phase. */
  clip: string | null
  loop: boolean
  /** Playback rate multiplier. */
  timeScale: number
  /** Seconds to cross-fade in from whatever was playing. */
  fade: number
}

export interface ClipContext {
  /** Horizontal speed, m/s. Only the chase rate reads it. */
  speed: number
  /** Duration of the resolved clip in seconds, so a window can be fitted to it. */
  duration: number
}

/**
 * Finds the best available clip for a list of wanted names.
 *
 * Tolerant, in tiers, because the whole point of a CC0 kit is that nobody here chose the
 * names in it: `Attack`, `attack`, `Armature|Attack` and `CharacterArmature|Sword_Attack` are
 * all the same clip as far as this game is concerned. Tiers are searched exact-first across
 * *every* candidate before any fuzzy match is considered, so a loose substring hit on the
 * first-preference name can never beat an exact hit on the second.
 */
export function matchClip(candidates: readonly string[], available: readonly string[]): string | null {
  if (candidates.length === 0 || available.length === 0) return null

  for (const candidate of candidates) {
    const hit = available.find((name) => name === candidate)
    if (hit) return hit
  }

  for (const candidate of candidates) {
    const lower = candidate.toLowerCase()
    const hit = available.find((name) => name.toLowerCase() === lower)
    if (hit) return hit
  }

  for (const candidate of candidates) {
    const key = normalise(candidate)
    const hit = available.find((name) => normalise(name) === key)
    if (hit) return hit
  }

  for (const candidate of candidates) {
    const key = normalise(candidate)
    if (key.length === 0) continue
    const hit = available.find((name) => {
      const other = normalise(name)
      return other.includes(key) || key.includes(other)
    })
    if (hit) return hit
  }

  return null
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Resolves the clip a phase should play, walking the fallback chain.
 *
 * Returns null when nothing in the chain exists in the kit, which is a legitimate answer: the
 * procedural channel carries the state on its own.
 */
export function selectClip(
  phase: EnemyPhase,
  mapping: ClipMapping,
  available: readonly string[],
): string | null {
  for (const step of CLIP_CHAIN[phase]) {
    const clip = matchClip(mapping[step] ?? [], available)
    if (clip) return clip
  }
  return null
}

/**
 * How fast to play the resolved clip.
 *
 * Every phase with a deadline fits its clip to that deadline; the rest run at their authored
 * speed, except a chase, whose rate follows how fast the thing is actually moving — the same
 * rule the procedural walk bob follows, and for the same reason: a chilled enemy has to look
 * chilled from across the room.
 */
export function clipTimeScale(
  phase: EnemyPhase,
  definition: EnemyDefinition,
  context: ClipContext,
): number {
  if (phase === 'chase') {
    const nominal = definition.speed > 0 ? context.speed / definition.speed : 1
    return clamp(nominal, CHASE_RATE_MIN, CHASE_RATE_MAX)
  }

  const window = phaseWindow(phase, definition)
  if (window === null) return 1
  if (context.duration <= 0 || window <= 0) return 1
  return clamp(context.duration / window, RATE_MIN, RATE_MAX)
}

/** The seconds a phase lasts, where it has a fixed length. Null means "no deadline". */
function phaseWindow(phase: EnemyPhase, definition: EnemyDefinition): number | null {
  switch (phase) {
    case 'spawning':
      return SPAWN_SECONDS
    case 'telegraph':
      return definition.telegraph
    case 'recover':
      return definition.recover
    case 'stagger':
      return definition.staggerSeconds
    case 'dying':
      return CORPSE_SECONDS
    // A strike is an instant, not a window; it plays at whatever speed it was authored at.
    default:
      return null
  }
}

export function planClip(
  phase: EnemyPhase,
  mapping: ClipMapping,
  available: readonly string[],
  definition: EnemyDefinition,
  context: ClipContext,
): ClipPlan {
  const clip = selectClip(phase, mapping, available)
  return {
    clip,
    loop: LOOPING.has(phase),
    timeScale: clip ? clipTimeScale(phase, definition, context) : 1,
    fade: INSTANT.has(phase) ? 0 : DEFAULT_FADE,
  }
}

/**
 * How much to scale an imported model to stand at the height the definition claims.
 *
 * The definition's `height` is what every readability decision in the game was tuned against —
 * a Skulker is small and a Warrior is not, and that difference is how a player tells them apart
 * before they can make out a silhouette. A kit's own scale is an accident of whoever exported
 * it, so it is measured once and corrected here rather than trusted.
 */
export function modelScale(sourceHeight: number, targetHeight: number): number {
  if (!(sourceHeight > 0) || !(targetHeight > 0)) return 1
  return targetHeight / sourceHeight
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
