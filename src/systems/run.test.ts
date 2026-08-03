import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STARTER_WEAPON } from '@/data/weapons'
import { useGame } from './game'
import { newSave, type SaveData } from './save'
import { MINIMUM_REWARD, nextPhase, phaseLabel, useRun, waveReward, type RunPhase } from './run'

/**
 * The run machine, and the wiring between it and the save.
 *
 * The transitions are trivial to read and easy to get wrong in exactly one way: allowing
 * something that shouldn't happen. A wave that starts twice because the door was opened
 * during loading, or a payout that lands twice because "cleared" arrived on two consecutive
 * fixed steps, are both bugs that only show up as gold appearing from nowhere hours later.
 */

const PHASES: RunPhase[] = ['foyer', 'loading', 'wave', 'waveComplete', 'death']

beforeEach(() => {
  useGame.setState({ save: newSave() })
  useRun.setState({ phase: 'foyer', wave: 1, wavesStarted: 0, lastReward: 0 })
  // The machine logs every transition on purpose — it is the acceptance test for this
  // sprint — but not into the test output.
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('nextPhase', () => {
  it('runs the happy path: foyer to wave and back', () => {
    expect(nextPhase('foyer', 'enterDoor')).toBe('loading')
    expect(nextPhase('loading', 'loaded')).toBe('wave')
    expect(nextPhase('wave', 'cleared')).toBe('waveComplete')
    expect(nextPhase('waveComplete', 'return')).toBe('foyer')
  })

  it('routes death back to the foyer', () => {
    expect(nextPhase('wave', 'died')).toBe('death')
    expect(nextPhase('death', 'return')).toBe('foyer')
  })

  it('refuses a second door opening once a run is underway', () => {
    // The door is still there and still interactive while the dungeon loads.
    expect(nextPhase('loading', 'enterDoor')).toBeNull()
    expect(nextPhase('wave', 'enterDoor')).toBeNull()
  })

  it('refuses to clear a wave that has not started', () => {
    expect(nextPhase('foyer', 'cleared')).toBeNull()
    expect(nextPhase('loading', 'cleared')).toBeNull()
  })

  it('refuses to kill a player who is not in a wave', () => {
    expect(nextPhase('foyer', 'died')).toBeNull()
    expect(nextPhase('loading', 'died')).toBeNull()
    expect(nextPhase('waveComplete', 'died')).toBeNull()
  })

  it('never returns a phase outside the set', () => {
    for (const phase of PHASES) {
      for (const event of ['enterDoor', 'loaded', 'cleared', 'died', 'return'] as const) {
        const next = nextPhase(phase, event)
        if (next !== null) expect(PHASES).toContain(next)
      }
    }
  })
})

describe('waveReward', () => {
  it('pays what the player earned', () => {
    // Per kill, from the Wave Director. A flat clear bonus pays the same for fighting through
    // a wave as for hiding in a corridor until the last thing wanders off.
    expect(waveReward(64)).toBe(64)
    expect(waveReward(120)).toBeGreaterThan(waveReward(64))
  })

  it('never pays nothing', () => {
    expect(waveReward(0)).toBe(MINIMUM_REWARD)
    expect(waveReward(0)).toBeGreaterThan(0)
  })
})

describe('phaseLabel', () => {
  it('has a line for every phase', () => {
    for (const phase of PHASES) expect(phaseLabel(phase, 3)).toBeTruthy()
  })
})

describe('the run store', () => {
  it('walks the loop and pays out once', () => {
    const before = useGame.getState().save.gold

    expect(useRun.getState().send('enterDoor')).toBe(true)
    expect(useRun.getState().phase).toBe('loading')
    expect(useRun.getState().wavesStarted).toBe(1)

    useRun.getState().send('loaded')
    useRun.getState().send('cleared', { earned: 42 })

    expect(useRun.getState().phase).toBe('waveComplete')
    expect(useGame.getState().save.gold).toBe(before + waveReward(42))
    expect(useGame.getState().save.wave).toBe(2)
  })

  it('ignores a repeated clear, so the payout cannot land twice', () => {
    useRun.getState().send('enterDoor')
    useRun.getState().send('loaded')
    useRun.getState().send('cleared')
    const paid = useGame.getState().save.gold

    // The stub clear condition is a position check that runs every fixed step, so this is
    // not a hypothetical — it fires repeatedly by construction.
    expect(useRun.getState().send('cleared')).toBe(false)
    expect(useGame.getState().save.gold).toBe(paid)
  })

  it('costs the player nothing when they die', () => {
    useGame.setState({ save: { ...newSave(), gold: 250, wave: 4 } })
    useRun.getState().send('enterDoor')
    useRun.getState().send('loaded')
    useRun.getState().send('died')
    useRun.getState().send('return')

    expect(useRun.getState().phase).toBe('foyer')
    // Pure RPG progression: dying costs the wave, not the run. This is the assertion that
    // stops a future "drop your gold on death" idea landing by accident.
    expect(useGame.getState().save.gold).toBe(250)
    expect(useGame.getState().save.wave).toBe(4)
    expect(useGame.getState().save.weapons[STARTER_WEAPON]).toBeDefined()
  })

  it('takes the wave number from the save when a run starts', () => {
    useGame.setState({ save: { ...newSave(), wave: 7 } })
    useRun.getState().send('enterDoor')
    expect(useRun.getState().wave).toBe(7)
  })

  it('re-reads the wave from the save on reset', () => {
    // What the foyer status board shows before anyone has opened the door. A run counter
    // that starts at 1 regardless would greet a returning player with the wrong wave.
    useGame.setState({ save: { ...newSave(), wave: 5 } })
    useRun.getState().reset()
    expect(useRun.getState().wave).toBe(5)
  })
})

describe('persistence', () => {
  const read = (): unknown => JSON.parse(globalThis.localStorage.getItem('dcvr.save') ?? 'null')

  it('writes the save to storage as it changes', () => {
    useGame.getState().buyWeapon('frostbrand-sword')
    const stored = read() as { state: { save: SaveData } }
    expect(stored.state.save.weapons['frostbrand-sword']).toBeDefined()
    expect(stored.state.save.gold).toBe(useGame.getState().save.gold)
  })

  it('restores gold and owned weapons across a reload', async () => {
    useGame.getState().buyWeapon('frostbrand-sword')
    useGame.getState().buyUpgrade('frostbrand-sword', 'damage')
    useGame.getState().equip('off', 'frostbrand-sword')
    const expected = useGame.getState().save
    const raw = globalThis.localStorage.getItem('dcvr.save')!

    // Simulate the reload: the in-memory state is gone, storage is not.
    useGame.setState({ save: newSave() })
    globalThis.localStorage.setItem('dcvr.save', raw)
    await useGame.persist.rehydrate()

    expect(useGame.getState().save).toEqual(expected)
  })

  it('starts a fresh game rather than crashing on a corrupt save', async () => {
    globalThis.localStorage.setItem('dcvr.save', '{"state":{"save":"not a save"},"version":1}')
    await useGame.persist.rehydrate()
    expect(useGame.getState().save).toEqual(newSave())
  })

  it('does not persist the run phase', async () => {
    useRun.getState().send('enterDoor')
    // A restored mid-wave phase would drop the player into a dungeon that was never
    // generated. Reloading always returns them to the foyer.
    expect(globalThis.localStorage.getItem('dcvr.run')).toBeNull()
    expect(read()).not.toHaveProperty('state.phase')
  })
})
