import { describe, it, expect, beforeEach } from 'vitest'
import { exploredCells, clearExplored, markExplored, isExplored } from './explored'
import type { DungeonPlacement } from './store'
import { generate, CELL_SIZE, Tile } from './generate'
import { bakeNav } from './nav'

/**
 * Build a placement at the origin so the local-frame arithmetic can't hide a bug.
 */
function placementFor(wave: number): DungeonPlacement {
  const map = generate(wave * 2654435761)
  const nav = bakeNav(map)
  return { map, nav, offset: { x: 0, z: 0 } }
}

/** A cell centre in world metres, with the placement at the origin. */
function cellCentre(map: ReturnType<typeof generate>, cx: number, cy: number) {
  return {
    x: (cx - map.width / 2 + 0.5) * CELL_SIZE,
    z: (cy - map.height / 2 + 0.5) * CELL_SIZE,
  }
}

describe('explored tracking', () => {
  beforeEach(() => {
    clearExplored()
  })

  it('starts empty', () => {
    expect(exploredCells.size).toBe(0)
  })

  it('marks the cell the player is standing in', () => {
    const placement = placementFor(1)
    const centre = cellCentre(placement.map, placement.map.entry.x, placement.map.entry.y)

    markExplored(placement, centre.x, centre.z)

    expect(
      isExplored(
        placement.map.width,
        placement.map.height,
        placement.map.tiles,
        placement.map.entry.x,
        placement.map.entry.y,
      ),
    ).toBe(true)
  })

  it('marks immediate neighbours (radius 1)', () => {
    const placement = placementFor(1)
    // Find a floor cell with floor neighbours.
    const { map } = placement
    let cx = map.entry.x
    let cy = map.entry.y
    // Walk a few cells in from the entry so we have floor on all sides.
    while (cy > map.entry.y - 3) {
      cy--
      if (map.tiles[cy * map.width + cx] !== Tile.Floor) {
        cy++
        break
      }
    }

    const centre = cellCentre(map, cx, cy)
    markExplored(placement, centre.x, centre.z, 1)

    // The centre and its 4 orthogonal neighbours should all be explored.
    const neighbours = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const
    for (const [dx, dy] of neighbours) {
      const nx = cx + dx
      const ny = cy + dy
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue
      if (map.tiles[ny * map.width + nx] !== Tile.Floor) continue
      expect(isExplored(map.width, map.height, map.tiles, nx, ny)).toBe(true)
    }
  })

  it('does not mark wall cells', () => {
    const placement = placementFor(1)
    const { map } = placement
    // Walk into a room and find a wall cell.
    const centre = cellCentre(map, map.entry.x, map.entry.y)
    markExplored(placement, centre.x, centre.z, 2)

    // Check that no wall cells got marked.
    let wallMarked = false
    for (let cy = 0; cy < map.height; cy++) {
      for (let cx = 0; cx < map.width; cx++) {
        if (map.tiles[cy * map.width + cx] === Tile.Wall && exploredCells.size > 0) {
          // A wall might have been added if isExplored checks exploredCells first
          if (isExplored(map.width, map.height, map.tiles, cx, cy)) {
            wallMarked = true
          }
        }
      }
    }
    expect(wallMarked).toBe(false)
  })

  it('clearExplored empties the set', () => {
    const placement = placementFor(1)
    const centre = cellCentre(placement.map, placement.map.entry.x, placement.map.entry.y)
    markExplored(placement, centre.x, centre.z)
    expect(exploredCells.size).toBeGreaterThan(0)

    clearExplored()
    expect(exploredCells.size).toBe(0)
  })

  it('multiple marks accumulate', () => {
    const placement = placementFor(1)
    const { map } = placement

    // Mark the entry cell.
    const entryCentre = cellCentre(map, map.entry.x, map.entry.y)
    markExplored(placement, entryCentre.x, entryCentre.z, 0)
    const firstCount = exploredCells.size
    expect(firstCount).toBeGreaterThan(0)

    // Mark another cell — should add to the set.
    // Walk a few cells north (negative z).
    const cy = map.entry.y - 2
    if (cy >= 0 && map.tiles[cy * map.width + map.entry.x] === Tile.Floor) {
      const otherCentre = cellCentre(map, map.entry.x, cy)
      markExplored(placement, otherCentre.x, otherCentre.z, 0)
      expect(exploredCells.size).toBeGreaterThan(firstCount)
    }
  })

  it('isExplored returns false for unvisited floor cells', () => {
    const placement = placementFor(1)
    const { map } = placement
    // Find a floor cell far from the entry.
    const farRoom = map.rooms[map.rooms.length - 1]
    if (farRoom) {
      const cx = Math.floor(farRoom.x + farRoom.w / 2)
      const cy = Math.floor(farRoom.y + farRoom.h / 2)
      expect(isExplored(map.width, map.height, map.tiles, cx, cy)).toBe(false)
    }
  })

  it('isExplored returns false for out-of-bounds cells', () => {
    const placement = placementFor(1)
    const { map } = placement
    expect(isExplored(map.width, map.height, map.tiles, -1, -1)).toBe(false)
    expect(isExplored(map.width, map.height, map.tiles, map.width, map.height)).toBe(false)
  })

  it('works with offset placement (not at origin)', () => {
    const map = generate(2 * 2654435761)
    const nav = bakeNav(map)
    const placement: DungeonPlacement = { map, nav, offset: { x: 100, z: -50 } }

    const entryWorld = {
      x: (map.entry.x - map.width / 2 + 0.5) * CELL_SIZE + 100,
      z: (map.entry.y - map.height / 2 + 0.5) * CELL_SIZE - 50,
    }

    clearExplored()
    markExplored(placement, entryWorld.x, entryWorld.z, 0)

    expect(
      isExplored(map.width, map.height, map.tiles, map.entry.x, map.entry.y),
    ).toBe(true)
  })
})
