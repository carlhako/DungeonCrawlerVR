/**
 * The frame rate, as an integer, at the top of the view — in the headset, where the F1 HUD
 * cannot go.
 *
 * Deliberately just the number. Anything more is a distraction sitting permanently in a horror
 * game's field of view; the detail lives one button-hold away in `FrameChart`.
 */

import { currentFps, frameStats, TARGET_FPS, useFrameHud } from '@/systems/frameStats'
import { HudOverlay } from '@/ui/HudOverlay'

const CANVAS_W = 160
const CANVAS_H = 64
const SIZE_M: [number, number] = [0.12, 0.048]
/**
 * Right of the view, three fifths of the way up.
 *
 * Not dead centre: the enemy counter is there (Sprint 2.5), and although that one is only up
 * while a face button is held, "the two HUDs I can see at once overlap" is a poor way to find
 * that out in a headset. Far enough over to clear the counter's 40cm width.
 *
 * The height is a headset finding, and it took two goes. At 0.95 — pressed right up against
 * `SAFE_FRACTION`'s limit — it sat at the top edge of the Quest 3's vertical FOV, where reading
 * it meant tilting the head rather than glancing; 0.76 was still too high. A monitor's frustum
 * is far more forgiving than a headset's, and a *comfortable glance* is a much smaller cone
 * than the FOV: what fits on the screen is nowhere near the test.
 */
const ANCHOR: [number, number, number] = [0.62, 0.57, -1]

/** Under this, the frame rate is no longer a rounding error — it is something you can feel. */
const WARN_FPS = TARGET_FPS - 6
const BAD_FPS = TARGET_FPS - 16

function draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const fps = currentFps(frameStats)
  const rounded = Math.round(fps)

  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.beginPath()
  ctx.roundRect(0, 0, w, h, 8)
  ctx.fill()

  ctx.font = 'bold 30px monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const text = `${rounded} fps`
  ctx.fillStyle = '#000'
  ctx.fillText(text, w / 2 + 1, h / 2 + 1)
  ctx.fillStyle = rounded >= WARN_FPS ? '#8fe388' : rounded >= BAD_FPS ? '#ffd479' : '#ff7a6b'
  ctx.fillText(text, w / 2, h / 2)
}

export function FpsReadout() {
  const show = useFrameHud((state) => state.showFpsReadout)
  if (!import.meta.env.DEV || !show) return null

  return (
    <HudOverlay
      sizeMetres={SIZE_M}
      canvasSize={{ width: CANVAS_W, height: CANVAS_H }}
      anchor={ANCHOR}
      renderOrder={992}
      draw={draw}
    />
  )
}
