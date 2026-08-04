import { useEffect, useMemo, useRef } from 'react'
import { useXRInputSourceState, type XRControllerState } from '@react-three/xr'
import { SystemOrder } from '@/core/loop'
import { useFixedUpdate } from '@/core/simulation'
import { ENEMIES } from '@/data/enemies'
import { Haptic, pulsePreset, type HapticPreset } from '@/systems/haptics'
import { playerState } from '@/systems/player'
import { resolveDamage } from '@/systems/combat/damage'
import { registerDamageable } from '@/systems/combat/targets'
import { CELL_SIZE } from '@/systems/dungeon/generate'
import { findPath, hasLineOfSight, isOpen, nearestOpen } from '@/systems/dungeon/nav'
import { useDungeon, type DungeonPlacement } from '@/systems/dungeon/store'
import { staggerEnemy, stepEnemyAi, type AiContext } from '@/systems/enemies/ai'
import {
  clearEnemyPool,
  despawnEnemy,
  livingEnemies,
  spawnEnemy,
  type Enemy,
} from '@/systems/enemies/pool'
import { director, enemyPool } from '@/systems/enemies/state'
import { resolveMove, type Neighbour } from '@/systems/enemies/steering'
import { useRun } from '@/systems/run'
import { detectionScale, noiseEvent } from '@/systems/stealth'
import { hurtPlayer, isAlive, playerVitals, resetVitals, stepVitals } from '@/systems/vitals'
import { beginWave, endWave, markCleared, recordKill, returnToQueue, stepDirector } from '@/systems/waves'

/**
 * Enemies, once per fixed step: who arrives, where they walk, and what they hit.
 *
 * The counterpart of `CombatDriver` and deliberately the same shape. Everything here is
 * wiring and ordering — spawn, decide, move, strike, bury, then ask whether the wave is over —
 * and none of the rules are in it. What an enemy decides lives in `enemies/ai.ts`, how it
 * steers in `enemies/steering.ts`, what a wave contains in `waves.ts` and `data/waves.ts`, and
 * what a blow costs the player in `vitals.ts`. All pure, all unit-tested, none of it needing a
 * dungeon or a headset to check.
 *
 * It runs at `SystemOrder.AI`, which is after the player has moved and before physics and
 * combat. That ordering matters in one specific way: an enemy decides where to strike using
 * the position the player finished this step at, so backing out of a wind-up works on the step
 * the player actually backed out on rather than the one after.
 */

/**
 * How far from the player something may materialise, in metres.
 *
 * Not a pacing number — a fairness one. Anything closer than this is a thing that appeared
 * inside the player's personal space, which in VR is not a scare, it is a startle with no
 * information in it, and the spawn beat cannot cover for it.
 */
const MIN_SPAWN_DISTANCE = 9

/**
 * And how far away it may be, in metres.
 *
 * This one is entirely about pacing, and it was learned the hard way. `map.spawns` is sorted
 * furthest-from-the-entry first, so taking the front of that list put wave one's skeletons at
 * the far corner of a forty-cell level — a hundred and ten metres of corridor at 1.5 m/s,
 * which is a minute and a half of the player standing in an empty dungeon waiting for a fight
 * to arrive. The pathfinding was right the whole time; the geography was absurd.
 *
 * So enemies come from *near* the player, out of the dark, and the far end of the level is
 * scenery rather than a staging area.
 */
const MAX_SPAWN_DISTANCE = 26

/** How long a hit's flash lasts on an enemy. Punctuation, like the dummies'. */
const FLASH_SECONDS = 0.18

export function EnemyDriver() {
  const left = useXRInputSourceState('controller', 'left')
  const right = useXRInputSourceState('controller', 'right')

  const controllers = useRef<Controllers>({ left: left ?? undefined, right: right ?? undefined })
  controllers.current = { left: left ?? undefined, right: right ?? undefined }

  /**
   * Registered once, for the whole pool, for the lifetime of the driver.
   *
   * Not per spawn. A registration that came and went with each enemy would be a Map insert and
   * delete every couple of seconds during a wave, and — worse — a projectile mid-flight holds
   * only an id, so an entry that disappeared underneath it would silently drop the hit.
   */
  useEffect(() => {
    const unregister = enemyPool.items.map((enemy) => {
      enemy.target.onDamage = (event) => {
        // Being hurt is aggro on its own, wall or no wall. Otherwise a wand outranges every
        // enemy in the game and sniping from the dark is the whole of the tactics.
        enemy.alerted = true
        enemy.flash = FLASH_SECONDS
        if (event.killed || !enemy.type) return
        // A hard enough hit interrupts a wind-up. This is the payoff for a heavy weapon, and
        // what turns the telegraph from a countdown into an opening.
        if (staggerEnemy(enemy, ENEMIES[enemy.type], event.amount)) {
          buzz(controllers.current, Haptic.heavy)
        }
      }
      return registerDamageable(enemy.target)
    })

    return () => {
      for (const remove of unregister) remove()
      for (const enemy of enemyPool.items) enemy.target.onDamage = undefined
    }
  }, [])

  /**
   * Reused every step. `neighbours` is one shared list of everything alive, and each enemy is
   * told its own index rather than being handed a filtered copy — ten objects a step, sixty
   * times a second, is exactly the garbage the pools exist to avoid.
   */
  const scratch = useMemo(
    () => ({
      neighbours: [] as Neighbour[],
      ctx: {
        player: { x: 0, y: 0, z: 0 },
        visible: false,
        neighbours: [] as Neighbour[],
        selfIndex: -1,
        playerAlive: true,
        detectionScale: 1,
      } as AiContext,
    }),
    [],
  )

  /**
   * The phase this driver last saw, tracked *inside* the fixed step rather than in an effect.
   *
   * This was a `useEffect` on the run phase, and it was wrong in a way that took the whole
   * first wave with it. The phase changes from inside the fixed loop; an effect watching it
   * does not run until React has re-rendered, which is at least one frame — and possibly
   * several fixed steps — later. So the first steps of every wave ran against a director that
   * had not been started, which looks identical to one that has finished, and the wave cleared
   * itself before a single enemy was composed. Reacting to the transition on the same step it
   * happens is the only ordering that is actually true.
   */
  const seen = useRef<string>('foyer')

  useFixedUpdate(
    (dt) => {
      const run = useRun.getState()

      if (run.phase !== seen.current) {
        const was = seen.current
        seen.current = run.phase

        if (run.phase === 'wave') {
          // Composition comes from the wave number, so this is the same fight every time — the
          // same property the dungeon's seed gives the level it happens in.
          beginWave(director, run.wave)
          resetVitals(playerVitals)
          clearEnemyPool(enemyPool)
        } else if (was === 'wave') {
          // Nothing survives the end of a wave. An enemy still walking when the dungeon
          // unmounts would be walking around the foyer.
          endWave(director)
          clearEnemyPool(enemyPool)
        }

        // Whole again in the safe room. Health does not regenerate during a wave — see
        // `vitals.ts` — so this is the only place it comes back.
        if (run.phase === 'foyer') resetVitals(playerVitals)
      }

      if (run.phase !== 'wave') return

      stepVitals(playerVitals, dt)

      const { map, nav, offset } = useDungeon.getState()
      const placement = map && nav && offset ? ({ map, nav, offset } as DungeonPlacement) : null

      const alive = isAlive(playerVitals)
      scratch.ctx.playerAlive = alive
      scratch.ctx.player.x = playerState.position.x
      // Chest height, which is where a claw is aimed and where the distance is measured from.
      scratch.ctx.player.y = playerState.position.y + PLAYER_CHEST
      scratch.ctx.player.z = playerState.position.z
      scratch.ctx.detectionScale = detectionScale(playerState.speed)

      spawn(placement, dt)
      collectNeighbours(scratch.neighbours)
      scratch.ctx.neighbours = scratch.neighbours

      // Noise pulse: a weapon fired this step alerts every idle enemy within range, no line
      // of sight required. Shooting breaks stealth even from behind cover.
      if (noiseEvent.remaining > 0) {
        for (const enemy of enemyPool.items) {
          if (!enemy.active || enemy.phase !== 'idle' || enemy.alerted) continue
          const dx = noiseEvent.position.x - enemy.position.x
          const dz = noiseEvent.position.z - enemy.position.z
          if (Math.hypot(dx, dz) <= noiseEvent.radius) {
            enemy.alerted = true
          }
        }
        noiseEvent.remaining -= dt
      }

      let index = 0
      for (const enemy of enemyPool.items) {
        if (!enemy.active) continue
        const self = enemy.phase === 'dying' ? -1 : index
        if (enemy.phase !== 'dying') index += 1
        stepOne(enemy, scratch.ctx, placement, self, dt, controllers.current)
      }

      // Asked after everything has moved and died, so a wave never clears a step early on the
      // strength of a corpse whose payout has not landed yet.
      markCleared(director, livingEnemies(enemyPool))

      if (!alive) {
        // Death costs the wave and nothing else — see `run.ts`. The save is untouched.
        run.send('died')
        return
      }

      if (director.cleared) run.send('cleared', { earned: director.gold })
    },
    SystemOrder.AI,
    [scratch],
  )

  return null
}

/** Where the player's hit centre sits above their feet. Matches the training dummies'. */
const PLAYER_CHEST = 1.05

/**
 * Buzz both hands.
 *
 * Both, and not the nearer one: an enemy hits the *player*, and picking a hand would be an
 * invented detail the game does not model. This is also the whole of what being hit does to
 * the view in VR — no shake, no knockback, nothing that moves the camera. See the red at the
 * edge of vision in `ComfortVignette`.
 */
interface Controllers {
  left: XRControllerState | undefined
  right: XRControllerState | undefined
}

function buzz(controllers: Controllers, preset: HapticPreset): void {
  pulsePreset(controllers.left, preset)
  pulsePreset(controllers.right, preset)
}

/**
 * Is a body of this size allowed to stand here?
 *
 * Written out rather than going through `worldToPlacedCell`, which allocates a cell object.
 * This is called five times per enemy per step and would otherwise be a few thousand
 * short-lived objects a second handed to a mobile GC.
 *
 * Outside a dungeon — the greybox, or the foyer before a level exists — everything is open.
 * The enemies are only ever spawned inside one, so this is a fallback rather than a rule.
 */
function openAt(placement: DungeonPlacement | null, x: number, z: number): boolean {
  if (!placement) return true
  // Hard boundary at the dungeon mouth: nothing hostile may step into the vestibule or
  // foyer. The nav grid already catches this (cells past the edge are solid), but the
  // check here is explicit and intentional — the foyer is the safe room.
  if (z > mouthBoundary(placement)) return false
  const cx = Math.floor((x - placement.offset.x) / CELL_SIZE + placement.map.width / 2)
  const cy = Math.floor((z - placement.offset.z) / CELL_SIZE + placement.map.height / 2)
  return isOpen(placement.nav, cx, cy)
}

/** The world Z past which a body has left the dungeon and entered the foyer passage. */
function mouthBoundary(placement: DungeonPlacement): number {
  // The mouth is the one floor cell on the south edge. Its outer edge in world space is
  // where the dungeon ends and the vestibule begins.
  const mouth = placement.map.mouth
  const local = (mouth.y - placement.map.height / 2 + 0.5) * CELL_SIZE
  return local + placement.offset.z + CELL_SIZE / 2
}

function cellAt(placement: DungeonPlacement, x: number, z: number) {
  return {
    x: Math.floor((x - placement.offset.x) / CELL_SIZE + placement.map.width / 2),
    y: Math.floor((z - placement.offset.z) / CELL_SIZE + placement.map.height / 2),
  }
}

function worldOfCell(placement: DungeonPlacement, cx: number, cy: number) {
  return {
    x: (cx - placement.map.width / 2 + 0.5) * CELL_SIZE + placement.offset.x,
    z: (cy - placement.map.height / 2 + 0.5) * CELL_SIZE + placement.offset.z,
  }
}

/** Ask the director for an arrival, and find somewhere fair to put it. */
function spawn(placement: DungeonPlacement | null, dt: number): void {
  const wanted = stepDirector(director, dt, livingEnemies(enemyPool))
  if (!wanted) return

  if (!placement) {
    returnToQueue(director, wanted)
    return
  }

  const at = pickSpawnPoint(placement)
  if (!at) {
    // Nowhere fair to put it *yet* — the player is standing on top of every candidate. Handing
    // it back rather than dropping it is what stops the wave waiting forever for an enemy that
    // was never created.
    returnToQueue(director, wanted)
    return
  }

  if (!spawnEnemy(enemyPool, wanted, at)) returnToQueue(director, wanted)
}

/**
 * Which of the shortlist to take next. Rotated so a wave arrives from more than one
 * direction — always taking the nearest turns every fight into a firing line down one
 * corridor.
 */
let spawnCursor = 0

/** Reused, so choosing a spawn point does not allocate an array every couple of seconds. */
const shortlist: Array<{ x: number; z: number; distance: number }> = []

/**
 * Somewhere fair to put the next arrival.
 *
 * Three rules, in order of how much they matter:
 *
 * 1. **Not too close.** See `MIN_SPAWN_DISTANCE`.
 * 2. **Not in sight.** Something that fades into existence while the player is looking
 *    straight at it is not frightening, it is a spawner. Out of sight and then round a
 *    corner is the whole difference.
 * 3. **Not too far.** See `MAX_SPAWN_DISTANCE`.
 *
 * The sight rule is relaxed before the distance rules if nothing qualifies — an enemy that
 * arrives visibly is much better than a wave that never arrives at all, which is the failure
 * mode this whole function is guarding.
 */
function pickSpawnPoint(placement: DungeonPlacement): { x: number; z: number } | null {
  const spawns = placement.map.spawns
  if (spawns.length === 0) return null

  const player = cellAt(placement, playerState.position.x, playerState.position.z)

  for (const unseen of [true, false]) {
    shortlist.length = 0

    for (const cell of spawns) {
      const world = worldOfCell(placement, cell.x, cell.y)
      const distance = Math.hypot(
        world.x - playerState.position.x,
        world.z - playerState.position.z,
      )
      if (distance < MIN_SPAWN_DISTANCE || distance > MAX_SPAWN_DISTANCE) continue
      if (unseen && hasLineOfSight(placement.nav, cell, player)) continue
      shortlist.push({ ...world, distance })
    }

    if (shortlist.length === 0) continue

    shortlist.sort((a, b) => a.distance - b.distance)
    const picked = shortlist[spawnCursor % shortlist.length] as { x: number; z: number }
    spawnCursor = (spawnCursor + 1) % Math.max(1, shortlist.length)
    return { x: picked.x, z: picked.z }
  }

  return null
}

/** Everything that is standing, as separation input. Corpses do not push. */
function collectNeighbours(into: Neighbour[]): void {
  into.length = 0
  for (const enemy of enemyPool.items) {
    if (!enemy.active || enemy.phase === 'dying' || !enemy.type) continue
    into.push({
      x: enemy.position.x,
      z: enemy.position.z,
      radius: ENEMIES[enemy.type].radius,
    })
  }
}

function stepOne(
  enemy: Enemy,
  ctx: AiContext,
  placement: DungeonPlacement | null,
  selfIndex: number,
  dt: number,
  controllers: Controllers,
): void {
  if (!enemy.type) return

  const definition = ENEMIES[enemy.type]
  ctx.selfIndex = selfIndex
  ctx.visible = canSee(enemy, placement, definition.phasing)

  const intent = stepEnemyAi(enemy, ctx, dt)

  if (intent.expired) {
    despawnEnemy(enemy)
    return
  }

  // Counted here rather than in `killEnemy`, so a death from any cause — a bolt, a sword, a
  // burn ticking — pays out through exactly one path.
  if (enemy.phase === 'dying' && !enemy.counted) {
    enemy.counted = true
    recordKill(director, enemy.type)
  }

  if (intent.repath && placement) repath(enemy, placement)

  if (intent.dx !== 0 || intent.dz !== 0) {
    if (definition.phasing) {
      // The Wraith's whole identity: the walls do not apply to it. It is slow and weak in
      // exchange, and it arrives from a direction the nav grid says is impossible.
      // But even the Wraith cannot enter the foyer — the doorway seals it out.
      enemy.position.x += intent.dx
      enemy.position.z += intent.dz
      if (placement) enemy.position.z = Math.min(enemy.position.z, mouthBoundary(placement))
    } else {
      const moved = resolveMove(enemy.position, intent.dx, intent.dz, definition.radius, (x, z) =>
        openAt(placement, x, z),
      )
      enemy.position.x = moved.x
      enemy.position.z = moved.z
      // Double-clamp: `resolveMove` and `openAt` together should prevent crossing the
      // mouth boundary, but an enemy that somehow arrives past it is pulled back.
      if (placement) enemy.position.z = Math.min(enemy.position.z, mouthBoundary(placement))
    }
  }

  if (!intent.strike) return

  // The one place an enemy takes health off the player. Through `resolveDamage` like every
  // other attack in the game, so an enemy's element and the rounding rule are the same ones
  // the player's weapons obey — and then into `vitals.ts` rather than `applyDamage`, because
  // the player is deliberately not in the damageable registry.
  const resolved = resolveDamage(
    {
      base: definition.damage,
      element: definition.element,
      // Enemies do not crit. A hit the player could not have seen coming that also happens to
      // do double is the least readable thing in a fight.
      critChance: 0,
      source: { kind: 'enemy', weaponId: null, hand: null },
    },
    {},
  )

  const result = hurtPlayer(playerVitals, resolved)
  // Nothing in VR may move the camera, so being hit is haptics plus the red at the edge of
  // vision — never a shake, never a knockback. See `ComfortVignette`.
  if (result.applied) buzz(controllers, result.killed ? Haptic.heavy : Haptic.impact)
}

/** Can this enemy see the player right now? */
function canSee(enemy: Enemy, placement: DungeonPlacement | null, phasing: boolean): boolean {
  // Something that ignores walls is not stopped by them for the purpose of noticing you
  // either. Range still applies; it is not omniscient.
  if (phasing) return true
  if (!placement) return true
  const from = cellAt(placement, enemy.position.x, enemy.position.z)
  const to = cellAt(placement, playerState.position.x, playerState.position.z)
  return hasLineOfSight(placement.nav, from, to)
}

/**
 * Bake a fresh route to the player.
 *
 * `nearestOpen` on both ends because a body resting a few centimetres inside a wall is a body
 * whose cell is solid, and because the player spends part of every wave standing in the foyer
 * or the passage — which is not on the grid at all. Falling back to the mouth means a retreating
 * player is chased right up to the doorway rather than abandoned mid-corridor — but the foyer
 * also blocks line of sight, so `stepEnemyAi`'s give-up clock is already running by the time
 * anything arrives there. What used to be a permanent camp at the door is now a few seconds of
 * pursuit followed by the pack standing down, not a wall of enemies waiting the player out.
 */
function repath(enemy: Enemy, placement: DungeonPlacement): void {
  enemy.sincePath = 0

  const from = nearestOpen(placement.nav, cellAt(placement, enemy.position.x, enemy.position.z))
  const wanted = cellAt(placement, playerState.position.x, playerState.position.z)
  const to = nearestOpen(placement.nav, wanted) ?? placement.map.mouth

  enemy.path.length = 0
  enemy.pathIndex = 0
  if (!from) return

  const cells = findPath(placement.nav, from, to)
  // Skip the cell it is standing in: walking back to the centre of your own tile before
  // setting off is a visible stutter at the start of every repath.
  for (let i = 1; i < cells.length; i++) {
    const cell = cells[i]
    if (!cell) continue
    enemy.path.push(worldOfCell(placement, cell.x, cell.y))
  }
}

