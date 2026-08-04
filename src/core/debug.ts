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
import { enemyModelSnapshot } from '@/systems/enemies/models'
import { fxSnapshot } from '@/systems/fx/state'
import { playerVitals } from '@/systems/vitals'

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
