/**
 * Weapon definitions.
 *
 * Data, not code: adding weapon eleven should be an entry in this table, never a new branch
 * somewhere in the shop or the save. That constraint is why this file exists in Sprint 1.2
 * rather than 1.3 — the save has to validate weapon ids and price upgrades, and it needs
 * something to validate *against* that isn't a hard-coded list buried in the store.
 *
 * Three weapons for now, which is what Sprint 1.3's shop needs: the starter, one more wand
 * and one melee. The full roster of ten from PLAN.md lands in Sprint 4.1.
 *
 * The stats are the three the shop compares and the three the upgrade tracks move. They are
 * first drafts — nothing fires until Sprint 2.2, and these will be tuned against a real
 * enemy rather than against a spreadsheet. What matters now is that they live *here*, so
 * that when the shop shows "12 → 14" it is reading the same table the weapon will fire from.
 */

import type { Element } from '@/data/elements'

export type WeaponId = 'emberwand' | 'boneshard-staff' | 'frostbrand-sword'

export type WeaponArchetype = 'wand' | 'melee' | 'offhand'

/**
 * Which hand a weapon can go in.
 *
 * `main` and `off` are the player's dominant and support hands, not left and right — in VR
 * they map to whichever controller the player has set as dominant, and a left-handed player
 * should not have to hold the sword in their weak hand because a data table said "right".
 */
export type Hand = 'main' | 'off'

export type UpgradeAxis = 'damage' | 'rate' | 'crit'

export interface UpgradeTrack {
  axis: UpgradeAxis
  /** Levels purchasable above the base weapon. Level 0 is "bought the weapon". */
  maxLevel: number
  /** Cost of the first level. */
  baseCost: number
  /** Multiplier per level, so later levels cost more. */
  costGrowth: number
}

/** What the shop compares, and what Sprint 2.2 will fire with. */
export interface WeaponStats {
  /** Damage per hit, before crits and resistances. */
  damage: number
  /** Attacks per second — shots for a wand, swings for a blade. */
  rate: number
  /** Critical chance, 0..1. */
  crit: number
}

export interface WeaponDefinition {
  id: WeaponId
  name: string
  archetype: WeaponArchetype
  /** Hands this can be equipped to. Most weapons are either; two-handers will not be. */
  hands: readonly Hand[]
  /** Gold. The starter weapon is 0 because it is owned from the first launch. */
  price: number
  /** One line for the shop panel. */
  blurb: string
  /** At upgrade level 0. `weaponStats` applies the levels the player has bought. */
  stats: WeaponStats
  upgrades: readonly UpgradeTrack[]
  /**
   * What this deals, and therefore what it leaves on the target. See `data/elements.ts`.
   */
  element: Element
  /**
   * Mana per attack. Melee is zero — swinging a sword is not a spell, and a blade that runs
   * out of charge leaves the player holding nothing while something walks at them.
   */
  manaCost: number
  /**
   * Metres from the hand to the business end. Melee only.
   *
   * This is what the swing tracker measures the speed of and where the hit test happens: the
   * *tip* moves several times faster than the fist does, and a sword that damages from the
   * grip is one that hits things visibly to the side of the blade.
   */
  reach?: number
}

const STANDARD_UPGRADES: readonly UpgradeTrack[] = [
  { axis: 'damage', maxLevel: 5, baseCost: 40, costGrowth: 1.6 },
  { axis: 'rate', maxLevel: 3, baseCost: 60, costGrowth: 1.7 },
  { axis: 'crit', maxLevel: 3, baseCost: 75, costGrowth: 1.8 },
]

export const WEAPONS: Record<WeaponId, WeaponDefinition> = {
  emberwand: {
    id: 'emberwand',
    name: 'Emberwand',
    archetype: 'wand',
    hands: ['main', 'off'],
    price: 0,
    blurb: 'Rapid arcing fire bolts. Forgiving, readable, yours already.',
    stats: { damage: 12, rate: 3.2, crit: 0.05 },
    upgrades: STANDARD_UPGRADES,
    element: 'fire',
    // Cheap on purpose. It is the weapon a player owns on their first launch, and running the
    // starter dry in the first ten seconds teaches them that mana is a punishment rather than
    // a resource.
    manaCost: 6,
  },
  'boneshard-staff': {
    id: 'boneshard-staff',
    name: 'Boneshard Staff',
    archetype: 'wand',
    hands: ['main'],
    price: 120,
    blurb: 'Hold to charge, release a cone of bone splinters.',
    stats: { damage: 44, rate: 0.9, crit: 0.08 },
    upgrades: STANDARD_UPGRADES,
    element: 'physical',
    manaCost: 28,
  },
  'frostbrand-sword': {
    id: 'frostbrand-sword',
    name: 'Frostbrand Sword',
    archetype: 'melee',
    hands: ['main', 'off'],
    price: 90,
    blurb: 'Chills on hit. Frozen things shatter.',
    stats: { damage: 28, rate: 1.6, crit: 0.1 },
    upgrades: STANDARD_UPGRADES,
    element: 'frost',
    manaCost: 0,
    reach: 0.85,
  },
}

export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[]

/** Owned from the first launch, so the player is never standing in the foyer unarmed. */
export const STARTER_WEAPON: WeaponId = 'emberwand'

export function isWeaponId(value: unknown): value is WeaponId {
  return typeof value === 'string' && value in WEAPONS
}

export function isUpgradeAxis(value: unknown): value is UpgradeAxis {
  return value === 'damage' || value === 'rate' || value === 'crit'
}

export function upgradeTrack(id: WeaponId, axis: UpgradeAxis): UpgradeTrack | null {
  return WEAPONS[id].upgrades.find((track) => track.axis === axis) ?? null
}

/**
 * Cost of taking `axis` from `currentLevel` to the next level.
 *
 * Rounded to whole gold at every step rather than accumulated as a float: the player sees
 * this number, pays exactly it, and "you cannot afford 63.99999" is not a bug anyone should
 * have to debug at wave nine.
 */
export function upgradeCost(track: UpgradeTrack, currentLevel: number): number {
  return Math.round(track.baseCost * Math.pow(track.costGrowth, currentLevel))
}

/**
 * What one level of each axis is worth.
 *
 * Additive on the base value rather than compounding, so five levels of damage is a
 * predictable +90% rather than a number nobody can reason about at the shop counter. Crit is
 * in percentage points, which is why it is not a multiplier.
 */
export const UPGRADE_EFFECT: Record<UpgradeAxis, number> = {
  damage: 0.18,
  rate: 0.1,
  crit: 0.03,
}

/** A weapon's stats with the player's purchased levels applied. */
export function weaponStats(
  id: WeaponId,
  upgrades: Partial<Record<UpgradeAxis, number>> = {},
): WeaponStats {
  const base = WEAPONS[id].stats
  return {
    damage: base.damage * (1 + UPGRADE_EFFECT.damage * (upgrades.damage ?? 0)),
    rate: base.rate * (1 + UPGRADE_EFFECT.rate * (upgrades.rate ?? 0)),
    // Capped: a guaranteed crit is not an upgrade, it is a different damage number with
    // extra steps, and it makes the crit feedback in Sprint 2.4 meaningless.
    crit: Math.min(0.75, base.crit + UPGRADE_EFFECT.crit * (upgrades.crit ?? 0)),
  }
}

/** How each axis is named and written on the shop panel. */
export const AXIS_LABEL: Record<UpgradeAxis, string> = {
  damage: 'Damage',
  rate: 'Speed',
  crit: 'Crit',
}

/** One stat, formatted for display. Keeps the shop and any later HUD reading the same. */
export function formatStat(axis: UpgradeAxis, stats: WeaponStats): string {
  switch (axis) {
    case 'damage':
      return stats.damage.toFixed(0)
    case 'rate':
      return `${stats.rate.toFixed(1)}/s`
    case 'crit':
      return `${Math.round(stats.crit * 100)}%`
  }
}
