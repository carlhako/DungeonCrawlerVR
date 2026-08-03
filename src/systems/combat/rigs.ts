/**
 * Where each hand's weapon actually is, in world space.
 *
 * The combat driver needs two things per hand every fixed step: the point attacks come out
 * of, and the direction they go. In VR that is a tracked pose; on desktop it is a viewmodel
 * hanging off the camera. Both publish an `Object3D` here and the driver reads it the same
 * way, so there is exactly one firing path rather than one per mode — which is the same
 * argument `interaction.ts` makes, and for the same reason: two paths drift, and the
 * divergence shows up in a headset rather than at a desk.
 *
 * **Reading a pose forces its world matrix.** `WeaponRig` mounts its anchor inside an
 * `XRSpace`, whose local matrix is written by a `useFrame` at priority -100 and composed
 * into `matrixWorld` during the render that follows. Reading `matrixWorld` from the fixed
 * step — which runs at priority 0, before that render — therefore returns the *previous*
 * frame's pose. That is the bug that made the pointer beam appear to lag the hand in Sprint
 * 1.3, and it matters more here: a muzzle a frame behind spawns bolts from where the hand
 * used to be. `updateWorldMatrix(true, false)` recomposes from the ancestors' local
 * matrices, which have already been written this frame.
 */

import { Matrix4, Quaternion, Vector3, type Object3D } from 'three'
import type { Hand } from '@/data/weapons'
import type { Vec3 } from '@/systems/locomotion'

export interface WeaponRig {
  /**
   * The business end: a wand's muzzle, a blade's tip. Attacks originate here and melee
   * speed is measured here.
   */
  anchor: Object3D | null
  /**
   * False when the hand behind this rig isn't being tracked — a controller that is off, or
   * a desktop off-hand with nothing in it. A rig that is registered but not live must not
   * fire, and must not have its melee speed measured either: an untracked controller's pose
   * freezes, and a pose that resumes somewhere else reads as a swing across the room.
   */
  live: boolean
}

export const weaponRigs: Record<Hand, WeaponRig> = {
  main: { anchor: null, live: false },
  off: { anchor: null, live: false },
}

export function setWeaponRig(slot: Hand, anchor: Object3D | null, live: boolean): void {
  weaponRigs[slot].anchor = anchor
  weaponRigs[slot].live = live
}

export function clearWeaponRigs(): void {
  setWeaponRig('main', null, false)
  setWeaponRig('off', null, false)
}

/** Scratch, module-level. This runs twice per fixed step and must not allocate. */
const scratchPosition = new Vector3()
const scratchQuaternion = new Quaternion()
const scratchScale = new Vector3()
const scratchMatrix = new Matrix4()
const scratchForward = new Vector3()

export interface RigPose {
  origin: Vec3
  /** Unit vector along the rig's -Z, which is the direction anything three.js "points". */
  direction: Vec3
}

/**
 * Read a rig's current world pose into `out`, and say whether there was one to read.
 *
 * `out` is the caller's own scratch object, reused every step for the same reason as above.
 * Anything that keeps a pose past the step it was read on must copy it — see `applyDamage`,
 * which learned that the hard way.
 */
export function readRigPose(slot: Hand, out: RigPose): boolean {
  const rig = weaponRigs[slot]
  const anchor = rig.anchor
  if (!anchor || !rig.live) return false

  anchor.updateWorldMatrix(true, false)
  scratchMatrix.copy(anchor.matrixWorld)
  scratchMatrix.decompose(scratchPosition, scratchQuaternion, scratchScale)

  out.origin.x = scratchPosition.x
  out.origin.y = scratchPosition.y
  out.origin.z = scratchPosition.z

  scratchForward.set(0, 0, -1).applyQuaternion(scratchQuaternion).normalize()
  out.direction.x = scratchForward.x
  out.direction.y = scratchForward.y
  out.direction.z = scratchForward.z

  return true
}

export function createRigPose(): RigPose {
  return { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 } }
}
