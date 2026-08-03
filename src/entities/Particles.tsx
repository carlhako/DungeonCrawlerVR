import { useLayoutEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending, Color, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three'
import { PARTICLE_CAPACITY, particleScale } from '@/systems/fx/particles'
import { particlePool } from '@/systems/fx/state'

/**
 * Every spark in the world, as one instanced draw.
 *
 * The same arrangement as `Projectiles`, and for the same reasons: one mesh for the whole
 * pool, instances scaled to nothing rather than added and removed, and updated on the render
 * frame because where a particle *is* was decided by the fixed step already.
 *
 * Additive and unlit, like the torch flames and the bolts. A lit material would leave every
 * spark black between torches, which is where most of this game's fighting happens; additive
 * also means a burst reads as brighter where it is densest, which is the middle of an impact.
 *
 * Spheres rather than billboarded quads. Six-by-four spheres at this size are a handful of
 * triangles each and cost nothing to orient, whereas a billboard has to be rebuilt every
 * frame — and in stereo a billboard facing "the camera" has to pick one of two eyes.
 */

const scratchMatrix = new Matrix4()
const scratchPosition = new Vector3()
const scratchScale = new Vector3()
const scratchColour = new Color()
const IDENTITY = new Quaternion()

export function Particles() {
  const mesh = useRef<InstancedMesh>(null)

  useLayoutEffect(() => {
    // An instanced mesh with no matrices set draws every instance at the origin — a pile of
    // sparks sitting in the middle of the room on the first frame.
    const instanced = mesh.current
    if (!instanced) return
    scratchMatrix.makeScale(0, 0, 0)
    for (let i = 0; i < PARTICLE_CAPACITY; i += 1) instanced.setMatrixAt(i, scratchMatrix)
    instanced.instanceMatrix.needsUpdate = true
  }, [])

  useFrame(() => {
    const instanced = mesh.current
    if (!instanced) return

    for (const particle of particlePool.items) {
      const scale = particleScale(particle)
      if (!particle.active || scale <= 0) {
        scratchMatrix.makeScale(0, 0, 0)
        instanced.setMatrixAt(particle.slot, scratchMatrix)
        continue
      }

      scratchPosition.set(particle.x, particle.y, particle.z)
      scratchScale.set(scale, scale, scale)
      scratchMatrix.compose(scratchPosition, IDENTITY, scratchScale)
      instanced.setMatrixAt(particle.slot, scratchMatrix)

      scratchColour.setRGB(particle.r, particle.g, particle.b)
      instanced.setColorAt(particle.slot, scratchColour)
    }

    instanced.instanceMatrix.needsUpdate = true
    if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, PARTICLE_CAPACITY]} frustumCulled={false}>
      <sphereGeometry args={[1, 6, 4]} />
      <meshBasicMaterial
        toneMapped={false}
        transparent
        blending={AdditiveBlending}
        // Additive geometry that wrote depth would punch holes in the sparks behind it.
        depthWrite={false}
      />
    </instancedMesh>
  )
}
