/**
 * Explored-area minimap — bottom-left of the view.
 *
 * Sprint 2.5: north-up map that fills in as the player explores. Only visible while a
 * dungeon is loaded (wave / waveComplete / death phases).
 */

import { useDungeon } from '@/systems/dungeon/store'
import { playerState } from '@/systems/player'
import { CELL_SIZE } from '@/systems/dungeon/generate'
import { isExplored } from '@/systems/dungeon/explored'
import { useRun } from '@/systems/run'
import { HudOverlay } from '@/ui/HudOverlay'

const CANVAS_W = 200
const CANVAS_H = 200
const SIZE_M: [number, number] = [0.18, 0.18]
// Bottom-left corner, pulled in by SAFE_FRACTION so it stays inside the headset's FOV
// without turning the head. Gated behind a controller button (see `requireSideButton`
// below), same as the counter.
const ANCHOR: [number, number, number] = [-0.85, -0.85, -1]
const PX_PER_CELL = 4

function draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const dungeon = useDungeon.getState()
  const { map, offset } = dungeon
  if (!map || !offset) {
    ctx.fillStyle = 'rgba(0,0,0,0.50)'
    roundRect(ctx, 0, 0, w, h, 6)
    ctx.fill()
    return
  }

  const { width, height, tiles } = map

  ctx.fillStyle = 'rgba(0,0,0,0.50)'
  roundRect(ctx, 0, 0, w, h, 6)
  ctx.fill()

  ctx.save()
  roundRect(ctx, 2, 2, w - 4, h - 4, 4)
  ctx.clip()

  const mapOriginX = -(map.width / 2) * CELL_SIZE + offset.x
  const mapOriginZ = -(map.height / 2) * CELL_SIZE + offset.z

  const viewCellsX = Math.ceil(w / PX_PER_CELL)
  const viewCellsY = Math.ceil(h / PX_PER_CELL)

  const playerCellX = (playerState.position.x - mapOriginX) / CELL_SIZE
  const playerCellZ = (playerState.position.z - mapOriginZ) / CELL_SIZE

  const viewLeft = playerCellX - viewCellsX / 2
  const viewTop = playerCellZ - viewCellsY / 2

  // Explored cells
  for (let cy = 0; cy < height; cy++) {
    for (let cx = 0; cx < width; cx++) {
      if (!isExplored(width, height, tiles, cx, cy)) continue
      const px = (cx - viewLeft) * PX_PER_CELL
      const py = (cy - viewTop) * PX_PER_CELL
      if (px + PX_PER_CELL < 0 || py + PX_PER_CELL < 0 || px > w || py > h) continue
      ctx.fillStyle = '#5a5550'
      ctx.fillRect(px, py, PX_PER_CELL, PX_PER_CELL)
    }
  }

  // Entry marker
  const ex = (map.entry.x - viewLeft) * PX_PER_CELL + PX_PER_CELL / 2
  const ey = (map.entry.y - viewTop) * PX_PER_CELL + PX_PER_CELL / 2
  ctx.fillStyle = '#6fdc8c'
  ctx.fillRect(ex - 2, ey - 2, 4, 4)

  // Player marker — triangle pointing in body yaw direction
  const px = (playerCellX - viewLeft) * PX_PER_CELL
  const py = (playerCellZ - viewTop) * PX_PER_CELL
  ctx.save()
  ctx.translate(px, py)
  ctx.rotate(playerState.yaw)
  ctx.fillStyle = '#ffd479'
  ctx.beginPath()
  ctx.moveTo(0, -5)
  ctx.lineTo(-3, 4)
  ctx.lineTo(3, 4)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

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
  if (phase === 'foyer' || phase === 'loading') return null

  return (
    <HudOverlay
      sizeMetres={SIZE_M}
      canvasSize={{ width: CANVAS_W, height: CANVAS_H }}
      anchor={ANCHOR}
      renderOrder={991}
      draw={draw}
      requireSideButton
    />
  )
}
