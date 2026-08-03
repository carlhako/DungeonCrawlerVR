import { describe, expect, it } from 'vitest'
import {
  ARM_SECONDS,
  DONE_SECONDS,
  IDLE_RESET,
  armSecondsLeft,
  pressReset,
  resetPrompt,
  tickReset,
} from './reset'

/**
 * The one irreversible control in the game. These tests are about what it *refuses* to do
 * on a single press, which is the entire reason it exists in two steps.
 */

describe('pressReset', () => {
  it('arms rather than wiping, on the first press', () => {
    const { next, wipe } = pressReset(IDLE_RESET, 10)
    expect(next).toEqual({ phase: 'armed', since: 10 })
    expect(wipe).toBe(false)
  })

  it('wipes on the confirming press', () => {
    const armed = pressReset(IDLE_RESET, 10).next
    const { next, wipe } = pressReset(armed, 12)
    expect(wipe).toBe(true)
    expect(next).toEqual({ phase: 'done', since: 12 })
  })

  it('does not re-arm on a third press', () => {
    // A confirming press is two presses in quick succession. If the second one both wiped
    // and re-armed, a player double-tapping would walk away from a live control.
    const done = pressReset(pressReset(IDLE_RESET, 10).next, 12).next
    const { next, wipe } = pressReset(done, 12.2)
    expect(wipe).toBe(false)
    expect(next).toBe(done)
  })
})

describe('tickReset', () => {
  it('stands down an armed plaque that was never confirmed', () => {
    const armed = pressReset(IDLE_RESET, 10).next
    expect(tickReset(armed, 10 + ARM_SECONDS - 0.1)).toBe(armed)
    expect(tickReset(armed, 10 + ARM_SECONDS).phase).toBe('idle')
  })

  it('clears the wiped message', () => {
    const done = pressReset(pressReset(IDLE_RESET, 0).next, 1).next
    expect(tickReset(done, 1 + DONE_SECONDS - 0.1)).toBe(done)
    expect(tickReset(done, 1 + DONE_SECONDS).phase).toBe('idle')
  })

  it('leaves an idle plaque alone', () => {
    expect(tickReset(IDLE_RESET, 9999)).toBe(IDLE_RESET)
  })

  it('re-arms cleanly after standing down', () => {
    // The bug this guards: carrying the original `since` through the disarm would leave the
    // next arming already expired, so the plaque could never be confirmed again.
    const armed = pressReset(IDLE_RESET, 10).next
    const stoodDown = tickReset(armed, 10 + ARM_SECONDS)
    const rearmed = pressReset(stoodDown, 30).next
    expect(tickReset(rearmed, 31)).toBe(rearmed)
    expect(pressReset(rearmed, 31).wipe).toBe(true)
  })
})

describe('armSecondsLeft', () => {
  it('counts down whole seconds while armed', () => {
    const armed = pressReset(IDLE_RESET, 100).next
    expect(armSecondsLeft(armed, 100)).toBe(ARM_SECONDS)
    expect(armSecondsLeft(armed, 100.5)).toBe(ARM_SECONDS)
    expect(armSecondsLeft(armed, 100 + ARM_SECONDS - 0.5)).toBe(1)
    expect(armSecondsLeft(armed, 100 + ARM_SECONDS)).toBe(0)
  })

  it('is zero when there is nothing to count', () => {
    expect(armSecondsLeft(IDLE_RESET, 5)).toBe(0)
  })
})

describe('resetPrompt', () => {
  it('says what the next press will do, not what the plaque is', () => {
    // The prompt is read with a controller already pointed at the button. "New game" would
    // be a label; the player needs to know whether pulling the trigger wipes anything.
    expect(resetPrompt(IDLE_RESET)).toBe('Start a new game')
    expect(resetPrompt(pressReset(IDLE_RESET, 0).next)).toContain('wipe')
  })
})
