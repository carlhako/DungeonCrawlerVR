/**
 * Every spark, ember and ash fleck in the game, as one pooled array of numbers.
 *
 * The same argument the projectile pool makes, only more so: a burst is a dozen particles, a
 * wave is a few hundred bursts, and allocating an object per fleck would drop a few thousand
 * short-lived allocations on a mobile GC during the exact seconds the player is fighting
 * hardest. Nothing here allocates after startup — `spawnBurst` writes into slots that already
 * exist, and a full pool recycles the oldest rather than growing.
 *
 * Pure, and free of three.js: a particle is a position, a velocity, an age and a colour. The
 * renderer (`src/entities/Particles.tsx`) walks the same array and does nothing but draw it,
 * which is what makes "does a kill actually emit a burst" a question a unit test can answer.
 *
 * Randomness is injected rather than reached for. `spawnBurst` takes an `rng` so a test can
 * hand it a deterministic sequence and assert the *shape* of a burst — how fast, how wide a
 * cone, how long it lives — rather than asserting that something roughly happened.
 */

import type { Vec3 } from '@/systems/locomotion'

/**
 * How many particles can exist at once.
 *
 * Sized against the worst honest case: a pack of five dying inside a second (5 × 26), the
 * trails of a wand held down (about 90 alive at any moment), and a couple of impacts on top.
 * One instanced draw either way, so the cost of the headroom is memory rather than frame time.
 */
export const PARTICLE_CAPACITY = 320

export interface Particle {
  /** Slot index. Stable for the pool's lifetime; the renderer uses it as an instance id. */
  readonly slot: number
  active: boolean
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  /** Seconds since it was spawned. */
  age: number
  /** Seconds it lives for. */
  life: number
  /** Radius in metres at birth. Particles shrink to nothing as they age. */
  size: number
  /** Downward acceleration, m/s². Zero for embers that hang in the air. */
  gravity: number
  /** Fraction of velocity shed per second. Air, roughly. */
  drag: number
  /** Colour, linear 0..1, so the renderer never parses a string on a hot path. */
  r: number
  g: number
  b: number
}

export interface ParticlePool {
  readonly items: Particle[]
  /** Where the next steal starts looking. Kept so recycling is round-robin, not always slot 0. */
  cursor: number
}

export function createParticlePool(capacity = PARTICLE_CAPACITY): ParticlePool {
  return {
    items: Array.from({ length: capacity }, (_, slot) => ({
      slot,
      active: false,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      age: 0,
      life: 0,
      size: 0,
      gravity: 0,
      drag: 0,
      r: 1,
      g: 1,
      b: 1,
    })),
    cursor: 0,
  }
}

export interface ParticleSpec {
  origin: Vec3
  vx: number
  vy: number
  vz: number
  life: number
  size: number
  colour: Rgb
  gravity?: number
  drag?: number
}

export interface Rgb {
  r: number
  g: number
  b: number
}

/**
 * A hex colour as three numbers, so the element table stays the single source of colour.
 *
 * Parsed here rather than by the renderer because the pool stores numbers: `#ff8a3c` is a
 * string comparison and a parse per particle per frame otherwise, and the palette is a table
 * of six entries that never changes.
 */
export function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.replace('#', ''), 16)
  return {
    r: ((value >> 16) & 0xff) / 255,
    g: ((value >> 8) & 0xff) / 255,
    b: (value & 0xff) / 255,
  }
}

/** Write one particle into the pool, stealing the oldest slot if every slot is busy. */
export function spawnParticle(pool: ParticlePool, spec: ParticleSpec): Particle {
  const particle = takeSlot(pool)

  particle.active = true
  particle.x = spec.origin.x
  particle.y = spec.origin.y
  particle.z = spec.origin.z
  particle.vx = spec.vx
  particle.vy = spec.vy
  particle.vz = spec.vz
  particle.age = 0
  particle.life = spec.life
  particle.size = spec.size
  particle.gravity = spec.gravity ?? 0
  particle.drag = spec.drag ?? 0
  particle.r = spec.colour.r
  particle.g = spec.colour.g
  particle.b = spec.colour.b

  return particle
}

function takeSlot(pool: ParticlePool): Particle {
  const count = pool.items.length

  for (let i = 0; i < count; i += 1) {
    const index = (pool.cursor + i) % count
    const candidate = pool.items[index]!
    if (candidate.active) continue
    pool.cursor = (index + 1) % count
    return candidate
  }

  // Everything is busy. Steal at the cursor: whichever slot was reused longest ago, which for
  // particles all born within a second of each other is as good an answer as sorting by age
  // and considerably cheaper. Losing the three-hundredth spark is not a failure worth a sort.
  const stolen = pool.items[pool.cursor]!
  pool.cursor = (pool.cursor + 1) % count
  return stolen
}

export interface BurstSpec {
  origin: Vec3
  /** The direction the burst is thrown along. Normalised here; a zero vector sprays evenly. */
  direction: Vec3
  count: number
  /** Metres per second, sampled uniformly between the two. */
  speedMin: number
  speedMax: number
  /** Seconds, sampled uniformly between the two. */
  lifeMin: number
  lifeMax: number
  size: number
  colour: Rgb
  /**
   * How wide the cone is, 0..1. Zero is a straight line along `direction`; 1 is a full
   * sphere, which is what an impact with no meaningful normal wants.
   */
  spread: number
  gravity?: number
  drag?: number
}

/**
 * Throw `count` particles out of a point.
 *
 * The cone is built by mixing a random unit vector into the burst's direction by `spread`,
 * rather than by sampling an angle and rotating a basis. Same distribution for our purposes,
 * no trigonometry, and no basis to get wrong when the direction happens to point straight up.
 */
export function spawnBurst(pool: ParticlePool, spec: BurstSpec, rng: () => number = Math.random): void {
  const length = Math.hypot(spec.direction.x, spec.direction.y, spec.direction.z)
  const dx = length > 0 ? spec.direction.x / length : 0
  const dy = length > 0 ? spec.direction.y / length : 0
  const dz = length > 0 ? spec.direction.z / length : 0
  const spread = length > 0 ? clamp01(spec.spread) : 1

  for (let i = 0; i < spec.count; i += 1) {
    const scatter = unitVector(rng)
    let vx = dx * (1 - spread) + scatter.x * spread
    let vy = dy * (1 - spread) + scatter.y * spread
    let vz = dz * (1 - spread) + scatter.z * spread

    const magnitude = Math.hypot(vx, vy, vz)
    if (magnitude > 0) {
      const speed = spec.speedMin + (spec.speedMax - spec.speedMin) * rng()
      vx = (vx / magnitude) * speed
      vy = (vy / magnitude) * speed
      vz = (vz / magnitude) * speed
    }

    spawnParticle(pool, {
      origin: spec.origin,
      vx,
      vy,
      vz,
      life: spec.lifeMin + (spec.lifeMax - spec.lifeMin) * rng(),
      size: spec.size,
      colour: spec.colour,
      gravity: spec.gravity,
      drag: spec.drag,
    })
  }
}

/** A point on the unit sphere. Rejection-free: two angles, which is cheap enough here. */
function unitVector(rng: () => number): Vec3 {
  const z = rng() * 2 - 1
  const angle = rng() * Math.PI * 2
  const radius = Math.sqrt(Math.max(0, 1 - z * z))
  return { x: Math.cos(angle) * radius, y: z, z: Math.sin(angle) * radius }
}

/** Age every live particle by one fixed step and retire the ones that are done. */
export function stepParticles(pool: ParticlePool, dt: number): void {
  for (const particle of pool.items) {
    if (!particle.active) continue

    particle.age += dt
    if (particle.age >= particle.life) {
      particle.active = false
      continue
    }

    if (particle.drag > 0) {
      const keep = Math.max(0, 1 - particle.drag * dt)
      particle.vx *= keep
      particle.vy *= keep
      particle.vz *= keep
    }

    particle.vy -= particle.gravity * dt

    particle.x += particle.vx * dt
    particle.y += particle.vy * dt
    particle.z += particle.vz * dt
  }
}

/**
 * How large a particle is drawn right now, 0..1 of its birth size.
 *
 * Shrinking rather than fading, because these are drawn additively and unlit: an additive
 * quad fading out passes through every intermediate brightness, which in a dark corridor
 * reads as the spark dimming into a smudge. A spark that shrinks reads as a spark going out.
 */
export function particleScale(particle: Particle): number {
  if (!particle.active || particle.life <= 0) return 0
  const t = clamp01(particle.age / particle.life)
  // A quick flare at birth, then a decay to nothing. `1 - t²` rather than `1 - t` so most of
  // the life is spent at a readable size instead of most of it nearly invisible.
  return (1 - t * t) * particle.size
}

export function clearParticles(pool: ParticlePool): void {
  for (const particle of pool.items) {
    particle.active = false
    particle.age = 0
    particle.life = 0
  }
  pool.cursor = 0
}

export function activeParticles(pool: ParticlePool): number {
  let count = 0
  for (const particle of pool.items) if (particle.active) count += 1
  return count
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
