/**
 * Locomotion maths, kept free of three.js and Rapier so it can be unit-tested.
 *
 * Everything here is pure: given the same inputs it returns the same outputs, and nothing
 * touches a scene graph or a physics world. That matters more than usual for this sprint —
 * the failure modes of VR movement (a snap turn that fires twice, a stick that drifts, an
 * arc that lands inside a wall) are miserable to diagnose with a headset on, and every one
 * of them is reproducible at this layer in milliseconds.
 */

export interface Vec2 {
  x: number
  y: number
}

export interface Vec3 {
  x: number
  y: number
  z: number
}

/**
 * Radial deadzone with rescaling.
 *
 * A plain threshold makes the stick jump from standstill to 20% speed the instant it
 * crosses the line. Rescaling the remaining range back to 0..1 means movement always
 * starts from zero, so a slow creep down a corridor is actually possible — which is what
 * you want when something is breathing behind you.
 *
 * Radial rather than per-axis, or the diagonals would be allowed a larger magnitude than
 * the cardinals and the character would move faster on the diagonal.
 */
export function applyDeadzone(x: number, y: number, deadzone: number): Vec2 {
  const magnitude = Math.hypot(x, y)
  if (magnitude <= deadzone) return { x: 0, y: 0 }

  // Clamp to the unit circle: hardware routinely reports a little over 1 at full deflection.
  const scaled = Math.min(1, (magnitude - deadzone) / (1 - deadzone))
  return { x: (x / magnitude) * scaled, y: (y / magnitude) * scaled }
}

/**
 * Rotate a stick reading into world-space horizontal movement.
 *
 * `stick.y` follows the WebXR convention where +Y is *back*, so pushing the stick forward
 * has to come out as -Z. `yaw` is the direction the player is facing — in VR that is the
 * headset's yaw, which is what makes the movement head-relative: you go where you look.
 */
export function moveDirection(stick: Vec2, yaw: number): Vec2 {
  const sin = Math.sin(yaw)
  const cos = Math.cos(yaw)
  // In the XZ plane, facing is (-sin, -cos) and right is (cos, -sin). The stick's forward
  // is -y, so the facing contribution is scaled by -stick.y — which cancels back to +y here.
  return {
    x: stick.x * cos + stick.y * sin,
    y: -stick.x * sin + stick.y * cos,
  }
}

/**
 * The yaw a head or controller is facing, from its orientation basis.
 *
 * `forward` and `up` are the -Z and +Y columns of the object's world matrix.
 *
 * Blending the two is what makes this usable for a *head*. Steep pitch collapses forward
 * onto the Y axis, leaving almost nothing in the XZ plane to take a heading from — and
 * worse, once the head tilts past vertical the little that remains points *backwards*, so
 * "walk forward" silently becomes "walk backward" the moment a player leans their head
 * back to look at the ceiling. Where forward runs out of horizontal length, up has plenty,
 * and it leans opposite the way the face is pointing.
 *
 * A hard threshold between the two can't work: past vertical the forward vector is still
 * long enough horizontally to pass any threshold worth setting, while already pointing the
 * wrong way. Weighting them by pitch instead is continuous everywhere and never degenerate
 * — the two contributions are at their longest exactly where the other is shortest.
 */
export function headingFromBasis(forward: Vec3, up: Vec3): number {
  const f = normalise(forward)
  const u = normalise(up)

  // 0 looking at the horizon, 1 looking straight up or down.
  const pitchAmount = Math.abs(f.y)
  const upSign = f.y < 0 ? 1 : -1

  const x = f.x * (1 - pitchAmount) + u.x * pitchAmount * upSign
  const z = f.z * (1 - pitchAmount) + u.z * pitchAmount * upSign

  if (x === 0 && z === 0) return 0
  return Math.atan2(-x, -z)
}

function normalise(v: Vec3): Vec3 {
  const length = Math.hypot(v.x, v.y, v.z)
  if (length === 0) return { x: 0, y: 0, z: 0 }
  return { x: v.x / length, y: v.y / length, z: v.z / length }
}

/** Engage above this stick deflection, and re-arm only below `SNAP_TURN_RELEASE`. */
export const SNAP_TURN_ENGAGE = 0.7
export const SNAP_TURN_RELEASE = 0.35

export interface TurnLatch {
  /** False while the stick is still held past the engage threshold from a previous turn. */
  armed: boolean
}

export function createTurnLatch(): TurnLatch {
  return { armed: true }
}

/**
 * One snap turn per stick flick.
 *
 * The latch is the whole point. Without it, holding the stick right spins the player at
 * sixty snaps a second — which is not a bug you want to discover while wearing a headset.
 * The release threshold sits well below the engage threshold so a slightly noisy stick
 * resting near the boundary can't chatter between the two.
 *
 * Returns the yaw delta in radians (positive is a left turn, matching a right-handed
 * Y-up coordinate system), or 0.
 */
export function snapTurn(latch: TurnLatch, stickX: number, stepRadians: number): number {
  const magnitude = Math.abs(stickX)

  if (magnitude < SNAP_TURN_RELEASE) {
    latch.armed = true
    return 0
  }
  if (magnitude < SNAP_TURN_ENGAGE || !latch.armed) return 0

  latch.armed = false
  // Pushing the stick right (+x) should turn the player right, which is a *negative* yaw.
  return stickX > 0 ? -stepRadians : stepRadians
}

/** Continuous turning, for players who prefer it. Same sign convention as `snapTurn`. */
export function smoothTurn(stickX: number, radiansPerSecond: number, dt: number): number {
  return -stickX * radiansPerSecond * dt
}

export interface VerticalState {
  velocity: number
}

export interface VerticalConfig {
  gravity: number
  jumpSpeed: number
  /** Downward speed cap, so a long fall can't tunnel through the floor in one step. */
  terminalVelocity: number
}

export const DEFAULT_VERTICAL: VerticalConfig = {
  gravity: -22,
  // Fast enough to clear the 0.4m ledges in the greybox, slow enough that it doesn't read
  // as floaty. Deliberately heavier than real gravity — dungeon crawling, not moon walking.
  jumpSpeed: 5.2,
  terminalVelocity: -40,
}

/**
 * Integrate vertical velocity and return the vertical displacement for this step.
 *
 * Grounded velocity is pinned to a small negative rather than zero: the character
 * controller detects ground by attempting to move into it, so a character with exactly
 * zero downward velocity oscillates between grounded and airborne on flat floor.
 */
export function integrateVertical(
  state: VerticalState,
  grounded: boolean,
  jumpRequested: boolean,
  dt: number,
  config: VerticalConfig = DEFAULT_VERTICAL,
): number {
  if (grounded && state.velocity <= 0) {
    state.velocity = jumpRequested ? config.jumpSpeed : -1
  } else {
    state.velocity = Math.max(
      config.terminalVelocity,
      state.velocity + config.gravity * dt,
    )
  }
  return state.velocity * dt
}

/**
 * How strong the comfort vignette should be right now, before smoothing.
 *
 * Vection — the illusion of self-motion from a moving visual field — is what causes VR
 * nausea, and it is worst in the periphery. Narrowing the field of view while the player
 * is being moved by something other than their own legs removes most of it. It is applied
 * while moving *and* while smooth-turning, because rotation is the more nauseating of the
 * two by a wide margin.
 *
 * `strength` is the player's setting: 0 disables the vignette entirely.
 */
export function vignetteTarget(
  speed: number,
  maxSpeed: number,
  turning: boolean,
  strength: number,
): number {
  if (strength <= 0) return 0
  const fromSpeed = maxSpeed > 0 ? Math.min(1, speed / maxSpeed) : 0
  return Math.min(1, Math.max(fromSpeed, turning ? 1 : 0)) * strength
}

/**
 * Rotate a horizontal vector about the Y axis.
 *
 * Matches three's `Rotation.makeRotationY`, so a positive angle takes a world-space vector
 * into a frame yawed by that angle and a negative one brings it back. Used to convert the
 * room-scale recentring offset between world space and the player rig's rotated space —
 * getting that sign backwards drifts the play space sideways every time you turn, which is
 * an unpleasant thing to debug in a headset.
 */
export function rotateY(x: number, z: number, angle: number): Vec2 {
  const sin = Math.sin(angle)
  const cos = Math.cos(angle)
  return { x: x * cos + z * sin, y: -x * sin + z * cos }
}

/**
 * How much of the comfort vignette a blocked head deserves.
 *
 * When the player physically walks their head into a wall, the capsule stops and the head
 * does not — there is no way to prevent that without moving the camera, which the comfort
 * rule forbids outright. The honest response is to black out the view rather than let
 * someone see through the level, which is standard practice and reads as "you can't go that
 * way" rather than as a glitch.
 *
 * Ramped rather than binary so that brushing a wall dims slightly instead of slamming to
 * black — the capsule sits 2cm off every surface it touches by design.
 */
export const HEAD_BLOCK_START = 0.06
export const HEAD_BLOCK_FULL = 0.25

export function headBlockAmount(overshoot: number): number {
  if (overshoot <= HEAD_BLOCK_START) return 0
  if (overshoot >= HEAD_BLOCK_FULL) return 1
  return (overshoot - HEAD_BLOCK_START) / (HEAD_BLOCK_FULL - HEAD_BLOCK_START)
}

/**
 * Frame-rate-independent exponential smoothing towards a target.
 *
 * `halfLife` is the time in seconds to close half the remaining distance, which stays
 * meaningful at any step rate — unlike a raw lerp factor, which silently changes behaviour
 * between 60Hz and 120Hz.
 */
export function damp(current: number, target: number, halfLife: number, dt: number): number {
  if (halfLife <= 0) return target
  return target + (current - target) * Math.pow(2, -dt / halfLife)
}

export interface ArcConfig {
  /** Launch speed along the pointing direction, m/s. */
  speed: number
  gravity: number
  /** Sample count. More is smoother and more raycasts. */
  segments: number
  /** Simulated seconds per sample. */
  timeStep: number
}

export const DEFAULT_ARC: ArcConfig = {
  speed: 9,
  gravity: -16,
  segments: 24,
  timeStep: 0.06,
}

/**
 * Sample a ballistic arc from a controller pose.
 *
 * A parabola rather than a straight ray for two reasons: it makes the landing point
 * legible without having to aim precisely at the floor, and the curve gives a sense of
 * distance that a line pointed at a dark floor does not.
 */
export function sampleArc(
  origin: Vec3,
  direction: Vec3,
  config: ArcConfig = DEFAULT_ARC,
): Vec3[] {
  const points: Vec3[] = [{ ...origin }]
  const vx = direction.x * config.speed
  const vy = direction.y * config.speed
  const vz = direction.z * config.speed

  for (let i = 1; i <= config.segments; i++) {
    const t = i * config.timeStep
    points.push({
      x: origin.x + vx * t,
      y: origin.y + vy * t + 0.5 * config.gravity * t * t,
      z: origin.z + vz * t,
    })
  }
  return points
}

export interface ArcHit {
  point: Vec3
  normal: Vec3
  /** Index of the arc segment that hit, so the ribbon can be trimmed at the impact. */
  segment: number
}

/**
 * Walk the arc segment by segment until something is hit.
 *
 * `cast` is supplied by the caller (Rapier in the game, a stub in the tests) and returns
 * the impact for a single segment or null. Keeping the raycast out of this function is
 * what makes the trimming and validity logic testable without a physics world.
 */
export function findArcHit(
  points: Vec3[],
  cast: (from: Vec3, to: Vec3) => { point: Vec3; normal: Vec3 } | null,
): ArcHit | null {
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i]
    const to = points[i + 1]
    if (!from || !to) break
    const hit = cast(from, to)
    if (hit) return { ...hit, segment: i }
  }
  return null
}

/**
 * Steepest surface the player may teleport onto, in degrees from horizontal.
 *
 * Matched to the character controller's slope limit on purpose: a marker that lights up
 * green on a surface you would immediately slide off is worse than no marker.
 */
export const MAX_TELEPORT_SLOPE_DEGREES = 45

/**
 * Clamp a hand to the end of an arm of `maxArmLength`, measured from the head.
 *
 * `Player.CurrentLeftHandPosition` in the reference implementation. Without it, a player
 * who reaches through a wall — or whose controller drops tracking and reports a pose a long
 * way off — gets a hand anchor at that far point and is launched towards it. Clamping the
 * *reported* position rather than rejecting it keeps the motion continuous at the limit.
 */
export function clampArmReach(hand: Vec3, head: Vec3, maxArmLength: number): Vec3 {
  const dx = hand.x - head.x
  const dy = hand.y - head.y
  const dz = hand.z - head.z
  const length = Math.hypot(dx, dy, dz)
  if (length < maxArmLength || length === 0) return { x: hand.x, y: hand.y, z: hand.z }
  const scale = maxArmLength / length
  return {
    x: head.x + dx * scale,
    y: head.y + dy * scale,
    z: head.z + dz * scale,
  }
}

/**
 * One hand's contribution to the body's movement, for a hand that is in contact.
 *
 * This is the whole mechanism, and it is *not* a frame-to-frame delta. A touching hand owns
 * a world-space `anchor` — the point on the surface it is stuck to — and the body moves by
 * however far the hand has strayed from that anchor, inverted. Pull your hand back towards
 * your chest and the anchor stays on the wall, so the body is dragged towards the wall.
 *
 * `wasTouching` picks which point to measure from, exactly as the reference does: a hand
 * that was already touching measures from its established `anchor`, while a hand that has
 * just made contact measures from `contactPoint` (where the sweep stopped this step), so the
 * frame it lands contributes only the part of the motion that happened after contact.
 *
 * Pure so the test in `locomotion.gorilla.test.ts` can lock the contract independently of
 * three.js, Rapier, or any session state.
 */
export function gorillaHandOffset(
  anchor: Vec3,
  current: Vec3,
  contactPoint: Vec3,
  wasTouching: boolean,
): Vec3 {
  const from = wasTouching ? anchor : contactPoint
  return {
    x: from.x - current.x,
    y: from.y - current.y,
    z: from.z - current.z,
  }
}

/**
 * Fold two per-hand offsets into one body movement.
 *
 * Averaged when both hands are in contact, summed otherwise. The asymmetry is deliberate
 * and is in the reference: two hands on the same wall each want to move the body the full
 * distance, and adding them would move it twice as far as either hand asked for. One hand
 * on a surface and one in the air is not a disagreement to average — the airborne hand
 * contributes a zero that would silently halve the moving hand's pull.
 */
export function combineHandMovement(left: Vec3, right: Vec3, bothTouching: boolean): Vec3 {
  const divisor = bothTouching ? 2 : 1
  return {
    x: (left.x + right.x) / divisor,
    y: (left.y + right.y) / divisor,
    z: (left.z + right.z) / divisor,
  }
}

export function isValidLanding(
  normal: Vec3,
  maxSlopeDegrees: number = MAX_TELEPORT_SLOPE_DEGREES,
): boolean {
  const length = Math.hypot(normal.x, normal.y, normal.z)
  if (length === 0) return false
  // normal.y / |normal| is the cosine of the angle from vertical.
  return normal.y / length >= Math.cos((maxSlopeDegrees * Math.PI) / 180)
}
