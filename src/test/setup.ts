import { beforeEach } from 'vitest'

/**
 * A minimal in-memory `localStorage` for the node test environment.
 *
 * The tests run without jsdom — deliberately, since almost everything worth testing here is
 * pure maths and a DOM would only slow it down. But the save and the settings both persist,
 * and "does this actually survive a reload?" is the single most important question about a
 * game whose entire progression is stored in one browser. Without this, zustand's persist
 * middleware quietly no-ops when storage is missing, and a test that appears to prove the
 * save round-trips proves nothing at all.
 *
 * Cleared before every test so no test can depend on another one's leftovers.
 */
class MemoryStorage implements Storage {
  private map = new Map<string, string>()

  get length(): number {
    return this.map.size
  }

  clear(): void {
    this.map.clear()
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.map.delete(key)
  }

  setItem(key: string, value: string): void {
    this.map.set(key, String(value))
  }
}

if (!('localStorage' in globalThis)) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
  })
}

beforeEach(() => {
  globalThis.localStorage.clear()
})
