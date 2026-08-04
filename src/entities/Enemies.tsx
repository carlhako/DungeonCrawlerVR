import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Group } from 'three'
import { ENEMIES } from '@/data/enemies'
import { corpseFraction, CORPSE_SINK } from '@/systems/enemies/appearance'
import { loadEnemyModels } from '@/systems/enemies/models'
import type { Enemy } from '@/systems/enemies/pool'
import { enemyPool } from '@/systems/enemies/state'
import { EnemyShape } from '@/entities/EnemyShape'

/**
 * Enemies, as things you can see.
 *
 * One group per pool slot, mounted once and hidden when the slot is empty. Nothing mounts or
 * unmounts during a wave — the same argument the pools themselves make, and it matters more
 * here: mounting a mesh compiles or looks up a material, and doing that at the moment a skeleton
 * comes round a corner is a hitch exactly when the player is least able to afford it.
 *
 * This file now owns one thing: *where* an enemy is standing. Everything about what it is drawn
 * as — the primitive body, the model out of the CC0 kit, the materials and the animation — is
 * `EnemyShape`, which is the seam Sprint 2.3 promised and Sprint 2.7 made real.
 *
 * **There are no health bars.** Three floating red bars advancing on you down a corridor is a
 * strategy game, not a horror one, and the player already learns what they did from the damage
 * numbers and the hit flash. The training dummies have bars because a dummy exists to be
 * measured against; an enemy exists to be frightening.
 */

export function Enemies() {
  // One fetch per model file, for the whole session, kicked off as soon as anything that can
  // draw an enemy exists. Idempotent, and it does not block: a slot draws its primitive until
  // its model turns up, and a model that never turns up is not an error. See `models.ts`.
  useEffect(() => {
    loadEnemyModels()
  }, [])

  return (
    <>
      {enemyPool.items.map((enemy) => (
        <EnemyBody key={enemy.slot} enemy={enemy} />
      ))}
    </>
  )
}

function EnemyBody({ enemy }: { enemy: Enemy }) {
  const root = useRef<Group>(null)

  useFrame(() => {
    const group = root.current
    if (!group) return

    group.visible = enemy.active
    if (!enemy.active || !enemy.type) return

    const definition = ENEMIES[enemy.type]

    // Feet on the floor. The record's position is the hit sphere's centre, at chest height —
    // one authoritative position, with the drawing hanging off it rather than beside it.
    const sink = corpseFraction(enemy.phase, enemy.timer) * CORPSE_SINK
    group.position.set(
      enemy.position.x,
      enemy.position.y - definition.centre - sink,
      enemy.position.z,
    )
    group.rotation.y = enemy.yaw
  })

  return (
    <group ref={root} visible={false}>
      <EnemyShape enemy={enemy} />
    </group>
  )
}
