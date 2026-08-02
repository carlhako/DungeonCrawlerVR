import { describe, expect, it } from 'vitest'
import { STARTER_WEAPON, WEAPONS, upgradeCost, upgradeTrack } from '@/data/weapons'
import {
  GOLD_MAX,
  STARTING_GOLD,
  addGold,
  buyUpgrade,
  buyWeapon,
  completeWave,
  equipWeapon,
  migrateSave,
  newSave,
  nextUpgradeCost,
  sanitiseSave,
  spendGold,
  upgradeLevel,
  type SaveData,
} from './save'

/**
 * The economy is the one place in a roguelite where a bug is unforgivable in both
 * directions. Gold that vanishes costs the player their evening; gold that multiplies costs
 * the game its entire progression. Both fail silently — the save looks fine, the game keeps
 * running, and nobody finds out until someone has played for an hour.
 *
 * So the rules are tested here, at the level they are written, rather than through a store.
 */

const rich = (gold: number): SaveData => ({ ...newSave(), gold })

describe('newSave', () => {
  it('starts with 100 gold, per the design', () => {
    expect(newSave().gold).toBe(STARTING_GOLD)
    expect(STARTING_GOLD).toBe(100)
  })

  it('owns and equips the starter weapon, so the player is never unarmed', () => {
    const save = newSave()
    expect(save.weapons[STARTER_WEAPON]).toBeDefined()
    expect(save.equipped.main).toBe(STARTER_WEAPON)
  })

  it('starts on wave 1 with nothing cleared', () => {
    expect(newSave().wave).toBe(1)
    expect(newSave().bestWave).toBe(0)
  })
})

describe('addGold', () => {
  it('adds', () => {
    expect(addGold(100, 25)).toBe(125)
  })

  it('floors fractional payouts rather than accumulating rounding error', () => {
    expect(addGold(100, 12.7)).toBe(112)
  })

  it('ignores NaN instead of poisoning the balance forever', () => {
    // One NaN payout makes every later affordability check false, and the shop appears
    // broken with nothing wrong in the save that a human would spot.
    expect(addGold(100, Number.NaN)).toBe(100)
    // A balance that has already been poisoned recovers to zero and takes the payout, rather
    // than staying NaN forever.
    expect(addGold(Number.NaN, 50)).toBe(50)
  })

  it('ignores negative amounts — spending goes through spendGold', () => {
    expect(addGold(100, -50)).toBe(100)
  })

  it('clamps at the ceiling', () => {
    expect(addGold(GOLD_MAX, 1000)).toBe(GOLD_MAX)
  })
})

describe('spendGold', () => {
  it('deducts when affordable', () => {
    expect(spendGold(100, 40)).toEqual({ ok: true, gold: 60 })
  })

  it('allows spending the balance exactly', () => {
    expect(spendGold(100, 100)).toEqual({ ok: true, gold: 0 })
  })

  it('refuses rather than going negative, and deducts nothing', () => {
    expect(spendGold(30, 40)).toEqual({ ok: false, gold: 30 })
  })

  it('refuses a negative or non-finite price', () => {
    // Otherwise a corrupt price is a money printer.
    expect(spendGold(100, -50)).toEqual({ ok: false, gold: 100 })
    expect(spendGold(100, Number.NaN)).toEqual({ ok: false, gold: 100 })
  })
})

describe('buyWeapon', () => {
  it('takes the gold and adds the weapon', () => {
    const result = buyWeapon(rich(200), 'frostbrand-sword')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.save.gold).toBe(200 - WEAPONS['frostbrand-sword'].price)
    expect(result.save.weapons['frostbrand-sword']).toEqual({ upgrades: {} })
  })

  it('refuses when short, leaving the save untouched', () => {
    const save = rich(10)
    const result = buyWeapon(save, 'frostbrand-sword')
    expect(result).toMatchObject({ ok: false, reason: 'insufficient-gold' })
    expect(result.save).toBe(save)
  })

  it('refuses to buy the same weapon twice', () => {
    expect(buyWeapon(rich(500), STARTER_WEAPON)).toMatchObject({
      ok: false,
      reason: 'already-owned',
    })
  })

  it('does not mutate the save it was given', () => {
    const save = rich(500)
    buyWeapon(save, 'frostbrand-sword')
    expect(save.gold).toBe(500)
    expect(save.weapons['frostbrand-sword']).toBeUndefined()
  })

  it('refuses an id that no longer exists', () => {
    expect(buyWeapon(rich(500), 'ghost-wand' as never)).toMatchObject({
      ok: false,
      reason: 'unknown-weapon',
    })
  })
})

describe('buyUpgrade', () => {
  const track = upgradeTrack(STARTER_WEAPON, 'damage')!

  it('charges the level cost and raises the level', () => {
    const result = buyUpgrade(rich(500), STARTER_WEAPON, 'damage')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.spent).toBe(upgradeCost(track, 0))
    expect(upgradeLevel(result.save, STARTER_WEAPON, 'damage')).toBe(1)
  })

  it('gets more expensive with each level', () => {
    let save = rich(100_000)
    const costs: number[] = []
    for (let i = 0; i < track.maxLevel; i++) {
      const result = buyUpgrade(save, STARTER_WEAPON, 'damage')
      expect(result.ok).toBe(true)
      if (!result.ok) return
      costs.push(result.spent)
      save = result.save
    }
    expect(costs).toEqual([...costs].sort((a, b) => a - b))
    expect(costs.at(-1) ?? 0).toBeGreaterThan(costs[0] ?? 0)
  })

  it('stops at the maximum level', () => {
    let save = rich(100_000)
    for (let i = 0; i < track.maxLevel; i++) {
      const result = buyUpgrade(save, STARTER_WEAPON, 'damage')
      if (result.ok) save = result.save
    }
    expect(upgradeLevel(save, STARTER_WEAPON, 'damage')).toBe(track.maxLevel)
    const overflow = buyUpgrade(save, STARTER_WEAPON, 'damage')
    expect(overflow).toMatchObject({ ok: false, reason: 'max-level' })
    // And crucially, charges nothing for the refusal.
    expect(overflow.save.gold).toBe(save.gold)
  })

  it('refuses to upgrade a weapon the player does not own', () => {
    expect(buyUpgrade(rich(500), 'boneshard-staff', 'damage')).toMatchObject({
      ok: false,
      reason: 'not-owned',
    })
  })

  it('leaves other weapons and axes alone', () => {
    const owned = buyWeapon(rich(500), 'frostbrand-sword')
    expect(owned.ok).toBe(true)
    if (!owned.ok) return
    const result = buyUpgrade(owned.save, 'frostbrand-sword', 'damage')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(upgradeLevel(result.save, STARTER_WEAPON, 'damage')).toBe(0)
    expect(upgradeLevel(result.save, 'frostbrand-sword', 'crit')).toBe(0)
  })

  it('nextUpgradeCost agrees with what is actually charged, and is null when maxed', () => {
    const save = rich(100_000)
    const quoted = nextUpgradeCost(save, STARTER_WEAPON, 'damage')
    const result = buyUpgrade(save, STARTER_WEAPON, 'damage')
    expect(result.ok && result.spent).toBe(quoted)
    expect(nextUpgradeCost(save, 'boneshard-staff', 'damage')).toBeNull()
  })
})

describe('equipWeapon', () => {
  it('equips an owned weapon', () => {
    const bought = buyWeapon(rich(500), 'frostbrand-sword')
    expect(bought.ok).toBe(true)
    if (!bought.ok) return
    const result = equipWeapon(bought.save, 'off', 'frostbrand-sword')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.save.equipped.off).toBe('frostbrand-sword')
    expect(result.save.equipped.main).toBe(STARTER_WEAPON)
  })

  it('refuses a weapon the player does not own', () => {
    expect(equipWeapon(newSave(), 'main', 'boneshard-staff')).toMatchObject({
      ok: false,
      reason: 'not-owned',
    })
  })

  it('refuses a hand the weapon cannot be held in', () => {
    // The Boneshard Staff is two-handed in all but name: main hand only.
    const bought = buyWeapon(rich(500), 'boneshard-staff')
    expect(bought.ok).toBe(true)
    if (!bought.ok) return
    expect(equipWeapon(bought.save, 'off', 'boneshard-staff')).toMatchObject({
      ok: false,
      reason: 'wrong-hand',
    })
  })

  it('moves a weapon between hands rather than duplicating it', () => {
    const result = equipWeapon(newSave(), 'off', STARTER_WEAPON)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.save.equipped.off).toBe(STARTER_WEAPON)
    expect(result.save.equipped.main).toBeNull()
  })

  it('empties a hand on null', () => {
    const result = equipWeapon(newSave(), 'main', null)
    expect(result.ok && result.save.equipped.main).toBeNull()
  })
})

describe('completeWave', () => {
  it('pays out and advances', () => {
    const after = completeWave(newSave(), 40)
    expect(after.gold).toBe(STARTING_GOLD + 40)
    expect(after.wave).toBe(2)
    expect(after.bestWave).toBe(1)
  })

  it('never lowers the best wave', () => {
    const save: SaveData = { ...newSave(), wave: 2, bestWave: 9 }
    expect(completeWave(save, 0).bestWave).toBe(9)
  })
})

describe('sanitiseSave', () => {
  it('passes a valid save through unchanged', () => {
    const save = completeWave(newSave(), 60)
    expect(sanitiseSave(save)).toEqual(save)
  })

  it('produces a fresh save from junk rather than throwing', () => {
    // This is what a half-written localStorage blob, or a hand-edited one, looks like.
    expect(sanitiseSave(null)).toEqual(newSave())
    expect(sanitiseSave('nonsense')).toEqual(newSave())
    expect(sanitiseSave({ gold: 'lots', weapons: 7, equipped: [] })).toEqual(newSave())
  })

  it('clamps gold into range', () => {
    expect(sanitiseSave({ gold: -500 }).gold).toBe(0)
    expect(sanitiseSave({ gold: 1e30 }).gold).toBe(GOLD_MAX)
    expect(sanitiseSave({ gold: 12.9 }).gold).toBe(12)
  })

  it('drops weapons that no longer exist and keeps the ones that do', () => {
    const save = sanitiseSave({
      weapons: { 'frostbrand-sword': { upgrades: {} }, 'plasma-rifle': { upgrades: {} } },
    })
    expect(save.weapons['frostbrand-sword']).toBeDefined()
    expect((save.weapons as Record<string, unknown>)['plasma-rifle']).toBeUndefined()
  })

  it('re-grants the starter weapon if a save has lost it', () => {
    // Otherwise the player stands in the foyer with no weapon and, if they are also broke,
    // no way to buy one — a save that cannot be played out of.
    const save = sanitiseSave({ gold: 0, weapons: {} })
    expect(save.weapons[STARTER_WEAPON]).toBeDefined()
    expect(save.equipped.main).toBe(STARTER_WEAPON)
  })

  it('clamps upgrade levels to the track maximum', () => {
    const track = upgradeTrack(STARTER_WEAPON, 'damage')!
    const save = sanitiseSave({
      weapons: { [STARTER_WEAPON]: { upgrades: { damage: 99, telekinesis: 3 } } },
    })
    expect(upgradeLevel(save, STARTER_WEAPON, 'damage')).toBe(track.maxLevel)
    expect(save.weapons[STARTER_WEAPON]!.upgrades).not.toHaveProperty('telekinesis')
  })

  it('unequips a weapon that is no longer owned', () => {
    const save = sanitiseSave({ weapons: {}, equipped: { main: 'boneshard-staff', off: null } })
    expect(save.equipped.main).toBe(STARTER_WEAPON)
  })

  it('refuses to hold the same weapon in both hands', () => {
    const save = sanitiseSave({
      weapons: { [STARTER_WEAPON]: { upgrades: {} } },
      equipped: { main: STARTER_WEAPON, off: STARTER_WEAPON },
    })
    expect(save.equipped.off).toBeNull()
  })

  it('pulls the best wave up to something possible', () => {
    expect(sanitiseSave({ wave: 8, bestWave: 0 }).bestWave).toBe(7)
  })
})

describe('migrateSave', () => {
  it('carries a version-0 blob forward instead of discarding it', () => {
    // The failure this guards against: without a migrate, zustand throws away the whole
    // stored blob on a version bump. For a settings store that resets someone's comfort
    // options. Here it deletes their gold and every weapon they ever bought.
    const stored = { gold: 640, weapons: { [STARTER_WEAPON]: { upgrades: { damage: 2 } } } }
    const migrated = migrateSave(stored, 0)
    expect(migrated.gold).toBe(640)
    expect(upgradeLevel(migrated, STARTER_WEAPON, 'damage')).toBe(2)
  })

  it('survives a blob from a future version without crashing', () => {
    expect(() => migrateSave({ gold: 10, unknownField: true }, 99)).not.toThrow()
    expect(migrateSave({ gold: 10, unknownField: true }, 99).gold).toBe(10)
  })
})
