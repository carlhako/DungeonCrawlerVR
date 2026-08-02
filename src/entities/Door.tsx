import { useEffect, useMemo, useRef } from 'react'
import { RigidBody, type RapierRigidBody } from '@react-three/rapier'
import { Group, Quaternion, Vector3 } from 'three'
import { SystemOrder } from '@/core/loop'
import { useFixedUpdate } from '@/core/simulation'
import { registerInteractable, type Interactable } from '@/systems/interaction'
import { damp } from '@/systems/locomotion'
import { startWave } from '@/systems/run'

/**
 * The dungeon door: the one object in the foyer that starts a wave.
 *
 * It is a real hinged object with a real handle, not a trigger volume. In VR the difference
 * is the whole thing — you reach out, take hold of the handle and pull, and the game begins.
 * A glowing zone that fires when you walk into it would be less work and would feel like
 * nothing at all.
 *
 * The leaf is a kinematic body so it carries its collider with it: an open door you still
 * walk into is worse than one that never opened.
 */

const DOOR_WIDTH = 1.1
const DOOR_HEIGHT = 2.2
const DOOR_THICKNESS = 0.12

/**
 * How far it swings, and which way.
 *
 * Away from the foyer, into the passage beyond — which matters far more in VR than it
 * sounds. A door that opens towards the player sweeps a solid kinematic collider through the
 * space they are standing in and shoves them backwards, and being pushed around by the
 * scenery is exactly the kind of unrequested motion the comfort rule exists to forbid.
 *
 * The sign is easy to get backwards: the leaf extends along the body's local +X, and a
 * positive Y rotation takes +X towards -Z. So *positive* is away from a player standing at
 * +Z. Verified by walking through it — the negative version quietly barged the player
 * sideways out of the doorway.
 */
const OPEN_RADIANS = Math.PI * 0.55

/**
 * Seconds for the swing to cover half the remaining angle.
 *
 * Slow enough to read as heavy — this is the door to the dungeon, and it should feel like
 * one — but not so slow the player is left waiting on an animation before they can walk.
 */
const SWING_HALF_LIFE = 0.22

const HANDLE_RADIUS = 0.055
/** Handle inset from the swinging edge, at a natural height to grab. */
const HANDLE_OFFSET = DOOR_WIDTH - 0.16
const HANDLE_HEIGHT = 1.05

interface DoorProps {
  /** Hinge position. The leaf extends along +X from here before it swings. */
  position: [number, number, number]
  /** Hinge yaw in radians, so a door can sit in any wall. */
  rotation?: number
}

export function Door({ position, rotation = 0 }: DoorProps) {
  const body = useRef<RapierRigidBody>(null)
  const handle = useRef<Group>(null)

  const state = useMemo(
    () => ({
      /** Current swing, radians. Damped toward `target`. */
      angle: 0,
      target: 0,
      open: false,
      hingeQuaternion: new Quaternion(),
      up: new Vector3(0, 1, 0),
      handleWorld: new Vector3(),
    }),
    [],
  )

  const interactable = useMemo<Interactable>(
    () => ({
      id: 'foyer-door',
      // Overwritten every step from the handle's world position, so the prompt and the grab
      // target follow the door as it swings rather than hanging in the air where it was.
      position: { x: position[0], y: HANDLE_HEIGHT, z: position[2] },
      // Generously larger than the handle looks. Pointing a controller at a 5cm knob from
      // across a room is not a test of intent, it is a test of steady hands.
      radius: 0.22,
      label: 'Open the door',
      enabled: true,
      onActivate: () => {
        state.open = !state.open
        state.target = state.open ? OPEN_RADIANS : 0
        interactable.label = state.open ? 'Close the door' : 'Open the door'
        // Opening the door is what starts a wave. Closing it is just closing it.
        if (state.open) startWave()
      },
    }),
    [position, state],
  )

  useEffect(() => registerInteractable(interactable), [interactable])

  useFixedUpdate(
    (dt) => {
      const rigid = body.current
      if (!rigid) return

      state.angle = damp(state.angle, state.target, SWING_HALF_LIFE, dt)

      state.hingeQuaternion.setFromAxisAngle(state.up, rotation + state.angle)
      rigid.setNextKinematicRotation(state.hingeQuaternion)

      // The handle's world position, taken from the scene graph rather than recomputed by
      // hand — one source of truth for where the thing actually is.
      if (handle.current) {
        handle.current.getWorldPosition(state.handleWorld)
        interactable.position.x = state.handleWorld.x
        interactable.position.y = state.handleWorld.y
        interactable.position.z = state.handleWorld.z
      }
    },
    SystemOrder.World,
    [rotation],
  )

  return (
    <RigidBody
      ref={body}
      type="kinematicPosition"
      colliders="cuboid"
      position={position}
      rotation={[0, rotation, 0]}
    >
      {/* The leaf hangs off the hinge, so the body's own rotation is the swing. */}
      <mesh position={[DOOR_WIDTH / 2, DOOR_HEIGHT / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[DOOR_WIDTH, DOOR_HEIGHT, DOOR_THICKNESS]} />
        <meshStandardMaterial color="#4a3722" roughness={0.85} />
      </mesh>

      {/* Iron banding, purely so the door reads as a door at a glance in a dark room. */}
      {[0.5, 1.65].map((y) => (
        <mesh key={y} position={[DOOR_WIDTH / 2, y, 0]} castShadow>
          <boxGeometry args={[DOOR_WIDTH * 0.94, 0.12, DOOR_THICKNESS + 0.03]} />
          <meshStandardMaterial color="#2b2b30" roughness={0.6} metalness={0.7} />
        </mesh>
      ))}

      <group ref={handle} position={[HANDLE_OFFSET, HANDLE_HEIGHT, DOOR_THICKNESS / 2 + 0.04]}>
        <mesh castShadow>
          <torusGeometry args={[HANDLE_RADIUS * 1.6, HANDLE_RADIUS * 0.45, 8, 20]} />
          {/* Emissive, faintly. In a torch-lit room the one thing you can interact with
              should be findable without a torch pointed at it — and colour in `emissive`
              rather than albedo is what keeps it legible when the light moves away. */}
          <meshStandardMaterial
            color="#3a3a42"
            emissive="#c98a3a"
            emissiveIntensity={0.35}
            roughness={0.4}
            metalness={0.8}
          />
        </mesh>
      </group>
    </RigidBody>
  )
}

export const DOOR_DIMENSIONS = { width: DOOR_WIDTH, height: DOOR_HEIGHT }
