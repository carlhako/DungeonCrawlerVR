/**
 * Enemy counter HUD — "killed / total" at the top centre of the view.
 *
 * Sprint 2.5: reads the Wave Director's killed/total counts directly.
 * Only mounts during the `wave` phase.
 */

import { useRun } from '@/systems/run'
import { director } from '@/systems/enemies/state'
import { HudOverlay } from '@/ui/HudOverlay'

const CANVAS_W = 256
const CANVAS_H = 64
const SIZE_M: [number, number] = [0.4, 0.1]
// Centre, nudged up slightly so it sits above the aim line rather than on top of it. Was
// pinned to the top edge, which put it above what a headset's vertical FOV could reach
// without turning the neck — you cannot look up at a HUD quad that follows your look
// direction. Gated behind a controller button (see `requireSideButton` below), it no
// longer needs to be out of the way at a glance: it is off unless summoned.
const ANCHOR: [number, number, number] = [0, 0.15, -1]

function draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const r = 8
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.beginPath()
  ctx.moveTo(r, 0)
  ctx.lineTo(w - r, 0)
  ctx.quadraticCurveTo(w, 0, w, r)
  ctx.lineTo(w, h - r)
  ctx.quadraticCurveTo(w, h, w - r, h)
  ctx.lineTo(r, h)
  ctx.quadraticCurveTo(0, h, 0, h - r)
  ctx.lineTo(0, r)
  ctx.quadraticCurveTo(0, 0, r, 0)
  ctx.fill()

  const { killed, total } = director
  const text = `${killed} / ${total}`

  ctx.font = 'bold 28px monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  ctx.fillStyle = '#000'
  ctx.fillText(text, w / 2 + 1, h / 2 + 1)

  const killedText = String(killed)
  const sepTotal = ` / ${total}`
  const fullWidth = ctx.measureText(text).width
  const killedWidth = ctx.measureText(killedText).width
  const startX = (w - fullWidth) / 2

  ctx.fillStyle = '#ffd479'
  ctx.textAlign = 'left'
  ctx.fillText(killedText, startX, h / 2)

  ctx.fillStyle = '#e8d5b0'
  ctx.fillText(sepTotal, startX + killedWidth, h / 2)
}

export function EnemyCounter() {
  const phase = useRun((state) => state.phase)
  if (phase !== 'wave') return null

  return (
    <HudOverlay
      sizeMetres={SIZE_M}
      canvasSize={{ width: CANVAS_W, height: CANVAS_H }}
      anchor={ANCHOR}
      renderOrder={990}
      draw={draw}
      requireSideButton
    />
  )
}
