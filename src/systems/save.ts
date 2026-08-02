/**
 * The game save: gold, weapons, upgrades, loadout, and how far the player has got.
 *
 * Every function here is pure and operates on a plain `SaveData`. The zustand store in
 * `game.ts` is a thin wrapper over them. That split is deliberate: the economy is the one
 * part of a roguelite where a bug is unforgivable in both directions — gold that vanishes
 * costs the player an evening, gold that multiplies costs the game its entire progression —
 * and none of it should need a browser, a React tree or a headset to test.
 *
 * Kept separate from `settings.ts` on purpose. Settings describe the machine and the
 * player's comfort; this describes the run. Wiping one must never wipe the other, which is
 * why they have their own storage keys and their own version numbers.
 *
 * **Progression is pure RPG: nothing here is ever lost.** Dying returns the player to the
 * foyer with everything intact. There is no "lose your gold on death" path in this file
 * because there is not supposed to be one anywhere.
 */

import {
  STARTER_WEAPON,
  WEAPONS,
  isUpgradeAxis,
  isWeaponId,
  upgradeCost,
  upgradeTrack,
  type Hand,
  type UpgradeAxis,
  type WeaponId,
} from '@/data/weapons'

export const STARTING_GOLD = 100

/**
 * A ceiling on gold, so a corrupt or hand-edited save can't put the player somewhere the
 * arithmetic stops being exact. Well above anything the wave payouts can reach.
 */
export const GOLD_MAX = 9_999_999

/** What the player owns of one weapon. Presence in the map *is* ownership. */
export interface WeaponSave {
  /** Purchased level per axis. Absent means level 0. */
  upgrades: Partial<Record<UpgradeAxis, number>>
}

export interface SaveData {
  gold: number
  /** Owned weapons only. Unowned weapons are absent, not present-with-a-flag. */
  weapons: Partial<Record<WeaponId, WeaponSave>>
  equipped: Record<Hand, WeaponId | null>
  /** The next wave to attempt, 1-based. */
  wave: number
  /** Highest wave cleared. Never decreases. */
  bestWave: number
}

/**
 * Bumped whenever the stored shape changes.
 *
 * v1 — gold, weapons, upgrades, loadout, wave counters.
 */
export const SAVE_VERSION = 1

export const SAVE_STORAGE_KEY = 'dcvr.save'

export function newSave(): SaveData {
  return {
    gold: STARTING_GOLD,
    weapons: { [STARTER_WEAPON]: { upgrades: {} } },
    equipped: { main: STARTER_WEAPON, off: null },
    wave: 1,
    bestWave: 0,
  }
}

// ---------------------------------------------------------------------------
// Gold
// ---------------------------------------------------------------------------

/**
 * Add to a gold balance, clamped and rounded.
 *
 * Rejects anything that isn't a finite non-negative number rather than propagating it: a
 * single `NaN` in a payout turns the balance into `NaN` permanently, every affordability
 * check then returns false, and the shop appears to be broken for reasons that are invisible
 * in the save file.
 */
export function addGold(gold: number, amount: number): number {
  if (!Number.isFinite(amount) || amount < 0) return clampGold(gold)
  return clampGold(clampGold(gold) + Math.floor(amount))
}

export interface SpendResult {
  ok: boolean
  gold: number
}

/** Spend, if affordable. Never goes negative, and never partially deducts on failure. */
export function spendGold(gold: number, cost: number): SpendResult {
  const balance = clampGold(gold)
  if (!Number.isFinite(cost) || cost < 0) return { ok: false, gold: balance }
  const price = Math.floor(cost)
  if (balance < price) return { ok: false, gold: balance }
  return { ok: true, gold: balance - price }
}

function clampGold(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.min(GOLD_MAX, Math.max(0, Math.floor(value)))
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export type SaveFailure =
  | 'unknown-weapon'
  | 'already-owned'
  | 'not-owned'
  | 'insufficient-gold'
  | 'no-such-upgrade'
  | 'max-level'
  | 'wrong-hand'

export type SaveResult =
  | { ok: true; save: SaveData; spent: number }
  | { ok: false; save: SaveData; reason: SaveFailure }

/**
 * Every transaction returns a *new* save on success and the original on failure, and never
 * mutates its input. The store swaps the whole object in, which is also what makes a failed
 * purchase incapable of leaving the save half-updated.
 */
export function buyWeapon(save: SaveData, id: WeaponId): SaveResult {
  if (!isWeaponId(id)) return { ok: false, save, reason: 'unknown-weapon' }
  if (save.weapons[id]) return { ok: false, save, reason: 'already-owned' }

  const { ok, gold } = spendGold(save.gold, WEAPONS[id].price)
  if (!ok) return { ok: false, save, reason: 'insufficient-gold' }

  return {
    ok: true,
    spent: WEAPONS[id].price,
    save: {
      ...save,
      gold,
      weapons: { ...save.weapons, [id]: { upgrades: {} } },
    },
  }
}

export function buyUpgrade(save: SaveData, id: WeaponId, axis: UpgradeAxis): SaveResult {
  if (!isWeaponId(id)) return { ok: false, save, reason: 'unknown-weapon' }
  if (!isUpgradeAxis(axis)) return { ok: false, save, reason: 'no-such-upgrade' }

  const owned = save.weapons[id]
  if (!owned) return { ok: false, save, reason: 'not-owned' }

  const track = upgradeTrack(id, axis)
  if (!track) return { ok: false, save, reason: 'no-such-upgrade' }

  const level = owned.upgrades[axis] ?? 0
  if (level >= track.maxLevel) return { ok: false, save, reason: 'max-level' }

  const cost = upgradeCost(track, level)
  const { ok, gold } = spendGold(save.gold, cost)
  if (!ok) return { ok: false, save, reason: 'insufficient-gold' }

  return {
    ok: true,
    spent: cost,
    save: {
      ...save,
      gold,
      weapons: {
        ...save.weapons,
        [id]: { upgrades: { ...owned.upgrades, [axis]: level + 1 } },
      },
    },
  }
}

/**
 * Equip an owned weapon to a hand, or pass `null` to empty that hand.
 *
 * A weapon already in the other hand moves rather than duplicating. Holding one sword in
 * both hands is not a loadout, and letting it happen would have the Sprint 2.2 weapon rigs
 * rendering the same object twice and firing it twice per trigger pull.
 */
export function equipWeapon(save: SaveData, hand: Hand, id: WeaponId | null): SaveResult {
  if (id === null) {
    return { ok: true, spent: 0, save: { ...save, equipped: { ...save.equipped, [hand]: null } } }
  }
  if (!isWeaponId(id)) return { ok: false, save, reason: 'unknown-weapon' }
  if (!save.weapons[id]) return { ok: false, save, reason: 'not-owned' }
  if (!WEAPONS[id].hands.includes(hand)) return { ok: false, save, reason: 'wrong-hand' }

  const other: Hand = hand === 'main' ? 'off' : 'main'
  const equipped: Record<Hand, WeaponId | null> = {
    ...save.equipped,
    [hand]: id,
  }
  if (equipped[other] === id) equipped[other] = null

  return { ok: true, spent: 0, save: { ...save, equipped } }
}

/**
 * Bank a cleared wave: pay out, advance, and record the best.
 *
 * `bestWave` uses `max` rather than assignment because the wave counter is going to be
 * resettable eventually (a "start again from wave 1" option), and the number the player has
 * actually reached shouldn't be erased by choosing to replay easier waves.
 */
export function completeWave(save: SaveData, reward: number): SaveData {
  return {
    ...save,
    gold: addGold(save.gold, reward),
    wave: save.wave + 1,
    bestWave: Math.max(save.bestWave, save.wave),
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Coerce an untrusted blob into a valid `SaveData`.
 *
 * The input is whatever is in `localStorage`, which means: a save from a build that no
 * longer exists, a half-written blob from a tab that was closed mid-write, or something a
 * player edited by hand to give themselves ten thousand gold. None of those should be able
 * to produce a game that won't start — the worst outcome allowed here is a save that has
 * been quietly tidied up.
 *
 * Unknown weapon ids are dropped rather than kept. A weapon that was renamed or cut has no
 * definition, so nothing downstream could price it, render it or fire it anyway.
 */
export function sanitiseSave(input: unknown): SaveData {
  const raw = (input ?? {}) as Partial<Record<keyof SaveData, unknown>>
  const base = newSave()

  const weapons: Partial<Record<WeaponId, WeaponSave>> = {}
  const rawWeapons = (raw.weapons ?? {}) as Record<string, unknown>
  for (const [id, value] of Object.entries(rawWeapons)) {
    if (!isWeaponId(id)) continue
    weapons[id] = { upgrades: sanitiseUpgrades(id, value) }
  }
  // The starter is owned unconditionally. A save that has lost it — through a bad edit, or
  // a future migration that renames it — leaves the player with no way to fight and no way
  // to buy their way out if they are also short of gold.
  if (!weapons[STARTER_WEAPON]) weapons[STARTER_WEAPON] = { upgrades: {} }

  const equipped: Record<Hand, WeaponId | null> = {
    main: sanitiseEquipped(raw.equipped, 'main', weapons),
    off: sanitiseEquipped(raw.equipped, 'off', weapons),
  }
  if (equipped.main !== null && equipped.main === equipped.off) equipped.off = null
  // Never leave the player empty-handed if they own something they could be holding.
  if (equipped.main === null && equipped.off === null) equipped.main = STARTER_WEAPON

  const wave = clampCount(raw.wave, 1, base.wave)
  return {
    // A *missing* balance is a save that was never written, or one written by a build that
    // didn't have gold — both should read as a first launch. A balance that is present and
    // genuinely zero is a player who has spent everything, and stays zero.
    gold: typeof raw.gold === 'number' && Number.isFinite(raw.gold) ? clampGold(raw.gold) : base.gold,
    weapons,
    equipped,
    wave,
    // A best that trails the current wave is impossible and reads as a corrupt save in the
    // UI; clamp it up rather than showing "wave 7, best 0".
    bestWave: Math.max(clampCount(raw.bestWave, 0, base.bestWave), wave - 1),
  }
}

function sanitiseUpgrades(id: WeaponId, value: unknown): Partial<Record<UpgradeAxis, number>> {
  const raw = ((value as { upgrades?: unknown })?.upgrades ?? {}) as Record<string, unknown>
  const upgrades: Partial<Record<UpgradeAxis, number>> = {}
  for (const [axis, level] of Object.entries(raw)) {
    if (!isUpgradeAxis(axis)) continue
    const track = upgradeTrack(id, axis)
    if (!track) continue
    const clamped = clampCount(level, 0, 0)
    if (clamped > 0) upgrades[axis] = Math.min(track.maxLevel, clamped)
  }
  return upgrades
}

function sanitiseEquipped(
  value: unknown,
  hand: Hand,
  owned: Partial<Record<WeaponId, WeaponSave>>,
): WeaponId | null {
  const id = (value as Partial<Record<Hand, unknown>> | undefined)?.[hand]
  if (!isWeaponId(id)) return null
  if (!owned[id]) return null
  if (!WEAPONS[id].hands.includes(hand)) return null
  return id
}

function clampCount(value: unknown, min: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.floor(value))
}

/**
 * Carry a save forward from an older stored version.
 *
 * Same reasoning as `migrateSettings`, and the same trap: without a `migrate`, zustand's
 * persist middleware **discards the whole stored blob** on a version bump. For settings that
 * means someone's comfort options reset. Here it means their gold and every weapon they
 * bought are gone, silently, because a field was added. That is the single worst bug this
 * project can ship, so this function exists before there is anything to migrate.
 *
 * `sanitiseSave` handles additive changes on its own, since it keeps recognised keys and
 * fills the rest from a fresh save. Anything that renames, rescales or splits a field needs
 * a real per-version branch here, applied *before* sanitising — by then the old key is
 * unrecognised and has already been dropped.
 */
export function migrateSave(persisted: unknown, version: number): SaveData {
  // v0 (no stored version) through v1 are shape-compatible; sanitising is the migration.
  void version
  return sanitiseSave(persisted)
}

/** Level of one upgrade axis on an owned weapon. 0 for unowned or unpurchased. */
export function upgradeLevel(save: SaveData, id: WeaponId, axis: UpgradeAxis): number {
  return save.weapons[id]?.upgrades[axis] ?? 0
}

export function ownsWeapon(save: SaveData, id: WeaponId): boolean {
  return save.weapons[id] != null
}

/** What the next level of an axis would cost, or null if maxed, unowned or not applicable. */
export function nextUpgradeCost(
  save: SaveData,
  id: WeaponId,
  axis: UpgradeAxis,
): number | null {
  if (!ownsWeapon(save, id)) return null
  const track = upgradeTrack(id, axis)
  if (!track) return null
  const level = upgradeLevel(save, id, axis)
  if (level >= track.maxLevel) return null
  return upgradeCost(track, level)
}
