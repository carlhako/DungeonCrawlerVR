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
 * Gold for clearing a wave.
 *
 * A placeholder curve until the Wave Director in Sprint 2.3 pays out per enemy killed, which
 * is where the number should actually come from — killing things is what earns gold, and a
 * flat clear bonus rewards hiding in a corner until the timer runs out. Deliberately generous
 * enough that two waves buy something in the Sprint 1.3 shop, so the loop is testable.
 */
export function waveReward(wave: number): number {
  return 25 + 10 * Math.max(0, wave - 1)
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
  send(event: RunEvent): boolean
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

  send: (event) => {
    const { phase, wave } = get()
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
        const reward = waveReward(wave)
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
