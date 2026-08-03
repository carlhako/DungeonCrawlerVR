import type { Group, Vector3 } from 'three'
import { registerInteractable, type Interactable } from '@/systems/interaction'
import type { Rect } from '@/systems/shop'

/**
 * Registering the buttons drawn on a world-space panel as interactables.
 *
 * Every diegetic board in the game — the shop, the settings, the reset plaque — draws
 * rectangles on a canvas and then has to make those rectangles pressable at exactly the
 * place they appear. This is that step, in one place, because the third copy of it is where
 * the drift starts: the shop's first version was unusable in a headset precisely because a
 * button's *pick* shape and its *drawn* shape had come apart.
 *
 * Buttons keep stable ids across redraws, so an unchanged button keeps its registration and
 * the focus doesn't flicker while the player is looking straight at it.
 */

/**
 * How far in front of a board a hand still counts as touching a button, in metres.
 *
 * The only tolerance a rectangular button has, and the only one it needs. Buttons are picked
 * as the rectangles they are drawn as (see `Interactable.surface`), so being generous here
 * cannot leak a press into the row below — which is exactly what the old spherical pick did,
 * with a reach of 16cm across rows 8cm apart.
 */
export const TOUCH_DEPTH = 0.06

export interface PanelButton {
  id: string
  rect: Rect
  /** What the interaction prompt says. */
  prompt: string
  /** False for a button that is shown but cannot be pressed. */
  enabled: boolean
}

export interface PanelRegistration {
  item: Interactable
  unregister: () => void
}

export interface PanelScratch {
  local: Vector3
  right: Vector3
  up: Vector3
  normal: Vector3
}

/**
 * Bring the registered interactables in line with the current button list.
 *
 * `activate` is called with a button id rather than being closed over per button, because
 * the list is rebuilt as the panel changes and a closure captured three redraws ago must
 * not act on a layout that no longer exists.
 */
export function syncPanelButtons(
  node: Group,
  registrations: Map<string, PanelRegistration>,
  buttons: PanelButton[],
  scale: number,
  scratch: PanelScratch,
  activate: (id: string) => void,
): void {
  node.updateWorldMatrix(true, false)
  const seen = new Set<string>()

  // The board's own axes, taken from its matrix rather than rebuilt from a yaw prop, so the
  // buttons stay attached to the board if it is ever parented to something that moves.
  const { local, right, up, normal } = scratch
  node.matrixWorld.extractBasis(right, up, normal)
  right.normalize()
  up.normalize()
  normal.normalize()

  for (const button of buttons) {
    seen.add(button.id)
    // Slightly proud of the surface, so a hand reaching for a button meets it at the glass
    // rather than having to push through the board.
    local.set(button.rect.cx, button.rect.cy, 0.04)
    node.localToWorld(local)

    // Half-extents in world metres: the rect is in layout units and the group scales them.
    const halfWidth = (button.rect.w / 2) * scale
    const halfHeight = (button.rect.h / 2) * scale

    const existing = registrations.get(button.id)
    if (existing) {
      existing.item.position.x = local.x
      existing.item.position.y = local.y
      existing.item.position.z = local.z
      existing.item.label = button.prompt
      existing.item.enabled = button.enabled
      const surface = existing.item.surface
      if (surface) {
        copy(surface.right, right)
        copy(surface.up, up)
        copy(surface.normal, normal)
        surface.halfWidth = halfWidth
        surface.halfHeight = halfHeight
      }
      continue
    }

    const id = button.id
    const item: Interactable = {
      id,
      position: { x: local.x, y: local.y, z: local.z },
      // The pickable shape is the drawn rectangle — see `Interactable.surface`. `radius`
      // only sizes the prompt that floats above it now.
      radius: Math.min(halfWidth, halfHeight),
      surface: {
        right: { x: right.x, y: right.y, z: right.z },
        up: { x: up.x, y: up.y, z: up.z },
        normal: { x: normal.x, y: normal.y, z: normal.z },
        halfWidth,
        halfHeight,
        depth: TOUCH_DEPTH,
      },
      label: button.prompt,
      enabled: button.enabled,
      // Standing near a board of a dozen buttons says nothing about which one you meant, so
      // they are aimed at or touched. A hand *on* a button still wins.
      proximity: false,
      onActivate: () => activate(id),
    }
    registrations.set(id, { item, unregister: registerInteractable(item) })
  }

  for (const [id, registration] of registrations) {
    if (seen.has(id)) continue
    registration.unregister()
    registrations.delete(id)
  }
}

/** Write a three.js vector into a plain one, in place — these are read every fixed step. */
function copy(target: { x: number; y: number; z: number }, source: Vector3): void {
  target.x = source.x
  target.y = source.y
  target.z = source.z
}
