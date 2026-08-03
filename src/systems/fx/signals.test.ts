import { beforeEach, describe, expect, it } from 'vitest'
import { clearFxSignals, fxSeq, fxSince, publishFx, type FxSignal } from '@/systems/fx/signals'

function muzzle(x: number): FxSignal {
  return {
    kind: 'muzzle',
    point: { x, y: 0, z: 0 },
    direction: { x: 0, y: 0, z: -1 },
    element: 'fire',
  }
}

describe('fx signals', () => {
  beforeEach(() => {
    clearFxSignals()
  })

  it('hands back everything published since the caller last looked', () => {
    publishFx(muzzle(1))
    publishFx(muzzle(2))

    const first = fxSince(0)
    expect(first.signals.map((signal) => signal.point.x)).toEqual([1, 2])

    publishFx(muzzle(3))
    const second = fxSince(first.seq)
    expect(second.signals.map((signal) => signal.point.x)).toEqual([3])
    expect(fxSince(second.seq).signals).toEqual([])
  })

  it('lets a reader join late without replaying the whole session', () => {
    publishFx(muzzle(1))
    publishFx(muzzle(2))

    // What a component does on mount: take the current sequence and see only what follows.
    const joined = fxSeq()
    expect(fxSince(joined).signals).toEqual([])

    publishFx(muzzle(3))
    expect(fxSince(joined).signals.map((signal) => signal.point.x)).toEqual([3])
  })

  it('drops the oldest rather than growing without bound', () => {
    for (let i = 0; i < 100; i += 1) publishFx(muzzle(i))

    const { signals } = fxSince(0)
    expect(signals.length).toBeLessThanOrEqual(32)
    // The most recent survive; a reader that missed eighty sparks has already missed them.
    expect(signals.at(-1)?.point.x).toBe(99)
  })

  it('clears', () => {
    publishFx(muzzle(1))
    clearFxSignals()
    expect(fxSeq()).toBe(0)
    expect(fxSince(0).signals).toEqual([])
  })
})
