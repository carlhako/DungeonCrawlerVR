/**
 * Frame-time tracking, as pure data.
 *
 * Sprint 3.1's own acceptance test is "sustained 72fps, read from inside the headset", and
 * there is currently no way to read anything from inside the headset: `r3f-perf` (the F1 HUD)
 * is a DOM overlay and does not composite into an immersive session, so the frame numbers are
 * invisible exactly where they matter. This module is the measurement half of that readout;
 * `ui/FpsReadout.tsx` and `ui/FrameChart.tsx` are the display.
 *
 * Deliberately free of three.js and React: what makes a frame-rate readout trustworthy is that
 * "1% low" means one specific thing, and that is a claim about a ring buffer of numbers, which
 * is a claim a unit test can settle. See the note in PROGRESS.md about Sprint 2.1's light ramp:
 * headless frames run at ~0.6s each, so nothing here can be judged by running it headlessly —
 * only its invariants can.
 */

import { create } from 'zustand'

/** The Quest 3's refresh rate, and the line every measurement here is read against. */
export const TARGET_FPS = 72
/** 13.888…ms. The budget a frame has to fit inside to hold `TARGET_FPS`. */
export const TARGET_FRAME_MS = 1000 / TARGET_FPS

/**
 * How many frames to retain. 5 seconds of chart at 120Hz is 600, so this holds the whole
 * slice with room to spare at any refresh rate a headset or monitor will produce.
 */
export const FRAME_CAPACITY = 1024

/** The chart's window, and the window the 1% low is taken over. */
export const CHART_SECONDS = 5
/** The window the headline average and minimum are taken over. */
export const SUMMARY_SECONDS = 1

/**
 * The slowest frame worth recording, in seconds.
 *
 * A backgrounded tab, a headset put down on a desk, or a breakpoint in the debugger all hand
 * the render loop a delta measured in seconds. That is not a frame-rate dip — it is the
 * absence of frames — and recording it verbatim would leave the readout showing a fraction of
 * one fps for five seconds after the player picks the headset back up. Capped rather than
 * dropped, because a genuine multi-hundred-millisecond stall (a shader compile, a level load)
 * *is* worth seeing, and dropping it would hide the single worst thing the readout can catch.
 */
const MAX_RECORDED_DELTA = 1

export interface FrameStats {
  /** Frame durations in seconds, oldest-to-newest within the ring. */
  readonly deltas: Float32Array
  /** Seconds since tracking began, at the end of each recorded frame. */
  readonly stamps: Float32Array
  /** Where the next frame will be written. */
  head: number
  /** How many entries are valid — rises to `deltas.length` and stays there. */
  count: number
  /** Total tracked time. The clock every window is measured back from. */
  elapsed: number
}

export function createFrameStats(capacity: number = FRAME_CAPACITY): FrameStats {
  return {
    deltas: new Float32Array(capacity),
    stamps: new Float32Array(capacity),
    head: 0,
    count: 0,
    elapsed: 0,
  }
}

/**
 * Record one rendered frame.
 *
 * Rejects deltas that are not a positive finite number outright: a zero or negative delta
 * would divide into an infinite fps, and one bad reading poisoning the buffer for five seconds
 * is a readout nobody trusts again.
 */
export function pushFrame(stats: FrameStats, delta: number): void {
  if (!Number.isFinite(delta) || delta <= 0) return
  const capped = Math.min(delta, MAX_RECORDED_DELTA)
  const capacity = stats.deltas.length
  stats.elapsed += capped
  stats.deltas[stats.head] = capped
  stats.stamps[stats.head] = stats.elapsed
  stats.head = (stats.head + 1) % capacity
  if (stats.count < capacity) stats.count++
}

export function resetFrameStats(stats: FrameStats): void {
  stats.head = 0
  stats.count = 0
  stats.elapsed = 0
}

/**
 * Read one retained frame's duration by *logical* index, where 0 is the oldest frame still in
 * the buffer and `stats.count - 1` is the newest.
 *
 * Exists so the chart can walk the ring in order without anything copying it into an array
 * first — the chart redraws every frame while it is held up, and this is the read path.
 */
export function frameAt(stats: FrameStats, index: number): number {
  if (index < 0 || index >= stats.count) return 0
  const capacity = stats.deltas.length
  const start = (stats.head - stats.count + capacity) % capacity
  return stats.deltas[(start + index) % capacity]!
}

/** The stamp of a retained frame, by the same logical index as `frameAt`. */
export function stampAt(stats: FrameStats, index: number): number {
  if (index < 0 || index >= stats.count) return 0
  const capacity = stats.stamps.length
  const start = (stats.head - stats.count + capacity) % capacity
  return stats.stamps[(start + index) % capacity]!
}

/**
 * The logical index of the first frame inside the last `seconds`, so a caller can iterate
 * `windowStart(stats, s) .. stats.count - 1`.
 *
 * A binary search would be tidier and is not worth it: the answer is nearly always within a
 * few hundred of the end, and the linear walk backwards touches exactly the frames it returns.
 */
export function windowStart(stats: FrameStats, seconds: number): number {
  const cutoff = stats.elapsed - seconds
  let i = stats.count - 1
  while (i > 0 && stampAt(stats, i - 1) > cutoff) i--
  return Math.max(0, i)
}

/** The instantaneous rate: one over the most recent frame. Zero before the first frame. */
export function currentFps(stats: FrameStats): number {
  if (stats.count === 0) return 0
  return 1 / frameAt(stats, stats.count - 1)
}

export interface FrameSummary {
  /** 1 / the last frame. What the head-locked readout shows. */
  fps: number
  /** Frames in the summary window divided by the time they took. */
  avgFps: number
  /** One over the *slowest* frame in the summary window — the worst moment, not an average. */
  minFps: number
  /**
   * One over the mean of the slowest 1% of frames in the chart window.
   *
   * The number that actually predicts whether a headset feels smooth: an average of 72 with a
   * hitch every second reads as broken, and only this and `minFps` can tell the two apart.
   * Averaged over the worst percentile rather than taken as a single percentile sample, so one
   * unlucky frame does not define it.
   */
  lowFps: number
  /** Frames retained in the chart window. Zero means nothing has been measured yet. */
  frames: number
}

/** Scratch space for the 1% low's sort, so a per-frame redraw allocates nothing. */
const sortScratch = new Float32Array(FRAME_CAPACITY)

export function frameSummary(
  stats: FrameStats,
  avgSeconds: number = SUMMARY_SECONDS,
  lowSeconds: number = CHART_SECONDS,
): FrameSummary {
  const summary: FrameSummary = { fps: 0, avgFps: 0, minFps: 0, lowFps: 0, frames: 0 }
  if (stats.count === 0) return summary

  summary.fps = currentFps(stats)

  const avgFrom = windowStart(stats, avgSeconds)
  let total = 0
  let worst = 0
  for (let i = avgFrom; i < stats.count; i++) {
    const delta = frameAt(stats, i)
    total += delta
    if (delta > worst) worst = delta
  }
  const avgFrames = stats.count - avgFrom
  summary.avgFps = total > 0 ? avgFrames / total : 0
  summary.minFps = worst > 0 ? 1 / worst : 0

  const lowFrom = windowStart(stats, lowSeconds)
  const lowFrames = stats.count - lowFrom
  summary.frames = lowFrames
  const usable = Math.min(lowFrames, sortScratch.length)
  for (let i = 0; i < usable; i++) sortScratch[i] = frameAt(stats, stats.count - usable + i)
  // Ascending, so the slowest frames — the ones this measures — are at the end.
  const window = sortScratch.subarray(0, usable)
  window.sort()
  const worstCount = Math.max(1, Math.floor(usable * 0.01))
  let worstTotal = 0
  for (let i = usable - worstCount; i < usable; i++) worstTotal += window[i]!
  summary.lowFps = worstTotal > 0 ? worstCount / worstTotal : 0

  return summary
}

/** The one buffer the game records into. */
export const frameStats = createFrameStats()

interface FrameHudStore {
  /**
   * Whether the head-locked readout and the hold-to-show chart are mounted at all.
   *
   * Deliberately **not** persisted, and not on the 1.4 settings board: this is dev
   * instrumentation, the F2 panel is its only control, and a frame counter someone left on
   * three weeks ago is a frame counter costing a draw call in front of their face forever.
   * Tracking itself is always on in dev, so the chart has five seconds of history the instant
   * it is summoned rather than drawing itself in from empty.
   */
  showFpsReadout: boolean
  setShowFpsReadout(value: boolean): void
}

export const useFrameHud = create<FrameHudStore>()((set) => ({
  showFpsReadout: import.meta.env.DEV,
  setShowFpsReadout: (value) => set({ showFpsReadout: value }),
}))
