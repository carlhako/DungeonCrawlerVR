import { describe, expect, it } from 'vitest'
import { ENEMIES } from '@/data/enemies'
import { FIRST_SPAWN_DELAY, SPAWN_INTERVAL, composeWave, waveValue } from '@/data/waves'
import {
  beginWave,
  createDirector,
  directorProgress,
  endWave,
  markCleared,
  recordKill,
  returnToQueue,
  stepDirector,
  type DirectorState,
} from './waves'

const STEP = 1 / 60

/**
 * Play a wave out.
 *
 * The point of the director being pure: a full wave — spawning, killing, clearing — runs in a
 * loop here in milliseconds, and every question worth asking about it ("does it ever end?",
 * "can it exceed the concurrency cap?", "is the payout what the composition was worth?") is
 * answered without a dungeon, a pool or a headset.
 */
function play(
  state: DirectorState,
  options: { seconds: number; killAfter?: number; maxSlots?: number } = { seconds: 600 },
) {
  const killAfter = options.killAfter ?? 1.0
  const maxSlots = options.maxSlots ?? Infinity
  const alive: Array<{ type: keyof typeof ENEMIES; age: number }> = []
  let peak = 0
  let elapsed = 0

  while (elapsed < options.seconds && !state.cleared) {
    elapsed += STEP

    for (const enemy of alive) enemy.age += STEP
    for (let i = alive.length - 1; i >= 0; i--) {
      const enemy = alive[i]!
      if (enemy.age < killAfter) continue
      recordKill(state, enemy.type)
      alive.splice(i, 1)
    }

    // Placed *before* the clear check, in that order, because that is the order the driver
    // does it in — and the one time it mattered, getting it the other way round declared the
    // wave over on the step its last enemy was dequeued but not yet standing.
    const wanted = stepDirector(state, STEP, alive.length)
    if (wanted) {
      if (alive.length >= maxSlots) returnToQueue(state, wanted)
      else {
        alive.push({ type: wanted, age: 0 })
        peak = Math.max(peak, alive.length)
      }
    }

    markCleared(state, alive.length)
  }

  return { elapsed, peak, alive: alive.length }
}

describe('the Wave Director', () => {
  it('starts empty and clears nothing', () => {
    // A director that has never been started looks exactly like one that has finished —
    // empty queue, nothing spawned, nothing alive. Without the `running` flag the clear
    // condition is true before the first wave is composed, and the first wave the player
    // ever opens the door on ends on the step it began. Which is what it did.
    const state = createDirector()
    expect(state.cleared).toBe(false)
    expect(stepDirector(state, STEP, 0)).toBeNull()
    expect(markCleared(state, 0)).toBe(false)
    expect(state.cleared).toBe(false)
  })

  it('does not clear in the beat before the first enemy arrives', () => {
    const state = createDirector()
    beginWave(state, 1)
    for (let t = 0; t < FIRST_SPAWN_DELAY / 2; t += STEP) {
      stepDirector(state, STEP, 0)
      expect(markCleared(state, 0)).toBe(false)
    }
    expect(state.cleared).toBe(false)
  })

  it('stops spawning once the wave is abandoned', () => {
    const state = createDirector()
    beginWave(state, 8)
    endWave(state)
    for (let t = 0; t < 60; t += STEP) expect(stepDirector(state, STEP, 0)).toBeNull()
  })

  it('holds the first spawn back, so the player is not met at the door', () => {
    const state = createDirector()
    beginWave(state, 1)

    let elapsed = 0
    while (elapsed < FIRST_SPAWN_DELAY - STEP) {
      expect(stepDirector(state, STEP, 0)).toBeNull()
      elapsed += STEP
    }
  })

  it('staggers arrivals rather than emptying the queue at once', () => {
    const state = createDirector()
    beginWave(state, 6)

    // Long enough for the first, and not nearly long enough for the second.
    let spawns = 0
    let elapsed = 0
    while (elapsed < FIRST_SPAWN_DELAY + SPAWN_INTERVAL * 0.5) {
      if (stepDirector(state, STEP, spawns)) spawns += 1
      elapsed += STEP
    }
    expect(spawns).toBe(1)
  })

  it('never has more alive at once than the wave allows', () => {
    for (const wave of [1, 3, 7, 15]) {
      const state = createDirector()
      beginWave(state, wave)
      // Nothing dies for a long time, so the cap is the only thing holding spawns back.
      const result = play(state, { seconds: 400, killAfter: 90 })
      expect(result.peak, `wave ${wave}`).toBeLessThanOrEqual(state.concurrency)
    }
  })

  it('clears once every enemy has arrived and died', () => {
    const state = createDirector()
    beginWave(state, 3)
    play(state)
    expect(state.cleared).toBe(true)
    expect(state.killed).toBe(state.total)
    expect(state.queue).toHaveLength(0)
  })

  it('does not clear while something is still standing', () => {
    const state = createDirector()
    beginWave(state, 1)
    // Every enemy spawned, none killed.
    let elapsed = 0
    let alive = 0
    while (elapsed < 200) {
      if (stepDirector(state, STEP, alive)) alive += 1
      markCleared(state, alive)
      elapsed += STEP
    }
    expect(state.queue).toHaveLength(0)
    expect(state.cleared).toBe(false)
  })

  it('does not clear on the step the last thing spawns', () => {
    // The failure this guards against is a one-enemy wave that clears itself the instant it
    // begins, because "the queue is empty and nothing is alive yet" is true for one step.
    const state = createDirector()
    beginWave(state, 1)
    let alive = 0
    let elapsed = 0
    while (elapsed < 200 && !state.cleared) {
      const spawn = stepDirector(state, STEP, alive)
      if (spawn) alive += 1
      markCleared(state, alive)
      elapsed += STEP
      expect(state.cleared).toBe(false)
      if (state.queue.length === 0 && alive === state.total) break
    }
    expect(state.cleared).toBe(false)
  })

  it('pays exactly what the composition was worth', () => {
    for (const wave of [1, 2, 5, 9]) {
      const state = createDirector()
      beginWave(state, wave)
      play(state)
      expect(state.gold, `wave ${wave}`).toBe(waveValue(composeWave(wave)))
    }
  })

  it('pays nothing for what the player did not kill', () => {
    const state = createDirector()
    beginWave(state, 4)
    const first = stepAndSpawn(state)
    recordKill(state, first)
    expect(state.gold).toBe(ENEMIES[first].gold)
    expect(state.gold).toBeLessThan(waveValue(composeWave(4)))
  })

  it('finishes a wave in a sane amount of time', () => {
    // A wave that takes twenty minutes because the cadence and the cap fight each other is a
    // wave nobody finishes. This is a smell test, not a balance one.
    const state = createDirector()
    beginWave(state, 10)
    const result = play(state, { seconds: 900, killAfter: 2 })
    expect(state.cleared).toBe(true)
    expect(result.elapsed).toBeLessThan(180)
  })

  it('still ends when there was never room to place anything on time', () => {
    // The bug this exists for: a spawn the caller could not place, dropped on the floor. The
    // wave then waits forever for an enemy that never existed, which reads as the level
    // simply never ending.
    const state = createDirector()
    beginWave(state, 5)
    play(state, { seconds: 900, killAfter: 0.5, maxSlots: 1 })
    expect(state.cleared).toBe(true)
    expect(state.killed).toBe(state.total)
  })

  it('puts a refused spawn back at the front, keeping the arrival order', () => {
    const state = createDirector()
    beginWave(state, 6)
    const wanted = stepAndSpawn(state)
    const spawnedBefore = state.spawned
    returnToQueue(state, wanted)
    expect(state.queue[0]).toBe(wanted)
    expect(state.spawned).toBe(spawnedBefore - 1)
    // And it is offered again immediately rather than after another full interval.
    expect(stepDirector(state, STEP, 0)).toBe(wanted)
  })

  it('reports progress the status board can show', () => {
    const state = createDirector()
    beginWave(state, 3)
    expect(directorProgress(state)).toEqual({
      total: state.total,
      killed: 0,
      remaining: state.total,
    })
    play(state)
    expect(directorProgress(state).remaining).toBe(0)
  })

  it('starts a second wave clean', () => {
    const state = createDirector()
    beginWave(state, 1)
    play(state)
    beginWave(state, 2)
    expect(state.cleared).toBe(false)
    expect(state.killed).toBe(0)
    expect(state.gold).toBe(0)
    expect(state.queue).toEqual(composeWave(2))
  })
})

/** Run the clock until the director hands over an enemy. */
function stepAndSpawn(state: DirectorState) {
  for (let i = 0; i < 100000; i++) {
    const wanted = stepDirector(state, STEP, 0)
    if (wanted) return wanted
  }
  throw new Error('the director never spawned anything')
}
