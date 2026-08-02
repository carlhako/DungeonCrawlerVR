import type { ButtonState } from '@/systems/xrInput'
import { applyButtonReading } from '@/systems/xrInput'
import type { Vec2 } from '@/systems/locomotion'

/**
 * Keyboard and mouse, sampled once per fixed step into a plain mutable snapshot.
 *
 * Same shape and the same rules as `xrInput`: a module singleton, edge flags that last
 * exactly one step, no React. Deliberately so — the player controller reads one interface
 * and doesn't care which device produced the numbers, which is what keeps desktop and VR
 * from drifting into two different movement implementations.
 *
 * The stick convention is copied wholesale from WebXR (`+y` is *back*), even though a
 * keyboard has no stick, so a keyboard reading drops straight into `moveDirection`
 * alongside a thumbstick one.
 */

export interface DesktopInputSnapshot {
  /** -1..1, WebXR stick convention: y is negative when moving forward. */
  move: Vec2
  jump: ButtonState
  sprint: boolean
  /** Radians. Accumulated from the mouse while the pointer is locked. */
  yaw: number
  /** Radians, clamped just short of straight up and straight down. */
  pitch: number
  /** False until the player clicks the canvas; without it, mouselook does nothing. */
  pointerLocked: boolean
}

export const desktopInput: DesktopInputSnapshot = {
  move: { x: 0, y: 0 },
  jump: { value: 0, pressed: false, touched: false, justPressed: false, justReleased: false },
  sprint: false,
  yaw: 0,
  pitch: 0,
  pointerLocked: false,
}

/** Multiplier on `moveSpeed` while sprint is held. */
export const SPRINT_MULTIPLIER = 1.7

/**
 * Looking within a hair of straight up or down, but never past it.
 *
 * Letting pitch reach exactly ±90° makes the yaw axis degenerate and the view rolls; going
 * past it flips the world upside down. Standard for a first-person camera.
 */
export const MAX_PITCH = Math.PI / 2 - 0.01

export const MOUSE_SENSITIVITY = 0.0022

/** Both WASD and the arrow keys, so the layout isn't a barrier to trying the thing. */
export const MOVE_KEYS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
} as const

export const JUMP_KEYS = ['Space'] as const
export const SPRINT_KEYS = ['ShiftLeft', 'ShiftRight'] as const

function anyHeld(held: ReadonlySet<string>, codes: readonly string[]): boolean {
  return codes.some((code) => held.has(code))
}

/**
 * Turn a set of held keys into a stick reading.
 *
 * Normalised, so holding W+D is not 41% faster than holding W alone — the diagonal-sprint
 * bug, which every engine ships at least once.
 */
export function keyboardMove(held: ReadonlySet<string>): Vec2 {
  const x =
    (anyHeld(held, MOVE_KEYS.right) ? 1 : 0) - (anyHeld(held, MOVE_KEYS.left) ? 1 : 0)
  // Forward is -y, matching the WebXR thumbstick.
  const y =
    (anyHeld(held, MOVE_KEYS.back) ? 1 : 0) - (anyHeld(held, MOVE_KEYS.forward) ? 1 : 0)

  const magnitude = Math.hypot(x, y)
  if (magnitude === 0) return { x: 0, y: 0 }
  return { x: x / magnitude, y: y / magnitude }
}

/**
 * Union of the keys currently held with the keys tapped since the last sample.
 *
 * Polling "what is held right now" once per fixed step loses anything pressed and released
 * inside that step. At 60Hz that is a 16ms window, and a quick jump tap fits inside it — so
 * the input is simply dropped, intermittently, in a way that feels like the game ignoring
 * you rather than like a bug. Latching the tap guarantees every press is seen for at least
 * one step, and the release edge follows on the next one.
 */
export function mergeTaps(
  held: ReadonlySet<string>,
  tapped: ReadonlySet<string>,
): Set<string> {
  if (tapped.size === 0) return held as Set<string>
  const merged = new Set(held)
  for (const code of tapped) merged.add(code)
  return merged
}

/** Clamp pitch into the range where a first-person camera stays upright. */
export function clampPitch(pitch: number): number {
  return Math.min(MAX_PITCH, Math.max(-MAX_PITCH, pitch))
}

/**
 * Fold accumulated mouse movement into the look angles.
 *
 * Deltas are accumulated by the event handler and drained here, once per fixed step:
 * pointer events fire far more often than 60Hz (and in bursts, with coalescing), so
 * reading "the last event" would throw most of the motion away and feel like a low
 * sample rate.
 */
export function applyMouseLook(
  snapshot: DesktopInputSnapshot,
  deltaX: number,
  deltaY: number,
  sensitivity: number = MOUSE_SENSITIVITY,
): void {
  // Moving the mouse right should turn right, which is a negative yaw in a Y-up
  // right-handed system — the same sign convention the VR turn functions use.
  snapshot.yaw -= deltaX * sensitivity
  snapshot.pitch = clampPitch(snapshot.pitch - deltaY * sensitivity)
}

export interface DesktopSampleInput {
  held: ReadonlySet<string>
  mouseDeltaX: number
  mouseDeltaY: number
  pointerLocked: boolean
}

/**
 * Fold one step's worth of raw device state into the snapshot.
 *
 * Pure apart from mutating the snapshot it is handed, so the tests can drive it with a
 * plain `Set` and no DOM.
 */
export function sampleDesktopInput(
  snapshot: DesktopInputSnapshot,
  input: DesktopSampleInput,
): void {
  snapshot.pointerLocked = input.pointerLocked
  snapshot.move = keyboardMove(input.held)
  snapshot.sprint = anyHeld(input.held, SPRINT_KEYS)

  const jumping = anyHeld(input.held, JUMP_KEYS)
  applyButtonReading(snapshot.jump, { state: jumping ? 'pressed' : 'default' })

  // Look only responds under pointer lock. Otherwise moving the mouse to reach the tuning
  // panel would spin the player around.
  if (input.pointerLocked) {
    applyMouseLook(snapshot, input.mouseDeltaX, input.mouseDeltaY)
  }
}

/**
 * Drop everything held, preserving the look angles.
 *
 * Called when the window loses focus: `keyup` never arrives for a key that was down when
 * the tab went away, so without this, alt-tabbing mid-stride leaves the player walking
 * into a wall forever. The view angles survive because losing focus shouldn't spin you
 * around when you come back.
 */
export function releaseDesktopInput(snapshot: DesktopInputSnapshot): void {
  snapshot.move = { x: 0, y: 0 }
  snapshot.sprint = false
  applyButtonReading(snapshot.jump, undefined)
}
