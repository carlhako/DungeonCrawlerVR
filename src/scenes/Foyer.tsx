import { useEffect, useMemo, useRef } from 'react'
import { CuboidCollider, RigidBody } from '@react-three/rapier'
import type { Mesh, MeshStandardMaterial, PointLight } from 'three'
import { SystemOrder } from '@/core/loop'
import { useFixedUpdate } from '@/core/simulation'
import { Door } from '@/entities/Door'
import { registerInteractable, type Interactable } from '@/systems/interaction'
import { flicker } from '@/systems/torch'

/**
 * The foyer: the lit, safe room the player starts and returns to.
 *
 * Its job is contrast. Everything past the door is dark, cold and hostile, and none of that
 * lands unless there is somewhere warm to be pulled out of and returned to. So this room is
 * deliberately the only warm-lit space in the game — torchlight, wood, no fog.
 *
 * Built from primitives at real scale. The Quaternius dungeon kit lands with the procedural
 * generator in Sprint 2.1, and this room's layout is the brief for it: a proper room with a
 * door, a shop counter and a place to stand, not a corridor.
 */

const ROOM_WIDTH = 10
const ROOM_DEPTH = 12
const WALL_HEIGHT = 3.4
const WALL_THICKNESS = 0.3

/** The doorway is cut into the -Z wall, which the player spawns facing. */
const DOOR_GAP = 1.3
const DOORWAY_X = 0

const STONE = '#3b3730'
const STONE_DARK = '#2e2b26'
const WOOD = '#4a3722'

export function Foyer() {
  const halfW = ROOM_WIDTH / 2
  const halfD = ROOM_DEPTH / 2

  return (
    <group>
      {/* Floor and ceiling. The ceiling matters more than it sounds: an open-topped room
          reads as a film set in VR, and the torchlight has nothing to bounce off. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[ROOM_WIDTH, ROOM_DEPTH]} />
        <meshStandardMaterial color={STONE} roughness={1} />
      </mesh>
      <mesh position={[0, WALL_HEIGHT, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[ROOM_WIDTH, ROOM_DEPTH]} />
        <meshStandardMaterial color={STONE_DARK} roughness={1} />
      </mesh>

      {/* A slab, not the visual plane: the floor is the one surface that must never be
          passed through, and a zero-thickness collider is something a fast body can end up
          on the wrong side of. */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[halfW, 0.5, halfD]} position={[0, -0.5, 0]} />
        <CuboidCollider args={[halfW, 0.5, halfD]} position={[0, WALL_HEIGHT + 0.5, 0]} />
      </RigidBody>

      <RigidBody type="fixed" colliders="cuboid">
        {/* Back wall, side walls. */}
        <Wall position={[0, WALL_HEIGHT / 2, halfD]} size={[ROOM_WIDTH, WALL_HEIGHT]} />
        <Wall
          position={[-halfW, WALL_HEIGHT / 2, 0]}
          size={[ROOM_DEPTH, WALL_HEIGHT]}
          rotation={Math.PI / 2}
        />
        <Wall
          position={[halfW, WALL_HEIGHT / 2, 0]}
          size={[ROOM_DEPTH, WALL_HEIGHT]}
          rotation={Math.PI / 2}
        />

        {/* Front wall, in two pieces with the doorway between them, plus a lintel. */}
        <Wall
          position={[
            (DOORWAY_X - DOOR_GAP / 2 - halfW) / 2,
            WALL_HEIGHT / 2,
            -halfD,
          ]}
          size={[halfW + DOORWAY_X - DOOR_GAP / 2, WALL_HEIGHT]}
        />
        <Wall
          position={[
            (DOORWAY_X + DOOR_GAP / 2 + halfW) / 2,
            WALL_HEIGHT / 2,
            -halfD,
          ]}
          size={[halfW - DOORWAY_X - DOOR_GAP / 2, WALL_HEIGHT]}
        />
        <Wall
          position={[DOORWAY_X, (WALL_HEIGHT + 2.35) / 2, -halfD]}
          size={[DOOR_GAP, WALL_HEIGHT - 2.35]}
        />
      </RigidBody>

      {/* Hinged at the left edge of the gap, swinging into the dark. */}
      <Door position={[DOORWAY_X - DOOR_GAP / 2 + 0.1, 0, -halfD]} />
      <Vestibule />

      <Torches />
      <ShopCounter />
    </group>
  )
}

/**
 * A short dead-end passage on the far side of the door.
 *
 * Two jobs. It gives the door somewhere to swing into, and it means opening the door reveals
 * a dark passage rather than the outside of the level — without it the player walks through
 * their first door and falls out of the world, which is a poor introduction to a dungeon.
 *
 * The generated dungeon replaces it in Sprint 2.1. Until then it is the only part of the
 * game that is meant to feel unwelcoming, so it is unlit on purpose.
 */
function Vestibule() {
  const depth = 3.5
  const width = 2.6
  const height = 2.6
  const zCentre = -ROOM_DEPTH / 2 - depth / 2

  return (
    <RigidBody type="fixed" colliders="cuboid">
      <mesh position={[DOORWAY_X, -0.15, zCentre]} receiveShadow>
        <boxGeometry args={[width, 0.3, depth]} />
        <meshStandardMaterial color={STONE_DARK} roughness={1} />
      </mesh>
      <mesh position={[DOORWAY_X, height + 0.15, zCentre]}>
        <boxGeometry args={[width, 0.3, depth]} />
        <meshStandardMaterial color="#191713" roughness={1} />
      </mesh>
      <mesh position={[DOORWAY_X, height / 2, zCentre - depth / 2]} receiveShadow>
        <boxGeometry args={[width, height, 0.3]} />
        <meshStandardMaterial color="#221f1b" roughness={1} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={[DOORWAY_X + (side * width) / 2, height / 2, zCentre]}
          receiveShadow
        >
          <boxGeometry args={[0.3, height, depth]} />
          <meshStandardMaterial color="#221f1b" roughness={1} />
        </mesh>
      ))}
    </RigidBody>
  )
}

function Wall({
  position,
  size,
  rotation = 0,
}: {
  position: [number, number, number]
  size: [number, number]
  rotation?: number
}) {
  return (
    <mesh position={position} rotation={[0, rotation, 0]} castShadow receiveShadow>
      <boxGeometry args={[size[0], size[1], WALL_THICKNESS]} />
      <meshStandardMaterial color={STONE} roughness={0.95} />
    </mesh>
  )
}

/** Wall-mounted torches. Warm, moving light — the whole mood of the room. */
function Torches() {
  const half = ROOM_WIDTH / 2 - 0.25
  const placements: Array<{ position: [number, number, number]; seed: number }> = [
    { position: [-half, 2.2, -3], seed: 0 },
    { position: [half, 2.2, -3], seed: 1 },
    { position: [-half, 2.2, 2], seed: 2 },
    { position: [half, 2.2, 2], seed: 3 },
  ]

  return (
    <>
      {placements.map(({ position, seed }) => (
        <Torch key={seed} position={position} seed={seed} />
      ))}
    </>
  )
}

/**
 * Candela. Bright, deliberately.
 *
 * The foyer is the one room in the game that is supposed to feel safe, and the whole design
 * depends on the contrast when the player steps through that door into the dark. A dim
 * foyer costs the dungeon its impact. The torches past the door will be a fraction of this.
 */
const TORCH_INTENSITY = 18
const TORCH_COLOUR = '#ff9d4a'

function Torch({ position, seed }: { position: [number, number, number]; seed: number }) {
  const light = useRef<PointLight>(null)

  useFixedUpdate(
    (_dt, elapsed) => {
      if (light.current) light.current.intensity = TORCH_INTENSITY * flicker(elapsed, seed)
    },
    SystemOrder.Effects,
    [seed],
  )

  return (
    <group position={position}>
      {/* Bracket. */}
      <mesh castShadow>
        <boxGeometry args={[0.12, 0.5, 0.12]} />
        <meshStandardMaterial color="#2b2b30" roughness={0.6} metalness={0.7} />
      </mesh>
      {/* The flame itself is emissive geometry, not a light. Emissive is free; lights are
          the single most expensive thing in a scene on a Quest. */}
      <mesh position={[0, 0.3, 0]}>
        <sphereGeometry args={[0.09, 10, 8]} />
        <meshStandardMaterial
          color="#ffcf8a"
          emissive={TORCH_COLOUR}
          emissiveIntensity={4}
          toneMapped={false}
        />
      </mesh>
      <pointLight
        ref={light}
        position={[0, 0.3, 0]}
        color={TORCH_COLOUR}
        intensity={TORCH_INTENSITY}
        distance={14}
        decay={2}
        castShadow={false}
      />
    </group>
  )
}

const BELL_GLOW_IDLE = 0.3
const BELL_RING_SECONDS = 1.1

/** Emissive is on the material, and the material is shared by nothing else here. */
function setBellGlow(mesh: Mesh, intensity: number): void {
  const material = mesh.material as MeshStandardMaterial
  material.emissiveIntensity = intensity
}

/**
 * The shop counter. Furniture for now — Sprint 1.3 puts the weapon dialog on it.
 *
 * The bell is registered as a second interactable on purpose: an interaction system with
 * exactly one target in the world proves nothing about whether it picks the *right* one.
 */
function ShopCounter() {
  const position = useMemo<[number, number, number]>(() => [3.4, 0, 3.2], [])
  const bellMesh = useRef<Mesh>(null)

  /**
   * Seconds since the bell was last struck, or null.
   *
   * It needs to *visibly* do something. A console line is no answer at all in a headset —
   * the player presses the thing, nothing moves, and the reasonable conclusion is that the
   * game is broken. Audio would be the real answer and arrives in Sprint 3.2; until then it
   * rocks and glows, which is enough to say "yes, that worked, there is just nobody home".
   */
  const struck = useRef<number | null>(null)

  const bell = useMemo<Interactable>(
    () => ({
      id: 'shop-bell',
      position: { x: position[0] - 0.5, y: 1.02, z: position[2] - 0.35 },
      radius: 0.16,
      label: 'Ring the bell',
      enabled: true,
      onActivate: () => {
        struck.current = 0
        console.info('The shopkeeper is out. Weapons arrive in Sprint 1.3.')
      },
    }),
    [position],
  )

  useFixedUpdate((dt) => {
    const mesh = bellMesh.current
    if (!mesh || struck.current === null) return

    struck.current += dt
    const t = struck.current
    if (t > BELL_RING_SECONDS) {
      struck.current = null
      mesh.rotation.z = 0
      mesh.position.y = 1.02
      setBellGlow(mesh, BELL_GLOW_IDLE)
      return
    }

    // A decaying wobble, as if it had been knocked. Fast enough to read as a strike rather
    // than as the bell wandering off on its own.
    const decay = 1 - t / BELL_RING_SECONDS
    mesh.rotation.z = Math.sin(t * 34) * 0.28 * decay * decay
    mesh.position.y = 1.02 + Math.abs(Math.sin(t * 34)) * 0.012 * decay
    setBellGlow(mesh, BELL_GLOW_IDLE + 2.2 * decay * decay)
  }, SystemOrder.Effects)

  useEffect(() => registerInteractable(bell), [bell])

  return (
    <group position={position}>
      <RigidBody type="fixed" colliders="cuboid">
        <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
          <boxGeometry args={[2.4, 1, 0.8]} />
          <meshStandardMaterial color={WOOD} roughness={0.85} />
        </mesh>
      </RigidBody>
      <mesh ref={bellMesh} position={[-0.5, 1.02, -0.35]} castShadow>
        <sphereGeometry args={[0.08, 12, 10]} />
        <meshStandardMaterial
          color="#7a6230"
          emissive="#c98a3a"
          emissiveIntensity={BELL_GLOW_IDLE}
          metalness={0.8}
          roughness={0.35}
        />
      </mesh>
    </group>
  )
}

export const FOYER_BOUNDS = { width: ROOM_WIDTH, depth: ROOM_DEPTH }
