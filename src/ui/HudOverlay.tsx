/**
 * Head-locked HUD overlays rendered as canvas-textured quads inside the R3F canvas.
 *
 * Sprint 2.5: the enemy counter and the explored-area map are screen-space HUD elements
 * that must work on desktop and in VR. A DOM overlay is invisible inside an immersive
 * session, so both are drawn as canvas textures on quads parented to the camera — on
 * desktop this reads as fixed on the screen; in VR it reads as a headset HUD.
 *
 * Pattern shared with `ComfortVignette`, which already proves the head-locked approach.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { CanvasTexture, DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3 } from 'three'

export interface HudCanvasSize {
  width: number
  height: number
}

/** A head-locked overlay quad. `draw` is called every frame. */
export function HudOverlay({
  sizeMetres,
  canvasSize,
  offset,
  renderOrder,
  draw,
}: {
  sizeMetres: [number, number]
  canvasSize: HudCanvasSize
  /** Offset in head-local space: right, up, forward. */
  offset: [number, number, number]
  renderOrder: number
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void
}) {
  const gl = useThree((state) => state.gl)
  const camera = useThree((state) => state.camera)
  const mesh = useRef<Mesh>(null)

  const { texture, material, geometry, canvasEl } = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvasSize.width
    canvas.height = canvasSize.height
    const tex = new CanvasTexture(canvas)
    const mat = new MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      // PlaneGeometry faces +Z but the camera looks along -Z — the quad would be
      // backface-culled in both eyes without this.
      side: DoubleSide,
    })
    const geo = new PlaneGeometry(sizeMetres[0], sizeMetres[1])
    return { texture: tex, material: mat, geometry: geo, canvasEl: canvas }
  }, [canvasSize.width, canvasSize.height, sizeMetres[0], sizeMetres[1]])

  useEffect(() => {
    return () => {
      geometry.dispose()
      material.dispose()
      texture.dispose()
    }
  }, [geometry, material, texture])

  // Reusable scratch objects for the per-frame update.
  const scratchRight = useMemo(() => ({ x: 0, y: 0, z: 0 }), [])
  const scratchUp = useMemo(() => ({ x: 0, y: 0, z: 0 }), [])
  const scratchForward = useMemo(() => ({ x: 0, y: 0, z: 0 }), [])
  // PlaneGeometry faces +Z; the camera looks along -Z. Rotate 180° around Y so the
  // quad's front face points toward the viewer rather than away from them.
  const flipY = useMemo(
    () => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI),
    [],
  )

  useFrame(() => {
    const dome = mesh.current
    if (!dome) return

    const head = gl.xr.isPresenting ? gl.xr.getCamera() : camera

    dome.position.copy(head.position)
    // Copy head orientation then rotate 180° around local Y so the quad's +Z face
    // (the visible front of a PlaneGeometry) points toward the camera rather than
    // away from it.
    dome.quaternion.copy(head.quaternion).multiply(flipY)

    // Apply head-local offset rotated into world space.
    const q = head.quaternion
    const [ox, oy, oz] = offset

    // Camera basis: local right (1,0,0), up (0,1,0), forward (0,0,-1)
    rotateVec(q, { x: 1, y: 0, z: 0 }, scratchRight)
    rotateVec(q, { x: 0, y: 1, z: 0 }, scratchUp)
    rotateVec(q, { x: 0, y: 0, z: -1 }, scratchForward)

    dome.position.x += scratchRight.x * ox + scratchUp.x * oy + scratchForward.x * oz
    dome.position.y += scratchRight.y * ox + scratchUp.y * oy + scratchForward.y * oz
    dome.position.z += scratchRight.z * ox + scratchUp.z * oy + scratchForward.z * oz

    dome.scale.set(1, 1, 1)

    // Redraw the canvas every frame. Both HUDs are tiny (200x200 and 256x64) and the
    // drawing ops are trivial — caching the static portions would save microseconds on
    // a canvas this small.
    const ctx = canvasEl.getContext('2d')
    if (ctx) {
      ctx.clearRect(0, 0, canvasEl.width, canvasEl.height)
      draw(ctx, canvasEl.width, canvasEl.height)
      texture.needsUpdate = true
    }
  })

  return (
    <mesh
      ref={mesh}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      renderOrder={renderOrder}
    />
  )
}

/** Rotate a vector by a quaternion. */
function rotateVec(
  q: { x: number; y: number; z: number; w: number },
  v: { x: number; y: number; z: number },
  out: { x: number; y: number; z: number },
): void {
  const qx = q.x, qy = q.y, qz = q.z, qw = q.w
  const vx = v.x, vy = v.y, vz = v.z

  // q * v * q⁻¹
  const ix = qw * vx + qy * vz - qz * vy
  const iy = qw * vy + qz * vx - qx * vz
  const iz = qw * vz + qx * vy - qy * vx
  const iw = -qx * vx - qy * vy - qz * vz

  out.x = ix * qw + iw * -qx + iy * -qz - iz * -qy
  out.y = iy * qw + iw * -qy + iz * -qx - ix * -qz
  out.z = iz * qw + iw * -qz + ix * -qy - iy * -qx
}
