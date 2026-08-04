import { useEffect, useMemo, useRef } from 'react'
import { CuboidCollider, RigidBody } from '@react-three/rapier'
import { AdditiveBlending, InstancedMesh, Matrix4, Object3D, PointLight, Vector3 } from 'three'
import { SystemOrder } from '@/core/loop'
import { useFixedUpdate } from '@/core/simulation'
import { playerState } from '@/systems/player'
import {
  assignLightSlots,
  DROP_SECONDS,
  HOLD_FRACTION,
  rangeFalloff,
  stepLightSlot,
  type LightSlot,
} from '@/systems/lightPool'
import { flicker } from '@/systems/torch'
import { CELL_SIZE, Tile, WALL_HEIGHT, type DungeonMap } from '@/systems/dungeon/generate'
import { placedCellToWorld, useDungeon, type DungeonPlacement } from '@/systems/dungeon/store'
import { loadWallTexture, useTiledWallMaterial } from '@/systems/environment/textures'

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

/**
 * How many torches may be real lights at once. The single most expensive thing in a frame.
 *
 * Four was too few to be honest about: torches stand ~8m apart, so four lights cover roughly
 * one room, and the fifth torch in a big room stayed dark until the player walked far enough
 * in to displace one. Six is still a small number of forward lights and buys most of a large
 * room at once. Sprint 3.1 profiles this on the headset and sets it properly.
 */
const LIT_TORCHES = 6

/**
 * How far the flame stands clear of the wall face, in metres.
 *
 * Measured from the face, not from the cell centre — see the comment where it is applied.
 */
const FLAME_CLEARANCE = 0.18

/** Above head height, below the three-metre ceiling. */
const TORCH_HEIGHT = 2.2

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

  useEffect(() => {
    loadWallTexture()
  }, [])

  // Every wall cell is the same box, so one tiling — rather than one clone per instance — is
  // correct here. `Foyer.tsx` is the case where sizes differ and cloning earns its keep.
  const wallMaps = useTiledWallMaterial(CELL_SIZE, WALL_HEIGHT)

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
        {/*
          Keyed on whether the textures have arrived, same reason as in Foyer: a
          `meshStandardMaterial` first mounted without a `map` caches a shader compiled
          without `USE_MAP`, so a texture assigned later is bound to the GPU but never
          sampled. A player who opens the door before the foyer finishes loading its
          textures would otherwise see flat dungeon walls that never pick up the stone.
        */}
        <meshStandardMaterial
          key={wallMaps ? 'textured' : 'flat'}
          color={wallMaps ? '#ffffff' : STONE}
          map={wallMaps?.map}
          normalMap={wallMaps?.normalMap}
          roughnessMap={wallMaps?.roughnessMap}
          roughness={wallMaps ? 1 : 0.95}
        />
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
    <>
      {/* Floor and ceiling as two slabs across the whole grid, in their own rigid body so
          the wall strip can carry its own user data (see below). Solid rock is unreachable
          anyway, so there is nothing to be gained by cutting them to shape — and a
          zero-thickness floor is something a fast body ends up on the wrong side of. */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[half.x, 0.5, half.z]} position={[middle.x, -0.5, middle.z]} />
        <CuboidCollider
          args={[half.x, 0.5, half.z]}
          position={[middle.x, WALL_HEIGHT + 0.5, middle.z]}
        />
      </RigidBody>

      {/* All wall strips share one rigid body, so a single `userData.grippable` flag covers
          every climbable surface in the dungeon. Future hazards (lava, magical barriers)
          live in their own rigid body with `grippable: false` — the gorilla module reads the
          flag from `collider.parent()` and refuses a grip on anything that does not carry
          it. Splitting walls out from the floor costs Rapier one extra body, which is the
          price of being able to mark a *class* of colliders climbable rather than each one
          individually. */}
      <RigidBody type="fixed" colliders={false} userData={{ grippable: true }}>
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
    </>
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
  const halos = useRef<InstancedMesh>(null)
  const brackets_ = useRef<InstancedMesh>(null)
  const lights = useRef<Array<PointLight | null>>([])

  const positions = useMemo(
    () =>
      map.torches.map((torch) => {
        const world = placedCellToWorld(placement, torch.x, torch.y)
        // `world` is the *wall cell's* centre, and the wall's face is half a cell along the
        // direction the torch points, so the flame has to sit further out than that — not
        // nearer. The first pass subtracted the clearance instead of adding it and buried
        // every flame twelve centimetres inside solid rock, which in a headset reads as
        // torches mounted on the far side of the wall.
        const out = CELL_SIZE / 2 + FLAME_CLEARANCE
        return new Vector3(world.x + torch.dx * out, TORCH_HEIGHT, world.z + torch.dy * out)
      }),
    [map, placement],
  )

  // The bracket bridges the gap back to the wall, so a flame reads as something mounted
  // rather than as a ball hanging in mid-air.
  const brackets = useMemo(
    () =>
      map.torches.map((torch) => {
        const world = placedCellToWorld(placement, torch.x, torch.y)
        const out = CELL_SIZE / 2 + FLAME_CLEARANCE / 2
        return {
          // Below the flame, not behind it: an unlit bracket sitting inside the glow is a
          // black notch in the middle of a fire, which reads as a hole rather than a sconce.
          position: new Vector3(
            world.x + torch.dx * out,
            TORCH_HEIGHT - 0.26,
            world.z + torch.dy * out,
          ),
          angle: Math.atan2(torch.dx, torch.dy),
        }
      }),
    [map, placement],
  )

  useEffect(() => {
    const matrix = new Matrix4()
    for (const mesh of [flames.current, halos.current]) {
      if (!mesh) continue
      positions.forEach((position, index) => {
        matrix.makeTranslation(position.x, position.y, position.z)
        mesh.setMatrixAt(index, matrix)
      })
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
    }

    const mesh = brackets_.current
    if (!mesh) return
    const dummy = new Object3D()
    brackets.forEach((bracket, index) => {
      dummy.position.copy(bracket.position)
      dummy.rotation.set(0, bracket.angle, 0)
      dummy.updateMatrix()
      mesh.setMatrixAt(index, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [positions, brackets])

  const scratch = useMemo(
    () => ({
      distances: [] as number[],
      wanted: new Array<number | null>(LIT_TORCHES).fill(null),
      slots: Array.from({ length: LIT_TORCHES }, () => ({
        torch: null,
        intensity: 0,
      })) as LightSlot[],
    }),
    [],
  )

  useFixedUpdate(
    (dt, elapsed) => {
      const { x, z } = playerState.position
      scratch.distances.length = positions.length
      positions.forEach((position, index) => {
        const dx = position.x - x
        const dz = position.z - z
        scratch.distances[index] = Math.sqrt(dx * dx + dz * dz)
      })

      // Which torches deserve a light — subject to hysteresis, so this answer is stable as
      // the player turns rather than re-sorting under them.
      scratch.wanted = assignLightSlots(
        scratch.slots.map((slot) => slot.torch),
        scratch.distances,
        LIT_TORCHES,
        TORCH_RANGE * HOLD_FRACTION,
        TORCH_RANGE,
      )

      for (let index = 0; index < LIT_TORCHES; index++) {
        const light = lights.current[index]
        if (!light) continue
        const want = scratch.wanted[index] ?? null

        // The slow, proximity-driven envelope — no flicker in it. Flicker is fast and this
        // ramp is deliberately slow; folding one into the other either smears the fire into
        // mush or lets the pop back in through the flicker's own speed. See lightPool.ts.
        const envelope =
          want == null
            ? 0
            : TORCH_INTENSITY * rangeFalloff(scratch.distances[want] as number, TORCH_RANGE)

        const before = scratch.slots[index] as LightSlot
        const slot = stepLightSlot(before, want, envelope, dt, TORCH_INTENSITY / DROP_SECONDS)
        scratch.slots[index] = slot

        // Position follows the slot's own torch, not the wanted one: during a handover the
        // slot is still on the old torch, winding down where it stands. It only moves at zero.
        if (slot.torch != null) light.position.copy(positions[slot.torch] as Vector3)
        light.intensity = slot.torch == null ? 0 : slot.intensity * flicker(elapsed, slot.torch)
      }
    },
    SystemOrder.Effects,
    [positions],
  )

  return (
    <group>
      {/* Unlit stone: the bracket is only ever seen against its own torch. */}
      <instancedMesh args={[undefined, undefined, brackets.length]} ref={brackets_}>
        <boxGeometry args={[0.05, 0.3, FLAME_CLEARANCE]} />
        <meshStandardMaterial color={STONE_DARK} roughness={1} />
      </instancedMesh>

      <instancedMesh args={[undefined, undefined, positions.length]} ref={flames}>
        <sphereGeometry args={[0.13, 8, 6]} />
        {/* Emissive and un-tone-mapped, so a flame reads as fire rather than as a grey ball
            in a room with no light in it. */}
        <meshStandardMaterial
          color="#ffcf8a"
          emissive={TORCH_COLOUR}
          emissiveIntensity={5}
          toneMapped={false}
        />
      </instancedMesh>

      {/* The glow around the flame, and the reason a torch outside the light budget is still
          worth walking towards: it is visible at any distance for the cost of one more
          instanced draw, so a dark corridor still tells you where its torches are. Additive
          and depth-write-off so it never occludes the flame inside it. */}
      <instancedMesh args={[undefined, undefined, positions.length]} ref={halos}>
        <sphereGeometry args={[0.32, 8, 6]} />
        <meshBasicMaterial
          color={TORCH_COLOUR}
          transparent
          opacity={0.13}
          blending={AdditiveBlending}
          depthWrite={false}
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
