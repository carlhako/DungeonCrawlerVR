import { describe, expect, it } from 'vitest'
import {
  createSwingTracker,
  MELEE_FULL_SPEED,
  MELEE_MAX_POWER,
  MELEE_MAX_SPEED,
  MELEE_MIN_POWER,
  MELEE_MIN_SPEED,
  resetSwing,
  swingPower,
  toPlayerFrame,
  trackSwing,
} from './melee'

const STEP = 1 / 60

describe('swingPower', () => {
  it('is nothing below the floor, so carrying a blade is not an attack', () => {
    expect(swingPower(0)).toBe(0)
    expect(swingPower(MELEE_MIN_SPEED - 0.01)).toBe(0)
  })

  it('cuts at the floor, weakly', () => {
    expect(swingPower(MELEE_MIN_SPEED)).toBeCloseTo(MELEE_MIN_POWER, 6)
  })

  it('is full damage at a committed swing', () => {
    expect(swingPower(MELEE_FULL_SPEED)).toBeCloseTo(1, 6)
  })

  it('rewards a harder swing, but only a little', () => {
    expect(swingPower(MELEE_MAX_SPEED)).toBeCloseTo(MELEE_MAX_POWER, 6)
    expect(swingPower(40)).toBeCloseTo(MELEE_MAX_POWER, 6)
    // The whole anti-waggle argument in one assertion: swinging three times as fast as a
    // real swing is worth less than half again as much damage.
    expect(swingPower(MELEE_MAX_SPEED) / swingPower(MELEE_FULL_SPEED)).toBeLessThan(1.5)
  })

  it('never goes backwards as the swing gets faster', () => {
    let previous = -1
    for (let speed = 0; speed <= 12; speed += 0.05) {
      const power = swingPower(speed)
      expect(power).toBeGreaterThanOrEqual(previous)
      previous = power
    }
  })

  it('treats nonsense speed as no swing', () => {
    expect(swingPower(Number.NaN)).toBe(0)
  })
})

describe('trackSwing', () => {
  it('reports nothing on the first sample', () => {
    // Otherwise equipping a sword reads as a swing from the origin to the player's hand,
    // which is several hundred metres per second and kills whatever is standing nearby.
    const tracker = createSwingTracker()
    const step = trackSwing(tracker, { x: 3, y: 1.2, z: -2 }, { x: 3, y: 1.2, z: -2 }, STEP)
    expect(step.speed).toBe(0)
    expect(step.from).toEqual(step.to)
  })

  it('measures speed from the distance the tip actually moved', () => {
    const tracker = createSwingTracker()
    trackSwing(tracker, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, STEP)
    const step = trackSwing(tracker, { x: 0.1, y: 0, z: 0 }, { x: 0.1, y: 0, z: 0 }, STEP)
    expect(step.speed).toBeCloseTo(6, 5)
  })

  it('hands back the swept segment, not a point', () => {
    // A tip at 6m/s covers 10cm in a step, which is most of the width of what it is aimed
    // at. A point test at the new position misses things the blade plainly went through.
    const tracker = createSwingTracker()
    trackSwing(tracker, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, STEP)
    const step = trackSwing(tracker, { x: 0.1, y: 0, z: 0 }, { x: 0.1, y: 0, z: 0 }, STEP)
    expect(step.from).toEqual({ x: 0, y: 0, z: 0 })
    expect(step.to).toEqual({ x: 0.1, y: 0, z: 0 })
  })

  it('holds the peak of a swing through the deceleration into contact', () => {
    // People slow down into the thing they are hitting. Reading the contact frame alone
    // punishes an aimed swing and rewards a wild follow-through.
    const tracker = createSwingTracker()
    trackSwing(tracker, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, STEP)
    trackSwing(tracker, { x: 0.1, y: 0, z: 0 }, { x: 0.1, y: 0, z: 0 }, STEP) // 6 m/s
    const contact = trackSwing(tracker, { x: 0.102, y: 0, z: 0 }, { x: 0.102, y: 0, z: 0 }, STEP) // 0.12 m/s
    expect(contact.speed).toBeGreaterThan(4)
  })

  it('lets the held peak decay, so one swing is not credit for the next second', () => {
    const tracker = createSwingTracker()
    trackSwing(tracker, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, STEP)
    trackSwing(tracker, { x: 0.15, y: 0, z: 0 }, { x: 0.15, y: 0, z: 0 }, STEP) // 9 m/s

    let speed = tracker.speed
    for (let i = 0; i < 30; i += 1) {
      speed = trackSwing(tracker, { x: 0.15, y: 0, z: 0 }, { x: 0.15, y: 0, z: 0 }, STEP).speed
    }
    expect(speed).toBeLessThan(MELEE_MIN_SPEED)
  })

  it('forgets its position on reset but can pick straight back up', () => {
    const tracker = createSwingTracker()
    trackSwing(tracker, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, STEP)
    resetSwing(tracker)
    const step = trackSwing(tracker, { x: 5, y: 5, z: 5 }, { x: 5, y: 5, z: 5 }, STEP)
    expect(step.speed).toBe(0)
  })

  it('a fast tiny waggle still reads as fast — which is why the cooldown exists', () => {
    // Recorded rather than fixed here, deliberately. Speed alone cannot tell a waggle from
    // a swing; see `weapon.test.ts` for the rule that actually makes waggling worthless.
    const tracker = createSwingTracker()
    trackSwing(tracker, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, STEP)
    let peak = 0
    for (let i = 0; i < 20; i += 1) {
      const x = i % 2 === 0 ? 0.04 : 0
      peak = Math.max(peak, trackSwing(tracker, { x, y: 0, z: 0 }, { x, y: 0, z: 0 }, STEP).speed)
    }
    expect(peak).toBeGreaterThan(MELEE_MIN_SPEED)
  })
})

describe('the player’s own frame', () => {
  const out = { x: 0, y: 0, z: 0 }

  it('subtracts where the player is', () => {
    toPlayerFrame({ x: 3, y: 1.4, z: -2 }, { position: { x: 1, y: 0, z: -1 }, yaw: 0 }, out)
    expect(out).toEqual({ x: 2, y: 1.4, z: -1 })
  })

  it('subtracts which way they are facing', () => {
    // At yaw 0 the player faces -Z. A quarter turn puts them facing -X, so the point one
    // metre down -Z that used to be straight ahead is now directly to their right.
    toPlayerFrame(
      { x: 0, y: 0, z: -1 },
      { position: { x: 0, y: 0, z: 0 }, yaw: Math.PI / 2 },
      out,
    )
    expect(out.x).toBeCloseTo(1, 6)
    expect(out.z).toBeCloseTo(0, 6)
  })

  it('is the exact inverse of the yaw that placed the point', () => {
    // Belt and braces on the sign, because getting it backwards produces a function that
    // looks plausible in every static case and only misbehaves while the player turns.
    const yaw = 0.7
    const local = { x: 0.3, y: 1.2, z: -0.6 }
    const world = {
      x: local.x * Math.cos(yaw) + local.z * Math.sin(yaw) + 4,
      y: local.y,
      z: -local.x * Math.sin(yaw) + local.z * Math.cos(yaw) - 2,
    }
    toPlayerFrame(world, { position: { x: 4, y: 0, z: -2 }, yaw }, out)
    expect(out.x).toBeCloseTo(local.x, 6)
    expect(out.y).toBeCloseTo(local.y, 6)
    expect(out.z).toBeCloseTo(local.z, 6)
  })

  it('makes walking with a blade out not a swing', () => {
    // The bug this rule exists for, caught by the smoke test: the desktop viewmodel hangs off
    // the camera, so at a 3 m/s walk the tip was moving through the world at twice the speed
    // floor. Everything the player walked past was being cut.
    const tracker = createSwingTracker()
    const player = { position: { x: 0, y: 0, z: 0 }, yaw: 0 }
    // The tip is held still relative to the player, half a metre in front of them.
    const local = { x: 0, y: 1.4, z: -0.5 }

    let speed = 0
    for (let i = 0; i < 60; i += 1) {
      player.position.z -= 3 * STEP
      const world = { x: 0, y: 1.4, z: player.position.z - 0.5 }
      speed = trackSwing(tracker, world, local, STEP).speed
    }

    expect(speed).toBe(0)
    expect(swingPower(speed)).toBe(0)
  })

  it('makes stick-turning on the spot not a swing either', () => {
    const tracker = createSwingTracker()
    const player = { position: { x: 0, y: 0, z: 0 }, yaw: 0 }
    const scratch = { x: 0, y: 0, z: 0 }

    let speed = 0
    for (let i = 0; i < 60; i += 1) {
      // 120°/s, the default smooth-turn rate.
      player.yaw += ((120 * Math.PI) / 180) * STEP
      // A blade held out front, carried around by the turn.
      const world = {
        x: -Math.sin(player.yaw) * 0.6,
        y: 1.4,
        z: -Math.cos(player.yaw) * 0.6,
      }
      toPlayerFrame(world, player, scratch)
      speed = trackSwing(tracker, world, { ...scratch }, STEP).speed
    }

    expect(swingPower(speed)).toBe(0)
  })

  it('still sweeps the world segment, because the room is where the enemy is', () => {
    const tracker = createSwingTracker()
    trackSwing(tracker, { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: -0.5 }, STEP)
    const step = trackSwing(tracker, { x: 0, y: 1, z: -0.1 }, { x: 0, y: 1, z: -0.6 }, STEP)
    expect(step.from).toEqual({ x: 0, y: 1, z: 0 })
    expect(step.to).toEqual({ x: 0, y: 1, z: -0.1 })
  })
})
