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

  // Headless Chromium has no `navigator.xr`, so the entry UI must resolve to its
  // "unavailable" state. That is a real assertion: it proves the support probe settled and
  // the button mounted, rather than hanging forever on an unresolved promise — which is
  // what a player on plain http would otherwise see as a blank corner of the screen.
  const vrEntry = document.querySelector('.vr-entry')

  return {
    canvas: { width: canvas.width, height: canvas.height },
    webgl2: !!gl,
    xr: {
      navigatorXr: navigator.xr != null,
      entryRendered: vrEntry != null,
      entryState: vrEntry?.classList.contains('vr-entry--unavailable')
        ? 'unavailable'
        : vrEntry
          ? 'offered'
          : 'missing',
    },
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown',
    drawingBufferOk: gl ? gl.drawingBufferWidth > 300 : false,
    fps: +(sample.count / (sample.elapsed / 1000)).toFixed(1),
    litPixelRatio: sample.litPixelRatio,
    // The simulation must advance in wall-clock terms even when rendering is slow.
    simAdvanced: debug ? +(sample.simAfter - simTimeBefore).toFixed(3) : null,
    sampleSeconds: +(sample.elapsed / 1000).toFixed(3),
  }
}, SAMPLE_MS)

/**
 * Walk the player around and check the character controller actually resolves collisions.
 *
 * This is the part a screenshot can't answer. A player falling slowly through the floor, or
 * strolling out through a wall, renders a completely convincing room the whole way — the
 * scene looks perfect and the game is broken.
 *
 * Pointer lock isn't available headless, so movement is driven by keyboard alone and the
 * player's heading stays at its default (facing -Z, into the room).
 */
function readPlayer() {
  return page.evaluate(() => {
    const p = window.__DCVR__?.player
    return p
      ? {
          x: +p.position.x.toFixed(3),
          y: +p.position.y.toFixed(3),
          z: +p.position.z.toFixed(3),
          grounded: p.grounded,
        }
      : null
  })
}

/**
 * Hold keys until the player reaches a condition, or give up.
 *
 * Position-based rather than "hold W for four seconds": headless Chromium renders through
 * SwiftShader at wildly variable speed, so a fixed duration covers a different distance on
 * every run. Timed walks quietly stopped short of the staircase and the test then failed
 * for a reason that had nothing to do with the code.
 */
async function walkUntil(keys, done, maxSeconds = 15) {
  for (const key of keys) await page.keyboard.down(key)
  let player = await readPlayer()
  const deadline = Date.now() + maxSeconds * 1000
  // `done` may be async — some conditions are about the interaction focus, not the position.
  while (Date.now() < deadline && !(await done(player))) {
    await page.waitForTimeout(100)
    player = await readPlayer()
  }
  for (const key of keys) await page.keyboard.up(key)
  return player
}

/**
 * The foyer: walk to the door, be offered it, open it, start a wave.
 *
 * This is Sprint 1.1's acceptance test, minus the headset. What it can prove headlessly is
 * the part that is easy to get wrong and impossible to see in a screenshot: that the *right*
 * object is focused, that `Space` opened the door instead of jumping, and that the door
 * actually called into the run.
 */
function readFocus() {
  return page.evaluate(() => window.__DCVR__?.focus ?? null)
}

const foyer = {}
foyer.spawn = await readPlayer()
// From the spawn point, looking at the door — the view a player actually opens the game on.
await page.screenshot({ path: `${OUT}/smoke-foyer.png` })

// Forward, until the door offers itself. The handle is at about a metre and the eye is at
// 1.6m looking dead level, so this is the proximity path rather than the look-ray.
foyer.approach = await walkUntil(
  ['KeyW'],
  async () => (await readFocus())?.id === 'foyer-door',
)
foyer.focus = await readFocus()
foyer.wavesBefore = await page.evaluate(() => window.__DCVR__?.wavesStarted ?? null)

await page.keyboard.press('Space')
await page.waitForTimeout(300)

foyer.wavesAfter = await page.evaluate(() => window.__DCVR__?.wavesStarted ?? null)
foyer.afterActivate = await readPlayer()
foyer.focusAfter = await readFocus()

// The opening leaf shoves anyone standing in its path — it is a kinematic body with a
// collider, and it is supposed to. Step back into the middle of the doorway first.
foyer.recentred = await walkUntil(['KeyD'], (p) => p.x > -0.15, 8)

// Walk through the doorway. This is what proves the door's *collider* swung with it and not
// just its mesh — a door that opens visually and still blocks you is a bug you cannot see.
foyer.throughDoor = await walkUntil(['KeyW'], (p) => p.z < -6.4, 8)

/**
 * Now the greybox, for the movement course. It is the only room with a staircase, a ramp
 * and a ledge in it, and the character controller's behaviour is invisible without them.
 */
await page.goto(`${URL}${URL.includes('?') ? '&' : '?'}scene=greybox`, {
  waitUntil: 'networkidle',
})
await page.waitForFunction(() => window.__DCVR__?.player != null, { timeout: 15000 })
await page.waitForTimeout(500)

const movement = {}
movement.spawn = await readPlayer()

// Left along the open back of the room, lining up with the staircase. The stairs are a
// solid block, so they have to be approached from the front — walking into their side is
// just walking into a 1.08m wall.
movement.toStairs = await walkUntil(['KeyA'], (p) => p.x <= -5)
// Up: six 0.18m risers, every one inside the 0.4m autostep limit, so the player should walk
// up without jumping.
movement.upStairs = await walkUntil(['KeyW'], (p) => p.y > 1)

// A jump from standing. Tapped, not held — the press has to survive being shorter than a
// single fixed step, which is exactly the input the naive polling implementation dropped.
//
// Sampled to the peak rather than at a fixed delay: the whole hop lasts under half a second
// and a single readback under SwiftShader can take longer than that, so a timed sample
// lands somewhere random on the arc and fails a jump that worked perfectly.
await page.keyboard.press('Space')
movement.midJump = { ...movement.upStairs }
let sawAirborne = false
for (let i = 0; i < 12; i++) {
  const sample = await readPlayer()
  if (!sample.grounded) sawAirborne = true
  if (sample.y > movement.midJump.y) movement.midJump = sample
  if (sawAirborne && sample.grounded) break
  await page.waitForTimeout(40)
}
movement.leftTheGround = sawAirborne
await page.waitForTimeout(1200)
movement.landed = await readPlayer()

mkdirSync(OUT, { recursive: true })
await page.screenshot({ path: `${OUT}/smoke.png` })
await browser.close()

info.foyer = foyer
info.movement = movement

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
if (!info.xr.entryRendered) failures.push('VR entry UI never rendered')
// Headless Chromium exposes `navigator.xr` but has no device behind it, so
// `isSessionSupported('immersive-vr')` resolves false. The entry must therefore settle on
// "unavailable". Anything else means the support probe either hung or claimed a session
// could start where none can — the bug that shows up on the headset as a button that does
// nothing.
if (info.xr.entryState !== 'unavailable') {
  failures.push(`VR entry should be unavailable headless, got: ${info.xr.entryState}`)
}
const foy = info.foyer
if (!foy.focus) {
  failures.push('walking to the door never offered it — no interaction focus')
} else {
  if (foy.focus.id !== 'foyer-door') {
    failures.push(`wrong thing focused at the door: ${foy.focus.id}`)
  }
  // The acceptance test for the sprint. A door that animates but never calls into the run
  // is exactly the kind of thing that looks perfect and does nothing.
  if (foy.wavesAfter !== foy.wavesBefore + 1) {
    failures.push(
      `activating the door did not start a wave: ${foy.wavesBefore} -> ${foy.wavesAfter}`,
    )
  }
  // Space is contextual: with a prompt showing it opens the door and must *not* also jump.
  if (Math.abs(foy.afterActivate.y - foy.approach.y) > 0.05) {
    failures.push(`Space jumped as well as activating: y=${foy.afterActivate.y}`)
  }
  // The door swings away as it opens, so the handle may well be out of reach by now. If it
  // is still focused, it must be offering the other half of the toggle.
  if (foy.focusAfter && foy.focusAfter.label !== 'Close the door') {
    failures.push(`door label did not flip after opening: ${foy.focusAfter.label}`)
  }
  if (foy.throughDoor.z >= -6.4) {
    failures.push(`could not walk through the opened door: z=${foy.throughDoor.z}`)
  }
  if (!foy.throughDoor.grounded || Math.abs(foy.throughDoor.y) > 0.15) {
    failures.push(`fell through the floor past the door: y=${foy.throughDoor.y}`)
  }
}

const move = info.movement
if (!move.spawn) failures.push('player state missing — is the rig mounted?')
else {
  // The capsule spawns centred at 0.85m and should settle with its feet on the floor.
  // Anything far from 0 means it either sank through the slab or is hovering above it.
  if (Math.abs(move.spawn.y) > 0.1) {
    failures.push(`player did not settle on the floor: y=${move.spawn.y}`)
  }
  if (!move.spawn.grounded) failures.push('player is not grounded at the spawn point')

  // Strafing works at all — otherwise every check below passes for the wrong reason.
  if (move.toStairs.x > move.spawn.x - 3) {
    failures.push(`strafing did not move the player: x=${move.toStairs.x}`)
  }
  if (!move.toStairs.grounded || Math.abs(move.toStairs.y) > 0.1) {
    failures.push(`player left the floor crossing flat ground: y=${move.toStairs.y}`)
  }

  // Autostep: six risers inside the limit should carry the player up without a jump. This
  // is the fragile one — the min-width setting silently wedges the player halfway up.
  if (move.upStairs.y < 0.8) {
    failures.push(`player did not climb the stairs: y=${move.upStairs.y}`)
  }
  if (!move.upStairs.grounded) {
    failures.push('player is airborne at the top of the stairs')
  }

  // A tapped jump has to register even when the press is shorter than one fixed step.
  if (move.midJump.y <= move.upStairs.y + 0.1) {
    failures.push(`jump did not lift the player: y=${move.midJump.y}`)
  }
  if (!move.leftTheGround) failures.push('player never left the ground during the jump')
  if (!move.landed.grounded) failures.push('player never landed after jumping')
  // Walls sit at ±8 and the floor at 0. Outside that box, the player has left the level —
  // the failure a screenshot of a perfectly good-looking room will never show you.
  for (const [label, sample] of Object.entries(move)) {
    if (!sample) continue
    if (Math.abs(sample.x) > 8 || Math.abs(sample.z) > 8 || sample.y < -0.5) {
      failures.push(`player left the level at ${label}: ${JSON.stringify(sample)}`)
    }
  }
}

if (consoleErrors.length) failures.push(`console errors: ${consoleErrors.join(' | ')}`)

if (failures.length) {
  console.error('\nSMOKE FAILED:\n - ' + failures.join('\n - '))
  process.exit(1)
}
console.log(`\nSMOKE PASSED — screenshot written to ${OUT}/smoke.png`)
