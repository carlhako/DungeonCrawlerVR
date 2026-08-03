import { useEffect, useRef } from 'react'
import { SystemOrder } from '@/core/loop'
import { useFixedUpdate } from '@/core/simulation'
import { ELEMENT_COLOUR } from '@/data/elements'
import type { Element } from '@/data/elements'
import { projectilePool } from '@/systems/combat/state'
import { damageSince } from '@/systems/combat/targets'
import { CRIT_HITSTOP, KILL_HITSTOP, requestHitstop } from '@/systems/fx/hitstop'
import { hexToRgb, spawnBurst, spawnParticle, stepParticles, clearParticles, type Rgb } from '@/systems/fx/particles'
import { addTrauma, stepShake, Trauma } from '@/systems/fx/shake'
import { fxSince } from '@/systems/fx/signals'
import { hitstopState, particlePool, shakeState } from '@/systems/fx/state'
import { playerVitals } from '@/systems/vitals'

/**
 * Everything that happens *because* of combat, once per fixed step.
 *
 * One system rather than an effect per source, and it reads the two published buffers rather
 * than being called by anything: `targets.ts` says what lost health, `signals.ts` says what
 * fired and what hit a wall, and this turns both into sparks, trauma and hitstop. Nothing in
 * the combat driver knows this file exists, which is what keeps "what a hit *is*" and "what a
 * hit *looks like*" separable — the first is unit-tested arithmetic, the second is taste.
 *
 * At `SystemOrder.Effects`, after combat has resolved and before the HUD reads anything, so a
 * kill's burst is emitted on the same step the kill happened rather than one behind it.
 */

/** Colours cached by element, so the pool never parses a hex string on a hot path. */
const ELEMENT_RGB: Record<Element, Rgb> = {
  physical: hexToRgb(ELEMENT_COLOUR.physical),
  fire: hexToRgb(ELEMENT_COLOUR.fire),
  frost: hexToRgb(ELEMENT_COLOUR.frost),
}

/** Bone and ash, for the burst a body comes apart into. Not element-coloured: it is the body. */
const ASH = hexToRgb('#b8a88c')

/** Warm white, for the crit flare and the muzzle flash's core. */
const FLASH = hexToRgb('#fff0d0')

/**
 * How often a bolt sheds a trail ember, in fixed steps.
 *
 * Every step at 60Hz is 60 particles a second per bolt, and a wand held down keeps five in
 * the air — a third of the pool spent on trails alone. Every third step still leaves a
 * continuous streak behind something crossing a room in a fifth of a second.
 */
const TRAIL_INTERVAL = 3

/** Sparks fall, but not at gravity: they are embers, not gravel. */
const SPARK_GRAVITY = 3.4

export function FxDriver() {
  const seen = useRef(0)
  const fxSeen = useRef(0)
  const trailTick = useRef(0)
  const lastHurt = useRef(0)

  // Start from whatever both buffers have already published: mounting must not replay every
  // hit landed before this component existed as one enormous burst at the origin.
  useEffect(() => {
    seen.current = damageSince(0).seq
    fxSeen.current = fxSince(0).seq
  }, [])

  // Nothing survives leaving the scene. Sparks still in the air when the dungeon unmounts
  // would be hanging in the foyer, at the coordinates of a level that no longer exists.
  useEffect(() => () => clearParticles(particlePool), [])

  useFixedUpdate(
    (dt) => {
      const damage = damageSince(seen.current)
      seen.current = damage.seq
      for (const event of damage.events) impactEffect(event.point, event.element, event.crit, event.killed)

      const fx = fxSince(fxSeen.current)
      fxSeen.current = fx.seq
      for (const signal of fx.signals) {
        if (signal.kind === 'muzzle') muzzleEffect(signal.point, signal.direction, signal.element)
        else worldImpactEffect(signal.point, signal.direction, signal.element)
      }

      // Being hit shakes the view on a monitor and does nothing to it in a headset — the
      // rule lives inside `sampleShake`, so adding trauma here is safe in both modes. `hurt`
      // is set to 1 by `hurtPlayer` and decays; a rising edge is a fresh hit.
      if (playerVitals.hurt > lastHurt.current) addTrauma(shakeState, Trauma.hurt)
      lastHurt.current = playerVitals.hurt

      trailTick.current += 1
      if (trailTick.current >= TRAIL_INTERVAL) {
        trailTick.current = 0
        emitTrails()
      }

      stepParticles(particlePool, dt)
      stepShake(shakeState, dt)
    },
    SystemOrder.Effects,
    [],
  )

  return null
}

/**
 * What a landed hit throws off.
 *
 * Three tiers, and they are meant to be distinguishable at a glance across a dark room: an
 * ordinary hit is a handful of element-coloured sparks, a crit adds a white flare, and a kill
 * is a body coming apart — a wide burst of ash with the sparks inside it. The player learns
 * what they did from the size of the burst before they have read the number.
 */
function impactEffect(
  point: { x: number; y: number; z: number },
  element: Element,
  crit: boolean,
  killed: boolean,
): void {
  const colour = ELEMENT_RGB[element]

  spawnBurst(particlePool, {
    origin: point,
    // No surface normal is available for a hit on a body — the sweep gives a point on a
    // sphere, not a face — so it sprays evenly and gravity does the rest.
    direction: { x: 0, y: 0, z: 0 },
    spread: 1,
    count: crit || killed ? 14 : 8,
    speedMin: 1.1,
    speedMax: crit || killed ? 4.2 : 2.8,
    lifeMin: 0.18,
    lifeMax: 0.42,
    size: 0.028,
    colour,
    gravity: SPARK_GRAVITY,
    drag: 2.2,
  })

  if (crit) {
    spawnParticle(particlePool, {
      origin: point,
      vx: 0,
      vy: 0.4,
      vz: 0,
      life: 0.12,
      size: 0.16,
      colour: FLASH,
    })
    requestHitstop(hitstopState, CRIT_HITSTOP)
    addTrauma(shakeState, Trauma.crit)
  } else if (!killed) {
    addTrauma(shakeState, Trauma.hit)
  }

  if (!killed) return

  // The death burst. Wider, slower and ash-coloured, so a kill is legible as an event
  // separate from the hit that caused it — which matters most in a pack, where several
  // things are being hit and only one of them just died.
  spawnBurst(particlePool, {
    origin: { x: point.x, y: point.y, z: point.z },
    direction: { x: 0, y: 1, z: 0 },
    spread: 0.85,
    count: 26,
    speedMin: 0.5,
    speedMax: 2.4,
    lifeMin: 0.5,
    lifeMax: 1.1,
    size: 0.036,
    colour: ASH,
    gravity: 1.4,
    drag: 1.6,
  })

  requestHitstop(hitstopState, KILL_HITSTOP)
  addTrauma(shakeState, Trauma.kill)
}

/** A bolt meeting stone: sparks *off the wall*, along the normal we have. */
function worldImpactEffect(
  point: { x: number; y: number; z: number },
  normal: { x: number; y: number; z: number },
  element: Element,
): void {
  spawnBurst(particlePool, {
    origin: point,
    direction: normal,
    // A cone rather than a sphere, because half a sphere's worth would be inside the wall.
    spread: 0.55,
    count: 10,
    speedMin: 1.2,
    speedMax: 3.6,
    lifeMin: 0.15,
    lifeMax: 0.4,
    size: 0.024,
    colour: ELEMENT_RGB[element],
    gravity: SPARK_GRAVITY,
    drag: 2.4,
  })
}

/**
 * The muzzle flash.
 *
 * A single large, very short-lived particle at the tip plus a narrow spray of embers along
 * the line of fire. Not a light: a point light created and destroyed per shot recompiles
 * every material it touches, which is the hitch the torch pool was built to avoid, and a shot
 * happens three times a second.
 */
function muzzleEffect(
  point: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
  element: Element,
): void {
  spawnParticle(particlePool, {
    origin: point,
    vx: 0,
    vy: 0,
    vz: 0,
    life: 0.07,
    size: 0.11,
    colour: FLASH,
  })

  spawnBurst(particlePool, {
    origin: point,
    direction,
    spread: 0.28,
    count: 6,
    speedMin: 1.8,
    speedMax: 4.5,
    lifeMin: 0.08,
    lifeMax: 0.2,
    size: 0.02,
    colour: ELEMENT_RGB[element],
    drag: 3.5,
  })
}

/** An ember shed behind every bolt in the air, so a shot leaves a streak rather than a dot. */
function emitTrails(): void {
  for (const bolt of projectilePool.items) {
    if (!bolt.active) continue
    spawnParticle(particlePool, {
      origin: { x: bolt.x, y: bolt.y, z: bolt.z },
      // Barely moving, and no gravity: a trail is where the bolt *was*, and an ember that
      // drifts turns a streak into a smear.
      vx: bolt.vx * 0.04,
      vy: bolt.vy * 0.04,
      vz: bolt.vz * 0.04,
      life: 0.22,
      size: 0.03,
      colour: ELEMENT_RGB[bolt.element],
    })
  }
}
