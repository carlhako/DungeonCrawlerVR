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
   */
  radius: number
  /** Shown in the prompt. A verb: "Open the door", not "Door". */
  label: string
  /** A disabled interactable stays registered but is never focused. Locked doors, later. */
  enabled: boolean
  onActivate: () => void
}

/** How the player reached the focused interactable. The prompt phrases itself from this. */
export type FocusSource = 'none' | 'ray' | 'reach'

export interface InteractionState {
  focus: Interactable | null
  source: FocusSource
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

function distanceSquared(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}

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
    const reach = item.radius + margin
    const d2 = distanceSquared(item.position, hand)
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
 * Resolve the two candidates into one focus.
 *
 * Reach wins over ray. The alternative — nearest wins — reads as the game changing its mind
 * about what you are holding as your hand drifts, which is much worse than a rule you can
 * feel: touch it, or point at it.
 */
export function chooseFocus(reach: Pick | null, ray: Pick | null): {
  pick: Pick | null
  source: FocusSource
} {
  if (reach) return { pick: reach, source: 'reach' }
  if (ray) return { pick: ray, source: 'ray' }
  return { pick: null, source: 'none' }
}

/** Apply a resolved focus to the shared state. */
export function setFocus(pick: Pick | null, source: FocusSource): void {
  if (!pick) {
    clearFocus()
    return
  }
  interactionState.focus = pick.item
  interactionState.source = source
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
