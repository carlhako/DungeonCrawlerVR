/**
 * The damage pipeline: one path from "something hit something" to "the target lost health".
 *
 * Every attack in the game funnels through `resolveDamage`, whatever produced it — a
 * projectile, a sword tip, a burning status ticking, and in Sprint 2.3 an enemy's claw. That
 * is the point of it. Crit, element, resistance and status are four rules that each want to
 * apply "just this once, for my case", and the moment two of them are implemented in two
 * places the game acquires a weapon that cannot crit and an enemy immune to nothing.
 *
 * Pure and free of three.js. A damage formula is arithmetic, and arithmetic that can only be
 * checked by hitting a dummy in a headset is arithmetic that does not get checked.
 */

import type { Element, StatusKind } from '@/data/elements'
import { ELEMENT_STATUS, STATUS_RULES } from '@/data/elements'
import type { Hand, WeaponId } from '@/data/weapons'
import type { Vec3 } from '@/systems/locomotion'

/**
 * What a critical hit is worth.
 *
 * Double, and not a number that needs explaining. Crit chance is the interesting dial — it
 * is what the shop sells — and a multiplier the player has to memorise makes every purchase
 * decision worse rather than deeper.
 */
export const CRIT_MULTIPLIER = 2

/** Resistance is capped so nothing is ever fully immune, and vulnerability is capped too. */
export const MAX_RESISTANCE = 0.85
export const MAX_VULNERABILITY = -1

/** Fraction of incoming damage removed, by element. Negative means it hurts more. */
export type Resistances = Partial<Record<Element, number>>

/** Who or what threw the punch. Carried through so Sprint 2.4 can key VFX off it. */
export interface DamageSource {
  kind: 'projectile' | 'melee' | 'status'
  weaponId: WeaponId | null
  hand: Hand | null
}

/** An attack, before it meets a target. */
export interface DamageSpec {
  /** Damage at full strength, from `weaponStats`. */
  base: number
  element: Element
  /** 0..1. */
  critChance: number
  /**
   * Scales `base` before the crit roll. This is where a melee swing's speed lands, and later
   * a charged shot's charge — anything that says "this particular attack was stronger than
   * the weapon's nominal number".
   */
  power?: number
  source: DamageSource
}

/** An attack after resistance and the crit roll, but before a target's health changes. */
export interface ResolvedDamage {
  amount: number
  element: Element
  crit: boolean
  /** The status this hit applies, if the element has one. */
  status: StatusKind | null
  source: DamageSource
}

/** A resolved hit that has actually landed on something. What the rest of the game reacts to. */
export interface DamageEvent extends ResolvedDamage {
  targetId: string
  /** Where it landed, in world space — for the damage number and 2.4's impact VFX. */
  point: Vec3
  /** The target's health after this event. */
  remaining: number
  /** True on the one event that took the target to zero. */
  killed: boolean
}

export function clampResistance(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(MAX_VULNERABILITY, Math.min(MAX_RESISTANCE, value))
}

/**
 * Turn an attack into a number, given who it hit.
 *
 * `rand` is injected rather than reaching for `Math.random`, for the same reason the dungeon
 * generator takes a seeded RNG: a crit is the one part of this that isn't deterministic, and
 * a test that cannot pin it can only assert ranges.
 *
 * The result is **rounded to a whole number here**, not at display time. The player is shown
 * this figure and the target loses exactly it; a damage number that says 14 while 13.6 came
 * off is a bug report nobody can reproduce and a health bar that never quite adds up.
 */
export function resolveDamage(
  spec: DamageSpec,
  resistances: Resistances = {},
  rand: () => number = Math.random,
): ResolvedDamage {
  const power = spec.power ?? 1
  const crit = spec.critChance > 0 && rand() < spec.critChance
  const resistance = clampResistance(resistances[spec.element] ?? 0)

  const raw = spec.base * power * (crit ? CRIT_MULTIPLIER : 1) * (1 - resistance)

  return {
    // A landed hit always takes at least one point. Chip damage against a resistant target is
    // frustrating; a hit that visibly connects and does *nothing* reads as a broken weapon.
    amount: Math.max(1, Math.round(raw)),
    element: spec.element,
    crit,
    status: ELEMENT_STATUS[spec.element],
    source: spec.source,
  }
}

/**
 * A status effect currently on a target.
 *
 * Refreshed rather than stacked — see `STATUS_RULES`. Held as a small array rather than a map
 * because there are two kinds of them and iteration order matters more than lookup speed.
 */
export interface StatusState {
  kind: StatusKind
  /** Seconds left. */
  remaining: number
  magnitude: number
}

/** Apply or refresh a status. Returns the list, mutated in place. */
export function applyStatus(list: StatusState[], kind: StatusKind): StatusState[] {
  const rule = STATUS_RULES[kind]
  const existing = list.find((status) => status.kind === kind)
  if (existing) {
    existing.remaining = rule.seconds
    existing.magnitude = rule.magnitude
    return list
  }
  list.push({ kind, remaining: rule.seconds, magnitude: rule.magnitude })
  return list
}

/**
 * Age every status by `dt`, dropping the expired ones, and report the damage they dealt.
 *
 * Damage-over-time is returned rather than applied, so that the caller puts it through the
 * same `applyDamage` path as everything else. A status that subtracts health directly is a
 * status whose kills don't count, don't drop loot and don't play a death animation.
 */
export function stepStatuses(list: StatusState[], dt: number): number {
  let damage = 0
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const status = list[i]!
    const slice = Math.min(dt, status.remaining)
    if (status.kind === 'burning') damage += status.magnitude * slice
    status.remaining -= dt
    if (status.remaining <= 0) list.splice(i, 1)
  }
  return damage
}

/**
 * How much of its speed a chilled target keeps, 0..1.
 *
 * Read by the enemy movement in Sprint 2.3. It exists now because the Frostbrand's whole
 * identity is this number, and a weapon that "chills on hit" with nothing reading the chill
 * is a weapon with a lie in its blurb.
 */
export function chillFactor(list: readonly StatusState[]): number {
  const chill = list.find((status) => status.kind === 'chilled')
  if (!chill) return 1
  return Math.max(0.1, 1 - chill.magnitude)
}

export function hasStatus(list: readonly StatusState[], kind: StatusKind): boolean {
  return list.some((status) => status.kind === kind)
}
