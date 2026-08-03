/**
 * Hitstop: the fraction of a second the world holds still when a blow really lands.
 *
 * It is the cheapest punch in games — a kill that briefly stops time reads as heavier than
 * the same kill at full speed, and it costs nothing but a multiplier on the simulation's
 * delta. Nothing here is a pause: the renderer keeps drawing, the head keeps tracking, and
 * the fixed loop resumes with no time debt because the time was never accumulated.
 *
 * **It does not happen in VR, and that is the whole point of `timeScale` taking `inVR`.**
 * On a monitor, the world briefly slowing while the camera holds still is punctuation. In a
 * headset the camera is the player's head and it does *not* hold still — so the world slowing
 * under a head that keeps moving is the vestibular mismatch this project's comfort rules exist
 * to prevent, and it would arrive at the exact moment the player is swinging hardest. VR gets
 * the same information through haptics, the hit flash and the impact burst, none of which
 * touch the relationship between the head and the world.
 *
 * Pure functions over a plain record, plus one live instance in `state.ts`.
 */

/**
 * Longest the world may be slowed for, in seconds.
 *
 * Chosen to be shorter than a fixed step is long at a glance: 90ms is enough to feel and
 * short enough that a player mashing a fast wand never notices the game responding late.
 * Requests are clamped to it, so no combination of a crit and a kill on the same step can
 * stack into something the player experiences as a stutter.
 */
export const MAX_HITSTOP = 0.09

/** How slowly the world runs while stopped. Not zero: a dead freeze reads as a dropped frame. */
export const HITSTOP_SCALE = 0.15

/** A kill is the heaviest thing that happens in a fight, so it gets the longest stop. */
export const KILL_HITSTOP = 0.09
export const CRIT_HITSTOP = 0.05

export interface HitstopState {
  /** Seconds of real time left to run slowly for. */
  remaining: number
}

export function createHitstop(): HitstopState {
  return { remaining: 0 }
}

/**
 * Ask for a stop.
 *
 * The longest request wins rather than the sum, so three enemies dying on the same step is
 * one stop rather than a quarter of a second of slow motion.
 */
export function requestHitstop(state: HitstopState, seconds: number): void {
  if (seconds <= 0) return
  state.remaining = Math.min(MAX_HITSTOP, Math.max(state.remaining, seconds))
}

/** Age by one *rendered* frame's real time — this gates the fixed loop, so it is outside it. */
export function stepHitstop(state: HitstopState, realDelta: number): void {
  state.remaining = Math.max(0, state.remaining - realDelta)
}

/** What to multiply the frame delta by before handing it to the simulation. */
export function timeScale(state: HitstopState, options: { inVR: boolean }): number {
  if (options.inVR) return 1
  return state.remaining > 0 ? HITSTOP_SCALE : 1
}

export function clearHitstop(state: HitstopState): void {
  state.remaining = 0
}
