/**
 * Hold a face button: a live frame-time graph, in the headset.
 *
 * The Sprint 2.5 pattern — a popup near the centre of the view, summoned by holding A/X or
 * B/Y on either controller, gone the instant it is released. A permanent graph in a horror
 * game's field of view is a tax on every second of it, and the number that matters at a glance
 * is already on the `FpsReadout`.
 *
 * Frame *times*, not frame rates, and that is not a detail: fps is a reciprocal, so a hitch
 * looks like a shallow dip on an fps plot and a spike on a time plot. The spike is what a
 * headset feels.
 */

import {
  CHART_SECONDS,
  TARGET_FRAME_MS,
  frameAt,
  frameStats,
  frameSummary,
  useFrameHud,
  windowStart,
} from '@/systems/frameStats'
import { HudOverlay } from '@/ui/HudOverlay'

const CANVAS_W = 384
const CANVAS_H = 224
const SIZE_M: [number, number] = [0.34, 0.198]
/**
 * Below the centre of the view rather than on it. It is summoned deliberately, so it does not
 * need to be out of the way — but it should not be over whatever the player is pointing at
 * when they reach for it, and it must stay clear of the bottom-left minimap.
 */
const ANCHOR: [number, number, number] = [0.12, -0.4, -1]

/**
 * The top of the plot, in milliseconds — 30fps.
 *
 * Fixed rather than auto-scaled to the worst frame in view. An axis that rescales itself moves
 * the 13.9ms target line, which is the one thing on this chart that has to sit still: the
 * question being asked is "is the trace under the line", and it cannot be answered at a glance
 * if the line wanders. Anything worse than 33ms is clamped to the top and reads as off the
 * chart, which is the correct summary of a frame that bad.
 */
const RANGE_MS = 1000 / 30

const PAD_L = 6
const PAD_R = 6
const PAD_T = 6
/** Room under the plot for the supporting numbers. */
const PAD_B = 34

function draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.62)'
  ctx.beginPath()
  ctx.roundRect(0, 0, w, h, 8)
  ctx.fill()

  const plotX = PAD_L
  const plotY = PAD_T
  const plotW = w - PAD_L - PAD_R
  const plotH = h - PAD_T - PAD_B

  ctx.fillStyle = 'rgba(255,255,255,0.05)'
  ctx.fillRect(plotX, plotY, plotW, plotH)

  const yOf = (ms: number) => plotY + plotH - Math.min(ms, RANGE_MS) / RANGE_MS * plotH

  // The budget. Everything else on this chart is read against it.
  const targetY = yOf(TARGET_FRAME_MS)
  ctx.strokeStyle = 'rgba(143,227,136,0.75)'
  ctx.lineWidth = 1
  ctx.setLineDash([5, 4])
  ctx.beginPath()
  ctx.moveTo(plotX, targetY)
  ctx.lineTo(plotX + plotW, targetY)
  ctx.stroke()
  ctx.setLineDash([])

  ctx.font = '11px monospace'
  ctx.textBaseline = 'bottom'
  ctx.textAlign = 'right'
  ctx.fillStyle = 'rgba(143,227,136,0.85)'
  ctx.fillText('72fps', plotX + plotW - 3, targetY - 2)
  ctx.textAlign = 'left'
  ctx.fillStyle = 'rgba(232,213,176,0.5)'
  ctx.fillText(`${Math.round(RANGE_MS)}ms`, plotX + 3, plotY + 12)

  const from = windowStart(frameStats, CHART_SECONDS)
  const frames = frameStats.count - from

  if (frames > 1) {
    const xOf = (i: number) => plotX + (i / (frames - 1)) * plotW

    // Two passes, two strokes: the whole trace, then the over-budget segments on top of it in
    // red. Stroking each segment separately would be several hundred draw calls into a canvas
    // that is re-rasterised every frame the chart is held up.
    ctx.lineWidth = 1.5
    ctx.strokeStyle = '#ffd479'
    ctx.beginPath()
    for (let i = 0; i < frames; i++) {
      const ms = frameAt(frameStats, from + i) * 1000
      const x = xOf(i)
      const y = yOf(ms)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    ctx.strokeStyle = '#ff7a6b'
    ctx.beginPath()
    for (let i = 1; i < frames; i++) {
      const prev = frameAt(frameStats, from + i - 1) * 1000
      const ms = frameAt(frameStats, from + i) * 1000
      if (prev <= TARGET_FRAME_MS && ms <= TARGET_FRAME_MS) continue
      ctx.moveTo(xOf(i - 1), yOf(prev))
      ctx.lineTo(xOf(i), yOf(ms))
    }
    ctx.stroke()
  }

  const summary = frameSummary(frameStats)
  ctx.font = 'bold 15px monospace'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  const row = h - PAD_B / 2 - 2
  writeStat(ctx, PAD_L + 2, row, 'avg', summary.avgFps)
  writeStat(ctx, PAD_L + 2 + plotW * 0.34, row, 'min', summary.minFps)
  writeStat(ctx, PAD_L + 2 + plotW * 0.68, row, '1%', summary.lowFps)
}

/** "avg 71" — the label dim, the number in the colour of its own verdict. */
function writeStat(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  fps: number,
): void {
  ctx.fillStyle = 'rgba(232,213,176,0.55)'
  ctx.fillText(`${label} `, x, y)
  const labelWidth = ctx.measureText(`${label} `).width
  const value = Math.round(fps)
  ctx.fillStyle = value >= 66 ? '#8fe388' : value >= 56 ? '#ffd479' : '#ff7a6b'
  ctx.fillText(String(value), x + labelWidth, y)
}

/**
 * The desktop equivalent of holding a face button: hold **F4**.
 *
 * A key rather than a toggle, so the gesture is the same one the headset uses — and it is a
 * hold for a reason beyond symmetry. `HudOverlay` re-rasterises and re-uploads its canvas on
 * every frame the quad is visible, and a chart left permanently up costs that upload forever;
 * on SwiftShader it was enough to slow the headless smoke test's frames past the point where
 * its timed walks still arrived.
 *
 * Module-level rather than component state on purpose: this is read from inside `useFrame`,
 * and re-rendering React twice per keypress to move a quad would be the more expensive half
 * of the thing being avoided.
 */
let chartKeyHeld = false
if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.addEventListener('keydown', (event) => {
    if (event.code !== 'F4') return
    event.preventDefault()
    chartKeyHeld = true
  })
  window.addEventListener('keyup', (event) => {
    if (event.code === 'F4') chartKeyHeld = false
  })
  // A held key whose keyup lands on another window stays held forever otherwise — and the
  // window that most often steals focus mid-hold is the browser's own devtools.
  window.addEventListener('blur', () => {
    chartKeyHeld = false
  })
}

export function FrameChart() {
  const show = useFrameHud((state) => state.showFpsReadout)
  if (!import.meta.env.DEV || !show) return null

  return (
    <HudOverlay
      sizeMetres={SIZE_M}
      canvasSize={{ width: CANVAS_W, height: CANVAS_H }}
      anchor={ANCHOR}
      renderOrder={993}
      draw={draw}
      // Hold a face button in VR; hold F4 on the desktop.
      requireSideButton
      desktopHold={() => chartKeyHeld}
    />
  )
}
