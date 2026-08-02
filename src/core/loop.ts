/**
 * Fixed-timestep simulation, deliberately decoupled from the render rate.
 *
 * Render rate varies wildly across our targets — 60Hz on a desktop monitor, 72/90/120Hz
 * on a Quest 3, and whatever a throttled background tab decides to do. Gameplay
 * (movement, AI, cooldowns, projectiles) must not change behaviour with it, so it steps
 * at a constant rate and rendering interpolates between the last two states via `alpha`.
 */

export type SystemUpdate = (dt: number, elapsed: number) => void

export interface SystemHandle {
  /** Lower runs earlier within a single fixed step. */
  readonly order: number
  readonly update: SystemUpdate
}

/** 60Hz simulation. Chosen to be independent of every display rate we target. */
export const FIXED_STEP = 1 / 60

/**
 * Longest real-time slice a single frame may simulate. Without this, a frame hitch or a
 * backgrounded tab hands us a huge delta, we run hundreds of steps to catch up, that takes
 * even longer, and the accumulator never drains — the classic spiral of death. We drop the
 * excess time instead: the world runs briefly in slow motion, which is always preferable
 * to a lock-up (especially in a headset).
 */
const MAX_FRAME_DELTA = 0.25

export class FixedLoop {
  readonly step: number

  /** Render interpolation factor in [0,1) between the previous and current fixed state. */
  alpha = 0

  /** Fixed steps consumed by the most recent `advance`. Diagnostic only. */
  lastStepCount = 0

  private accumulator = 0
  private elapsed = 0
  private systems: SystemHandle[] = []
  private dirty = false

  constructor(step: number = FIXED_STEP) {
    this.step = step
  }

  /** Returns an unregister function. */
  register(update: SystemUpdate, order = 0): () => void {
    const handle: SystemHandle = { order, update }
    this.systems.push(handle)
    this.dirty = true
    return () => {
      const i = this.systems.indexOf(handle)
      if (i !== -1) this.systems.splice(i, 1)
    }
  }

  /** Feed the real frame delta; runs zero or more fixed steps. */
  advance(frameDelta: number): void {
    if (this.dirty) {
      this.systems.sort((a, b) => a.order - b.order)
      this.dirty = false
    }

    this.accumulator += Math.min(frameDelta, MAX_FRAME_DELTA)
    this.lastStepCount = 0

    while (this.accumulator >= this.step) {
      this.accumulator -= this.step
      this.elapsed += this.step
      this.lastStepCount++
      for (const system of this.systems) {
        system.update(this.step, this.elapsed)
      }
    }

    this.alpha = this.accumulator / this.step
  }

  /** Total simulated time in seconds. Paused frames do not advance it. */
  get time(): number {
    return this.elapsed
  }

  /** Drop pending time without simulating it — use after a load or an XR session start. */
  reset(): void {
    this.accumulator = 0
    this.alpha = 0
    this.lastStepCount = 0
  }
}

/**
 * System ordering constants. Named so the read order in a file matches the run order,
 * rather than leaving bare magic numbers scattered across the codebase.
 */
export const SystemOrder = {
  Input: 0,
  Player: 100,
  AI: 200,
  Physics: 300,
  Combat: 400,
  Effects: 500,
  Audio: 600,
} as const

/** The single simulation instance the game runs on. */
export const gameLoop = new FixedLoop()
