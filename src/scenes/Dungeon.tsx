import { useEffect, useMemo, useRef } from 'react'
import { CuboidCollider, RigidBody } from '@react-three/rapier'
import { InstancedMesh, Matrix4, Object3D, PointLight, Vector3 } from 'three'
import { SystemOrder } from '@/core/loop'
import { useFixedUpdate } from '@/core/simulation'
import { playerState } from '@/systems/player'
import { flicker } from '@/systems/torch'
import { CELL_SIZE, Tile, WALL_HEIGHT, type DungeonMap } from '@/systems/dungeon/generate'
import { placedCellToWorld, useDungeon, type DungeonPlacement } from '@/systems/dungeon/store'

/**
 * The generated dungeon, as geometry.
 *
 * Everything here is driven by the same grid the pathfinder and the validator read, so what
 * the player walks into is what they can see and what an enemy will route around. A renderer
 * with its own idea of where the walls are is a renderer that will eventually disagree with
 * the physics, and that disagreement is invisible until somebody walks through a wall.
 *
 * Three costs are managed up front, because they are the ones that decide whether a Quest 3
 * holds 72fps:
 *
 * - **Draw calls.** Floors, walls and ceilings are three instanced meshes, not a few thousand
 *   objects. The whole level is three draws.
 * - **Colliders.** Runs of adjacent wall cells are merged into strips, which turns ~800
 *   cuboids into a couple of hundred.
 * - **Lights.** A level has seventy-odd torches and can afford four real ones. The nearest
 *   few get a point light; the rest are emissive geometry, which costs nothing and still
 *   reads as fire at a distance. Sprint 3.1 owns this properly — this is the honest minimum.
 */

/** How many torches may be real lights at once. The single most expensive thing in a frame. */
const LIT_TORCHES = 4

/**
 * Candela, with quadratic falloff — so this number is much larger than it looks.
 *
 * The foyer's torches are 18 in a 10m room where four of them overlap. Here they stand alone
 * about 8m apart, and 1/d² means a torch that reads well at 3m contributes almost nothing at
 * 10. Tuned by walking the level: at 7 the corridors were not atmospheric, they were unlit.
 * Sprint 3.1 owns the real lighting pass.
 */
const TORCH_INTENSITY = 24
const TORCH_COLOUR = '#ff9d4a'

/**
 * How far a torch may be from the player and still be worth lighting, in metres.
 *
 * Wider than it first looks it needs to be: torches sit about 8m apart, so a range that only
 * just covers that leaves a player standing between two of them in complete darkness. The
 * first pass had this at 9m and the corridors were unnavigable — not atmospheric, unusable.
 */
const TORCH_RANGE = 14

// Lighter than they look in daylight, on purpose: a near-black wall under a torch is still
// near-black, and the level has to be readable by the light it actually has.
const STONE = '#3a3630'
const STONE_DARK = '#1a1816'
const FLOOR = '#302c28'

export function Dungeon() {
  const map = useDungeon((state) => state.map)
  const offset = useDungeon((state) => state.offset)
  const nav = useDungeon((state) => state.nav)

  if (!map || !offset || !nav) return null
  // Keyed by seed so a new wave rebuilds the instanced meshes from scratch rather than
  // trying to reconcile one level's geometry into another's.
  return <Level key={map.seed} placement={{ map, offset, nav }} />
}

function Level({ placement }: { placement: DungeonPlacement }) {
  const { map } = placement

  const floors = useRef<InstancedMesh>(null)
  const walls = useRef<InstancedMesh>(null)
  const ceilings = useRef<InstancedMesh>(null)

  const cells = useMemo(() => collectCells(map), [map])
  const strips = useMemo(() => mergeWallStrips(map), [map])

  // Instance transforms are written once: the level does not move. Doing it in a layout
  // effect rather than per frame is the difference between three draw calls and a per-frame
  // upload of a few thousand matrices.
  useEffect(() => {
    const dummy = new Object3D()
    const place = (
      mesh: InstancedMesh | null,
      list: Array<{ x: number; y: number }>,
      height: number,
    ) => {
      if (!mesh) return
      list.forEach((cell, index) => {
        const world = placedCellToWorld(placement, cell.x, cell.y)
        dummy.position.set(world.x, height, world.z)
        dummy.updateMatrix()
        mesh.setMatrixAt(index, dummy.matrix)
      })
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
    }

    // Floor slabs hang *below* y=0 so their top surface is flush with the foyer's floor —
    // otherwise the join at the passage is a five-centimetre lip to trip over.
    place(floors.current, cells.floors, -0.05)
    place(walls.current, cells.walls, WALL_HEIGHT / 2)
    place(ceilings.current, cells.floors, WALL_HEIGHT)
  }, [cells, placement])

  return (
    <group>
      <instancedMesh
        ref={floors}
        args={[undefined, undefined, cells.floors.length]}
        receiveShadow
      >
        <boxGeometry args={[CELL_SIZE, 0.1, CELL_SIZE]} />
        <meshStandardMaterial color={FLOOR} roughness={1} />
      </instancedMesh>

      <instancedMesh
        ref={walls}
        args={[undefined, undefined, cells.walls.length]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[CELL_SIZE, WALL_HEIGHT, CELL_SIZE]} />
        <meshStandardMaterial color={STONE} roughness={0.95} />
      </instancedMesh>

      {/* A ceiling matters more than it sounds: an open-topped level reads as a film set in
          VR, and the torchlight has nothing above it to bounce off. */}
      <instancedMesh ref={ceilings} args={[undefined, undefined, cells.floors.length]}>
        <boxGeometry args={[CELL_SIZE, 0.1, CELL_SIZE]} />
        <meshStandardMaterial color={STONE_DARK} roughness={1} />
      </instancedMesh>

      <Colliders placement={placement} strips={strips} />
      <Torches placement={placement} />
    </group>
  )
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

function collectCells(map: DungeonMap) {
  const floors: Array<{ x: number; y: number }> = []
  const walls: Array<{ x: number; y: number }> = []
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const tile = map.tiles[y * map.width + x]
      if (tile === Tile.Floor) floors.push({ x, y })
      else if (tile === Tile.Wall) walls.push({ x, y })
    }
  }
  return { floors, walls }
}

interface Strip {
  /** Cell coordinates of the run's start. */
  x: number
  y: number
  /** Length in cells, along +x. */
  length: number
}

/**
 * Merge horizontal runs of wall cells into strips.
 *
 * One collider per wall cell is a few hundred bodies for Rapier to broad-phase every step,
 * for geometry that never moves. Runs along a corridor collapse to a handful.
 */
function mergeWallStrips(map: DungeonMap): Strip[] {
  const strips: Strip[] = []
  for (let y = 0; y < map.height; y++) {
    let start = -1
    for (let x = 0; x <= map.width; x++) {
      const solid = x < map.width && map.tiles[y * map.width + x] === Tile.Wall
      if (solid && start === -1) start = x
      if (!solid && start !== -1) {
        strips.push({ x: start, y, length: x - start })
        start = -1
      }
    }
  }
  return strips
}

function Colliders({ placement, strips }: { placement: DungeonPlacement; strips: Strip[] }) {
  const { map } = placement
  const half = { x: (map.width * CELL_SIZE) / 2, z: (map.height * CELL_SIZE) / 2 }
  const middle = placedCellToWorld(placement, map.width / 2 - 0.5, map.height / 2 - 0.5)

  return (
    <RigidBody type="fixed" colliders={false}>
      {/* Floor and ceiling as two slabs across the whole grid. Solid rock is unreachable
          anyway, so there is nothing to be gained by cutting them to shape — and a
          zero-thickness floor is something a fast body ends up on the wrong side of. */}
      <CuboidCollider args={[half.x, 0.5, half.z]} position={[middle.x, -0.5, middle.z]} />
      <CuboidCollider
        args={[half.x, 0.5, half.z]}
        position={[middle.x, WALL_HEIGHT + 0.5, middle.z]}
      />

      {strips.map((strip) => {
        const from = placedCellToWorld(placement, strip.x, strip.y)
        const width = (strip.length * CELL_SIZE) / 2
        return (
          <CuboidCollider
            key={`${strip.x}-${strip.y}`}
            args={[width, WALL_HEIGHT / 2, CELL_SIZE / 2]}
            position={[from.x - CELL_SIZE / 2 + width, WALL_HEIGHT / 2, from.z]}
          />
        )
      })}
    </RigidBody>
  )
}

// ---------------------------------------------------------------------------
// Light
// ---------------------------------------------------------------------------

/**
 * Torch flames everywhere, real lights only where the player is.
 *
 * The flames are one instanced mesh of emissive spheres — free, and visible at any distance,
 * which is what makes a corridor readable before you are in it. A small pool of point lights
 * is then moved onto whichever torches are nearest, once per fixed step.
 *
 * Moving lights rather than mounting them per torch is deliberate: creating and destroying
 * lights re-compiles every material that they touch, which on a Quest is a visible hitch
 * every few steps as the player walks.
 */
function Torches({ placement }: { placement: DungeonPlacement }) {
  const { map } = placement
  const flames = useRef<InstancedMesh>(null)
  const lights = useRef<Array<PointLight | null>>([])

  const positions = useMemo(
    () =>
      map.torches.map((torch) => {
        const world = placedCellToWorld(placement, torch.x, torch.y)
        // Mounted on the face of the wall, not in the middle of it, and above head height.
        return new Vector3(
          world.x + torch.dx * (CELL_SIZE / 2 - 0.12),
          2.2,
          world.z + torch.dy * (CELL_SIZE / 2 - 0.12),
        )
      }),
    [map, placement],
  )

  useEffect(() => {
    const mesh = flames.current
    if (!mesh) return
    const matrix = new Matrix4()
    positions.forEach((position, index) => {
      matrix.makeTranslation(position.x, position.y, position.z)
      mesh.setMatrixAt(index, matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [positions])

  const scratch = useMemo(() => ({ nearest: [] as Array<{ index: number; distance: number }> }), [])

  useFixedUpdate(
    (_dt, elapsed) => {
      const { x, z } = playerState.position
      scratch.nearest.length = 0
      positions.forEach((position, index) => {
        const dx = position.x - x
        const dz = position.z - z
        scratch.nearest.push({ index, distance: dx * dx + dz * dz })
      })
      scratch.nearest.sort((a, b) => a.distance - b.distance)

      for (let slot = 0; slot < LIT_TORCHES; slot++) {
        const light = lights.current[slot]
        if (!light) continue
        const pick = scratch.nearest[slot]
        // Out of range as well as out of budget: a light dragged across the level to a torch
        // forty metres away lights nothing and still costs a shadowless full pass.
        if (!pick || pick.distance > TORCH_RANGE * TORCH_RANGE) {
          light.intensity = 0
          continue
        }
        const position = positions[pick.index] as Vector3
        light.position.copy(position)
        light.intensity = TORCH_INTENSITY * flicker(elapsed, pick.index)
      }
    },
    SystemOrder.Effects,
    [positions],
  )

  return (
    <group>
      <instancedMesh args={[undefined, undefined, positions.length]} ref={flames}>
        <sphereGeometry args={[0.09, 8, 6]} />
        {/* Emissive and un-tone-mapped, so a flame reads as fire rather than as a grey ball
            in a room with no light in it. */}
        <meshStandardMaterial
          color="#ffcf8a"
          emissive={TORCH_COLOUR}
          emissiveIntensity={4}
          toneMapped={false}
        />
      </instancedMesh>

      {Array.from({ length: LIT_TORCHES }, (_, slot) => (
        <pointLight
          key={slot}
          ref={(light) => {
            lights.current[slot] = light
          }}
          color={TORCH_COLOUR}
          intensity={0}
          distance={TORCH_RANGE * 1.6}
          decay={2}
          castShadow={false}
        />
      ))}
    </group>
  )
}
