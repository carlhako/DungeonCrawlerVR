/**
 * Cell-level fog of war: which dungeon cells the player has visited.
 *
 * A module singleton with stable identity, written once per fixed step by the driver and
 * read by the explored-map HUD. The map only reveals what the player has seen — rooms and
 * corridors fill in as you walk rather than being revealed up front.
 *
 * The set stores packed cell keys (`x << 16 | y`) so a 40×40 dungeon's worth of visited
 * cells is one small set rather than a Uint8Array of the full grid. The map is only ever
 * drawn for visited cells.
 */

import { worldToPlacedCell, type DungeonPlacement } from './store'
import { Tile } from './generate'

/** Packed (x << 16 | y) into the low 32 bits. Both signed. */
function pack(x: number, y: number): number {
  return ((x & 0xffff) << 16) | (y & 0xffff)
}

/**
 * Which cells the player has visited, as packed keys.
 *
 * Cleared when the dungeon is rebuilt. Read by the explored-map overlay.
 */
export const exploredCells = new Set<number>()

/** Flush the set — called when a dungeon is torn down or a new one is built. */
export function clearExplored(): void {
  exploredCells.clear()
}

/**
 * Call once per fixed step while the player is in a dungeon.
 *
 * Marks the cell the player is standing in, and every floor cell within `radius` cells
 * around it, as visited. The radius means opening a door on a room fills the room rather
 * than filling the one cell the player is on — torches light a space, and the map is what
 * the player could reasonably have seen.
 */
export function markExplored(
  placement: DungeonPlacement,
  x: number,
  z: number,
  radius = 1,
): void {
  const cell = worldToPlacedCell(placement, x, z)
  const { map } = placement

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const cx = cell.x + dx
      const cy = cell.y + dy
      if (cx < 0 || cy < 0 || cx >= map.width || cy >= map.height) continue
      // Only floor cells — walls and rock are never "visited". The map draws floor as
      // visible terrain and walls as darkness.
      const tile = map.tiles[cy * map.width + cx]
      if (tile === Tile.Floor) exploredCells.add(pack(cx, cy))
    }
  }
}

/** Does this cell have a floor tile? For the map renderer. */
export function isExplored(mapWidth: number, mapHeight: number, tiles: Uint8Array, cx: number, cy: number): boolean {
  if (cx < 0 || cy < 0 || cx >= mapWidth || cy >= mapHeight) return false
  if (tiles[cy * mapWidth + cx] !== Tile.Floor) return false
  return exploredCells.has(pack(cx, cy))
}
