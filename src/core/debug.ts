import { gameLoop } from './loop'

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
  }
  ;(window as unknown as { __DCVR__: DebugHandle }).__DCVR__ = handle
}
