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
  Quaternion,
  Vector3,
} from 'three'

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
  /** Offset in head-local space: right, up, forward (metres). */
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

    // Pre-fill with a visible colour so the first frame isn't a fully transparent
    // quad. The real content is drawn by the `draw` callback every `useFrame`.
    const initCtx = canvas.getContext('2d')
    if (initCtx) {
      initCtx.fillStyle = 'rgba(255,0,255,0.3)'
      initCtx.fillRect(0, 0, canvas.width, canvas.height)
    }

    const tex = new CanvasTexture(canvas)
    const mat = new MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
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

  // Pattern copied directly from ComfortVignette — the one head-locked mesh already
  // proven to work in VR.
  const headMatrix = useMemo(() => new Matrix4(), [])

  // Scratch objects for the offset computation.
  const _right = useMemo(() => new Vector3(), [])
  const _up = useMemo(() => new Vector3(), [])
  const _fwd = useMemo(() => new Vector3(), [])
  const _headQuat = useMemo(() => new Quaternion(), [])

  useFrame(() => {
    const dome = mesh.current
    if (!dome) return

    const head = gl.xr.isPresenting ? gl.xr.getCamera() : camera

    // Identical to ComfortVignette: read the world matrix of the XR camera (VR) or
    // desktop camera, and decompose into position + quaternion + scale.
    headMatrix.copy(head.matrixWorld)
    headMatrix.decompose(dome.position, _headQuat, dome.scale)
    dome.scale.set(1, 1, 1)

    // Rotate 180° around local Y so the PlaneGeometry's +Z face (the front) points
    // toward the viewer rather than away from them.  The camera looks along -Z.
    dome.quaternion.copy(_headQuat).multiply(
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI),
    )

    // Apply the head-local offset rotated into world space.
    // Basis vectors rotated by the *head's* orientation, not the quad's.
    const [ox, oy, oz] = offset
    _right.set(1, 0, 0).applyQuaternion(_headQuat)
    _up.set(0, 1, 0).applyQuaternion(_headQuat)
    _fwd.set(0, 0, -1).applyQuaternion(_headQuat)

    dome.position.x += _right.x * ox + _up.x * oy + _fwd.x * oz
    dome.position.y += _right.y * ox + _up.y * oy + _fwd.y * oz
    dome.position.z += _right.z * ox + _up.z * oy + _fwd.z * oz

    // Redraw the canvas.
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
