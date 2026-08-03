/**
 * Head-locked HUD overlay — minimal debug version.
 *
 * Renders a solid red square head-locked to the camera using the EXACT same pattern
 * as ComfortVignette (which works). Once this is visible we bring back the canvas.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three'

export function HudOverlay() {
  const gl = useThree((state) => state.gl)
  const camera = useThree((state) => state.camera)
  const mesh = useRef<Mesh>(null)

  const { geometry, material } = useMemo(() => {
    return {
      geometry: new PlaneGeometry(0.5, 0.3),
      material: new MeshBasicMaterial({
        color: 0xff0000,
        side: 2, // DoubleSide
        depthTest: false,
        depthWrite: false,
        transparent: false,
      }),
    }
  }, [])

  useEffect(() => {
    return () => {
      geometry.dispose()
      material.dispose()
    }
  }, [geometry, material])

  const headMatrix = useMemo(() => new Matrix4(), [])

  useFrame(() => {
    const dome = mesh.current
    if (!dome) return

    const head = gl.xr.isPresenting ? gl.xr.getCamera() : camera

    // Identical to ComfortVignette.
    headMatrix.copy(head.matrixWorld)
    headMatrix.decompose(dome.position, dome.quaternion, dome.scale)
    dome.scale.set(1, 1, 1)

    // Nudge 1.5m forward so it's in front of the camera, not inside it.
    // Camera looks along -Z, so -1.5 * forward.
    const fwd = { x: 0, y: 0, z: -1 }
    // Rotate forward by head quaternion
    const q = dome.quaternion
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w
    const vx = fwd.x, vy = fwd.y, vz = fwd.z
    const ix = qw * vx + qy * vz - qz * vy
    const iy = qw * vy + qz * vx - qx * vz
    const iz = qw * vz + qx * vy - qy * vx
    const iw = -qx * vx - qy * vy - qz * vz
    const rx = ix * qw + iw * -qx + iy * -qz - iz * -qy
    const ry = iy * qw + iw * -qy + iz * -qx - ix * -qz
    const rz = iz * qw + iw * -qz + ix * -qy - iy * -qx

    dome.position.x += rx * 1.5
    dome.position.y += ry * 1.5
    dome.position.z += rz * 1.5
  })

  return (
    <mesh
      ref={mesh}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      renderOrder={990}
    />
  )
}
