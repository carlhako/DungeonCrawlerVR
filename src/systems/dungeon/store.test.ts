import { beforeEach, describe, expect, it } from 'vitest'
import { CELL_SIZE, isWalkable } from './generate'
import { placedCellToWorld, seedForWave, useDungeon, worldToPlacedCell } from './store'

/**
 * Placement: the arithmetic that turns a map in cells into a level the player can walk out
 * of a door and into. Getting this wrong puts the passage a metre inside a wall, which is
 * the sort of thing that is obvious in a headset and invisible everywhere else.
 */

const DOORWAY = { x: 0, z: -9.5 }

beforeEach(() => {
  useDungeon.getState().clear()
})

describe('seedForWave', () => {
  it('gives every wave its own seed, stably', () => {
    // Wave 3 is always the same dungeon: the player gets to learn a level rather than being
    // handed noise, and "wave 3 is broken" becomes a complete bug report.
    expect(seedForWave(3)).toBe(seedForWave(3))
    expect(new Set([1, 2, 3, 4, 5].map(seedForWave)).size).toBe(5)
  })
})

describe('build', () => {
  it('puts the mouth at the end of the passage', () => {
    const placement = useDungeon.getState().build(1, DOORWAY)
    const mouth = placedCellToWorld(placement, placement.map.mouth.x, placement.map.mouth.y)
    expect(mouth.x).toBeCloseTo(DOORWAY.x)
    // Half a cell further in than the opening itself: the cell's edge meets it.
    expect(mouth.z).toBeCloseTo(DOORWAY.z - CELL_SIZE / 2)
  })

  it('leaves the whole approach tunnel walkable, in world space', () => {
    // The bug this exists for: the level is sealed at every edge, so the first build put a
    // wall exactly where the passage met it and the player walked into the dark and stopped.
    for (const wave of [1, 2, 3]) {
      const placement = useDungeon.getState().build(wave, DOORWAY)
      for (let step = 0; step < 4; step++) {
        const z = DOORWAY.z - CELL_SIZE / 2 - step * CELL_SIZE
        const cell = worldToPlacedCell(placement, DOORWAY.x, z)
        expect(isWalkable(placement.map, cell.x, cell.y), `wave ${wave}, ${step} in`).toBe(true)
      }
    }
  })

  it('leaves the player walking onto walkable floor', () => {
    for (const wave of [1, 2, 3, 4, 5]) {
      const placement = useDungeon.getState().build(wave, DOORWAY)
      const cell = worldToPlacedCell(placement, DOORWAY.x, DOORWAY.z - CELL_SIZE / 2)
      expect(isWalkable(placement.map, cell.x, cell.y), `wave ${wave}`).toBe(true)
    }
  })

  it('round-trips cells through world space', () => {
    const placement = useDungeon.getState().build(2, DOORWAY)
    for (const cell of [
      { x: 4, y: 6 },
      placement.map.entry,
      placement.map.spawns[0]!,
    ]) {
      const world = placedCellToWorld(placement, cell.x, cell.y)
      expect(worldToPlacedCell(placement, world.x, world.z)).toEqual(cell)
    }
  })

  it('builds the same dungeon for the same wave', () => {
    const first = useDungeon.getState().build(4, DOORWAY)
    const tiles = [...first.map.tiles]
    useDungeon.getState().clear()
    const second = useDungeon.getState().build(4, DOORWAY)
    expect([...second.map.tiles]).toEqual(tiles)
    expect(second.offset).toEqual(first.offset)
  })

  it('clears away completely', () => {
    useDungeon.getState().build(1, DOORWAY)
    useDungeon.getState().clear()
    const state = useDungeon.getState()
    expect(state.map).toBeUndefined()
    expect(state.nav).toBeUndefined()
    expect(state.offset).toBeUndefined()
  })
})
