import { useEffect, useMemo, useRef } from 'react'
import { useRapier } from '@react-three/rapier'
import { useXRInputSourceState } from '@react-three/xr'
import { QueryFilterFlags, Ray } from '@dimforge/rapier3d-compat'
import { SystemOrder } from '@/core/loop'
import { useFixedUpdate } from '@/core/simulation'
import type { Hand } from '@/data/weapons'
import { requestSwing } from '@/entities/WeaponRig'
import { Haptic, pulsePreset, type HapticPreset } from '@/systems/haptics'
import { interactionState } from '@/systems/interaction'
import { desktopInput } from '@/systems/desktopInput'
import { useGame } from '@/systems/game'
import { playerCollider, playerState } from '@/systems/player'
import { handednessOf, useSettings } from '@/systems/settings'
import { emitNoise, WEAPON_NOISE_RADIUS } from '@/systems/stealth'
import { xrInput } from '@/systems/xrInput'
import { resolveDamage, type DamageSpec } from '@/systems/combat/damage'
import { toPlayerFrame, trackSwing } from '@/systems/combat/melee'
import {
  clearProjectiles,
  spawnProjectile,
  stepProjectiles,
  type Projectile,
} from '@/systems/combat/projectiles'
import { stepMana } from '@/systems/combat/resources'
import { handWeapons, manaPool, projectilePool } from '@/systems/combat/state'
import { createRigPose, readRigPose } from '@/systems/combat/rigs'
import {
  applyDamage,
  damageables,
  findDamageable,
  publishDamage,
  sweepDamageables,
  tickTargetStatuses,
} from '@/systems/combat/targets'
import {
  equipHand,
  heldStats,
  heldWeapon,
  commitSwing,
  stepHandWeapon,
  swingWindow,
  tryFire,
} from '@/systems/combat/weapon'

/**
 * Combat, once per fixed step: what each hand is doing, what is in the air, and what it hit.
 *
 * One system rather than a component per weapon. Everything here is ordering — mana before
 * firing, firing before flight, flight before impact, impact before the status tick — and
 * ordering that is spread across four components is ordering nobody can read. It runs at
 * `SystemOrder.Combat`, which is after the player has moved and after physics has stepped,
 * so a bolt is tested against the world as it is *now* rather than as it was half a step ago.
 *
 * The rules themselves are not here. Whether a shot is allowed lives in `weapon.ts`, what it
 * costs in `resources.ts`, how hard a swing was in `melee.ts`, how much it hurts in
 * `damage.ts`, and what it hit in `targets.ts` — all pure, all unit-tested. This file is the
 * wiring, and it is deliberately dull.
 */

/** Bolt speed in m/s. Fast enough to feel like a shot, slow enough to see the arc. */
const BOLT_SPEED = 18
const BOLT_LIFE = 2.5

/** How far either side of the tracked tip a blade still counts as having connected. */
const MELEE_SWEEP_RADIUS = 0.15

/**
 * Buzz a hand, by loadout slot.
 *
 * Module-level and set by the driver, because the haptics API wants an `XRControllerState`
 * that only a hook can produce, while every call site is a plain function inside the fixed
 * loop. No-ops on desktop, like everything else in `haptics.ts`.
 */
let buzz: (slot: Hand, preset: HapticPreset) => void = () => {}

export function CombatDriver() {
  const { world } = useRapier()
  const equipped = useGame((state) => state.save.equipped)
  const weapons = useGame((state) => state.save.weapons)
  const mainHand = useSettings((state) => state.mainHand)
  const left = useXRInputSourceState('controller', 'left')
  const right = useXRInputSourceState('controller', 'right')

  const pose = useMemo(() => ({ main: createRigPose(), off: createRigPose() }), [])
  const rapier = useRef(world)
  rapier.current = world

  const controllers = useRef({ left, right })
  controllers.current = { left, right }

  useEffect(() => {
    buzz = (slot, preset) => {
      const handedness = handednessOf(slot, useSettings.getState().mainHand)
      pulsePreset(controllers.current[handedness] ?? undefined, preset)
    }
    return () => {
      buzz = () => {}
    }
  }, [])

  // The save is the authority on what is held; the hand state is a cache of it that the
  // fixed loop can read without touching a store sixty times a second.
  useEffect(() => {
    equipHand(handWeapons.main, equipped.main)
    equipHand(handWeapons.off, equipped.off)
  }, [equipped.main, equipped.off])

  // Nothing survives leaving the scene: a bolt still in the air when the dungeon unmounts
  // would arrive in the foyer.
  useEffect(() => () => clearProjectiles(projectilePool), [])

  useFixedUpdate(
    (dt) => {
      stepMana(manaPool, dt)

      for (const slot of ['main', 'off'] as const) {
        stepHand(slot, dt, pose[slot], mainHand, weapons)
      }

      stepFlight(dt, rapier.current)
      stepBurning(dt)
    },
    SystemOrder.Combat,
    [mainHand, weapons],
  )

  return null
}

type Weapons = ReturnType<typeof useGame.getState>['save']['weapons']

function stepHand(
  slot: Hand,
  dt: number,
  pose: ReturnType<typeof createRigPose>,
  mainHand: 'left' | 'right',
  weapons: Weapons,
): void {
  const state = handWeapons[slot]
  stepHandWeapon(state, dt)

  const definition = heldWeapon(state)
  if (!definition) return

  const stats = heldStats(state, weapons[definition.id]?.upgrades)
  if (!stats) return

  const tracked = readRigPose(slot, pose)
  if (!tracked) return

  if (definition.archetype === 'melee') {
    // Desktop has no arm to swing, so the button starts the viewmodel's arc and the tracker
    // measures that instead. Deliberately the same measurement rather than a special case:
    // one speed rule, one damage curve, and no way for the two modes to disagree about what
    // a swing is worth.
    if (attackPressed(slot, mainHand, definition.archetype)) requestSwing(slot)

    // Speed in the player's frame, sweep in the world's. See rule 4 in `melee.ts`: without
    // this, walking counts as swinging and stick-turning counts as swinging harder.
    toPlayerFrame(pose.origin, playerState, localTip)
    const swing = trackSwing(state.swing, pose.origin, localTip, dt)
    const attempt = swingWindow(state, swing.speed)
    if (!attempt.ok) return

    // A swing fast enough to register is a noise event — stealth breaks when you swing a
    // blade, hit or miss. The pulse originates from the player, so enemies in all directions
    // hear it.
    emitNoise(playerState.position, WEAPON_NOISE_RADIUS)

    // The blade's own sweep is the hit test. A radius on top of it because only the *tip* is
    // tracked and a sword is 85cm of edge: a cut that passes within a hand's breadth of
    // something plainly connected somewhere along the blade, and in VR the alternative reads
    // as the sword going straight through the enemy.
    const hit = sweepDamageables(damageables(), swing.from, swing.to, MELEE_SWEEP_RADIUS)
    if (!hit) return

    commitSwing(state, stats)
    land(
      {
        base: stats.damage,
        element: definition.element,
        critChance: stats.crit,
        power: attempt.power,
        source: { kind: 'melee', weaponId: definition.id, hand: slot },
      },
      hit.target.id,
      hit.point,
      slot,
    )
    return
  }

  if (!attackPressed(slot, mainHand, definition.archetype)) return

  const attempt = tryFire(state, stats, manaPool, definition.manaCost)
  if (!attempt.ok) {
    // A refusal you cannot perceive is indistinguishable from a broken weapon — Sprint 1.1's
    // rule. A dry click is the cheapest honest answer until audio lands in 3.2.
    if (attempt.reason === 'mana') buzz(slot, Haptic.tick)
    return
  }

  // Firing a wand is a noise pulse — shooting breaks stealth even from behind cover.
  emitNoise(playerState.position, WEAPON_NOISE_RADIUS)

  spawnProjectile(projectilePool, {
    origin: pose.origin,
    direction: pose.direction,
    speed: BOLT_SPEED,
    life: BOLT_LIFE,
    base: stats.damage,
    element: definition.element,
    critChance: stats.crit,
    source: { kind: 'projectile', weaponId: definition.id, hand: slot },
  })
  buzz(slot, Haptic.fire)
}

/**
 * Is this hand attacking?
 *
 * The two modes differ only here, which is the point of the whole rig arrangement. The one
 * subtlety worth stating: in VR the trigger belongs to the interaction system whenever that
 * hand has a focus, or aiming at the shop board would fire a bolt into it. The desktop
 * equivalent — the click that captures the mouse must not also attack — is handled where the
 * click is bound, in `DesktopInputSampler`.
 *
 * A wand fires while the button is *held*; anything else fires on the press. That is the
 * difference between "rapid" and "you may now click 3.2 times a second".
 */
function attackPressed(slot: Hand, mainHand: 'left' | 'right', archetype: string): boolean {
  const handedness = handednessOf(slot, mainHand)
  const hand = xrInput[handedness]

  if (hand.connected) {
    if (interactionState.focus && interactionState.hand === handedness) return false
    return hand.trigger.justPressed || (hand.trigger.pressed && archetype === 'wand')
  }

  const button = slot === 'main' ? desktopInput.attackMain : desktopInput.attackOff
  return button.justPressed || (button.pressed && archetype === 'wand')
}

/** Scratch for the player-frame conversion. One per module; this runs twice a step. */
const localTip = { x: 0, y: 0, z: 0 }

let ray: Ray | null = null

/** Lazily built: Rapier's classes are only usable once its wasm module has initialised. */
function scratchRay(): Ray {
  ray ??= new Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 })
  return ray
}

/** Move every bolt, and resolve whatever it ran into. */
function stepFlight(dt: number, world: ReturnType<typeof useRapier>['world']): void {
  const targets = damageables()

  const impacts = stepProjectiles(projectilePool, dt, (from, to, projectile) => {
    const hit = sweepDamageables(targets, from, to, projectile.radius)

    // The world, as a Rapier ray along the same segment. Both are asked, and the nearer one
    // wins: a bolt must not pass through a wall to reach something standing behind it, and a
    // target standing in front of a wall must not have the wall claim the hit.
    const dx = to.x - from.x
    const dy = to.y - from.y
    const dz = to.z - from.z
    const length = Math.hypot(dx, dy, dz)

    let worldT = Number.POSITIVE_INFINITY
    if (length > 0) {
      // One Ray, reused. Rapier's is a real class with a wasm-backed constructor, and
      // allocating one per bolt per step is exactly the per-frame garbage the pool exists
      // to avoid.
      const ray = scratchRay()
      ray.origin.x = from.x
      ray.origin.y = from.y
      ray.origin.z = from.z
      ray.dir.x = dx / length
      ray.dir.y = dy / length
      ray.dir.z = dz / length

      const solid = world.castRay(
        ray,
        length,
        true,
        QueryFilterFlags.EXCLUDE_SENSORS,
        undefined,
        // The player's own capsule. A bolt leaving a hand starts inside it, and without this
        // every shot stops instantly — the same exclusion the teleport arc needs.
        playerCollider.current ?? undefined,
      )
      if (solid) worldT = solid.timeOfImpact / length
    }

    if (hit && hit.t <= worldT) return { point: hit.point, targetId: hit.target.id }

    if (Number.isFinite(worldT)) {
      return {
        point: { x: from.x + dx * worldT, y: from.y + dy * worldT, z: from.z + dz * worldT },
        targetId: null,
      }
    }

    return null
  })

  for (const impact of impacts) resolveImpact(impact.projectile, impact.point, impact.targetId)
}

function resolveImpact(
  projectile: Projectile,
  point: { x: number; y: number; z: number },
  targetId: string | null,
): void {
  if (!targetId) return

  land(
    {
      base: projectile.base,
      element: projectile.element,
      critChance: projectile.critChance,
      source: projectile.source,
    },
    targetId,
    point,
    projectile.source.hand,
  )
}

/**
 * The one place an attack becomes damage.
 *
 * Resolve, apply, publish, buzz — in that order, and nowhere else. Every attack in the game
 * arrives here, which is what makes "does a crit actually do double" a question with one
 * answer rather than three.
 */
function land(
  spec: DamageSpec,
  targetId: string,
  point: { x: number; y: number; z: number },
  slot: Hand | null,
): void {
  const target = findDamageable(targetId)
  if (!target) return

  const resolved = resolveDamage(spec, target.resistances)
  const event = applyDamage(target, resolved, point)
  publishDamage(event)

  // Louder for a crit or a kill. Until audio arrives in 3.2 this and the damage number are
  // the whole of the feedback, and a hit that feels identical to every other hit is a hit
  // the player cannot learn anything from.
  if (slot) buzz(slot, event.killed || resolved.crit ? Haptic.heavy : Haptic.impact)
}

/** Burn ticks, once per step, through the same damage path as everything else. */
function stepBurning(dt: number): void {
  for (const target of damageables()) {
    const burn = tickTargetStatuses(target, dt)
    if (!burn) continue
    publishDamage(applyDamage(target, burn, target.position))
  }
}

