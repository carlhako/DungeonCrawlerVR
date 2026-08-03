/**
 * One hand holding one weapon, and the decision of whether it is allowed to attack.
 *
 * This is the small, boring, load-bearing part of combat. Everything the player experiences
 * as "the weapon didn't fire" is decided here, and there are only four reasons it can
 * happen: nothing equipped, still cooling down, not enough mana, or — for melee — that
 * wasn't a swing. Each one is named and returned rather than expressed as a bare `false`,
 * because a refusal the game cannot name is a refusal it cannot show the player, and Sprint
 * 1.1 already established what an unexplained non-response reads as: a bug.
 *
 * Pure, and mutating only the state object it is handed. The driver in `CombatDriver.tsx`
 * owns *where* the hand is and what to draw; this owns whether anything happens.
 */

import type { WeaponDefinition, WeaponId, WeaponStats, Hand } from '@/data/weapons'
import { WEAPONS, weaponStats } from '@/data/weapons'
import type { UpgradeAxis } from '@/data/weapons'
import {
  beginCooldown,
  canAfford,
  ready,
  spendMana,
  stepCooldown,
  type Cooldown,
  type ManaPool,
} from '@/systems/combat/resources'
import { createSwingTracker, resetSwing, swingPower, type SwingTracker } from '@/systems/combat/melee'

export interface HandWeapon {
  hand: Hand
  weaponId: WeaponId | null
  cooldown: Cooldown
  swing: SwingTracker
  /** Purely for feedback: the last refusal, and how long ago, so the HUD can say it. */
  lastRefusal: AttackRefusal | null
  sinceRefusal: number
}

export function createHandWeapon(hand: Hand): HandWeapon {
  return {
    hand,
    weaponId: null,
    cooldown: { remaining: 0 },
    swing: createSwingTracker(),
    lastRefusal: null,
    sinceRefusal: 0,
  }
}

export type AttackRefusal = 'unarmed' | 'cooldown' | 'mana' | 'too-slow'

export interface AttackAttempt {
  ok: boolean
  reason: AttackRefusal | null
  /** Damage multiplier for the attack that just happened. 1 for anything ranged. */
  power: number
}

const REFUSED = (reason: AttackRefusal): AttackAttempt => ({ ok: false, reason, power: 0 })

/**
 * Swap what this hand is holding.
 *
 * The cooldown carries over rather than being cleared, so swapping weapons is not a way to
 * fire twice at once. The swing tracker is reset, because the new weapon's tip is somewhere
 * else entirely and the difference between the two would read as a swing at several hundred
 * metres per second.
 */
export function equipHand(state: HandWeapon, weaponId: WeaponId | null): void {
  if (state.weaponId === weaponId) return
  state.weaponId = weaponId
  resetSwing(state.swing)
}

/** Age this hand by one fixed step. */
export function stepHandWeapon(state: HandWeapon, dt: number): void {
  stepCooldown(state.cooldown, dt)
  if (state.lastRefusal) state.sinceRefusal += dt
}

function refuse(state: HandWeapon, reason: AttackRefusal): AttackAttempt {
  state.lastRefusal = reason
  state.sinceRefusal = 0
  return REFUSED(reason)
}

/** The weapon in this hand, or null. */
export function heldWeapon(state: HandWeapon): WeaponDefinition | null {
  return state.weaponId ? WEAPONS[state.weaponId] : null
}

/** The held weapon's stats with the player's purchased upgrades applied. */
export function heldStats(
  state: HandWeapon,
  upgrades: Partial<Record<UpgradeAxis, number>> = {},
): WeaponStats | null {
  return state.weaponId ? weaponStats(state.weaponId, upgrades) : null
}

/**
 * Pull the trigger on a ranged weapon.
 *
 * Mana is checked *and spent* here, in that order, in one place. Checking in the driver and
 * spending here — or the reverse — is how a weapon ends up firing on an empty pool one step
 * in three, which is the kind of bug that only shows up when somebody is actually playing.
 */
export function tryFire(
  state: HandWeapon,
  stats: WeaponStats,
  mana: ManaPool,
  manaCost: number,
): AttackAttempt {
  if (!state.weaponId) return refuse(state, 'unarmed')
  if (!ready(state.cooldown)) return refuse(state, 'cooldown')
  if (!canAfford(mana, manaCost)) return refuse(state, 'mana')

  spendMana(mana, manaCost)
  beginCooldown(state.cooldown, stats.rate)
  state.lastRefusal = null
  return { ok: true, reason: null, power: 1 }
}

/**
 * Is the blade cutting right now?
 *
 * Called every fixed step while a melee weapon is held — the player never presses anything,
 * the blade is simply moving or it isn't — so the common answer by an enormous margin is
 * "too slow", and that must be cheap and must not spam the refusal feedback. Hence the order:
 * the speed test comes first and does not record a refusal, because carrying a sword around
 * is not an attempt to attack. A cooldown refusal *is* recorded: there the player did swing,
 * and deserves to be told why nothing happened.
 *
 * **This deliberately does not start the cooldown** — `commitSwing` does, once something has
 * actually been hit. The first version started it here, which meant a swing was spent on the
 * single fixed step where its speed first crossed the floor: nine centimetres of arc, near
 * the *start* of the movement, which is exactly where the blade is furthest from what it is
 * being swung at. The sword measurably swung, the tests passed, and it hit nothing.
 *
 * With the cooldown on the hit instead, the window stays open across the fast part of the
 * arc and closes when it connects. Swinging at air costs nothing, which is correct; swinging
 * into something costs a full swing, which is what stops waggling.
 */
export function swingWindow(state: HandWeapon, speed: number): AttackAttempt {
  if (!state.weaponId) return REFUSED('unarmed')

  const power = swingPower(speed)
  if (power <= 0) return REFUSED('too-slow')

  if (!ready(state.cooldown)) return refuse(state, 'cooldown')

  return { ok: true, reason: null, power }
}

/** Spend the swing. Called once a hit has landed. */
export function commitSwing(state: HandWeapon, stats: WeaponStats): void {
  beginCooldown(state.cooldown, stats.rate)
  state.lastRefusal = null
}

/** What a refusal is called on a panel or in the HUD. */
export const REFUSAL_TEXT: Record<AttackRefusal, string> = {
  unarmed: 'Nothing equipped',
  cooldown: 'Not ready',
  mana: 'Out of mana',
  'too-slow': 'Swing harder',
}
