import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useXR, useXRInputSourceState } from '@react-three/xr'
import { useRapier } from '@react-three/rapier'
import { QueryFilterFlags, Ray } from '@dimforge/rapier3d-compat'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Line,
  LineBasicMaterial,
  Quaternion,
  Vector3,
} from 'three'
import { SystemOrder } from '@/core/loop'
import { useFixedUpdate } from '@/core/simulation'
import {
  DEFAULT_ARC,
  findArcHit,
  isValidLanding,
  sampleArc,
  type Vec3,
} from '@/systems/locomotion'
import { playerCollider, playerState } from '@/systems/player'
import { useSettings } from '@/systems/settings'
import { Haptic, pulsePreset } from '@/systems/haptics'
import { xrInput } from '@/systems/xrInput'
import { xrAim } from '@/systems/xrAim'

/**
 * Teleport locomotion: aim a ballistic arc from the right controller, release to move.
 *
 * Teleport exists because smooth locomotion makes a meaningful number of people ill, and
 * "can't play at all" is a much worse outcome than "moves differently". It is a comfort
 * setting, not a difficulty one — nothing in the game may ever *require* smooth movement.
 *
 * The arc is aimed with the right controller while the left thumbstick is pushed forward,
 * which is what almost every Quest title does. Muscle memory the player already has is
 * worth more than any scheme we might prefer.
 */

/** Push the movement stick past this to start aiming. */
const AIM_THRESHOLD = 0.5

/** Landing marker radius, matched to the player capsule so it reads as "you, here". */
const MARKER_RADIUS = 0.32

const VALID_COLOUR = '#6fdc8c'
const INVALID_COLOUR = '#e0705a'

const ARC_POINT_COUNT = DEFAULT_ARC.segments + 1

interface TeleportRuntime {
  aiming: boolean
  /** Whether the arc is currently resting on somewhere the player may stand. */
  valid: boolean
  target: Vec3
  points: Vec3[]
  /** Index of the arc segment that hit, or -1. The tail past it is not drawn. */
  hitSegment: number
  /** A committed teleport waiting for the character controller to apply it. */
  pending: Vec3 | null
}

/**
 * Module singleton, same reasoning as `xrInput` and `playerState`: the character controller
 * reads this from inside the fixed loop, where hooks don't exist.
 */
const runtime: TeleportRuntime = {
  aiming: false,
  valid: false,
  target: { x: 0, y: 0, z: 0 },
  points: [],
  hitSegment: -1,
  pending: null,
}

/** Take the committed teleport, if any. Clears it, so one release moves the player once. */
export function consumeTeleport(): Vec3 | null {
  const pending = runtime.pending
  runtime.pending = null
  return pending
}

function stopAiming() {
  runtime.aiming = false
  runtime.valid = false
  runtime.hitSegment = -1
  playerState.aiming = false
}

/**
 * Aims the arc and draws it.
 *
 * Lives at the scene root, not inside the player rig: the arc is world-space geometry, and
 * parenting it to a rig that is about to move would drag it along with the teleport.
 */
export function TeleportAim() {
  const { world } = useRapier()
  const session = useXR((state) => state.session)
  const controller = useXRInputSourceState('controller', 'right')
  const locomotion = useSettings((state) => state.locomotion)

  const enabled = session != null && locomotion === 'teleport'

  // A ref, not a dependency: controllers reconnect freely during a session, and the
  // fixed-loop system must not be torn down and re-registered every time one does.
  const latest = useRef({ controller, enabled })
  latest.current = { controller, enabled }

  const marker = useRef<Group>(null)

  /**
   * The arc is built imperatively rather than declaratively. Its vertices are rewritten
   * every frame while aiming, which is a poor fit for JSX, and this way the geometry and
   * material have an obvious owner to dispose of them.
   */
  const arc = useMemo(() => {
    const geometry = new BufferGeometry()
    const positions = new Float32Array(ARC_POINT_COUNT * 3)
    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    const material = new LineBasicMaterial({ transparent: true, opacity: 0.9 })
    const line = new Line(geometry, material)
    // The vertices are in world space and move every frame; a bounding sphere computed
    // once would cull the arc the moment the player turned away from where it started.
    line.frustumCulled = false
    line.visible = false
    return { line, geometry, material, positions }
  }, [])

  useEffect(() => {
    return () => {
      arc.geometry.dispose()
      arc.material.dispose()
    }
  }, [arc])

  const scratch = useMemo(
    () => ({
      origin: new Vector3(),
      direction: new Vector3(),
      rotation: new Quaternion(),
      delta: new Vector3(),
      ray: new Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }),
      validColour: new Color(VALID_COLOUR),
      invalidColour: new Color(INVALID_COLOUR),
    }),
    [],
  )

  /** Raycast one arc segment. Supplied to `findArcHit`, which owns the walk order. */
  const castSegment = (from: Vec3, to: Vec3): { point: Vec3; normal: Vec3 } | null => {
    scratch.delta.set(to.x - from.x, to.y - from.y, to.z - from.z)
    const length = scratch.delta.length()
    if (length === 0) return null
    scratch.delta.divideScalar(length)

    scratch.ray.origin = from
    scratch.ray.dir = scratch.delta

    const hit = world.castRayAndGetNormal(
      scratch.ray,
      length,
      true,
      QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      // Without this the arc lands on the player's own capsule, one segment in.
      playerCollider.current ?? undefined,
    )
    if (!hit) return null

    const t = hit.timeOfImpact
    return {
      point: {
        x: from.x + scratch.delta.x * t,
        y: from.y + scratch.delta.y * t,
        z: from.z + scratch.delta.z * t,
      },
      normal: hit.normal,
    }
  }

  useFixedUpdate(
    () => {
      const { controller: pad, enabled: on } = latest.current
      // The target ray pose, not the grip: the grip's -Z runs down the controller's body,
      // which would launch the arc at the player's feet. Same pose the pointer beam uses,
      // so the two never disagree about where the hand is aimed.
      const pointer = xrAim.right

      if (!on || pointer == null) {
        stopAiming()
        return
      }

      const wasAiming = runtime.aiming
      // The movement stick aims. Pushing it forward is -y in the WebXR convention.
      const aiming = -xrInput.left.thumbstick.y > AIM_THRESHOLD

      if (aiming) {
        pointer.getWorldPosition(scratch.origin)
        pointer.getWorldQuaternion(scratch.rotation)
        // A target ray points along its own -Z.
        scratch.direction.set(0, 0, -1).applyQuaternion(scratch.rotation)

        runtime.points = sampleArc(scratch.origin, scratch.direction)
        const hit = findArcHit(runtime.points, castSegment)
        runtime.hitSegment = hit ? hit.segment : -1
        runtime.valid = hit ? isValidLanding(hit.normal) : false
        if (hit) runtime.target = hit.point
      }

      // Released: commit the move if the arc was resting somewhere valid.
      if (wasAiming && !aiming) {
        if (runtime.valid) {
          runtime.pending = { ...runtime.target }
          pulsePreset(pad, Haptic.click)
        }
        stopAiming()
        return
      }

      runtime.aiming = aiming
      playerState.aiming = aiming
    },
    // Just ahead of the player controller, so a teleport committed on this step is applied
    // on the same step rather than one behind.
    SystemOrder.Player - 1,
    [],
  )

  // Drawing runs per rendered frame rather than per fixed step: at 72Hz in the headset the
  // arc should not visibly step at 60.
  useFrame(() => {
    const visible = runtime.aiming && runtime.points.length === ARC_POINT_COUNT
    arc.line.visible = visible
    if (marker.current) marker.current.visible = visible && runtime.valid
    if (!visible) return

    // Vertices past the impact are collapsed onto it, so the trimmed tail draws nothing
    // instead of continuing on through the wall.
    const last = runtime.hitSegment >= 0 ? runtime.hitSegment + 1 : ARC_POINT_COUNT - 1
    for (let i = 0; i < ARC_POINT_COUNT; i++) {
      const point = runtime.points[Math.min(i, last)]
      if (!point) break
      arc.positions[i * 3] = point.x
      arc.positions[i * 3 + 1] = point.y
      arc.positions[i * 3 + 2] = point.z
    }
    arc.geometry.getAttribute('position').needsUpdate = true

    // Red when the arc is resting on a wall, a ceiling or nothing at all. The player should
    // never have to release to find out whether the move was allowed.
    arc.material.color.copy(runtime.valid ? scratch.validColour : scratch.invalidColour)

    if (runtime.valid && marker.current) {
      // Lifted clear of the floor, or it z-fights with whatever it is resting on.
      marker.current.position.set(runtime.target.x, runtime.target.y + 0.02, runtime.target.z)
    }
  })

  return (
    <group>
      <primitive object={arc.line} />
      <group ref={marker} visible={false}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[MARKER_RADIUS * 0.72, MARKER_RADIUS, 32]} />
          {/* Emissive-driven, like everything else that has to stay legible once the only
              light in the room is a torch. */}
          <meshStandardMaterial
            color="#15151a"
            emissive={VALID_COLOUR}
            emissiveIntensity={2.5}
            transparent
            opacity={0.9}
          />
        </mesh>
      </group>
    </group>
  )
}
