import { describe, expect, it } from 'vitest'
import { WEAPONS, weaponStats } from '@/data/weapons'
import { createManaPool, stepMana } from './resources'
import { MELEE_FULL_SPEED, MELEE_MIN_SPEED } from './melee'
import {
  commitSwing,
  createHandWeapon,
  equipHand,
  heldStats,
  heldWeapon,
  stepHandWeapon,
  swingWindow,
  tryFire,
} from './weapon'

const STEP = 1 / 60
const EMBER = weaponStats('emberwand')
const FROST = weaponStats('frostbrand-sword')

function armed(id: 'emberwand' | 'frostbrand-sword') {
  const hand = createHandWeapon('main')
  equipHand(hand, id)
  return hand
}

describe('equipping', () => {
  it('starts with nothing and refuses to fire', () => {
    const hand = createHandWeapon('main')
    const mana = createManaPool()
    expect(tryFire(hand, EMBER, mana, 6).reason).toBe('unarmed')
    expect(heldWeapon(hand)).toBeNull()
    expect(heldStats(hand)).toBeNull()
  })

  it('reads the weapon table, upgrades included', () => {
    const hand = armed('emberwand')
    expect(heldWeapon(hand)).toBe(WEAPONS.emberwand)
    expect(heldStats(hand, { damage: 2 })!.damage).toBeGreaterThan(EMBER.damage)
  })

  it('carries the cooldown across a swap, so swapping is not a way to fire twice', () => {
    const hand = armed('emberwand')
    tryFire(hand, EMBER, createManaPool(), 6)
    equipHand(hand, 'frostbrand-sword')
    expect(hand.cooldown.remaining).toBeGreaterThan(0)
  })

  it('resets the swing tracker on a swap', () => {
    // The new weapon's tip is somewhere else entirely; the difference reads as a swing at
    // several hundred metres per second.
    const hand = armed('frostbrand-sword')
    hand.swing.last = { x: 10, y: 10, z: 10 }
    equipHand(hand, 'emberwand')
    expect(hand.swing.last).toBeNull()
  })
})

describe('tryFire', () => {
  it('fires, spends mana, and starts the cooldown', () => {
    const hand = armed('emberwand')
    const mana = createManaPool()
    const attempt = tryFire(hand, EMBER, mana, 6)

    expect(attempt.ok).toBe(true)
    expect(attempt.power).toBe(1)
    expect(mana.current).toBe(mana.max - 6)
    expect(hand.cooldown.remaining).toBeCloseTo(1 / EMBER.rate, 6)
  })

  it('refuses while cooling down, and says so', () => {
    const hand = armed('emberwand')
    const mana = createManaPool()
    tryFire(hand, EMBER, mana, 6)
    const second = tryFire(hand, EMBER, mana, 6)

    expect(second.ok).toBe(false)
    expect(second.reason).toBe('cooldown')
    expect(hand.lastRefusal).toBe('cooldown')
  })

  it('does not spend mana on a refused shot', () => {
    // Checking in one place and spending in another is how a weapon ends up firing on an
    // empty pool one step in three.
    const hand = armed('emberwand')
    const mana = createManaPool()
    tryFire(hand, EMBER, mana, 6)
    const before = mana.current
    tryFire(hand, EMBER, mana, 6)
    expect(mana.current).toBe(before)
  })

  it('refuses when the pool is dry', () => {
    const hand = armed('emberwand')
    const mana = createManaPool(10)
    mana.current = 2
    const attempt = tryFire(hand, EMBER, mana, 6)
    expect(attempt.reason).toBe('mana')
    expect(mana.current).toBe(2)
  })

  it('clears the refusal once a shot goes through', () => {
    const hand = armed('emberwand')
    const mana = createManaPool()
    tryFire(hand, EMBER, mana, 6)
    tryFire(hand, EMBER, mana, 6)
    expect(hand.lastRefusal).toBe('cooldown')

    for (let i = 0; i < 60; i += 1) {
      stepHandWeapon(hand, STEP)
      stepMana(mana, STEP)
    }
    tryFire(hand, EMBER, mana, 6)
    expect(hand.lastRefusal).toBeNull()
  })

  it('holding the trigger empties the pool rather than firing forever', () => {
    // The whole reason mana exists. Sixteen shots at 6 each is a hundred; the regen delay
    // means the pool cannot quietly refund them mid-burst.
    const hand = armed('emberwand')
    const mana = createManaPool()
    let shots = 0
    let refusedForMana = 0

    for (let i = 0; i < 60 * 8; i += 1) {
      stepHandWeapon(hand, STEP)
      stepMana(mana, STEP)
      const attempt = tryFire(hand, EMBER, mana, WEAPONS.emberwand.manaCost)
      if (attempt.ok) shots += 1
      if (attempt.reason === 'mana') refusedForMana += 1
    }

    expect(shots).toBeGreaterThan(10)
    expect(refusedForMana).toBeGreaterThan(0)
  })
})

describe('the swing window', () => {
  /** A step where the blade is moving and something is in front of it. */
  function strike(hand: ReturnType<typeof armed>, speed: number): number {
    const attempt = swingWindow(hand, speed)
    if (!attempt.ok) return 0
    commitSwing(hand, FROST)
    return attempt.power
  }

  it('opens for a real swing, scaled by how hard it was', () => {
    const hand = armed('frostbrand-sword')
    const attempt = swingWindow(hand, MELEE_FULL_SPEED)
    expect(attempt.ok).toBe(true)
    expect(attempt.power).toBeCloseTo(1, 6)
  })

  it('stays shut for a blade that is merely being carried', () => {
    const hand = armed('frostbrand-sword')
    const attempt = swingWindow(hand, MELEE_MIN_SPEED - 0.1)
    expect(attempt.ok).toBe(false)
    expect(attempt.reason).toBe('too-slow')
  })

  it('does not nag about a slow blade', () => {
    // This is the answer sixty times a second while the player walks around holding a
    // sword. Recording it as a refusal would have the HUD permanently telling them off.
    const hand = armed('frostbrand-sword')
    swingWindow(hand, 0.2)
    expect(hand.lastRefusal).toBeNull()
  })

  it('costs no mana, so an empty pool still leaves something to do', () => {
    const hand = armed('frostbrand-sword')
    const mana = createManaPool()
    mana.current = 0
    expect(swingWindow(hand, MELEE_FULL_SPEED).ok).toBe(true)
    expect(mana.current).toBe(0)
  })

  it('stays open across a whole swing rather than closing on the first fast step', () => {
    // The defect this rule exists for. Starting the cooldown when the *speed* crossed the
    // floor spent the swing on a single fixed step — nine centimetres of arc, at the very
    // beginning of the movement, which is where the blade is furthest from what it is aimed
    // at. The sword swung, the numbers all looked right, and it hit nothing.
    const hand = armed('frostbrand-sword')
    let open = 0
    for (let i = 0; i < 18; i += 1) {
      stepHandWeapon(hand, STEP)
      if (swingWindow(hand, MELEE_FULL_SPEED).ok) open += 1
    }
    expect(open).toBe(18)
  })

  it('costs nothing to swing at air', () => {
    const hand = armed('frostbrand-sword')
    for (let i = 0; i < 60; i += 1) swingWindow(hand, MELEE_FULL_SPEED)
    expect(hand.cooldown.remaining).toBe(0)
  })

  it('closes once a hit lands, and reopens at the weapon rate', () => {
    const hand = armed('frostbrand-sword')
    let hits = 0
    for (let i = 0; i < 60; i += 1) {
      stepHandWeapon(hand, STEP)
      if (strike(hand, MELEE_FULL_SPEED) > 0) hits += 1
    }
    expect(hits).toBeGreaterThanOrEqual(1)
    expect(hits).toBeLessThanOrEqual(2)
  })

  it('waggling is worth no more than swinging, and usually less', () => {
    // The one rule that actually kills the degenerate strategy. Over two seconds, a frantic
    // waggle at the speed floor and a committed swing every cooldown land the same number of
    // hits — because the cooldown is spent per *hit* — and the waggle's are weaker.
    const waggler = armed('frostbrand-sword')
    const swinger = armed('frostbrand-sword')

    let wagglePower = 0
    let swingPowerTotal = 0

    for (let i = 0; i < 120; i += 1) {
      stepHandWeapon(waggler, STEP)
      stepHandWeapon(swinger, STEP)

      wagglePower += strike(waggler, MELEE_MIN_SPEED + 0.2)
      // A real swing peaks every ~0.6s rather than every step.
      swingPowerTotal += strike(swinger, i % 36 === 0 ? MELEE_FULL_SPEED + 1 : 0)
    }

    expect(wagglePower).toBeLessThan(swingPowerTotal)
  })

  it('refuses inside the cooldown, and does say so', () => {
    // Unlike "too slow", the player did swing here, and deserves to know why nothing landed.
    const hand = armed('frostbrand-sword')
    strike(hand, MELEE_FULL_SPEED)
    const second = swingWindow(hand, MELEE_FULL_SPEED)
    expect(second.reason).toBe('cooldown')
    expect(hand.lastRefusal).toBe('cooldown')
  })
})
