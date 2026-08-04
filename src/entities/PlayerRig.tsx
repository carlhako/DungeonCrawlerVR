import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { XROrigin, useXR } from '@react-three/xr'
import {
  CapsuleCollider,
  RigidBody,
  useRapier,
  type RapierRigidBody,
} from '@react-three/rapier'
import type { Collider, KinematicCharacterController } from '@dimforge/rapier3d-compat'
import { Euler, Group, Matrix4, Vector3 } from 'three'
import { SystemOrder } from '@/core/loop'
import { useFixedUpdate } from '@/core/simulation'
import { SPRINT_MULTIPLIER, desktopInput } from '@/systems/desktopInput'
import {
  MAX_TELEPORT_SLOPE_DEGREES,
  applyDeadzone,
  createTurnLatch,
  headBlockAmount,
  headingFromBasis,
  integrateVertical,
  moveDirection,
  rotateY,
  smoothTurn,
  snapTurn,
} from '@/systems/locomotion'
import { interactionState } from '@/systems/interaction'
import {
  consumeRecall,
  DESKTOP_EYE_HEIGHT,
  PLAYER_CENTRE_OFFSET,
  PLAYER_HALF_HEIGHT,
  PLAYER_RADIUS,
  PLAYER_SPAWN,
  playerCollider,
  playerState,
} from '@/systems/player'
import { useSettings, type Settings } from '@/systems/settings'
import { sampleShake, type ShakeOffset } from '@/systems/fx/shake'
import { shakeState } from '@/systems/fx/state'
import { xrInput } from '@/systems/xrInput'
import { consumeTeleport } from '@/entities/Teleport'
import { consumeGorillaMotion } from '@/systems/gorillaLocomotion'

/**
 * The player: a kinematic capsule driven by Rapier's character controller, carrying the XR
 * origin in VR and the camera on desktop.
 *
 * The rule this file exists to enforce: **nothing here moves the VR camera except the
 * player's own head.** The rig moves; the head moves freely within it. Turning is the one
 * deliberate exception — and the one to reach for first if anyone reports nausea, since
 * snap turning removes the rotation entirely.
 */

const STICK_DEADZONE = 0.15
const DEG = Math.PI / 180

/**
 * Below this, the capsule is already under the head and recentring is skipped.
 *
 * Head tracking is never perfectly still — it moves with your pulse — and chasing sub-
 * millimetre noise would run a collider query every step for a shift nobody can see.
 */
const RECENTRE_EPSILON = 0.002

/** Character controller tuning. Distances in metres. */
const CONTROLLER = {
  /** Gap kept between the capsule and the world. Too small and contacts jitter. */
  offset: 0.02,
  /** Ledges up to this high are stepped over rather than walked into. */
  autostepHeight: 0.4,
  /**
   * Clear space that must exist *beyond the capsule's leading edge* after a step, before
   * the step is taken at all.
   *
   * The upper bound is therefore the tread depth minus the capsule radius, not the tread
   * depth — which is much tighter than it looks. On the greybox's 0.35m treads a 0.3m
   * capsule leaves 0.05m, and anything above that wedges the player halfway up the stairs
   * with no indication why. Verified by walking it: 0.05 climbs, 0.1 sticks on step four.
   *
   * The rule this hands to the dungeon tile kit in Sprint 2.1: treads want to be at least
   * `PLAYER_RADIUS + this` deep, so 0.35m is the shallowest stair we support.
   */
  autostepMinWidth: 0.05,
  /** Keeps the player on the floor walking downhill instead of skipping off each edge. */
  snapToGround: 0.3,
  /** Matched to the teleport marker's limit: a slope you can walk up, you can teleport to. */
  maxSlopeClimbDegrees: MAX_TELEPORT_SLOPE_DEGREES,
  /** Must exceed the climb angle, or the player slides back down slopes they can walk up. */
  minSlopeSlideDegrees: MAX_TELEPORT_SLOPE_DEGREES + 5,
} as const

export function PlayerRig() {
  const body = useRef<RapierRigidBody>(null)
  const collider = useRef<Collider>(null)
  // Yaw lives on a group inside the body rather than on the body itself. Rotating a
  // kinematic rigid body would push the rotation through the physics pipeline for no gain,
  // since a capsule is rotationally symmetric anyway.
  const yawGroup = useRef<Group>(null)
  const originGroup = useRef<Group>(null)

  // Published so world queries can exclude the player — the teleport arc starts inside this
  // capsule, and weapon raycasts (Sprint 2.2) would otherwise shoot the player in the chest.
  useEffect(() => {
    playerCollider.current = collider.current
    return () => {
      playerCollider.current = null
    }
  }, [])

  return (
    <RigidBody
      ref={body}
      type="kinematicPosition"
      colliders={false}
      position={[PLAYER_SPAWN[0], PLAYER_SPAWN[1] + PLAYER_CENTRE_OFFSET, PLAYER_SPAWN[2]]}
      enabledRotations={[false, false, false]}
    >
      <CapsuleCollider ref={collider} args={[PLAYER_HALF_HEIGHT, PLAYER_RADIUS]} />

      {/* Dropped back down to the player's feet: XROrigin marks the floor they stand on,
          while the rigid body's origin is the centre of the capsule. Head height comes from
          the headset's own floor-relative tracking and is never set here.

          The inner group carries the room-scale recentring offset — see `recentre`. It is
          separate from the yaw group so that turning rotates the play space *and* the offset
          together, which is what keeps a turn centred on the player's head rather than on a
          capsule they may be standing a metre away from. */}
      <group ref={yawGroup} position={[0, -PLAYER_CENTRE_OFFSET, 0]}>
        <group ref={originGroup}>
          <XROrigin />
        </group>
      </group>

      <CharacterController
        body={body}
        collider={collider}
        yawGroup={yawGroup}
        originGroup={originGroup}
      />
    </RigidBody>
  )
}

/** Written into every rendered frame by `sampleShake`, so the camera path allocates nothing. */
const shakeOffset: ShakeOffset = { x: 0, y: 0, roll: 0 }

interface ControllerProps {
  body: React.RefObject<RapierRigidBody | null>
  collider: React.RefObject<Collider | null>
  yawGroup: React.RefObject<Group | null>
  originGroup: React.RefObject<Group | null>
}

function CharacterController({ body, collider, yawGroup, originGroup }: ControllerProps) {
  const { world } = useRapier()
  const gl = useThree((state) => state.gl)
  const camera = useThree((state) => state.camera)
  const inSession = useXR((state) => state.session != null)
  const settings = useSettings()

  /**
   * Rapier's kinematic character controller resolves the movement we *ask* for into the
   * movement that is actually possible — sliding along walls, climbing steps, stopping at
   * slopes — rather than us hand-rolling collision response and getting it subtly wrong.
   *
   * Created inside the effect that destroys it, and reached through a ref, so its lifetime
   * is owned in exactly one place. Building it in a `useMemo` instead looks tidier and is
   * a trap: `removeCharacterController` calls into WASM to free the thing, StrictMode runs
   * the mount/cleanup pair twice, and the memo does *not* re-run in between — leaving every
   * later step calling through a freed pointer.
   */
  const controller = useRef<KinematicCharacterController | null>(null)

  useEffect(() => {
    const created = world.createCharacterController(CONTROLLER.offset)
    created.setUp({ x: 0, y: 1, z: 0 })
    created.setSlideEnabled(true)
    created.enableAutostep(CONTROLLER.autostepHeight, CONTROLLER.autostepMinWidth, true)
    created.enableSnapToGround(CONTROLLER.snapToGround)
    created.setMaxSlopeClimbAngle(CONTROLLER.maxSlopeClimbDegrees * DEG)
    created.setMinSlopeSlideAngle(CONTROLLER.minSlopeSlideDegrees * DEG)
    // Walking into a crate should shove it. Costs nothing until there are dynamic bodies to
    // shove, and means props don't feel nailed down once there are.
    created.setApplyImpulsesToDynamicBodies(true)
    controller.current = created

    return () => {
      controller.current = null
      world.removeCharacterController(created)
    }
  }, [world])

  // Read inside the fixed loop through a ref, so changing a setting doesn't tear down and
  // re-register the system mid-stride.
  const latest = useRef({ settings, inSession })
  latest.current = { settings, inSession }

  // Allocated once. Nothing in the fixed loop is allowed to allocate.
  const scratch = useMemo(
    () => ({
      vertical: { velocity: 0 },
      turnLatch: createTurnLatch(),
      headMatrix: new Matrix4(),
      forward: new Vector3(),
      up: new Vector3(),
      desired: { x: 0, y: 0, z: 0 },
      recentre: { x: 0, y: 0, z: 0 },
      euler: new Euler(0, 0, 0, 'YXZ'),
    }),
    [],
  )

  useFixedUpdate(
    (dt) => {
      const rigidBody = body.current
      const capsule = collider.current
      const yawNode = yawGroup.current
      const character = controller.current
      if (!rigidBody || !capsule || !yawNode || !character) return

      const { settings: config, inSession: inVR } = latest.current

      const turned = inVR ? vrTurn(scratch.turnLatch, config, dt) : 0
      if (turned !== 0) yawNode.rotation.y += turned

      // In VR the rig's yaw is the player's heading; on desktop the rig never rotates and
      // the mouse owns the heading, driving the camera directly.
      playerState.yaw = inVR ? yawNode.rotation.y : desktopInput.yaw

      const teleporting = inVR && config.locomotion === 'teleport'
      // Gorilla is opt-in and VR-only: on desktop with this setting, the rig falls through
      // to the smooth-mode path because the gorilla module is inert outside a session.
      const gorillaMode = inVR && config.locomotion === 'gorilla'
      const gorilla = gorillaMode ? consumeGorillaMotion() : null

      // Head-relative in VR: you walk where you look. The heading already includes the
      // rig's yaw, because it is read from a world matrix.
      if (inVR) readHead(gl, camera, scratch)
      const facing = inVR ? headingFromBasis(scratch.forward, scratch.up) : desktopInput.yaw
      const stick = inVR
        ? applyDeadzone(xrInput.left.thumbstick.x, xrInput.left.thumbstick.y, STICK_DEADZONE)
        : desktopInput.move

      // Teleport mode replaces stick translation outright. Leaving both live would give the
      // player two ways to move and a clear model of neither.
      const move = teleporting ? { x: 0, y: 0 } : moveDirection(stick, facing)
      const speed =
        config.moveSpeed * (!inVR && desktopInput.sprint ? SPRINT_MULTIPLIER : 1)
      // Space is contextual on desktop: if the interaction system spent it opening a door
      // this step, it is not also a jump. The alternative is a second key for "use", which
      // is one more thing to explain for no gain — you are never trying to jump and open a
      // door at the same instant.
      const jump = inVR
        ? xrInput.right.primary.justPressed
        : desktopInput.jump.justPressed && !interactionState.consumedActivate

      // In gorilla mode the A button is reserved for "use-or-fire" — arm-swinging replaces
      // jumping as the way to leave the floor. A player mid-climb is not asking to jump.
      const allowJump = jump && !teleporting && !gorillaMode

      let nextX: number
      let nextY: number
      let nextZ: number
      let corrected: { x: number; y: number; z: number }
      let grounded: boolean
      // True when the gorilla module drove the body this step. The speed write-up below
      // needs to know, because the wall-state bypass produces no `corrected` to measure.
      let gorillaDroveThisStep = false

      if (gorilla && gorilla.bodyPositionOverride != null) {
        // Wall state: the body position comes from the analytic hand solve, not from the
        // character controller. Gravity is also skipped — the hands are doing the work, and
        // clearing the cached velocity means a release drops to rest rather than picking up
        // whatever speed a jump might have left behind. Recentring is skipped below for the
        // same reason: the body is anchored to the wall, not to the head.
        nextX = gorilla.bodyPositionOverride.x
        nextY = gorilla.bodyPositionOverride.y
        nextZ = gorilla.bodyPositionOverride.z
        grounded = playerState.grounded
        corrected = { x: 0, y: 0, z: 0 }
        scratch.vertical.velocity = 0
        gorillaDroveThisStep = true
      } else {
        // In gorilla mode (non-wall) the module owns xz motion — hand math on the floor or
        // joystick fallback when the arms are at rest. In every other mode the smooth-stick
        // move applies, exactly as before.
        const horizontalX = gorillaMode && gorilla ? gorilla.motion.x : move.x * speed
        const horizontalZ = gorillaMode && gorilla ? gorilla.motion.z : move.y * speed
        scratch.desired.x = horizontalX * dt
        scratch.desired.z = horizontalZ * dt
        scratch.desired.y = integrateVertical(
          scratch.vertical,
          playerState.grounded,
          allowJump,
          dt,
        )

        character.computeColliderMovement(capsule, scratch.desired)
        corrected = character.computedMovement()
        grounded = character.computedGrounded()

        // Blocked on the way up means a ceiling. Keeping the velocity would pin the player
        // against it for the rest of the jump.
        if (scratch.vertical.velocity > 0 && corrected.y < scratch.desired.y - 1e-4) {
          scratch.vertical.velocity = 0
        }

        const current = rigidBody.translation()
        nextX = current.x + corrected.x
        nextY = current.y + corrected.y
        nextZ = current.z + corrected.z
      }

      // A completed teleport is an absolute move, not a translation to be resolved — the
      // whole point is that it skips the space in between.
      // Room-scale: bring the capsule under wherever the player has physically walked their
      // head, and slide the play space back by the same amount so the head does not move in
      // world space as a result. Without this, walking two metres across your living room
      // leaves your body behind at the spawn point and you can put your head through a wall.
      // Skipped in gorilla wall state: the body is anchored to the wall by the grip, not
      // to the head, and recentring would tug the capsule off the wall each step.
      if (inVR && !gorillaDroveThisStep) {
        const originNode = originGroup.current
        const headX = scratch.headMatrix.elements[12] ?? 0
        const headZ = scratch.headMatrix.elements[14] ?? 0
        const wantX = headX - nextX
        const wantZ = headZ - nextZ

        if (originNode && Math.hypot(wantX, wantZ) > RECENTRE_EPSILON) {
          scratch.recentre.x = wantX
          scratch.recentre.y = 0
          scratch.recentre.z = wantZ
          // Resolved separately from locomotion rather than summed into it: we need to know
          // how much of *this* movement the world allowed, and a combined result can't be
          // taken apart again.
          character.computeColliderMovement(capsule, scratch.recentre)
          const shift = character.computedMovement()

          nextX += shift.x
          nextZ += shift.z

          // The offset lives in the yaw group's rotated frame, so the world-space shift has
          // to be rotated back into it before it can be subtracted.
          const local = rotateY(shift.x, shift.z, -playerState.yaw)
          originNode.position.x -= local.x
          originNode.position.z -= local.y

          // Whatever the wall refused to give us is the gap between the head and the body.
          playerState.headBlocked = headBlockAmount(
            Math.hypot(wantX - shift.x, wantZ - shift.z),
          )
        } else {
          playerState.headBlocked = 0
        }
      } else if (playerState.headBlocked !== 0) {
        playerState.headBlocked = 0
      }

      // A recall beats a teleport: it is only ever death, and death is not negotiable.
      const landing = consumeRecall() ?? (teleporting ? consumeTeleport() : null)
      if (landing) {
        nextX = landing.x
        nextY = landing.y + PLAYER_CENTRE_OFFSET
        nextZ = landing.z
        scratch.vertical.velocity = 0
        playerState.headBlocked = 0
        // The recentring offset is deliberately left alone. It already holds exactly minus
        // the player's physical standing offset, which is what keeps their head over the
        // capsule — so moving the capsule to the marker moves their head to the marker.
        // Zeroing it here would land them wherever they happen to be stood in the room.
      }

      rigidBody.setNextKinematicTranslation({ x: nextX, y: nextY, z: nextZ })

      playerState.position.x = nextX
      playerState.position.y = nextY - PLAYER_CENTRE_OFFSET
      playerState.position.z = nextZ
      playerState.grounded = grounded
      // Actual speed, not requested: walking into a wall should not close the comfort
      // vignette, because the view isn't moving. In the gorilla wall-state bypass the body
      // moves by the analytic hand solve, not by `corrected` — the speed is the per-step
      // body translation directly, which the comfort vignette can use to track climbing.
      playerState.speed = landing
        ? 0
        : gorillaDroveThisStep
          ? Math.hypot(nextX - rigidBody.translation().x, nextZ - rigidBody.translation().z) / dt
          : Math.hypot(corrected.x, corrected.z) / dt
      playerState.turning = inVR && config.turn === 'smooth' && turned !== 0
    },
    SystemOrder.Player,
    [],
  )

  /**
   * The desktop camera, placed per rendered frame rather than per fixed step: it is
   * presentation, and running it at the display rate is what keeps mouselook smooth.
   *
   * Inside a session this does nothing at all. The headset owns the camera, and writing to
   * it behind the runtime's back is precisely what the comfort rule forbids.
   */
  useFrame(() => {
    if (latest.current.inSession) return
    const rigidBody = body.current
    if (!rigidBody) return

    const centre = rigidBody.translation()

    /**
     * Screenshake, and **only here** — this is the one function in the game that decides
     * where the desktop camera goes, so it is the one place a shake can be applied without
     * fighting whatever wrote the transform a moment earlier.
     *
     * `sampleShake` returns zeros inside a session, so this stays true even though the guard
     * above already means the code is unreachable in VR. Two independent statements of the
     * same rule, because it is the rule this project cares about most.
     */
    sampleShake(shakeState, shakeOffset, { inVR: latest.current.inSession })

    camera.position.set(
      centre.x,
      centre.y - PLAYER_CENTRE_OFFSET + DESKTOP_EYE_HEIGHT,
      centre.z,
    )
    // YXZ so yaw is applied before pitch and the horizon never rolls — except by however much
    // a shake is currently rolling it, which is the third component here and nowhere else.
    scratch.euler.set(
      desktopInput.pitch + shakeOffset.y,
      desktopInput.yaw + shakeOffset.x,
      shakeOffset.roll,
    )
    camera.quaternion.setFromEuler(scratch.euler)
  })

  return null
}

/** Snap or smooth turn from the right thumbstick. Returns the yaw delta in radians. */
function vrTurn(
  latch: ReturnType<typeof createTurnLatch>,
  settings: Settings,
  dt: number,
): number {
  const stickX = xrInput.right.thumbstick.x
  if (settings.turn === 'smooth') {
    if (Math.abs(stickX) < STICK_DEADZONE) return 0
    return smoothTurn(stickX, settings.smoothTurnSpeed * DEG, dt)
  }
  return snapTurn(latch, stickX, settings.snapTurnDegrees * DEG)
}

interface HeadScratch {
  headMatrix: Matrix4
  forward: Vector3
  up: Vector3
}

/**
 * Read the head pose into scratch: its world matrix, and the forward and up axes.
 *
 * Reads `gl.xr.getCamera()` rather than the R3F camera while presenting: three updates the
 * XR camera from the frame's pose at the top of the animation callback, before any of our
 * systems run, so this is the current frame's head rather than the previous frame's.
 *
 * Taken once per step and shared, because both consumers — the walking direction and the
 * room-scale recentring — must agree about where the head is within a step.
 */
function readHead(
  gl: { xr: { isPresenting: boolean; getCamera: () => { matrixWorld: Matrix4 } } },
  fallback: { matrixWorld: Matrix4 },
  scratch: HeadScratch,
): void {
  const head = gl.xr.isPresenting ? gl.xr.getCamera() : fallback
  scratch.headMatrix.copy(head.matrixWorld)
  const e = scratch.headMatrix.elements
  // Columns 1 and 2 of the rotation basis: +Y is up, -Z is forward.
  scratch.up.set(e[4], e[5], e[6])
  scratch.forward.set(-e[8], -e[9], -e[10])
}
