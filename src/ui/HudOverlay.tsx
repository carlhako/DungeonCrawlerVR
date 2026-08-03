/**
 * Head-locked HUD overlays rendered as canvas-textured quads inside the R3F canvas.
 *
 * Uses the identical head-locking pattern as ComfortVignette: `matrixWorld.decompose()`
 * each frame so the quad follows the camera in both desktop and VR.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  CanvasTexture,
  DoubleSide,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from 'three'

export interface HudCanvasSize {
  width: number
  height: number
}

export function HudOverlay({
  sizeMetres,
  canvasSize,
  offset,
  renderOrder,
  draw,
}: {
  sizeMetres: [number, number]
  canvasSize: HudCanvasSize
  /** Head-local offset: right, up, forward (metres). */
  offset: [number, number, number]
  renderOrder: number
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void
}) {
  const gl = useThree((state) => state.gl)
  const camera = useThree((state) => state.camera)
  const meshRef = useRef<Mesh>(null)

  // Stable references — created once, same as the working debug square.
  const { geometry, material, texture, canvasEl } = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvasSize.width
    canvas.height = canvasSize.height
    const tex = new CanvasTexture(canvas)
    const mat = new MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
    })
    const geo = new PlaneGeometry(sizeMetres[0], sizeMetres[1])
    return { geometry: geo, material: mat, texture: tex, canvasEl: canvas }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return () => {
      geometry.dispose()
      material.dispose()
      texture.dispose()
    }
  }, [geometry, material, texture])

  const headMatrix = useMemo(() => new Matrix4(), [])

  // Keep latest draw in a ref so the useFrame closure (registered once) always calls it.
  const drawRef = useRef(draw)
  drawRef.current = draw

  useFrame(() => {
    const dome = meshRef.current
    if (!dome) return

    const head = gl.xr.isPresenting ? gl.xr.getCamera() : camera

    // Identical to ComfortVignette.
    headMatrix.copy(head.matrixWorld)
    headMatrix.decompose(dome.position, dome.quaternion, dome.scale)
    dome.scale.set(1, 1, 1)

    // Rotate the head's forward vector into world space and offset.
    const q = dome.quaternion
    const [ox, oy, oz] = offset

    // Forward = local -Z; up = local +Y; right = local +X
    const fwd = rotateVec(q, { x: 0, y: 0, z: -1 })
    const up = rotateVec(q, { x: 0, y: 1, z: 0 })
    const right = rotateVec(q, { x: 1, y: 0, z: 0 })

    dome.position.x += right.x * ox + up.x * oy + fwd.x * oz
    dome.position.y += right.y * ox + up.y * oy + fwd.y * oz
    dome.position.z += right.z * ox + up.z * oy + fwd.z * oz

    // Draw the canvas content.
    const ctx = canvasEl.getContext('2d')
    if (ctx) {
      ctx.clearRect(0, 0, canvasEl.width, canvasEl.height)
      drawRef.current(ctx, canvasEl.width, canvasEl.height)
      texture.needsUpdate = true
    }
  })

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      renderOrder={renderOrder}
    />
  )
}

/** Rotate a vector by a quaternion. Returns a new object. */
function rotateVec(
  q: { x: number; y: number; z: number; w: number },
  v: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const qx = q.x, qy = q.y, qz = q.z, qw = q.w
  const vx = v.x, vy = v.y, vz = v.z

  // q * v * q⁻¹
  const ix = qw * vx + qy * vz - qz * vy
  const iy = qw * vy + qz * vx - qx * vz
  const iz = qw * vz + qx * vy - qy * vx
  const iw = -qx * vx - qy * vy - qz * vz

  return {
    x: ix * qw + iw * -qx + iy * -qz - iz * -qy,
    y: iy * qw + iw * -qy + iz * -qx - ix * -qz,
    z: iz * qw + iw * -qz + ix * -qy - iy * -qx,
  }
}
