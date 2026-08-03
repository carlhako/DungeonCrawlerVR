/**
 * Stealth & enemy awareness: how much noise the player is making, and how far away enemies
 * can detect them.
 *
 * Pure functions, unit-tested. The driver in `EnemyDriver.tsx` computes the detection scale
 * from the player's speed and writes it into the AI context; `CombatDriver.tsx` emits noise
 * pulses when a weapon is used.
 *
 * Three things determine whether an idle enemy notices the player:
 *
 * 1. **Line of sight + aggro radius** — scaled by how quietly the player is moving.
 *    At a creep (≤QUIET_SPEED m/s) the radius shrinks to QUIET_DETECTION of full; at a run
 *    (≥LOUD_SPEED m/s) it is the full radius. Being seen is still being seen — LOS within
 *    whatever the effective radius is will trigger aggro.
 *
 * 2. **Noise pulses** — firing or swinging a weapon emits a pulse that alerts every idle
 *    enemy within WEAPON_NOISE_RADIUS with no line of sight required. Shooting breaks stealth
 *    even from behind cover.
 *
 * 3. **Safety valve** — after MAX_IDLE_SECONDS, an idle enemy starts hunting regardless of
 *    detection, so a player who camps somewhere no spawn point can ever see still gets found.
 */

import type { Vec3 } from '@/systems/locomotion'

// ─── thresholds ──────────────────────────────────────────────────────────────

/** m/s below which the player counts as moving quietly. */
export const QUIET_SPEED = 1.0

/** m/s at and above which the player is at full detectability. */
export const LOUD_SPEED = 3.5

/** Multiplier on aggro radius when the player is at or below QUIET_SPEED. */
export const QUIET_DETECTION = 0.4

/**
 * How far a weapon's noise pulse reaches, in metres.
 *
 * Alerts every idle enemy within this distance **without line of sight**, the same way
 * `enemy.alerted` works for a landed hit. Shooting breaks stealth even from behind cover.
 */
export const WEAPON_NOISE_RADIUS = 20

/**
 * Seconds an idle enemy waits before it starts hunting regardless of detection.
 *
 * This is the safety valve, not the primary mechanic. Line of sight and the scaled aggro
 * radius are how most fights begin; this timer is the last-resort guarantee that a player
 * camped somewhere no spawn point can see will not stall the wave forever.
 */
export const MAX_IDLE_SECONDS = 30

// ─── detection scaling ───────────────────────────────────────────────────────

/**
 * Scale the aggro radius based on how fast the player is moving.
 *
 * Quiet (≤QUIET_SPEED): radius is multiplied by QUIET_DETECTION.
 * Loud (≥LOUD_SPEED): full radius.
 * Between: linear interpolation so there is no hard cliff.
 */
export function detectionScale(speed: number): number {
  if (speed <= QUIET_SPEED) return QUIET_DETECTION
  if (speed >= LOUD_SPEED) return 1
  return (
    QUIET_DETECTION +
    (1 - QUIET_DETECTION) * (speed - QUIET_SPEED) / (LOUD_SPEED - QUIET_SPEED)
  )
}

// ─── noise pulses ────────────────────────────────────────────────────────────

export interface NoiseEvent {
  position: Vec3
  radius: number
  remaining: number
}

/**
 * The current noise pulse, if any.
 *
 * Written by `CombatDriver` when a weapon fires or swings; consumed and aged by
 * `EnemyDriver` each step. A module singleton with stable identity, the same pattern
 * as `playerState` and `xrInput`.
 */
export const noiseEvent: NoiseEvent = {
  position: { x: 0, y: 0, z: 0 },
  radius: 0,
  remaining: 0,
}

/** Emit a noise pulse at `position` that reaches `radius` metres. One step only. */
export function emitNoise(position: Vec3, radius: number): void {
  noiseEvent.position.x = position.x
  noiseEvent.position.y = position.y
  noiseEvent.position.z = position.z
  noiseEvent.radius = radius
  noiseEvent.remaining = 1 / 60
}
