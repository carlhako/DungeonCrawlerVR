import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DamageEvent, ResolvedDamage } from './damage'
import {
  applyDamage,
  clearDamageEvents,
  clearDamageables,
  damageSince,
  damageables,
  findDamageable,
  publishDamage,
  registerDamageable,
  sweepDamageables,
  type Damageable,
} from './targets'

function dummy(id: string, x: number, y: number, z: number, radius = 0.4): Damageable {
  return {
    id,
    position: { x, y, z },
    radius,
    hp: 100,
    maxHp: 100,
    statuses: [],
    enabled: true,
  }
}

const HIT: ResolvedDamage = {
  amount: 12,
  element: 'fire',
  crit: false,
  status: 'burning',
  source: { kind: 'projectile', weaponId: 'emberwand', hand: 'main' },
}

beforeEach(() => {
  clearDamageables()
  clearDamageEvents()
})

describe('the registry', () => {
  it('registers and unregisters', () => {
    const target = dummy('a', 0, 1, 0)
    const remove = registerDamageable(target)
    expect(findDamageable('a')).toBe(target)
    remove()
    expect(findDamageable('a')).toBeNull()
    expect(damageables()).toHaveLength(0)
  })

  it('a replaced target is not unregistered by the old one going away', () => {
    // Hot reload, and a dummy respawning: the stale cleanup must not delete the live entry.
    const first = dummy('a', 0, 1, 0)
    const remove = registerDamageable(first)
    const second = dummy('a', 5, 1, 0)
    registerDamageable(second)
    remove()
    expect(findDamageable('a')).toBe(second)
  })
})

describe('sweepDamageables', () => {
  it('finds a target the segment passes through', () => {
    const target = dummy('a', 0, 1, -5)
    const hit = sweepDamageables([target], { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: -10 })
    expect(hit?.target).toBe(target)
    expect(hit?.point.z).toBeCloseTo(-4.6, 5)
  })

  it('misses one the segment goes past', () => {
    const target = dummy('a', 3, 1, -5)
    expect(
      sweepDamageables([target], { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: -10 }),
    ).toBeNull()
  })

  it('does not reach past the end of the segment', () => {
    // The tunnelling guard's other half: one step of travel must not hit something three
    // metres further on that the bolt has not reached yet.
    const target = dummy('a', 0, 1, -5)
    expect(sweepDamageables([target], { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: -1 })).toBeNull()
  })

  it('does not hit something behind the start', () => {
    const target = dummy('a', 0, 1, 5)
    expect(
      sweepDamageables([target], { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: -10 }),
    ).toBeNull()
  })

  it('returns the nearest of several along the same line', () => {
    const near = dummy('near', 0, 1, -3)
    const far = dummy('far', 0, 1, -6)
    const hit = sweepDamageables([far, near], { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: -10 })
    expect(hit?.target).toBe(near)
  })

  it('counts a segment that starts inside a target as a hit', () => {
    // A blade already resting against something. Refusing this means it can never connect.
    const target = dummy('a', 0, 1, 0)
    const hit = sweepDamageables([target], { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: -1 })
    expect(hit?.target).toBe(target)
    expect(hit?.t).toBe(0)
  })

  it('widens the target by the sweep radius', () => {
    const target = dummy('a', 0.5, 1, -5)
    const from = { x: 0, y: 1, z: 0 }
    const to = { x: 0, y: 1, z: -10 }
    expect(sweepDamageables([target], from, to, 0)).toBeNull()
    expect(sweepDamageables([target], from, to, 0.2)?.target).toBe(target)
  })

  it('skips disabled and dead targets', () => {
    const dead = dummy('dead', 0, 1, -3)
    dead.hp = 0
    const disabled = dummy('disabled', 0, 1, -4)
    disabled.enabled = false
    const alive = dummy('alive', 0, 1, -5)

    const hit = sweepDamageables(
      [dead, disabled, alive],
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 1, z: -10 },
    )
    expect(hit?.target).toBe(alive)
  })

  it('honours a skip set, so one swing cannot hit the same thing twice', () => {
    const target = dummy('a', 0, 1, -3)
    const hit = sweepDamageables(
      [target],
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 1, z: -10 },
      0,
      new Set(['a']),
    )
    expect(hit).toBeNull()
  })

  it('a zero-length segment only hits what it is already inside', () => {
    const inside = dummy('inside', 0, 1, 0)
    const outside = dummy('outside', 0, 1, -5)
    const point = { x: 0, y: 1, z: 0 }
    expect(sweepDamageables([outside], point, point)).toBeNull()
    expect(sweepDamageables([inside], point, point)?.target).toBe(inside)
  })
})

describe('applyDamage', () => {
  it('takes exactly the resolved amount off', () => {
    const target = dummy('a', 0, 1, 0)
    const event = applyDamage(target, HIT, { x: 0, y: 1, z: 0 })
    expect(target.hp).toBe(88)
    expect(event.remaining).toBe(88)
    expect(event.amount).toBe(12)
  })

  it('never takes health below zero', () => {
    const target = dummy('a', 0, 1, 0)
    target.hp = 5
    applyDamage(target, HIT, { x: 0, y: 1, z: 0 })
    expect(target.hp).toBe(0)
  })

  it('marks the killing blow once and only once', () => {
    // Two hits landing on the same step must not both claim the kill, or a wave counts two
    // deaths for one enemy and the payout is wrong.
    const target = dummy('a', 0, 1, 0)
    target.hp = 10
    const killing = applyDamage(target, HIT, { x: 0, y: 1, z: 0 })
    const after = applyDamage(target, HIT, { x: 0, y: 1, z: 0 })
    expect(killing.killed).toBe(true)
    expect(after.killed).toBe(false)
  })

  it('applies the status the element implies', () => {
    const target = dummy('a', 0, 1, 0)
    applyDamage(target, HIT, { x: 0, y: 1, z: 0 })
    expect(target.statuses.map((status) => status.kind)).toEqual(['burning'])
  })

  it('does not bother lighting a corpse on fire', () => {
    const target = dummy('a', 0, 1, 0)
    target.hp = 2
    applyDamage(target, HIT, { x: 0, y: 1, z: 0 })
    expect(target.statuses).toHaveLength(0)
  })

  it('tells the target, so it can flash and stagger', () => {
    const onDamage = vi.fn()
    const target = { ...dummy('a', 0, 1, 0), onDamage }
    applyDamage(target, HIT, { x: 1, y: 2, z: 3 })
    expect(onDamage).toHaveBeenCalledTimes(1)
    expect((onDamage.mock.calls[0]![0] as DamageEvent).point).toEqual({ x: 1, y: 2, z: 3 })
  })

  it('copies the impact point rather than holding the caller’s vector', () => {
    // The driver reuses one scratch object per step. Holding it would have every damage
    // number in the buffer follow the most recent hit around the room.
    const point = { x: 1, y: 2, z: 3 }
    const event = applyDamage(dummy('a', 0, 1, 0), HIT, point)
    point.x = 99
    expect(event.point.x).toBe(1)
  })
})

describe('the damage event buffer', () => {
  it('hands back only what is new since the last read', () => {
    const first = applyDamage(dummy('a', 0, 1, 0), HIT, { x: 0, y: 0, z: 0 })
    publishDamage(first)

    const initial = damageSince(0)
    expect(initial.events).toHaveLength(1)

    const second = applyDamage(dummy('b', 0, 1, 0), HIT, { x: 0, y: 0, z: 0 })
    publishDamage(second)

    const next = damageSince(initial.seq)
    expect(next.events).toHaveLength(1)
    expect(next.events[0]!.targetId).toBe('b')
    expect(damageSince(next.seq).events).toHaveLength(0)
  })

  it('drops the oldest rather than growing without bound', () => {
    for (let i = 0; i < 100; i += 1) {
      publishDamage(applyDamage(dummy(`t${i}`, 0, 1, 0), HIT, { x: 0, y: 0, z: 0 }))
    }
    expect(damageSince(0).events.length).toBeLessThanOrEqual(32)
  })
})
