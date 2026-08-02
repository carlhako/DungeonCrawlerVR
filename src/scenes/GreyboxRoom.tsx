import { useRef } from 'react'
import { Grid } from '@react-three/drei'
import type { Mesh } from 'three'
import { useFixedUpdate } from '@/core/simulation'
import { SystemOrder } from '@/core/loop'

/**
 * Sprint 0.1 test room. One unit is one metre — this is not negotiable once VR is in,
 * because the headset reports real-world metres and any other scale makes the player feel
 * like a giant or a mouse. Everything here is sized against a 1.7m human.
 */

const ROOM_SIZE = 16
const WALL_HEIGHT = 4
const WALL_THICKNESS = 0.3

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

/** 1.7m column at the origin — the human-scale yardstick to sanity-check VR against. */
function ScaleReference() {
  return (
    <mesh position={[2, 0.85, -2]} castShadow>
      <boxGeometry args={[0.4, 1.7, 0.4]} />
      <meshStandardMaterial color="#8a7a5c" roughness={0.8} />
    </mesh>
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

      <Walls />
      <Pillars />
      <ScaleReference />
      <SimulationProbe />
    </group>
  )
}

export const GREYBOX_ROOM_SIZE = ROOM_SIZE
