/**
 * Mana and cooldowns: the two things that decide whether an attack is allowed to happen.
 *
 * They answer different questions and are kept apart on purpose. A cooldown is per weapon
 * and says "not that fast" — it is `rate` from the weapon table, which is the stat the shop
 * sells upgrades to. Mana is one shared pool and says "not that much" — it is what stops
 * both hands firing forever and what makes a melee weapon a real choice rather than a
 * fallback.
 *
 * One pool for the whole player rather than one per hand. Two pools means the optimal play
 * is always to alternate hands, which is a dexterity exercise, not a decision.
 */

export const MANA_MAX = 100

/** Per second, once regeneration has started. Full pool from empty in about eight seconds. */
export const MANA_REGEN = 12

/**
 * Seconds after a spend before regeneration resumes.
 *
 * Without it, a rapid weapon's regen is simply subtracted from its cost and the pool becomes
 * a slightly slower cooldown. The delay is what makes emptying the pool a thing that
 * happened to you rather than a rounding error.
 */
export const MANA_REGEN_DELAY = 0.9

export interface ManaPool {
  current: number
  max: number
  /** Seconds since the last spend. Counts up; regen waits on it. */
  sinceSpend: number
}

export function createManaPool(max = MANA_MAX): ManaPool {
  return { current: max, max, sinceSpend: MANA_REGEN_DELAY }
}

/** Age the pool by one fixed step. Mutates in place — this runs sixty times a second. */
export function stepMana(pool: ManaPool, dt: number, regen = MANA_REGEN): void {
  pool.sinceSpend += dt
  if (pool.sinceSpend < MANA_REGEN_DELAY) return
  pool.current = Math.min(pool.max, pool.current + regen * dt)
}

export function canAfford(pool: ManaPool, cost: number): boolean {
  // A zero-cost attack is always affordable, including on an empty pool. That is the melee
  // case, and it is the reason a player who has run dry still has something to do.
  return cost <= 0 || pool.current >= cost
}

/** Spend if affordable. Returns whether it went through; the caller must not fire if not. */
export function spendMana(pool: ManaPool, cost: number): boolean {
  if (!canAfford(pool, cost)) return false
  if (cost > 0) {
    pool.current = Math.max(0, pool.current - cost)
    pool.sinceSpend = 0
  }
  return true
}

/**
 * Seconds between attacks for a weapon firing at `rate` per second.
 *
 * Guarded against a zero or nonsense rate from a stale save rather than trusting the table:
 * the failure mode is a division by zero that turns into an infinite cooldown, and a weapon
 * that silently never fires again is the hardest possible bug to report from inside a
 * headset.
 */
export function cooldownFor(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 1
  return 1 / rate
}

export interface Cooldown {
  /** Seconds until the next attack is allowed. */
  remaining: number
}

export function stepCooldown(cooldown: Cooldown, dt: number): void {
  if (cooldown.remaining > 0) cooldown.remaining = Math.max(0, cooldown.remaining - dt)
}

export function ready(cooldown: Cooldown): boolean {
  return cooldown.remaining <= 0
}

/**
 * Start the cooldown for a weapon that just fired.
 *
 * Set rather than accumulated. Adding to whatever was left lets a hair-trigger player build
 * a queue of cooldown they can never pay off, and the weapon appears to jam.
 */
export function beginCooldown(cooldown: Cooldown, rate: number): void {
  cooldown.remaining = cooldownFor(rate)
}

/** 0..1, for anything drawing a cooldown wheel. 1 means ready. */
export function cooldownProgress(cooldown: Cooldown, rate: number): number {
  const full = cooldownFor(rate)
  if (full <= 0) return 1
  return Math.max(0, Math.min(1, 1 - cooldown.remaining / full))
}
