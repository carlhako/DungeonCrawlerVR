import { describe, expect, it, vi } from 'vitest'
import { FIXED_STEP, FixedLoop } from './loop'

describe('FixedLoop', () => {
  it('runs exactly one step per elapsed step of real time', () => {
    const loop = new FixedLoop()
    const update = vi.fn()
    loop.register(update)

    loop.advance(FIXED_STEP)
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith(FIXED_STEP, FIXED_STEP)
  })

  it('carries leftover time across frames rather than dropping it', () => {
    const loop = new FixedLoop()
    const update = vi.fn()
    loop.register(update)

    // Two frames of 3/4 of a step should total 1.5 steps: one now, one banked.
    loop.advance(FIXED_STEP * 0.75)
    expect(update).toHaveBeenCalledTimes(0)
    loop.advance(FIXED_STEP * 0.75)
    expect(update).toHaveBeenCalledTimes(1)
    expect(loop.alpha).toBeCloseTo(0.5, 5)
  })

  it('simulates the same total time regardless of frame pacing', () => {
    const rates = [60, 90, 72, 24]
    const totals = rates.map((fps) => {
      const loop = new FixedLoop()
      loop.register(() => {})
      for (let i = 0; i < fps; i++) loop.advance(1 / fps)
      return loop.time
    })

    // Each ran one second of real time. Simulated time tracks it to within a single
    // pending step — the remainder is banked in the accumulator, not lost, so the error
    // never accumulates across seconds.
    for (const total of totals) {
      expect(Math.abs(total - 1)).toBeLessThanOrEqual(FIXED_STEP)
    }
  })

  it('does not drift over a long run', () => {
    const loop = new FixedLoop()
    loop.register(() => {})

    // 10 seconds at an awkward, non-divisible frame rate.
    for (let i = 0; i < 370; i++) loop.advance(1 / 37)

    expect(Math.abs(loop.time - 10)).toBeLessThanOrEqual(FIXED_STEP)
  })

  it('clamps a huge delta instead of spiralling', () => {
    const loop = new FixedLoop()
    const update = vi.fn()
    loop.register(update)

    // A tab backgrounded for 10 seconds must not run 600 steps in one frame.
    loop.advance(10)
    expect(update.mock.calls.length).toBeLessThanOrEqual(Math.ceil(0.25 / FIXED_STEP))
  })

  it('runs systems in ascending order regardless of registration order', () => {
    const loop = new FixedLoop()
    const calls: string[] = []
    loop.register(() => calls.push('late'), 500)
    loop.register(() => calls.push('early'), 0)
    loop.register(() => calls.push('middle'), 100)

    loop.advance(FIXED_STEP)
    expect(calls).toEqual(['early', 'middle', 'late'])
  })

  it('stops calling a system once unregistered', () => {
    const loop = new FixedLoop()
    const update = vi.fn()
    const unregister = loop.register(update)

    loop.advance(FIXED_STEP)
    unregister()
    loop.advance(FIXED_STEP)

    expect(update).toHaveBeenCalledTimes(1)
  })
})
