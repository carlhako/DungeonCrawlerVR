import { describe, expect, it } from 'vitest'
import { generate, isWalkable, type Cell, type DungeonMap } from './generate'
import { bakeNav, findPath, isOpen, nearestOpen, type NavGrid } from './nav'

/**
 * Pathfinding, tested against real generated dungeons rather than hand-drawn grids — the
 * shapes this has to cope with are the shapes the generator makes, including the awkward
 * ones nobody would think to draw.
 */

/** A small hand-made grid, for the cases that must be exactly reproducible. */
function grid(rows: string[]): NavGrid {
  const height = rows.length
  const width = (rows[0] ?? '').length
  const walkable = new Uint8Array(width * height)
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) walkable[y * width + x] = row[x] === '.' ? 1 : 0
  })
  return { width, height, walkable }
}

function contiguous(path: Cell[]): boolean {
  return path.every((cell, i) => {
    if (i === 0) return true
    const previous = path[i - 1] as Cell
    return Math.abs(cell.x - previous.x) <= 1 && Math.abs(cell.y - previous.y) <= 1
  })
}

const SEEDS = [1, 2, 3, 4, 5]

function farthestSpawn(map: DungeonMap): Cell {
  return map.spawns[0] as Cell
}

describe('bakeNav', () => {
  it('opens exactly the floor cells', () => {
    const map = generate(1)
    const nav = bakeNav(map)
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        expect(isOpen(nav, x, y)).toBe(isWalkable(map, x, y))
      }
    }
  })

  it('treats everything outside the grid as solid', () => {
    const nav = bakeNav(generate(1))
    expect(isOpen(nav, -1, 5)).toBe(false)
    expect(isOpen(nav, 5, -1)).toBe(false)
    expect(isOpen(nav, nav.width, 5)).toBe(false)
    expect(isOpen(nav, 5, nav.height)).toBe(false)
  })
})

describe('findPath', () => {
  it.each(SEEDS)('walks from the entry to the furthest spawn on seed %i', (seed) => {
    const map = generate(seed)
    const nav = bakeNav(map)
    const path = findPath(nav, map.entry, farthestSpawn(map))

    expect(path.length).toBeGreaterThan(1)
    expect(path[0]).toEqual(map.entry)
    expect(path.at(-1)).toEqual(farthestSpawn(map))
    expect(contiguous(path)).toBe(true)
    for (const cell of path) expect(isOpen(nav, cell.x, cell.y)).toBe(true)
  })

  it('reaches every room from the entry', () => {
    // The same claim `validate` makes about connectivity, but proved with the thing that
    // will actually be doing the walking.
    const map = generate(2)
    const nav = bakeNav(map)
    for (const room of map.rooms) {
      const target = { x: room.x, y: room.y }
      expect(findPath(nav, map.entry, target).length, `room at ${room.x},${room.y}`).toBeGreaterThan(0)
    }
  })

  it('returns just the cell when you are already there', () => {
    const map = generate(1)
    expect(findPath(bakeNav(map), map.entry, map.entry)).toEqual([map.entry])
  })

  it('gives up rather than inventing a route', () => {
    // An enemy that cannot reach the player must idle, not walk into a wall forever — which
    // means "no path" has to be a real answer the caller can see.
    const nav = grid([
      '#####',
      '#.#.#',
      '#.#.#',
      '#####',
    ])
    expect(findPath(nav, { x: 1, y: 1 }, { x: 3, y: 2 })).toEqual([])
  })

  it('refuses a start or a goal inside rock', () => {
    const nav = grid(['###', '#.#', '###'])
    expect(findPath(nav, { x: 0, y: 0 }, { x: 1, y: 1 })).toEqual([])
    expect(findPath(nav, { x: 1, y: 1 }, { x: 0, y: 0 })).toEqual([])
  })

  it('does not squeeze through the corner where two walls meet', () => {
    // Diagonally adjacent floor with both orthogonals solid. Cutting that corner looks,
    // from inside a headset, exactly like walking through a wall.
    const nav = grid([
      '####',
      '#.##',
      '##.#',
      '####',
    ])
    expect(findPath(nav, { x: 1, y: 1 }, { x: 2, y: 2 })).toEqual([])
  })

  it('takes the diagonal when there is room for it', () => {
    const nav = grid([
      '####',
      '#..#',
      '#..#',
      '####',
    ])
    expect(findPath(nav, { x: 1, y: 1 }, { x: 2, y: 2 })).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ])
  })

  it('finds the shortest way round an obstacle', () => {
    const nav = grid([
      '#######',
      '#.....#',
      '#.###.#',
      '#.....#',
      '#######',
    ])
    const path = findPath(nav, { x: 1, y: 1 }, { x: 5, y: 1 })
    // Straight along the top is four steps; anything longer means it went round the block.
    expect(path).toHaveLength(5)
    expect(contiguous(path)).toBe(true)
  })

  it('is deterministic', () => {
    const map = generate(4)
    const nav = bakeNav(map)
    const a = findPath(nav, map.entry, farthestSpawn(map))
    const b = findPath(nav, map.entry, farthestSpawn(map))
    expect(a).toEqual(b)
  })
})

describe('nearestOpen', () => {
  it('returns the cell itself when it is already open', () => {
    const nav = grid(['###', '#.#', '###'])
    expect(nearestOpen(nav, { x: 1, y: 1 })).toEqual({ x: 1, y: 1 })
  })

  it('finds the way out when a body has been pushed into a wall', () => {
    // Physics puts bodies where physics puts them, and a few centimetres inside a wall
    // leaves an enemy unable to path anywhere at all.
    const nav = grid([
      '#####',
      '#...#',
      '#...#',
      '#####',
    ])
    const found = nearestOpen(nav, { x: 0, y: 1 })
    expect(found).toEqual({ x: 1, y: 1 })
  })

  it('gives up outside its search radius', () => {
    const nav = grid([
      '#####',
      '#####',
      '##.##',
      '#####',
      '#####',
    ])
    expect(nearestOpen(nav, { x: 0, y: 0 }, 1)).toBeNull()
  })
})
