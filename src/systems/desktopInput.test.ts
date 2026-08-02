import { describe, expect, it } from 'vitest'
import {
  MAX_PITCH,
  applyMouseLook,
  clampPitch,
  desktopInput,
  keyboardMove,
  mergeTaps,
  releaseDesktopInput,
  sampleDesktopInput,
  type DesktopInputSnapshot,
} from './desktopInput'

function snapshot(): DesktopInputSnapshot {
  return {
    move: { x: 0, y: 0 },
    jump: { value: 0, pressed: false, touched: false, justPressed: false, justReleased: false },
    sprint: false,
    yaw: 0,
    pitch: 0,
    pointerLocked: false,
  }
}

describe('keyboardMove', () => {
  it('maps W to forward, which is -y in the stick convention', () => {
    expect(keyboardMove(new Set(['KeyW']))).toEqual({ x: 0, y: -1 })
  })

  it('maps D to +x', () => {
    expect(keyboardMove(new Set(['KeyD']))).toEqual({ x: 1, y: 0 })
  })

  it('accepts the arrow keys as well as WASD', () => {
    expect(keyboardMove(new Set(['ArrowUp']))).toEqual(keyboardMove(new Set(['KeyW'])))
    expect(keyboardMove(new Set(['ArrowLeft']))).toEqual(keyboardMove(new Set(['KeyA'])))
  })

  it('normalises the diagonal so W+D is not faster than W', () => {
    const diagonal = keyboardMove(new Set(['KeyW', 'KeyD']))
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1, 6)
  })

  it('cancels opposing keys', () => {
    expect(keyboardMove(new Set(['KeyW', 'KeyS']))).toEqual({ x: 0, y: 0 })
    expect(keyboardMove(new Set(['KeyA', 'KeyD', 'KeyW', 'KeyS']))).toEqual({ x: 0, y: 0 })
  })

  it('is zero with nothing held', () => {
    expect(keyboardMove(new Set())).toEqual({ x: 0, y: 0 })
  })
})

describe('mergeTaps', () => {
  it('keeps a key that was pressed and released inside one step', () => {
    // The dropped-jump bug: polling "what is held right now" once per fixed step misses
    // anything that came and went inside that 16ms window.
    const merged = mergeTaps(new Set(), new Set(['Space']))
    expect(merged.has('Space')).toBe(true)
  })

  it('combines held and tapped without losing either', () => {
    const merged = mergeTaps(new Set(['KeyW']), new Set(['Space']))
    expect([...merged].sort()).toEqual(['KeyW', 'Space'])
  })

  it('leaves the held set untouched', () => {
    const held = new Set(['KeyW'])
    mergeTaps(held, new Set(['Space']))
    expect([...held]).toEqual(['KeyW'])
  })

  it('passes the held set straight through when nothing was tapped', () => {
    const held = new Set(['KeyW'])
    expect(mergeTaps(held, new Set())).toBe(held)
  })
})

describe('clampPitch', () => {
  it('never reaches straight up or straight down', () => {
    expect(clampPitch(10)).toBe(MAX_PITCH)
    expect(clampPitch(-10)).toBe(-MAX_PITCH)
    expect(Math.abs(clampPitch(10))).toBeLessThan(Math.PI / 2)
  })

  it('leaves ordinary angles alone', () => {
    expect(clampPitch(0.4)).toBe(0.4)
  })
})

describe('applyMouseLook', () => {
  it('turns right when the mouse moves right', () => {
    const state = snapshot()
    applyMouseLook(state, 100, 0)
    // Negative yaw is a right turn, matching the VR turn functions.
    expect(state.yaw).toBeLessThan(0)
  })

  it('looks up when the mouse moves up', () => {
    const state = snapshot()
    applyMouseLook(state, 0, -100)
    expect(state.pitch).toBeGreaterThan(0)
  })

  it('clamps pitch even under a long drag', () => {
    const state = snapshot()
    for (let i = 0; i < 500; i++) applyMouseLook(state, 0, -100)
    expect(state.pitch).toBe(MAX_PITCH)
  })

  it('accumulates rather than replacing', () => {
    const state = snapshot()
    applyMouseLook(state, 50, 0)
    const first = state.yaw
    applyMouseLook(state, 50, 0)
    expect(state.yaw).toBeCloseTo(first * 2, 6)
  })
})

describe('sampleDesktopInput', () => {
  const base = { mouseDeltaX: 0, mouseDeltaY: 0, pointerLocked: true }

  it('fires the jump edge for exactly one step', () => {
    const state = snapshot()
    sampleDesktopInput(state, { ...base, held: new Set(['Space']) })
    expect(state.jump.justPressed).toBe(true)
    sampleDesktopInput(state, { ...base, held: new Set(['Space']) })
    expect(state.jump.justPressed).toBe(false)
    expect(state.jump.pressed).toBe(true)
  })

  it('fires the release edge when the key comes up', () => {
    const state = snapshot()
    sampleDesktopInput(state, { ...base, held: new Set(['Space']) })
    sampleDesktopInput(state, { ...base, held: new Set() })
    expect(state.jump.justReleased).toBe(true)
    expect(state.jump.pressed).toBe(false)
  })

  it('reads sprint from either shift key', () => {
    const state = snapshot()
    sampleDesktopInput(state, { ...base, held: new Set(['ShiftRight']) })
    expect(state.sprint).toBe(true)
  })

  it('ignores mouse movement while the pointer is unlocked', () => {
    const state = snapshot()
    // Otherwise reaching for the tuning panel would spin the player around.
    sampleDesktopInput(state, {
      held: new Set(),
      mouseDeltaX: 500,
      mouseDeltaY: 500,
      pointerLocked: false,
    })
    expect(state.yaw).toBe(0)
    expect(state.pitch).toBe(0)
  })

  it('applies mouse movement while locked', () => {
    const state = snapshot()
    sampleDesktopInput(state, { held: new Set(), mouseDeltaX: 500, mouseDeltaY: 0, pointerLocked: true })
    expect(state.yaw).not.toBe(0)
  })
})

describe('releaseDesktopInput', () => {
  it('stops the player when focus is lost mid-stride', () => {
    const state = snapshot()
    sampleDesktopInput(state, {
      held: new Set(['KeyW', 'ShiftLeft', 'Space']),
      mouseDeltaX: 0,
      mouseDeltaY: 0,
      pointerLocked: true,
    })
    // `keyup` never arrives for a key that was down when the tab went away.
    releaseDesktopInput(state)
    expect(state.move).toEqual({ x: 0, y: 0 })
    expect(state.sprint).toBe(false)
    expect(state.jump.pressed).toBe(false)
    expect(state.jump.justReleased).toBe(true)
  })

  it('keeps the view angles, so returning to the tab does not spin the player', () => {
    const state = snapshot()
    applyMouseLook(state, 200, 50)
    const { yaw, pitch } = state
    releaseDesktopInput(state)
    expect(state.yaw).toBe(yaw)
    expect(state.pitch).toBe(pitch)
  })
})

describe('the shared snapshot', () => {
  it('starts neutral', () => {
    expect(desktopInput.move).toEqual({ x: 0, y: 0 })
    expect(desktopInput.pointerLocked).toBe(false)
  })
})
