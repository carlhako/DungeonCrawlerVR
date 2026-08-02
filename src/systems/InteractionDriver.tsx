import { useEffect, useMemo, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { useXR, useXRInputSourceState } from '@react-three/xr'
import type { XRControllerState } from '@react-three/xr'
import { Quaternion, Vector3 } from 'three'
import { SystemOrder } from '@/core/loop'
import { useFixedUpdate } from '@/core/simulation'
import { desktopInput } from '@/systems/desktopInput'
import {
  activateFocus,
  chooseFocus,
  clearFocus,
  interactables,
  interactionState,
  pickByProximity,
  pickByRay,
  pickByReach,
  setFocus,
  type Pick,
} from '@/systems/interaction'
import { Haptic, pulsePreset } from '@/systems/haptics'
import { xrInput } from '@/systems/xrInput'
import { xrAim } from '@/systems/xrAim'

/**
 * Drives the interaction focus once per fixed step, and turns a button press into an
 * activation.
 *
 * Runs *before* the player controller so that `Space` can be spent on a door before it is
 * considered as a jump. That ordering is the whole mechanism behind the contextual key —
 * see `interactionState.consumedActivate`.
 *
 * Both hands are tested for reach, because reaching for a handle with your off hand is a
 * completely normal thing to do and having it silently not work is maddening.
 */
/**
 * Metres from the controller's reported pose to the point that acts as the player's
 * fingertip, along the controller's forward axis.
 */
const CONTROLLER_TIP_OFFSET = 0.055

export function InteractionDriver() {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const inSession = useXR((state) => state.session != null)
  const right = useXRInputSourceState('controller', 'right')
  const left = useXRInputSourceState('controller', 'left')

  // Refs, not dependencies: controllers reconnect freely mid-session and the fixed-loop
  // system must not be torn down and re-registered when one does.
  const latest = useRef({ camera, inSession, right, left })
  latest.current = { camera, inSession, right, left }

  const scratch = useMemo(
    () => ({
      origin: new Vector3(),
      direction: new Vector3(),
      rotation: new Quaternion(),
      hand: new Vector3(),
      /** Which hand produced the current focus, so the right controller buzzes. */
      focusHand: null as XRControllerState | null,
      lastFocusId: null as string | null,
    }),
    [],
  )
  const rayHand = useRef<XRControllerState | null>(null)

  useFixedUpdate(
    () => {
      interactionState.consumedActivate = false

      const { inSession: inVR, right: rightPad, left: leftPad } = latest.current

      let reach: Pick | null = null
      let ray: Pick | null = null
      let proximity: Pick | null = null
      let reachHand: XRControllerState | null = null

      rayHand.current = null

      if (inVR) {
        for (const [handedness, pad] of [
          ['right', rightPad],
          ['left', leftPad],
        ] as const) {
          const grip = pad?.object

          // Near-grab from either hand, at the tip rather than at the grip. The controller's
          // reported pose sits in the palm, several centimetres behind where the player feels
          // their hand end, so touching a board with the grip origin means pushing your hand
          // into it up to the knuckles.
          if (grip) {
            grip.getWorldPosition(scratch.origin)
            grip.getWorldQuaternion(scratch.rotation)
            scratch.direction.set(0, 0, -1).applyQuaternion(scratch.rotation)
            scratch.hand
              .copy(scratch.origin)
              .addScaledVector(scratch.direction, CONTROLLER_TIP_OFFSET)
            const touched = pickByReach(interactables, scratch.hand)
            if (touched && (!reach || touched.distance < reach.distance)) {
              reach = touched
              reachHand = pad ?? null
            }
          }

          // Pointing uses the *target ray* pose, not the grip: the grip's axes follow the
          // shape of the controller and its -Z runs down towards the floor, so aiming with
          // it means tipping your wrist at the ground. Both hands, because which one a
          // player points with is a matter of handedness, not of what the game supports.
          const aim = xrAim[handedness]
          if (aim) {
            aim.getWorldPosition(scratch.origin)
            aim.getWorldQuaternion(scratch.rotation)
            scratch.direction.set(0, 0, -1).applyQuaternion(scratch.rotation)
            const aimed = pickByRay(interactables, scratch.origin, scratch.direction)
            if (aimed && (!ray || aimed.distance < ray.distance)) {
              ray = aimed
              rayHand.current = pad ?? null
            }
          }
        }
      } else {
        // Desktop looks with the camera. In XR the camera belongs to the headset, so this
        // branch is only ever the flat-screen one.
        const head = gl.xr.isPresenting ? null : latest.current.camera
        if (head) {
          head.getWorldPosition(scratch.origin)
          head.getWorldDirection(scratch.direction)
          ray = pickByRay(interactables, scratch.origin, scratch.direction)
          // Standing close to something counts as addressing it, the same way reaching for
          // it does in VR — see `pickByProximity` for why desktop needs this and VR doesn't.
          // Ranked *below* the ray: where the player is looking is a better statement of
          // intent than where their feet are.
          proximity = pickByProximity(interactables, scratch.origin, scratch.direction)
        }
      }

      const { pick, source } = chooseFocus(reach, ray, proximity)
      scratch.focusHand =
        source === 'reach' ? reachHand : (rayHand.current ?? rightPad ?? null)
      const handedness = !inVR
        ? null
        : scratch.focusHand === leftPad
          ? 'left'
          : scratch.focusHand === rightPad
            ? 'right'
            : null
      setFocus(pick, source, handedness)

      // A tick on the step the focus changes. In VR this is most of what tells you the game
      // has noticed you are pointing at something, without lighting up half the room.
      const focusId = pick?.item.id ?? null
      if (inVR && focusId !== null && focusId !== scratch.lastFocusId) {
        pulsePreset(scratch.focusHand ?? undefined, Haptic.tick)
      }
      scratch.lastFocusId = focusId

      if (!pick) return

      const pressed = inVR
        ? // Trigger to activate at range, and either trigger or grip when your hand is
          // already on the thing — a grab is a grab, whichever finger you use for it.
          // Either way it is the hand that found the focus that has to press, so pointing
          // with one hand is not confirmed by a trigger pull on the other.
          handPressed(scratch.focusHand, rightPad, leftPad, source === 'reach')
        : desktopInput.jump.justPressed

      if (pressed && activateFocus() && inVR) {
        pulsePreset(scratch.focusHand ?? undefined, Haptic.click)
      }
    },
    // Ahead of the player controller: the door gets first refusal on Space.
    SystemOrder.Player - 2,
    [],
  )

  // Leave nothing focused behind us. A stale focus would keep the prompt on screen with no
  // system left running to take it down.
  useEffect(() => clearFocus, [])

  return null
}

/** Was the activation button just pressed on the hand that holds the focus? */
function handPressed(
  hand: XRControllerState | null,
  right: XRControllerState | undefined,
  left: XRControllerState | undefined,
  includeGrip: boolean,
): boolean {
  const input = hand && hand === left ? xrInput.left : hand === right ? xrInput.right : null
  if (!input) return false
  return input.trigger.justPressed || (includeGrip && input.grip.justPressed)
}
