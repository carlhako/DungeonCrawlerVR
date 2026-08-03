import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { useXR } from '@react-three/xr'
import { SystemOrder } from '@/core/loop'
import { useFixedUpdate } from '@/core/simulation'
import {
  ATTACK_BUTTONS,
  desktopInput,
  mergeButtons,
  mergeTaps,
  releaseDesktopInput,
  sampleDesktopInput,
} from '@/systems/desktopInput'

/**
 * Binds keyboard, mouse and pointer lock, and pumps `desktopInput` once per fixed step.
 *
 * Registered at `SystemOrder.Input` alongside the XR sampler, so both input sources are
 * settled before any gameplay system runs in the same step.
 */
export function DesktopInputSampler() {
  const canvas = useThree((state) => state.gl.domElement)
  const inSession = useXR((state) => state.session != null)

  // Raw device state, accumulated by DOM events and drained by the fixed step. Held in a
  // ref because these change many times per frame and must not trigger a render.
  const raw = useRef({
    held: new Set<string>(),
    // Keys pressed since the last fixed step, whether or not they are still down.
    tapped: new Set<string>(),
    mouseX: 0,
    mouseY: 0,
    locked: false,
    buttons: new Set<number>(),
    // Latched exactly like `tapped`: a click shorter than one fixed step is a click the
    // player made, and dropping it feels like the game ignoring them.
    clicked: new Set<number>(),
  })

  useEffect(() => {
    // Inside a session the headset owns the view and the controllers own movement. Binding
    // pointer lock here would also fight the browser, which won't grant it during XR.
    if (inSession) {
      raw.current.held.clear()
      raw.current.tapped.clear()
      releaseDesktopInput(desktopInput)
      return
    }

    const state = raw.current

    const onKeyDown = (event: KeyboardEvent) => {
      // Let the dev-panel keys and browser shortcuts through untouched.
      if (event.metaKey || event.ctrlKey || event.altKey) return
      // Space scrolls the page by default, which is visible as a jolt even on a fullscreen
      // canvas.
      if (event.code === 'Space') event.preventDefault()
      state.held.add(event.code)
      // Latched separately, so a press released before the next fixed step still registers.
      state.tapped.add(event.code)
    }
    const onKeyUp = (event: KeyboardEvent) => state.held.delete(event.code)

    const onMouseMove = (event: MouseEvent) => {
      if (!state.locked) return
      // Accumulated, not replaced: pointer events arrive faster than the fixed step and in
      // coalesced bursts, so keeping only the newest would discard most of the motion.
      state.mouseX += event.movementX
      state.mouseY += event.movementY
    }

    const onPointerLockChange = () => {
      state.locked = document.pointerLockElement === canvas
      if (!state.locked) {
        // Escape releases the lock. Anything still held would otherwise stay held.
        state.held.clear()
        state.tapped.clear()
        releaseDesktopInput(desktopInput)
      }
    }

    const onMouseDown = (event: MouseEvent) => {
      state.buttons.add(event.button)
      state.clicked.add(event.button)
    }
    const onMouseUp = (event: MouseEvent) => state.buttons.delete(event.button)

    // Right-click is the off-hand attack, so the context menu must not open on top of the
    // game every time the player uses it.
    const onContextMenu = (event: MouseEvent) => event.preventDefault()

    // The very first click of a session is spent capturing the mouse, and must not also be
    // an attack — otherwise starting to play always costs a shot, fired at whatever the
    // camera happened to be pointing at. Only the first: after that the player is in the
    // game and a click means what it says. `click` fires after `mousedown` in the same task,
    // so the press this deletes has not been sampled yet.
    let captured = false

    const onCanvasClick = () => {
      if (document.pointerLockElement === canvas) return
      if (!captured) {
        captured = true
        state.buttons.delete(ATTACK_BUTTONS.main)
        state.clicked.delete(ATTACK_BUTTONS.main)
      }
      // Not awaited: a rejected request (the browser rate-limits repeated attempts) is not
      // an error worth surfacing — the player just clicks again.
      void canvas.requestPointerLock?.()
    }

    // `keyup` never arrives for a key that was down when the tab lost focus, which leaves
    // the player walking into a wall until they alt-tab back and press it again.
    const onBlur = () => {
      state.held.clear()
      state.tapped.clear()
      state.buttons.clear()
      state.clicked.clear()
      releaseDesktopInput(desktopInput)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('contextmenu', onContextMenu)
    document.addEventListener('pointerlockchange', onPointerLockChange)
    canvas.addEventListener('click', onCanvasClick)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('contextmenu', onContextMenu)
      document.removeEventListener('pointerlockchange', onPointerLockChange)
      canvas.removeEventListener('click', onCanvasClick)
      state.held.clear()
      state.tapped.clear()
      state.buttons.clear()
      state.clicked.clear()
      releaseDesktopInput(desktopInput)
    }
  }, [canvas, inSession])

  useFixedUpdate(() => {
    const state = raw.current
    sampleDesktopInput(desktopInput, {
      held: mergeTaps(state.held, state.tapped),
      mouseDeltaX: state.mouseX,
      mouseDeltaY: state.mouseY,
      pointerLocked: state.locked,
      buttons: mergeButtons(state.buttons, state.clicked),
    })
    // Drain both: this input has been consumed, and leaving it would apply it again on the
    // next step — a single tap would read as a key held for two.
    state.tapped.clear()
    state.clicked.clear()
    state.mouseX = 0
    state.mouseY = 0
  }, SystemOrder.Input)

  return null
}
