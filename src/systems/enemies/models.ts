/**
 * The enemy models, loaded once and cached forever.
 *
 * One fetch per file, at startup, ever — not per spawn, not per wave, not per pool slot.
 * Parsing a GLB builds geometry, uploads textures and compiles a material; doing any of that at
 * the moment a skeleton comes round a corner is the hitch that `Enemies.tsx` mounts one group
 * per slot specifically to avoid, and it would land at the exact instant the player can least
 * afford it. Everything downstream clones from the templates here.
 *
 * **A missing file is not an error.** The CC0 pack is something Carl downloads into
 * `public/models/` deliberately, and the game has to be playable before he does — so a 404
 * resolves the entry to `missing` and the slot goes on drawing the primitive it has drawn since
 * Sprint 2.3. That is also the honest behaviour on a bad connection: a player whose GLB failed
 * to fetch gets a capsule, not a dungeon full of invisible enemies.
 *
 * **Loading never blocks a wave.** Nothing here is awaited by the run machine. A model that
 * arrives four seconds into a fight swaps in mid-fight, which is a slightly odd thing to see
 * once and infinitely better than a loading screen in a headset.
 */

import { AnimationClip, Box3, Group } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { ENEMIES, ENEMY_IDS, type EnemyId, type EnemyModelSpec } from '@/data/enemies'

export type ModelStatus = 'idle' | 'loading' | 'ready' | 'missing'

export interface LoadedEnemyModel {
  spec: EnemyModelSpec
  /**
   * The template. Never added to a scene — it is the thing clones are taken from, and a
   * template that has been parented somewhere is a template somebody has moved.
   */
  template: Group
  clips: AnimationClip[]
  /** Clip names, for `selectClip`. Kept flat because that is all the matcher wants. */
  clipNames: string[]
  /**
   * The template's own bind-pose bounds, measured once at load rather than trusted from
   * `spec.sourceHeight`. `buildInstance` (`EnemyShape.tsx`) scales by this instead, so the
   * drawn model is the height the definition claims even when the declared `sourceHeight` is
   * wrong — which the shipped kit's own numbers are.
   */
  measuredHeight: number
  measuredMinY: number
}

interface Entry {
  status: ModelStatus
  model: LoadedEnemyModel | null
  /** Why it is missing, for the console and the debug handle. Null while it is fine. */
  error: string | null
}

const entries = new Map<EnemyId, Entry>()
const listeners = new Set<() => void>()

/**
 * Bumped whenever any entry changes state.
 *
 * The renderer subscribes to this rather than to a promise, because a pool slot outlives every
 * individual load and there is no component whose lifetime matches "the models arrived".
 */
let version = 0

let started = false

function entryFor(id: EnemyId): Entry {
  let entry = entries.get(id)
  if (!entry) {
    entry = { status: 'idle', model: null, error: null }
    entries.set(id, entry)
  }
  return entry
}

function changed() {
  version += 1
  for (const listener of listeners) listener()
}

/**
 * Kicks off every load. Idempotent — calling it twice does not fetch twice.
 *
 * Called from the renderer's mount rather than from module scope, so importing this file in a
 * test or a tool does not reach for the network.
 */
export function loadEnemyModels(): void {
  if (started) return
  started = true

  for (const id of ENEMY_IDS) {
    const spec = ENEMIES[id].model
    if (!spec) continue
    void loadOne(id, spec)
  }
}

async function loadOne(id: EnemyId, spec: EnemyModelSpec): Promise<void> {
  const entry = entryFor(id)
  entry.status = 'loading'
  changed()

  try {
    // Fetched by hand rather than handed to GLTFLoader's own loader, so that "the file is not
    // there" is a value we branch on instead of an exception the loader logs on our behalf.
    const response = await fetch(spec.url)
    if (!response.ok) {
      fail(entry, id, `${response.status} ${response.statusText}`)
      return
    }

    const buffer = await response.arrayBuffer()
    if (!isGlb(buffer)) {
      // The common case, and it used to report itself as a JSON syntax error. A dev server —
      // and most static hosts — answer an unknown path with the SPA's `index.html` and a **200**,
      // so a misspelled filename arrives here looking like a perfectly successful fetch of a
      // web page. Checking the magic number is what turns "Unexpected token '<'" into the
      // sentence that names the actual mistake.
      fail(entry, id, `not a GLB — the server answered with ${describe(response)}. Wrong filename?`)
      return
    }

    const gltf = await new GLTFLoader().parseAsync(buffer, '')

    const template = gltf.scene as Group
    // A template is a source of clones and is never drawn itself. Frustum culling on a hidden
    // template is meaningless, and matrix auto-update on it is work nobody sees.
    template.updateMatrixWorld(true)

    // Bind-pose bounds. Good enough to correct a wrong `sourceHeight` — the alternative is
    // trusting a number nobody here measured against the actual file.
    const bounds = new Box3().setFromObject(template)
    const measuredHeight = bounds.max.y - bounds.min.y

    entry.model = {
      spec,
      template,
      clips: gltf.animations,
      clipNames: gltf.animations.map((clip) => clip.name),
      measuredHeight: Number.isFinite(measuredHeight) && measuredHeight > 0 ? measuredHeight : spec.sourceHeight,
      measuredMinY: Number.isFinite(bounds.min.y) ? bounds.min.y : 0,
    }
    entry.status = 'ready'
    entry.error = null
    changed()
  } catch (error) {
    fail(entry, id, error instanceof Error ? error.message : String(error))
  }
}

/** `glTF` in ASCII, little-endian — the first four bytes of every binary glTF file. */
const GLB_MAGIC = 0x46546c67

function isGlb(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 12) return false
  return new DataView(buffer).getUint32(0, true) === GLB_MAGIC
}

function describe(response: Response): string {
  const type = response.headers.get('content-type')
  return type ? type.split(';')[0] ?? type : 'an unknown content type'
}

function fail(entry: Entry, id: EnemyId, reason: string) {
  entry.status = 'missing'
  entry.model = null
  entry.error = reason
  // Once, at info level. Not a warning: before the pack lands this is the expected state of the
  // world, and a console full of red every session trains everyone to ignore it.
  console.info(`[enemies] no model for ${id} (${reason}) — drawing primitives.`)
  changed()
}

export function getEnemyModel(id: EnemyId): LoadedEnemyModel | null {
  return entries.get(id)?.model ?? null
}

export function enemyModelStatus(id: EnemyId): ModelStatus {
  return entries.get(id)?.status ?? 'idle'
}

export function subscribeEnemyModels(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function enemyModelsVersion(): number {
  return version
}

/**
 * A fresh, independently-posed copy of a model.
 *
 * `SkeletonUtils.clone` rather than `Object3D.clone`, because a skinned mesh's bones are a
 * separate hierarchy that the plain clone leaves pointing at the original's skeleton — ten
 * enemies would then share one pose and move as one animal. Geometry and textures are still
 * shared, which is the point: the per-clone cost is a skeleton, not a model.
 *
 * Materials are shared by the clone too, and the caller **must** replace them — the hit flash,
 * the burn tint and the dissolve are all per-enemy writes onto a material. See `EnemyShape`.
 */
export function cloneEnemyModel(id: EnemyId): Group | null {
  const model = getEnemyModel(id)
  if (!model) return null
  return cloneSkinned(model.template) as Group
}

/** Dev-only view of what loaded and what did not. Read by `__DCVR__.models`. */
export function enemyModelSnapshot(): Record<
  string,
  { status: ModelStatus; url: string; clips: string[]; error: string | null }
> {
  const out: Record<
    string,
    { status: ModelStatus; url: string; clips: string[]; error: string | null }
  > = {}
  for (const id of ENEMY_IDS) {
    const spec = ENEMIES[id].model
    if (!spec) continue
    const entry = entries.get(id)
    out[id] = {
      status: entry?.status ?? 'idle',
      url: spec.url,
      clips: entry?.model?.clipNames ?? [],
      error: entry?.error ?? null,
    }
  }
  return out
}

/** Test seam. Drops every cached model and lets `loadEnemyModels` run again. */
export function resetEnemyModels(): void {
  entries.clear()
  started = false
  changed()
}
