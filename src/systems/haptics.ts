import type { XRControllerState } from '@react-three/xr'

/**
 * Controller haptics.
 *
 * In VR this carries most of the weight that screenshake carries on a flat screen — and
 * unlike screenshake it does not move the camera, so it stays inside the comfort rule.
 * Every impact, cast and parry from Sprint 2.2 onward routes through here.
 */

/**
 * The WebXR flavour of `GamepadHapticActuator`.
 *
 * `pulse()` is the WebXR Gamepads Module method and is what the Quest implements. The DOM
 * lib types `hapticActuators` around the older `playEffect` API, so this is declared
 * locally rather than fought with.
 */
interface XRHapticActuator {
  pulse?: (intensity: number, duration: number) => Promise<boolean>
}

/** Named intensities, so call sites read as intent rather than magic numbers. */
export const Haptic = {
  /** Ray crossing an interactable, item hover. Should be barely noticed. */
  tick: { intensity: 0.15, durationMs: 15 },
  /** Confirming a UI press. */
  click: { intensity: 0.4, durationMs: 25 },
  /** Spell leaving the wand. */
  fire: { intensity: 0.55, durationMs: 45 },
  /** Landing a hit on an enemy. */
  impact: { intensity: 0.8, durationMs: 70 },
  /** Heavy melee connecting, boss slam. */
  heavy: { intensity: 1.0, durationMs: 120 },
} as const

export type HapticPreset = (typeof Haptic)[keyof typeof Haptic]

function actuatorFor(controller: XRControllerState | undefined): XRHapticActuator | undefined {
  const actuators = controller?.inputSource.gamepad?.hapticActuators as
    | ReadonlyArray<XRHapticActuator>
    | undefined
  return actuators?.[0]
}

/**
 * Fire a haptic pulse. No-ops when the controller is absent or has no actuator, so call
 * sites never have to check — desktop and VR share one code path.
 *
 * @param intensity 0..1
 * @param durationMs capped at 500ms; a longer buzz reads as a fault, not feedback
 */
export function pulse(
  controller: XRControllerState | undefined,
  intensity: number,
  durationMs: number,
): void {
  const actuator = actuatorFor(controller)
  if (actuator?.pulse == null) return
  const clampedIntensity = Math.min(1, Math.max(0, intensity))
  const clampedDuration = Math.min(500, Math.max(0, durationMs))
  // Fire and forget — the promise resolves when the pulse *finishes*, which is never
  // something the caller wants to wait on. Swallow rejection so a controller disconnecting
  // mid-pulse can't surface as an unhandled rejection.
  void actuator.pulse(clampedIntensity, clampedDuration)?.catch(() => {})
}

/** `pulse` with a named preset. */
export function pulsePreset(
  controller: XRControllerState | undefined,
  preset: HapticPreset,
): void {
  pulse(controller, preset.intensity, preset.durationMs)
}

/** Whether this controller can produce haptics at all. Useful for settings UI. */
export function supportsHaptics(controller: XRControllerState | undefined): boolean {
  return actuatorFor(controller)?.pulse != null
}
