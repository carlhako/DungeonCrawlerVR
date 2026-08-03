import { useRef } from 'react'
import { SystemOrder } from '@/core/loop'
import { useFixedUpdate } from '@/core/simulation'
import { playerState } from '@/systems/player'
import { useRun, type RunPhase } from '@/systems/run'
import { useDungeon } from '@/systems/dungeon/store'
import { DUNGEON_MOUTH, FOYER_BOUNDS } from '@/scenes/Foyer'

/**
 * Drives the run machine's timed and positional transitions.
 *
 * As of Sprint 2.1 "loading" actually builds something: the dungeon for this wave is
 * generated from a seed derived from the wave number, and anchored so that it meets the far
 * end of the foyer's passage. Nothing to kill until 2.3, so "the wave is cleared" is still
 * the player walking back into the foyer.
 *
 * The Wave Director in 2.3 takes over `cleared`, and this file loses everything except the
 * loading beat and the end-of-wave pause.
 */

/**
 * A beat, not a progress bar.
 *
 * Generation takes a couple of milliseconds, so this is entirely for the player: a door that
 * opens onto a level that appeared between two frames reads as a glitch. It also gives the
 * geometry a frame or two to be uploaded before anyone is looking at it.
 */
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
        // Built on the first step of the phase, before the beat, so the level is there and
        // its meshes are uploaded by the time the passage opens onto it.
        if (useDungeon.getState().map == null) {
          useDungeon.getState().build(run.wave, DUNGEON_MOUTH)
        }
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
        // Back in the shop: the level the player just walked out of goes away, and the
        // passage seals itself again. Holding it would keep a few thousand instances and a
        // nav grid alive for a dungeon nobody can reach.
        if (useDungeon.getState().map != null) useDungeon.getState().clear()
        break
    }
  }, SystemOrder.World)

  return null
}
