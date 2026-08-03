import { describe, expect, it } from 'vitest'
import { ENEMIES, type EnemyId } from './enemies'
import {
  MAX_CONCURRENT,
  composeWave,
  waveBudget,
  waveConcurrency,
  waveValue,
} from './waves'

const WAVES = [1, 2, 3, 4, 5, 8, 12, 20]

function cost(composition: readonly EnemyId[]): number {
  return composition.reduce((sum, id) => sum + ENEMIES[id].cost, 0)
}

describe('waveBudget', () => {
  it('grows, and never shrinks', () => {
    let previous = -1
    for (let wave = 1; wave <= 30; wave++) {
      const budget = waveBudget(wave)
      expect(budget).toBeGreaterThan(previous)
      previous = budget
    }
  })

  it('affords something on wave one', () => {
    const cheapest = Math.min(...Object.values(ENEMIES).map((enemy) => enemy.cost))
    expect(waveBudget(1)).toBeGreaterThanOrEqual(cheapest)
  })
})

describe('waveConcurrency', () => {
  it('never exceeds the pool', () => {
    for (let wave = 1; wave <= 60; wave++) {
      expect(waveConcurrency(wave)).toBeLessThanOrEqual(MAX_CONCURRENT)
    }
  })

  it('is at least enough for a fight on wave one', () => {
    expect(waveConcurrency(1)).toBeGreaterThanOrEqual(2)
  })
})

describe('composeWave', () => {
  it.each(WAVES)('never returns an empty wave (%i)', (wave) => {
    // A wave the player walks into and finds nothing in is indistinguishable from a broken
    // spawner, and it is exactly what a budget that rounded down would produce.
    expect(composeWave(wave).length).toBeGreaterThan(0)
  })

  it.each(WAVES)('stays inside the budget on wave %i', (wave) => {
    expect(cost(composeWave(wave))).toBeLessThanOrEqual(waveBudget(wave))
  })

  it.each(WAVES)('spends nearly all of it on wave %i', (wave) => {
    // Within one of the cheapest enemy: anything more left over is budget that quietly
    // vanishes, and a wave that is easier than the curve says it is.
    const cheapest = Math.min(...Object.values(ENEMIES).map((enemy) => enemy.cost))
    expect(waveBudget(wave) - cost(composeWave(wave))).toBeLessThan(cheapest)
  })

  it('is the same fight every time, for the same wave', () => {
    // The property this file exists for, and the same one the dungeon seed gives: wave 3 is
    // always the same level *and* always the same fight, so "wave 3 is broken" is a complete
    // bug report.
    for (const wave of WAVES) {
      expect(composeWave(wave)).toEqual(composeWave(wave))
    }
  })

  it('is a different fight on a different wave', () => {
    expect(composeWave(4)).not.toEqual(composeWave(5))
  })

  it('never fields an enemy the wave has not unlocked', () => {
    for (let wave = 1; wave <= 12; wave++) {
      for (const id of composeWave(wave)) {
        expect(ENEMIES[id].minWave, `${id} on wave ${wave}`).toBeLessThanOrEqual(wave)
      }
    }
  })

  it('keeps the Wraith out of the early waves entirely', () => {
    // Its whole identity is walking through a wall, and spending that before the player has
    // learned that walls are supposed to work throws it away.
    for (let wave = 1; wave < ENEMIES.wraith.minWave; wave++) {
      expect(composeWave(wave)).not.toContain('wraith')
    }
  })

  it('gets bigger, broadly, as the waves go on', () => {
    expect(composeWave(10).length).toBeGreaterThan(composeWave(1).length)
  })

  it('mixes rather than fielding one kind of thing', () => {
    // A wave of nothing but Skeleton Warriors is unplayable at wave two; a wave of nothing
    // but Skulkers is noise. Across the mid-game there should be more than one kind about.
    const kinds = new Set(composeWave(8))
    expect(kinds.size).toBeGreaterThan(1)
  })
})

describe('waveValue', () => {
  it('pays more for a harder wave', () => {
    expect(waveValue(composeWave(5))).toBeGreaterThan(waveValue(composeWave(1)))
  })

  it('is worth a shop visit within a couple of waves', () => {
    // The Frostbrand is 90 gold and the starting purse is 100. Two waves that cannot between
    // them buy anything make the shop furniture.
    const early = waveValue(composeWave(1)) + waveValue(composeWave(2))
    expect(early).toBeGreaterThanOrEqual(40)
  })
})
