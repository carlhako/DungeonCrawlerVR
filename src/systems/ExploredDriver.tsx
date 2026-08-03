/**
 * Marks dungeon cells as visited each fixed step during a wave.
 *
 * Sprint 2.5: the explored-area minimap needs to know which cells the player has been to.
 * This driver — tiny and deliberately simple — reads the player's position and the dungeon
 * placement and marks the cell (and its immediate neighbours) as explored.
 *
 * Runs at `SystemOrder.HUD` which is after the player has moved for the step.
 */

import { SystemOrder } from '@/core/loop'
import { useFixedUpdate } from '@/core/simulation'
import { playerState } from '@/systems/player'
import { useDungeon } from '@/systems/dungeon/store'
import { markExplored } from '@/systems/dungeon/explored'
import { useRun } from '@/systems/run'

export function ExploredDriver() {
  useFixedUpdate(
    () => {
      const phase = useRun.getState().phase
      if (phase !== 'wave' && phase !== 'waveComplete' && phase !== 'death') return

      const { map, nav, offset } = useDungeon.getState()
      if (!map || !nav || !offset) return

      // Mark the cell the player is standing on, plus immediate neighbours (explore radius 1).
      // The player's feet are at playerState.position.
      markExplored(
        { map, nav, offset },
        playerState.position.x,
        playerState.position.z,
        1,
      )
    },
    SystemOrder.HUD,
    [],
  )

  return null
}
