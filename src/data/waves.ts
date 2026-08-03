/**
 * What a wave is made of.
 *
 * A **budget**, not a list. A hand-written roster per wave is twenty entries of guesswork that
 * has to be rewritten every time an enemy's numbers change, and it caps the game at however
 * many waves somebody had the patience to type. A budget plus a cost per enemy means wave
 * seventeen composes itself, and rebalancing the Skeleton Warrior automatically changes how
 * many of them wave seventeen can afford.
 *
 * Composition is **seeded from the wave number**, exactly like the dungeon it happens in. Wave
 * 3 is always the same level *and* always the same fight — the player gets to learn an
 * encounter rather than being handed noise, and "wave 3 is broken" stays a complete bug
 * report. It is the single most useful property this file has.
 */

import { ENEMIES, ENEMY_IDS, type EnemyId } from '@/data/enemies'
import { makeRng } from '@/systems/dungeon/rng'

/**
 * Points available to spend on wave `wave`.
 *
 * Linear rather than exponential. Exponential difficulty curves look right on a graph and
 * play as a wall: waves 1-6 are trivial and wave 9 is impossible, with nothing in between.
 * Four points a wave over a roster costing 1-4 means each wave adds roughly one more thing to
 * deal with, which is a curve a player can feel themselves getting better against.
 */
export function waveBudget(wave: number): number {
  return 4 + 4 * Math.max(0, wave - 1)
}

/**
 * How many may be alive at once, by wave.
 *
 * The budget decides how many the wave contains; this decides how many are in your face. They
 * are different questions, and conflating them is how a wave-ten player ends up in a corridor
 * with fourteen things in it and no framerate. Capped hard — this is also the number that
 * bounds the worst frame in the game.
 */
export function waveConcurrency(wave: number): number {
  return Math.min(MAX_CONCURRENT, 3 + Math.floor(wave / 2))
}

/** The pool ceiling, and the cap `waveConcurrency` grows towards. */
export const MAX_CONCURRENT = 10

/**
 * Seconds between one spawn and the next.
 *
 * Staggered, and not just for pacing: a wave that arrives all at once is a wave that is either
 * survived or not, with no play in the middle. Trickling them in means the player is always
 * fighting something and never fighting everything, and it gives the horror direction in 3.3
 * somewhere to put a silence.
 */
export const SPAWN_INTERVAL = 2.2

/** A pause before the first one, so the player is not greeted at the door. */
export const FIRST_SPAWN_DELAY = 3.0

/**
 * Compose a wave: the enemies it contains, in the order they will arrive.
 *
 * The rules, in order of how much they matter:
 *
 * 1. **Only what this wave has unlocked.** The Wraith is a set piece the first time it walks
 *    through a wall, and spending that on wave one — before the player has learned that walls
 *    are supposed to work — throws it away.
 * 2. **Spend the budget, biggest affordable first, with the cheap ones filling the gaps.** A
 *    purely random draw produces waves made entirely of Skulkers and waves made entirely of
 *    Warriors, and the second one is unplayable at wave two.
 * 3. **Never return an empty wave.** A wave the player walks into and finds nothing in is
 *    indistinguishable from a broken spawner, and it is the failure mode a budget that
 *    rounded down would produce on wave one.
 */
export function composeWave(wave: number): EnemyId[] {
  const rng = makeRng(`wave-composition-${wave}`)
  const unlocked = ENEMY_IDS.filter((id) => wave >= ENEMIES[id].minWave)
  // Cannot happen with the current table (two enemies are available from wave 1), but a future
  // roster edit that pushed everything past wave 1 would otherwise produce an empty wave.
  if (unlocked.length === 0) return ['goblin-skulker']

  const cheapest = Math.min(...unlocked.map((id) => ENEMIES[id].cost))
  const composition: EnemyId[] = []
  let remaining = waveBudget(wave)

  while (remaining >= cheapest) {
    const affordable = unlocked.filter((id) => ENEMIES[id].cost <= remaining)
    // Weighted towards the expensive end of what is affordable, so a wave reads as "three
    // skeletons and a pack of goblins" rather than as twenty goblins. Squaring the cost is
    // enough of a thumb on the scale to do that without ever excluding the cheap ones, which
    // still have to fill whatever the budget has left over.
    const weights = affordable.map((id) => ENEMIES[id].cost * ENEMIES[id].cost)
    const total = weights.reduce((sum, weight) => sum + weight, 0)

    let roll = rng.next() * total
    let picked = affordable[affordable.length - 1] as EnemyId
    for (let i = 0; i < affordable.length; i++) {
      roll -= weights[i] as number
      if (roll <= 0) {
        picked = affordable[i] as EnemyId
        break
      }
    }

    composition.push(picked)
    remaining -= ENEMIES[picked].cost
  }

  if (composition.length === 0) composition.push(unlocked[0] as EnemyId)

  // Shuffled, so the arrival order is not "every expensive thing, then the leftovers" — which
  // is what spending greedily produces, and it front-loads every wave with its own hardest
  // moment.
  return rng.shuffle(composition)
}

/** What one composition is worth in gold if the player kills all of it. */
export function waveValue(composition: readonly EnemyId[]): number {
  return composition.reduce((sum, id) => sum + ENEMIES[id].gold, 0)
}
