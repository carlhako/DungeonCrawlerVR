import { describe, expect, it } from 'vitest'
import {
  CHART_SECONDS,
  createFrameStats,
  currentFps,
  frameAt,
  frameSummary,
  pushFrame,
  resetFrameStats,
  stampAt,
  windowStart,
} from '@/systems/frameStats'

/** One second of frames at a steady rate. */
function feed(stats: ReturnType<typeof createFrameStats>, fps: number, seconds: number): void {
  const delta = 1 / fps
  for (let i = 0; i < Math.round(fps * seconds); i++) pushFrame(stats, delta)
}

describe('frame stats ring buffer', () => {
  it('records frames in order, oldest first', () => {
    const stats = createFrameStats(8)
    pushFrame(stats, 0.01)
    pushFrame(stats, 0.02)
    pushFrame(stats, 0.03)

    expect(stats.count).toBe(3)
    expect(frameAt(stats, 0)).toBeCloseTo(0.01)
    expect(frameAt(stats, 2)).toBeCloseTo(0.03)
    expect(stats.elapsed).toBeCloseTo(0.06)
  })

  it('wraps without ever exceeding capacity, and drops the oldest frame', () => {
    const stats = createFrameStats(4)
    for (let i = 1; i <= 10; i++) pushFrame(stats, i / 1000)

    expect(stats.count).toBe(4)
    // The last four pushed, still in order.
    expect(frameAt(stats, 0)).toBeCloseTo(0.007)
    expect(frameAt(stats, 3)).toBeCloseTo(0.01)
    // Stamps stay monotonic across the wrap — the windowing depends on it.
    for (let i = 1; i < stats.count; i++) {
      expect(stampAt(stats, i)).toBeGreaterThan(stampAt(stats, i - 1))
    }
  })

  it('ignores readings that are not a positive finite number', () => {
    const stats = createFrameStats(8)
    pushFrame(stats, 0)
    pushFrame(stats, -0.016)
    pushFrame(stats, Number.NaN)
    pushFrame(stats, Number.POSITIVE_INFINITY)

    expect(stats.count).toBe(0)
    // A single zero-length frame would otherwise divide into an infinite fps and sit in the
    // buffer poisoning every average for five seconds.
    expect(currentFps(stats)).toBe(0)
    expect(frameSummary(stats).frames).toBe(0)
  })

  it('caps an absent-frames gap rather than recording it verbatim', () => {
    const stats = createFrameStats(8)
    pushFrame(stats, 45)

    // A headset put down on a desk is not a 0.02fps frame-rate dip; it is the absence of
    // frames. Capped at one second so the readout recovers, but still visible as the worst
    // possible frame rather than dropped.
    expect(frameAt(stats, 0)).toBe(1)
    expect(currentFps(stats)).toBe(1)
  })

  it('resets to empty', () => {
    const stats = createFrameStats(8)
    feed(stats, 72, 0.1)
    resetFrameStats(stats)
    expect(stats.count).toBe(0)
    expect(stats.elapsed).toBe(0)
    expect(frameSummary(stats).avgFps).toBe(0)
  })
})

describe('windowing', () => {
  it('selects only the frames inside the requested window', () => {
    const stats = createFrameStats(1024)
    feed(stats, 100, 3) // 300 frames, 3 seconds

    const start = windowStart(stats, 1)
    const frames = stats.count - start
    // One second of 10ms frames, give or take the boundary frame.
    expect(frames).toBeGreaterThanOrEqual(100)
    expect(frames).toBeLessThanOrEqual(101)
    expect(stampAt(stats, start)).toBeGreaterThan(stats.elapsed - 1.02)
  })

  it('returns everything retained when the window is longer than the history', () => {
    const stats = createFrameStats(1024)
    feed(stats, 72, 0.5)
    expect(windowStart(stats, CHART_SECONDS)).toBe(0)
  })
})

describe('frame summary', () => {
  it('reports the steady rate it was fed', () => {
    const stats = createFrameStats(1024)
    feed(stats, 72, 5)

    const summary = frameSummary(stats)
    expect(summary.fps).toBeCloseTo(72, 0)
    expect(summary.avgFps).toBeCloseTo(72, 0)
    expect(summary.minFps).toBeCloseTo(72, 0)
    expect(summary.lowFps).toBeCloseTo(72, 0)
  })

  it('separates a healthy average from a hitching one', () => {
    const smooth = createFrameStats(1024)
    feed(smooth, 72, 5)

    const hitching = createFrameStats(1024)
    // The same nominal rate, with one 100ms stall every second — the case the whole readout
    // exists to catch. An average alone calls these two nearly identical.
    for (let second = 0; second < 5; second++) {
      feed(hitching, 72, 1)
      pushFrame(hitching, 0.1)
    }

    const a = frameSummary(smooth)
    const b = frameSummary(hitching)
    expect(b.avgFps).toBeGreaterThan(a.avgFps - 10)
    expect(b.minFps).toBeLessThan(15)
    expect(b.lowFps).toBeLessThan(30)
  })

  it('takes the 1% low from the slowest frames, not from one unlucky sample', () => {
    const stats = createFrameStats(1024)
    feed(stats, 100, 5) // 500 frames at 10ms
    // Five bad frames — exactly the worst 1% of the ~500 retained.
    for (let i = 0; i < 5; i++) pushFrame(stats, 0.05)

    const summary = frameSummary(stats)
    // The mean of the worst 1% is the mean of those five 50ms frames.
    expect(summary.lowFps).toBeCloseTo(20, 0)
    // ...and it is strictly worse than the average, which is what makes it worth showing.
    expect(summary.lowFps).toBeLessThan(summary.avgFps)
    // The minimum is the single worst frame, so it can never be better than the 1% low.
    expect(summary.minFps).toBeLessThanOrEqual(summary.lowFps + 1e-6)
  })

  it('never reports a rate better than the fastest frame it was given', () => {
    const stats = createFrameStats(1024)
    feed(stats, 90, 2)
    pushFrame(stats, 0.03)

    const summary = frameSummary(stats)
    for (const value of [summary.fps, summary.avgFps, summary.minFps, summary.lowFps]) {
      expect(value).toBeLessThanOrEqual(90 + 1e-6)
      expect(value).toBeGreaterThan(0)
    }
  })

  it('counts only the chart window, however long the buffer has been running', () => {
    const stats = createFrameStats(1024)
    feed(stats, 72, 30)
    const summary = frameSummary(stats)
    expect(summary.frames).toBeGreaterThan(72 * CHART_SECONDS - 5)
    expect(summary.frames).toBeLessThan(72 * CHART_SECONDS + 5)
  })

  it('survives a full wrap of the ring', () => {
    const stats = createFrameStats(64)
    feed(stats, 72, 10) // 720 frames into 64 slots

    const summary = frameSummary(stats)
    expect(summary.frames).toBe(64)
    expect(summary.avgFps).toBeCloseTo(72, 0)
  })
})
