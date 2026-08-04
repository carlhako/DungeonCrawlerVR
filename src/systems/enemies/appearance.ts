/**
 * What an enemy looks like right now, from what it is doing.
 *
 * Extracted out of `Enemies.tsx` in Sprint 2.7, and the extraction is the point. There are now
 * two things that can be drawn for one pool slot — the primitive body, and a model out of the
 * CC0 kit — and every rule about *reading* an enemy across a dark room has to hold for both.
 * A hit flash that only works on the material we built ourselves, or a wind-up whose eyes only
 * flare on the capsule, is the exact failure PLAN.md calls "the most likely thing to break
 * silently": nothing throws, the game still runs, and the player loses the information they
 * were using to survive.
 *
 * So the rules live here, in one pure function with no three.js in it, and both renderers are
 * consumers. If the model path and the primitive path ever disagree about how bright a
 * telegraph is, it is because one of them stopped calling this.
 *
 * Nothing here allocates: `resolveAppearance` writes into a record the caller owns, because it
 * runs once per visible slot per rendered frame and a fresh object at 90Hz × 10 slots is a
 * mobile GC pause during a fight.
 */

import { CORPSE_SECONDS, SPAWN_SECONDS, type EnemyDefinition } from '@/data/enemies'
import type { EnemyPhase } from '@/systems/enemies/pool'
import { dissolveAmount } from '@/systems/fx/dissolve'

/** How far an enemy rears back at the top of its wind-up, in radians. */
export const TELEGRAPH_LEAN = 0.45

/** How far a corpse sinks into the floor before its slot is recycled, in metres. */
export const CORPSE_SINK = 0.9

/**
 * Extra emissive an imported model gets at the top of a wind-up.
 *
 * The capsule carries the telegraph in three channels: the lean, the eyes and the halo. A model
 * out of the kit has a lean and a halo, but no eyes this game can address — they are painted on
 * a texture somebody else authored. Losing a channel on the single read the player's survival
 * depends on is exactly the regression PLAN.md warns about, so the body's own glow takes it
 * over: a skeleton about to swing brightens.
 *
 * Kept small. At ACES tone-mapping any per-channel value much above 1.0 compresses into the
 * same near-white output, which is the whole of what "washed out" reads as on the headset —
 * 1.6 pushed every model into saturation at full wind. 0.3 is bright enough to read as a flare,
 * low enough to leave the kit's textures alone.
 */
export const MODEL_WIND_GLOW = 0.3

/** Emissive colours for the states that override the body's own. */
const FLASH_COLOUR = '#ffffff'
const BURNING_COLOUR = '#ff6a1f'
const CHILLED_COLOUR = '#8fd8ff'

export interface AppearanceInput {
  phase: EnemyPhase
  /** Seconds in the current phase. */
  timer: number
  /** Seconds of hit flash remaining. */
  flash: number
  burning: boolean
  chilled: boolean
  /** Horizontal speed, m/s. Drives the walk bob and the chase clip's playback rate. */
  speed: number
  /** Per-enemy constant, so a pack does not flicker in lockstep. */
  seed: number
}

export interface EnemyAppearance {
  /** 0 is a solid body, 1 is gone. The uniform every body material is handed. */
  dissolve: number
  /** 0..1, for the parts that are light rather than body. Eyes and halo fade; bodies dissolve. */
  presence: number
  /** How far through this life's ending, 0..1. Drives the fall and the sink. */
  dying: number
  /** How far through a wind-up, 0..1. Zero in every other phase. */
  wind: number
  /** Metres the whole body has sunk into the floor. */
  sink: number
  /** Pitch of the body, radians: the rear-back, the follow-through and the fall. */
  lean: number
  /** Body tint. */
  colour: string
  /** Emissive tint — the flash, the burn and the chill all speak through this. */
  emissive: string
  emissiveIntensity: number
  /** The eyes, which carry the wind-up and are the last thing to go out. */
  eyeIntensity: number
  eyeOpacity: number
  /** The additive glow that makes something visible before the torchlight reaches it. */
  haloOpacity: number
}

export function createAppearance(): EnemyAppearance {
  return {
    dissolve: 0,
    presence: 1,
    dying: 0,
    wind: 0,
    sink: 0,
    lean: 0,
    colour: '#ffffff',
    emissive: '#ffffff',
    emissiveIntensity: 0,
    eyeIntensity: 0,
    eyeOpacity: 1,
    haloOpacity: 0,
  }
}

/**
 * How far through dying an enemy is, 0..1.
 *
 * Its own function because the transform and the materials both need it and they are resolved
 * in different components — one number, not two that agree today.
 */
export function corpseFraction(phase: EnemyPhase, timer: number): number {
  if (phase !== 'dying') return 0
  return CORPSE_SECONDS > 0 ? Math.min(1, timer / CORPSE_SECONDS) : 1
}

/**
 * Writes this frame's appearance into `out`.
 *
 * `elapsed` is wall-clock render time, used only for the eye flicker — a slow shimmer that
 * stops a stationary enemy in an unlit corridor reading as scenery.
 */
export function resolveAppearance(
  out: EnemyAppearance,
  input: AppearanceInput,
  definition: EnemyDefinition,
  elapsed: number,
): EnemyAppearance {
  const { phase, timer } = input

  // Arriving and dying are both fades, and both are why the slot is not hittable at the time.
  // Something that pops into existence is a startle with no information in it; something that
  // vanishes on the frame it dies leaves the player unsure they killed it.
  const arriving = phase === 'spawning' && SPAWN_SECONDS > 0 ? Math.min(1, timer / SPAWN_SECONDS) : 1
  const dying = corpseFraction(phase, timer)

  out.dying = dying
  out.presence = arriving * (1 - dying)
  out.sink = dying * CORPSE_SINK
  out.dissolve = dissolveAmount({
    phase,
    timer,
    spawnSeconds: SPAWN_SECONDS,
    corpseSeconds: CORPSE_SECONDS,
  })

  const wind =
    phase === 'telegraph' && definition.telegraph > 0 ? Math.min(1, timer / definition.telegraph) : 0
  out.wind = wind

  if (dying > 0) {
    // Corpses fall over, hinged at the feet like the training dummies.
    out.lean = -1.4 * Math.min(1, dying * 3)
  } else {
    // The telegraph, made visible. It rears back through the wind-up and is furthest back at
    // the moment it commits — the read the player has to be able to make from six metres away
    // in the dark, and the whole reason the wind-up exists.
    const swinging = phase === 'strike' || phase === 'recover'
    const follow = swinging ? Math.max(0, 1 - timer * 5) : 0
    const flinch = phase === 'stagger' ? 0.35 : 0
    out.lean = TELEGRAPH_LEAN * wind - 0.7 * follow + flinch
  }

  out.colour = definition.colour
  out.emissive = input.flash > 0
    ? FLASH_COLOUR
    : input.burning
      ? BURNING_COLOUR
      : input.chilled
        ? CHILLED_COLOUR
        : definition.colour
  out.emissiveIntensity =
    (input.flash > 0 ? 2.6 : definition.glow) + (input.burning ? 0.5 : 0) + (input.chilled ? 0.2 : 0)

  // The eyes carry the state, and they are the most informative thing on the model. The dungeon
  // is lit by six torches, and something approaching between two of them is otherwise genuinely
  // invisible — which is not tension, it is the game failing to say anything at all.
  //
  // Kept modest at idle — anything much above ~2 on the primitive's white-diffuse, untone-mapped
  // eye material saturates every channel to 1 and the orange-red gets lost. Tone mapping the
  // eye material (see `EnemyShape.tsx`) lets the colour survive higher values, but a baseline
  // of 0.5 and a wind-up boost of 2 still reads as a flare at the top of the telegraph without
  // bleaching the eye colour to white.
  const flicker = 0.9 + 0.1 * Math.sin(elapsed * 2 + input.seed)
  out.eyeIntensity = (0.5 + 2 * wind) * flicker * out.presence
  out.eyeOpacity = out.presence

  // A soft additive glow, for the same reason the torches have one: visible at any distance for
  // the cost of one draw. It swells with the wind-up too.
  out.haloOpacity = 0.1 * out.presence * (1 + wind * 1.4)

  return out
}
