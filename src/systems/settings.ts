import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Player settings that survive a reload.
 *
 * Sprint 0.2 seeds this with the two XR render knobs that decide whether the Quest 3 holds
 * 72fps. Locomotion and comfort settings join them in Sprint 0.3, audio buses in 3.2 — the
 * versioned store and its migration path exist now so adding them later is not a rewrite.
 *
 * Deliberately separate from the *game* save (gold, weapons, wave number, Sprint 1.2).
 * Settings describe the machine and the player's comfort; the save describes the run.
 * Wiping one should never wipe the other.
 */

export interface Settings {
  /**
   * WebXR framebuffer scale. 1.0 is the device's native eye-buffer resolution; below 1
   * renders fewer pixels and upscales, above 1 supersamples.
   *
   * Only read when a session starts — changing it mid-session takes effect on the next
   * VR entry, because the swapchain is allocated once per session.
   */
  framebufferScale: number
  /**
   * Fixed foveated rendering, 0 (off, sharp to the edges) to 1 (most aggressive).
   *
   * The periphery is rendered at lower resolution. In a dark dungeon lit by torches there
   * is very little high-frequency detail out there to lose, so this is close to free
   * performance. Unlike framebufferScale this *can* be changed live.
   */
  foveation: number
}

export const DEFAULT_SETTINGS: Settings = {
  framebufferScale: 1.0,
  // Middling by default: a real saving on the Quest's fill rate without the smearing that
  // shows up at the top of the range. Tune on-device against the F1 HUD.
  foveation: 0.5,
}

/** Ranges the UI and the tuning panel clamp to. Outside these, WebXR misbehaves. */
export const SETTING_LIMITS = {
  framebufferScale: { min: 0.6, max: 1.4, step: 0.05 },
  foveation: { min: 0, max: 1, step: 0.05 },
} as const

interface SettingsStore extends Settings {
  set<K extends keyof Settings>(key: K, value: Settings[K]): void
  reset(): void
}

const STORAGE_KEY = 'dcvr.settings'

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      set: (key, value) => set({ [key]: value } as Pick<Settings, typeof key>),
      reset: () => set({ ...DEFAULT_SETTINGS }),
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      // Persist only the data, never the actions.
      partialize: (state): Settings => ({
        framebufferScale: state.framebufferScale,
        foveation: state.foveation,
      }),
      // A stored blob from an older build may be missing keys we've since added, or hold
      // values from a range we've since narrowed. Merge over the defaults and clamp, so a
      // stale localStorage entry can never produce an unrenderable session.
      merge: (persisted, current) => ({
        ...current,
        ...sanitiseSettings(persisted),
      }),
    },
  ),
)

/**
 * Coerce an untrusted settings blob into a valid `Settings`.
 *
 * Exported for the unit tests: this is the function that has to hold when localStorage
 * contains something from a build that no longer exists.
 */
export function sanitiseSettings(input: unknown): Settings {
  const raw = (input ?? {}) as Partial<Record<keyof Settings, unknown>>
  return {
    framebufferScale: clampSetting('framebufferScale', raw.framebufferScale),
    foveation: clampSetting('foveation', raw.foveation),
  }
}

function clampSetting<K extends keyof Settings>(key: K, value: unknown): number {
  const { min, max } = SETTING_LIMITS[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SETTINGS[key]
  return Math.min(max, Math.max(min, value))
}

/**
 * Read settings synchronously, before React mounts.
 *
 * The XR store's framebuffer scale is fixed at store-creation time, so it has to be known
 * earlier than any hook can tell us. Falls back to defaults if storage is unavailable
 * (private browsing, or a browser with storage disabled) rather than throwing.
 */
export function readStoredSettings(): Settings {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as { state?: unknown }
    return sanitiseSettings(parsed.state)
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}
