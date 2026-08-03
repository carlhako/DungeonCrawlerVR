import { makeRng, type Rng } from './rng'

/**
 * The dungeon generator: a seed in, a map out.
 *
 * Rooms are placed by rejection sampling, connected with a minimum spanning tree so that
 * *every* room is reachable by construction, and then given a few extra links so the result
 * is a place rather than a tree of dead ends. Corridors are L-shaped between room centres.
 *
 * Two rules shape all of it.
 *
 * **It must always be traversable.** A wave the player cannot finish because two rooms never
 * joined up is not a difficulty spike, it is a broken game, and in a dark dungeon it is
 * indistinguishable from being lost. So connectivity is not hoped for, it is built in and
 * then *checked* — `validate` flood-fills the finished grid and the generator retries a seed
 * that somehow fails.
 *
 * **The same seed is always the same dungeon.** Every random draw comes from one `Rng`
 * threaded through in a fixed order, so a level that goes wrong can be reproduced from a
 * single number. Nothing here may ever call `Math.random`.
 *
 * Geometry is grid cells; `CELL_SIZE` converts to metres. The renderer and the physics
 * colliders both read this same grid, so what you walk into is what you see.
 */

/** Metres per grid cell. A corridor is one cell wide; two people do not pass in one. */
export const CELL_SIZE = 2

/** Metres. Tall enough not to feel like a crawlspace in VR, low enough to feel underground. */
export const WALL_HEIGHT = 3

export const Tile = {
  /** Solid, unreachable, never rendered. */
  Rock: 0,
  /** Walkable. */
  Floor: 1,
  /** Solid rock that borders a floor: the surfaces the player actually sees. */
  Wall: 2,
} as const

export type TileValue = (typeof Tile)[keyof typeof Tile]

export interface Cell {
  x: number
  y: number
}

export interface Room {
  /** Cell coordinates of the top-left corner. */
  x: number
  y: number
  w: number
  h: number
}

export interface Torch {
  /** The wall cell the torch is mounted on. */
  x: number
  y: number
  /** Unit vector, in cells, from the wall into the room it lights. */
  dx: number
  dy: number
}

export interface DungeonMap {
  seed: number
  width: number
  height: number
  /** Row-major, `width * height` entries of `Tile`. */
  tiles: Uint8Array
  rooms: Room[]
  /** Where the player arrives, in the middle of the entry room's near edge. */
  entry: Cell
  /** The room the player arrives in. Nothing hostile starts here. */
  entryRoom: Room
  /** Candidate enemy spawn points, furthest-first. */
  spawns: Cell[]
  torches: Torch[]
}

export interface DungeonOptions {
  width: number
  height: number
  /** How many rooms to *attempt*. Rejection sampling means fewer usually land. */
  roomAttempts: number
  minRoom: number
  maxRoom: number
  /** Extra corridors beyond the spanning tree, as a fraction of the room count. */
  loopFactor: number
  /** Cells a spawn point must be from the entry, along the floor. */
  minSpawnDistance: number
  /** Minimum cells between two torches, along the floor. */
  torchSpacing: number
}

export const DEFAULT_OPTIONS: DungeonOptions = {
  // 40 cells at 2m is an 80m square of *possible* space; the rooms use a fraction of it.
  width: 40,
  height: 40,
  roomAttempts: 60,
  minRoom: 3,
  maxRoom: 7,
  // A pure spanning tree is all dead ends, which reads as a maze and plays as one. A few
  // loops give the player somewhere to run *to* when something is chasing them.
  loopFactor: 0.25,
  minSpawnDistance: 6,
  torchSpacing: 4,
}

/** The smallest dungeon worth calling one. Below this, `generate` retries with a new seed. */
const MIN_ROOMS = 5
const MIN_FLOOR_CELLS = 120

/**
 * Build a dungeon.
 *
 * Retries on a seed that fails validation rather than returning something broken: a caller
 * that has to handle "the dungeon didn't work" is a caller that will handle it by crashing
 * in front of a player wearing a headset. The retry is deterministic — seed, seed+1, … — so
 * the map for a given seed is still always the same map.
 */
export function generate(seed: number, options: Partial<DungeonOptions> = {}): DungeonMap {
  const settings = { ...DEFAULT_OPTIONS, ...options }
  for (let attempt = 0; attempt < 12; attempt++) {
    const map = build(seed + attempt, settings)
    if (validate(map).ok) return map
  }
  // Twelve consecutive failures means the options themselves are impossible — a 6x6 grid
  // asked for 5 rooms — and no seed will save it. Better to say so here than to hand back a
  // map that fails somewhere deep in the renderer.
  throw new Error(`could not generate a valid dungeon from seed ${seed}`)
}

function build(seed: number, options: DungeonOptions): DungeonMap {
  const rng = makeRng(seed)
  const { width, height } = options
  const tiles = new Uint8Array(width * height).fill(Tile.Rock)

  const rooms = placeRooms(rng, options)
  for (const room of rooms) carveRoom(tiles, width, room)

  for (const [a, b] of connections(rooms, rng, options.loopFactor)) {
    carveCorridor(tiles, width, height, rng, centre(a), centre(b))
  }

  markWalls(tiles, width, height)

  // The entry room is the one nearest the south edge, because that is the side the foyer
  // door is on. The player should walk in, not appear in the middle of the level.
  const entryRoom = rooms.reduce((best, room) =>
    room.y + room.h > best.y + best.h ? room : best,
  )
  const entry = { x: Math.floor(entryRoom.x + entryRoom.w / 2), y: entryRoom.y + entryRoom.h - 1 }

  const distances = floorDistances(tiles, width, height, entry)
  return {
    seed,
    width,
    height,
    tiles,
    rooms,
    entry,
    entryRoom,
    spawns: pickSpawns(rooms, entryRoom, distances, width, options),
    torches: placeTorches(tiles, width, height, options.torchSpacing),
  }
}

// ---------------------------------------------------------------------------
// Rooms and corridors
// ---------------------------------------------------------------------------

function placeRooms(rng: Rng, options: DungeonOptions): Room[] {
  const rooms: Room[] = []
  for (let i = 0; i < options.roomAttempts; i++) {
    const w = rng.int(options.minRoom, options.maxRoom)
    const h = rng.int(options.minRoom, options.maxRoom)
    // Inset by one so there is always rock left for a wall around the outside — a room
    // flush with the edge of the grid would open onto nothing.
    const x = rng.int(1, options.width - w - 2)
    const y = rng.int(1, options.height - h - 2)
    const room = { x, y, w, h }
    // A one-cell gap between rooms, so two rooms never share a wall and every doorway is a
    // corridor the player can see through.
    if (rooms.some((other) => overlaps(room, other, 1))) continue
    rooms.push(room)
  }
  return rooms
}

function overlaps(a: Room, b: Room, margin: number): boolean {
  return (
    a.x - margin < b.x + b.w &&
    a.x + a.w + margin > b.x &&
    a.y - margin < b.y + b.h &&
    a.y + a.h + margin > b.y
  )
}

function centre(room: Room): Cell {
  return { x: Math.floor(room.x + room.w / 2), y: Math.floor(room.y + room.h / 2) }
}

/**
 * Which rooms to join.
 *
 * A minimum spanning tree over the room centres, so every room is reachable and no corridor
 * is redundant, plus a few extra edges between near neighbours for loops. Prim's, because
 * with a few dozen rooms the O(n²) is free and the code is short enough to read.
 */
function connections(rooms: Room[], rng: Rng, loopFactor: number): Array<[Room, Room]> {
  if (rooms.length < 2) return []

  const edges: Array<[Room, Room]> = []
  const linked = [rooms[0] as Room]
  const remaining = rooms.slice(1)

  while (remaining.length > 0) {
    let best = { from: 0, to: 0, distance: Infinity }
    linked.forEach((from, i) => {
      remaining.forEach((to, j) => {
        const d = distance(centre(from), centre(to))
        if (d < best.distance) best = { from: i, to: j, distance: d }
      })
    })
    const from = linked[best.from] as Room
    const [to] = remaining.splice(best.to, 1) as [Room]
    edges.push([from, to])
    linked.push(to)
  }

  // Extra links, picked from the shortest non-adjacent pairs so a loop is a shortcut rather
  // than a corridor across the entire level.
  const extras = Math.round(rooms.length * loopFactor)
  const candidates: Array<{ pair: [Room, Room]; distance: number }> = []
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i] as Room
      const b = rooms[j] as Room
      if (edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) continue
      candidates.push({ pair: [a, b], distance: distance(centre(a), centre(b)) })
    }
  }
  candidates.sort((p, q) => p.distance - q.distance)
  for (const { pair } of rng.shuffle(candidates.slice(0, extras * 3)).slice(0, extras)) {
    edges.push(pair)
  }

  return edges
}

function distance(a: Cell, b: Cell): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
}

function carveRoom(tiles: Uint8Array, width: number, room: Room): void {
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) tiles[y * width + x] = Tile.Floor
  }
}

/** An L: along x then y, or y then x. Which one is the coin-flip that gives a level shape. */
function carveCorridor(
  tiles: Uint8Array,
  width: number,
  height: number,
  rng: Rng,
  from: Cell,
  to: Cell,
): void {
  const horizontalFirst = rng.chance(0.5)
  const corner = horizontalFirst ? { x: to.x, y: from.y } : { x: from.x, y: to.y }
  carveLine(tiles, width, height, from, corner)
  carveLine(tiles, width, height, corner, to)
}

function carveLine(
  tiles: Uint8Array,
  width: number,
  height: number,
  from: Cell,
  to: Cell,
): void {
  const stepX = Math.sign(to.x - from.x)
  const stepY = Math.sign(to.y - from.y)
  let { x, y } = from
  for (;;) {
    // Never carve the outermost ring: the level has to stay sealed.
    if (x > 0 && y > 0 && x < width - 1 && y < height - 1) tiles[y * width + x] = Tile.Floor
    if (x === to.x && y === to.y) break
    if (x !== to.x) x += stepX
    else y += stepY
  }
}

/** Every rock cell touching a floor cell — including diagonally, or corners show daylight. */
function markWalls(tiles: Uint8Array, width: number, height: number): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x
      if (tiles[index] !== Tile.Rock) continue
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          if (tiles[ny * width + nx] === Tile.Floor) {
            tiles[index] = Tile.Wall
            dy = 2
            break
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Spawns, torches, distances
// ---------------------------------------------------------------------------

/**
 * Breadth-first distance in cells from `origin` to every floor cell.
 *
 * Also the connectivity check: anything left at -1 cannot be walked to.
 */
export function floorDistances(
  tiles: Uint8Array,
  width: number,
  height: number,
  origin: Cell,
): Int32Array {
  const distances = new Int32Array(width * height).fill(-1)
  const start = origin.y * width + origin.x
  if (tiles[start] !== Tile.Floor) return distances

  distances[start] = 0
  const queue = [start]
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head] as number
    const x = index % width
    const y = (index - x) / width
    const step = (distances[index] as number) + 1
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const next = ny * width + nx
      if (tiles[next] !== Tile.Floor || distances[next] !== -1) continue
      distances[next] = step
      queue.push(next)
    }
  }
  return distances
}

const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

/**
 * Where enemies may appear, furthest from the entry first.
 *
 * Never in the entry room, and never within `minSpawnDistance` of the arrival point: the
 * player has to be allowed a moment to work out where they are before something bites them.
 * Ordered rather than filtered, so the Wave Director in 2.3 can take the far ones first and
 * fall back inwards as a wave grows.
 */
function pickSpawns(
  rooms: Room[],
  entryRoom: Room,
  distances: Int32Array,
  width: number,
  options: DungeonOptions,
): Cell[] {
  const spawns: Array<{ cell: Cell; distance: number }> = []
  for (const room of rooms) {
    if (room === entryRoom) continue
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        const d = distances[y * width + x] as number
        if (d < options.minSpawnDistance) continue
        spawns.push({ cell: { x, y }, distance: d })
      }
    }
  }
  spawns.sort((a, b) => b.distance - a.distance)
  return spawns.map((entry) => entry.cell)
}

/**
 * Torches on wall cells, spaced out.
 *
 * These are the only light in the game, so their placement *is* the level's readability.
 * Walls facing into a room get them; the spacing keeps the dark stretches between them,
 * which is the entire point of a torch-lit dungeon.
 */
function placeTorches(
  tiles: Uint8Array,
  width: number,
  height: number,
  spacing: number,
): Torch[] {
  const torches: Torch[] = []
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (tiles[y * width + x] !== Tile.Wall) continue
      // Which way it faces: the one orthogonal neighbour that is floor. A wall cell with
      // two or more open sides is a corner, and a torch there sticks out of thin air.
      const open = NEIGHBOURS.filter(
        ([dx, dy]) => tiles[(y + dy) * width + (x + dx)] === Tile.Floor,
      )
      if (open.length !== 1) continue
      if (torches.some((t) => Math.abs(t.x - x) + Math.abs(t.y - y) < spacing)) continue
      const [dx, dy] = open[0] as readonly [number, number]
      torches.push({ x, y, dx, dy })
    }
  }
  return torches
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface Validation {
  ok: boolean
  reasons: string[]
  floorCells: number
  reachableCells: number
}

/**
 * Everything that has to be true of a finished map.
 *
 * This is the test the 20-seed acceptance run drives, and the same check `generate` uses to
 * decide whether to retry — so a dungeon that ships is a dungeon that passed.
 */
export function validate(map: DungeonMap): Validation {
  const reasons: string[] = []
  const { tiles, width, height } = map

  let floorCells = 0
  for (const tile of tiles) if (tile === Tile.Floor) floorCells++

  const distances = floorDistances(tiles, width, height, map.entry)
  let reachableCells = 0
  for (const d of distances) if (d >= 0) reachableCells++

  if (map.rooms.length < MIN_ROOMS) reasons.push(`only ${map.rooms.length} rooms`)
  if (floorCells < MIN_FLOOR_CELLS) reasons.push(`only ${floorCells} floor cells`)
  if (tiles[map.entry.y * width + map.entry.x] !== Tile.Floor) {
    reasons.push('the entry is not on a floor cell')
  }
  if (reachableCells !== floorCells) {
    reasons.push(`${floorCells - reachableCells} floor cells are walled off`)
  }
  // A room the player can see into but never enter is the same bug wearing a hat: the flood
  // fill above would pass if the unreachable part were a corridor stub rather than a room.
  for (const room of map.rooms) {
    const c = centre(room)
    if (distances[c.y * width + c.x] === -1) {
      reasons.push(`the room at ${room.x},${room.y} cannot be reached`)
      break
    }
  }
  if (map.spawns.length === 0) reasons.push('nowhere to spawn an enemy')
  if (map.torches.length === 0) reasons.push('no torches — the level would be pitch black')

  return { ok: reasons.length === 0, reasons, floorCells, reachableCells }
}

// ---------------------------------------------------------------------------
// Cells and metres
// ---------------------------------------------------------------------------

export function tileAt(map: DungeonMap, x: number, y: number): TileValue {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return Tile.Rock
  return (map.tiles[y * map.width + x] ?? Tile.Rock) as TileValue
}

export function isWalkable(map: DungeonMap, x: number, y: number): boolean {
  return tileAt(map, x, y) === Tile.Floor
}

/**
 * The centre of a cell, in metres, with the map centred on the world origin.
 *
 * Centred rather than cornered so the level grows in every direction from the point the
 * player arrives at, and a seed that happens to place its rooms east doesn't put the whole
 * dungeon a hundred metres from the origin.
 */
export function cellToWorld(map: DungeonMap, x: number, y: number): { x: number; z: number } {
  return {
    x: (x - map.width / 2 + 0.5) * CELL_SIZE,
    z: (y - map.height / 2 + 0.5) * CELL_SIZE,
  }
}

export function worldToCell(map: DungeonMap, x: number, z: number): Cell {
  return {
    x: Math.floor(x / CELL_SIZE + map.width / 2),
    y: Math.floor(z / CELL_SIZE + map.height / 2),
  }
}
