import type { Object3D } from 'three'

/**
 * Where each controller is *pointing*, as opposed to where it is held.
 *
 * WebXR gives an input source two poses. The **grip** pose sits in the fist and its axes
 * follow the shape of the controller; the **target ray** pose is the one the runtime says
 * the player is aiming with, and on a Quest it is tilted roughly 45° up from the grip so
 * that a naturally held controller points at what the player thinks it points at.
 *
 * `@react-three/xr` only hands us the grip object (it is where the controller *model*
 * hangs), so aiming with it means aiming at the floor. These are objects parented into the
 * target ray space, registered by `GameXRController` while a session is running.
 *
 * Read them, don't keep them: they are replaced whenever a controller reconnects.
 */
export const xrAim: { left: Object3D | null; right: Object3D | null } = {
  left: null,
  right: null,
}

export function setAim(handedness: XRHandedness, object: Object3D | null): void {
  if (handedness !== 'left' && handedness !== 'right') return
  xrAim[handedness] = object
}
