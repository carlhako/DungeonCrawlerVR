/**
 * The stone wall texture, loaded once and cached forever.
 *
 * Same shape as `enemies/models.ts`, for the same reason: the CC0 texture is something Carl
 * drops into `public/textures/` by hand, and the room has to look right — flat stone colour,
 * same as it always has — before he does. A missing file is not an error, it is the expected
 * state of a fresh checkout.
 */

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { RepeatWrapping, SRGBColorSpace, Texture, TextureLoader } from 'three'

export type WallTextureStatus = 'idle' | 'loading' | 'ready' | 'missing'

export interface WallTextureSet {
  map: Texture
  normalMap: Texture
  roughnessMap: Texture
}

/** One tile of the texture covers this many metres of wall — the number the repeat below is tuned to. */
const METRES_PER_TILE = 2

const BASE = '/textures/stone'
const FILES: Record<keyof WallTextureSet, string> = {
  map: `${BASE}-diffuse.jpg`,
  normalMap: `${BASE}-normal.jpg`,
  roughnessMap: `${BASE}-roughness.jpg`,
}

interface State {
  status: WallTextureStatus
  set: WallTextureSet | null
  error: string | null
}

let state: State = { status: 'idle', set: null, error: null }
let started = false
let version = 0
const listeners = new Set<() => void>()

function changed() {
  version += 1
  for (const listener of listeners) listener()
}

/** Kicks off the load. Idempotent — calling it from every component that wants a wall costs nothing. */
export function loadWallTexture(): void {
  if (started) return
  started = true
  state = { status: 'loading', set: null, error: null }
  changed()

  const loader = new TextureLoader()
  const keys = Object.keys(FILES) as Array<keyof WallTextureSet>
  const loaded: Partial<WallTextureSet> = {}
  let remaining = keys.length
  let failed = false

  for (const key of keys) {
    loader.load(
      FILES[key],
      (texture) => {
        if (failed) return
        texture.wrapS = RepeatWrapping
        texture.wrapT = RepeatWrapping
        texture.repeat.set(1 / METRES_PER_TILE, 1 / METRES_PER_TILE)
        // Colour data is sRGB-encoded; normal and roughness maps are not — feeding either
        // through the wrong colour space is a subtle wash-out rather than an obvious break,
        // which is exactly the kind of bug that survives a quick look.
        if (key === 'map') texture.colorSpace = SRGBColorSpace
        loaded[key] = texture
        remaining -= 1
        if (remaining === 0) {
          state = { status: 'ready', set: loaded as WallTextureSet, error: null }
          changed()
        }
      },
      undefined,
      (error) => {
        // Whichever of the three fails first wins — a partial set is worse than none, since a
        // stone wall with a colour map but no roughness map just looks like a plastic one.
        if (failed) return
        failed = true
        const message = error instanceof Error ? error.message : String(error)
        state = { status: 'missing', set: null, error: message }
        console.info(`[environment] no wall texture (${message}) — drawing flat stone.`)
        changed()
      },
    )
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function snapshot(): number {
  return version
}

/** The base set, tiled at one repeat per `METRES_PER_TILE` metres. `null` until it loads or fails. */
export function useWallTexture(): WallTextureSet | null {
  useSyncExternalStore(subscribe, snapshot, snapshot)
  return state.set
}

/**
 * The base maps, cloned and re-tiled for a wall face of a specific size.
 *
 * `BoxGeometry`'s UVs run 0..1 per face regardless of that face's real size, so one shared
 * `repeat` looks right on the wall it was tuned against and stretched on every other size —
 * the foyer's ten-metre back wall would show one giant smear of the same tile that reads
 * correctly on a two-metre dungeon cell. Cloning is cheap: it shares the underlying image and
 * only duplicates the small wrap/repeat state, so a handful of foyer walls is a handful of
 * `Texture` objects, not a handful of texture uploads.
 */
export function useTiledWallMaterial(width: number, height: number): WallTextureSet | null {
  const base = useWallTexture()

  const maps = useMemo(() => {
    if (!base) return null
    const tile = (source: Texture) => {
      const clone = source.clone()
      clone.repeat.set(width / METRES_PER_TILE, height / METRES_PER_TILE)
      clone.needsUpdate = true
      return clone
    }
    return { map: tile(base.map), normalMap: tile(base.normalMap), roughnessMap: tile(base.roughnessMap) }
  }, [base, width, height])

  useEffect(() => {
    return () => {
      if (!maps) return
      maps.map.dispose()
      maps.normalMap.dispose()
      maps.roughnessMap.dispose()
    }
  }, [maps])

  return maps
}

export function wallTextureStatus(): WallTextureStatus {
  return state.status
}

/** Dev-only view of what loaded and what did not. Read by `__DCVR__.textures`. */
export function wallTextureSnapshot(): { status: WallTextureStatus; error: string | null } {
  return { status: state.status, error: state.error }
}

/** Test seam. Drops the cached texture and lets `loadWallTexture` run again. */
export function resetWallTexture(): void {
  state = { status: 'idle', set: null, error: null }
  started = false
  changed()
}
