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

  useFixedUpdate(
    () => {
      interactionState.consumedActivate = false

      const { inSession: inVR, right: rightPad, left: leftPad } = latest.current

      let reach: Pick | null = null
      let ray: Pick | null = null
      let reachHand: XRControllerState | null = null

      if (inVR) {
        // Near-grab from either hand.
        for (const pad of [rightPad, leftPad]) {
          const object = pad?.object
          if (!object) continue
          object.getWorldPosition(scratch.hand)
          const found = pickByReach(interactables, scratch.hand)
          if (found && (!reach || found.distance < reach.distance)) {
            reach = found
            reachHand = pad ?? null
          }
        }

        // Pointing, from the right controller's -Z, the same axis the teleport arc uses.
        const pointer = rightPad?.object
        if (pointer) {
          pointer.getWorldPosition(scratch.origin)
          pointer.getWorldQuaternion(scratch.rotation)
          scratch.direction.set(0, 0, -1).applyQuaternion(scratch.rotation)
          ray = pickByRay(interactables, scratch.origin, scratch.direction)
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
          reach = pickByProximity(interactables, scratch.origin, scratch.direction)
        }
      }

      const { pick, source } = chooseFocus(reach, ray)
      setFocus(pick, source)
      scratch.focusHand = source === 'reach' ? reachHand : (rightPad ?? null)

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
          (source === 'reach'
            ? handPressed(scratch.focusHand, rightPad, leftPad, true)
            : xrInput.right.trigger.justPressed)
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
