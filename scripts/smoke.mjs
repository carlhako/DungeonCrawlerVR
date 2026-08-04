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

// Start from a first launch. The save persists across runs by design, so without this the
// second smoke run inherits the first one's gold and the "you start with 100" assertion
// becomes a test of last night's leftovers.
await page.evaluate(() => window.localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })

// R3F sizes the canvas and creates the context on its first frame.
await page.waitForFunction(
  () => {
    const c = document.querySelector('canvas')
    return !!c && c.width > 300
  },
  { timeout: 15000 },
)

// Let the first frames go by before sampling. The first pass through a scene rasterises the
// shop panel, compiles shaders and uploads textures — on a GPU that is a few milliseconds,
// under SwiftShader it is a visible stall, and sampling across it measures startup rather
// than whether the fixed timestep is keeping up with the clock, which is the actual question.
await page.waitForTimeout(700)

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

function readRun() {
  return page.evaluate(() => window.__DCVR__?.run ?? null)
}

/** The save, flattened — weapon ids rather than the whole ownership map. */
function readSave() {
  return page.evaluate(() => {
    const save = window.__DCVR__?.save
    return save
      ? {
          gold: save.gold,
          wave: save.wave,
          bestWave: save.bestWave,
          weapons: Object.keys(save.weapons).sort(),
          equipped: save.equipped,
        }
      : null
  })
}

const foyer = {}
foyer.spawn = await readPlayer()
foyer.saveAtStart = await readSave()
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
foyer.throughDoor = await walkUntil(['KeyW'], (p) => p.z < -6.8, 8)

/**
 * The rest of the run loop, which is Sprint 1.2's acceptance test.
 *
 * Out through the door is `loading` then `wave`; back into the foyer is the placeholder
 * wave-clear, which pays out and advances the wave counter. Every one of these steps is
 * invisible in a screenshot and consequential in the save file.
 */
await page.waitForFunction(() => window.__DCVR__?.run.phase === 'wave', { timeout: 8000 })
foyer.runInDungeon = await readRun()

/**
 * On into the generated dungeon, which is Sprint 2.1's acceptance test on the walking side.
 *
 * The generator's own guarantees — connected, traversable, the same seed twice — are unit
 * tested. What only a running game can answer is whether the level the *player* meets is the
 * one the generator described: that the passage really opens onto it rather than into an
 * invisible wall, that the player ends up standing on a cell the generator calls floor, and
 * that a level of a few thousand cells still draws in a handful of calls. That last number
 * is the one that decides whether a Quest holds 72fps.
 */
const dungeon = {}
dungeon.map = await page.evaluate(() => {
  const d = window.__DCVR__.dungeon
  return d ? { seed: d.seed, rooms: d.rooms, torches: d.torches, spawns: d.spawns } : null
})
dungeon.inside = await walkUntil(['KeyW'], (p) => p.z < -16, 20)
dungeon.render = await page.evaluate(() => window.__DCVR__.render)
dungeon.cell = await page.evaluate(() => window.__DCVR__.dungeon?.playerCell ?? null)

/**
 * Open the door and get a wave under way.
 *
 * `Space` on the door is a *toggle*, and after walking home through it the door is still
 * standing open — so a single press closes it again and starts nothing. Pressing until the
 * run machine actually moves is what a player does without thinking about it.
 */
async function openDoorAndStart(maxPresses = 4) {
  for (let i = 0; i < maxPresses; i++) {
    if ((await readRun())?.phase !== 'foyer') return true
    await page.keyboard.press('Space')
    await page.waitForTimeout(600)
  }
  return (await readRun())?.phase !== 'foyer'
}

/**
 * Walk back to the foyer, re-aiming as we go.
 *
 * Not `walkUntil(['KeyS'])`. Aiming at an enemy leaves the player facing wherever that enemy
 * was, so "backwards" is no longer "back up the corridor" — which is how this first failed,
 * with the player reversing confidently into a wall for a minute and a half. Facing the foyer
 * and walking forwards is what a player does, and re-aiming as the position changes is the
 * headless stand-in for looking where you are going.
 */
async function walkHome(maxSeconds) {
  const deadline = Date.now() + maxSeconds * 1000
  await page.keyboard.down('KeyW')
  while (Date.now() < deadline) {
    if ((await readRun())?.phase === 'foyer') break
    // The foyer's spawn point, which is well inside the room.
    await page.evaluate(() => window.__DCVR__.lookAt(0, 1.6, 4))
    await page.waitForTimeout(200)
  }
  await page.keyboard.up('KeyW')
  return readPlayer()
}

/**
 * The wave itself, which is Sprint 2.3's acceptance test.
 *
 * None of this is visible in a screenshot. A wave that has quietly stopped spawning, an enemy
 * wedged against a wall, a telegraph that never resolves and a player on three health all
 * render a perfectly convincing dark corridor. So the checks are about the state: that
 * something arrived, that it came *towards* the player rather than standing where it spawned,
 * that a bolt from the real weapon killed one, that the wave clears only once everything is
 * dead, and that the payout is the sum of what was killed.
 */
const readEnemies = () => page.evaluate(() => window.__DCVR__?.enemies ?? null)

const wave = {}

// The director holds the first arrival back for a few seconds, deliberately — nobody should
// be met at the door. Then it staggers them.
await page
  .waitForFunction(() => (window.__DCVR__?.enemies.living ?? 0) > 0, { timeout: 30000 })
  .catch(() => {})
wave.firstArrival = await readEnemies()

/**
 * What became of the enemy models — Sprint 2.7.
 *
 * The art is a CC0 pack Carl drops into `public/models/`, and it is deliberately not committed,
 * so on this machine every entry is expected to read `missing`. That is the assertion worth
 * making: the *absence* of the pack has to be a resolved, quiet state that leaves a wave of
 * capsules walking around, not a promise that never settles and not a console full of errors.
 * When the files do land, the same check proves they parsed and says which clips are in them.
 */
wave.models = await page.evaluate(() => window.__DCVR__?.models ?? null)

/** Distance from the player to the nearest living enemy, or null. */
async function nearestEnemy() {
  const [enemies, player] = await Promise.all([readEnemies(), readPlayer()])
  if (!enemies || !player) return null
  const living = enemies.enemies.filter((e) => e.phase !== 'dying')
  if (living.length === 0) return null
  let best = null
  for (const enemy of living) {
    const distance = Math.hypot(enemy.x - player.x, enemy.z - player.z)
    if (!best || distance < best.distance) best = { ...enemy, distance }
  }
  return best
}

// It has to come to the player. An enemy that spawns and stays there is the failure mode of
// every part of this sprint at once — aggro, line of sight, pathing or the nav bake.
wave.approachFrom = await nearestEnemy()
/**
 * Long enough for the stealth safety valve, measured in *headless* seconds.
 *
 * Sprint 2.4 replaced the flat 2-second `HUNT_DELAY` with three detection paths, the last of
 * which is a 30-second last-resort timer — and a headless player standing still is precisely
 * the case that falls through to it, since `detectionScale` shrinks with the player's speed.
 * Thirty *simulated* seconds is far longer in wall clock here: SwiftShader frames take a good
 * fraction of a second and `MAX_FRAME_DELTA` clamps each one to 0.25s of simulation, so the
 * world runs at well under half real time. The old 45s window was written against 2.3's
 * two-second timer and has been failing this check ever since 2.4 landed.
 */
const approachDeadline = Date.now() + 150000
let closest = wave.approachFrom
while (Date.now() < approachDeadline) {
  const now = await nearestEnemy()
  if (now && (!closest || now.distance < closest.distance)) closest = now
  if (closest && closest.distance < 4) break
  await page.waitForTimeout(250)
}
wave.approachTo = closest
wave.phasesSeen = (await readEnemies())?.enemies.map((e) => e.phase) ?? []

/**
 * Kill one with the wand.
 *
 * The point is not that the Emberwand does damage — Sprint 2.2's dummies proved that. It is
 * that an *enemy* is a damageable like any other: registered once for its pool slot, hit by
 * the same swept segment, killed through the same `applyDamage`, and then counted and paid
 * for by the director. That chain has five links and any of them can be silently wrong.
 */
wave.killTarget = await nearestEnemy()
const killDeadline = Date.now() + 60000
while (Date.now() < killDeadline) {
  const at = await nearestEnemy()
  if (!at) break
  const killed = (await readEnemies())?.killed ?? 0
  if (killed > 0) break
  await page.evaluate((e) => window.__DCVR__.lookAt(e.x, e.y, e.z), at)
  await page.mouse.down({ button: 'left' })
  await page.waitForTimeout(600)
  await page.mouse.up({ button: 'left' })
}
wave.afterFirstKill = await readEnemies()
await page.screenshot({ path: `${OUT}/smoke-wave.png` })

// The rest of the wave goes through the dev handle, which deals lethal damage through the
// real damage path and nothing else — the kill count, the gold and the clear are all still
// the game's own. Twelve damage at a time under SwiftShader is minutes of wall clock.
const clearDeadline = Date.now() + 120000
while (Date.now() < clearDeadline) {
  const run = await readRun()
  if (run?.phase !== 'wave') break
  await page.evaluate(() => window.__DCVR__.slay())
  await page.waitForTimeout(500)
}
wave.onClear = await readEnemies()
foyer.runOnClear = await readRun()

/**
 * And then walk home.
 *
 * A cleared wave does not teleport anybody anywhere. The level is continuous with the foyer
 * on purpose and stays standing, empty, until the player walks back through it — so this is
 * also the check that clearing a wave did not quietly unmount the floor out from under them.
 */
foyer.backInside = await walkHome(90)
foyer.runAfterWalkHome = await readRun()
foyer.saveAfterWave = await readSave()
// Sampled here rather than on the clear: the level is put away when the player is handed
// back to the shop, not the moment the last enemy dies.
await page
  .waitForFunction(() => window.__DCVR__?.dungeon == null, { timeout: 8000 })
  .catch(() => {})
dungeon.cleared = await page.evaluate(() => window.__DCVR__.dungeon)

/**
 * The shop, which is Sprint 1.3's acceptance test.
 *
 * Driven the way a player drives it: walk to the counter, look at a button, press the key.
 * Nothing here calls the store directly — the point is to prove that the buttons drawn on
 * the panel are registered where they appear and do what they say.
 *
 * Headless Chromium has no pointer lock, so aiming goes through the dev handle's `lookAt`.
 * That is the only concession; everything after it is the real interaction path.
 */
async function lookAtTarget(id) {
  const target = (await page.evaluate(() => window.__DCVR__?.targets ?? [])).find(
    (t) => t.id === id,
  )
  if (!target) return null
  await page.evaluate((t) => window.__DCVR__.lookAt(t.x, t.y, t.z), target)
  // Wait for the focus to actually land rather than for a fixed delay. Under SwiftShader a
  // single frame can take longer than any delay worth writing, and a timed wait here failed
  // intermittently for reasons that had nothing to do with the shop.
  await page
    .waitForFunction((want) => window.__DCVR__?.focus?.id === want, id, { timeout: 5000 })
    .catch(() => {})
  return readFocus()
}

async function pressButton(id) {
  const focus = await lookAtTarget(id)
  if (focus?.id !== id) return focus
  await page.keyboard.press('Space')
  await page.waitForTimeout(400)
  return focus
}

const shop = {}
// Turn around and walk to the counter. The panel faces the room from the far side, so a
// player who never turns never sees it — which is exactly the case a headless test misses.
await page.evaluate(() => window.__DCVR__.lookAt(3.4, 1.5, 2.88))
shop.walkOver = await walkUntil(['KeyW'], (p) => p.z > 1.9 && p.x > 3.0, 15)
// Back off to a arm's-length reading distance. Pressed right up against the board, the
// angles to the outer buttons get steep enough that a level-ish ray misses them — which is
// true for a real player too, and is what the prompt is for.
shop.settle = await walkUntil(['KeyS'], (p) => p.z < 2.15, 5)
shop.targets = await page.evaluate(() =>
  (window.__DCVR__?.targets ?? []).filter((t) => t.id.startsWith('select-')).map((t) => t.id),
)

// Inspect a weapon you do not own, then buy it, then put it in your off hand.
shop.selectFocus = await pressButton('select-frostbrand-sword')
shop.buyFocus = await pressButton('buy-frostbrand-sword')
shop.saveAfterBuy = await readSave()
shop.equipFocus = await pressButton('equip-frostbrand-sword-off')
shop.saveAfterEquip = await readSave()

// And a refusal: nothing should be affordable at this point, and the panel has to say so
// rather than going quiet.
shop.brokeAttempt = await pressButton('select-boneshard-staff')
shop.buyWhenBroke = await pressButton('buy-boneshard-staff')
shop.saveWhenBroke = await readSave()
shop.feedback = await page.evaluate(() => window.__DCVR__?.shop ?? null)

/**
 * And from across the counter, off-centre.
 *
 * The headset defect this covers: buttons were picked as the sphere inscribed in them, so an
 * upgrade row drawn 45cm wide had a 4cm target and pointing at it from any distance missed.
 * Standing back and aiming 15cm off the centre of a button is the ordinary way to use a
 * board, and it has to work.
 */
shop.standBack = await walkUntil(['KeyS'], (p) => p.z < 1.65, 6)
shop.aimCentre = await lookAtTarget('select-emberwand')
await pressButton('select-emberwand')
const damageRow = (await page.evaluate(() => window.__DCVR__?.targets ?? [])).find(
  (t) => t.id === 'upgrade-emberwand-damage',
)
// The board's own right axis is world -x here, so this offset runs along the row.
await page.evaluate((t) => window.__DCVR__.lookAt(t.x + 0.15, t.y, t.z), damageRow)
await page
  .waitForFunction(() => window.__DCVR__?.focus?.id === 'upgrade-emberwand-damage', null, {
    timeout: 5000,
  })
  .catch(() => {})
shop.aimOffCentre = await readFocus()
shop.aimDistance = shop.aimOffCentre?.distance ?? null

foyer.purchase = { ok: shop.saveAfterBuy?.weapons.includes('frostbrand-sword') }
foyer.saveAfterPurchase = shop.saveAfterEquip

/**
 * Sprint 2.2: shoot and swing at the training dummies.
 *
 * Driven through the real input path — mouse buttons, the same ones a player uses — rather
 * than by calling into the combat systems. What this can prove headlessly is everything a
 * screenshot cannot: that a bolt left the wand, that it crossed the room and found a target,
 * that mana was actually spent, that the cooldown held the rate down, and that the *element*
 * survived the trip from the weapon table to a resistant target.
 *
 * The player owns the Emberwand in their main hand and has just equipped the Frostbrand in
 * their off hand, which is exactly the loadout this needs.
 */
const readCombat = () => page.evaluate(() => window.__DCVR__?.combat ?? null)
const readFx = () => page.evaluate(() => window.__DCVR__?.fx ?? null)

/**
 * Sprint 2.6's effects are things that exist for a fifth of a second.
 *
 * A single reading taken after a volley is a reading taken between two bursts, so the peak
 * over a window is the only honest measurement — and it is the one that says the sparks, the
 * trails and the shake actually fired rather than that the pool merely exists.
 */
async function peakFx(seconds) {
  const peak = { particles: 0, trauma: 0, hitstop: 0 }
  const deadline = Date.now() + seconds * 1000
  while (Date.now() < deadline) {
    const now = await readFx()
    if (now) {
      peak.particles = Math.max(peak.particles, now.particles)
      peak.trauma = Math.max(peak.trauma, now.trauma)
      peak.hitstop = Math.max(peak.hitstop, now.hitstop)
    }
    await page.waitForTimeout(60)
  }
  return peak
}
const readDummy = (id) =>
  page.evaluate(
    (want) => (window.__DCVR__?.damageables ?? []).find((d) => d.id === want) ?? null,
    id,
  )

const combat = {}
combat.dummies = await page.evaluate(() => window.__DCVR__?.damageables ?? [])

/** Positions come off the debug handle, so moving a dummy never silently skips a check. */
const dummyAt = (id) => combat.dummies.find((d) => d.id === id)

/** Face a dummy and close to `within` metres of it. */
async function approachDummy(id, within) {
  const at = dummyAt(id)
  if (!at) return null
  await page.evaluate((d) => window.__DCVR__.lookAt(d.x, d.y, d.z), at)
  const stopped = await walkUntil(
    ['KeyW'],
    (p) => Math.hypot(p.x - at.x, p.z - at.z) < within,
    20,
  )
  // Re-aim after arriving: the walk was aimed from where the player started.
  await page.evaluate((d) => window.__DCVR__.lookAt(d.x, d.y, d.z), at)
  await page.waitForTimeout(200)
  return stopped
}

combat.walkOver = await approachDummy('dummy-plain', 2.2)

combat.before = await readCombat()
combat.plainBefore = await readDummy('dummy-plain')

// Hold the left button. A wand fires while held, so this is one gesture, not a click-fest.
await page.mouse.down({ button: 'left' })
// Sampled while firing rather than after: muzzle flashes, trails and impact sparks all live
// for a fraction of a second, and a reading taken once the shooting stops finds an empty pool.
combat.fx = await peakFx(1.6)
await page.mouse.up({ button: 'left' })
await page.waitForTimeout(500)

combat.afterVolley = await readCombat()
combat.plainAfter = await readDummy('dummy-plain')

// Mana has to come back on its own, or the weapon is a one-shot.
await page.waitForTimeout(2500)
combat.manaRecovered = (await readCombat())?.mana ?? null
/**
 * Nothing may be left over: particles that never retire fill a pool that then stops drawing
 * anything, and trauma that never decays is a camera that shakes forever.
 *
 * Read only once the *burn* is out. Fire leaves a 3-second burning status that ticks damage
 * through the same path a bolt does, so it keeps producing perfectly legitimate impact bursts
 * for seconds after the shooting stops — which is what this check first reported as a leak.
 */
await page.waitForTimeout(4000)
combat.fxIdle = await readFx()

/**
 * The element, against a target that resists it.
 *
 * The pipeline can be silently wrong here while everything still looks right: a bolt that
 * lands and takes damage off proves nothing about whether `fire` reached `resolveDamage`.
 * The soaked dummy resists fire by 60%, so the same number of hits must cost it visibly less
 * health than the plain one.
 */
combat.walkToResistant = await approachDummy('dummy-fireproof', 2.2)

const resistantBefore = await readDummy('dummy-fireproof')
await page.mouse.down({ button: 'left' })
await page.waitForTimeout(1600)
await page.mouse.up({ button: 'left' })
await page.waitForTimeout(400)
const resistantAfter = await readDummy('dummy-fireproof')

combat.resistant = {
  before: resistantBefore,
  after: resistantAfter,
  lost: (resistantBefore?.hp ?? 0) - (resistantAfter?.hp ?? 0),
}
combat.plainLost = (combat.plainBefore?.hp ?? 0) - (combat.plainAfter?.hp ?? 0)

/**
 * And the blade, in the off hand.
 *
 * Desktop melee is an animated swing whose tip is measured by exactly the same speed rule
 * the headset uses — there is no separate desktop damage path, which is the point. Walking
 * right up to the dummy first: a sword has to be in reach of something.
 */
// As close as a 30cm capsule can get to a dummy on a 40cm base.
combat.close = await approachDummy('dummy-fireproof', 1.0)
const meleeBefore = await readDummy('dummy-fireproof')
for (let i = 0; i < 4; i++) {
  await page.mouse.down({ button: 'right' })
  await page.waitForTimeout(80)
  await page.mouse.up({ button: 'right' })
  await page.waitForTimeout(500)
}
const meleeAfter = await readDummy('dummy-fireproof')
combat.melee = {
  before: meleeBefore,
  after: meleeAfter,
  lost: (meleeBefore?.hp ?? 0) - (meleeAfter?.hp ?? 0),
  swingSpeed: (await readCombat())?.hands.off.swingSpeed ?? null,
  // The tell that a *sword* landed, rather than the fire the wand left burning: only the
  // Frostbrand can chill something. The first version of this check asked whether health
  // went down, and passed for three whole runs on burn ticks alone while the blade was
  // swinging straight over the top of the dummy.
  chilled: (meleeAfter?.statuses ?? []).includes('chilled'),
}
await page.screenshot({ path: `${OUT}/smoke-combat.png` })

/**
 * Death, which is the other half of Sprint 2.3's acceptance test.
 *
 * "Death returns you to the foyer with everything intact." Three separate claims, and the
 * expensive one is the third: a run that quietly charged the player for dying would be
 * invisible until somebody had lost an evening's gold to it.
 *
 * The last blow is a real enemy strike through the real damage path — `setHealth` only sets
 * up the hit, because getting honestly from 100 health to nearly dead is several minutes of
 * headless frames.
 */
const death = {}
death.saveBefore = await readSave()

// Face the door first: the combat section left the player aimed at a training dummy on the
// far side of the room, and "forward" is wherever they are looking.
await page.evaluate(() => window.__DCVR__.lookAt(0, 1.1, -6))
await walkUntil(['KeyW'], async () => (await readFocus())?.id === 'foyer-door', 25)
death.started = await openDoorAndStart()
await walkUntil(['KeyD'], (p) => p.x > -0.15, 8)
await page.evaluate(() => window.__DCVR__.lookAt(0, 1.1, -20))
await walkUntil(['KeyW'], (p) => p.z < -6.8, 12)
await page
  .waitForFunction(() => window.__DCVR__?.run.phase === 'wave', { timeout: 12000 })
  .catch(() => {})

// In far enough to be found, then stand still and let something reach us.
await walkUntil(['KeyW'], (p) => p.z < -16, 25)
await page
  .waitForFunction(() => (window.__DCVR__?.enemies.living ?? 0) > 0, { timeout: 40000 })
  .catch(() => {})

death.hpBeforeAnyHit = (await readEnemies())?.hp ?? null

// Wait for one to actually hurt us — which is the check that an enemy's strike reaches the
// player's health at all, and not through any back door.
const hurtDeadline = Date.now() + 60000
while (Date.now() < hurtDeadline) {
  const now = await readEnemies()
  if (now && now.hp < now.maxHp) break
  await page.waitForTimeout(300)
}
death.hpAfterBeingHit = (await readEnemies())?.hp ?? null

// One blow from dead. The blow itself is theirs.
await page.evaluate(() => window.__DCVR__.setHealth(1))
await page
  .waitForFunction(() => window.__DCVR__?.run.phase === 'death', { timeout: 45000 })
  .catch(() => {})
death.runOnDeath = await readRun()

// Death is the one forced move in the game: there is no walk home available from dead.
await page
  .waitForFunction(() => window.__DCVR__?.run.phase === 'foyer', { timeout: 15000 })
  .catch(() => {})
death.runAfter = await readRun()
death.playerAfter = await readPlayer()
death.saveAfter = await readSave()
death.hpAfter = (await readEnemies())?.hp ?? null

/**
 * Now the greybox, for the movement course. It is the only room with a staircase, a ramp
 * and a ledge in it, and the character controller's behaviour is invisible without them.
 */
await page.goto(`${URL}${URL.includes('?') ? '&' : '?'}scene=greybox`, {
  waitUntil: 'networkidle',
})
await page.waitForFunction(() => window.__DCVR__?.player != null, { timeout: 15000 })
await page.waitForTimeout(500)

// That `goto` was a genuine page load, which makes it the reload half of Sprint 1.2's
// acceptance test: gold and owned weapons have to come back out of localStorage.
foyer.saveAfterReload = await readSave()
foyer.runAfterReload = await readRun()

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

/**
 * The reset plaque, last — because it destroys everything the tests above built.
 *
 * The assertion that matters is the one in the middle: after the *first* press the save is
 * still exactly as it was. A reset that fires on a single trigger pull is a bug that costs a
 * player their evening, and it is the kind that only shows up once, in the headset, for real.
 */
await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__DCVR__?.player != null, { timeout: 15000 })
await page.waitForTimeout(500)

/**
 * The settings board: it shares the foyer visit with the reset plaque, and the pair
 * of them are the point of Sprint 1.4 — every control in a headset has to be *in the room*.
 */
const settings = {}
const readSettings = () => page.evaluate(() => window.__DCVR__?.settings ?? null)
settings.before = await readSettings()

await page.evaluate(() => window.__DCVR__.lookAt(-1.95, 1.5, -5.82))
settings.walkOver = await walkUntil(['KeyW'], (p) => p.z < -3.9, 12)
settings.teleportFocus = await pressButton('set-locomotion-teleport')
settings.afterTeleport = await readSettings()
await pressButton('set-comfortVignette-down')
await pressButton('set-snapTurnDegrees-up')
settings.afterSteps = await readSettings()
// Stored, not just held: a comfort option that does not survive a reload is one the player
// has to set again every time they put the headset on.
settings.persisted = await page.evaluate(() =>
  JSON.parse(window.localStorage.getItem('dcvr.settings') ?? '{}').state ?? null,
)
settings.restoreFocus = await pressButton('set-defaults')
settings.afterDefaults = await readSettings()

const reset = {}
reset.saveBefore = await readSave()
reset.settingsBefore = await readSettings()
// It is on the back wall, behind the spawn — so this also proves a player who turns around
// can find it. The ray only reaches 3.5m, same as any other interactable.
await page.evaluate(() => window.__DCVR__.lookAt(-2.6, 1.5, 5.82))
reset.walkOver = await walkUntil(['KeyW'], (p) => p.z > 3.2 && p.x < -1.6, 15)

reset.armFocus = await pressButton('reset-game')
reset.saveAfterArm = await readSave()
reset.confirmFocus = await pressButton('reset-game')
reset.saveAfterWipe = await readSave()
reset.settingsAfterWipe = await readSettings()

mkdirSync(OUT, { recursive: true })
await page.screenshot({ path: `${OUT}/smoke.png` })
await browser.close()

info.foyer = foyer
info.shop = shop
info.movement = movement
info.dungeon = dungeon
info.combat = combat
info.wave = wave
info.death = death
info.settings = settings
info.reset = reset

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
  if (foy.throughDoor.z >= -6.8) {
    failures.push(`could not walk through the opened door: z=${foy.throughDoor.z}`)
  }
  if (!foy.throughDoor.grounded || Math.abs(foy.throughDoor.y) > 0.15) {
    failures.push(`fell through the floor past the door: y=${foy.throughDoor.y}`)
  }
}

// Sprint 1.2: the save, and the run machine that writes to it.
if (!foy.saveAtStart) {
  failures.push('no save on the debug handle — is the game store mounted?')
} else {
  if (foy.saveAtStart.gold !== 100) {
    failures.push(`a new game should start with 100 gold, got ${foy.saveAtStart.gold}`)
  }
  if (!foy.saveAtStart.weapons.includes('emberwand')) {
    failures.push('the player does not own the starter weapon')
  }
  if (foy.runInDungeon?.phase !== 'wave') {
    failures.push(`never reached the wave phase: ${JSON.stringify(foy.runInDungeon)}`)
  }
  if (foy.runOnClear?.phase !== 'waveComplete') {
    failures.push(`killing every enemy did not clear the wave: ${foy.runOnClear?.phase}`)
  }
  if (foy.runAfterWalkHome?.phase !== 'foyer') {
    failures.push(`walking home did not end the run: ${foy.runAfterWalkHome?.phase}`)
  }
  // The payout, and the wave counter advancing. Both live in the save, so both are what a
  // reload has to bring back.
  if (!(foy.saveAfterWave.gold > foy.saveAtStart.gold)) {
    failures.push(`clearing a wave paid nothing: ${foy.saveAtStart.gold} -> ${foy.saveAfterWave.gold}`)
  }
  if (foy.saveAfterWave.wave !== foy.saveAtStart.wave + 1) {
    failures.push(`wave counter did not advance: ${foy.saveAfterWave.wave}`)
  }
  if (!foy.purchase?.ok) {
    failures.push(`could not buy a weapon after the payout: ${JSON.stringify(foy.purchase)}`)
  }
  if (foy.saveAfterPurchase.gold >= foy.saveAfterWave.gold) {
    failures.push('buying a weapon did not cost anything')
  }

  // The acceptance test for the sprint: none of the above may evaporate on reload.
  if (!foy.saveAfterReload) {
    failures.push('no save after reload')
  } else {
    if (foy.saveAfterReload.gold !== foy.saveAfterPurchase.gold) {
      failures.push(
        `gold did not survive the reload: ${foy.saveAfterPurchase.gold} -> ${foy.saveAfterReload.gold}`,
      )
    }
    if (!foy.saveAfterReload.weapons.includes('frostbrand-sword')) {
      failures.push('the purchased weapon did not survive the reload')
    }
    if (foy.saveAfterReload.equipped.off !== 'frostbrand-sword') {
      failures.push('the equipped loadout did not survive the reload')
    }
    if (foy.saveAfterReload.wave !== foy.saveAfterWave.wave) {
      failures.push(`wave progress did not survive the reload: ${foy.saveAfterReload.wave}`)
    }
    // The phase deliberately does *not* persist — a restored mid-wave state would drop the
    // player into a dungeon that no longer exists.
    if (foy.runAfterReload?.phase !== 'foyer') {
      failures.push(`reload should return to the foyer, got ${foy.runAfterReload?.phase}`)
    }
    // ...but it must pick the *wave* back up from the save, or the status board greets a
    // returning player with a wave they cleared an hour ago.
    if (foy.runAfterReload?.wave !== foy.saveAfterReload.wave) {
      failures.push(
        `run resumed on the wrong wave: run ${foy.runAfterReload?.wave}, save ${foy.saveAfterReload.wave}`,
      )
    }
  }
}

// Sprint 1.3: the shop, driven through the interaction system rather than through the store.
const shp = info.shop
if (!shp.targets?.length) {
  failures.push('the shop panel registered no buttons — is it mounted?')
} else {
  if (shp.selectFocus?.id !== 'select-frostbrand-sword') {
    failures.push(`could not aim at a shop button: ${JSON.stringify(shp.selectFocus)}`)
  }
  // Buying through the panel, not through the store. A button that renders and is registered
  // somewhere else in the room looks perfect and is unusable.
  if (shp.buyFocus?.id !== 'buy-frostbrand-sword') {
    failures.push('the buy button was not offered after selecting an unowned weapon')
  }
  if (!shp.saveAfterBuy?.weapons.includes('frostbrand-sword')) {
    failures.push('pressing buy did not buy the weapon')
  }
  if (!(shp.saveAfterBuy.gold < foyer.saveAfterWave.gold)) {
    failures.push(`buying did not cost gold: ${shp.saveAfterBuy.gold}`)
  }
  if (shp.saveAfterEquip?.equipped.off !== 'frostbrand-sword') {
    failures.push(`equipping to the off hand did not take: ${JSON.stringify(shp.saveAfterEquip?.equipped)}`)
  }
  // Gold validation: the second weapon is out of reach, and the refusal has to be visible.
  if (shp.saveWhenBroke?.weapons.includes('boneshard-staff')) {
    failures.push('bought a weapon the player could not afford')
  }
  if (shp.feedback?.ok !== false || !shp.feedback?.feedback) {
    failures.push(`an unaffordable purchase said nothing: ${JSON.stringify(shp.feedback)}`)
  }

  // Pointing from across the counter, off the centre of the button. This is what the shop
  // failed at in the headset: the pickable target was the sphere inscribed in each button,
  // 4cm across on a row drawn 45cm wide, so the panel could only be operated by touching it.
  if (!(shp.aimDistance > 1)) {
    failures.push(`shop aim was not tested from a distance: ${shp.aimDistance}m`)
  }
  if (shp.aimOffCentre?.id !== 'upgrade-emberwand-damage') {
    failures.push(
      `aiming 15cm off the centre of a button missed it: ${JSON.stringify(shp.aimOffCentre)}`,
    )
  }
  if (shp.aimOffCentre?.source !== 'ray') {
    failures.push(`a button pointed at from 1m was not picked by the ray: ${shp.aimOffCentre?.source}`)
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

/**
 * Sprint 2.3: the wave.
 *
 * The order of these matters if one fails. "Nothing spawned" makes every check below it
 * meaningless, and "it spawned but never moved" is a different bug from "it moved but could
 * not be killed" — so they are reported as themselves rather than as one failed loop.
 */
const wav = info.wave
if (!wav.firstArrival || wav.firstArrival.total <= 0) {
  failures.push('the wave director composed an empty wave')
} else if ((wav.firstArrival.living ?? 0) === 0) {
  failures.push(
    `nothing arrived in the dungeon: ${JSON.stringify({
      total: wav.firstArrival.total,
      queued: wav.firstArrival.queued,
    })}`,
  )
} else {
  // It has to come *to* the player. Something that spawns and stays put is the failure mode
  // of every part of this sprint at once — aggro, line of sight, pathing or the nav bake.
  if (!wav.approachTo) {
    failures.push('lost track of every enemy before one got close')
  } else if (wav.approachTo.distance > 6) {
    failures.push(
      `nothing came within reach: nearest ${wav.approachTo.distance.toFixed(1)}m, phase ${wav.approachTo.phase}`,
    )
  }
  if (wav.approachFrom && wav.approachTo && wav.approachTo.distance >= wav.approachFrom.distance) {
    failures.push(
      `enemies never closed the gap: ${wav.approachFrom.distance?.toFixed(1)}m -> ${wav.approachTo.distance.toFixed(1)}m`,
    )
  }
  // Sprint 2.7. Every model must have *settled* — loaded or given up — by the time the first
  // enemy is walking around. An entry still saying `loading` minutes in is a fetch that hung,
  // which on a real connection is an enemy that stays a capsule forever with nothing said.
  if (!wav.models) {
    failures.push('the model loader never reported anything')
  } else {
    for (const [id, entry] of Object.entries(wav.models)) {
      if (entry.status !== 'ready' && entry.status !== 'missing') {
        failures.push(`${id}'s model never settled: ${entry.status} (${entry.url})`)
      }
      // A model that loaded but has nothing in it is worse than none: the enemy stands there.
      if (entry.status === 'ready' && entry.clips.length === 0) {
        failures.push(`${id}'s model loaded with no animation clips in it (${entry.url})`)
      }
    }
  }
  // An enemy is a damageable like any other: same registry, same swept segment, same
  // applyDamage — and then counted and paid for by the director. Five links, any of which
  // can be silently wrong while the wand still looks like it is firing.
  if ((wav.afterFirstKill?.killed ?? 0) < 1) {
    failures.push('the wand never killed an enemy')
  }
  if ((wav.afterFirstKill?.gold ?? 0) < 1) {
    failures.push('a kill paid no gold')
  }
  if (!wav.onClear?.cleared) {
    failures.push('the wave never reported itself cleared')
  }
  if (wav.onClear && wav.onClear.killed !== wav.onClear.total) {
    failures.push(
      `cleared with enemies unaccounted for: ${wav.onClear.killed}/${wav.onClear.total}`,
    )
  }
  // The payout is the sum of what was killed, not a flat clear bonus. That is the whole
  // reason the director owns the number.
  if (wav.onClear && info.foyer.saveAfterWave && info.foyer.saveAtStart) {
    const paid = info.foyer.saveAfterWave.gold - info.foyer.saveAtStart.gold
    if (paid !== wav.onClear.gold) {
      failures.push(`payout did not match the kills: paid ${paid}, earned ${wav.onClear.gold}`)
    }
  }
}

/** Sprint 2.3: death costs the wave and nothing else. */
const die = info.death
if (die.hpAfterBeingHit == null || die.hpAfterBeingHit >= (die.hpBeforeAnyHit ?? 0)) {
  failures.push(
    `enemies never damaged the player: ${die.hpBeforeAnyHit} -> ${die.hpAfterBeingHit}`,
  )
}
if (die.started === false) {
  failures.push('could not start a second wave for the death test')
}
if (die.runOnDeath?.phase !== 'death') {
  failures.push(`losing all health did not end the run: ${die.runOnDeath?.phase}`)
}
if (die.runAfter?.phase !== 'foyer') {
  failures.push(`death did not return the player to the foyer: ${die.runAfter?.phase}`)
}
if (die.playerAfter && die.playerAfter.z < 0) {
  failures.push(`death left the player outside the foyer: z=${die.playerAfter.z}`)
}
if (die.hpAfter != null && die.hpAfter < 100) {
  // Health comes back in the safe room and nowhere else — it does not regenerate during a
  // wave, so a player who returned on three health would stay on three forever.
  failures.push(`the player was not made whole on returning to the foyer: ${die.hpAfter}`)
}
if (die.saveBefore && die.saveAfter) {
  // The claim worth testing, because losing to it is invisible until it has cost somebody an
  // evening. Progression is pure RPG: dying takes the wave and not a coin.
  if (die.saveAfter.gold !== die.saveBefore.gold) {
    failures.push(`dying cost the player gold: ${die.saveBefore.gold} -> ${die.saveAfter.gold}`)
  }
  if (die.saveAfter.weapons.join() !== die.saveBefore.weapons.join()) {
    failures.push('dying cost the player a weapon')
  }
  if (die.saveAfter.wave !== die.saveBefore.wave) {
    failures.push(`dying moved the wave counter: ${die.saveBefore.wave} -> ${die.saveAfter.wave}`)
  }
}

const dun = info.dungeon
if (!dun.map) {
  failures.push('no dungeon was generated when the door opened')
} else {
  if (dun.map.rooms < 5) failures.push(`only ${dun.map.rooms} rooms generated`)
  if (dun.map.torches < 5) failures.push(`only ${dun.map.torches} torches placed`)
  if (dun.inside.z > -16) {
    failures.push(`could not walk into the dungeon: stopped at z=${dun.inside.z}`)
  }
  if (!dun.cell || !dun.cell.walkable) {
    failures.push(`the player ended up somewhere unwalkable: ${JSON.stringify(dun.cell)}`)
  }
  // The whole level is three instanced meshes. If this creeps into the hundreds, something
  // has started drawing a few thousand cells one at a time and the Quest will not hold 72.
  if (!dun.render || dun.render.drawCalls > 40) {
    failures.push(`too many draw calls in the dungeon: ${dun.render?.drawCalls}`)
  }
  // Seventy torches, four lights. The single most expensive thing to get wrong.
  if (!dun.render || dun.render.lights > 12) {
    failures.push(`too many live lights in the dungeon: ${dun.render?.lights}`)
  }
  if (dun.cleared) failures.push('the dungeon was still loaded after returning to the foyer')
}

// Sprint 2.2: the weapon and attack framework, at the training dummies.
const cbt = info.combat
if (!cbt.dummies?.length) {
  failures.push('no training dummies registered — is the damageable registry mounted?')
} else {
  if (!cbt.before || cbt.before.hands.main.weapon !== 'emberwand') {
    failures.push(`the main hand is not holding the wand: ${JSON.stringify(cbt.before?.hands)}`)
  }
  // A bolt actually landed. This is the sprint's whole premise.
  if (!(cbt.plainLost > 0)) {
    failures.push(
      `holding the trigger took no health off the dummy: ${JSON.stringify(cbt.plainBefore)} -> ${JSON.stringify(cbt.plainAfter)}`,
    )
  }
  // Mana was spent, and came back on its own. A weapon that costs nothing is not a
  // resource system, and one that never refills is a one-shot.
  if (!(cbt.afterVolley?.mana < cbt.before?.mana)) {
    failures.push(`firing spent no mana: ${cbt.before?.mana} -> ${cbt.afterVolley?.mana}`)
  }
  if (!(cbt.manaRecovered > cbt.afterVolley?.mana)) {
    failures.push(`mana did not regenerate: stuck at ${cbt.manaRecovered}`)
  }
  // The cooldown is what keeps the rate honest. 1.6s of held trigger on a 3.2/s weapon is
  // about five bolts, so the damage taken must be a small multiple of one hit — not the
  // ninety-odd a per-step fire would produce.
  if (cbt.plainLost > 12 * 12) {
    failures.push(`the wand fired far faster than its rate: ${cbt.plainLost} damage in 1.6s`)
  }
  // The element survived the trip. 60% fire resistance against the same volley.
  if (!(cbt.resistant?.lost > 0)) {
    failures.push('the fire-resistant dummy took no damage at all')
  } else if (!(cbt.resistant.lost < cbt.plainLost)) {
    failures.push(
      `resistance had no effect: plain lost ${cbt.plainLost}, resistant lost ${cbt.resistant.lost}`,
    )
  }
  // Melee, through the same speed rule as the headset. Chilled is the assertion that
  // matters: it can only have come from the Frostbrand, so it cannot be satisfied by the
  // burn the wand left behind.
  if (!cbt.melee?.chilled) {
    failures.push(`swinging the blade hit nothing: ${JSON.stringify(cbt.melee)}`)
  }
  if (!(cbt.melee?.lost > 0)) {
    failures.push(`a landed swing took no health off: ${JSON.stringify(cbt.melee)}`)
  }
  if (!(cbt.melee?.swingSpeed > 0)) {
    failures.push(`the swing tracker never measured a swing: ${cbt.melee?.swingSpeed}`)
  }

  /**
   * Sprint 2.6: the hits produce something to look at.
   *
   * A muzzle flash, a trail behind every bolt and sparks off whatever it meets are all
   * particles, so a volley that produced none means the effect pipeline is not running at
   * all — which renders exactly as well as one that is, since the bolts and the damage
   * numbers were already there.
   */
  if (!(cbt.fx?.particles > 0)) {
    failures.push(`firing produced no particles at all: ${JSON.stringify(cbt.fx)}`)
  }
  // Landing hits shakes the desktop camera. The headset never sees this — the rule lives in
  // `sampleShake` and has its own unit test — but on a monitor trauma that never rises means
  // nothing is feeding it.
  if (!(cbt.fx?.trauma > 0)) {
    failures.push(`landing hits added no camera trauma: ${JSON.stringify(cbt.fx)}`)
  }
  // And it all has to go away again.
  if (cbt.fxIdle && cbt.fxIdle.particles > 0) {
    failures.push(`particles never retired: ${cbt.fxIdle.particles} still live after 2.5s idle`)
  }
  if (cbt.fxIdle && cbt.fxIdle.trauma > 0) {
    failures.push(`camera trauma never decayed: ${cbt.fxIdle.trauma}`)
  }
}

const set = info.settings
if (!set.teleportFocus || set.teleportFocus.id !== 'set-locomotion-teleport') {
  failures.push('the settings board was never focused — is it on the wall by the door?')
} else {
  if (set.afterTeleport?.locomotion !== 'teleport') {
    failures.push(`pressing Teleport did not change locomotion: ${set.afterTeleport?.locomotion}`)
  }
  if (set.afterSteps?.comfortVignette !== 0.65 || set.afterSteps?.snapTurnDegrees !== 45) {
    failures.push(`steppers did not step cleanly: ${JSON.stringify(set.afterSteps)}`)
  }
  if (set.persisted?.locomotion !== 'teleport') {
    failures.push('settings changed on the board did not reach localStorage')
  }
  if (set.afterDefaults?.locomotion !== 'smooth' || set.afterDefaults?.comfortVignette !== 0.7) {
    failures.push(`Restore defaults left something behind: ${JSON.stringify(set.afterDefaults)}`)
  }
}

const rst = info.reset
if (!rst.armFocus || rst.armFocus.id !== 'reset-game') {
  failures.push('the reset plaque was never focused — is it registered on the back wall?')
} else {
  // The whole point of the two-step: one press must change nothing at all.
  if (rst.saveAfterArm?.gold !== rst.saveBefore?.gold) {
    failures.push(
      `arming the plaque changed the gold: ${rst.saveBefore?.gold} -> ${rst.saveAfterArm?.gold}`,
    )
  }
  if ((rst.saveAfterArm?.weapons ?? []).length !== (rst.saveBefore?.weapons ?? []).length) {
    failures.push('arming the plaque wiped weapons — it must take two presses')
  }
  if (rst.saveAfterWipe?.gold !== 100) {
    failures.push(`reset did not restore the starting gold: ${rst.saveAfterWipe?.gold}`)
  }
  if (JSON.stringify(rst.saveAfterWipe?.weapons) !== JSON.stringify(['emberwand'])) {
    failures.push(
      `reset left weapons behind: ${JSON.stringify(rst.saveAfterWipe?.weapons)}`,
    )
  }
  // Two stores, two lifetimes: wiping the run must never touch the player's comfort.
  if (JSON.stringify(rst.settingsAfterWipe) !== JSON.stringify(rst.settingsBefore)) {
    failures.push('wiping the save also changed the settings')
  }
  if (rst.saveAfterWipe?.wave !== 1 || rst.saveAfterWipe?.bestWave !== 0) {
    failures.push(
      `reset did not rewind the wave counters: ${JSON.stringify(rst.saveAfterWipe)}`,
    )
  }
}

if (consoleErrors.length) failures.push(`console errors: ${consoleErrors.join(' | ')}`)

if (failures.length) {
  console.error('\nSMOKE FAILED:\n - ' + failures.join('\n - '))
  process.exit(1)
}
console.log(`\nSMOKE PASSED — screenshot written to ${OUT}/smoke.png`)
