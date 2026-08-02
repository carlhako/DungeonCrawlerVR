/**
 * The persisted game state, as a store.
 *
 * Deliberately thin. Every rule about what a transaction is allowed to do lives in the pure
 * functions in `save.ts`; this file's whole job is to hold the current `SaveData`, hand
 * changes to those functions, and write the result to `localStorage`. If a decision is being
 * made here rather than there, it is in the wrong file and cannot be tested without a
 * browser.
 *
 * One `save` object rather than gold/weapons/equipped as separate slices, because they are
 * written together and must persist together — a purchase that deducted gold but failed to
 * store the weapon is exactly the failure this shape makes impossible.
 */

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Hand, UpgradeAxis, WeaponId } from '@/data/weapons'
import {
  SAVE_STORAGE_KEY,
  SAVE_VERSION,
  addGold,
  buyUpgrade,
  buyWeapon,
  completeWave,
  equipWeapon,
  migrateSave,
  newSave,
  sanitiseSave,
  type SaveData,
  type SaveFailure,
} from '@/systems/save'

/** What a transaction tells its caller. The shop panel in Sprint 1.3 shows `reason`. */
export interface TransactionResult {
  ok: boolean
  reason?: SaveFailure
  spent?: number
}

interface GameStore {
  save: SaveData
  buyWeapon(id: WeaponId): TransactionResult
  buyUpgrade(id: WeaponId, axis: UpgradeAxis): TransactionResult
  equip(hand: Hand, id: WeaponId | null): TransactionResult
  /** Pay out and advance the wave counter. Called by the run machine on a clear. */
  clearWave(reward: number): void
  /** Loot, bounties, anything that hands the player gold outside a wave clear. */
  earnGold(amount: number): void
  /** Wipe progression back to a first launch. Settings are untouched. */
  resetSave(): void
}

export const useGame = create<GameStore>()(
  persist(
    (set, get) => ({
      save: newSave(),

      buyWeapon: (id) => apply(set, buyWeapon(get().save, id)),
      buyUpgrade: (id, axis) => apply(set, buyUpgrade(get().save, id, axis)),
      equip: (hand, id) => apply(set, equipWeapon(get().save, hand, id)),

      clearWave: (reward) => set({ save: completeWave(get().save, reward) }),
      earnGold: (amount) =>
        set({ save: { ...get().save, gold: addGold(get().save.gold, amount) } }),

      resetSave: () => set({ save: newSave() }),
    }),
    {
      name: SAVE_STORAGE_KEY,
      version: SAVE_VERSION,
      // Stated explicitly rather than taking the default, which reaches through `window`.
      // That is fine in a browser and undefined in the test environment — where persist
      // silently disables itself and every "the save survives a reload" test passes while
      // proving nothing. This is the one store whose persistence has to be *tested*.
      storage: createJSONStorage(() => globalThis.localStorage),
      // Data only, never the actions.
      partialize: (state) => ({ save: state.save }),
      migrate: (persisted, version) =>
        ({ save: migrateSave((persisted as { save?: unknown })?.save, version) }) as never,
      // A stored save from an older build may be missing fields we've since added, or hold
      // a weapon id that no longer exists. Sanitise on the way in so a stale localStorage
      // entry can never produce a game that won't start.
      // `merge` runs even on a first launch, with nothing stored. Sanitising `undefined`
      // there would hand a brand-new player a zeroed save instead of their 100 gold.
      merge: (persisted, current) =>
        persisted == null
          ? current
          : { ...current, save: sanitiseSave((persisted as { save?: unknown }).save) },
    },
  ),
)

type SetState = (partial: Partial<GameStore>) => void

function apply(
  set: SetState,
  result: ReturnType<typeof buyWeapon>,
): TransactionResult {
  if (!result.ok) return { ok: false, reason: result.reason }
  set({ save: result.save })
  return { ok: true, spent: result.spent }
}
