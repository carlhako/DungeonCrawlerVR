import { describe, expect, it } from 'vitest'
import type { ResolvedDamage } from '@/systems/combat/damage'
import {
  HURT_SECONDS,
  INVULNERABLE_SECONDS,
  PLAYER_MAX_HP,
  createVitals,
  healthFraction,
  hurtPlayer,
  isAlive,
  resetVitals,
  stepVitals,
} from './vitals'

const STEP = 1 / 60

function blow(amount: number): ResolvedDamage {
  return {
    amount,
    element: 'physical',
    crit: false,
    status: null,
    source: { kind: 'melee', weaponId: null, hand: null },
  }
}

/** Run the clock, so the invulnerability window is over. */
function wait(vitals: ReturnType<typeof createVitals>, seconds: number) {
  for (let t = 0; t < seconds; t += STEP) stepVitals(vitals, STEP)
}

describe('player vitals', () => {
  it('starts whole', () => {
    const vitals = createVitals()
    expect(vitals.hp).toBe(PLAYER_MAX_HP)
    expect(isAlive(vitals)).toBe(true)
    expect(healthFraction(vitals)).toBe(1)
  })

  it('takes the damage it is given', () => {
    const vitals = createVitals()
    const result = hurtPlayer(vitals, blow(18))
    expect(result).toEqual({ applied: true, amount: 18, killed: false })
    expect(vitals.hp).toBe(PLAYER_MAX_HP - 18)
  })

  it('refuses a second hit inside the invulnerability window', () => {
    // Three things reaching the player on the same fixed step would otherwise deal all their
    // damage in 16ms, which is not difficulty — it is a player with nothing to react to.
    const vitals = createVitals()
    hurtPlayer(vitals, blow(18))
    const second = hurtPlayer(vitals, blow(18))
    expect(second.applied).toBe(false)
    expect(vitals.hp).toBe(PLAYER_MAX_HP - 18)
  })

  it('accepts the next hit once the window has passed', () => {
    const vitals = createVitals()
    hurtPlayer(vitals, blow(18))
    wait(vitals, INVULNERABLE_SECONDS + STEP)
    expect(hurtPlayer(vitals, blow(18)).applied).toBe(true)
    expect(vitals.hp).toBe(PLAYER_MAX_HP - 36)
  })

  it('is short enough that one attacker is still dangerous', () => {
    // Longer than the fastest enemy's recovery and a single Skulker could never land a second
    // blow, which would make being surrounded the only way to lose.
    expect(INVULNERABLE_SECONDS).toBeLessThan(1.1)
  })

  it('never goes below zero', () => {
    const vitals = createVitals()
    hurtPlayer(vitals, blow(500))
    expect(vitals.hp).toBe(0)
    expect(isAlive(vitals)).toBe(false)
    expect(healthFraction(vitals)).toBe(0)
  })

  it('reports the killing blow exactly once', () => {
    const vitals = createVitals(20)
    wait(vitals, INVULNERABLE_SECONDS)
    expect(hurtPlayer(vitals, blow(20)).killed).toBe(true)
    wait(vitals, INVULNERABLE_SECONDS + STEP)
    // Already dead. Nothing more happens, and nothing claims the kill twice.
    expect(hurtPlayer(vitals, blow(20))).toEqual({ applied: false, amount: 0, killed: false })
  })

  it('does not regenerate while the clock runs', () => {
    // Regeneration during a wave rewards backing into a corridor and waiting, which is the
    // least interesting thing a player can do. The foyer is the safe room.
    const vitals = createVitals()
    hurtPlayer(vitals, blow(40))
    wait(vitals, 30)
    expect(vitals.hp).toBe(PLAYER_MAX_HP - 40)
  })

  it('flashes on a hit and fades', () => {
    const vitals = createVitals()
    hurtPlayer(vitals, blow(10))
    expect(vitals.hurt).toBe(1)
    wait(vitals, HURT_SECONDS / 2)
    expect(vitals.hurt).toBeGreaterThan(0)
    expect(vitals.hurt).toBeLessThan(1)
    wait(vitals, HURT_SECONDS)
    expect(vitals.hurt).toBe(0)
  })

  it('comes back whole, with nothing carried over', () => {
    const vitals = createVitals()
    hurtPlayer(vitals, blow(70))
    resetVitals(vitals)
    expect(vitals).toEqual(createVitals())
  })

  it('survives a wave of ordinary hits, and not an endless one', () => {
    // A sanity check on the numbers rather than a balance claim: a Skeleton Warrior's 18
    // should take several connected blows to kill you, and fewer than a dozen.
    const vitals = createVitals()
    let hits = 0
    while (isAlive(vitals) && hits < 100) {
      wait(vitals, INVULNERABLE_SECONDS + STEP)
      if (hurtPlayer(vitals, blow(18)).applied) hits += 1
    }
    expect(hits).toBeGreaterThanOrEqual(4)
    expect(hits).toBeLessThanOrEqual(10)
  })
})
