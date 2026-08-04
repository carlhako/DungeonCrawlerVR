import { describe, expect, it } from 'vitest'
import { CORPSE_SECONDS, ENEMIES, SPAWN_SECONDS } from '@/data/enemies'
import {
  CORPSE_SINK,
  TELEGRAPH_LEAN,
  corpseFraction,
  createAppearance,
  resolveAppearance,
  type AppearanceInput,
} from '@/systems/enemies/appearance'

const skeleton = ENEMIES['skeleton-warrior']

function input(overrides: Partial<AppearanceInput> = {}): AppearanceInput {
  return {
    phase: 'chase',
    timer: 0,
    flash: 0,
    burning: false,
    chilled: false,
    speed: 1.5,
    seed: 0,
    ...overrides,
  }
}

function resolve(overrides: Partial<AppearanceInput> = {}, elapsed = 0) {
  return resolveAppearance(createAppearance(), input(overrides), skeleton, elapsed)
}

describe('resolveAppearance', () => {
  it('writes into the record it is given rather than allocating', () => {
    const out = createAppearance()
    expect(resolveAppearance(out, input(), skeleton, 0)).toBe(out)
  })

  it('leaves an ordinary enemy solid, present and upright', () => {
    const a = resolve()
    expect(a.dissolve).toBe(0)
    expect(a.presence).toBe(1)
    expect(a.sink).toBe(0)
    expect(a.lean).toBe(0)
    expect(a.wind).toBe(0)
  })

  it('materialises an arriving enemy in rather than popping it into existence', () => {
    const early = resolve({ phase: 'spawning', timer: 0 })
    const late = resolve({ phase: 'spawning', timer: SPAWN_SECONDS })
    expect(early.presence).toBe(0)
    expect(early.dissolve).toBeGreaterThan(0)
    expect(late.presence).toBe(1)
    expect(late.dissolve).toBe(0)
  })

  it('rears back furthest at the moment the wind-up commits', () => {
    const start = resolve({ phase: 'telegraph', timer: 0 })
    const mid = resolve({ phase: 'telegraph', timer: skeleton.telegraph / 2 })
    const commit = resolve({ phase: 'telegraph', timer: skeleton.telegraph })
    expect(start.lean).toBeCloseTo(0)
    expect(mid.lean).toBeGreaterThan(start.lean)
    expect(commit.lean).toBeCloseTo(TELEGRAPH_LEAN)
    expect(commit.wind).toBe(1)
  })

  it('does not keep leaning further back past the end of the wind-up', () => {
    const over = resolve({ phase: 'telegraph', timer: skeleton.telegraph * 4 })
    expect(over.wind).toBe(1)
    expect(over.lean).toBeCloseTo(TELEGRAPH_LEAN)
  })

  it('flares the eyes and swells the halo through the wind-up', () => {
    const idle = resolve({ phase: 'chase' })
    const commit = resolve({ phase: 'telegraph', timer: skeleton.telegraph })
    expect(commit.eyeIntensity).toBeGreaterThan(idle.eyeIntensity * 3)
    expect(commit.haloOpacity).toBeGreaterThan(idle.haloOpacity)
  })

  it('throws the body forward on the strike and settles it through recovery', () => {
    const strike = resolve({ phase: 'strike', timer: 0 })
    const later = resolve({ phase: 'recover', timer: 0.1 })
    expect(strike.lean).toBeLessThan(0)
    expect(later.lean).toBeGreaterThan(strike.lean)
  })

  it('flinches on a stagger, so an interrupt is visible', () => {
    expect(resolve({ phase: 'stagger', timer: 0 }).lean).toBeGreaterThan(0)
  })

  it('falls a corpse over and sinks it as it goes', () => {
    const fresh = resolve({ phase: 'dying', timer: 0 })
    const gone = resolve({ phase: 'dying', timer: CORPSE_SECONDS })
    expect(fresh.lean).toBe(0)
    expect(gone.lean).toBeLessThan(-1)
    expect(gone.sink).toBeCloseTo(CORPSE_SINK)
    expect(gone.presence).toBe(0)
  })

  it('holds a fresh corpse together before it starts coming apart', () => {
    expect(resolve({ phase: 'dying', timer: CORPSE_SECONDS * 0.1 }).dissolve).toBe(0)
    expect(resolve({ phase: 'dying', timer: CORPSE_SECONDS * 0.9 }).dissolve).toBeGreaterThan(0)
  })

  it('lets the hit flash beat every other tint', () => {
    const a = resolve({ flash: 0.05, burning: true, chilled: true })
    expect(a.emissive).toBe('#ffffff')
    expect(a.emissiveIntensity).toBeGreaterThan(2.6)
  })

  it('tints for burning and chill, and brightens for both', () => {
    const plain = resolve()
    const burning = resolve({ burning: true })
    const chilled = resolve({ chilled: true })
    expect(burning.emissive).not.toBe(plain.emissive)
    expect(chilled.emissive).not.toBe(plain.emissive)
    expect(burning.emissive).not.toBe(chilled.emissive)
    expect(burning.emissiveIntensity).toBeGreaterThan(plain.emissiveIntensity)
    expect(chilled.emissiveIntensity).toBeGreaterThan(plain.emissiveIntensity)
  })

  it('falls back to the definition colour when nothing is happening to it', () => {
    const a = resolve()
    expect(a.colour).toBe(skeleton.colour)
    expect(a.emissive).toBe(skeleton.colour)
    expect(a.emissiveIntensity).toBeCloseTo(skeleton.glow)
  })

  it('keeps the eye flicker gentle, so it reads as alive rather than as a fault', () => {
    let min = Infinity
    let max = -Infinity
    for (let t = 0; t < 20; t += 0.05) {
      const value = resolve({}, t).eyeIntensity
      min = Math.min(min, value)
      max = Math.max(max, value)
    }
    expect(min / max).toBeGreaterThan(0.75)
  })

  it('keeps a pack out of lockstep', () => {
    expect(resolve({ seed: 0 }, 1).eyeIntensity).not.toBeCloseTo(resolve({ seed: 2 }, 1).eyeIntensity)
  })
})

describe('corpseFraction', () => {
  it('is zero for anything that is not dying', () => {
    for (const phase of ['spawning', 'idle', 'chase', 'telegraph', 'strike', 'recover', 'stagger'] as const) {
      expect(corpseFraction(phase, 99)).toBe(0)
    }
  })

  it('runs 0 to 1 across the corpse time and stops there', () => {
    expect(corpseFraction('dying', 0)).toBe(0)
    expect(corpseFraction('dying', CORPSE_SECONDS / 2)).toBeCloseTo(0.5)
    expect(corpseFraction('dying', CORPSE_SECONDS * 10)).toBe(1)
  })
})
