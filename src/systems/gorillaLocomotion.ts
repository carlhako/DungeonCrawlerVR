import { useEffect, useMemo, useRef } from 'react'
import { useRapier } from '@react-three/rapier'
import { useXR } from '@react-three/xr'
import { QueryFilterFlags, Ray, type Collider, type World } from '@dimforge/rapier3d-compat'
import { Quaternion, Vector3 } from 'three'
import { SystemOrder } from '@/core/loop'
import { FIXED_STEP } from '@/core/loop'
import { useFixedUpdate } from '@/core/simulation'
import { useSettings } from '@/systems/settings'
import {
  applyDeadzone,
  gorillaBodyFromHands,
  gorillaHandContribution,
  moveDirection,
  type Vec3,
} from '@/systems/locomotion'
import { playerCollider, playerState } from '@/systems/player'
import { xrInput } from '@/systems/xrInput'
import { xrHands } from '@/systems/xrHands'

/**
 * Gorilla Tag-style locomotion, as a third opt-in mode.
 *
 * Three states: `floor` (standing), `wall` (held by hands on a climbable surface), and
 * `air` (falling). The body is driven by hand motion on the floor, by an analytic
 * midpoint-plus-offset solve while on a wall, and by gravity while in the air. When the
 * player is on the floor and is not gripping either controller, the left thumbstick falls
 * back to the smooth-stick path — same speed, same deadzone, no second walking system to
 * tune.
 *
 * The module owns its own per-hand state because the previous-frame hand position is only
 * meaningful in the context of the current fixed step, and that is exactly what this
 * driver is doing. `xrInput` stays focused on buttons, `xrHands` stays focused on poses.
 *
 * Registered at `SystemOrder.Player - 1`, the same slot `TeleportAim` uses, so the rig
 * reads a freshly computed value on the same step the module writes it.
 */

/** How far the player's hand reaches to establish a grip. Short on purpose: a hand
 *  clearly touching a wall is grip, a hand nearby but not on it is not. */
export const GRIP_RANGE = 0.05

/** How far the body sits off a wall along the wall normal. Sized so the capsule does not
 *  intersect the wall mesh and so two-handed climbing produces a stable midpoint. */
export const BODY_OFFSET = 0.4

/** Per-step displacement multiplier for hands. 1.0 is the Gorilla Locomotion default —
 *  the body moves exactly as far as the hand did. Tuned in playtest via the F2 panel. */
export const TRANSFER_FACTOR = 1

/** Deadzone used for the joystick fallback while on the floor in gorilla mode. Matched to
 *  the smooth-mode value in PlayerRig so the two paths feel identical when the player
 *  rests their arms. */
const STICK_DEADZONE = 0.15

/** Below this vertical component, a hit normal counts as a wall rather than a floor or
 *  ceiling. 0.7 is roughly 45 degrees — steeper than any dungeon surface actually is, so
 *  the split is really "flat" vs "upright", not a fine-grained slope cutoff. */
const WALL_NORMAL_MAX_UP = 0.7

type LocomotionState = 'floor' | 'wall' | 'air'

interface PerHandState {
  previousPosition: Vec3
  currentPosition: Vec3
  isGripping: boolean
  /** True when the touched surface is (close to) vertical — a climbable wall rather than
   *  the floor or ceiling. Distinguishes "push off the floor to walk" from "grab the wall
   *  to climb" without needing a second rigid body per surface type. */
  onWall: boolean
  /** Unit vector pointing out of the surface the hand is touching. */
  gripNormal: Vec3
  /** World-space contact point: where the hand's raycast hit the surface. */
  gripContactPoint: Vec3
  /** The collider the hand is currently gripping, used to detect "same surface". */
  gripCollider: Collider | null
  /** True once the position has been observed at least once — guards against a stale
   *  `previousPosition` from before this hand ever existed in this session. */
  initialised: boolean
}

interface GorillaRuntime {
  state: LocomotionState
  leftHand: PerHandState
  rightHand: PerHandState
  /** Horizontal motion to apply for this step. Vertical is owned by the rig's gravity
   *  integration; the gorilla math has no opinion on `y`. */
  motion: Vec3
  /** When non-null, the rig bypasses the character controller and writes this position
   *  directly. Only set while in `wall` state. */
  bodyPositionOverride: Vec3 | null
  /** The wall normal that drove the body offset, so the rig can sanity-check it without
   *  recomputing. */
  wallNormal: Vec3 | null
}

function emptyHand(): PerHandState {
  return {
    previousPosition: { x: 0, y: 0, z: 0 },
    currentPosition: { x: 0, y: 0, z: 0 },
    isGripping: false,
    onWall: false,
    gripNormal: { x: 0, y: 0, z: 0 },
    gripContactPoint: { x: 0, y: 0, z: 0 },
    gripCollider: null,
    initialised: false,
  }
}

/**
 * Module singleton. Same reasoning as `Teleport`'s runtime and `xrInput`: the rig reads
 * this from inside the fixed loop where hooks don't exist. Stable identity — mutated in
 * place, never reassigned.
 */
const runtime: GorillaRuntime = {
  state: 'floor',
  leftHand: emptyHand(),
  rightHand: emptyHand(),
  motion: { x: 0, y: 0, z: 0 },
  bodyPositionOverride: null,
  wallNormal: null,
}

/**
 * Take the gorilla module's last computed motion and body override.
 *
 * Reads, does not clear — the gorilla module overwrites both every step, and the rig reads
 * them exactly once. Mirrors `consumeTeleport`'s no-clear contract where the gorilla
 * module owns the lifetime.
 */
export interface GorillaMotion {
  motion: Vec3
  bodyPositionOverride: Vec3 | null
}

export function consumeGorillaMotion(): GorillaMotion {
  return {
    motion: runtime.motion,
    bodyPositionOverride: runtime.bodyPositionOverride,
  }
}

/**
 * True while the player is being driven by the gorilla module — the rig uses this to
 * decide whether to feed hand math into the character controller or to bypass it entirely.
 */
export function isGorillaDriving(): boolean {
  return runtime.state !== 'floor' || runtime.motion.x !== 0 || runtime.motion.z !== 0
}

function resetRuntime(): void {
  runtime.state = 'floor'
  runtime.leftHand = emptyHand()
  runtime.rightHand = emptyHand()
  runtime.motion = { x: 0, y: 0, z: 0 }
  runtime.bodyPositionOverride = null
  runtime.wallNormal = null
}

/**
 * The driver React component. Mounts the fixed update, hands it the Rapier world through
 * a ref so a settings change doesn't tear it down and re-register.
 */
export function GorillaLocomotion() {
  const { world } = useRapier()
  const session = useXR((state) => state.session)
  const settings = useSettings()

  const enabled = session != null && settings.locomotion === 'gorilla'

  // Ref, not dependency. Settings and session change freely during play; the fixed-loop
  // system must keep running across those changes rather than re-registering on each one.
  const latest = useRef({ world, enabled, moveSpeed: settings.moveSpeed })
  latest.current = { world, enabled, moveSpeed: settings.moveSpeed }

  const scratch = useMemo(
    () => ({
      origin: new Vector3(),
      direction: new Vector3(),
      rotation: new Quaternion(),
      ray: new Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }),
    }),
    [],
  )

  useEffect(() => {
    if (enabled) return
    // Switching out of gorilla mode must not leave stale grip state hanging around for the
    // next mode to inherit. A `wall` bodyPositionOverride would silently teleport the
    // player the moment they switch to smooth.
    resetRuntime()
  }, [enabled])

  useFixedUpdate(() => {
    const { world: w, enabled: on } = latest.current
    if (!on) {
      resetRuntime()
      return
    }
    stepGorilla(w, latest.current.moveSpeed, scratch)
  }, SystemOrder.Player - 1, [])

  return null
}

// ---------------------------------------------------------------------------
// Per-step computation
// ---------------------------------------------------------------------------

interface StepScratch {
  origin: Vector3
  direction: Vector3
  rotation: Quaternion
  ray: Ray
}

function stepGorilla(world: World, moveSpeed: number, scratch: StepScratch): void {
  detectGrip(world, scratch)
  updateHandPositions()
  advanceStateMachine()
  emitMotion(moveSpeed)
}

/**
 * One short raycast per hand. Hits a collider whose parent rigid body has
 * `userData.grippable === true` → grip established.
 *
 * No button involved — real Gorilla Tag locomotion is pure hand-contact physics, not a
 * held button, so a hand only has to be touching a surface for it to count. The player's
 * own capsule is excluded so a hand raycast that happens to start inside the body does not
 * establish a phantom grip on the player.
 */
function detectGrip(world: World, scratch: StepScratch): void {
  for (const handedness of ['left', 'right'] as const) {
    const hand = handedness === 'left' ? runtime.leftHand : runtime.rightHand
    hand.isGripping = false
    hand.onWall = false
    hand.gripCollider = null

    const aim = handedness === 'left' ? xrHands.left : xrHands.right
    if (!aim) continue

    aim.getWorldPosition(scratch.origin)
    aim.getWorldQuaternion(scratch.rotation)
    scratch.direction.set(0, 0, -1).applyQuaternion(scratch.rotation)

    scratch.ray.origin = scratch.origin
    scratch.ray.dir = scratch.direction

    const hit = world.castRayAndGetNormal(
      scratch.ray,
      GRIP_RANGE,
      true,
      QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      playerCollider.current ?? undefined,
    )
    if (!hit) continue

    // The flag lives on the parent rigid body, not the collider — see Dungeon.tsx. Both the
    // wall body and the floor/ceiling body carry it now; everything solid in the dungeon is
    // touchable, and it's the normal below that tells floor-push apart from wall-climb.
    const userData = hit.collider.parent()?.userData as { grippable?: boolean } | undefined
    if (userData?.grippable !== true) continue

    hand.isGripping = true
    hand.onWall = Math.abs(hit.normal.y) < WALL_NORMAL_MAX_UP
    hand.gripCollider = hit.collider
    hand.gripNormal = { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z }
    hand.gripContactPoint = {
      x: scratch.origin.x + scratch.direction.x * hit.timeOfImpact,
      y: scratch.origin.y + scratch.direction.y * hit.timeOfImpact,
      z: scratch.origin.z + scratch.direction.z * hit.timeOfImpact,
    }
  }
}

/**
 * Promote `currentPosition` from last frame's `currentPosition` into `previousPosition`,
 * then read this frame's hand position into `currentPosition`.
 *
 * The previous/current pair is what `gorillaHandContribution` reads; one frame of lag is
 * exactly what we want, because the body should respond to the hand motion that *led* to
 * the current pose, not to the current pose itself.
 *
 * The first frame after a hand appears (re-connection, session start) seeds both
 * `previousPosition` and `currentPosition` to the same world point, so the first
 * displacement is zero — without this guard, a freshly-visible hand at world position P
 * would contribute `-(P - {0,0,0})` to the body, which is a long way to be flung by
 * "I just appeared".
 */
function updateHandPositions(): void {
  for (const handedness of ['left', 'right'] as const) {
    const hand = handedness === 'left' ? runtime.leftHand : runtime.rightHand
    const obj = handedness === 'left' ? xrHands.left : xrHands.right
    if (!obj) {
      // No tracked pose this step. Mark uninitialised so the next frame is treated as the
      // first frame again, and reset both positions so a stale value cannot leak through.
      hand.initialised = false
      hand.previousPosition = { x: 0, y: 0, z: 0 }
      hand.currentPosition = { x: 0, y: 0, z: 0 }
      continue
    }

    const v = _scratchVec
    obj.getWorldPosition(v)

    if (!hand.initialised) {
      // First frame after the hand reappears: seed both halves of the pair to the current
      // world point, so the first displacement is zero.
      hand.previousPosition = { x: v.x, y: v.y, z: v.z }
      hand.currentPosition = { x: v.x, y: v.y, z: v.z }
      hand.initialised = true
      continue
    }

    // Subsequent frames: previous takes last frame's current, current takes this frame.
    hand.previousPosition = hand.currentPosition
    hand.currentPosition = { x: v.x, y: v.y, z: v.z }
  }
}

const _scratchVec = new Vector3()

/**
 * State transitions. Designed around the rules:
 *
 *   floor → wall  when both hands grip the same collider, wall-side (not floor or ceiling)
 *   floor → air   when ground is lost
 *   wall  → air   when both wall-grips release (releasing one hand keeps `wall` — the body
 *                 hangs from the remaining hand)
 *   air   → wall  when any hand grips a wall mid-fall
 *   air   → floor when ground is regained
 *   wall  → floor is not a direct transition: releasing both hands drops to `air`, and
 *                 `air` immediately re-grounds if the floor was never really lost.
 *
 * Floor contact (hand touching the ground or ceiling) never promotes to `wall` — it drives
 * push-off motion in `emitMotion` instead, exactly like a wall grip does while climbing.
 */
function advanceStateMachine(): void {
  const leftWall = runtime.leftHand.isGripping && runtime.leftHand.onWall
  const rightWall = runtime.rightHand.isGripping && runtime.rightHand.onWall
  const bothWall = leftWall && rightWall
  const eitherWall = leftWall || rightWall
  const sameSurface =
    bothWall && runtime.leftHand.gripCollider === runtime.rightHand.gripCollider
  const grounded = playerState.grounded

  switch (runtime.state) {
    case 'floor':
      if (sameSurface) {
        runtime.state = 'wall'
      } else if (!grounded) {
        runtime.state = 'air'
      }
      break
    case 'wall':
      if (!eitherWall) {
        runtime.state = 'air'
        runtime.bodyPositionOverride = null
        runtime.wallNormal = null
      }
      break
    case 'air':
      if (grounded) {
        runtime.state = 'floor'
      } else if (eitherWall) {
        runtime.state = 'wall'
      }
      break
  }
}

/**
 * Produce `motion` (for `floor`) and `bodyPositionOverride` (for `wall`). Air produces
 * nothing: gravity is the rig's job, and the rig already runs it.
 */
function emitMotion(moveSpeed: number): void {
  runtime.motion = { x: 0, y: 0, z: 0 }
  runtime.bodyPositionOverride = null
  runtime.wallNormal = null

  if (runtime.state === 'wall') {
    runtime.wallNormal = bodyWallNormal()
    runtime.bodyPositionOverride = bodyOverrideFromHands()
    return
  }

  if (runtime.state === 'floor') {
    // Arm-swinging on the floor is pure hand-contact, no button — a hand touching the
    // ground or ceiling (`isGripping`, regardless of `onWall`) while it moves pushes the
    // body the other way, same as real Gorilla Tag locomotion. A hand touching a wall
    // contributes too: the state machine only promotes to `wall` once *both* hands are on
    // the same wall-side collider, so a single hand brushing a wall while the other still
    // pushes off the floor should keep walking, not do nothing.
    const either = runtime.leftHand.isGripping || runtime.rightHand.isGripping
    if (either) {
      // Both hands always contribute when they're touching something — even if one of them
      // just started this frame. `gorillaHandContribution` returns zero for an uninitialised
      // hand (current === previous), so a hand that just started touching contributes
      // nothing on the first frame, by construction.
      const left = gorillaHandContribution(
        runtime.leftHand.previousPosition,
        runtime.leftHand.currentPosition,
        runtime.leftHand.isGripping,
        TRANSFER_FACTOR,
      )
      const right = gorillaHandContribution(
        runtime.rightHand.previousPosition,
        runtime.rightHand.currentPosition,
        runtime.rightHand.isGripping,
        TRANSFER_FACTOR,
      )
      // Convert per-step displacement to m/s so the rig can multiply by its own dt and
      // stay consistent with the joystick fallback and the smooth-mode path. Hand motion
      // and joystick motion now agree about what "the body is moving at 3 m/s" means.
      runtime.motion.x = (left.x + right.x) / FIXED_STEP
      runtime.motion.z = (left.z + right.z) / FIXED_STEP
      return
    }

    // Joystick fallback: a player whose arms are at rest still walks with the stick. Same
    // speed, same deadzone, same head-relative direction as smooth mode — by reusing
    // `moveDirection`, not by re-deriving it.
    const stick = applyDeadzone(
      xrInput.left.thumbstick.x,
      xrInput.left.thumbstick.y,
      STICK_DEADZONE,
    )
    const dir = moveDirection(stick, playerState.yaw)
    runtime.motion.x = dir.x * moveSpeed
    runtime.motion.z = dir.y * moveSpeed
    return
  }

  // `air`: motion stays at zero. Gravity owns vertical; horizontal motion during a fall
  // is nothing, not reduced stick input.
}

/**
 * The wall normal driving the body offset. With two hands, the average of the two grip
 * normals (renormalised) — they almost always agree, but a corner where they don't should
 * not blow up. With one hand, that hand's normal unchanged.
 */
function bodyWallNormal(): Vec3 {
  const leftWall = runtime.leftHand.isGripping && runtime.leftHand.onWall
  const rightWall = runtime.rightHand.isGripping && runtime.rightHand.onWall
  if (!(leftWall && rightWall)) {
    const hand = leftWall ? runtime.leftHand : runtime.rightHand
    return hand.gripNormal
  }
  const n: Vec3 = {
    x: (runtime.leftHand.gripNormal.x + runtime.rightHand.gripNormal.x) / 2,
    y: (runtime.leftHand.gripNormal.y + runtime.rightHand.gripNormal.y) / 2,
    z: (runtime.leftHand.gripNormal.z + runtime.rightHand.gripNormal.z) / 2,
  }
  const length = Math.hypot(n.x, n.y, n.z)
  if (length === 0) return n
  return { x: n.x / length, y: n.y / length, z: n.z / length }
}

/**
 * Where the body sits this step. Two-handed climbing uses the midpoint solve; one-handed
 * hanging uses the gripping hand's position plus the body offset along the grip normal —
 * a slight asymmetry from a clean midpoint, but the only honest answer when one hand is
 * the only thing keeping the player aloft.
 */
function bodyOverrideFromHands(): Vec3 {
  const leftWall = runtime.leftHand.isGripping && runtime.leftHand.onWall
  const rightWall = runtime.rightHand.isGripping && runtime.rightHand.onWall
  const both = leftWall && rightWall
  const n = bodyWallNormal()
  if (!both) {
    const hand = leftWall ? runtime.leftHand : runtime.rightHand
    return {
      x: hand.currentPosition.x + n.x * BODY_OFFSET,
      y: hand.currentPosition.y + n.y * BODY_OFFSET,
      z: hand.currentPosition.z + n.z * BODY_OFFSET,
    }
  }
  return gorillaBodyFromHands(
    runtime.leftHand.currentPosition,
    runtime.rightHand.currentPosition,
    n,
    BODY_OFFSET,
  )
}