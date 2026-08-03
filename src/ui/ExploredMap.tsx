/**
 * Explored-area minimap — bottom-left of the view.
 *
 * Sprint 2.5: a small map that fills in as the player explores the dungeon. It is
 * north-up and screen-locked — it does not rotate with the player's heading, only the
 * player marker moves and rotates within it.
 *
 * The map shows only floor cells the player has visited (tracked in
 * `systems/dungeon/explored.ts`). Corridors and rooms are revealed as the player walks them;
 * the rest stays dark.  Rendered as a head-locked canvas quad via `HudOverlay` so it works
 * in both desktop and VR.
 */

import { useDungeon } from '@/systems/dungeon/store'
import { playerState } from '@/systems/player'
import { CELL_SIZE } from '@/systems/dungeon/generate'
import { isExplored } from '@/systems/dungeon/explored'
import { useRun } from '@/systems/run'
import { HudOverlay } from '@/ui/HudOverlay'

/** Canvas pixel size. Small — it is a corner map, not a full-screen one. */
const CANVAS_W = 200
const CANVAS_H = 200

/** Physical size in metres at the overlay distance. Roughly 16cm square at 1m. */
const SIZE_M: [number, number] = [0.16, 0.16]

/**
 * Head-local offset: bottom-left of the view.
 *
 * In head-local space X is right, Y is up, Z is into the screen (negative = forward).
 * 0.15m left, -0.12m down, 1.0m ahead.
 */
const OFFSET: [number, number, number] = [-0.15, -0.12, -1.0]

/** Pixels per cell on the map canvas. Scaled so a typical dungeon fits. */
const PX_PER_CELL = 4

const COLOUR_BG = 'rgba(0,0,0,0.50)'
const COLOUR_FLOOR = '#5a5550'
const COLOUR_PLAYER = '#ffd479'
const COLOUR_ENTRY = '#6fdc8c'

function drawExploredMap(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): void {
  const dungeon = useDungeon.getState()
  const { map, offset } = dungeon
  if (!map || !offset) {
    ctx.fillStyle = COLOUR_BG
    roundRect(ctx, 0, 0, w, h, 6)
    ctx.fill()
    return
  }

  const { width, height, tiles } = map

  // Background
  ctx.fillStyle = COLOUR_BG
  roundRect(ctx, 0, 0, w, h, 6)
  ctx.fill()

  // Clip to rounded rect interior for the map content
  ctx.save()
  roundRect(ctx, 2, 2, w - 4, h - 4, 4)
  ctx.clip()

  // Center the map on the player's position.
  const playerWorldX = playerState.position.x
  const playerWorldZ = playerState.position.z

  // World origin offset — the map's local origin in world space
  const mapOriginX = -(map.width / 2) * CELL_SIZE + offset.x
  const mapOriginZ = -(map.height / 2) * CELL_SIZE + offset.z

  // How many cells fit in the view
  const viewCellsX = Math.ceil(w / PX_PER_CELL)
  const viewCellsY = Math.ceil(h / PX_PER_CELL)

  // Player position in cell space
  const playerCellX = (playerWorldX - mapOriginX) / CELL_SIZE
  const playerCellZ = (playerWorldZ - mapOriginZ) / CELL_SIZE

  const viewLeft = playerCellX - viewCellsX / 2
  const viewTop = playerCellZ - viewCellsY / 2

  // Draw explored cells
  for (let cy = 0; cy < height; cy++) {
    for (let cx = 0; cx < width; cx++) {
      if (!isExplored(width, height, tiles, cx, cy)) continue

      const px = (cx - viewLeft) * PX_PER_CELL
      const py = (cy - viewTop) * PX_PER_CELL

      // Skip cells outside the view
      if (px + PX_PER_CELL < 0 || py + PX_PER_CELL < 0 || px > w || py > h) continue

      ctx.fillStyle = COLOUR_FLOOR
      ctx.fillRect(px, py, PX_PER_CELL, PX_PER_CELL)
    }
  }

  // Draw entry marker
  {
    const ex = (map.entry.x - viewLeft) * PX_PER_CELL + PX_PER_CELL / 2
    const ey = (map.entry.y - viewTop) * PX_PER_CELL + PX_PER_CELL / 2
    ctx.fillStyle = COLOUR_ENTRY
    ctx.fillRect(ex - 2, ey - 2, 4, 4)
  }

  // Player marker — a small triangle pointing in the body yaw direction
  {
    const px = (playerCellX - viewLeft) * PX_PER_CELL
    const py = (playerCellZ - viewTop) * PX_PER_CELL
    const yaw = playerState.yaw

    ctx.save()
    ctx.translate(px, py)
    // Yaw 0 = world +Z = canvas down.  Rotate by yaw so the arrow points the way the player faces.
    ctx.rotate(yaw)
    ctx.fillStyle = COLOUR_PLAYER
    ctx.beginPath()
    ctx.moveTo(0, -5)
    ctx.lineTo(-3, 4)
    ctx.lineTo(3, 4)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  ctx.restore()
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

export function ExploredMap() {
  const phase = useRun((state) => state.phase)
  const hasDungeon = useDungeon((state) => !!state.map)

  // Visible during wave, waveComplete, and death — any time the player is in the dungeon
  // or has just left it. Hidden in the foyer proper.
  if (phase === 'foyer' || phase === 'loading') return null
  if (!hasDungeon) return null

  return (
    <HudOverlay
      sizeMetres={SIZE_M}
      canvasSize={{ width: CANVAS_W, height: CANVAS_H }}
      offset={OFFSET}
      renderOrder={991}
      draw={drawExploredMap}
    />
  )
}
