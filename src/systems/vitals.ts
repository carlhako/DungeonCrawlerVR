/**
 * The player's health.
 *
 * It arrives in Sprint 2.3 rather than 2.2 because until this sprint nothing could hurt you,
 * and health that only ever reads 100% is a number in search of a mechanic. The run machine
 * has had a `death` state since 1.2 with nothing able to send it; this is what sends it.
 *
 * Three rules, and all three exist because of how VR combat actually goes wrong:
 *
 * 1. **Invulnerability frames.** Three things reaching you on the same fixed step would deal
 *    their damage on the same fixed step, and a player can no more react to 3×18 in 16ms than
 *    to a crash. A short window after any hit means a pack is dangerous because it is
 *    *relentless*, not because it is instantaneous.
 * 2. **Health is restored on returning to the foyer, not over time.** Regeneration during a
 *    wave rewards backing into a corridor and waiting, which is the least interesting thing a
 *    player can do in a horror game. The foyer is the safe room; that is what it is for.
 * 3. **Nothing is lost on death** — see `run.ts`. Death costs the wave and nothing else, and
 *    that is a decision, not an oversight.
 *
 * Pure functions over a plain record, plus one module singleton for the live player. The same
 * pattern as `playerState` and for the same reason: read sixty times a second by the vitals
 * band and the enemies, and none of it should re-render anything.
 */

import type { ResolvedDamage } from '@/systems/combat/damage'

export const PLAYER_MAX_HP = 100

/**
 * How long the player cannot be hurt again after being hurt, in seconds.
 *
 * Long enough that a pack cannot chain-hit you into the floor, short enough that standing in
 * the middle of one is still a mistake. It is deliberately shorter than the fastest enemy's
 * recovery (the Skulker's 1.1s), so it never makes a single attacker harmless.
 */
export const INVULNERABLE_SECONDS = 0.5

/** How long the damage flash reads for. Punctuation, not a state. */
export const HURT_SECONDS = 0.55

export interface Vitals {
  hp: number
  max: number
  /** Seconds of invulnerability left. */
  invulnerable: number
  /** 0..1, decaying — what the vitals band and the hurt flash read. */
  hurt: number
  /** The most recent hit that actually landed, for feedback. */
  lastAmount: number
}

export function createVitals(max = PLAYER_MAX_HP): Vitals {
  return { hp: max, max, invulnerable: 0, hurt: 0, lastAmount: 0 }
}

export function isAlive(vitals: Vitals): boolean {
  return vitals.hp > 0
}

export function healthFraction(vitals: Vitals): number {
  return Math.max(0, Math.min(1, vitals.hp / vitals.max))
}

/** Age the timers by one fixed step. */
export function stepVitals(vitals: Vitals, dt: number): void {
  vitals.invulnerable = Math.max(0, vitals.invulnerable - dt)
  if (vitals.hurt > 0) vitals.hurt = Math.max(0, vitals.hurt - dt / HURT_SECONDS)
}

export interface HurtResult {
  /** False when the hit was inside the invulnerability window and did nothing. */
  applied: boolean
  amount: number
  /** True on the one hit that took the player to zero. */
  killed: boolean
}

/**
 * Take health off the player.
 *
 * Takes a `ResolvedDamage` rather than a bare number so that enemy attacks go through the same
 * `resolveDamage` the player's own weapons do — element, resistance and rounding included.
 * The player is deliberately **not** in the damageable registry: they would be swept by their
 * own projectiles and cut by their own sword, and a floating damage number would appear
 * inside their face. This is the one place health leaves the player, and it is the mirror of
 * `applyDamage`, not a second copy of it.
 */
export function hurtPlayer(vitals: Vitals, damage: ResolvedDamage): HurtResult {
  if (vitals.hp <= 0) return { applied: false, amount: 0, killed: false }
  if (vitals.invulnerable > 0) return { applied: false, amount: 0, killed: false }

  const wasAlive = vitals.hp > 0
  vitals.hp = Math.max(0, vitals.hp - damage.amount)
  vitals.invulnerable = INVULNERABLE_SECONDS
  vitals.hurt = 1
  vitals.lastAmount = damage.amount

  return { applied: true, amount: damage.amount, killed: wasAlive && vitals.hp <= 0 }
}

/** Back to full, with nothing carried over. Called when the player reaches the foyer. */
export function resetVitals(vitals: Vitals): void {
  vitals.hp = vitals.max
  vitals.invulnerable = 0
  vitals.hurt = 0
  vitals.lastAmount = 0
}

/** The live player's vitals. One per game, mutated in place. */
export const playerVitals = createVitals()
