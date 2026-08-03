/**
 * The Wave Director: what a wave contains, when it arrives, and when it is over.
 *
 * It replaces the placeholder that has stood in since Sprint 1.2 — "walk out of the foyer and
 * back in" — with the real thing: a composition, staggered spawning, a clear condition that
 * means every enemy is dead, and a payout that is the sum of what the player actually killed.
 *
 * **The payout is per kill, not per clear.** A flat clear bonus pays the same for fighting
 * through a wave as for hiding in a corridor until the last thing wanders off a ledge, and it
 * makes the shop's prices meaningless the moment the wave count outruns the difficulty. Gold
 * accrues as things die; walking back into the foyer with three still alive pays for three
 * fewer.
 *
 * Pure, and driven from `EnemyDriver.tsx`. It knows how many enemies are alive because it is
 * told; it never looks at the pool, the dungeon or the player. That is what lets a full wave
 * be played out in a unit test in about ten lines.
 */

import { ENEMIES, type EnemyId } from '@/data/enemies'
import { composeWave, waveConcurrency, FIRST_SPAWN_DELAY, SPAWN_INTERVAL } from '@/data/waves'

export interface DirectorState {
  wave: number
  /**
   * Whether a wave is actually under way.
   *
   * Not a redundant flag. A director that has never been started looks *exactly* like one that
   * has finished — empty queue, nothing spawned, nothing alive — so without this the clear
   * condition is true before the first wave has been composed, and the very first wave the
   * player opens the door on ends on the step it began. Which is what it did.
   */
  running: boolean
  /** Still to arrive, in order. */
  queue: EnemyId[]
  /** How many this wave contains in total. Fixed when the wave begins. */
  total: number
  spawned: number
  killed: number
  /** Gold earned so far this wave. */
  gold: number
  /** Seconds until the next one may arrive. */
  nextIn: number
  /** How many may be alive at once on this wave. */
  concurrency: number
  /** True once every enemy has arrived and none is left standing. */
  cleared: boolean
}

export function createDirector(): DirectorState {
  return {
    wave: 0,
    running: false,
    queue: [],
    total: 0,
    spawned: 0,
    killed: 0,
    gold: 0,
    nextIn: 0,
    concurrency: 0,
    cleared: false,
  }
}

/** Start a wave. Composition comes from the wave number, so this is fully deterministic. */
export function beginWave(state: DirectorState, wave: number): void {
  const composition = composeWave(wave)
  state.wave = wave
  state.running = true
  state.queue = composition
  state.total = composition.length
  state.spawned = 0
  state.killed = 0
  state.gold = 0
  // A beat before the first one, so the player is not met at the door by something already
  // swinging. The dungeon deserves a few seconds of being only a dark corridor.
  state.nextIn = FIRST_SPAWN_DELAY
  state.concurrency = waveConcurrency(wave)
  state.cleared = false
}

/**
 * Advance the director and say what should arrive this step.
 *
 * Returns at most one enemy per step, and null on the overwhelming majority of them. The
 * caller is expected to actually place it and, if it cannot, to hand it back through
 * `returnToQueue` — a spawn that silently disappears is an enemy the wave is still waiting
 * for and will wait for forever, which reads as the wave simply never ending.
 *
 * `living` excludes corpses. A wave whose concurrency was decided by bodies on the floor
 * would throttle itself for a second and a half after every kill.
 */
export function stepDirector(state: DirectorState, dt: number, living: number): EnemyId | null {
  if (!state.running || state.cleared) return null

  state.nextIn -= dt

  if (state.queue.length === 0) return null
  if (state.nextIn > 0) return null
  if (living >= state.concurrency) return null

  state.nextIn = SPAWN_INTERVAL
  state.spawned += 1
  return state.queue.shift() as EnemyId
}

/**
 * Put an enemy back at the front of the queue, when there was no room to place it.
 *
 * Front, not back: the composition's order is the arrival order the wave was designed around,
 * and quietly reshuffling it because a spawn point was occupied means the wave the player
 * fights is not the wave the seed says it is.
 */
export function returnToQueue(state: DirectorState, id: EnemyId): void {
  state.queue.unshift(id)
  state.spawned -= 1
  state.nextIn = 0
}

/**
 * Is the wave over?
 *
 * Separate from `stepDirector` and called after the caller has resolved this step's deaths,
 * because it has to be asked once the kills have been *counted*. Asked in the same call and a
 * wave clears one step early, on the strength of a corpse whose payout has not landed yet.
 *
 * Every clause matters. `running` is what stops a director that has never been started from
 * reporting a clear — see the flag's own note. `spawned >= total` is what stops a wave
 * clearing during the gap before its first enemy arrives.
 */
export function markCleared(state: DirectorState, living: number): boolean {
  if (!state.running || state.cleared) return false
  if (state.queue.length > 0 || state.spawned < state.total) return false
  if (living > 0) return false
  state.cleared = true
  state.running = false
  return true
}

/** Abandon a wave in progress — the player died, or walked out of the run entirely. */
export function endWave(state: DirectorState): void {
  state.running = false
  state.queue.length = 0
}

/** Count a kill and pay for it. Returns the gold this one was worth. */
export function recordKill(state: DirectorState, type: EnemyId): number {
  const gold = ENEMIES[type].gold
  state.killed += 1
  state.gold += gold
  return gold
}

/** What the status board and the debug handle show. */
export function directorProgress(state: DirectorState): {
  total: number
  killed: number
  remaining: number
} {
  return {
    total: state.total,
    killed: state.killed,
    // What is left to deal with: still queued, plus whatever arrived and is still standing.
    remaining: Math.max(0, state.total - state.killed),
  }
}
