/**
 * Headless capture of the model lab (`?scene=models`, see `src/scenes/ModelLab.tsx`).
 *
 * For each lighting rig, this loads the lab, waits for all three enemy models to settle, reads
 * back the raw GLB material data and a per-cell luminance measurement, and writes:
 *
 *   artifacts/models-<rig>.png                    — the whole grid, one screenshot
 *   artifacts/models-<rig>-<enemyId>-<variant>.png — one crop per specimen
 *   artifacts/models-report.json                   — materials + luminance for every rig
 *
 * The luminance numbers are the point: "mostly white" becomes `mean 0.94, bright 87%`, a
 * number that can be compared across runs without a human judging a PNG each time. A human
 * still has to sign off on the actual look — see PROGRESS.md — but this is what makes that a
 * five-second check of a report instead of a hunt.
 *
 *   npm run dev                      # in one shell
 *   node scripts/captureModels.mjs
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const URL = process.env.SMOKE_URL ?? 'http://localhost:5173'
const OUT = 'artifacts'
const RIGS = ['torch', 'neutral']

mkdirSync(OUT, { recursive: true })

// Same Chromium-cache lookup as `smoke.mjs` — see there for why.
function findChromium() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const cache = join(homedir(), '.cache', 'ms-playwright')
  if (!existsSync(cache)) return undefined
  const builds = readdirSync(cache)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
  for (const build of builds) {
    const bin = join(cache, build, 'chrome-linux64', 'chrome')
    if (existsSync(bin)) return bin
    const alt = join(cache, build, 'chrome-linux', 'chrome')
    if (existsSync(alt)) return alt
  }
  return undefined
}

const executablePath = findChromium()
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

const report = { rigs: {} }
let materials = null

for (const rig of RIGS) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1400 } })
  const consoleErrors = []
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))

  // spin=0: a deterministic frame. Two screenshots of a spinning turntable taken microseconds
  // apart would disagree with each other for no reason worth debugging.
  await page.goto(`${URL}/?scene=models&rig=${rig}&spin=0`, { waitUntil: 'networkidle' })

  await page.waitForFunction(
    () => {
      const c = document.querySelector('canvas')
      return !!c && c.width > 300
    },
    { timeout: 15000 },
  )

  await page.waitForFunction(() => window.__DCVR__?.lab?.ready === true, { timeout: 20000 })

  // Let a few real frames go by after `ready` — the mixer/material clone happens the instant
  // the model arrives, but three still wants a frame to actually rasterise it.
  await page.waitForTimeout(500)

  const gridPath = `${OUT}/models-${rig}.png`
  await page.screenshot({ path: gridPath })

  const [luminance, rects, mats] = await page.evaluate(() => [
    window.__DCVR__.lab.luminance(),
    window.__DCVR__.lab.cellRects(),
    window.__DCVR__.lab.materials,
  ])

  if (!materials) materials = mats

  // Crop each specimen out of the same screenshot. `cellRects` is in device pixels; Playwright's
  // `clip` wants CSS pixels, so divide by devicePixelRatio.
  const dpr = await page.evaluate(() => window.devicePixelRatio || 1)
  const canvasBox = await page.evaluate(() => {
    const c = document.querySelector('canvas')
    const r = c.getBoundingClientRect()
    return { left: r.left, top: r.top }
  })

  const crops = []
  for (const rect of rects ?? []) {
    const clip = {
      x: canvasBox.left + rect.x / dpr,
      y: canvasBox.top + rect.y / dpr,
      width: rect.w / dpr,
      height: rect.h / dpr,
    }
    const path = `${OUT}/models-${rig}-${rect.id}-${rect.variant}.png`
    await page.screenshot({ path, clip })
    crops.push(path)
  }

  report.rigs[rig] = { luminance, consoleErrors, screenshot: gridPath, crops }

  await page.close()
  console.log(`[captureModels] ${rig}: ${crops.length} specimens, ${consoleErrors.length} console errors`)
}

report.materials = materials

const reportPath = `${OUT}/models-report.json`
writeFileSync(reportPath, JSON.stringify(report, null, 2))

await browser.close()

// A flat summary on stdout, so a run doesn't require opening the JSON to see whether anything
// is still blown out.
let worst = null
for (const [rig, data] of Object.entries(report.rigs)) {
  for (const [cell, stats] of Object.entries(data.luminance ?? {})) {
    if (!worst || stats.mean > worst.mean) worst = { rig, cell, ...stats }
  }
}
console.log(`[captureModels] wrote ${reportPath}`)
if (worst) {
  console.log(
    `[captureModels] brightest cell: ${worst.rig} ${worst.cell} — mean ${worst.mean}, ${(worst.brightFraction * 100).toFixed(0)}% near-white`,
  )
}
