/**
 * The live enemy state: what is in the world, and what the wave is doing.
 *
 * Its own module rather than living in `EnemyDriver.tsx`, for the same reason `combat/state.ts`
 * exists: the driver is not the only reader. The renderer walks the pool every frame, the
 * status board wants the wave's progress, and the debug handle reports all of it — and hanging
 * that state off the component that happens to write it makes every reader import a React
 * component.
 *
 * Module singletons with stable identities, mutated in place. Nothing here re-renders anything.
 */

import { ENEMIES } from '@/data/enemies'
import { createEnemyPool, livingEnemies } from '@/systems/enemies/pool'
import { createDirector, directorProgress } from '@/systems/waves'
import { playerVitals } from '@/systems/vitals'

export const enemyPool = createEnemyPool()

export const director = createDirector()

/** What the debug handle and the smoke test read. */
export function enemySnapshot() {
  const progress = directorProgress(director)
  return {
    wave: director.wave,
    total: progress.total,
    killed: progress.killed,
    remaining: progress.remaining,
    queued: director.queue.length,
    living: livingEnemies(enemyPool),
    gold: director.gold,
    cleared: director.cleared,
    hp: Math.round(playerVitals.hp),
    maxHp: playerVitals.max,
    enemies: enemyPool.items
      .filter((enemy) => enemy.active)
      .map((enemy) => ({
        id: enemy.id,
        type: enemy.type,
        phase: enemy.phase,
        hp: Math.round(enemy.target.hp),
        maxHp: enemy.target.maxHp,
        // Where it is and how far it can reach, so the smoke test can put the player in front
        // of one without hard-coding a level it has never seen.
        x: +enemy.position.x.toFixed(3),
        y: +enemy.position.y.toFixed(3),
        z: +enemy.position.z.toFixed(3),
        reach: enemy.type ? ENEMIES[enemy.type].attackRange : 0,
        /** How far along its route it is — an enemy stuck on a waypoint shows up here. */
        pathLength: enemy.path.length,
        pathIndex: enemy.pathIndex,
      })),
  }
}
