import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ENEMIES, ENEMY_IDS } from '@/data/enemies'
import {
  enemyModelSnapshot,
  enemyModelStatus,
  enemyModelsVersion,
  getEnemyModel,
  loadEnemyModels,
  resetEnemyModels,
  subscribeEnemyModels,
} from '@/systems/enemies/models'

/**
 * What is tested here is the behaviour that has to hold *before the CC0 pack lands*, which is
 * the state the repository is actually in: no file, no error, no fuss, and the game still runs.
 * Parsing a real GLB is a browser job and belongs in the smoke test.
 */

const modelled = ENEMY_IDS.filter((id) => ENEMIES[id].model)

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  resetEnemyModels()
  vi.spyOn(console, 'info').mockImplementation(() => {})
  fetchMock = vi.fn(async () => new Response(null, { status: 404, statusText: 'Not Found' }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetEnemyModels()
})

async function settle() {
  // Macrotask turns, not microtask drains: reading a `Response` body is a real async read, so
  // counting `await`s in `loadOne` and matching them here is a test that breaks every time the
  // loader gains a step.
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('loadEnemyModels', () => {
  it('asks for every modelled enemy exactly once, however often it is called', async () => {
    loadEnemyModels()
    loadEnemyModels()
    loadEnemyModels()
    await settle()

    expect(fetchMock).toHaveBeenCalledTimes(modelled.length)
    const asked = fetchMock.mock.calls.map((call) => call[0])
    for (const id of modelled) expect(asked).toContain(ENEMIES[id].model?.url)
  })

  it('treats a missing file as "no model", not as a failure', async () => {
    loadEnemyModels()
    await settle()

    for (const id of modelled) {
      expect(enemyModelStatus(id)).toBe('missing')
      expect(getEnemyModel(id)).toBeNull()
    }
  })

  it('says why it is missing, so the reason is not a mystery in the console', async () => {
    loadEnemyModels()
    await settle()

    const snapshot = enemyModelSnapshot()
    for (const id of modelled) {
      const entry = snapshot[id]
      expect(entry).toBeDefined()
      expect(entry?.status).toBe('missing')
      expect(entry?.error).toContain('404')
      expect(entry?.url).toBe(ENEMIES[id].model?.url)
    }
  })

  it('names the mistake when a 200 hands back the SPA instead of a model', async () => {
    // What a dev server and most static hosts actually do with an unknown path: answer the
    // index page, with a 200. Before this was checked, a misspelled filename surfaced as
    // "Unexpected token '<'" from deep inside the glTF parser.
    fetchMock.mockImplementation(
      async () =>
        new Response('<!doctype html><title>app</title>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
    )

    loadEnemyModels()
    await settle()

    for (const entry of Object.values(enemyModelSnapshot())) {
      expect(entry.status).toBe('missing')
      expect(entry.error).toContain('not a GLB')
      expect(entry.error).toContain('text/html')
    }
  })

  it('survives the network throwing rather than returning a status', async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error('offline')
    })

    loadEnemyModels()
    await settle()

    for (const id of modelled) expect(enemyModelStatus(id)).toBe('missing')
    for (const entry of Object.values(enemyModelSnapshot())) {
      expect(entry.error).toContain('offline')
    }
  })

  it('tells the renderer that something changed', async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeEnemyModels(listener)
    const before = enemyModelsVersion()

    loadEnemyModels()
    await settle()

    expect(listener).toHaveBeenCalled()
    expect(enemyModelsVersion()).toBeGreaterThan(before)

    unsubscribe()
    listener.mockClear()
    resetEnemyModels()
    expect(listener).not.toHaveBeenCalled()
  })

  it('reports nothing at all before it is asked to load', () => {
    for (const id of modelled) {
      expect(enemyModelStatus(id)).toBe('idle')
      expect(getEnemyModel(id)).toBeNull()
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
