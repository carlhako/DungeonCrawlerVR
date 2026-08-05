import { Perf } from 'r3f-perf'
import { Leva, useControls } from 'leva'
import { useEffect, useState } from 'react'
import {
  SETTING_LIMITS,
  SETTING_OPTIONS,
  useSettings,
  type LocomotionMode,
  type TurnMode,
} from '@/systems/settings'
import { useFrameHud } from '@/systems/frameStats'

/**
 * Development instrumentation: the frame HUD and the live tuning panel.
 *
 * Both are stripped from production builds via `import.meta.env.DEV`, and both are off by
 * default in a session so they never cost frames while playtesting. F1 toggles the frame
 * HUD, F2 the tuning panel.
 */

export function useDevToggles() {
  const [showPerf, setShowPerf] = useState(false)
  const [showPanel, setShowPanel] = useState(false)
  const [showMap, setShowMap] = useState(false)

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'F1') {
        e.preventDefault()
        setShowPerf((v) => !v)
      }
      if (e.code === 'F2') {
        e.preventDefault()
        setShowPanel((v) => !v)
      }
      if (e.code === 'F3') {
        e.preventDefault()
        setShowMap((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return { showPerf, showPanel, showMap }
}

/** Lives inside <Canvas>. */
export function DevPerf({ visible }: { visible: boolean }) {
  if (!import.meta.env.DEV || !visible) return null
  return <Perf position="top-left" minimal={false} />
}

/** Lives outside <Canvas> — leva renders DOM. */
export function DevPanel({ visible }: { visible: boolean }) {
  if (!import.meta.env.DEV) return null
  return <Leva collapsed={false} hidden={!visible} titleBar={{ title: 'Tuning' }} />
}

/**
 * XR render knobs, wired straight to the persisted settings store.
 *
 * Set these on the desktop before entering VR — leva is DOM, so it is invisible once the
 * headset takes over. They persist, so the value you pick here is the value the Quest
 * session starts with. The real settings screen arrives in Sprint 4.4.
 */
export function XRSettingsControls() {
  const set = useSettings((state) => state.set)
  const foveation = useSettings((state) => state.foveation)
  const framebufferScale = useSettings((state) => state.framebufferScale)

  useControls(
    'XR render',
    () => ({
      foveation: {
        value: foveation,
        ...SETTING_LIMITS.foveation,
        onChange: (value: number) => set('foveation', value),
      },
      // Renamed in the panel to say out loud that it won't take effect until you re-enter
      // VR — the swapchain is sized once per session.
      'framebufferScale (on re-entry)': {
        value: framebufferScale,
        ...SETTING_LIMITS.framebufferScale,
        onChange: (value: number) => set('framebufferScale', value),
      },
    }),
    { collapsed: true },
    // Deliberately not re-created when the values change: leva owns the widget state once
    // mounted, and rebuilding it on every drag would fight the slider.
    [set],
  )

  return null
}

/**
 * Locomotion and comfort, wired to the persisted settings store.
 *
 * These need setting *before* entering VR for the same reason as the render knobs: leva is
 * DOM and disappears the moment the headset takes over. The real in-world settings panel
 * arrives in Sprint 4.4 — until then, this is how a comfort mode gets changed, and the
 * values persist so the choice survives the reload.
 */
export function MovementControls() {
  const set = useSettings((state) => state.set)
  const settings = useSettings()

  useControls(
    'Movement',
    () => ({
      locomotion: {
        value: settings.locomotion,
        options: [...SETTING_OPTIONS.locomotion],
        onChange: (value: LocomotionMode) => set('locomotion', value),
      },
      turn: {
        value: settings.turn,
        options: [...SETTING_OPTIONS.turn],
        onChange: (value: TurnMode) => set('turn', value),
      },
      snapTurnDegrees: {
        value: settings.snapTurnDegrees,
        ...SETTING_LIMITS.snapTurnDegrees,
        onChange: (value: number) => set('snapTurnDegrees', value),
      },
      smoothTurnSpeed: {
        value: settings.smoothTurnSpeed,
        ...SETTING_LIMITS.smoothTurnSpeed,
        onChange: (value: number) => set('smoothTurnSpeed', value),
      },
      moveSpeed: {
        value: settings.moveSpeed,
        ...SETTING_LIMITS.moveSpeed,
        onChange: (value: number) => set('moveSpeed', value),
      },
      comfortVignette: {
        value: settings.comfortVignette,
        ...SETTING_LIMITS.comfortVignette,
        onChange: (value: number) => set('comfortVignette', value),
      },
    }),
    { collapsed: true },
    // As with the XR panel: leva owns the widget state once mounted, and rebuilding it on
    // every change would fight the slider mid-drag.
    [set],
  )

  return null
}

/**
 * The in-headset frame readout (Sprint 3.0).
 *
 * The F2 panel is the *only* control for this, and deliberately so: it is dev
 * instrumentation, not a comfort option, so it has no business on the 1.4 settings board
 * competing for space with the settings that decide whether somebody can play at all. The
 * toggle gates the display only — tracking runs from the first frame in dev, so the chart has
 * five seconds of history the instant it is summoned.
 */
export function FrameControls() {
  const setShow = useFrameHud((state) => state.setShowFpsReadout)
  const showFpsReadout = useFrameHud((state) => state.showFpsReadout)

  useControls(
    'Frame',
    () => ({
      showFpsReadout: {
        value: showFpsReadout,
        label: 'fps readout (in VR)',
        onChange: (value: boolean) => setShow(value),
      },
    }),
    { collapsed: true },
    // As with the other sections: leva owns the widget once mounted.
    [setShow],
  )

  return null
}

/**
 * Rapier's collider wireframes.
 *
 * The single most useful debugging tool this sprint: when the player is standing on
 * nothing, catching on nothing, or falling through a floor that is visibly there, this
 * shows the difference between what is drawn and what is actually collided with.
 */
export function usePhysicsDebug(): boolean {
  const { colliders } = useControls(
    'Physics',
    { colliders: { value: false, label: 'show colliders' } },
    { collapsed: true },
  )
  return import.meta.env.DEV && colliders
}

/** Scene-lighting knobs, so the greybox can be dialled in without a rebuild. */
export function useLightingControls() {
  const enabled = import.meta.env.DEV
  const values = useControls(
    'Lighting',
    {
      ambient: { value: 0.35, min: 0, max: 2, step: 0.01 },
      keyIntensity: { value: 2.5, min: 0, max: 20, step: 0.1 },
      keyHeight: { value: 6, min: 1, max: 12, step: 0.1 },
    },
    { collapsed: true },
  )
  return enabled ? values : { ambient: 0.35, keyIntensity: 2.5, keyHeight: 6 }
}
