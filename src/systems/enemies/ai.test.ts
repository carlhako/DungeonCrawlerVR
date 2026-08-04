import { describe, expect, it } from 'vitest'
import { CORPSE_SECONDS, ENEMIES, SPAWN_SECONDS, type EnemyId } from '@/data/enemies'
import { applyStatus } from '@/systems/combat/damage'
import { MAX_IDLE_SECONDS, QUIET_DETECTION } from '@/systems/stealth'
import {
  LOSE_INTEREST_SECONDS,
  RANGE_HYSTERESIS,
  enterPhase,
  killEnemy,
  staggerEnemy,
  stepEnemyAi,
  type AiContext,
} from './ai'
import { createEnemyPool, livingEnemies, spawnEnemy, type Enemy } from './pool'

const STEP = 1 / 60

function makeEnemy(type: EnemyId = 'skeleton-warrior', at = { x: 0, z: 0 }): Enemy {
  const pool = createEnemyPool(4)
  const enemy = spawnEnemy(pool, type, at)
  if (!enemy) throw new Error('the pool refused a spawn into an empty pool')
  return enemy
}

function context(overrides: Partial<AiContext> = {}): AiContext {
  return {
    player: { x: 0, y: 1.05, z: -6 },
    visible: true,
    neighbours: [],
    selfIndex: -1,
    playerAlive: true,
    detectionScale: 1,
    ...overrides,
  }
}

/** Run the machine for `seconds`, applying whatever it decided to the enemy's position. */
function run(enemy: Enemy, ctx: AiContext, seconds: number) {
  let strikes = 0
  const phases: string[] = []
  for (let t = 0; t < seconds; t += STEP) {
    const intent = stepEnemyAi(enemy, ctx, STEP)
    enemy.position.x += intent.dx
    enemy.position.z += intent.dz
    if (intent.strike) strikes += 1
    if (phases.at(-1) !== enemy.phase) phases.push(enemy.phase)
  }
  return { strikes, phases }
}

describe('spawning', () => {
  it('cannot be hit while it is still arriving', () => {
    // The other half of the unfair-damage problem the telegraph solves: something that pops
    // into existence already swinging, or that can be killed before it exists.
    const enemy = makeEnemy()
    expect(enemy.target.enabled).toBe(false)
    run(enemy, context(), SPAWN_SECONDS / 2)
    expect(enemy.target.enabled).toBe(false)
    expect(enemy.phase).toBe('spawning')
  })

  it('becomes real, and then notices the player', () => {
    const enemy = makeEnemy()
    run(enemy, context(), SPAWN_SECONDS + STEP * 2)
    expect(enemy.target.enabled).toBe(true)
    expect(enemy.phase).toBe('chase')
  })

  it('does not move while it arrives', () => {
    const enemy = makeEnemy()
    const before = { ...enemy.position }
    run(enemy, context(), SPAWN_SECONDS / 2)
    expect(enemy.position).toEqual(before)
  })
})

describe('aggro', () => {
  it('does not react to a player it cannot see, before the safety valve', () => {
    // Aggro through a wall makes a dungeon feel like a room full of trip-wires rather than a
    // place with things living in it.
    const enemy = makeEnemy()
    run(enemy, context({ visible: false }), SPAWN_SECONDS + 5)
    expect(enemy.phase).toBe('idle')
  })

  it('does not react to a player it can see but is nowhere near, with full detection', () => {
    const enemy = makeEnemy()
    const far = context({ player: { x: 0, y: 1.05, z: -60 } })
    run(enemy, far, SPAWN_SECONDS + 5)
    expect(enemy.phase).toBe('idle')
  })

  it('does not react when the player is just outside the shrunk detection radius while moving quietly', () => {
    // Quiet movement shrinks the aggro radius. A player just outside the shrunk radius
    // should remain undetected — the whole point of the stealth mechanic.
    const definition = ENEMIES['skeleton-warrior']
    const enemy = makeEnemy('skeleton-warrior')
    // Full aggro radius is 13, shrunk is 13 * QUIET_DETECTION = 5.2. Stand at 7m — visible
    // but outside the shrunk radius.
    const shrunkRadius = definition.aggroRadius * QUIET_DETECTION
    const ctx = context({
      player: { x: 0, y: 1.05, z: -(shrunkRadius + 1.5) },
      visible: true,
      detectionScale: QUIET_DETECTION,
    })
    run(enemy, ctx, SPAWN_SECONDS + 3)
    expect(enemy.phase).toBe('idle')
  })

  it('notices a player within the shrunk radius even while creeping', () => {
    const definition = ENEMIES['skeleton-warrior']
    const enemy = makeEnemy('skeleton-warrior')
    const shrunkRadius = definition.aggroRadius * QUIET_DETECTION
    // Inside the shrunk radius, visible — should notice.
    const ctx = context({
      player: { x: 0, y: 1.05, z: -(shrunkRadius - 1) },
      visible: true,
      detectionScale: QUIET_DETECTION,
    })
    run(enemy, ctx, SPAWN_SECONDS + 1)
    expect(enemy.phase).toBe('chase')
  })

  it('notices a player at full radius when moving at full speed', () => {
    const definition = ENEMIES['skeleton-warrior']
    const enemy = makeEnemy('skeleton-warrior')
    // Just inside the full radius, visible, full detection.
    const ctx = context({
      player: { x: 0, y: 1.05, z: -(definition.aggroRadius - 1) },
      visible: true,
      detectionScale: 1,
    })
    run(enemy, ctx, SPAWN_SECONDS + 1)
    expect(enemy.phase).toBe('chase')
  })

  it('comes hunting after the safety valve, regardless of detection', () => {
    // The last-resort guarantee. A player camped somewhere no spawn point can see will not
    // stall the wave forever.
    const enemy = makeEnemy()
    const far = context({ player: { x: 0, y: 1.05, z: -60 }, visible: false })
    run(enemy, far, SPAWN_SECONDS + MAX_IDLE_SECONDS + STEP * 2)
    expect(enemy.phase).toBe('chase')
  })

  it('turns on you at once when it has been hurt, wall or no wall', () => {
    // Or a wand outranges every enemy in the game and sniping from the dark becomes the whole
    // of the tactics.
    const enemy = makeEnemy()
    run(enemy, context({ visible: false }), SPAWN_SECONDS + STEP)
    expect(enemy.phase).toBe('idle')
    enemy.alerted = true
    run(enemy, context({ visible: false }), 0.05)
    expect(enemy.phase).toBe('chase')
  })

  it('asks for a path the moment it wakes up', () => {
    const enemy = makeEnemy()
    let repaths = 0
    for (let t = 0; t < SPAWN_SECONDS + 0.2; t += STEP) {
      if (stepEnemyAi(enemy, context(), STEP).repath) repaths += 1
    }
    expect(repaths).toBeGreaterThan(0)
  })
})

describe('chasing', () => {
  it('closes on the player when it has no path to follow', () => {
    // "No route" is a real answer from the pathfinder, and the alternative to walking at the
    // player anyway is an enemy that stands still for the rest of the wave.
    const enemy = makeEnemy('goblin-skulker', { x: 0, z: 0 })
    const ctx = context({ player: { x: 0, y: 1.05, z: -8 } })
    run(enemy, ctx, SPAWN_SECONDS + 1)
    expect(enemy.position.z).toBeLessThan(-0.5)
  })

  it('follows its path rather than the player', () => {
    const enemy = makeEnemy('goblin-skulker', { x: 0, z: 0 })
    enemy.path = [{ x: 6, z: 0 }]
    enemy.pathIndex = 0
    enemy.sincePath = 0
    const ctx = context({ player: { x: 0, y: 1.05, z: -8 } })
    // Straight through the spawn beat, then one step of walking before a repath is due.
    run(enemy, ctx, SPAWN_SECONDS + 0.2)
    expect(enemy.position.x).toBeGreaterThan(0)
  })

  it('walks slower when it is chilled', () => {
    // The Frostbrand's entire blurb. A weapon that "chills on hit" with nothing reading the
    // chill is a weapon with a lie in it.
    const warm = makeEnemy('goblin-skulker')
    const cold = makeEnemy('goblin-skulker')
    applyStatus(cold.target.statuses, 'chilled')

    // Inside the Skulker's aggro radius, far enough that neither reaches attack range.
    const ctx = context({ player: { x: 0, y: 1.05, z: -9 } })
    run(warm, ctx, SPAWN_SECONDS + 1)
    run(cold, ctx, SPAWN_SECONDS + 1)
    expect(Math.abs(cold.position.z)).toBeLessThan(Math.abs(warm.position.z))
  })

  it('faces the way it is walking', () => {
    const enemy = makeEnemy('goblin-skulker')
    run(enemy, context({ player: { x: 0, y: 1.05, z: -8 } }), SPAWN_SECONDS + 1)
    // Walking towards -Z is yaw 0, which is where three.js points at rest.
    expect(Math.abs(enemy.yaw)).toBeLessThan(0.2)
  })
})

describe('losing interest', () => {
  it('keeps chasing through a brief break in line of sight', () => {
    const enemy = makeEnemy()
    enterPhase(enemy, 'chase')
    enemy.target.enabled = true
    run(enemy, context({ visible: false }), LOSE_INTEREST_SECONDS - 0.5)
    expect(enemy.phase).toBe('chase')
  })

  it('gives up after losing sight of the player for long enough', () => {
    const enemy = makeEnemy()
    enterPhase(enemy, 'chase')
    enemy.target.enabled = true
    enemy.alerted = true
    run(enemy, context({ visible: false }), LOSE_INTEREST_SECONDS + STEP * 2)
    expect(enemy.phase).toBe('idle')
    expect(enemy.alerted).toBe(false)
  })

  it('resets the give-up clock on so much as a glimpse', () => {
    const enemy = makeEnemy()
    enterPhase(enemy, 'chase')
    enemy.target.enabled = true
    run(enemy, context({ visible: false }), LOSE_INTEREST_SECONDS - 0.5)
    // Seen again just before the clock would have run out.
    run(enemy, context({ visible: true, player: { x: 0, y: 1.05, z: -6 } }), STEP)
    run(enemy, context({ visible: false }), LOSE_INTEREST_SECONDS - 0.5)
    expect(enemy.phase).toBe('chase')
  })

  it('does not spend the clock while it can see the player', () => {
    const enemy = makeEnemy()
    enterPhase(enemy, 'chase')
    enemy.target.enabled = true
    // Far longer than the give-up window, but visible throughout.
    run(enemy, context({ player: { x: 0, y: 1.05, z: -8 } }), LOSE_INTEREST_SECONDS * 3)
    expect(enemy.phase).not.toBe('idle')
  })

  it('a fresh chase gets a full clock, not whatever was left from the last one', () => {
    const enemy = makeEnemy()
    enterPhase(enemy, 'chase')
    enemy.target.enabled = true
    run(enemy, context({ visible: false }), LOSE_INTEREST_SECONDS - 0.2)
    // Staggered mid-chase, then recovers back into chase — should not inherit the near-expired
    // clock from before the stagger.
    enterPhase(enemy, 'stagger')
    run(enemy, context({ visible: false }), ENEMIES['skeleton-warrior'].staggerSeconds + STEP)
    expect(enemy.phase).toBe('chase')
    run(enemy, context({ visible: false }), 0.5)
    expect(enemy.phase).toBe('chase')
  })
})

describe('the attack', () => {
  it('winds up before it hits, every time', () => {
    // The window in which the player can still do something about being hit. Without it,
    // damage arrives with no preceding information, which is the reason people take the
    // headset off.
    const enemy = makeEnemy('skeleton-warrior', { x: 0, z: 0 })
    enterPhase(enemy, 'chase')
    enemy.target.enabled = true

    const ctx = context({ player: { x: 0, y: 1.05, z: -1.5 } })
    const early = run(enemy, ctx, ENEMIES['skeleton-warrior'].telegraph * 0.9)
    expect(early.strikes).toBe(0)
    expect(enemy.phase).toBe('telegraph')

    const late = run(enemy, ctx, ENEMIES['skeleton-warrior'].telegraph)
    expect(late.strikes).toBe(1)
  })

  it('does not move while it winds up, so stepping back works', () => {
    const enemy = makeEnemy('skeleton-warrior', { x: 0, z: 0 })
    enterPhase(enemy, 'telegraph')
    enemy.target.enabled = true
    const before = { ...enemy.position }
    run(enemy, context({ player: { x: 0, y: 1.05, z: -1.5 } }), ENEMIES['skeleton-warrior'].telegraph * 0.8)
    expect(enemy.position.x).toBeCloseTo(before.x, 6)
    expect(enemy.position.z).toBeCloseTo(before.z, 6)
  })

  it('misses a player who stepped out of reach during the wind-up', () => {
    const definition = ENEMIES['skeleton-warrior']
    const enemy = makeEnemy('skeleton-warrior', { x: 0, z: 0 })
    enterPhase(enemy, 'telegraph')
    enemy.target.enabled = true

    // Out of range by more than the hysteresis allows, by the time the blow lands.
    const away = context({
      player: { x: 0, y: 1.05, z: -(definition.attackRange + RANGE_HYSTERESIS + 0.5) },
    })
    const result = run(enemy, away, definition.telegraph + STEP * 2)
    expect(result.strikes).toBe(0)
    expect(enemy.phase).toBe('recover')
  })

  it('lands exactly one blow per swing', () => {
    const definition = ENEMIES['goblin-skulker']
    const enemy = makeEnemy('goblin-skulker', { x: 0, z: 0 })
    enterPhase(enemy, 'chase')
    enemy.target.enabled = true

    // Long enough for several full cycles.
    const cycle = definition.telegraph + definition.recover
    const ctx = context({ player: { x: 0, y: 1.05, z: -1.0 } })
    const result = run(enemy, ctx, cycle * 3)
    expect(result.strikes).toBeGreaterThanOrEqual(2)
    expect(result.strikes).toBeLessThanOrEqual(4)
  })

  it('cannot hit a player who is already dead', () => {
    const enemy = makeEnemy('skeleton-warrior', { x: 0, z: 0 })
    enterPhase(enemy, 'telegraph')
    enemy.target.enabled = true
    const ctx = context({ player: { x: 0, y: 1.05, z: -1.5 }, playerAlive: false })
    expect(run(enemy, ctx, 2).strikes).toBe(0)
  })

  it('backs off after striking, if that is its character', () => {
    // The Skulker is dangerous in a pack rather than alone, and this is the whole of why.
    const skulker = makeEnemy('goblin-skulker', { x: 0, z: 0 })
    enterPhase(skulker, 'recover')
    skulker.target.enabled = true
    run(skulker, context({ player: { x: 0, y: 1.05, z: -1.4 } }), 0.4)
    expect(skulker.position.z).toBeGreaterThan(0.1)
  })

  it('stands its ground during recovery, if that is its character', () => {
    const skeleton = makeEnemy('skeleton-warrior', { x: 0, z: 0 })
    enterPhase(skeleton, 'recover')
    skeleton.target.enabled = true
    run(skeleton, context({ player: { x: 0, y: 1.05, z: -1.4 } }), 0.4)
    expect(skeleton.position.z).toBeCloseTo(0, 6)
  })

  it('will not swing at a player it cannot see', () => {
    const enemy = makeEnemy('skeleton-warrior', { x: 0, z: 0 })
    enterPhase(enemy, 'chase')
    enemy.target.enabled = true
    const ctx = context({ player: { x: 0, y: 1.05, z: -1.2 }, visible: false })
    expect(run(enemy, ctx, 2).strikes).toBe(0)
    expect(enemy.phase).toBe('chase')
  })
})

describe('stagger', () => {
  it('interrupts a wind-up when the hit was hard enough', () => {
    // The payoff for a heavy weapon, and what turns the telegraph from a countdown into an
    // opening.
    const definition = ENEMIES['goblin-skulker']
    const enemy = makeEnemy('goblin-skulker', { x: 0, z: 0 })
    enterPhase(enemy, 'telegraph')
    enemy.target.enabled = true

    expect(staggerEnemy(enemy, definition, definition.staggerThreshold)).toBe(true)
    expect(enemy.phase).toBe('stagger')

    const result = run(enemy, context({ player: { x: 0, y: 1.05, z: -1.2 } }), definition.staggerSeconds + STEP)
    expect(result.strikes).toBe(0)
  })

  it('ignores a hit that was not hard enough', () => {
    const definition = ENEMIES['skeleton-warrior']
    const enemy = makeEnemy('skeleton-warrior')
    enterPhase(enemy, 'telegraph')
    expect(staggerEnemy(enemy, definition, definition.staggerThreshold - 1)).toBe(false)
    expect(enemy.phase).toBe('telegraph')
  })

  it('takes a heavier hit to stagger a heavier thing', () => {
    expect(ENEMIES['skeleton-warrior'].staggerThreshold).toBeGreaterThan(
      ENEMIES['goblin-skulker'].staggerThreshold,
    )
  })

  it('cannot stagger a corpse', () => {
    const enemy = makeEnemy()
    killEnemy(enemy)
    expect(staggerEnemy(enemy, ENEMIES['skeleton-warrior'], 1000)).toBe(false)
    expect(enemy.phase).toBe('dying')
  })

  it('gets back to chasing on its own', () => {
    const definition = ENEMIES['skeleton-warrior']
    const enemy = makeEnemy()
    enemy.target.enabled = true
    enterPhase(enemy, 'stagger')
    run(enemy, context(), definition.staggerSeconds + STEP)
    expect(enemy.phase).toBe('chase')
  })
})

describe('death', () => {
  it('stops being hittable and stops hitting', () => {
    const enemy = makeEnemy('skeleton-warrior', { x: 0, z: 0 })
    enterPhase(enemy, 'telegraph')
    enemy.target.enabled = true
    killEnemy(enemy)

    expect(enemy.target.enabled).toBe(false)
    const result = run(enemy, context({ player: { x: 0, y: 1.05, z: -1.2 } }), 3)
    expect(result.strikes).toBe(0)
  })

  it('dies from a status tick without anything else having to notice', () => {
    // A burn taking the last point of health between two of the driver's own calls. Without
    // this check the corpse would keep walking.
    const enemy = makeEnemy()
    enemy.target.enabled = true
    enterPhase(enemy, 'chase')
    enemy.target.hp = 0
    stepEnemyAi(enemy, context(), STEP)
    expect(enemy.phase).toBe('dying')
  })

  it('lies there for a moment, then asks to be recycled', () => {
    // Something that vanishes on the frame it dies gives the player no confirmation they
    // killed it, and in a dark corridor "it died" and "it went somewhere" are different
    // feelings entirely.
    const enemy = makeEnemy()
    killEnemy(enemy)
    let expired = false
    for (let t = 0; t < CORPSE_SECONDS * 0.9; t += STEP) {
      expired ||= stepEnemyAi(enemy, context(), STEP).expired
    }
    expect(expired).toBe(false)
    for (let t = 0; t < CORPSE_SECONDS; t += STEP) {
      expired ||= stepEnemyAi(enemy, context(), STEP).expired
    }
    expect(expired).toBe(true)
  })

  it('does not count towards the wave while it is a corpse', () => {
    // Or a wave stays unfinished for the second and a half its last skeleton spends falling
    // over, and ends on a shrug.
    const pool = createEnemyPool(4)
    const enemy = spawnEnemy(pool, 'goblin-skulker', { x: 0, z: 0 })!
    expect(livingEnemies(pool)).toBe(1)
    killEnemy(enemy)
    expect(livingEnemies(pool)).toBe(0)
  })
})

describe('the pool', () => {
  it('refuses rather than stealing the slot of a live enemy', () => {
    // Unlike a projectile: recycling the oldest would delete something the player is fighting,
    // which is far worse than the director waiting two seconds for room.
    const pool = createEnemyPool(2)
    expect(spawnEnemy(pool, 'goblin-skulker', { x: 0, z: 0 })).not.toBeNull()
    expect(spawnEnemy(pool, 'goblin-skulker', { x: 1, z: 0 })).not.toBeNull()
    expect(spawnEnemy(pool, 'goblin-skulker', { x: 2, z: 0 })).toBeNull()
  })

  it('hands a recycled slot back clean', () => {
    const pool = createEnemyPool(1)
    const first = spawnEnemy(pool, 'wraith', { x: 3, z: 3 })!
    applyStatus(first.target.statuses, 'burning')
    first.target.hp = 1
    first.alerted = true
    killEnemy(first)
    first.active = false

    const second = spawnEnemy(pool, 'goblin-skulker', { x: 0, z: 0 })!
    expect(second.target.statuses).toEqual([])
    expect(second.target.hp).toBe(ENEMIES['goblin-skulker'].hp)
    expect(second.target.resistances).toBe(ENEMIES['goblin-skulker'].resistances)
    expect(second.alerted).toBe(false)
    expect(second.phase).toBe('spawning')
    expect(second.counted).toBe(false)
  })

  it('puts the hit sphere at chest height, not on the floor', () => {
    // A bolt aimed at "the skeleton" has to arrive somewhere the player was aiming.
    const enemy = makeEnemy('skeleton-warrior', { x: 2, z: -3 })
    expect(enemy.position.y).toBe(ENEMIES['skeleton-warrior'].centre)
    expect(enemy.position.y).toBeGreaterThan(0.5)
  })

  it('shares one position between the enemy and its registry entry', () => {
    // Two answers to "where is this thing" is the sort of question that quietly grows a
    // second one. A projectile in flight holds an id and reads the registry.
    const enemy = makeEnemy()
    enemy.position.x = 12
    expect(enemy.target.position.x).toBe(12)
  })
})
