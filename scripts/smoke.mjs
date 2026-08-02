/**
 * Headless render smoke test.
 *
 * Loads the running dev server in Chromium, waits for the WebGL context to come up, then
 * samples the frame loop. Catches the failure mode unit tests can't: the app compiles and
 * mounts fine but renders nothing (missing context, a shader error, an exception inside
 * useFrame). Run it after every sprint.
 *
 *   npm run dev          # in one shell
 *   node scripts/smoke.mjs
 *
 * Headless Chromium renders through SwiftShader, so the FPS number here says nothing about
 * real GPU performance — it only proves the loop is running. Actual perf is measured on the
 * target device with the F1 HUD.
 */
import { chromium } from 'playwright'
import { mkdirSync, existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const URL = process.env.SMOKE_URL ?? 'http://localhost:5173'
const OUT = 'artifacts'
const SAMPLE_MS = 2000

/**
 * Prefer any Chromium already in the Playwright cache over the exact build this Playwright
 * version wants, so a routine `npm update` doesn't trigger a 150MB download in CI.
 * Set CHROME_PATH to override.
 */
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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })

const consoleErrors = []
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text())
})
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))

await page.goto(URL, { waitUntil: 'networkidle' })

// R3F sizes the canvas and creates the context on its first frame.
await page.waitForFunction(
  () => {
    const c = document.querySelector('canvas')
    return !!c && c.width > 300
  },
  { timeout: 15000 },
)

const info = await page.evaluate(async (sampleMs) => {
  const canvas = document.querySelector('canvas')
  const gl = canvas.getContext('webgl2')
  const dbg = gl?.getExtension('WEBGL_debug_renderer_info')
  const debug = window.__DCVR__

  const simTimeBefore = debug?.simTime ?? null

  // Count real animation frames over the sample window, and snapshot the framebuffer from
  // inside a rAF callback. The drawing buffer is created without preserveDrawingBuffer, so
  // it is only readable before the compositor takes it at the end of the frame — reading
  // outside rAF always returns transparent black and looks like a render failure.
  const sample = await new Promise((resolve) => {
    let n = 0
    const start = performance.now()
    const tick = () => {
      n++
      if (performance.now() - start < sampleMs) {
        requestAnimationFrame(tick)
        return
      }
      // Close the timing window here, before the readback. Under SwiftShader
      // getImageData on a 1280x720 buffer takes a few hundred milliseconds, and counting
      // that against the sample makes a perfectly healthy simulation look like it drifted.
      const elapsed = performance.now() - start
      const simAfter = window.__DCVR__?.simTime ?? null

      const c2d = document.createElement('canvas')
      c2d.width = canvas.width
      c2d.height = canvas.height
      const ctx = c2d.getContext('2d')
      ctx.drawImage(canvas, 0, 0)
      const { data } = ctx.getImageData(0, 0, c2d.width, c2d.height)
      let lit = 0
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 24 || data[i + 1] > 24 || data[i + 2] > 24) lit++
      }
      resolve({
        count: n,
        elapsed,
        simAfter,
        litPixelRatio: +(lit / (data.length / 4)).toFixed(4),
      })
    }
    requestAnimationFrame(tick)
  })

  return {
    canvas: { width: canvas.width, height: canvas.height },
    webgl2: !!gl,
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown',
    drawingBufferOk: gl ? gl.drawingBufferWidth > 300 : false,
    fps: +(sample.count / (sample.elapsed / 1000)).toFixed(1),
    litPixelRatio: sample.litPixelRatio,
    // The simulation must advance in wall-clock terms even when rendering is slow.
    simAdvanced: debug ? +(sample.simAfter - simTimeBefore).toFixed(3) : null,
    sampleSeconds: +(sample.elapsed / 1000).toFixed(3),
  }
}, SAMPLE_MS)

mkdirSync(OUT, { recursive: true })
await page.screenshot({ path: `${OUT}/smoke.png` })
await browser.close()

const results = { ...info, consoleErrors }
console.log(JSON.stringify(results, null, 2))

const failures = []
if (!info.webgl2) failures.push('no WebGL2 context')
if (!info.drawingBufferOk) failures.push('drawing buffer never sized')
// Deliberately low: this runs on SwiftShader, which is software rasterisation and nowhere
// near real GPU speed. The bar here is "the loop is turning", not "the game is fast".
if (info.fps < 5) failures.push(`frame loop stalled (${info.fps}fps)`)
if (info.litPixelRatio < 0.05) failures.push('canvas is essentially black — nothing rendered')
// Simulated time must track wall-clock regardless of how slowly frames render. If these
// diverge, the fixed timestep has come unhooked from real time.
if (info.simAdvanced === null) failures.push('debug handle missing — is this a dev build?')
else if (Math.abs(info.simAdvanced - info.sampleSeconds) > 0.25) {
  failures.push(
    `simulation drifted from wall-clock: ${info.simAdvanced}s simulated in ${info.sampleSeconds}s`,
  )
}
if (consoleErrors.length) failures.push(`console errors: ${consoleErrors.join(' | ')}`)

if (failures.length) {
  console.error('\nSMOKE FAILED:\n - ' + failures.join('\n - '))
  process.exit(1)
}
console.log(`\nSMOKE PASSED — screenshot written to ${OUT}/smoke.png`)
