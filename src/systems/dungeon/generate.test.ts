import { describe, expect, it } from 'vitest'
import {
  CELL_SIZE,
  DEFAULT_OPTIONS,
  Tile,
  cellToWorld,
  floorDistances,
  generate,
  isWalkable,
  validate,
  worldToCell,
  type DungeonMap,
} from './generate'

/**
 * Sprint 2.1's acceptance test lives in here: twenty seeds, every one connected and
 * traversable, and the same seed always the same map.
 *
 * These are the checks that cannot be done by looking. A disconnected dungeon renders
 * perfectly — you only find out when a wave cannot be finished because the last two enemies
 * are behind a wall that never opened, by which point the player has spent ten minutes
 * looking for them in the dark.
 */

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1)

function floorCells(map: DungeonMap): number {
  let count = 0
  for (const tile of map.tiles) if (tile === Tile.Floor) count++
  return count
}

describe('generate', () => {
  it.each(SEEDS)('seed %i is fully connected and traversable', (seed) => {
    const map = generate(seed)
    const result = validate(map)
    expect(result.reasons).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.reachableCells).toBe(result.floorCells)
  })

  it('gives the same map for the same seed', () => {
    const a = generate(7)
    const b = generate(7)
    expect(a.seed).toBe(b.seed)
    expect([...a.tiles]).toEqual([...b.tiles])
    expect(a.rooms).toEqual(b.rooms)
    expect(a.entry).toEqual(b.entry)
    expect(a.spawns).toEqual(b.spawns)
    expect(a.torches).toEqual(b.torches)
  })

  it('gives different maps for different seeds', () => {
    // Twenty seeds that all produced the same level would pass every other test here.
    const signatures = new Set(SEEDS.map((seed) => [...generate(seed).tiles].join('')))
    expect(signatures.size).toBe(SEEDS.length)
  })

  it('reaches every room from the entry', () => {
    for (const seed of SEEDS) {
      const map = generate(seed)
      const distances = floorDistances(map.tiles, map.width, map.height, map.entry)
      for (const room of map.rooms) {
        for (let y = room.y; y < room.y + room.h; y++) {
          for (let x = room.x; x < room.x + room.w; x++) {
            expect(distances[y * map.width + x], `seed ${seed}, cell ${x},${y}`).toBeGreaterThanOrEqual(0)
          }
        }
      }
    }
  })

  it('keeps the level sealed at its edges', () => {
    // A floor cell on the boundary is a hole in the world: the player walks out of the
    // level into nothing, which renders exactly as convincingly as a wall does.
    for (const seed of SEEDS) {
      const map = generate(seed)
      for (let x = 0; x < map.width; x++) {
        expect(isWalkable(map, x, 0)).toBe(false)
        expect(isWalkable(map, x, map.height - 1)).toBe(false)
      }
      for (let y = 0; y < map.height; y++) {
        expect(isWalkable(map, 0, y)).toBe(false)
        expect(isWalkable(map, map.width - 1, y)).toBe(false)
      }
    }
  })

  it('never leaves two rooms sharing a wall', () => {
    // The one-cell gap is what makes every doorway a corridor you can see through.
    for (const seed of SEEDS) {
      const map = generate(seed)
      for (let i = 0; i < map.rooms.length; i++) {
        for (let j = i + 1; j < map.rooms.length; j++) {
          const a = map.rooms[i]!
          const b = map.rooms[j]!
          const apart = a.x - 1 >= b.x + b.w || b.x - 1 >= a.x + a.w || a.y - 1 >= b.y + b.h || b.y - 1 >= a.y + a.h
          expect(apart, `seed ${seed}: rooms ${i} and ${j} touch`).toBe(true)
        }
      }
    }
  })

  it('walls every floor cell it does not open onto', () => {
    // Every cell next to the floor is either floor or wall — never bare rock, which would
    // render as a hole you can see the sky through.
    for (const seed of SEEDS.slice(0, 5)) {
      const map = generate(seed)
      for (let y = 1; y < map.height - 1; y++) {
        for (let x = 1; x < map.width - 1; x++) {
          if (!isWalkable(map, x, y)) continue
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const) {
            const tile = map.tiles[(y + dy) * map.width + (x + dx)]
            expect(tile, `seed ${seed}: bare rock beside floor at ${x},${y}`).not.toBe(Tile.Rock)
          }
        }
      }
    }
  })

  it('throws rather than returning an impossible dungeon', () => {
    // A caller that has to handle "the dungeon didn't work" handles it by crashing in front
    // of somebody wearing a headset. Fail here, loudly, where the options are wrong.
    expect(() => generate(1, { width: 8, height: 8 })).toThrow(/could not generate/)
  })
})

describe('the entry', () => {
  it('is on the floor, in a room, near the south edge', () => {
    for (const seed of SEEDS) {
      const map = generate(seed)
      expect(isWalkable(map, map.entry.x, map.entry.y)).toBe(true)
      // The foyer door is on that side; the player should walk in rather than materialise
      // in the middle of the level.
      for (const room of map.rooms) {
        expect(room.y + room.h).toBeLessThanOrEqual(map.entryRoom.y + map.entryRoom.h)
      }
    }
  })
})

describe('spawn points', () => {
  it('keeps enemies out of the room the player arrives in', () => {
    for (const seed of SEEDS) {
      const map = generate(seed)
      const { entryRoom } = map
      for (const spawn of map.spawns) {
        const inside =
          spawn.x >= entryRoom.x &&
          spawn.x < entryRoom.x + entryRoom.w &&
          spawn.y >= entryRoom.y &&
          spawn.y < entryRoom.y + entryRoom.h
        expect(inside, `seed ${seed}: spawn inside the entry room`).toBe(false)
      }
    }
  })

  it('keeps them a walk away from the arrival point', () => {
    for (const seed of SEEDS) {
      const map = generate(seed)
      const distances = floorDistances(map.tiles, map.width, map.height, map.entry)
      for (const spawn of map.spawns) {
        expect(distances[spawn.y * map.width + spawn.x]).toBeGreaterThanOrEqual(
          DEFAULT_OPTIONS.minSpawnDistance,
        )
      }
    }
  })

  it('is ordered furthest-first, so a wave fills the level from the back', () => {
    const map = generate(3)
    const distances = floorDistances(map.tiles, map.width, map.height, map.entry)
    const order = map.spawns.map((s) => distances[s.y * map.width + s.x] as number)
    expect([...order].sort((a, b) => b - a)).toEqual(order)
  })

  it('always stands on walkable floor', () => {
    for (const seed of SEEDS) {
      const map = generate(seed)
      for (const spawn of map.spawns) expect(isWalkable(map, spawn.x, spawn.y)).toBe(true)
    }
  })
})

describe('torches', () => {
  it('mounts every one on a wall facing into an open space', () => {
    for (const seed of SEEDS) {
      const map = generate(seed)
      for (const torch of map.torches) {
        expect(map.tiles[torch.y * map.width + torch.x]).toBe(Tile.Wall)
        expect(isWalkable(map, torch.x + torch.dx, torch.y + torch.dy)).toBe(true)
      }
    }
  })

  it('spaces them out, so the dark between them survives', () => {
    for (const seed of SEEDS) {
      const map = generate(seed)
      for (let i = 0; i < map.torches.length; i++) {
        for (let j = i + 1; j < map.torches.length; j++) {
          const a = map.torches[i]!
          const b = map.torches[j]!
          expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(
            DEFAULT_OPTIONS.torchSpacing,
          )
        }
      }
    }
  })

  it('lights enough of the level to move through it', () => {
    for (const seed of SEEDS) {
      expect(generate(seed).torches.length).toBeGreaterThan(4)
    }
  })
})

describe('cells and metres', () => {
  it('round-trips a cell through world space', () => {
    const map = generate(5)
    for (const cell of [{ x: 0, y: 0 }, { x: 12, y: 7 }, { x: map.width - 1, y: map.height - 1 }]) {
      const world = cellToWorld(map, cell.x, cell.y)
      expect(worldToCell(map, world.x, world.z)).toEqual(cell)
    }
  })

  it('centres the map on the origin', () => {
    // So a seed whose rooms lean east doesn't put the whole dungeon 100m from the origin.
    const map = generate(5)
    const middle = cellToWorld(map, map.width / 2, map.height / 2)
    expect(Math.abs(middle.x)).toBeLessThanOrEqual(CELL_SIZE)
    expect(Math.abs(middle.z)).toBeLessThanOrEqual(CELL_SIZE)
  })
})
