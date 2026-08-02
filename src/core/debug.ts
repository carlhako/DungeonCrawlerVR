import { gameLoop } from './loop'
import { playerState, type PlayerState } from '@/systems/player'
import { interactionState } from '@/systems/interaction'
import { useRun, type RunEvent, type RunPhase } from '@/systems/run'
import { useGame, type TransactionResult } from '@/systems/game'
import type { SaveData } from '@/systems/save'
import type { WeaponId } from '@/data/weapons'

/**
 * Dev-only handle onto the running game, hung off `window.__DCVR__`.
 *
 * This is what the headless smoke test and the browser console inspect to answer "is the
 * simulation actually advancing?" — a question a screenshot can't answer, since a frozen
 * scene and a running one look identical in a still image.
 *
 * Tree-shaken out of production by the `import.meta.env.DEV` guard.
 */
export interface DebugHandle {
  gameLoop: typeof gameLoop
  /** Simulated seconds elapsed. Must increase while the game is running. */
  readonly simTime: number
  /** Fixed steps run in the most recent frame. */
  readonly lastStepCount: number
  /**
   * Live player position, grounding and speed.
   *
   * Exposed so the smoke test can assert the things a screenshot cannot: that the player is
   * standing on the floor rather than falling through it, and that walking into a wall
   * actually stops them. Those are the two failure modes of a character controller that
   * still renders a perfectly convincing room.
   */
  readonly player: PlayerState
  /**
   * What the player is currently addressing, flattened to plain data.
   *
   * The smoke test needs to assert that walking up to the door offers the door — which is
   * the half of the interaction system a screenshot can't show, since a prompt that appears
   * for the wrong object looks exactly as convincing as one that doesn't.
   */
  readonly focus: { id: string; label: string; source: string; distance: number } | null
  /** Waves started this session. The acceptance test for Sprint 1.1. */
  readonly wavesStarted: number
  /** The run machine's current phase and wave. */
  readonly run: { phase: RunPhase; wave: number; lastReward: number }
  /**
   * The live save.
   *
   * What the smoke test asserts survives a reload — which is the whole of Sprint 1.2's
   * acceptance test and is invisible in a screenshot, since a game that has quietly lost
   * every weapon the player bought renders exactly as well as one that hasn't.
   */
  readonly save: SaveData
  /** Drive a transition by hand, from the console or the smoke test. */
  send(event: RunEvent): boolean
  /**
   * Buy a weapon without a shop.
   *
   * Scaffolding until Sprint 1.3 puts a real panel on the counter — but the thing it makes
   * testable is not scaffolding at all: whether a purchase actually survives a reload.
   */
  buyWeapon(id: WeaponId): TransactionResult
  /** Wipe progression back to a first launch. Settings are untouched. */
  resetSave(): void
}

export function installDebugHandle(): void {
  if (!import.meta.env.DEV) return
  const handle: DebugHandle = {
    gameLoop,
    get simTime() {
      return gameLoop.time
    },
    get lastStepCount() {
      return gameLoop.lastStepCount
    },
    get player() {
      return playerState
    },
    get focus() {
      const focus = interactionState.focus
      if (!focus) return null
      return {
        id: focus.id,
        label: focus.label,
        source: interactionState.source,
        distance: +interactionState.distance.toFixed(3),
      }
    },
    get wavesStarted() {
      return useRun.getState().wavesStarted
    },
    get run() {
      const { phase, wave, lastReward } = useRun.getState()
      return { phase, wave, lastReward }
    },
    get save() {
      return useGame.getState().save
    },
    send: (event) => useRun.getState().send(event),
    buyWeapon: (id) => useGame.getState().buyWeapon(id),
    resetSave: () => useGame.getState().resetSave(),
  }
  ;(window as unknown as { __DCVR__: DebugHandle }).__DCVR__ = handle
}
