/**
 * The run state machine: what the game is currently doing.
 *
 *   foyer ──open the door──▶ loading ──▶ wave ──cleared──▶ waveComplete ──▶ foyer
 *                                          └────died─────▶ death ─────────▶ foyer
 *
 * A machine rather than a set of booleans because these states are genuinely exclusive and
 * the bugs from treating them otherwise are the expensive kind: a wave that starts twice
 * because the door was opened during loading, or enemies that keep spawning into a foyer
 * the player has already returned to. Illegal transitions are refused and logged, not
 * silently applied.
 *
 * **Death costs nothing but the wave.** Progression is pure RPG (PLAN.md), so `death` and
 * `waveComplete` differ only in whether a payout happened — the save is untouched either
 * way. That is a design decision, not an oversight.
 *
 * The phase is *not* persisted. A save that restored mid-wave would drop the player into a
 * dungeon that no longer exists with enemies that were never spawned; reloading always
 * returns you to the foyer with everything you had.
 */

import { create } from 'zustand'
import { useGame } from '@/systems/game'

export type RunPhase = 'foyer' | 'loading' | 'wave' | 'waveComplete' | 'death'

export type RunEvent =
  /** The player opened the dungeon door. */
  | 'enterDoor'
  /** The dungeon finished generating and loading. */
  | 'loaded'
  /** Every enemy in the wave is dead. */
  | 'cleared'
  /** The player's health reached zero. */
  | 'died'
  /** Leaving the end-of-wave state, back to the shop. */
  | 'return'

/**
 * What an event carries with it.
 *
 * Only `cleared` uses it, and only for the payout. Deliberately a payload on the event rather
 * than a number the store reaches out for: the Wave Director knows what the player killed and
 * the run machine does not, and inverting that would have this file importing the director,
 * the enemy pool and the enemy table to answer a question it is being told the answer to.
 */
export interface RunEventDetail {
  /** Gold earned during the wave, from the Wave Director. */
  earned?: number
}

const TRANSITIONS: Record<RunPhase, Partial<Record<RunEvent, RunPhase>>> = {
  foyer: { enterDoor: 'loading' },
  // No `died` here: nothing can hurt the player while the dungeon is still being built.
  loading: { loaded: 'wave' },
  wave: { cleared: 'waveComplete', died: 'death' },
  waveComplete: { return: 'foyer' },
  death: { return: 'foyer' },
}

/** The phase this event leads to, or null if it isn't legal from here. */
export function nextPhase(phase: RunPhase, event: RunEvent): RunPhase | null {
  return TRANSITIONS[phase][event] ?? null
}

/**
 * What the player is paid for a wave, given what they killed.
 *
 * As of Sprint 2.3 the number comes from the Wave Director — the sum of the gold each dead
 * enemy was worth — and this is only the floor under it. A flat clear bonus was the placeholder
 * from 1.2 and it had the wrong incentive in it: it paid the same for fighting through a wave
 * as for hiding in a corridor until the last thing wandered off. What remains is a small
 * consolation so that a wave finished with a lucky environmental kill still pays *something*,
 * which matters mostly for the greybox and the smoke test.
 */
export const MINIMUM_REWARD = 5

export function waveReward(earned: number): number {
  return Math.max(MINIMUM_REWARD, Math.round(earned))
}

/** Human-readable phase, for the foyer status board. */
export function phaseLabel(phase: RunPhase, wave: number): string {
  switch (phase) {
    case 'foyer':
      return `Wave ${wave} awaits`
    case 'loading':
      return 'The dungeon stirs...'
    case 'wave':
      return `Wave ${wave} — in the dark`
    case 'waveComplete':
      return `Wave ${wave} cleared`
    case 'death':
      return 'You fell. Nothing was lost.'
  }
}

interface RunStore {
  phase: RunPhase
  /** The wave being attempted. Mirrored from the save when a run starts. */
  wave: number
  /** Waves started this session. Not persisted — the save owns progression. */
  wavesStarted: number
  /** Gold paid by the most recent clear, for the status board to show. */
  lastReward: number
  /**
   * Apply an event. Returns whether it was legal.
   *
   * Callers that can fire spuriously — a door being opened twice, a clear check running on
   * every fixed step — can call this freely and check the boolean, rather than each of them
   * having to know the current phase.
   */
  send(event: RunEvent, detail?: RunEventDetail): boolean
  /** Back to a fresh foyer without touching the save. For tests and the dev panel. */
  reset(): void
}

export const useRun = create<RunStore>()((set, get) => ({
  phase: 'foyer',
  // Seeded from the save rather than from 1. The game store is imported above, so it has
  // already hydrated from storage by the time this runs — without this, a player who
  // reloads while on wave 5 is told the foyer is waiting on wave 1 until they open the door.
  wave: useGame.getState().save.wave,
  wavesStarted: 0,
  lastReward: 0,

  send: (event, detail) => {
    const { phase } = get()
    const next = nextPhase(phase, event)
    if (!next) {
      console.warn(`[run] ignored "${event}" — not legal from "${phase}"`)
      return false
    }

    console.info(`[run] ${phase} --${event}--> ${next}`)

    switch (next) {
      case 'loading': {
        // Take the wave number from the save at the moment the run starts, so the phase
        // never disagrees with what a reload would restore.
        const game = useGame.getState()
        set({ phase: next, wave: game.save.wave, wavesStarted: get().wavesStarted + 1 })
        return true
      }
      case 'waveComplete': {
        const reward = waveReward(detail?.earned ?? 0)
        useGame.getState().clearWave(reward)
        set({ phase: next, lastReward: reward })
        return true
      }
      case 'foyer': {
        set({ phase: next, wave: useGame.getState().save.wave })
        return true
      }
      default:
        set({ phase: next })
        return true
    }
  },

  reset: () => set({ phase: 'foyer', wave: useGame.getState().save.wave, lastReward: 0 }),
}))

/**
 * Open the door and begin. Kept as a named function because that is what reads correctly at
 * the call site in `Door.tsx` — the door knows it starts a wave, not that it emits an event.
 */
export function startWave(): boolean {
  return useRun.getState().send('enterDoor')
}
