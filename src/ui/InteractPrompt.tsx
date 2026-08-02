import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three'
import { damp } from '@/systems/locomotion'
import { interactionState, type FocusSource } from '@/systems/interaction'
import { createLabel, type Label } from '@/ui/label'

/**
 * The "you can use this" prompt: a small billboard above whatever the player is addressing.
 *
 * World-space rather than a DOM overlay, because a screen-space prompt has no meaning in a
 * headset — there is no screen to put it on, and anything pinned to the eye is both
 * uncomfortable and impossible to focus on. Putting it *at the object* means desktop and VR
 * run the same code and the player looks in the same place in both.
 *
 * The prompt names the actual button, and the button depends on how you reached the thing:
 * pointing at a door across the room and having your hand on its handle are different
 * gestures with different confirmations.
 */

/** Metres tall. Sized to read at arm's length without covering what it labels. */
const PROMPT_HEIGHT = 0.09

/** Clearance above the interactable's own radius. */
const PROMPT_LIFT = 0.14

const FADE_HALF_LIFE = 0.05

function keyName(source: FocusSource, inSession: boolean): string {
  if (!inSession) return 'Space'
  return source === 'reach' ? 'Grip' : 'Trigger'
}

export function InteractPrompt() {
  const gl = useThree((state) => state.gl)
  const camera = useThree((state) => state.camera)

  const prompt = useMemo(() => {
    const geometry = new PlaneGeometry(1, PROMPT_HEIGHT)
    const material = new MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      // Depth-tested so a prompt behind a wall is occluded like anything else — it is a
      // thing in the room, not an overlay. Tone mapping off: this is UI, and letting the
      // exposure curve dim it in a dark dungeon defeats the point.
      toneMapped: false,
      depthWrite: false,
    })
    const mesh = new Mesh(geometry, material)
    mesh.visible = false
    // It moves to wherever the focus is, so a bounding sphere computed at the origin would
    // cull it the moment the player faced away from spawn.
    mesh.frustumCulled = false
    // Drawn late so it isn't hidden by transparent things at the same depth (torch glow).
    mesh.renderOrder = 10
    return { mesh, geometry, material }
  }, [])

  /** One texture per distinct string, built on demand and kept for the session. */
  const labels = useRef(new Map<string, Label>())
  const scratch = useMemo(() => ({ position: new Vector3(), opacity: 0 }), [])

  useEffect(() => {
    const cache = labels.current
    return () => {
      prompt.geometry.dispose()
      prompt.material.dispose()
      for (const label of cache.values()) label.dispose()
      cache.clear()
    }
  }, [prompt])

  // Per rendered frame, not per fixed step: this only reads state and follows the camera, and
  // a billboard that updates at 60 while the headset runs at 72 visibly swims.
  useFrame((_, delta) => {
    const focus = interactionState.focus
    const target = focus ? 1 : 0
    scratch.opacity = damp(scratch.opacity, target, FADE_HALF_LIFE, delta)

    if (!focus && scratch.opacity < 0.01) {
      prompt.mesh.visible = false
      return
    }
    if (!focus) {
      // Still fading out. Hold the last position rather than snapping to the origin.
      prompt.material.opacity = scratch.opacity
      return
    }

    const text = `${focus.label}   ${keyName(interactionState.source, gl.xr.isPresenting)}`
    const label = getLabel(labels.current, text)
    if (prompt.material.map !== label.texture) {
      prompt.material.map = label.texture
      prompt.material.needsUpdate = true
      prompt.mesh.scale.set(PROMPT_HEIGHT * label.aspect, 1, 1)
    }

    prompt.mesh.visible = true
    prompt.material.opacity = scratch.opacity
    prompt.mesh.position.set(
      focus.position.x,
      focus.position.y + focus.radius + PROMPT_LIFT,
      focus.position.z,
    )
    // Face the viewer. `camera` is the XR camera while presenting, which sits between the
    // eyes — close enough that the prompt reads square in both.
    camera.getWorldPosition(scratch.position)
    prompt.mesh.lookAt(scratch.position)
  })

  return <primitive object={prompt.mesh} />
}

function getLabel(cache: Map<string, Label>, text: string): Label {
  const existing = cache.get(text)
  if (existing) return existing
  const created = createLabel(text)
  cache.set(text, created)
  return created
}
