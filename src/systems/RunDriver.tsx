import { useRef } from 'react'
import { SystemOrder } from '@/core/loop'
import { useFixedUpdate } from '@/core/simulation'
import { recallPlayer, PLAYER_SPAWN } from '@/systems/player'
import { useRun, type RunPhase } from '@/systems/run'
import { useDungeon } from '@/systems/dungeon/store'
import { DUNGEON_MOUTH } from '@/scenes/Foyer'

/**
 * Drives the run machine's timed transitions.
 *
 * "Loading" builds the dungeon for this wave — generated from a seed derived from the wave
 * number, anchored so that it meets the far end of the foyer's passage — and the end-of-wave
 * states hold for a beat before handing the player back to the shop.
 *
 * That is now all it does. Sprint 2.3's Wave Director took over `cleared`, which used to be
 * "walk out of the foyer and back in" and is now "everything that arrived is dead", and
 * `EnemyDriver` owns `died`. What is left here is the two beats that exist for the player
 * rather than for the game: a door that opens onto a level which appeared between two frames
 * reads as a glitch, and a wave that ends by yanking you back to the shop mid-swing reads as
 * a bug.
 */

/**
 * A beat, not a progress bar.
 *
 * Generation takes a couple of milliseconds, so this is entirely for the player: a door that
 * opens onto a level that appeared between two frames reads as a glitch. It also gives the
 * geometry a frame or two to be uploaded before anyone is looking at it.
 */
const LOADING_SECONDS = 0.9

/** How long the end-of-wave state holds before the player is handed back to the shop. */
const COMPLETE_SECONDS = 1.2

export function RunDriver() {
  const elapsed = useRef(0)
  const phase = useRef<RunPhase>('foyer')

  useFixedUpdate((dt) => {
    const run = useRun.getState()

    if (run.phase !== phase.current) {
      phase.current = run.phase
      elapsed.current = 0
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

      case 'wave':
        // Nothing. `EnemyDriver` decides when a wave is over, and it is over when every enemy
        // in it is dead — not when the player walks back through the door. Retreating to the
        // foyer is allowed and always was; it is the safe room. It just does not finish
        // anything any more, so eventually you have to come back out.
        break

      case 'waveComplete':
        // The player is recalled to the foyer on the first step — the wave is over, there
        // is nothing left to walk through, and the empty dungeon is scenery rather than
        // ceremony. The beat is a moment to see the payout land before the level goes away.
        recallPlayer({ x: PLAYER_SPAWN[0], y: PLAYER_SPAWN[1], z: PLAYER_SPAWN[2] })
        if (elapsed.current >= COMPLETE_SECONDS) {
          run.send('return')
        }
        break

      case 'death':
        // The one forced move in the game. There is no walk home available from dead, and
        // leaving a corpse standing in a corridor waiting to be escorted back is worse than
        // the cut. See `recallPlayer`.
        if (elapsed.current >= COMPLETE_SECONDS) {
          recallPlayer({ x: PLAYER_SPAWN[0], y: PLAYER_SPAWN[1], z: PLAYER_SPAWN[2] })
          run.send('return')
        }
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
