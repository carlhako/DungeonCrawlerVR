import { create } from 'zustand'
import { CELL_SIZE, cellToWorld, generate, type Cell, type DungeonMap } from './generate'
import { bakeNav, type NavGrid } from './nav'
import { clearExplored } from './explored'

/**
 * The dungeon that currently exists, and where it is in the world.
 *
 * Not persisted, on purpose and for the same reason the run phase isn't: a save that
 * restored mid-wave would drop the player into a dungeon that was never built, with enemies
 * that were never spawned. Reloading always returns you to the foyer.
 *
 * The generator knows nothing about the world — it works in cells, centred on nothing. This
 * is where a map becomes a *place*: it is offset so that its entry cell lands exactly at the
 * end of the foyer's passage, which is what lets the player walk out of a door and into a
 * generated level rather than being teleported into one. Continuous space is worth this much
 * arithmetic; a cut to black in VR is a cut to somebody wondering where they went.
 */

export interface DungeonPlacement {
  map: DungeonMap
  nav: NavGrid
  /** Metres added to the map's own centred coordinates to put it in the world. */
  offset: { x: number; z: number }
}

interface DungeonStore extends Partial<DungeonPlacement> {
  /** Build the dungeon for a wave, anchored so its mouth opens at `entryAt`. */
  build(wave: number, entryAt: { x: number; z: number }): DungeonPlacement
  clear(): void
}

/**
 * One wave, one seed, forever.
 *
 * Wave 3 is always the same dungeon — for the player, who gets to learn a level rather than
 * being handed noise, and for us, because "wave 3 is broken" is then a complete bug report.
 */
export function seedForWave(wave: number): number {
  return wave * 2654435761
}

export const useDungeon = create<DungeonStore>()((set) => ({
  map: undefined,
  nav: undefined,
  offset: undefined,

  build: (wave, entryAt) => {
    const map = generate(seedForWave(wave))
    clearExplored()
    // Anchored on the *mouth*, not the entry: the mouth is the cell on the boundary that the
    // foyer's passage attaches to, and its outer edge has to land exactly on the opening.
    // Its centre is therefore half a cell further in.
    const mouth = cellToWorld(map, map.mouth.x, map.mouth.y)
    const placement: DungeonPlacement = {
      map,
      nav: bakeNav(map),
      offset: { x: entryAt.x - mouth.x, z: entryAt.z - mouth.z - CELL_SIZE / 2 },
    }
    set(placement)
    return placement
  },

  clear: () => {
    clearExplored()
    set({ map: undefined, nav: undefined, offset: undefined })
  },
}))

/** A cell centre in world metres, for a placed dungeon. */
export function placedCellToWorld(
  placement: DungeonPlacement,
  x: number,
  y: number,
): { x: number; z: number } {
  const local = cellToWorld(placement.map, x, y)
  return { x: local.x + placement.offset.x, z: local.z + placement.offset.z }
}

/** The cell a world position falls in. Outside the map is still a cell — just a solid one. */
export function worldToPlacedCell(
  placement: DungeonPlacement,
  x: number,
  z: number,
): Cell {
  const { map, offset } = placement
  return {
    x: Math.floor((x - offset.x) / CELL_SIZE + map.width / 2),
    y: Math.floor((z - offset.z) / CELL_SIZE + map.height / 2),
  }
}
