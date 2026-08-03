import { describe, expect, it } from 'vitest'
import {
  assignLightSlots,
  DROP_SECONDS,
  GROWTH_TAU,
  rangeFalloff,
  stepLightSlot,
  type LightSlot,
} from './lightPool'

/**
 * The pop-in bug, as tests.
 *
 * Both of these exist because "lights switch on as you walk towards them" is a report you
 * cannot chase in a headset — you need to know whether the budget handed over abruptly or
 * whether the ramp is simply too short.
 */

describe('rangeFalloff', () => {
  it('is full brightness up close and nothing past the range', () => {
    expect(rangeFalloff(0, 14)).toBe(1)
    expect(rangeFalloff(5, 14)).toBe(1)
    expect(rangeFalloff(14, 14)).toBe(0)
    expect(rangeFalloff(40, 14)).toBe(0)
  })

  it('ramps rather than steps', () => {
    // The actual bug: a light that arrives at full intensity the instant it comes into
    // range reads as a switch being thrown. Every metre of the ramp must be brighter than
    // the last, and the entry must be near zero.
    const samples = [10, 11, 12, 13, 13.5].map((d) => rangeFalloff(d, 14))
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!).toBeLessThan(samples[i - 1]!)
    }
    expect(rangeFalloff(13.9, 14)).toBeLessThan(0.02)
  })

  it('has no crease at either end of the ramp', () => {
    // Smoothstep, not linear: the derivative goes to zero at both ends, so the moment a
    // torch enters range and the moment it reaches full are both invisible.
    const justInside = rangeFalloff(14 * 0.42 + 0.01, 14)
    expect(justInside).toBeGreaterThan(0.999)
  })
})

describe('assignLightSlots', () => {
  const SLOTS = 4
  const HOLD = 7
  const RANGE = 14

  it('fills empty slots with the nearest torches', () => {
    const distances = [3, 20, 5, 9, 40]
    const next = assignLightSlots([null, null, null, null], distances, SLOTS, HOLD, RANGE)
    expect(next).toEqual([0, 2, 3, null])
  })

  it('never lights the same torch twice', () => {
    const next = assignLightSlots([2, 2, null, null], [9, 9, 1, 9], SLOTS, HOLD, RANGE)
    expect(next.filter((v) => v === 2)).toHaveLength(1)
  })

  it('keeps a close torch in its slot when a nearer one appears', () => {
    // The hysteresis that stops a lit torch going dark in the player's face: slot 0 is on a
    // torch 3m away, and torch 3 has just become the nearest. Torch 0 keeps its light.
    const next = assignLightSlots([0, 1, 2, null], [3, 4, 5, 1], SLOTS, HOLD, RANGE)
    expect(next.slice(0, 3)).toEqual([0, 1, 2])
    expect(next[3]).toBe(3)
  })

  it('hands a slot over, under contention, once its torch is out at the edge', () => {
    // Every slot is busy and torch 4 has just come into view. The one that yields is torch 0,
    // the only one already past the hold distance and therefore already fading — so the
    // handover happens between two dim lights, which is what makes it invisible.
    const next = assignLightSlots([0, 1, 2, 3], [12, 3, 3, 3, 1], SLOTS, HOLD, RANGE)
    expect(next.slice(1)).toEqual([1, 2, 3])
    expect(next[0]).toBe(4)
  })

  it('keeps a fading torch when there is a spare slot for the newcomer', () => {
    // No contention, so nothing has to go dark: dropping a torch that is still lighting
    // something, purely because a nearer one appeared, is the pop in the other direction.
    const next = assignLightSlots([0, null, null, null], [12, 30, 30, 2], SLOTS, HOLD, RANGE)
    expect(next).toContain(0)
    expect(next).toContain(3)
  })

  it('drops a torch that has left the range entirely', () => {
    const next = assignLightSlots([0, null, null, null], [40, 30, 30, 30], SLOTS, HOLD, RANGE)
    expect(next).toEqual([null, null, null, null])
  })

  it('does not reshuffle stable assignments between frames', () => {
    // Two torches at nearly equal distance used to trade slots as the player turned, which
    // teleports two lights every time the sort order flips.
    const first = assignLightSlots(
      [null, null, null, null],
      [5, 5.01, 30, 30],
      SLOTS,
      HOLD,
      RANGE,
    )
    const second = assignLightSlots(first, [5.01, 5, 30, 30], SLOTS, HOLD, RANGE)
    expect(second).toEqual(first)
  })

  it('keeps working when there are fewer torches than slots', () => {
    expect(assignLightSlots([null, null, null, null], [2], SLOTS, HOLD, RANGE)).toEqual([
      0,
      null,
      null,
      null,
    ])
  })
})

describe('stepLightSlot', () => {
  const DT = 1 / 60
  const DROP_RATE = 24 / DROP_SECONDS

  it('eases towards its target rather than jumping to it', () => {
    // The bug, stated directly: a slot that has just been given a torch three metres away
    // must not be at full brightness on the next frame.
    let slot: LightSlot = { torch: 3, intensity: 0 }
    slot = stepLightSlot(slot, 3, 24, DT, DROP_RATE)
    expect(slot.intensity).toBeGreaterThan(0)
    expect(slot.intensity).toBeLessThan(3)
  })

  it('front-loads the move and decelerates into the target — an ember catching, not a bulb', () => {
    // The actual fix, as a test: the old ramp moved at constant speed, which has a hard onset.
    // An exponential ease covers most of the ground in its first stretch and then slows, so
    // the per-frame *step* shrinks every frame rather than staying constant until it stops.
    let slot: LightSlot = { torch: 3, intensity: 0 }
    let previousStep = Infinity
    for (let i = 0; i < 30; i++) {
      const before = slot.intensity
      slot = stepLightSlot(slot, 3, 24, DT, DROP_RATE)
      const step = slot.intensity - before
      if (i > 0) expect(step).toBeLessThan(previousStep)
      previousStep = step
    }
  })

  it('gets almost all the way there after a few time constants', () => {
    let slot: LightSlot = { torch: 3, intensity: 0 }
    for (let t = 0; t < GROWTH_TAU * 5; t += DT)
      slot = stepLightSlot(slot, 3, 24, DT, DROP_RATE)
    expect(slot.intensity).toBeCloseTo(24, 0)
  })

  it('goes dark before it moves to a different torch', () => {
    // A light that changes torch while still lit teleports across the room in front of the
    // player. It has to be dark at the moment it moves, which means the slot keeps the old
    // torch until the ramp down finishes.
    let slot: LightSlot = { torch: 0, intensity: 24 }
    const seen: number[] = []
    for (let i = 0; i < 40; i++) {
      slot = stepLightSlot(slot, 7, 24, DT, DROP_RATE)
      if (slot.torch === 7) break
      seen.push(slot.intensity)
      expect(slot.torch).toBe(0)
    }
    expect(slot.torch).toBe(7)
    expect(slot.intensity).toBe(0)
    expect(Math.min(...seen)).toBeLessThan(24)
  })

  it('never drops faster than the drop rate allows', () => {
    // The drop phase is linear and only ever seen heading to zero, so it just needs a hard
    // cap — no input can produce a visible step on the way out.
    let slot: LightSlot = { torch: 0, intensity: 24 }
    for (let i = 0; i < 30; i++) {
      const before = slot.intensity
      slot = stepLightSlot(slot, 9, 24, DT, DROP_RATE)
      expect(before - slot.intensity).toBeLessThanOrEqual(DROP_RATE * DT + 1e-9)
    }
  })

  it('holds still once it has arrived', () => {
    const settled: LightSlot = { torch: 1, intensity: 24 }
    expect(stepLightSlot(settled, 1, 24, DT, DROP_RATE)).toEqual(settled)
  })

  it('eases out in place when nothing wants the slot, rather than dropping fast', () => {
    // The actual reported bug: a torch losing budget contention with no competitor waiting
    // has no reason to hurry. It should keep its own torch (and so its position) and decay at
    // the slow pace, not snap through the fast handover drop while still clearly lit.
    let slot: LightSlot = { torch: 2, intensity: 20 }
    slot = stepLightSlot(slot, null, 0, DT, DROP_RATE)
    expect(slot.torch).toBe(2)
    expect(slot.intensity).toBeGreaterThan(19)
  })

  it('settles to null once a wantless slot has actually faded out', () => {
    let slot: LightSlot = { torch: 2, intensity: 20 }
    for (let i = 0; i < 600 && slot.torch != null; i++)
      slot = stepLightSlot(slot, null, 0, DT, DROP_RATE)
    expect(slot).toEqual({ torch: null, intensity: 0 })
  })

  it('picks the same torch back up without resetting if it reappears before settling', () => {
    // The player just oscillated near the edge of the torch's range. The slot never actually
    // went anywhere, so re-wanting the same torch should continue the existing curve, not
    // restart a fresh handover.
    let slot: LightSlot = { torch: 2, intensity: 20 }
    slot = stepLightSlot(slot, null, 0, DT, DROP_RATE)
    const beforeReturn = slot.intensity
    slot = stepLightSlot(slot, 2, 24, DT, DROP_RATE)
    expect(slot.torch).toBe(2)
    expect(slot.intensity).toBeGreaterThan(beforeReturn)
  })

  it('never overshoots the target while growing or gently dimming', () => {
    // Exponential easing can only ever close a fraction of the remaining gap, so it can
    // approach 24 from below or drift down towards a lower target as the player moves away —
    // but it can never cross the target and come out the other side.
    let slot: LightSlot = { torch: 1, intensity: 0 }
    for (const target of [24, 24, 10, 10, 18]) {
      for (let i = 0; i < 20; i++) {
        const before = slot.intensity
        slot = stepLightSlot(slot, 1, target, DT, DROP_RATE)
        if (before < target) expect(slot.intensity).toBeLessThanOrEqual(target)
        else expect(slot.intensity).toBeGreaterThanOrEqual(target)
      }
    }
  })
})
