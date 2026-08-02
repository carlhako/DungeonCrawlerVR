/**
 * The run: what happens when the player opens the door.
 *
 * A deliberate stub. Sprint 1.2 owns the real state machine (`Foyer → Loading → Wave →
 * WaveComplete → Foyer`) and the persisted save; all this sprint needs is somewhere for the
 * door to call, and a record that it *was* called that a test can read.
 *
 * It exists as a module rather than inline in the door so that when 1.2 lands, the change is
 * to this file and not to the foyer.
 */

export interface RunState {
  /** Waves started this session. Not persisted — 1.2 owns the save. */
  wavesStarted: number
  /** Simulated-time-free record of the last start, for the smoke test to assert against. */
  lastStartedAt: number | null
}

export const runState: RunState = {
  wavesStarted: 0,
  lastStartedAt: null,
}

type WaveListener = (wave: number) => void

const listeners = new Set<WaveListener>()

/** Subscribe to wave starts. Returns the unsubscribe function. */
export function onWaveStart(listener: WaveListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Begin a wave. Currently: count it, announce it, and log.
 *
 * The log line is the acceptance test for this sprint — "walk to the door, activate it, see
 * `startWave()` fire" — and stays until there is a dungeon to load instead.
 */
export function startWave(): void {
  runState.wavesStarted += 1
  runState.lastStartedAt = Date.now()
  console.info(`startWave() — wave ${runState.wavesStarted}`)
  for (const listener of listeners) listener(runState.wavesStarted)
}
