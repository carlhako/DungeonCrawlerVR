/**
 * How dissolved a body is, from the AI phase it is in.
 *
 * The arithmetic behind the dissolve shader, kept out of the component that draws it for the
 * usual reason: "does a corpse finish dissolving before its slot is recycled" is a question
 * about two numbers, and answering it in a headset is a poor use of an evening. The shader
 * itself lives in `src/entities/Enemies.tsx`; this decides what to hand it.
 *
 * One value covers both ends of a life. Something arriving materialises *in* — it starts
 * fully dissolved and resolves into a body — and something dying dissolves *out*. Both are
 * the same edge burning across the same noise field, run in opposite directions, which is
 * also why they read as related events rather than as two unrelated effects.
 */

/**
 * How far past fully-dissolved the ramp is allowed to go.
 *
 * The noise the shader samples is in 0..1, so a threshold of exactly 1 still leaves the few
 * fragments that happen to sample 1.0. Overshooting guarantees the last speck is gone before
 * the slot is recycled, rather than leaving a fleck of skeleton hanging in the corridor.
 */
export const DISSOLVE_MAX = 1.08

export interface DissolveInput {
  phase: string
  /** Seconds spent in the current phase. */
  timer: number
  /** How long arriving takes. */
  spawnSeconds: number
  /** How long a corpse lingers. */
  corpseSeconds: number
}

/**
 * 0 is a solid body; 1 is gone.
 *
 * Dying is deliberately *not* linear across the whole corpse time: the body holds together
 * for the first stretch while it falls over, and then goes. A corpse that starts dissolving on
 * the frame it dies never reads as a corpse at all, and the fall is half of what tells the
 * player the thing is dead.
 */
export const DEATH_HOLD_FRACTION = 0.35

export function dissolveAmount(input: DissolveInput): number {
  if (input.phase === 'spawning') {
    const t = input.spawnSeconds > 0 ? clamp01(input.timer / input.spawnSeconds) : 1
    return (1 - t) * DISSOLVE_MAX
  }

  if (input.phase === 'dying') {
    const t = input.corpseSeconds > 0 ? clamp01(input.timer / input.corpseSeconds) : 1
    if (t <= DEATH_HOLD_FRACTION) return 0
    return ((t - DEATH_HOLD_FRACTION) / (1 - DEATH_HOLD_FRACTION)) * DISSOLVE_MAX
  }

  return 0
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
