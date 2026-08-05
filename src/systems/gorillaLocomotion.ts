import { useEffect, useMemo, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { useRapier } from '@react-three/rapier'
import { useXR } from '@react-three/xr'
import { Ball, QueryFilterFlags, type Collider, type World } from '@dimforge/rapier3d-compat'
import { Matrix4, Vector3 } from 'three'
import { FIXED_STEP, SystemOrder } from '@/core/loop'
import { useFixedUpdate } from '@/core/simulation'
import { useSettings } from '@/systems/settings'
import {
  applyDeadzone,
  clampArmReach,
  combineHandMovement,
  gorillaHandOffset,
  moveDirection,
  DEFAULT_VERTICAL,
  type Vec3,
} from '@/systems/locomotion'
import { playerCollider, playerState } from '@/systems/player'
import { xrInput } from '@/systems/xrInput'
import { xrHands } from '@/systems/xrHands'

/**
 * Gorilla Tag-style locomotion, as a third opt-in mode.
 *
 * A port of Another Axiom's reference implementation
 * (https://github.com/Another-Axiom/GorillaLocomotion, `Player.cs`), which is one loop with
 * no states in it at all: each hand sweeps a small sphere through the world, a hand that
 * hits something sticks to the point it hit, and the body moves by however far the hand has
 * since strayed from that stuck point, inverted. Walking, climbing, vaulting and hanging all
 * fall out of that one rule — there is no "am I on a wall" branch here, and the earlier
 * version's `floor`/`wall`/`air` state machine is gone because it was re-deriving, badly,
 * what the anchor already encodes.
 *
 * The module owns its own per-hand anchors and its own velocity. `xrInput` stays focused on
 * buttons, `xrHands` stays focused on poses, and the rig is handed a finished per-step
 * displacement to resolve against the world.
 *
 * Registered at `SystemOrder.Player - 1`, the same slot `TeleportAim` uses, so the rig reads
 * a freshly computed value on the same step the module writes it.
 */

/**
 * Radius of the sphere each hand sweeps. `minimumRaycastDistance` in the reference.
 *
 * This is a *sweep*, not a ray along the controller's forward axis. Which way the controller
 * points has nothing to do with whether your hand is touching the floor beside you, and
 * making it matter is what made the previous version impossible to move in.
 */
export const HAND_RADIUS = 0.05

/**
 * How far a hand may sit from the head before it is clamped back onto the end of the arm.
 * The reference's `maxArmLength`.
 */
export const MAX_ARM_LENGTH = 1.5

/**
 * How far a stuck hand may stray from its anchor before the anchor is released, provided
 * there is nothing solid between the head and the hand. The reference's `unStickDistance`.
 *
 * Without it a hand that anchors just inside a wall stays welded there and the body is
 * dragged back to it every step — you get stuck to the level and cannot walk away.
 */
export const UNSTICK_DISTANCE = 1

/**
 * Momentum released when the hands let go, from the reference's inspector defaults.
 *
 * Below `VELOCITY_LIMIT` the body simply stops when contact ends — otherwise every small
 * hand adjustment while standing still would fling you. Above it, the recent average body
 * velocity is handed to the airborne integrator, scaled and capped.
 */
export const VELOCITY_LIMIT = 0.4
export const MAX_JUMP_SPEED = 6.5
export const JUMP_MULTIPLIER = 1.1

/**
 * How many steps of body velocity are averaged for the release above. The reference samples
 * roughly a tenth of a second; at a fixed 60Hz that is six.
 */
const VELOCITY_HISTORY_SIZE = 6

/** Downward speed kept while standing, so the character controller keeps reporting ground.
 *  Matched to `integrateVertical`'s value — see `reportGorillaResolved`. */
const GROUNDED_PROBE_SPEED = -1

/**
 * Shrink factor applied to the swept sphere, the reference's `defaultPrecision`. Keeps the
 * sweep from immediately re-hitting the surface it is already resting against.
 */
const PRECISION = 0.995

/**
 * How much a contact is allowed to slide along the surface, the reference's
 * `defaultSlideFactor`. Two hands braced on one wall do not stick 100% — without the slide,
 * pushing along a surface locks solid the moment both hands are down. A single hand slides
 * essentially not at all, which is what makes a one-handed climbing hold feel like a hold.
 */
const SLIDE_FACTOR_TWO_HANDED = 0.03
const SLIDE_FACTOR_ONE_HANDED = 0.001

/** Deadzone used for the joystick fallback while no hand is in contact. Matched to the
 *  smooth-mode value in PlayerRig so the two paths feel identical. */
const STICK_DEADZONE = 0.15

interface PerHandState {
  /**
   * World point this hand is stuck to. While the hand is touching, this is a fixed point on
   * the surface and the body moves to keep the hand near it; while it is free, it just
   * trails the hand. The reference's `lastLeftHandPosition`.
   */
  anchor: Vec3
  /** Whether the hand was in contact at the end of the previous step. Decides whether this
   *  step measures from the established anchor or from the fresh contact point. */
  wasTouching: boolean
  /** True once a pose has been observed, so the anchor is a real world point rather than
   *  the origin. A hand that has never been seen must not drag the body towards {0,0,0}. */
  initialised: boolean
}

interface GorillaRuntime {
  leftHand: PerHandState
  rightHand: PerHandState
  /** Body displacement for this step, in metres, all three axes. The rig resolves it
   *  against the world; this module has no opinion about what it collides with. */
  displacement: Vec3
  /** True when at least one hand was in contact this step. The rig uses it for the comfort
   *  vignette and to know the player is not in free fall. */
  touching: boolean
  /** Airborne velocity: gravity plus whatever momentum the hands released. Zeroed on
   *  contact, same as the reference zeroing the rigid body's velocity. */
  velocity: Vec3
  /** Ring buffer of recent body velocities, for the release above. */
  velocityHistory: Vec3[]
  velocityIndex: number
}

function emptyHand(): PerHandState {
  return {
    anchor: { x: 0, y: 0, z: 0 },
    wasTouching: false,
    initialised: false,
  }
}

/**
 * Module singleton. Same reasoning as `Teleport`'s runtime and `xrInput`: the rig reads
 * this from inside the fixed loop where hooks don't exist. Stable identity — mutated in
 * place, never reassigned.
 */
const runtime: GorillaRuntime = {
  leftHand: emptyHand(),
  rightHand: emptyHand(),
  displacement: { x: 0, y: 0, z: 0 },
  touching: false,
  velocity: { x: 0, y: 0, z: 0 },
  velocityHistory: Array.from({ length: VELOCITY_HISTORY_SIZE }, () => ({ x: 0, y: 0, z: 0 })),
  velocityIndex: 0,
}

export interface GorillaMotion {
  /** Per-step body displacement in metres, for the rig to resolve. */
  displacement: Vec3
  /** True while at least one hand is on a surface. */
  touching: boolean
}

/**
 * Take the gorilla module's last computed displacement.
 *
 * Reads, does not clear — the gorilla module overwrites it every step and the rig reads it
 * exactly once. Mirrors `consumeTeleport`'s no-clear contract where the module owns the
 * lifetime.
 */
export function consumeGorillaMotion(): GorillaMotion {
  return { displacement: runtime.displacement, touching: runtime.touching }
}

/**
 * Tell the module the world refused some of the movement it asked for — the rig calls this
 * with the resolved displacement after the character controller has had its say.
 *
 * Without it, walking into a wall keeps accumulating downward velocity against the floor and
 * a blocked climb keeps its upward momentum, so letting go pops the player through the
 * ceiling. The reference gets this for free from Unity's rigid body; we are kinematic, so
 * the correction has to come back explicitly.
 */
export function reportGorillaResolved(resolved: Vec3, grounded: boolean): void {
  // Pinned to a small negative rather than zero, for the same reason `integrateVertical`
  // does it: the character controller detects ground by trying to move into it, so a body
  // with exactly zero downward velocity oscillates between grounded and airborne on flat
  // floor. Reusing the value the smooth path already proved rather than picking a new one.
  if (grounded && runtime.velocity.y < 0) runtime.velocity.y = GROUNDED_PROBE_SPEED
  // Blocked on the way up is a ceiling: drop the upward component rather than pinning the
  // player against it for the rest of the arc.
  if (runtime.velocity.y > 0 && resolved.y < runtime.displacement.y - 1e-4) {
    runtime.velocity.y = 0
  }
}

/**
 * Clear every anchor and all momentum.
 *
 * Exported for `gorillaLocomotion.contact.test.ts`, which drives `stepGorilla` directly
 * against a real Rapier world — the module keeps its state in a singleton, so a test that
 * cannot reset it can only ever assert about the first scenario it runs.
 */
export function resetGorillaRuntime(): void {
  // Mutated in place, never reassigned. The disabled path calls this on *every* fixed step —
  // which is every step of every desktop session and of any VR session not in gorilla mode —
  // so allocating a pair of hand objects here would be a steady drip of garbage for a mode
  // that is switched off. The fixed loop does not allocate; see `CharacterController`.
  clearHand(runtime.leftHand)
  clearHand(runtime.rightHand)
  setZero(runtime.displacement)
  setZero(runtime.velocity)
  runtime.touching = false
  for (const v of runtime.velocityHistory) setZero(v)
  runtime.velocityIndex = 0
}

function clearHand(hand: PerHandState): void {
  setZero(hand.anchor)
  hand.wasTouching = false
  hand.initialised = false
}

function setZero(v: Vec3): void {
  v.x = 0
  v.y = 0
  v.z = 0
}

/**
 * The driver React component. Mounts the fixed update, hands it the Rapier world through
 * a ref so a settings change doesn't tear it down and re-register.
 */
export function GorillaLocomotion() {
  const { world } = useRapier()
  const gl = useThree((state) => state.gl)
  const camera = useThree((state) => state.camera)
  const session = useXR((state) => state.session)
  const settings = useSettings()

  const enabled = session != null && settings.locomotion === 'gorilla'

  // Ref, not dependency. Settings and session change freely during play; the fixed-loop
  // system must keep running across those changes rather than re-registering on each one.
  const latest = useRef({ world, enabled, moveSpeed: settings.moveSpeed, gl, camera })
  latest.current = { world, enabled, moveSpeed: settings.moveSpeed, gl, camera }

  const scratch = useMemo(() => createGorillaScratch(), [])

  useEffect(() => {
    if (enabled) return
    // Switching out of gorilla mode must not leave stale anchors hanging around for the next
    // mode to inherit — a live anchor would drag the player the moment they switch back.
    resetGorillaRuntime()
  }, [enabled])

  useFixedUpdate(
    () => {
      const { world: w, enabled: on, moveSpeed, gl: renderer, camera: cam } = latest.current
      if (!on) {
        resetGorillaRuntime()
        return
      }
      readHeadPosition(renderer, cam, scratch)
      stepGorilla(w, moveSpeed, scratch)
    },
    SystemOrder.Player - 1,
    [],
  )

  return null
}

// ---------------------------------------------------------------------------
// Per-step computation
// ---------------------------------------------------------------------------

/**
 * Per-step working memory. Allocated once and reused, because the fixed loop is not allowed
 * to allocate — see `CharacterController` in PlayerRig.
 *
 * Exported, along with `createGorillaScratch` and `stepGorilla`, so the contact test can
 * drive a step directly against a Rapier world. `head` is a plain field rather than
 * something read from the renderer, which is what makes that test possible without a
 * headset: the caller says where the head is.
 */
export interface GorillaScratch {
  headMatrix: Matrix4
  head: Vec3
  handPosition: Vector3
  ball: Ball
  /** The reference's sanity-check sphere: smaller, so it can be swept further to catch a
   *  surface the full-size sweep was already resting against. See `sweepHand`. */
  smallBall: Ball
  identity: { x: number; y: number; z: number; w: number }
}

export function createGorillaScratch(): GorillaScratch {
  return {
    headMatrix: new Matrix4(),
    head: { x: 0, y: 0, z: 0 },
    handPosition: new Vector3(),
    ball: new Ball(HAND_RADIUS * PRECISION),
    smallBall: new Ball(HAND_RADIUS * PRECISION * 0.66),
    identity: { x: 0, y: 0, z: 0, w: 1 },
  }
}

interface HeadSource {
  xr: { isPresenting: boolean; getCamera: () => { matrixWorld: Matrix4 } }
}

/**
 * Where the player's head is, in world space. Inside a session that is the XR camera, which
 * is the only pose that tracks the actual head; `state.camera` is not updated while
 * presenting. Same read the rig does — see `readHead` in PlayerRig.
 */
function readHeadPosition(
  gl: HeadSource,
  fallback: { matrixWorld: Matrix4 },
  scratch: GorillaScratch,
): void {
  const head = gl.xr.isPresenting ? gl.xr.getCamera() : fallback
  scratch.headMatrix.copy(head.matrixWorld)
  const e = scratch.headMatrix.elements
  scratch.head.x = e[12] ?? 0
  scratch.head.y = e[13] ?? 0
  scratch.head.z = e[14] ?? 0
}

/** A contact: where the swept sphere came to rest, and the surface it rested against. */
interface Contact {
  position: Vec3
  /**
   * The axis of the contact — perpendicular to the surface, but *unsigned*. Rapier's
   * `normal2` points from the sweeping sphere into the surface, the opposite of the
   * outward normal you would expect; the only thing this is used for is projecting the
   * slide onto the contact plane, and `v - n(v·n)` gives the same answer either way. Naming
   * it `normal` would be an invitation to use it for something where the sign matters.
   */
  contactAxis: Vec3
  collider: Collider
}

export function stepGorilla(world: World, moveSpeed: number, scratch: GorillaScratch): void {
  const dt = FIXED_STEP
  const left = handPositions('left', scratch)
  const right = handPositions('right', scratch)

  // --- First pass: has each hand made or kept contact, and what does it want the body to do?
  //
  // The downward nudge is in the reference and is load-bearing: it is what lets a hand
  // resting flat on the floor keep registering. Without it a still hand sweeps a zero-length
  // path, finds nothing, and lets go of the ground it is plainly touching.
  const gravityNudge = 2 * Math.abs(DEFAULT_VERTICAL.gravity) * dt * dt

  const leftContact = left
    ? sweepHand(world, runtime.leftHand.anchor, travel(runtime.leftHand.anchor, left, gravityNudge), true, scratch)
    : null
  const rightContact = right
    ? sweepHand(world, runtime.rightHand.anchor, travel(runtime.rightHand.anchor, right, gravityNudge), true, scratch)
    : null

  const leftOffset =
    left && leftContact
      ? gorillaHandOffset(runtime.leftHand.anchor, left, leftContact.position, runtime.leftHand.wasTouching)
      : ZERO
  const rightOffset =
    right && rightContact
      ? gorillaHandOffset(runtime.rightHand.anchor, right, rightContact.position, runtime.rightHand.wasTouching)
      : ZERO

  let leftTouching = leftContact != null
  let rightTouching = rightContact != null

  if (leftTouching || rightTouching) {
    runtime.velocity.x = 0
    runtime.velocity.y = 0
    runtime.velocity.z = 0
  }

  // A hand that *was* touching still counts towards the average even on a step where the
  // sweep missed, so a single dropped frame of tracking doesn't double the body's movement.
  const leftEngaged = leftTouching || runtime.leftHand.wasTouching
  const rightEngaged = rightTouching || runtime.rightHand.wasTouching
  const movement = combineHandMovement(leftOffset, rightOffset, leftEngaged && rightEngaged)

  // --- Airborne: gravity and released momentum.
  if (!leftTouching && !rightTouching) {
    runtime.velocity.y = Math.max(
      DEFAULT_VERTICAL.terminalVelocity,
      runtime.velocity.y + DEFAULT_VERTICAL.gravity * dt,
    )
    movement.x += runtime.velocity.x * dt
    movement.y += runtime.velocity.y * dt
    movement.z += runtime.velocity.z * dt

    // Joystick fallback: a player whose arms are at rest still walks with the stick. Same
    // speed, same deadzone, same head-relative direction as smooth mode — by reusing
    // `moveDirection`, not by re-deriving it. Only while no hand is on a surface, so it can
    // never fight the hands for control of the body.
    const stick = applyDeadzone(xrInput.left.thumbstick.x, xrInput.left.thumbstick.y, STICK_DEADZONE)
    const dir = moveDirection(stick, playerState.yaw)
    movement.x += dir.x * moveSpeed * dt
    movement.z += dir.y * moveSpeed * dt
  }

  // --- Second pass: re-anchor each hand.
  //
  // The hands are children of the rig, so in the reference they have already been carried
  // along by the movement applied a few lines above. Our rig moves later in the step and
  // three.js won't rebuild the matrices until the next render, so the movement is added here
  // by hand. Skipping this is what would make the body accelerate away: the anchor would be
  // short by exactly the distance just travelled, every single step.
  const leftAfter = left ? add(left, movement) : null
  const rightAfter = right ? add(right, movement) : null
  const bothEngaged = leftEngaged && rightEngaged

  if (leftAfter) {
    const contact = sweepHand(world, runtime.leftHand.anchor, sub(leftAfter, runtime.leftHand.anchor), !bothEngaged, scratch)
    if (contact) {
      runtime.leftHand.anchor = contact.position
      leftTouching = true
    } else {
      runtime.leftHand.anchor = leftAfter
    }
  }
  if (rightAfter) {
    const contact = sweepHand(world, runtime.rightHand.anchor, sub(rightAfter, runtime.rightHand.anchor), !bothEngaged, scratch)
    if (contact) {
      runtime.rightHand.anchor = contact.position
      rightTouching = true
    } else {
      runtime.rightHand.anchor = rightAfter
    }
  }

  // --- Momentum to release on let-go.
  storeVelocity(movement, dt)
  if (leftTouching || rightTouching) {
    const avg = averageVelocity()
    const speed = Math.hypot(avg.x, avg.y, avg.z)
    if (speed > VELOCITY_LIMIT) {
      const scale = speed * JUMP_MULTIPLIER > MAX_JUMP_SPEED ? MAX_JUMP_SPEED / speed : JUMP_MULTIPLIER
      runtime.velocity.x = avg.x * scale
      runtime.velocity.y = avg.y * scale
      runtime.velocity.z = avg.z * scale
    }
  }

  // --- Unstick a hand that has been dragged too far from its anchor with clear air between
  // it and the head. A hand still behind geometry is genuinely holding on; one out in the
  // open has been left behind and must let go or the body is tethered to it forever.
  const headAfter = add(scratch.head, movement)
  if (leftTouching && leftAfter && shouldUnstick(world, headAfter, leftAfter, runtime.leftHand.anchor, scratch)) {
    runtime.leftHand.anchor = leftAfter
    leftTouching = false
  }
  if (rightTouching && rightAfter && shouldUnstick(world, headAfter, rightAfter, runtime.rightHand.anchor, scratch)) {
    runtime.rightHand.anchor = rightAfter
    rightTouching = false
  }

  runtime.leftHand.wasTouching = leftTouching
  runtime.rightHand.wasTouching = rightTouching
  runtime.touching = leftTouching || rightTouching
  runtime.displacement = movement
}

const ZERO: Vec3 = { x: 0, y: 0, z: 0 }

/**
 * This step's hand position, clamped to arm's reach, or `null` when the hand isn't tracked.
 *
 * The first time a hand is seen its anchor is seeded to that same point, so the first step
 * contributes a zero offset. Without the guard a freshly-visible hand at world point P would
 * pull the body by `-(P - {0,0,0})`, which is a long way to be flung by "I just appeared".
 */
function handPositions(handedness: 'left' | 'right', scratch: GorillaScratch): Vec3 | null {
  const hand = handedness === 'left' ? runtime.leftHand : runtime.rightHand
  const obj = handedness === 'left' ? xrHands.left : xrHands.right
  if (!obj) {
    hand.initialised = false
    hand.wasTouching = false
    return null
  }

  obj.getWorldPosition(scratch.handPosition)
  const raw: Vec3 = {
    x: scratch.handPosition.x,
    y: scratch.handPosition.y,
    z: scratch.handPosition.z,
  }
  const clamped = clampArmReach(raw, scratch.head, MAX_ARM_LENGTH)

  if (!hand.initialised) {
    hand.anchor = clamped
    hand.wasTouching = false
    hand.initialised = true
  }
  return clamped
}

/** The path a hand wants to sweep this step, plus the reference's downward nudge. */
function travel(anchor: Vec3, current: Vec3, downward: number): Vec3 {
  return {
    x: current.x - anchor.x,
    y: current.y - anchor.y - downward,
    z: current.z - anchor.z,
  }
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

/**
 * Sweep the hand sphere from `from` along `movement`, then let it slide a little along
 * whatever it hit. The reference's `IterativeCollisionSphereCast`.
 *
 * The slide is the second half of the behaviour, not a refinement: a contact that sticks
 * perfectly means the instant both hands are down on a wall the body is welded in place, and
 * pushing along a surface does nothing. Sliding a few per cent of the residual motion along
 * the contact plane is what turns that weld into a grip you can shift.
 */
function sweepHand(
  world: World,
  from: Vec3,
  movement: Vec3,
  singleHand: boolean,
  scratch: GorillaScratch,
): Contact | null {
  const first = sphereCast(world, from, movement, scratch, scratch.ball)
  if (!first) {
    // The reference's sanity-check cast: "this accounts for times when the original
    // spherecast was already touching a surface so it didn't trigger correctly". A smaller
    // sphere swept slightly further reaches a surface the full-size sweep was already
    // resting flush against.
    //
    // It only rescues movement with a component *into* the surface. A sweep exactly parallel
    // to a wall, at exactly the resting gap, still misses — extending a tangential sweep
    // never brings it any closer. That case does not arise from a real hand, which presses
    // into what it is holding and is never perfectly parallel two steps running, but it is
    // worth knowing the limit is there rather than assuming this covers everything.
    const reach = Math.hypot(movement.x, movement.y, movement.z)
    if (reach === 0) return null
    const extended = reach + HAND_RADIUS * PRECISION * 0.34
    const grazing = sphereCast(
      world,
      from,
      {
        x: (movement.x / reach) * extended,
        y: (movement.y / reach) * extended,
        z: (movement.z / reach) * extended,
      },
      scratch,
      scratch.smallBall,
    )
    // The hand stays exactly where it was: it never actually travelled, it was already
    // touching. Returning the swept position instead would push it into the surface.
    if (grazing) return { position: from, contactAxis: grazing.contactAxis, collider: grazing.collider }
    return null
  }

  const slip = singleHand ? SLIDE_FACTOR_ONE_HANDED : SLIDE_FACTOR_TWO_HANDED
  // The part of the requested motion the surface refused, projected onto the contact plane
  // so the slide runs along the wall rather than into it.
  const residual = sub(add(from, movement), first.position)
  const along = projectOnPlane(residual, first.contactAxis)
  const slide = { x: along.x * slip, y: along.y * slip, z: along.z * slip }

  const second = sphereCast(world, first.position, slide, scratch, scratch.ball)
  if (second) return second

  // Nothing in the way of the slide: creep back towards the point the hand actually asked
  // for, to undo the push-off-the-surface the first sweep's radius introduced.
  const slid = add(first.position, slide)
  const third = sphereCast(world, slid, sub(add(from, movement), slid), scratch, scratch.ball)
  if (third) return third

  return { position: slid, contactAxis: first.contactAxis, collider: first.collider }
}

/**
 * One sphere sweep against grippable geometry.
 *
 * `stopAtPenetration` is on so a sphere that starts already inside a surface reports a
 * time-of-impact of zero and stays put, rather than reporting nothing and letting the hand
 * fall through. The resting position is the swept centre at impact, which is already a
 * radius clear of the surface — no need to reconstruct it from the contact point.
 */
function sphereCast(
  world: World,
  from: Vec3,
  movement: Vec3,
  scratch: GorillaScratch,
  ball: Ball,
): Contact | null {
  const distance = Math.hypot(movement.x, movement.y, movement.z)
  if (distance === 0) return null

  const hit = world.castShape(
    from,
    scratch.identity,
    movement,
    ball,
    0,
    1,
    true,
    QueryFilterFlags.EXCLUDE_SENSORS,
    undefined,
    playerCollider.current ?? undefined,
    undefined,
    isGrippable,
  )
  if (!hit) return null

  const toi = hit.time_of_impact
  return {
    position: {
      x: from.x + movement.x * toi,
      y: from.y + movement.y * toi,
      z: from.z + movement.z * toi,
    },
    // A degenerate axis — a sweep starting in deep penetration reports one — would send the
    // slide off in an arbitrary direction. Falling back to the movement axis means the slide
    // projects to nothing, which is the safe answer.
    contactAxis: normalise(hit.normal2) ?? normalise(movement) ?? UP,
    collider: hit.collider,
  }
}

const UP: Vec3 = { x: 0, y: 1, z: 0 }

/**
 * Which colliders the hands can hold onto. The reference's `locomotionEnabledLayers`.
 *
 * A predicate rather than a check on the hit, so non-grippable geometry — props, enemies,
 * triggers — doesn't stop the sweep short of the wall behind it. The flag lives on the
 * parent rigid body, not the collider; see Dungeon.tsx.
 */
function isGrippable(collider: Collider): boolean {
  const userData = collider.parent()?.userData as { grippable?: boolean } | undefined
  return userData?.grippable === true
}

/**
 * Whether a stuck hand should let go: it has strayed further than `UNSTICK_DISTANCE` from
 * its anchor, and there is nothing solid between the head and the hand to justify the hold.
 */
function shouldUnstick(
  world: World,
  head: Vec3,
  hand: Vec3,
  anchor: Vec3,
  scratch: GorillaScratch,
): boolean {
  const strayed = Math.hypot(hand.x - anchor.x, hand.y - anchor.y, hand.z - anchor.z)
  if (strayed <= UNSTICK_DISTANCE) return false
  const toHand = sub(hand, head)
  const reach = Math.hypot(toHand.x, toHand.y, toHand.z)
  if (reach <= HAND_RADIUS) return true
  // Shortened by the sphere radius so the wall the hand is legitimately pressed against
  // doesn't itself count as "something in the way".
  const scale = (reach - HAND_RADIUS) / reach
  const blocked = sphereCast(
    world,
    head,
    { x: toHand.x * scale, y: toHand.y * scale, z: toHand.z * scale },
    scratch,
    scratch.ball,
  )
  return blocked == null
}

function projectOnPlane(v: Vec3, normal: Vec3): Vec3 {
  const d = v.x * normal.x + v.y * normal.y + v.z * normal.z
  return {
    x: v.x - normal.x * d,
    y: v.y - normal.y * d,
    z: v.z - normal.z * d,
  }
}

function normalise(v: Vec3): Vec3 | null {
  const length = Math.hypot(v.x, v.y, v.z)
  if (length < 1e-6) return null
  return { x: v.x / length, y: v.y / length, z: v.z / length }
}

/** Ring buffer of body velocity, so a release throws you at the speed you were moving at
 *  rather than at whatever the final step happened to measure. */
function storeVelocity(movement: Vec3, dt: number): void {
  runtime.velocityIndex = (runtime.velocityIndex + 1) % VELOCITY_HISTORY_SIZE
  const slot = runtime.velocityHistory[runtime.velocityIndex]
  if (!slot) return
  slot.x = movement.x / dt
  slot.y = movement.y / dt
  slot.z = movement.z / dt
}

function averageVelocity(): Vec3 {
  let x = 0
  let y = 0
  let z = 0
  for (const v of runtime.velocityHistory) {
    x += v.x
    y += v.y
    z += v.z
  }
  const n = VELOCITY_HISTORY_SIZE
  return { x: x / n, y: y / n, z: z / n }
}
