/**
 * Weapon definitions.
 *
 * Data, not code: adding weapon eleven should be an entry in this table, never a new branch
 * somewhere in the shop or the save. That constraint is why this file exists in Sprint 1.2
 * rather than 1.3 — the save has to validate weapon ids and price upgrades, and it needs
 * something to validate *against* that isn't a hard-coded list buried in the store.
 *
 * Three weapons for now, which is what Sprint 1.3's shop needs: the starter, one more wand
 * and one melee. The full roster of ten from PLAN.md lands in Sprint 4.1. Combat stats
 * (damage, mana, projectile speed) are deliberately absent — there is no combat until 2.2,
 * and inventing numbers now would only mean tuning them twice.
 */

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

export interface WeaponDefinition {
  id: WeaponId
  name: string
  archetype: WeaponArchetype
  /** Hands this can be equipped to. Most weapons are either; two-handers will not be. */
  hands: readonly Hand[]
  /** Gold. The starter weapon is 0 because it is owned from the first launch. */
  price: number
  /** One line for the shop panel in Sprint 1.3. */
  blurb: string
  upgrades: readonly UpgradeTrack[]
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
    upgrades: STANDARD_UPGRADES,
  },
  'boneshard-staff': {
    id: 'boneshard-staff',
    name: 'Boneshard Staff',
    archetype: 'wand',
    hands: ['main'],
    price: 120,
    blurb: 'Hold to charge, release a cone of bone splinters.',
    upgrades: STANDARD_UPGRADES,
  },
  'frostbrand-sword': {
    id: 'frostbrand-sword',
    name: 'Frostbrand Sword',
    archetype: 'melee',
    hands: ['main', 'off'],
    price: 90,
    blurb: 'Chills on hit. Frozen things shatter.',
    upgrades: STANDARD_UPGRADES,
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
