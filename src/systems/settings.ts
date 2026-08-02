import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Player settings that survive a reload.
 *
 * Sprint 0.2 seeded this with the two XR render knobs that decide whether the Quest 3 holds
 * 72fps; Sprint 0.3 adds locomotion and comfort. Audio buses join in 3.2.
 *
 * Deliberately separate from the *game* save (gold, weapons, wave number, Sprint 1.2).
 * Settings describe the machine and the player's comfort; the save describes the run.
 * Wiping one should never wipe the other.
 *
 * The comfort settings in particular are not cosmetic. A player who cannot tolerate smooth
 * locomotion cannot play the game at all, so these have to survive a reload and be
 * reachable before the first wave — not buried behind a menu they reach after being made
 * ill once.
 */

/** How the player moves through the world in VR. */
export type LocomotionMode = 'smooth' | 'teleport'

/** How the player turns in VR. Desktop always uses the mouse. */
export type TurnMode = 'snap' | 'smooth'

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

  locomotion: LocomotionMode
  turn: TurnMode
  /** Degrees per snap turn. */
  snapTurnDegrees: number
  /** Degrees per second while smooth-turning. */
  smoothTurnSpeed: number
  /** Walking speed in metres per second. Sprint multiplies it. */
  moveSpeed: number
  /**
   * How hard the comfort vignette closes in while the player is being moved by something
   * other than their own legs. 0 disables it.
   */
  comfortVignette: number
}

export const DEFAULT_SETTINGS: Settings = {
  framebufferScale: 1.0,
  // Middling by default: a real saving on the Quest's fill rate without the smearing that
  // shows up at the top of the range. Tune on-device against the F1 HUD.
  foveation: 0.5,

  // Smooth by default because the combat design assumes you can back away from something
  // while facing it, which teleport cannot express. Teleport is one setting away for
  // players who need it.
  locomotion: 'smooth',
  // Snap by default: it is the single most effective comfort measure in VR, and 30° is the
  // usual sweet spot — large enough to be worth doing, small enough to stay oriented.
  turn: 'snap',
  snapTurnDegrees: 30,
  smoothTurnSpeed: 120,
  // A brisk walk. Faster reads as skating and makes vection much worse.
  moveSpeed: 3,
  comfortVignette: 0.7,
}

/**
 * Ranges the UI and the tuning panel clamp to, for the numeric settings.
 *
 * These are not arbitrary. Outside the render range WebXR misbehaves; outside the movement
 * range the game stops being playable — a 12 m/s walk in VR is not fast, it is nauseating.
 */
export const SETTING_LIMITS = {
  framebufferScale: { min: 0.6, max: 1.4, step: 0.05 },
  foveation: { min: 0, max: 1, step: 0.05 },
  snapTurnDegrees: { min: 15, max: 90, step: 15 },
  smoothTurnSpeed: { min: 45, max: 270, step: 5 },
  moveSpeed: { min: 1.5, max: 5, step: 0.1 },
  comfortVignette: { min: 0, max: 1, step: 0.05 },
} as const

/** Allowed values for the enumerated settings, in the order a UI should present them. */
export const SETTING_OPTIONS = {
  locomotion: ['smooth', 'teleport'],
  turn: ['snap', 'smooth'],
} as const satisfies Record<string, readonly string[]>

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
      version: 2,
      // Persist only the data, never the actions. Routing it through `sanitiseSettings`
      // means adding a setting is a one-line change here rather than two.
      partialize: (state): Settings => sanitiseSettings(state),
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
    locomotion: pickOption('locomotion', raw.locomotion),
    turn: pickOption('turn', raw.turn),
    snapTurnDegrees: clampSetting('snapTurnDegrees', raw.snapTurnDegrees),
    smoothTurnSpeed: clampSetting('smoothTurnSpeed', raw.smoothTurnSpeed),
    moveSpeed: clampSetting('moveSpeed', raw.moveSpeed),
    comfortVignette: clampSetting('comfortVignette', raw.comfortVignette),
  }
}

type NumericSetting = keyof typeof SETTING_LIMITS
type EnumSetting = keyof typeof SETTING_OPTIONS

function clampSetting<K extends NumericSetting>(key: K, value: unknown): number {
  const { min, max } = SETTING_LIMITS[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SETTINGS[key]
  return Math.min(max, Math.max(min, value))
}

/**
 * An enumerated setting from an older build may hold a mode this build no longer has —
 * a `'teleport-blink'` that was tried and dropped, say. Anything unrecognised falls back
 * to the default rather than leaving the player unable to move.
 */
function pickOption<K extends EnumSetting>(key: K, value: unknown): Settings[K] {
  const options = SETTING_OPTIONS[key] as readonly string[]
  return options.includes(value as string) ? (value as Settings[K]) : DEFAULT_SETTINGS[key]
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
