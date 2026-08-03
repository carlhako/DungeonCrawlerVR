/**
 * The arming state machine behind the "new game" plaque.
 *
 * Wiping the save is the only irreversible thing in the game — everything else is a purchase
 * that can be earned back — and it sits on a wall in a room where the player's whole
 * vocabulary is "point at a thing and pull the trigger". One stray trigger pull must not
 * cost somebody their weapons, so the plaque takes *two* presses: the first arms it and says
 * so, the second does it. An armed plaque disarms itself shortly after, because a control
 * left armed behind the player is a trap.
 *
 * Pure and timeless in the same way as `save.ts` — time arrives as a number of seconds, so
 * the whole thing is testable without a clock, a browser or a headset.
 */

/** How long an armed plaque waits for the confirming press before standing down. */
export const ARM_SECONDS = 6

/** How long "wiped" stays up afterwards, so the player sees that it happened. */
export const DONE_SECONDS = 4

export type ResetPhase =
  /** Resting. A press here arms it. */
  | 'idle'
  /** Waiting for a confirming press. */
  | 'armed'
  /** Just wiped, showing that it did. */
  | 'done'

export interface ResetState {
  phase: ResetPhase
  /** Simulation seconds at which this phase began. */
  since: number
}

export const IDLE_RESET: ResetState = { phase: 'idle', since: 0 }

export interface ResetPress {
  next: ResetState
  /** Whether this press is the one that wipes the save. */
  wipe: boolean
}

export function pressReset(state: ResetState, now: number): ResetPress {
  switch (state.phase) {
    case 'idle':
      return { next: { phase: 'armed', since: now }, wipe: false }
    case 'armed':
      return { next: { phase: 'done', since: now }, wipe: true }
    case 'done':
      // Deliberately inert. A player who taps twice in quick succession — which is exactly
      // what confirming *is* — must not find the plaque armed again on the way out.
      return { next: state, wipe: false }
  }
}

/** Let time pass: an armed plaque stands down, and the "wiped" message clears. */
export function tickReset(state: ResetState, now: number): ResetState {
  const elapsed = now - state.since
  if (state.phase === 'armed' && elapsed >= ARM_SECONDS) return { phase: 'idle', since: now }
  if (state.phase === 'done' && elapsed >= DONE_SECONDS) return { phase: 'idle', since: now }
  return state
}

/** Whole seconds left before an armed plaque stands down. Zero in any other phase. */
export function armSecondsLeft(state: ResetState, now: number): number {
  if (state.phase !== 'armed') return 0
  return Math.max(0, Math.ceil(ARM_SECONDS - (now - state.since)))
}

/** What the interaction prompt says the button will do. */
export function resetPrompt(state: ResetState): string {
  switch (state.phase) {
    case 'idle':
      return 'Start a new game'
    case 'armed':
      return 'Confirm — wipe everything'
    case 'done':
      return 'New game started'
  }
}
