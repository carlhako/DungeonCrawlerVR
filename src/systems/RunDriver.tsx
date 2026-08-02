import { useRef } from 'react'
import { SystemOrder } from '@/core/loop'
import { useFixedUpdate } from '@/core/simulation'
import { playerState } from '@/systems/player'
import { useRun, type RunPhase } from '@/systems/run'
import { FOYER_BOUNDS } from '@/scenes/Foyer'

/**
 * Drives the run machine's timed and positional transitions.
 *
 * Most of this is scaffolding with a known expiry date. There is no dungeon to load until
 * Sprint 2.1 and nothing to kill until 2.3, so "loading" is a pause and "the wave is
 * cleared" is the player walking back into the foyer. That is enough to make the whole loop
 * — door, wave, payout, back to the shop — real and testable *now*, on a headset, rather
 * than a state machine that only unit tests have ever seen run.
 *
 * The Wave Director in 2.3 takes over `loaded` and `cleared`, and this file loses everything
 * except the end-of-wave pause.
 */

/** Long enough to read as a transition rather than a stutter. Replaced by real generation. */
const LOADING_SECONDS = 0.9

/** How long the end-of-wave state holds before handing the player back to the shop. */
const COMPLETE_SECONDS = 2.5

const DOORWAY_Z = -FOYER_BOUNDS.depth / 2
/** Past the doorway and into the passage: the player has committed to the wave. */
const OUTSIDE_Z = DOORWAY_Z - 0.6
/** Back inside the room proper. Hysteresis, so standing in the doorway doesn't flicker. */
const INSIDE_Z = DOORWAY_Z + 0.4

export function RunDriver() {
  const elapsed = useRef(0)
  const phase = useRef<RunPhase>('foyer')
  /** Whether the player has actually left the foyer this wave. */
  const left = useRef(false)

  useFixedUpdate((dt) => {
    const run = useRun.getState()

    if (run.phase !== phase.current) {
      phase.current = run.phase
      elapsed.current = 0
      left.current = false
    }
    elapsed.current += dt

    switch (run.phase) {
      case 'loading':
        if (elapsed.current >= LOADING_SECONDS) run.send('loaded')
        break

      case 'wave': {
        // Placeholder clear condition: go out, come back. The `left` latch matters — the
        // player is standing inside the foyer at the moment the wave starts, so without it
        // every wave would clear itself on the step it began.
        const z = playerState.position.z
        if (z < OUTSIDE_Z) left.current = true
        if (left.current && z > INSIDE_Z) run.send('cleared')
        break
      }

      case 'waveComplete':
      case 'death':
        if (elapsed.current >= COMPLETE_SECONDS) run.send('return')
        break

      case 'foyer':
        break
    }
  }, SystemOrder.World)

  return null
}
