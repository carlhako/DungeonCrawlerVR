import { useRef } from 'react'
import { Grid } from '@react-three/drei'
import { CuboidCollider, RigidBody } from '@react-three/rapier'
import type { Mesh } from 'three'
import { useFixedUpdate } from '@/core/simulation'
import { SystemOrder } from '@/core/loop'

/**
 * Sprint 0.1 test room, given collision and a movement obstacle course in Sprint 0.3.
 *
 * One unit is one metre — not negotiable once VR is in, because the headset reports
 * real-world metres and any other scale makes the player feel like a giant or a mouse.
 * Everything here is sized against a 1.7m human.
 *
 * The ramp, stairs and ledge exist to make the character controller's behaviour *visible*.
 * A flat room proves nothing: step height, slope limits and ground snapping all look
 * identical to a bug until there is something to walk up.
 */

const ROOM_SIZE = 16
const WALL_HEIGHT = 4
const WALL_THICKNESS = 0.3

/** Steps deliberately sit under the controller's 0.4m autostep height. */
const STEP_RISE = 0.18
const STEP_RUN = 0.35
const STEP_COUNT = 6

/** Comfortably inside the 45° climb limit. The player should walk up this without slowing. */
const RAMP_DEGREES = 20

function Walls() {
  const half = ROOM_SIZE / 2
  const y = WALL_HEIGHT / 2
  const placements: Array<[number, number, number, number, number]> = [
    // x, z, rotY, width, height
    [0, -half, 0, ROOM_SIZE, WALL_HEIGHT],
    [0, half, 0, ROOM_SIZE, WALL_HEIGHT],
    [-half, 0, Math.PI / 2, ROOM_SIZE, WALL_HEIGHT],
    [half, 0, Math.PI / 2, ROOM_SIZE, WALL_HEIGHT],
  ]

  return (
    <>
      {placements.map(([x, z, rotY, width, height], i) => (
        <mesh key={i} position={[x, y, z]} rotation={[0, rotY, 0]} castShadow receiveShadow>
          <boxGeometry args={[width, height, WALL_THICKNESS]} />
          <meshStandardMaterial color="#4a4a52" roughness={0.9} metalness={0} />
        </mesh>
      ))}
    </>
  )
}

/** 1.7m column — the human-scale yardstick to sanity-check VR against. */
function ScaleReference() {
  return (
    <mesh position={[2, 0.85, -2]} castShadow>
      <boxGeometry args={[0.4, 1.7, 0.4]} />
      <meshStandardMaterial color="#8a7a5c" roughness={0.8} />
    </mesh>
  )
}

/**
 * A staircase, for autostep. Each rise is under the controller's step height, so the player
 * should walk up smoothly rather than having to jump each one.
 */
function Stairs() {
  return (
    <>
      {Array.from({ length: STEP_COUNT }, (_, i) => {
        const height = STEP_RISE * (i + 1)
        return (
          <mesh
            key={i}
            position={[-5, height / 2, 1 - i * STEP_RUN]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[3, height, STEP_RUN]} />
            <meshStandardMaterial color="#4f4f59" roughness={0.9} />
          </mesh>
        )
      })}
      {/* Landing at the top of the stairs, shared with the ramp. */}
      <mesh
        position={[-5, (STEP_RISE * STEP_COUNT) / 2, -1.6]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[3, STEP_RISE * STEP_COUNT, 2.4]} />
        <meshStandardMaterial color="#57575f" roughness={0.9} />
      </mesh>
    </>
  )
}

/** A walkable slope. Well inside the climb limit, so it should not slide the player back. */
function Ramp() {
  const rise = STEP_RISE * STEP_COUNT
  const radians = (RAMP_DEGREES * Math.PI) / 180
  const length = rise / Math.sin(radians)

  return (
    <mesh
      position={[5, rise / 2, -0.5]}
      // A positive X rotation takes the slab's local +Z end downward, which puts the low
      // end at +Z — the side the player arrives from. Pitched the other way, the first
      // thing you meet walking at it is a 1.2m wall and the ramp tests nothing.
      rotation={[radians, 0, 0]}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[3, 0.3, length]} />
      <meshStandardMaterial color="#4f4f59" roughness={0.9} />
    </mesh>
  )
}

/**
 * A ledge just high enough to need the jump, and a lower one that does not.
 *
 * Two of them because "can I jump onto that" is only a useful test with a case that fails
 * alongside a case that works.
 */
function Ledges() {
  return (
    <>
      <mesh position={[0, 0.35, -6]} castShadow receiveShadow>
        <boxGeometry args={[3, 0.7, 2]} />
        <meshStandardMaterial color="#5c5c66" roughness={0.9} />
      </mesh>
      <mesh position={[4, 0.15, -6.5]} castShadow receiveShadow>
        <boxGeometry args={[2, 0.3, 2]} />
        <meshStandardMaterial color="#4a4a52" roughness={0.9} />
      </mesh>
    </>
  )
}

/**
 * Rotates at a constant rate off the fixed loop. If this ever visibly changes speed
 * between desktop and the headset, the simulation has become frame-rate dependent.
 */
function SimulationProbe() {
  const ref = useRef<Mesh>(null)

  useFixedUpdate((dt) => {
    if (!ref.current) return
    ref.current.rotation.y += dt * 0.8
    ref.current.rotation.x += dt * 0.35
  }, SystemOrder.Effects)

  return (
    <mesh ref={ref} position={[-2.5, 1.2, -3]} castShadow>
      <torusKnotGeometry args={[0.35, 0.12, 96, 16]} />
      <meshStandardMaterial color="#c96f3a" emissive="#ff6a1f" emissiveIntensity={0.25} roughness={0.4} />
    </mesh>
  )
}

function Pillars() {
  const positions: Array<[number, number]> = [
    [-5, -5],
    [5, -5],
    [-5, 5],
    [5, 5],
  ]
  return (
    <>
      {positions.map(([x, z], i) => (
        <mesh key={i} position={[x, WALL_HEIGHT / 2, z]} castShadow receiveShadow>
          <cylinderGeometry args={[0.45, 0.55, WALL_HEIGHT, 12]} />
          <meshStandardMaterial color="#55555e" roughness={0.95} />
        </mesh>
      ))}
    </>
  )
}

export function GreyboxRoom() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[ROOM_SIZE, ROOM_SIZE]} />
        <meshStandardMaterial color="#33333a" roughness={1} />
      </mesh>

      {/* The floor collider is a slab rather than the visual plane: a zero-thickness
          collider is something a fast-moving body can end up on the wrong side of, and the
          floor is the one surface in the game that must never be passed through. */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[ROOM_SIZE / 2, 0.5, ROOM_SIZE / 2]} position={[0, -0.5, 0]} />
      </RigidBody>

      {/* Metre grid, so distances are readable at a glance while greyboxing. */}
      <Grid
        args={[ROOM_SIZE, ROOM_SIZE]}
        position={[0, 0.002, 0]}
        cellSize={1}
        cellThickness={0.6}
        cellColor="#5a5a66"
        sectionSize={4}
        sectionThickness={1.2}
        sectionColor="#7d6b4f"
        fadeDistance={30}
        fadeStrength={1}
        followCamera={false}
        infiniteGrid={false}
      />

      {/* One fixed body for all the static geometry. `hull` rather than `trimesh` because
          every shape here is convex, and hulls are both cheaper to query and free of the
          thin-wall tunnelling that trimesh colliders are prone to. */}
      <RigidBody type="fixed" colliders="hull">
        <Walls />
        <Pillars />
        <ScaleReference />
        <Stairs />
        <Ramp />
        <Ledges />
      </RigidBody>

      {/* No collider: it floats, it spins, and it is diagnostic rather than level geometry. */}
      <SimulationProbe />
    </group>
  )
}

export const GREYBOX_ROOM_SIZE = ROOM_SIZE
