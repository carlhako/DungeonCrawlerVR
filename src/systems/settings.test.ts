import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, SETTING_LIMITS, sanitiseSettings } from './settings'

/**
 * These settings size the WebXR swapchain. A bad value doesn't degrade the experience, it
 * produces a session that won't start — on a headset, with no console in sight. So a stale
 * or corrupt localStorage entry has to be survivable by construction.
 */

describe('sanitiseSettings', () => {
  it('passes valid settings through', () => {
    const input = { framebufferScale: 0.9, foveation: 0.25 }
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

  it('rejects NaN and Infinity', () => {
    const result = sanitiseSettings({ framebufferScale: Number.NaN, foveation: Infinity })
    expect(result.framebufferScale).toBe(DEFAULT_SETTINGS.framebufferScale)
    expect(result.foveation).toBe(DEFAULT_SETTINGS.foveation)
  })

  it('ignores unknown keys from a future build', () => {
    const result = sanitiseSettings({ foveation: 0.5, turboMode: true })
    expect(Object.keys(result).sort()).toEqual(['foveation', 'framebufferScale'])
  })
})

describe('defaults', () => {
  it('sit inside their own limits', () => {
    for (const key of ['framebufferScale', 'foveation'] as const) {
      expect(DEFAULT_SETTINGS[key]).toBeGreaterThanOrEqual(SETTING_LIMITS[key].min)
      expect(DEFAULT_SETTINGS[key]).toBeLessThanOrEqual(SETTING_LIMITS[key].max)
    }
  })
})
