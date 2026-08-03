/**
 * Enemy counter HUD — "killed / total" at the top centre of the view.
 *
 * Sprint 2.5: a screen-space overlay showing how many enemies remain in the current wave.
 * Driven by the Wave Director, which already tracks `killed` and `total` — this is purely
 * presentation.
 *
 * Only visible while a wave is running (`run.phase === 'wave'`). Rendered as a head-locked
 * canvas quad via `HudOverlay` so it works in both desktop and VR.
 */

import { director } from '@/systems/enemies/state'
import { HudOverlay } from '@/ui/HudOverlay'

/** Canvas pixel size. */
const CANVAS_W = 256
const CANVAS_H = 64

/** Physical size in metres. */
const SIZE_M: [number, number] = [0.35, 0.09]

/** Head-local offset: centred above the forward axis. */
const OFFSET: [number, number, number] = [0, 0.18, -1.2]

const COLOUR_BG = 'rgba(0,0,0,0.55)'
const COLOUR_TEXT = '#e8d5b0'
const COLOUR_KILLED = '#ffd479'
const FONT = 'bold 28px monospace'

function draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  // Rounded rect background
  const r = 8
  ctx.fillStyle = COLOUR_BG
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

  ctx.font = FONT
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Shadow
  ctx.fillStyle = '#000'
  ctx.fillText(text, w / 2 + 1, h / 2 + 1)

  const killedText = String(killed)
  const sep = ' / '
  const totalText = String(total)

  const fullWidth = ctx.measureText(text).width
  const killedWidth = ctx.measureText(killedText).width
  const startX = (w - fullWidth) / 2

  // Killed count in gold
  ctx.fillStyle = COLOUR_KILLED
  ctx.textAlign = 'left'
  ctx.fillText(killedText, startX, h / 2)

  // Separator and total in muted tone
  ctx.fillStyle = COLOUR_TEXT
  ctx.fillText(sep + totalText, startX + killedWidth, h / 2)
}

export function EnemyCounter() {
  // const phase = useRun((state) => state.phase)
  // if (phase !== 'wave') return null

  return (
    <HudOverlay
      sizeMetres={SIZE_M}
      canvasSize={{ width: CANVAS_W, height: CANVAS_H }}
      offset={OFFSET}
      renderOrder={990}
      draw={draw}
    />
  )
}
