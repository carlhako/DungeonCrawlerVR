import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  SETTING_LIMITS,
  SETTING_OPTIONS,
  sanitiseSettings,
} from './settings'

/**
 * These settings size the WebXR swapchain and decide how the player moves. A bad value
 * doesn't degrade the experience, it produces a session that won't start or a player who
 * can't walk — on a headset, with no console in sight. So a stale or corrupt localStorage
 * entry has to be survivable by construction.
 */

describe('sanitiseSettings', () => {
  it('passes valid settings through', () => {
    const input = { ...DEFAULT_SETTINGS, framebufferScale: 0.9, foveation: 0.25 }
    expect(sanitiseSettings(input)).toEqual(input)
  })

  it('falls back to defaults for a missing blob', () => {
    expect(sanitiseSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(sanitiseSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(sanitiseSettings({})).toEqual(DEFAULT_SETTINGS)
  })

  it('fills in keys a previous build did not store', () => {
    const result = sanitiseSettings({ foveation: 0.8 })
    expect(result.foveation).toBe(0.8)
    expect(result.framebufferScale).toBe(DEFAULT_SETTINGS.framebufferScale)
  })

  it('clamps values from outside the supported range', () => {
    const high = sanitiseSettings({ framebufferScale: 99, foveation: 12 })
    expect(high.framebufferScale).toBe(SETTING_LIMITS.framebufferScale.max)
    expect(high.foveation).toBe(SETTING_LIMITS.foveation.max)

    const low = sanitiseSettings({ framebufferScale: -5, foveation: -1 })
    expect(low.framebufferScale).toBe(SETTING_LIMITS.framebufferScale.min)
    expect(low.foveation).toBe(SETTING_LIMITS.foveation.min)
  })

  it('rejects non-numeric values rather than passing NaN to WebXR', () => {
    const result = sanitiseSettings({ framebufferScale: 'high', foveation: null })
    expect(result).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps a recognised locomotion or turn mode', () => {
    const result = sanitiseSettings({ locomotion: 'teleport', turn: 'smooth' })
    expect(result.locomotion).toBe('teleport')
    expect(result.turn).toBe('smooth')
  })

  it('falls back when a stored mode no longer exists in this build', () => {
    // The player who can't be left unable to move because a mode was renamed.
    const result = sanitiseSettings({ locomotion: 'teleport-blink', turn: 42 })
    expect(result.locomotion).toBe(DEFAULT_SETTINGS.locomotion)
    expect(result.turn).toBe(DEFAULT_SETTINGS.turn)
  })

  it('rejects NaN and Infinity', () => {
    const result = sanitiseSettings({ framebufferScale: Number.NaN, foveation: Infinity })
    expect(result.framebufferScale).toBe(DEFAULT_SETTINGS.framebufferScale)
    expect(result.foveation).toBe(DEFAULT_SETTINGS.foveation)
  })

  it('ignores unknown keys from a future build', () => {
    const result = sanitiseSettings({ foveation: 0.5, turboMode: true })
    expect(Object.keys(result).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort())
  })
})

describe('defaults', () => {
  it('sit inside their own limits', () => {
    for (const key of Object.keys(SETTING_LIMITS) as Array<keyof typeof SETTING_LIMITS>) {
      expect(DEFAULT_SETTINGS[key]).toBeGreaterThanOrEqual(SETTING_LIMITS[key].min)
      expect(DEFAULT_SETTINGS[key]).toBeLessThanOrEqual(SETTING_LIMITS[key].max)
    }
  })

  it('use a mode that is actually on offer', () => {
    for (const key of Object.keys(SETTING_OPTIONS) as Array<keyof typeof SETTING_OPTIONS>) {
      expect(SETTING_OPTIONS[key]).toContain(DEFAULT_SETTINGS[key])
    }
  })

  it('covers every setting with either a limit or a set of options', () => {
    // The check that stops a setting being added without a validation rule, which is how
    // an unclamped value reaches WebXR in the first place.
    const validated = [...Object.keys(SETTING_LIMITS), ...Object.keys(SETTING_OPTIONS)]
    expect(validated.sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort())
  })
})
