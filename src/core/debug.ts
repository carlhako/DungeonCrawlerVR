import type { Scene, WebGLRenderer } from 'three'
import { gameLoop } from './loop'
import { DESKTOP_EYE_HEIGHT, playerState, type PlayerState } from '@/systems/player'
import { clampPitch, desktopInput } from '@/systems/desktopInput'
import { interactables, interactionState } from '@/systems/interaction'
import { useRun, type RunEvent, type RunPhase } from '@/systems/run'
import { useGame, type TransactionResult } from '@/systems/game'
import { useShop } from '@/systems/shop'
import { isWalkable } from '@/systems/dungeon/generate'
import { useDungeon, worldToPlacedCell } from '@/systems/dungeon/store'
import { sanitiseSettings, useSettings, type Settings } from '@/systems/settings'
import type { SaveData } from '@/systems/save'
import type { WeaponId } from '@/data/weapons'
import { combatSnapshot } from '@/systems/combat/state'
import { applyDamage, damageables, publishDamage } from '@/systems/combat/targets'
import { enemyPool, enemySnapshot } from '@/systems/enemies/state'
import { enemyModelSnapshot, getEnemyModel } from '@/systems/enemies/models'
import { wallTextureSnapshot } from '@/systems/environment/textures'
import { fxSnapshot } from '@/systems/fx/state'
import { playerVitals } from '@/systems/vitals'
import { LAB_BACKGROUND_RGB, labGridLayout } from '@/scenes/ModelLab'
import type { Material, MeshStandardMaterial } from 'three'

/**
 * Dev-only handle onto the running game, hung off `window.__DCVR__`.
 *
 * This is what the headless smoke test and the browser console inspect to answer "is the
 * simulation actually advancing?" — a question a screenshot can't answer, since a frozen
 * scene and a running one look identical in a still image.
 *
 * Tree-shaken out of production by the `import.meta.env.DEV` guard.
 */
export interface DebugHandle {
  gameLoop: typeof gameLoop
  /** Simulated seconds elapsed. Must increase while the game is running. */
  readonly simTime: number
  /** Fixed steps run in the most recent frame. */
  readonly lastStepCount: number
  /**
   * Live player position, grounding and speed.
   *
   * Exposed so the smoke test can assert the things a screenshot cannot: that the player is
   * standing on the floor rather than falling through it, and that walking into a wall
   * actually stops them. Those are the two failure modes of a character controller that
   * still renders a perfectly convincing room.
   */
  readonly player: PlayerState
  /**
   * What the player is currently addressing, flattened to plain data.
   *
   * The smoke test needs to assert that walking up to the door offers the door — which is
   * the half of the interaction system a screenshot can't show, since a prompt that appears
   * for the wrong object looks exactly as convincing as one that doesn't.
   */
  readonly focus: { id: string; label: string; source: string; distance: number } | null
  /** Waves started this session. The acceptance test for Sprint 1.1. */
  readonly wavesStarted: number
  /** The run machine's current phase and wave. */
  readonly run: { phase: RunPhase; wave: number; lastReward: number }
  /**
   * The live save.
   *
   * What the smoke test asserts survives a reload — which is the whole of Sprint 1.2's
   * acceptance test and is invisible in a screenshot, since a game that has quietly lost
   * every weapon the player bought renders exactly as well as one that hasn't.
   */
  readonly save: SaveData
  /** What the shop panel is showing, and what it last said. */
  readonly shop: { selected: string; feedback: string | null; ok: boolean | null }
  /**
   * What the renderer is actually being asked to do this frame.
   *
   * Draw calls and live lights are the two numbers that decide whether a Quest 3 holds
   * 72fps, and both are easy to lose by accident — an instanced mesh that quietly became a
   * thousand objects, a level that mounted a light per torch. Null before the first frame.
   */
  readonly render: {
    drawCalls: number
    triangles: number
    lights: number
    litIntensity: number
  } | null
  /**
   * The dungeon the player is currently in, if any.
   *
   * `playerCell` is the question the smoke test actually needs answered: not "did a level
   * generate" but "is the player standing on a cell the generator calls floor?" A body a
   * metre inside a wall renders perfectly.
   */
  readonly dungeon: {
    seed: number
    rooms: number
    torches: number
    spawns: number
    playerCell: { x: number; y: number; walkable: boolean }
  } | null
  /**
   * The live settings.
   *
   * Separate from `save` in exactly the way the two stores are: wiping progression must
   * never touch someone's comfort options, and that is a claim worth being able to test.
   */
  readonly settings: Settings
  /** Drive a transition by hand, from the console or the smoke test. */
  send(event: RunEvent): boolean
  /**
   * Buy a weapon without a shop.
   *
   * Scaffolding until Sprint 1.3 puts a real panel on the counter — but the thing it makes
   * testable is not scaffolding at all: whether a purchase actually survives a reload.
   */
  buyWeapon(id: WeaponId): TransactionResult
  /** Wipe progression back to a first launch. Settings are untouched. */
  resetSave(): void
  /**
   * Every registered interactable, flattened.
   *
   * The smoke test uses this to find out where the shop's buttons actually ended up, rather
   * than hard-coding coordinates that a layout change would silently invalidate.
   */
  readonly targets: Array<{ id: string; x: number; y: number; z: number; enabled: boolean }>
  /**
   * Point the desktop camera at a world position.
   *
   * Headless Chromium has no pointer lock, so mouselook is unavailable and the player can
   * only ever face -Z. Without this the entire shop — which necessarily faces the room from
   * the far side of the counter — would be untestable outside a headset.
   */
  lookAt(x: number, y: number, z: number): void
  /**
   * Mana, cooldowns and what is in the air.
   *
   * The three things Sprint 2.2's acceptance test asks about that a screenshot cannot
   * answer. A bolt is a 12cm sphere crossing the room in a fifth of a second; "did it fire"
   * is not a question worth putting to a frame grab.
   */
  readonly combat: ReturnType<typeof combatSnapshot>
  /**
   * Every registered damageable and its health.
   *
   * The smoke test reads this to assert that a shot actually took health off a specific
   * dummy — and, with the resistant one, that the *element* survived the trip from the
   * weapon table to the target.
   */
  readonly damageables: Array<{
    id: string
    hp: number
    maxHp: number
    statuses: string[]
    /** Where to stand and what to aim at, so the smoke test never hard-codes a layout. */
    x: number
    y: number
    z: number
  }>
  /**
   * The wave and everything in it: what the Wave Director is doing, the player's health, and
   * every live enemy with its phase and position.
   *
   * Sprint 2.3's acceptance test is the whole loop, and almost none of it is visible in a
   * screenshot: a wave that has stopped spawning, an enemy stuck against a wall, a telegraph
   * that never resolves and a player quietly on 3 health all render perfectly well. `phase`
   * is the one that earns its keep — it is the AI's own account of itself, and the difference
   * between "it is walking at me" and "it has decided I am unreachable".
   */
  readonly enemies: ReturnType<typeof enemySnapshot>
  /**
   * Live particles, camera trauma and hitstop.
   *
   * Sprint 2.6's whole output is things that exist for a fraction of a second, and a
   * screenshot of a burst that never happened looks exactly like one taken between two
   * bursts. These are the three numbers that say the effects actually fired — and `trauma`
   * doubles as the assertion that matters most: it must be able to rise on a monitor and
   * must never move the camera in a headset.
   */
  readonly fx: ReturnType<typeof fxSnapshot>
  /**
   * What the enemy models did, per file: loaded, missing, and with which clips in them.
   *
   * Sprint 2.7's art lands as files Carl drops into `public/models/`, and every failure mode
   * here is *silent by design* — a missing GLB falls back to the primitive body, which is
   * exactly what the game looked like yesterday. So "the pack is in the wrong folder", "the
   * file is named differently" and "it loaded fine, the kit just calls its walk something
   * else" are three completely different problems that all look identical on screen. This is
   * where they are told apart, and it is the first thing to read when a model does not appear.
   */
  readonly models: ReturnType<typeof enemyModelSnapshot>
  /**
   * What the wall texture did: loaded, or missing and why.
   *
   * Same failure mode as `models` and the same fix — drop the three files into
   * `public/textures/`, see `public/textures/README.md`.
   */
  readonly textures: ReturnType<typeof wallTextureSnapshot>
  /**
   * The model lab's own readout — see `scenes/ModelLab.tsx`.
   *
   * `ready` is settled once every enemy with a model spec has either loaded or given up, the
   * same instant the lab's specimens stop being capsule-shaped placeholders. `materials` is the
   * *raw* GLB data, read straight off the loaded templates before anything in this game's
   * pipeline touches it — the ground truth the fix is judged against. `luminance` is a method,
   * not a property: it reads back the actual framebuffer and is only worth paying for on
   * demand, from the capture script, once a frame has actually drawn the lab's grid.
   */
  readonly lab: {
    readonly ready: boolean
    readonly materials: Record<
      string,
      Array<{
        name: string
        color: string
        map: boolean
        metalness: number
        roughness: number
        emissive: string
        emissiveIntensity: number
      }>
    >
    /** Keyed `"<enemyId>:<variant>"`, matching `labGridLayout()`'s cols × rows. */
    luminance(): Record<
      string,
      { mean: number; brightFraction: number; coverage: number }
    > | null
    /**
     * Every specimen's pixel rectangle, in device pixels relative to the canvas. What the
     * capture script uses to crop one screenshot into one PNG per cell, instead of re-deriving
     * the grid geometry itself.
     */
    cellRects(): Array<{ id: string; variant: string; x: number; y: number; w: number; h: number }> | null
  }
  /**
   * Kill everything currently standing, through the real damage path.
   *
   * Scaffolding for the smoke test, and narrowly scoped on purpose: it does not clear the
   * wave, count a kill or pay anything out. It deals lethal damage through `applyDamage` and
   * leaves the driver to notice, so what the test then asserts — the kill count, the gold, the
   * clear, the return to the foyer — is the same code path a wand firing at a goblin takes.
   * Killing a wave of skeletons twelve damage at a time under SwiftShader takes minutes.
   */
  slay(): number
  /**
   * Set the player's health directly.
   *
   * Also for the smoke test, and for the same reason: the death path has to be exercised by a
   * real enemy landing a real blow, and getting there honestly from 100 health is several
   * minutes of headless frames. This sets up the last hit; the last hit itself is real.
   */
  setHealth(hp: number): void
}

/**
 * The renderer and scene, handed over from inside the Canvas.
 *
 * `installDebugHandle` runs before React mounts, and these only exist inside an R3F tree —
 * so `DebugView` (rendered in App) puts them here rather than the handle reaching in.
 */
const view: { scene: Scene | null; gl: WebGLRenderer | null } = { scene: null, gl: null }

export function setDebugView(scene: Scene | null, gl: WebGLRenderer | null): void {
  if (!import.meta.env.DEV) return
  view.scene = scene
  view.gl = gl
}

/**
 * Every cell's pixel rectangle in the current framebuffer, in device pixels relative to the
 * canvas. Shared by the luminance readout and the capture script, which crops individual
 * specimens out of one screenshot rather than re-deriving this geometry itself.
 */
function labCellRects(): Array<{ id: string; variant: string; x: number; y: number; w: number; h: number }> | null {
  if (!view.gl) return null
  const canvas = view.gl.domElement
  const width = canvas.width
  const height = canvas.height
  if (!width || !height) return null

  const layout = labGridLayout()
  const { left, right, top, bottom } = layout.frustum
  const rects: Array<{ id: string; variant: string; x: number; y: number; w: number; h: number }> = []

  layout.rows.forEach((variant, r) => {
    layout.cols.forEach((id, c) => {
      // World-space cell bounds, matching how `ModelLab` places each specimen's column and
      // row band — see `labGridLayout`'s doc comment for why this maps linearly onto pixels.
      const wx0 = c * layout.cellW
      const wx1 = wx0 + layout.cellW
      const wy1 = -(r * layout.cellH)
      const wy0 = wy1 - layout.cellH

      const px0 = Math.max(0, Math.round(((wx0 - left) / (right - left)) * width))
      const px1 = Math.min(width, Math.round(((wx1 - left) / (right - left)) * width))
      const py0 = Math.max(0, Math.round(((top - wy1) / (top - bottom)) * height))
      const py1 = Math.min(height, Math.round(((top - wy0) / (top - bottom)) * height))
      rects.push({ id, variant, x: px0, y: py0, w: Math.max(1, px1 - px0), h: Math.max(1, py1 - py0) })
    })
  })
  return rects
}

/** How far a pixel must sit from the lab's flat background colour, per channel (0..255), to
 *  count as part of the specimen rather than empty cell. */
const LAB_FOREGROUND_THRESHOLD = 14

/**
 * Reads the framebuffer back and measures mean luminance and the fraction of near-white
 * pixels, per cell of the model lab's grid — over the specimen's own pixels only.
 *
 * A mean taken over the whole cell is mostly the lab's flat background (most of a cell is
 * empty air around a body), which dilutes exactly the signal this exists to catch: a body that
 * is itself washed out reads only slightly brighter than average once diluted by the space
 * around it. Foreground is "far enough from the known background colour" — see
 * `LAB_BACKGROUND_RGB` — which is cheap and reliable here because the lab's background is a
 * single flat, unlit colour with no gradient or fog to be confused with a pale body.
 *
 * The whole point of the lab: "mostly white" becomes a number that can be regressed on, rather
 * than something only a human judges from a PNG. Requires `preserveDrawingBuffer` — see
 * `App.tsx`, where it is turned on only for `?scene=models` — because without it the drawing
 * buffer is only readable from inside the `requestAnimationFrame` callback that produced it,
 * and this is called from outside that callback, on demand, by the capture script.
 */
function computeLabLuminance(): Record<
  string,
  { mean: number; brightFraction: number; coverage: number }
> | null {
  const rects = labCellRects()
  if (!rects || !view.gl) return null
  const canvas = view.gl.domElement

  const scratch = document.createElement('canvas')
  scratch.width = canvas.width
  scratch.height = canvas.height
  const ctx = scratch.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(canvas, 0, 0)

  const [bgR, bgG, bgB] = LAB_BACKGROUND_RGB
  const out: Record<string, { mean: number; brightFraction: number; coverage: number }> = {}
  for (const rect of rects) {
    const data = ctx.getImageData(rect.x, rect.y, rect.w, rect.h).data
    let sum = 0
    let bright = 0
    let foreground = 0
    const total = rect.w * rect.h
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!
      const g = data[i + 1]!
      const b = data[i + 2]!
      const isBackground =
        Math.abs(r - bgR) < LAB_FOREGROUND_THRESHOLD &&
        Math.abs(g - bgG) < LAB_FOREGROUND_THRESHOLD &&
        Math.abs(b - bgB) < LAB_FOREGROUND_THRESHOLD
      if (isBackground) continue
      foreground++
      // Rec. 709 luma. Good enough for "is this near-white" — this is a diagnostic, not a
      // colour-managed pipeline.
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
      sum += lum
      if (lum > 0.9) bright++
    }
    out[`${rect.id}:${rect.variant}`] = {
      mean: foreground > 0 ? +(sum / foreground).toFixed(3) : 0,
      brightFraction: foreground > 0 ? +(bright / foreground).toFixed(3) : 0,
      coverage: +(foreground / total).toFixed(3),
    }
  }
  return out
}

export function installDebugHandle(): void {
  if (!import.meta.env.DEV) return
  const handle: DebugHandle = {
    gameLoop,
    get simTime() {
      return gameLoop.time
    },
    get lastStepCount() {
      return gameLoop.lastStepCount
    },
    get player() {
      return playerState
    },
    get focus() {
      const focus = interactionState.focus
      if (!focus) return null
      return {
        id: focus.id,
        label: focus.label,
        source: interactionState.source,
        distance: +interactionState.distance.toFixed(3),
      }
    },
    get wavesStarted() {
      return useRun.getState().wavesStarted
    },
    get run() {
      const { phase, wave, lastReward } = useRun.getState()
      return { phase, wave, lastReward }
    },
    get save() {
      return useGame.getState().save
    },
    get shop() {
      const { selected, feedback } = useShop.getState()
      return { selected, feedback: feedback?.text ?? null, ok: feedback?.ok ?? null }
    },
    get render() {
      if (!view.scene || !view.gl) return null
      let lights = 0
      let litIntensity = 0
      view.scene.traverse((object) => {
        const light = object as { isLight?: boolean; intensity?: number }
        if (!light.isLight) return
        lights++
        litIntensity += light.intensity ?? 0
      })
      return {
        drawCalls: view.gl.info.render.calls,
        triangles: view.gl.info.render.triangles,
        lights,
        litIntensity: +litIntensity.toFixed(2),
      }
    },
    get dungeon() {
      const { map, nav, offset } = useDungeon.getState()
      if (!map || !nav || !offset) return null
      const cell = worldToPlacedCell(
        { map, nav, offset },
        playerState.position.x,
        playerState.position.z,
      )
      return {
        seed: map.seed,
        rooms: map.rooms.length,
        torches: map.torches.length,
        spawns: map.spawns.length,
        playerCell: { ...cell, walkable: isWalkable(map, cell.x, cell.y) },
      }
    },
    get settings() {
      // Through `sanitiseSettings` because the store also holds its own actions, and this
      // handle is a view of the data.
      return sanitiseSettings(useSettings.getState())
    },
    send: (event) => useRun.getState().send(event),
    buyWeapon: (id) => useGame.getState().buyWeapon(id),
    resetSave: () => useGame.getState().resetSave(),
    get targets() {
      return interactables.map((item) => ({
        id: item.id,
        x: +item.position.x.toFixed(3),
        y: +item.position.y.toFixed(3),
        z: +item.position.z.toFixed(3),
        enabled: item.enabled,
      }))
    },
    lookAt: (x, y, z) => {
      const dx = x - playerState.position.x
      const dy = y - (playerState.position.y + DESKTOP_EYE_HEIGHT)
      const dz = z - playerState.position.z
      // Yaw 0 looks down -Z, so the heading that points at (dx, dz) is atan2(-dx, -dz).
      desktopInput.yaw = Math.atan2(-dx, -dz)
      desktopInput.pitch = clampPitch(Math.atan2(dy, Math.hypot(dx, dz)))
    },
    get combat() {
      return combatSnapshot()
    },
    get enemies() {
      return enemySnapshot()
    },
    get fx() {
      return fxSnapshot()
    },
    get models() {
      return enemyModelSnapshot()
    },
    get textures() {
      return wallTextureSnapshot()
    },
    get lab() {
      const statuses = enemyModelSnapshot()
      const ready = Object.values(statuses).every(
        (entry) => entry.status === 'ready' || entry.status === 'missing',
      )

      const layout = labGridLayout()
      const materials: DebugHandle['lab']['materials'] = {}
      for (const id of layout.cols) {
        const list: DebugHandle['lab']['materials'][string] = []
        const model = getEnemyModel(id)
        model?.template.traverse((object) => {
          const mesh = object as unknown as { isMesh?: boolean; material?: Material | Material[] }
          if (!mesh.isMesh || !mesh.material) return
          for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
            const std = material as MeshStandardMaterial
            list.push({
              name: material.name || '(unnamed)',
              color: std.color ? `#${std.color.getHexString()}` : '',
              map: Boolean(std.map),
              metalness: std.metalness ?? 0,
              roughness: std.roughness ?? 0,
              emissive: std.emissive ? `#${std.emissive.getHexString()}` : '',
              emissiveIntensity: std.emissiveIntensity ?? 0,
            })
          }
        })
        materials[id] = list
      }

      return { ready, materials, luminance: computeLabLuminance, cellRects: labCellRects }
    },
    slay: () => {
      let killed = 0
      for (const enemy of enemyPool.items) {
        if (!enemy.active || !enemy.target.enabled || enemy.target.hp <= 0) continue
        const event = applyDamage(
          enemy.target,
          {
            amount: enemy.target.hp,
            element: 'physical',
            crit: false,
            status: null,
            source: { kind: 'melee', weaponId: null, hand: null },
          },
          enemy.position,
        )
        publishDamage(event)
        killed += 1
      }
      return killed
    },
    setHealth: (hp) => {
      playerVitals.hp = Math.max(0, Math.min(playerVitals.max, hp))
      playerVitals.invulnerable = 0
    },
    get damageables() {
      return damageables().map((target) => ({
        id: target.id,
        hp: Math.round(target.hp),
        maxHp: target.maxHp,
        statuses: target.statuses.map((status) => status.kind),
        x: +target.position.x.toFixed(3),
        y: +target.position.y.toFixed(3),
        z: +target.position.z.toFixed(3),
      }))
    },
  }
  ;(window as unknown as { __DCVR__: DebugHandle }).__DCVR__ = handle
}
