import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  RAY_RANGE,
  activateFocus,
  chooseFocus,
  interactables,
  interactionState,
  pickByProximity,
  pickByRay,
  pickByReach,
  registerInteractable,
  resetInteractions,
  setFocus,
  type Interactable,
} from './interaction'

/**
 * Picking the wrong target is the failure mode of an interaction system, and in a headset it
 * presents as "the door doesn't work" with nothing to go on. Three spheres and a ray
 * reproduce it in a millisecond.
 */

function make(id: string, position: [number, number, number], overrides: Partial<Interactable> = {}) {
  const item: Interactable = {
    id,
    position: { x: position[0], y: position[1], z: position[2] },
    radius: 0.2,
    label: `Use ${id}`,
    enabled: true,
    onActivate: vi.fn(),
    ...overrides,
  }
  return item
}

const FORWARD = { x: 0, y: 0, z: -1 }

beforeEach(() => {
  resetInteractions()
})

describe('pickByRay', () => {
  it('hits a target the ray passes through', () => {
    const door = make('door', [0, 1, -2])
    const pick = pickByRay([door], { x: 0, y: 1, z: 0 }, FORWARD)
    expect(pick?.item).toBe(door)
    expect(pick?.distance).toBeCloseTo(2)
  })

  it('misses a target the ray passes beside', () => {
    // 0.5m off-axis, radius 0.2 — a clear miss, not a near thing.
    const door = make('door', [0.5, 1, -2])
    expect(pickByRay([door], { x: 0, y: 1, z: 0 }, FORWARD)).toBeNull()
  })

  it('forgives a wobble inside the target radius', () => {
    // The case the sphere test exists for: a controller ray at arm's length is nowhere near
    // as steady as a mouse cursor.
    const handle = make('handle', [0.15, 1, -2], { radius: 0.25 })
    expect(pickByRay([handle], { x: 0, y: 1, z: 0 }, FORWARD)?.item).toBe(handle)
  })

  it('ignores anything behind the player', () => {
    const behind = make('behind', [0, 1, 2])
    expect(pickByRay([behind], { x: 0, y: 1, z: 0 }, FORWARD)).toBeNull()
  })

  it('ignores anything past the range', () => {
    const far = make('far', [0, 1, -(RAY_RANGE + 1)])
    expect(pickByRay([far], { x: 0, y: 1, z: 0 }, FORWARD)).toBeNull()
  })

  it('returns the nearest of several on the same line', () => {
    const near = make('near', [0, 1, -1])
    const far = make('far', [0, 1, -3])
    expect(pickByRay([far, near], { x: 0, y: 1, z: 0 }, FORWARD)?.item).toBe(near)
  })

  it('skips disabled targets', () => {
    const locked = make('locked', [0, 1, -2], { enabled: false })
    expect(pickByRay([locked], { x: 0, y: 1, z: 0 }, FORWARD)).toBeNull()
  })
})

describe('pickByReach', () => {
  it('finds a target the hand is touching', () => {
    const handle = make('handle', [0, 1.1, -1], { radius: 0.2 })
    expect(pickByReach([handle], { x: 0, y: 1.1, z: -0.85 })?.item).toBe(handle)
  })

  it('does not reach across the room', () => {
    const handle = make('handle', [0, 1.1, -1])
    expect(pickByReach([handle], { x: 0, y: 1.1, z: 0 })).toBeNull()
  })

  it('returns the nearer of two overlapping targets', () => {
    const a = make('a', [0, 1, 0], { radius: 0.3 })
    const b = make('b', [0.2, 1, 0], { radius: 0.3 })
    expect(pickByReach([a, b], { x: 0.19, y: 1, z: 0 })?.item).toBe(b)
  })

  it('skips disabled targets', () => {
    const handle = make('handle', [0, 1, 0], { enabled: false })
    expect(pickByReach([handle], { x: 0, y: 1, z: 0 })).toBeNull()
  })
})

describe('pickByProximity', () => {
  const eye = { x: 0, y: 1.6, z: 0 }

  it('offers a handle the player is stood in front of but not looking at', () => {
    // The bug it exists for: an eye at 1.6m pointing dead level passes 0.55m over a handle
    // at 1.05m, at every distance. Without proximity the door is simply never offered.
    const handle = make('handle', [0.4, 1.05, -1])
    expect(pickByProximity([handle], eye, FORWARD)?.item).toBe(handle)
  })

  it('does not offer something behind the player', () => {
    const handle = make('handle', [0, 1.05, 1])
    expect(pickByProximity([handle], eye, FORWARD)).toBeNull()
  })

  it('does not offer something across the room', () => {
    const handle = make('handle', [0, 1.05, -4])
    expect(pickByProximity([handle], eye, FORWARD)).toBeNull()
  })

  it('picks the nearer of two things in front', () => {
    const near = make('near', [0.2, 1.2, -0.6])
    const far = make('far', [0, 1.2, -1.6])
    expect(pickByProximity([near, far], eye, FORWARD)?.item).toBe(near)
  })

  it('skips disabled targets', () => {
    const handle = make('handle', [0, 1.05, -1], { enabled: false })
    expect(pickByProximity([handle], eye, FORWARD)).toBeNull()
  })

  it('skips targets that opted out of proximity', () => {
    // Shop buttons. Standing near a panel of eight of them says nothing about which one you
    // meant, so they are aimed at instead — while a *hand* on one still counts, which is why
    // this only turns off proximity and not reach.
    const button = make('shop-button', [0.1, 1.5, -0.5], { proximity: false })
    expect(pickByProximity([button], eye, FORWARD)).toBeNull()
    expect(pickByReach([button], { x: 0.1, y: 1.5, z: -0.5 })?.item).toBe(button)
  })
})

describe('chooseFocus', () => {
  it('prefers what the hand is touching over what the ray crosses', () => {
    // Reaching for a handle while the controller happens to point at something across the
    // room must not address the far thing.
    const held = { item: make('handle', [0, 1, 0]), distance: 0.1 }
    const pointed = { item: make('lever', [0, 1, -3]), distance: 3 }
    expect(chooseFocus(held, pointed).source).toBe('reach')
    expect(chooseFocus(held, pointed).pick).toBe(held)
  })

  it('falls back to the ray', () => {
    const pointed = { item: make('lever', [0, 1, -3]), distance: 3 }
    expect(chooseFocus(null, pointed).source).toBe('ray')
  })

  it('prefers where the player is aiming over what they are stood next to', () => {
    // The bug this fixes: walking up to the shop counter offered the bell — the nearest
    // thing to the player's body — no matter which button they were staring at.
    const aimed = { item: make('shop-button', [0, 1.5, -1]), distance: 1 }
    const beside = { item: make('bell', [0.9, 1, 0]), distance: 0.9 }
    expect(chooseFocus(null, aimed, beside).pick).toBe(aimed)
  })

  it('still falls back to proximity when the ray hits nothing', () => {
    // Which is the whole reason proximity exists: a level look-ray sails over a door handle.
    const beside = { item: make('handle', [0, 1.05, -1]), distance: 1 }
    expect(chooseFocus(null, null, beside)).toEqual({ pick: beside, source: 'reach' })
  })

  it('reports nothing when nothing hits', () => {
    expect(chooseFocus(null, null, null)).toEqual({ pick: null, source: 'none' })
  })
})

describe('the registry', () => {
  it('registers and unregisters', () => {
    const item = make('door', [0, 1, -2])
    const remove = registerInteractable(item)
    expect(interactables).toContain(item)
    remove()
    expect(interactables).not.toContain(item)
  })

  it('drops the focus when the focused thing unmounts', () => {
    // Otherwise the prompt outlives the object it describes, and pressing the key calls into
    // a scene that is no longer there. Scene changes make this routine, not exotic.
    const item = make('door', [0, 1, -2])
    const remove = registerInteractable(item)
    setFocus({ item, distance: 1 }, 'ray')
    expect(interactionState.focus).toBe(item)

    remove()
    expect(interactionState.focus).toBeNull()
    expect(interactionState.source).toBe('none')
  })
})

describe('activateFocus', () => {
  it('calls the focused interactable and reports the key as spent', () => {
    const item = make('door', [0, 1, -2])
    setFocus({ item, distance: 1 }, 'ray')

    expect(activateFocus()).toBe(true)
    expect(item.onActivate).toHaveBeenCalledOnce()
    expect(interactionState.consumedActivate).toBe(true)
  })

  it('does nothing with no focus, so the key stays free to jump', () => {
    expect(activateFocus()).toBe(false)
    expect(interactionState.consumedActivate).toBe(false)
  })

  it('does nothing for a disabled interactable', () => {
    const item = make('door', [0, 1, -2], { enabled: false })
    setFocus({ item, distance: 1 }, 'ray')

    expect(activateFocus()).toBe(false)
    expect(item.onActivate).not.toHaveBeenCalled()
  })
})
