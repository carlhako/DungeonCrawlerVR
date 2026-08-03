import { describe, expect, it } from 'vitest'
import { hashSeed, makeRng } from './rng'

/**
 * The property everything else in the generator rests on: the same seed is the same dungeon,
 * on every machine, forever. A test failure here invalidates every stored seed.
 */

function take(seed: number | string, n = 12): number[] {
  const rng = makeRng(seed)
  return Array.from({ length: n }, () => rng.next())
}

describe('makeRng', () => {
  it('repeats itself exactly for the same seed', () => {
    expect(take(1234)).toEqual(take(1234))
  })

  it('produces unrelated sequences for neighbouring seeds', () => {
    // Seeds will be wave numbers, so 1 and 2 must not give near-identical dungeons.
    const a = take(1)
    const b = take(2)
    expect(a).not.toEqual(b)
    expect(a.filter((value, i) => value === b[i])).toHaveLength(0)
  })

  it('stays inside [0, 1)', () => {
    const rng = makeRng('range')
    for (let i = 0; i < 5000; i++) {
      const value = rng.next()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('survives a seed of zero', () => {
    // Zero is the obvious seed for "the first one", and a fixed point for some generators.
    const values = take(0)
    expect(new Set(values).size).toBe(values.length)
  })

  it('is not obviously biased', () => {
    // Not a statistical proof, just a tripwire: a generator stuck in a corner of its range
    // produces dungeons with all their rooms in one place, which is hard to spot by eye.
    const rng = makeRng('bias')
    const buckets = new Array(10).fill(0)
    for (let i = 0; i < 10000; i++) buckets[Math.floor(rng.next() * 10)]++
    for (const count of buckets) expect(count).toBeGreaterThan(700)
  })
})

describe('int', () => {
  it('includes both ends of the range', () => {
    const rng = makeRng('ints')
    const seen = new Set<number>()
    for (let i = 0; i < 500; i++) seen.add(rng.int(3, 6))
    expect([...seen].sort()).toEqual([3, 4, 5, 6])
  })

  it('handles a range of one', () => {
    const rng = makeRng('one')
    for (let i = 0; i < 20; i++) expect(rng.int(7, 7)).toBe(7)
  })
})

describe('pick and shuffle', () => {
  it('throws rather than returning undefined', () => {
    // The alternative is an `undefined` room or spawn point that fails somewhere else
    // entirely, several steps after the mistake.
    expect(() => makeRng(1).pick([])).toThrow()
  })

  it('shuffles into a permutation, leaving the original alone', () => {
    const source = [1, 2, 3, 4, 5, 6, 7, 8]
    const shuffled = makeRng('shuffle').shuffle(source)
    expect(shuffled).not.toBe(source)
    expect(source).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect([...shuffled].sort((a, b) => a - b)).toEqual(source)
  })

  it('shuffles the same way for the same seed', () => {
    const source = ['a', 'b', 'c', 'd', 'e']
    expect(makeRng(9).shuffle(source)).toEqual(makeRng(9).shuffle(source))
  })
})

describe('hashSeed', () => {
  it('is stable', () => {
    expect(hashSeed('wave-1')).toBe(hashSeed('wave-1'))
  })

  it('separates similar strings', () => {
    expect(hashSeed('wave-1')).not.toBe(hashSeed('wave-2'))
  })

  it('returns an unsigned 32-bit integer', () => {
    for (const text of ['', 'a', 'wave-12', 'the-hollow-king']) {
      const hash = hashSeed(text)
      expect(Number.isInteger(hash)).toBe(true)
      expect(hash).toBeGreaterThanOrEqual(0)
      expect(hash).toBeLessThan(2 ** 32)
    }
  })
})
