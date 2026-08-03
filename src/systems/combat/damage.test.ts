import { describe, expect, it } from 'vitest'
import { STATUS_RULES } from '@/data/elements'
import {
  applyStatus,
  chillFactor,
  clampResistance,
  CRIT_MULTIPLIER,
  hasStatus,
  resolveDamage,
  stepStatuses,
  type DamageSource,
  type StatusState,
} from './damage'

const SOURCE: DamageSource = { kind: 'projectile', weaponId: 'emberwand', hand: 'main' }

/** Deterministic rolls. A crit is the only random thing in the pipeline; pin it. */
const never = () => 0.999
const always = () => 0

describe('resolveDamage', () => {
  it('returns the base damage when nothing modifies it', () => {
    const hit = resolveDamage(
      { base: 12, element: 'fire', critChance: 0, source: SOURCE },
      {},
      never,
    )
    expect(hit.amount).toBe(12)
    expect(hit.crit).toBe(false)
  })

  it('multiplies on a crit', () => {
    const hit = resolveDamage(
      { base: 12, element: 'fire', critChance: 0.05, source: SOURCE },
      {},
      always,
    )
    expect(hit.crit).toBe(true)
    expect(hit.amount).toBe(12 * CRIT_MULTIPLIER)
  })

  it('never crits on a zero chance, whatever the roll says', () => {
    const hit = resolveDamage(
      { base: 12, element: 'fire', critChance: 0, source: SOURCE },
      {},
      always,
    )
    expect(hit.crit).toBe(false)
  })

  it('scales by power, which is where a melee swing lands', () => {
    const weak = resolveDamage(
      { base: 28, element: 'frost', critChance: 0, power: 0.5, source: SOURCE },
      {},
      never,
    )
    const hard = resolveDamage(
      { base: 28, element: 'frost', critChance: 0, power: 1.4, source: SOURCE },
      {},
      never,
    )
    expect(weak.amount).toBe(14)
    expect(hard.amount).toBe(39)
  })

  it('applies resistance for the matching element only', () => {
    const spec = { base: 100, critChance: 0, source: SOURCE }
    const resisted = resolveDamage({ ...spec, element: 'fire' }, { fire: 0.5 }, never)
    const unresisted = resolveDamage({ ...spec, element: 'frost' }, { fire: 0.5 }, never)
    expect(resisted.amount).toBe(50)
    expect(unresisted.amount).toBe(100)
  })

  it('lets a negative resistance be a vulnerability', () => {
    const hit = resolveDamage(
      { base: 100, element: 'frost', critChance: 0, source: SOURCE },
      { frost: -0.5 },
      never,
    )
    expect(hit.amount).toBe(150)
  })

  it('always takes at least one point off, however resistant the target', () => {
    // A hit that visibly connects and does nothing reads as a broken weapon, not as a
    // resistant enemy. Whatever the numbers say, something comes off.
    const hit = resolveDamage(
      { base: 2, element: 'fire', critChance: 0, power: 0.01, source: SOURCE },
      { fire: 10 },
      never,
    )
    expect(hit.amount).toBe(1)
  })

  it('rounds to whole numbers, so the damage shown is the damage dealt', () => {
    const hit = resolveDamage(
      { base: 12, element: 'fire', critChance: 0, power: 1.13, source: SOURCE },
      {},
      never,
    )
    expect(hit.amount).toBe(Math.round(12 * 1.13))
    expect(Number.isInteger(hit.amount)).toBe(true)
  })

  it('carries the element and the status it implies', () => {
    expect(resolveDamage({ base: 1, element: 'fire', critChance: 0, source: SOURCE }).status).toBe(
      'burning',
    )
    expect(resolveDamage({ base: 1, element: 'frost', critChance: 0, source: SOURCE }).status).toBe(
      'chilled',
    )
    expect(
      resolveDamage({ base: 1, element: 'physical', critChance: 0, source: SOURCE }).status,
    ).toBeNull()
  })

  it('carries the source through untouched, for the VFX in 2.4', () => {
    const hit = resolveDamage({ base: 1, element: 'fire', critChance: 0, source: SOURCE })
    expect(hit.source).toEqual(SOURCE)
  })
})

describe('clampResistance', () => {
  it('never lets anything be fully immune', () => {
    expect(clampResistance(5)).toBeLessThan(1)
  })

  it('bounds vulnerability too, so nothing takes twenty times damage', () => {
    expect(clampResistance(-20)).toBe(-1)
  })

  it('treats nonsense as no resistance', () => {
    expect(clampResistance(Number.NaN)).toBe(0)
  })
})

describe('statuses', () => {
  it('refreshes rather than stacking', () => {
    const list: StatusState[] = []
    applyStatus(list, 'burning')
    stepStatuses(list, 1)
    applyStatus(list, 'burning')

    expect(list).toHaveLength(1)
    expect(list[0]!.remaining).toBe(STATUS_RULES.burning.seconds)
  })

  it('holds several different statuses at once', () => {
    const list: StatusState[] = []
    applyStatus(list, 'burning')
    applyStatus(list, 'chilled')
    expect(hasStatus(list, 'burning')).toBe(true)
    expect(hasStatus(list, 'chilled')).toBe(true)
  })

  it('deals burn damage over the status duration and then expires', () => {
    const list: StatusState[] = []
    applyStatus(list, 'burning')

    let total = 0
    for (let i = 0; i < 400; i += 1) total += stepStatuses(list, 1 / 60)

    expect(list).toHaveLength(0)
    expect(total).toBeCloseTo(STATUS_RULES.burning.seconds * STATUS_RULES.burning.magnitude, 5)
  })

  it('does not over-tick on the step a burn expires', () => {
    // The step that crosses the end of the burn must only bill for the slice that was still
    // burning, or a long fixed step quietly adds damage the status never had.
    const list: StatusState[] = []
    applyStatus(list, 'burning')
    const damage = stepStatuses(list, 10)
    expect(damage).toBeCloseTo(STATUS_RULES.burning.seconds * STATUS_RULES.burning.magnitude, 5)
  })

  it('chilling never stops a target dead', () => {
    const list: StatusState[] = []
    applyStatus(list, 'chilled')
    const factor = chillFactor(list)
    expect(factor).toBeLessThan(1)
    expect(factor).toBeGreaterThan(0)
  })

  it('leaves speed alone with no chill on', () => {
    expect(chillFactor([])).toBe(1)
  })

  it('does not burn a target that is only chilled', () => {
    const list: StatusState[] = []
    applyStatus(list, 'chilled')
    expect(stepStatuses(list, 0.5)).toBe(0)
  })
})
