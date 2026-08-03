/**
 * Where the player is and what they are doing, as a plain mutable snapshot.
 *
 * Same pattern and the same reasoning as `xrInput`: a module singleton with a stable
 * identity, written once per fixed step by the character controller and read by everything
 * that needs to know about the player without being handed a prop. The comfort vignette
 * reads it this frame; enemy aggro (Sprint 2.3) and the scare director (3.3) will read it
 * sixty times a second, and none of that should re-render the scene graph.
 */

import type { Collider } from '@dimforge/rapier3d-compat'

export interface PlayerState {
  /** The player's feet, in world space. */
  position: { x: number; y: number; z: number }
  /**
   * The rig's yaw in radians — what snap-turn and mouselook move.
   *
   * Not the player's *facing*: in VR they can look anywhere without this changing, which
   * is the whole point of the comfort rule.
   */
  yaw: number
  /** Horizontal speed in m/s over the last step. */
  speed: number
  grounded: boolean
  /** True on the steps a smooth turn is being applied. Drives the comfort vignette. */
  turning: boolean
  /** True while the teleport arc is being aimed. */
  aiming: boolean
  /**
   * 0..1: how far the player's head has physically walked past where the capsule can go.
   *
   * Room-scale walking is the one case where the head and the body can disagree — the
   * capsule stops at a wall and nothing on earth stops someone taking another step. Since
   * moving the view is forbidden, the response is to black it out instead. See
   * `headBlockAmount`.
   */
  headBlocked: number
}

export const playerState: PlayerState = {
  position: { x: 0, y: 0, z: 0 },
  yaw: 0,
  speed: 0,
  grounded: false,
  turning: false,
  aiming: false,
  headBlocked: 0,
}

/**
 * The player's own capsule, published by `PlayerRig` once physics has created it.
 *
 * World queries have to exclude it or they hit the player first: a teleport arc fired from
 * a controller starts inside the player's own collider, and a weapon raycast (Sprint 2.2)
 * would shoot them in the chest.
 */
export const playerCollider: { current: Collider | null } = { current: null }

/**
 * A position the player is to be moved to, applied by `PlayerRig` on its next step.
 *
 * There is exactly one thing in this game allowed to use it: **death**. Everything else the
 * player does, they walk — they walk into the dungeon rather than being dropped into it, and
 * they walk home after clearing a wave, because a cut in VR is a cut to somebody wondering
 * where they went. Dying is the one case with no walk available, and leaving a corpse standing
 * in a corridor waiting to be escorted back would be worse.
 *
 * A pending value rather than a direct write, for the same reason the teleport arc is: the
 * character controller owns the capsule, and something else writing its translation halfway
 * through a step leaves physics and the rig disagreeing about where the player is.
 */
const recall: { pending: { x: number; y: number; z: number } | null } = { pending: null }

export function recallPlayer(to: { x: number; y: number; z: number }): void {
  recall.pending = { ...to }
}

/** Take the pending recall, if any. Clears it, so one death moves the player once. */
export function consumeRecall(): { x: number; y: number; z: number } | null {
  const pending = recall.pending
  recall.pending = null
  return pending
}

/**
 * Where the player starts, in both rooms.
 *
 * Shared deliberately: the foyer is laid out around this point (facing the door, with the
 * shop counter behind your shoulder) so that swapping scenes with `?scene=greybox` doesn't
 * also change where you begin. A per-scene spawn arrives with the dungeon in Sprint 2.1,
 * when there is more than one place worth starting.
 */
export const PLAYER_SPAWN: [number, number, number] = [0, 0, 4]

/**
 * Capsule dimensions, in metres, for a 1.7m player.
 *
 * Fixed rather than measured from the headset. A capsule that resized itself as the player
 * crouched would be more correct, but it also means the collider changes shape underneath
 * a character controller that is mid-step — worth doing later, against a real level, not
 * against a greybox.
 */
export const PLAYER_HEIGHT = 1.7
export const PLAYER_RADIUS = 0.3
/** Rapier's capsule arg is the half-height of the *cylindrical* section, excluding the caps. */
export const PLAYER_HALF_HEIGHT = PLAYER_HEIGHT / 2 - PLAYER_RADIUS
/** The capsule's centre sits here above the player's feet. */
export const PLAYER_CENTRE_OFFSET = PLAYER_HEIGHT / 2

/**
 * Eye height used by the *desktop* camera only.
 *
 * In VR this number is never used — head height comes from the headset's floor-relative
 * tracking, and substituting our own guess is what makes people feel like the wrong size.
 */
export const DESKTOP_EYE_HEIGHT = 1.6
