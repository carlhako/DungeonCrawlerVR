/**
 * Torch flicker.
 *
 * Pure, deterministic and unit-tested, because a light that occasionally spikes to twice its
 * intensity or drops to black is a genuinely unpleasant bug in a headset, and it is not
 * something you can catch by looking at a still frame.
 *
 * Sprint 3.1 owns the light *budget* (only the N nearest torches stay real lights). This is
 * only the waveform.
 */

export interface FlickerConfig {
  /** Multiplier at the calm end of the cycle. */
  min: number
  /** Multiplier at the bright end. */
  max: number
  /** Cycles per second of the dominant wobble. */
  speed: number
}

export const DEFAULT_FLICKER: FlickerConfig = {
  // Never fully dark, and never a flash. A torch gutters; it doesn't strobe.
  min: 0.78,
  max: 1.12,
  speed: 2.4,
}

/**
 * Intensity multiplier for a torch at a given time.
 *
 * Three sine waves at incommensurable frequencies, which is enough to never visibly repeat
 * while costing three trig calls — cheaper and steadier than sampling noise, and with no
 * risk of the discontinuities that make a light pop.
 *
 * `seed` offsets the phase so a row of torches doesn't pulse in unison, which instantly
 * reads as a shader effect rather than as fire.
 */
export function flicker(time: number, seed = 0, config: FlickerConfig = DEFAULT_FLICKER): number {
  const t = time * config.speed + seed * 7.13
  const wave =
    Math.sin(t) * 0.5 + Math.sin(t * 2.37 + 1.7) * 0.32 + Math.sin(t * 5.11 + 4.1) * 0.18
  // `wave` spans roughly ±1; fold it into 0..1 before mapping into the configured range.
  const normalised = wave * 0.5 + 0.5
  const clamped = Math.min(1, Math.max(0, normalised))
  return config.min + (config.max - config.min) * clamped
}
