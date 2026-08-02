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
}

export const playerState: PlayerState = {
  position: { x: 0, y: 0, z: 0 },
  yaw: 0,
  speed: 0,
  grounded: false,
  turning: false,
  aiming: false,
}

/**
 * The player's own capsule, published by `PlayerRig` once physics has created it.
 *
 * World queries have to exclude it or they hit the player first: a teleport arc fired from
 * a controller starts inside the player's own collider, and a weapon raycast (Sprint 2.2)
 * would shoot them in the chest.
 */
export const playerCollider: { current: Collider | null } = { current: null }

/** Where the player starts. Replaced by the foyer's spawn marker in Sprint 1.1. */
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
