/**
 * The live combat state: what is in each hand, what is in the air, and how much mana is left.
 *
 * Its own module rather than living in `CombatDriver.tsx`, because the driver is not the only
 * thing that needs it — the weapon rigs read the cooldown to dim a wand's tip, the projectile
 * renderer walks the pool, and the debug handle reports all of it. Hanging that state off the
 * component that happens to write it makes every reader import a React component, and the
 * rigs *are* imported by the driver, so it would be a cycle as well.
 *
 * Module singletons with stable identities, mutated in place: the same pattern and the same
 * reasoning as `xrInput` and `playerState`. Nothing here re-renders anything.
 */

import type { Hand } from '@/data/weapons'
import { createProjectilePool } from '@/systems/combat/projectiles'
import { createManaPool } from '@/systems/combat/resources'
import { createHandWeapon } from '@/systems/combat/weapon'

export const projectilePool = createProjectilePool()

/** One pool for the whole player — see `resources.ts` for why it is not one per hand. */
export const manaPool = createManaPool()

export const handWeapons: Record<Hand, ReturnType<typeof createHandWeapon>> = {
  main: createHandWeapon('main'),
  off: createHandWeapon('off'),
}

/** What the debug handle and the smoke test read. */
export function combatSnapshot() {
  return {
    mana: +manaPool.current.toFixed(1),
    manaMax: manaPool.max,
    projectiles: projectilePool.items.filter((item) => item.active).length,
    hands: {
      main: handSnapshot('main'),
      off: handSnapshot('off'),
    },
  }
}

function handSnapshot(slot: Hand) {
  const state = handWeapons[slot]
  return {
    weapon: state.weaponId,
    cooldown: +state.cooldown.remaining.toFixed(3),
    swingSpeed: +state.swing.speed.toFixed(2),
    refusal: state.lastRefusal,
  }
}
