import { describe, expect, it } from 'vitest'
import {
  beginCooldown,
  canAfford,
  cooldownFor,
  cooldownProgress,
  createManaPool,
  MANA_REGEN,
  MANA_REGEN_DELAY,
  ready,
  spendMana,
  stepCooldown,
  stepMana,
} from './resources'

const STEP = 1 / 60

function run(seconds: number, tick: () => void): void {
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) tick()
}

describe('mana', () => {
  it('starts full', () => {
    const pool = createManaPool()
    expect(pool.current).toBe(pool.max)
  })

  it('spends what it is asked for, and refuses what it cannot pay', () => {
    const pool = createManaPool(10)
    expect(spendMana(pool, 6)).toBe(true)
    expect(pool.current).toBe(4)
    expect(spendMana(pool, 6)).toBe(false)
    expect(pool.current).toBe(4)
  })

  it('always allows a free attack, even on an empty pool', () => {
    // The melee case. A player who has run dry must still have something to do, or the
    // answer to running out of mana is to stand still until it comes back.
    const pool = createManaPool(10)
    spendMana(pool, 10)
    expect(pool.current).toBe(0)
    expect(canAfford(pool, 0)).toBe(true)
    expect(spendMana(pool, 0)).toBe(true)
  })

  it('does not regenerate during the delay after a spend', () => {
    const pool = createManaPool(100)
    spendMana(pool, 50)
    run(MANA_REGEN_DELAY * 0.8, () => stepMana(pool, STEP))
    expect(pool.current).toBe(50)
  })

  it('regenerates at the stated rate once the delay is past', () => {
    const pool = createManaPool(100)
    spendMana(pool, 50)
    run(MANA_REGEN_DELAY + 1, () => stepMana(pool, STEP))
    expect(pool.current).toBeGreaterThan(50 + MANA_REGEN * 0.9)
    expect(pool.current).toBeLessThan(50 + MANA_REGEN * 1.1)
  })

  it('never regenerates past full', () => {
    const pool = createManaPool(100)
    spendMana(pool, 5)
    run(30, () => stepMana(pool, STEP))
    expect(pool.current).toBe(100)
  })

  it('restarts the delay on every spend, so held fire never regenerates', () => {
    const pool = createManaPool(100)
    for (let i = 0; i < 10; i += 1) {
      spendMana(pool, 6)
      run(MANA_REGEN_DELAY * 0.5, () => stepMana(pool, STEP))
    }
    expect(pool.current).toBe(40)
  })

  it('a free attack does not reset the regen delay', () => {
    // Swinging a sword must not stall the pool that the wand in the other hand is refilling.
    const pool = createManaPool(100)
    spendMana(pool, 50)
    run(MANA_REGEN_DELAY + 0.5, () => stepMana(pool, STEP))
    const before = pool.current
    spendMana(pool, 0)
    stepMana(pool, STEP)
    expect(pool.current).toBeGreaterThan(before)
  })
})

describe('cooldowns', () => {
  it('is the reciprocal of the rate', () => {
    expect(cooldownFor(4)).toBe(0.25)
    expect(cooldownFor(1.6)).toBeCloseTo(0.625, 6)
  })

  it('refuses to produce an infinite cooldown from a nonsense rate', () => {
    // A weapon that silently never fires again is the hardest bug to report from a headset.
    expect(cooldownFor(0)).toBe(1)
    expect(cooldownFor(-3)).toBe(1)
    expect(cooldownFor(Number.NaN)).toBe(1)
  })

  it('is ready, then not, then ready again', () => {
    const cooldown = { remaining: 0 }
    expect(ready(cooldown)).toBe(true)

    beginCooldown(cooldown, 2)
    expect(ready(cooldown)).toBe(false)

    run(0.4, () => stepCooldown(cooldown, STEP))
    expect(ready(cooldown)).toBe(false)

    run(0.2, () => stepCooldown(cooldown, STEP))
    expect(ready(cooldown)).toBe(true)
  })

  it('sets rather than accumulates, so a hair trigger cannot jam the weapon', () => {
    const cooldown = { remaining: 0 }
    for (let i = 0; i < 20; i += 1) beginCooldown(cooldown, 2)
    expect(cooldown.remaining).toBe(0.5)
  })

  it('reports progress from zero to ready', () => {
    const cooldown = { remaining: 0 }
    beginCooldown(cooldown, 2)
    expect(cooldownProgress(cooldown, 2)).toBeCloseTo(0, 6)
    run(0.25, () => stepCooldown(cooldown, STEP))
    expect(cooldownProgress(cooldown, 2)).toBeCloseTo(0.5, 1)
    run(0.3, () => stepCooldown(cooldown, STEP))
    expect(cooldownProgress(cooldown, 2)).toBe(1)
  })

  it('fires at about the weapon rate over a second of held trigger', () => {
    // The number the shop sells. If `rate` and the cooldown ever disagree, "3.2/s" on the
    // board is a lie and every upgrade decision is made on bad information.
    const cooldown = { remaining: 0 }
    let shots = 0
    run(1, () => {
      stepCooldown(cooldown, STEP)
      if (ready(cooldown)) {
        shots += 1
        beginCooldown(cooldown, 3.2)
      }
    })
    expect(shots).toBeGreaterThanOrEqual(3)
    expect(shots).toBeLessThanOrEqual(4)
  })
})
