import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { useXR, useXRInputSourceState, type XRControllerState } from '@react-three/xr'
import { SystemOrder } from '@/core/loop'
import { useFixedUpdate } from '@/core/simulation'
import { useSettings } from '@/systems/settings'
import {
  applyHandReadings,
  clearHand,
  resetXRInput,
  xrInput,
  type HandInput,
} from '@/systems/xrInput'

/**
 * Pumps the `xrInput` snapshot once per fixed step. Must live inside `<XR>`.
 *
 * Registered at `SystemOrder.Input`, ahead of every gameplay system, so within a single
 * step everything downstream reads the same input — no system sees a trigger press that
 * another one missed.
 */
export function XRInputSampler() {
  const left = useXRInputSourceState('controller', 'left')
  const right = useXRInputSourceState('controller', 'right')

  // Held in a ref rather than passed as a dependency: controllers connect, disconnect and
  // re-identify freely during a session, and re-registering the system on each of those
  // would churn the loop's system list for no benefit.
  const controllers = useRef({ left, right })
  controllers.current = { left, right }

  useFixedUpdate(() => {
    sampleHand(xrInput.left, 'left', controllers.current.left)
    sampleHand(xrInput.right, 'right', controllers.current.right)
  }, SystemOrder.Input)

  // A session ending leaves whatever was held at the moment of exit latched. Clear it, or
  // the next session starts with a phantom trigger held down.
  const session = useXR((state) => state.session)
  useEffect(() => {
    if (session != null) return
    resetXRInput()
  }, [session])

  return null
}

function sampleHand(
  target: HandInput,
  handedness: 'left' | 'right',
  state: XRControllerState | undefined,
): void {
  if (state == null) {
    // Self-clearing: the first call after a disconnect fires the pending `justReleased`,
    // every call after that is a no-op.
    clearHand(target)
    return
  }
  applyHandReadings(target, handedness, (id) => state.gamepad[id])
}

/**
 * Applies the render settings that can be changed without restarting the session.
 *
 * Foveation is live. Framebuffer scale is not — it sizes the swapchain, which WebXR
 * allocates once when the session starts, so a change there only lands on the next entry
 * into VR. The settings UI says so rather than silently doing nothing.
 */
export function XRRenderSettings() {
  const gl = useThree((state) => state.gl)
  const foveation = useSettings((state) => state.foveation)

  useEffect(() => {
    gl.xr.setFoveation(foveation)
  }, [gl, foveation])

  return null
}
