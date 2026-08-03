import { useLayoutEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three'
import { ELEMENT_COLOUR } from '@/data/elements'
import { PROJECTILE_CAPACITY } from '@/systems/combat/projectiles'
import { projectilePool } from '@/systems/combat/state'

/**
 * Every bolt in the air, as one instanced draw.
 *
 * One mesh for the whole pool, and instances that are scaled to nothing rather than added
 * and removed. Mounting a mesh per projectile would mean a scene-graph change and a draw
 * call per bolt, on the frames when the player is firing fastest — the worst possible moment
 * to spend either, and on a Quest the point where a wave stops holding 72fps.
 *
 * Updated in `useFrame`, not the fixed step: where a bolt *is* was decided by the simulation
 * already, and this is only the drawing of it.
 */

const scratchMatrix = new Matrix4()
const scratchPosition = new Vector3()
const scratchQuaternion = new Quaternion()
const scratchScale = new Vector3()
const scratchColour = new Color()
const scratchDirection = new Vector3()
const UP = new Vector3(0, 1, 0)

/** A bolt is drawn as a stretched blob along its own velocity — a tracer, not a marble. */
const BOLT_LENGTH = 2.6
const BOLT_WIDTH = 0.85

export function Projectiles() {
  const mesh = useRef<InstancedMesh>(null)

  useLayoutEffect(() => {
    // Nothing is in the air on the first frame, and an instanced mesh with no matrices set
    // draws every instance at the origin — a pile of bolts sitting in the middle of the room.
    const instanced = mesh.current
    if (!instanced) return
    scratchMatrix.makeScale(0, 0, 0)
    for (let i = 0; i < PROJECTILE_CAPACITY; i += 1) instanced.setMatrixAt(i, scratchMatrix)
    instanced.instanceMatrix.needsUpdate = true
  }, [])

  useFrame(() => {
    const instanced = mesh.current
    if (!instanced) return

    for (const bolt of projectilePool.items) {
      if (!bolt.active) {
        scratchMatrix.makeScale(0, 0, 0)
        instanced.setMatrixAt(bolt.slot, scratchMatrix)
        continue
      }

      scratchPosition.set(bolt.x, bolt.y, bolt.z)
      scratchDirection.set(bolt.vx, bolt.vy, bolt.vz)
      const speed = scratchDirection.length()
      if (speed > 0) scratchDirection.divideScalar(speed)
      else scratchDirection.copy(UP)

      // The unit sphere's +Y is stretched into the direction of travel, so the tracer points
      // where the bolt is going rather than wherever the pool happened to leave it.
      scratchQuaternion.setFromUnitVectors(UP, scratchDirection)
      scratchScale.set(
        bolt.radius * BOLT_WIDTH,
        bolt.radius * BOLT_LENGTH,
        bolt.radius * BOLT_WIDTH,
      )
      scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale)
      instanced.setMatrixAt(bolt.slot, scratchMatrix)

      scratchColour.set(ELEMENT_COLOUR[bolt.element])
      instanced.setColorAt(bolt.slot, scratchColour)
    }

    instanced.instanceMatrix.needsUpdate = true
    if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, PROJECTILE_CAPACITY]}
      frustumCulled={false}
    >
      <sphereGeometry args={[1, 8, 6]} />
      {/* Emissive and unlit by the scene, like the torch flames: a bolt is a light source in
          a dark corridor, and a lit material would leave it black between torches. */}
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  )
}
