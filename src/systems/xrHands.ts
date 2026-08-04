import type { Object3D } from 'three'

/**
 * Where each controller is *held*, as opposed to where it is pointing.
 *
 * WebXR gives an input source two poses. The **grip** pose sits in the fist and is what
 * `xrAim` does *not* publish — the target-ray pose is tilted ~45° up from it on a Quest so
 * a naturally held controller points at what the player thinks it points at. Gorilla-style
 * locomotion cares about the grip pose: the hand is in the controller, so arm-swinging
 * walks the body by where the controller actually is, not where its beam points.
 *
 * Read these inside the fixed loop, same rules as `xrAim`: replaced whenever a controller
 * reconnects, never held past the call site.
 */
export const xrHands: { left: Object3D | null; right: Object3D | null } = {
  left: null,
  right: null,
}

export function setHand(handedness: XRHandedness, object: Object3D | null): void {
  if (handedness !== 'left' && handedness !== 'right') return
  xrHands[handedness] = object
}