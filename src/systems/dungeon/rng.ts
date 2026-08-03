/**
 * Seeded, deterministic random numbers.
 *
 * `Math.random` is unseedable, which makes every generated dungeon a one-off: a level that
 * traps the player, or a spawn inside a wall, can be looked at exactly once and never
 * reproduced. Everything procedural in this game draws from here instead, so a bug report is
 * a seed number and a fix is verifiable.
 *
 * mulberry32: one 32-bit state word, a handful of integer operations, and a period long
 * enough that no dungeon will ever see the end of it. Statistically it is not a research-
 * grade generator, and it does not need to be — it needs to be fast, tiny and identical on
 * every machine that runs it.
 */

export interface Rng {
  /** The next float in [0, 1). */
  next(): number
  /** An integer in [min, max], inclusive at both ends. */
  int(min: number, max: number): number
  /** A float in [min, max). */
  range(min: number, max: number): number
  /** True with probability `p`. */
  chance(p: number): boolean
  /** One element. Throws on an empty list — a silent `undefined` here is a nightmare later. */
  pick<T>(items: readonly T[]): T
  /** A shuffled copy, Fisher-Yates. The input is left alone. */
  shuffle<T>(items: readonly T[]): T[]
}

export function makeRng(seed: number | string): Rng {
  let state = (typeof seed === 'number' ? seed : hashSeed(seed)) >>> 0
  // A zero state is a fixed point for some generators. Not for this one, but a seed of 0 is
  // common enough — "the first dungeon" — that it is worth not finding out the hard way.
  if (state === 0) state = 0x9e3779b9

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const rng: Rng = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    range: (min, max) => min + next() * (max - min),
    chance: (p) => next() < p,
    pick: (items) => {
      if (items.length === 0) throw new Error('Rng.pick called with nothing to pick from')
      return items[Math.floor(next() * items.length)] as (typeof items)[number]
    },
    shuffle: (items) => {
      const copy = [...items]
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        const a = copy[i] as (typeof copy)[number]
        copy[i] = copy[j] as (typeof copy)[number]
        copy[j] = a
      }
      return copy
    },
  }
  return rng
}

/**
 * A string to a 32-bit seed, so a dungeon can be named as well as numbered.
 *
 * xmur3's mixing step. Any hash would do; this one is short and avalanches well enough that
 * "wave-1" and "wave-2" produce completely unrelated levels rather than similar ones.
 */
export function hashSeed(text: string): number {
  let h = 1779033703 ^ text.length
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return (h ^= h >>> 16) >>> 0
}
