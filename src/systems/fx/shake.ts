/**
 * Screenshake — **desktop only, and enforced here rather than at the call site.**
 *
 * The rule this project has held since Sprint 0.3 is that nothing moves the VR camera except
 * the player's head. Screenshake is the single most common violation of it in games, it is
 * one of the fastest ways to make somebody ill in a headset, and it is exactly the kind of
 * thing that gets added back later by someone wiring up a new source of impact. So `sampleShake`
 * takes `inVR` and returns zeros, and there is a test that says so — a component that forgets
 * the rule cannot break it.
 *
 * Trauma-based rather than a per-event timer: sources *add* trauma, trauma decays on its own,
 * and the offset is trauma squared. Squaring is what makes a small hit almost imperceptible
 * and a kill land, from one number and with no per-source tuning.
 */

/** How much trauma bleeds off per second. A full-strength shake is over in well under a second. */
export const TRAUMA_DECAY = 2.2

/**
 * Peak yaw/pitch and peak roll, both in radians, at full trauma.
 *
 * Angular rather than positional. A camera shoved 5cm sideways in a corridor 2m wide clips
 * its near plane through the wall it is standing next to; a camera *rotated* by three degrees
 * reads as exactly the same jolt and cannot end up inside anything. Roll is smaller than the
 * other two on purpose — a rolling horizon is the component that reads as a gimmick.
 */
export const MAX_ANGLE = 0.05
export const MAX_ROLL = 0.03

/** What each thing that shakes the view is worth. */
export const Trauma = {
  hit: 0.16,
  crit: 0.3,
  kill: 0.36,
  hurt: 0.55,
} as const

export interface ShakeState {
  /** 0..1. */
  trauma: number
  /** Seconds, only ever used to drive the noise. */
  time: number
}

export interface ShakeOffset {
  /** Radians added to the camera's yaw. */
  x: number
  /** Radians added to the camera's pitch. */
  y: number
  /** Radians of roll. */
  roll: number
}

export function createShake(): ShakeState {
  return { trauma: 0, time: 0 }
}

export function addTrauma(state: ShakeState, amount: number): void {
  state.trauma = Math.max(0, Math.min(1, state.trauma + amount))
}

export function stepShake(state: ShakeState, dt: number): void {
  state.time += dt
  state.trauma = Math.max(0, state.trauma - TRAUMA_DECAY * dt)
}

/**
 * How far the camera should be knocked off its aim this frame.
 *
 * Deterministic — summed sines rather than `Math.random` — for two reasons. A random offset
 * per frame is white noise, which reads as a buzz rather than a shock; and a shake that
 * depends on the RNG is a shake no test can pin. Writes into `out` so the render loop
 * allocates nothing.
 */
export function sampleShake(
  state: ShakeState,
  out: ShakeOffset,
  options: { inVR: boolean },
): ShakeOffset {
  out.x = 0
  out.y = 0
  out.roll = 0

  // The comfort rule, in the one place every caller has to go through.
  if (options.inVR) return out
  if (state.trauma <= 0) return out

  const magnitude = state.trauma * state.trauma
  const t = state.time

  out.x = magnitude * MAX_ANGLE * (Math.sin(t * 47.3) * 0.6 + Math.sin(t * 29.1) * 0.4)
  out.y = magnitude * MAX_ANGLE * (Math.sin(t * 53.7 + 1.7) * 0.6 + Math.sin(t * 31.9 + 0.4) * 0.4)
  out.roll = magnitude * MAX_ROLL * Math.sin(t * 41.1 + 2.3)

  return out
}

export function clearShake(state: ShakeState): void {
  state.trauma = 0
}
