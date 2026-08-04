import { describe, expect, it } from 'vitest'
import { CORPSE_SECONDS, ENEMIES, ENEMY_IDS, SPAWN_SECONDS } from '@/data/enemies'
import {
  CHASE_RATE_MAX,
  CHASE_RATE_MIN,
  clipTimeScale,
  matchClip,
  modelScale,
  planClip,
  selectClip,
  type ClipMapping,
} from '@/systems/enemies/animation'
import type { EnemyPhase } from '@/systems/enemies/pool'

const skeleton = ENEMIES['skeleton-warrior']

const PHASES: EnemyPhase[] = [
  'spawning',
  'idle',
  'chase',
  'telegraph',
  'strike',
  'recover',
  'stagger',
  'dying',
]

describe('matchClip', () => {
  it('takes an exact name first', () => {
    expect(matchClip(['Attack'], ['Idle', 'Attack', 'Death'])).toBe('Attack')
  })

  it('does not care about case', () => {
    expect(matchClip(['Attack'], ['idle', 'attack'])).toBe('attack')
  })

  it('sees through a kit that prefixes its clips with the armature', () => {
    expect(matchClip(['Attack'], ['CharacterArmature|Sword_Attack', 'Armature|Idle'])).toBe(
      'CharacterArmature|Sword_Attack',
    )
  })

  it('sees through punctuation and spacing', () => {
    expect(matchClip(['HitReceive'], ['Hit Receive'])).toBe('Hit Receive')
    expect(matchClip(['Attack_Windup'], ['attack-windup'])).toBe('attack-windup')
  })

  it('prefers an exact hit on a later candidate over a fuzzy hit on an earlier one', () => {
    // "Run" would loosely match "Running", but "Walk" is there exactly and is second-preference.
    expect(matchClip(['Run', 'Walk'], ['Running_Fast', 'Walk'])).toBe('Walk')
  })

  it('returns null rather than guessing when nothing resembles the request', () => {
    expect(matchClip(['Attack'], ['Idle', 'Death'])).toBeNull()
    expect(matchClip([], ['Idle'])).toBeNull()
    expect(matchClip(['Attack'], [])).toBeNull()
  })

  it('does not let an empty candidate match everything', () => {
    expect(matchClip([''], ['Idle'])).toBeNull()
  })
})

describe('selectClip', () => {
  const mapping: ClipMapping = {
    idle: ['Idle'],
    chase: ['Walk'],
    strike: ['Attack'],
    dying: ['Death'],
  }
  const available = ['Idle', 'Walk', 'Attack', 'Death']

  it('takes the phase’s own clip when the kit has one', () => {
    expect(selectClip('chase', mapping, available)).toBe('Walk')
    expect(selectClip('strike', mapping, available)).toBe('Attack')
  })

  it('borrows the strike clip for a wind-up when the kit has no separate one', () => {
    expect(selectClip('telegraph', mapping, available)).toBe('Attack')
  })

  it('falls back to idle for the phases idle can stand in for', () => {
    expect(selectClip('spawning', mapping, available)).toBe('Idle')
    expect(selectClip('recover', mapping, available)).toBe('Idle')
    expect(selectClip('stagger', mapping, available)).toBe('Idle')
  })

  it('leaves a corpse without a clip rather than putting it in an idle loop', () => {
    expect(selectClip('dying', { idle: ['Idle'] }, ['Idle'])).toBeNull()
  })

  it('returns null for every phase when the kit is empty, which is a legitimate answer', () => {
    for (const phase of PHASES) expect(selectClip(phase, {}, [])).toBeNull()
  })
})

describe('clipTimeScale', () => {
  it('fits a wind-up clip to the telegraph window exactly', () => {
    const rate = clipTimeScale('telegraph', skeleton, { speed: 0, duration: 1.6 })
    expect(rate).toBeCloseTo(1.6 / skeleton.telegraph)
    // Which is to say: playing 1.6s of clip at that rate takes exactly the telegraph.
    expect(1.6 / rate).toBeCloseTo(skeleton.telegraph)
  })

  it('fits recovery, stagger, spawning and dying to their own windows', () => {
    expect(2 / clipTimeScale('recover', skeleton, { speed: 0, duration: 2 })).toBeCloseTo(
      skeleton.recover,
    )
    expect(2 / clipTimeScale('stagger', skeleton, { speed: 0, duration: 2 })).toBeCloseTo(
      skeleton.staggerSeconds,
    )
    expect(2 / clipTimeScale('spawning', skeleton, { speed: 0, duration: 2 })).toBeCloseTo(
      SPAWN_SECONDS,
    )
    expect(2 / clipTimeScale('dying', skeleton, { speed: 0, duration: 2 })).toBeCloseTo(
      CORPSE_SECONDS,
    )
  })

  it('leaves a strike at the speed it was authored at', () => {
    expect(clipTimeScale('strike', skeleton, { speed: 0, duration: 0.4 })).toBe(1)
    expect(clipTimeScale('idle', skeleton, { speed: 0, duration: 4 })).toBe(1)
  })

  it('follows actual speed while chasing, so a chilled enemy visibly labours', () => {
    const full = clipTimeScale('chase', skeleton, { speed: skeleton.speed, duration: 1 })
    const half = clipTimeScale('chase', skeleton, { speed: skeleton.speed / 2, duration: 1 })
    expect(full).toBeCloseTo(1)
    expect(half).toBeCloseTo(0.5)
  })

  it('never freezes a chase mid-stride, however slow the enemy gets', () => {
    expect(clipTimeScale('chase', skeleton, { speed: 0, duration: 1 })).toBe(CHASE_RATE_MIN)
    expect(clipTimeScale('chase', skeleton, { speed: 999, duration: 1 })).toBe(CHASE_RATE_MAX)
  })

  it('survives a zero-length clip rather than dividing by it', () => {
    for (const phase of PHASES) {
      const rate = clipTimeScale(phase, skeleton, { speed: 1, duration: 0 })
      expect(Number.isFinite(rate)).toBe(true)
      expect(rate).toBeGreaterThan(0)
    }
  })
})

describe('planClip', () => {
  const available = ['Idle', 'Walk', 'Attack', 'Death']
  const mapping: ClipMapping = {
    idle: ['Idle'],
    chase: ['Walk'],
    strike: ['Attack'],
    dying: ['Death'],
  }

  function plan(phase: EnemyPhase, duration = 1) {
    return planClip(phase, mapping, available, skeleton, { speed: skeleton.speed, duration })
  }

  it('loops the states an enemy can stay in and clamps the ones it passes through', () => {
    expect(plan('idle').loop).toBe(true)
    expect(plan('chase').loop).toBe(true)
    expect(plan('spawning').loop).toBe(true)
    for (const phase of ['telegraph', 'strike', 'recover', 'stagger', 'dying'] as const) {
      expect(plan(phase).loop).toBe(false)
    }
  })

  it('arrives at a strike and a stagger without a blend', () => {
    expect(plan('strike').fade).toBe(0)
    expect(plan('stagger').fade).toBe(0)
    expect(plan('chase').fade).toBeGreaterThan(0)
    expect(plan('telegraph').fade).toBeGreaterThan(0)
  })

  it('reports no clip and a neutral rate when the kit has nothing', () => {
    const empty = planClip('chase', {}, [], skeleton, { speed: 0, duration: 0 })
    expect(empty.clip).toBeNull()
    expect(empty.timeScale).toBe(1)
  })
})

describe('modelScale', () => {
  it('corrects a kit’s own scale to the height the definition was tuned at', () => {
    expect(modelScale(2, 1)).toBeCloseTo(0.5)
    expect(modelScale(1.85, 1.85)).toBeCloseTo(1)
  })

  it('refuses to scale by nonsense', () => {
    expect(modelScale(0, 1.8)).toBe(1)
    expect(modelScale(-1, 1.8)).toBe(1)
    expect(modelScale(1.8, 0)).toBe(1)
    expect(modelScale(Number.NaN, 1.8)).toBe(1)
  })
})

describe('the model specs in the table', () => {
  it('gives every enemy a distinct file and a plausible source height', () => {
    const urls = new Set<string>()
    for (const id of ENEMY_IDS) {
      const spec = ENEMIES[id].model
      expect(spec, `${id} has no model spec`).toBeDefined()
      if (!spec) continue
      expect(spec.url.startsWith('/models/')).toBe(true)
      expect(urls.has(spec.url)).toBe(false)
      urls.add(spec.url)
      expect(spec.sourceHeight).toBeGreaterThan(0)
    }
  })

  it('names a clip for every state the player has to be able to read', () => {
    for (const id of ENEMY_IDS) {
      const clips = ENEMIES[id].model?.clips ?? {}
      for (const phase of ['idle', 'chase', 'telegraph', 'strike', 'stagger', 'dying'] as const) {
        expect(clips[phase]?.length, `${id} names no ${phase} clip`).toBeGreaterThan(0)
      }
    }
  })

  it('resolves every phase to something when a kit ships the usual four clips', () => {
    // The minimum a Quaternius character ships with. Nothing may be left without a plan.
    const usual = ['Idle', 'Walk', 'Attack', 'Death']
    for (const id of ENEMY_IDS) {
      const clips = ENEMIES[id].model?.clips ?? {}
      for (const phase of PHASES) {
        if (phase === 'dying') continue
        expect(selectClip(phase, clips, usual), `${id} ${phase}`).not.toBeNull()
      }
      expect(selectClip('dying', clips, usual)).toBe('Death')
    }
  })
})
