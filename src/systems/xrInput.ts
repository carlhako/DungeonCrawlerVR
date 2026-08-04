/**
 * Controller input, sampled once per fixed step into a plain mutable snapshot.
 *
 * Gameplay reads `xrInput.right.trigger.justPressed`, not a React hook. That is the whole
 * point: firing a weapon sixty times a second must not re-render the scene graph, and the
 * systems that consume input (Sprint 2.2 onward) run inside the fixed loop where hooks
 * aren't available anyway.
 *
 * Edge flags (`justPressed` / `justReleased`) are true for exactly one fixed step. Systems
 * registered after `SystemOrder.Input` all see the same edge within a step, which is what
 * makes "fire on trigger press" behave identically at 72, 90 and 120fps.
 */

export interface ButtonState {
  /** Analog value 0..1. Digital buttons report 0 or 1. */
  value: number
  pressed: boolean
  touched: boolean
  /** True for exactly one fixed step, on the step the button went down. */
  justPressed: boolean
  /** True for exactly one fixed step, on the step the button came up. */
  justReleased: boolean
}

export interface StickState extends ButtonState {
  /** -1 (left) .. 1 (right). Raw — deadzone is the consumer's business. */
  x: number
  /** -1 (up/forward) .. 1 (down/back), following the WebXR axis convention. */
  y: number
}

export interface HandInput {
  /** False when the controller is off, asleep, or has never been seen. */
  connected: boolean
  trigger: ButtonState
  /** The side grip button. */
  grip: ButtonState
  /** A on the right hand, X on the left. */
  primary: ButtonState
  /** B on the right hand, Y on the left. */
  secondary: ButtonState
  thumbstick: StickState
  thumbrest: ButtonState
}

export interface XRInputSnapshot {
  left: HandInput
  right: HandInput
}

function createButton(): ButtonState {
  return { value: 0, pressed: false, touched: false, justPressed: false, justReleased: false }
}

function createStick(): StickState {
  return { ...createButton(), x: 0, y: 0 }
}

function createHand(): HandInput {
  return {
    connected: false,
    trigger: createButton(),
    grip: createButton(),
    primary: createButton(),
    secondary: createButton(),
    thumbstick: createStick(),
    thumbrest: createButton(),
  }
}

/**
 * The live snapshot. A module singleton with a stable identity — never reassigned, only
 * mutated in place, so a system can hold a reference to `xrInput.right` forever.
 */
export const xrInput: XRInputSnapshot = {
  left: createHand(),
  right: createHand(),
}

/** The shape `@react-three/xr` reports per gamepad component. */
export interface GamepadComponentReading {
  state: 'default' | 'touched' | 'pressed'
  button?: number | undefined
  xAxis?: number | undefined
  yAxis?: number | undefined
}

/**
 * Fold one frame's reading into a button, computing the edges.
 *
 * Pure and exported so the edge behaviour is unit-testable without a headset — which is
 * most of what can be verified about VR input off-device.
 */
export function applyButtonReading(
  target: ButtonState,
  reading: GamepadComponentReading | undefined,
): void {
  const wasPressed = target.pressed
  const pressed = reading?.state === 'pressed'

  target.pressed = pressed
  target.touched = pressed || reading?.state === 'touched'
  // Analog value where the hardware reports one (trigger, grip), otherwise derived from the
  // press so digital buttons still read 0/1 rather than undefined.
  target.value = typeof reading?.button === 'number' ? reading.button : pressed ? 1 : 0
  target.justPressed = pressed && !wasPressed
  target.justReleased = !pressed && wasPressed
}

/** As `applyButtonReading`, plus the two stick axes. */
export function applyStickReading(
  target: StickState,
  reading: GamepadComponentReading | undefined,
): void {
  applyButtonReading(target, reading)
  target.x = reading?.xAxis ?? 0
  target.y = reading?.yAxis ?? 0
}

/**
 * Zero a hand and fire any releases the disconnect implies.
 *
 * Without this, putting a controller down mid-trigger-pull leaves `pressed` stuck true
 * forever and the weapon keeps firing at nothing.
 */
export function clearHand(hand: HandInput): void {
  hand.connected = false
  for (const button of [
    hand.trigger,
    hand.grip,
    hand.primary,
    hand.secondary,
    hand.thumbstick,
    hand.thumbrest,
  ]) {
    applyButtonReading(button, undefined)
  }
  hand.thumbstick.x = 0
  hand.thumbstick.y = 0
}

/** Gamepad component ids differ by hand for the face buttons only. */
export const COMPONENT_IDS = {
  left: { primary: 'x-button', secondary: 'y-button' },
  right: { primary: 'a-button', secondary: 'b-button' },
} as const

/** Reset every edge flag. Called when a session ends, so stale edges don't leak into the next. */
export function resetXRInput(): void {
  clearHand(xrInput.left)
  clearHand(xrInput.right)
}

/**
 * Either face button, on either hand — A/X or B/Y. Held, not tapped: the HUD popup this
 * gates is meant to disappear the instant the button is let go, same as glancing at a real
 * wrist display.
 */
export function sideButtonHeld(): boolean {
  return (
    xrInput.left.primary.pressed ||
    xrInput.left.secondary.pressed ||
    xrInput.right.primary.pressed ||
    xrInput.right.secondary.pressed
  )
}

/**
 * Apply a full set of gamepad readings to one hand.
 *
 * `read(id)` looks up a component by its `xr-standard-*` id; this stays generic over the
 * lookup so the tests can drive it from a plain object.
 */
export function applyHandReadings(
  hand: HandInput,
  handedness: 'left' | 'right',
  read: (id: string) => GamepadComponentReading | undefined,
): void {
  const ids = COMPONENT_IDS[handedness]
  hand.connected = true
  applyButtonReading(hand.trigger, read('xr-standard-trigger'))
  applyButtonReading(hand.grip, read('xr-standard-squeeze'))
  applyButtonReading(hand.primary, read(ids.primary))
  applyButtonReading(hand.secondary, read(ids.secondary))
  applyButtonReading(hand.thumbrest, read('thumbrest'))
  applyStickReading(hand.thumbstick, read('xr-standard-thumbstick'))
}
