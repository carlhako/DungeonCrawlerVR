import type { Vec3 } from '@/systems/locomotion'

/**
 * Interaction: how the player operates things in the world.
 *
 * One system for both modes, deliberately. Desktop looks at a thing and presses a key; VR
 * points at it, or reaches out and grabs it. Those are different *gestures*, but they
 * answer the same question — "which single thing is the player addressing right now?" — and
 * the moment that question gets answered twice, desktop and VR start disagreeing about what
 * is interactive, in ways nobody notices until a door won't open in the headset.
 *
 * So: candidates register themselves, this module picks exactly one focus per fixed step,
 * and everything downstream (the prompt, the activation, the highlight) reads that focus.
 *
 * Everything except the registry itself is pure and unit-tested. Picking the wrong target
 * is the failure mode here, and it is far easier to reproduce with three spheres and a ray
 * than by walking up to a door in a headset.
 */

export interface Interactable {
  readonly id: string
  /**
   * World-space point the player addresses. Mutable and read every step, so a moving
   * interactable (a door handle swinging open) needs no re-registration.
   */
  position: Vec3
  /**
   * Metres. Doubles as the ray target's radius and the near-grab reach, so a big obvious
   * lever is easier to hit than a small fiddly one — which is what you want in VR, where
   * pointing precision is much worse than it looks from a desk.
   *
   * Ignored for picking when `surface` is set; still used to size the prompt above it.
   */
  radius: number
  /** Shown in the prompt. A verb: "Open the door", not "Door". */
  label: string
  /** A disabled interactable stays registered but is never focused. Locked doors, later. */
  enabled: boolean
  /**
   * Whether standing near it on desktop is enough to address it. Defaults to true.
   *
   * Off for anything that sits next to its neighbours — a panel of shop buttons, where
   * "nearest thing to the player" is not a guess about intent, it is a coin toss. Those are
   * aimed at, not walked into. Reaching for one in VR still works: a hand *on* a button is
   * an answer, a body near six of them is not.
   */
  proximity?: boolean
  /**
   * Treat this interactable as a flat rectangle rather than as a sphere.
   *
   * A sphere is the right shape for a door handle and the wrong shape for a button on a
   * board. A shop upgrade row draws 45cm wide and 7cm tall; its inscribed sphere is 4cm
   * across, so pointing at the middle of a button you can plainly see missed it, while a
   * hand near the board had four rows inside its reach at once and the nearest *centre*
   * won — which was reliably the row below the one being touched.
   *
   * Mutable and read every step, like `position`, so a panel that moves needs no
   * re-registration.
   */
  surface?: Surface
  onActivate: () => void
}

/**
 * A rectangle in world space, centred on the interactable's `position`.
 *
 * `right`, `up` and `normal` must be unit vectors and mutually perpendicular; `normal` points
 * out of the face the player addresses, so the back of a panel is not pointable-through.
 */
export interface Surface {
  right: Vec3
  up: Vec3
  normal: Vec3
  halfWidth: number
  halfHeight: number
  /**
   * How far either side of the plane a hand still counts as touching. This is the whole of
   * the near-grab tolerance for a rectangle: unlike a sphere, it does not also widen the
   * target sideways into its neighbours.
   */
  depth: number
}

/**
 * Slack around a rectangle's edges for a near-grab, in metres.
 *
 * Deliberately tiny next to `REACH_MARGIN`. Spheres need a fat margin because the inscribed
 * sphere is much smaller than the thing you see; a rectangle already *is* the thing you see,
 * so all a margin buys here is stealing presses from the button next door. Smaller than the
 * gap between two adjacent shop buttons (11mm), so their tolerance zones cannot overlap.
 */
export const SURFACE_TOUCH_MARGIN = 0.005

function dot(a: Vec3, x: number, y: number, z: number): number {
  return a.x * x + a.y * y + a.z * z
}

/** How the player reached the focused interactable. The prompt phrases itself from this. */
export type FocusSource = 'none' | 'ray' | 'reach'

export interface InteractionState {
  focus: Interactable | null
  source: FocusSource
  /**
   * Which controller produced the focus, in VR. Null on desktop.
   *
   * Read by the pointer beam so it lights up on the hand that is doing the pointing, and by
   * the driver so the trigger that confirms is the one on that same hand.
   */
  hand: 'left' | 'right' | null
  /** Metres from the pointing origin (or the hand) to the interactable. */
  distance: number
  /**
   * True on the step an interactable was activated, so the player controller can tell that
   * `Space` has already been spent this step and must not also become a jump.
   */
  consumedActivate: boolean
}

/** Module singleton, same reasoning as `xrInput`: read from inside the fixed loop. */
export const interactionState: InteractionState = {
  focus: null,
  source: 'none',
  hand: null,
  distance: 0,
  consumedActivate: false,
}

const registry: Interactable[] = []

/** Live registry, read-only to consumers. */
export const interactables: readonly Interactable[] = registry

/** Register a candidate. Returns the unregister function; call it on unmount. */
export function registerInteractable(item: Interactable): () => void {
  registry.push(item)
  return () => {
    const i = registry.indexOf(item)
    if (i !== -1) registry.splice(i, 1)
    // An unmounting interactable must not stay focused, or the prompt outlives the thing it
    // is describing and pressing the key calls into a scene that no longer exists.
    if (interactionState.focus === item) clearFocus()
  }
}

export function clearFocus(): void {
  interactionState.focus = null
  interactionState.source = 'none'
  interactionState.hand = null
  interactionState.distance = 0
}

/** How far a desktop look-ray or a VR pointer reaches. Beyond this, nothing is offered. */
export const RAY_RANGE = 3.5

/**
 * Extra reach around an interactable's own radius for a near-grab.
 *
 * Roughly the distance between where a hand *looks* like it is and where the controller
 * reports it, plus the slack you want when someone is reaching for a handle they can see
 * perfectly well and the game keeps saying no.
 */
export const REACH_MARGIN = 0.12

export interface Pick {
  item: Interactable
  distance: number
}

/**
 * The nearest interactable a hand is close enough to touch.
 *
 * Beats pointing, always: if your hand is on the handle, you meant the handle, whatever the
 * ray happens to be crossing on the far side of the room.
 */
export function pickByReach(
  items: readonly Interactable[],
  hand: Vec3,
  margin = REACH_MARGIN,
): Pick | null {
  let best: Pick | null = null
  for (const item of items) {
    if (!item.enabled) continue

    const dx = hand.x - item.position.x
    const dy = hand.y - item.position.y
    const dz = hand.z - item.position.z

    if (item.surface) {
      const s = item.surface
      // Perpendicular first: a hand well in front of the board is not touching anything, and
      // this is the only axis the tolerance is allowed to be generous on.
      const n = dot(s.normal, dx, dy, dz)
      if (n < -s.depth || n > s.depth) continue
      // Then in-plane, against the drawn rectangle. A hand over the gap between two buttons
      // picks neither, which is the honest answer and much better than picking the wrong one.
      const u = dot(s.right, dx, dy, dz)
      const v = dot(s.up, dx, dy, dz)
      if (Math.abs(u) > s.halfWidth + SURFACE_TOUCH_MARGIN) continue
      if (Math.abs(v) > s.halfHeight + SURFACE_TOUCH_MARGIN) continue
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (!best || distance < best.distance) best = { item, distance }
      continue
    }

    const reach = item.radius + margin
    const d2 = dx * dx + dy * dy + dz * dz
    if (d2 > reach * reach) continue
    const distance = Math.sqrt(d2)
    if (!best || distance < best.distance) best = { item, distance }
  }
  return best
}

/**
 * How close a desktop player has to be for a thing to offer itself without precise aiming.
 *
 * Desktop needs this and VR does not. A door handle sits at about a metre; a standing eye is
 * at 1.6m and points dead level unless the player thinks to look down — so a pure look-ray
 * sails over the handle at *every* distance, and the door reads as broken. Reaching for
 * something in VR already answers the question with your hand.
 */
export const PROXIMITY_RANGE = 1.8

/**
 * The nearest interactable in front of the player and within arm's reach of their body.
 *
 * `forward` only has to be roughly right: this is a hemisphere test, not an aim test. The
 * point is that turning your back on a door dismisses its prompt, while glancing at the
 * ceiling in front of it does not.
 */
export function pickByProximity(
  items: readonly Interactable[],
  position: Vec3,
  forward: Vec3,
  range = PROXIMITY_RANGE,
): Pick | null {
  let best: Pick | null = null
  for (const item of items) {
    if (!item.enabled) continue
    if (item.proximity === false) continue

    const dx = item.position.x - position.x
    const dy = item.position.y - position.y
    const dz = item.position.z - position.z
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (distance > range + item.radius) continue
    if (dx * forward.x + dy * forward.y + dz * forward.z <= 0) continue

    if (!best || distance < best.distance) best = { item, distance }
  }
  return best
}

/**
 * The first interactable a ray passes through.
 *
 * Each candidate is treated as a sphere of its own radius rather than tested against real
 * geometry: it is cheap, it is forgiving at the edges, and forgiving is correct — a ray
 * from a hand-held controller at 3m wobbles by more than a door handle is wide.
 *
 * `direction` must be normalised.
 */
export function pickByRay(
  items: readonly Interactable[],
  origin: Vec3,
  direction: Vec3,
  maxDistance = RAY_RANGE,
): Pick | null {
  let best: Pick | null = null

  for (const item of items) {
    if (!item.enabled) continue

    const ox = item.position.x - origin.x
    const oy = item.position.y - origin.y
    const oz = item.position.z - origin.z

    if (item.surface) {
      const s = item.surface
      const facing = dot(s.normal, direction.x, direction.y, direction.z)
      // Only the front face. Parallel rays and rays coming at the back of a panel are not
      // aiming at it, whatever the maths says about where the plane is.
      if (facing > -1e-4) continue
      const along = dot(s.normal, ox, oy, oz) / facing
      if (along < 0 || along > maxDistance) continue

      const hx = ox - direction.x * along
      const hy = oy - direction.y * along
      const hz = oz - direction.z * along
      // Sign flips because `h` runs from the hit point back to the centre.
      if (Math.abs(dot(s.right, hx, hy, hz)) > s.halfWidth) continue
      if (Math.abs(dot(s.up, hx, hy, hz)) > s.halfHeight) continue

      if (!best || along < best.distance) best = { item, distance: along }
      continue
    }

    // Distance along the ray to the point of closest approach. Negative means the thing is
    // behind you, which is never something you are pointing at.
    const along = ox * direction.x + oy * direction.y + oz * direction.z
    if (along < 0 || along > maxDistance) continue

    const closestX = ox - direction.x * along
    const closestY = oy - direction.y * along
    const closestZ = oz - direction.z * along
    const missSquared = closestX * closestX + closestY * closestY + closestZ * closestZ
    if (missSquared > item.radius * item.radius) continue

    if (!best || along < best.distance) best = { item, distance: along }
  }

  return best
}

/**
 * Resolve the candidates into one focus, in order of how good a signal each one is.
 *
 * 1. **Reach** — a hand physically on the thing. Unbeatable: if you are holding the handle,
 *    you meant the handle, whatever the ray happens to cross on the far side of the room.
 * 2. **Ray** — deliberate aim, with either a controller or the desktop camera.
 * 3. **Proximity** — standing near it on desktop, where a level look-ray sails over anything
 *    below eye height. A fallback, and only a fallback: it was outranking aim, so walking up
 *    to a shop counter offered the bell no matter which button you were staring at.
 *
 * The alternative at every level — nearest wins — reads as the game changing its mind about
 * what you are addressing as you drift, which is much worse than a rule you can feel.
 */
export function chooseFocus(
  reach: Pick | null,
  ray: Pick | null,
  proximity: Pick | null = null,
): { pick: Pick | null; source: FocusSource } {
  if (reach) return { pick: reach, source: 'reach' }
  if (ray) return { pick: ray, source: 'ray' }
  // Reported as 'reach' rather than a fourth source: from the player's side it is the same
  // gesture as being near enough to touch, and the prompt should read the same way.
  if (proximity) return { pick: proximity, source: 'reach' }
  return { pick: null, source: 'none' }
}

/** Apply a resolved focus to the shared state. */
export function setFocus(
  pick: Pick | null,
  source: FocusSource,
  hand: 'left' | 'right' | null = null,
): void {
  if (!pick) {
    clearFocus()
    return
  }
  interactionState.focus = pick.item
  interactionState.source = source
  interactionState.hand = hand
  interactionState.distance = pick.distance
}

/**
 * Activate the current focus, if there is one. Returns whether anything happened.
 *
 * The return value is the contract with the player controller: `Space` is jump *unless* it
 * was spent here. Resolving that conflict inside the interaction system, rather than by
 * giving the door its own key, keeps the desktop control scheme to one obvious verb.
 */
export function activateFocus(): boolean {
  const focus = interactionState.focus
  if (!focus || !focus.enabled) return false
  focus.onActivate()
  interactionState.consumedActivate = true
  return true
}

/** Test-only: drop every registration. */
export function resetInteractions(): void {
  registry.length = 0
  clearFocus()
  interactionState.consumedActivate = false
}
