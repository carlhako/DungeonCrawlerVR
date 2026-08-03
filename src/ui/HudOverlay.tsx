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
  LinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three'

export interface HudCanvasSize {
  width: number
  height: number
}

/**
 * How far toward the edge of the view to sit, as a fraction of the visible frustum at
 * `forwardMetres` — not a metre offset. `1` would touch the frustum edge exactly; `SAFE_FRACTION`
 * below pulls every anchor in a bit so a quad's own size never clips it. This is what makes
 * "top centre" and "bottom left" hold up across window resizes and the VR headset's FOV,
 * where a fixed metre nudge does not: a HUD element positioned by a small constant offset
 * drifts toward the centre of the view as the frustum widens, rather than tracking the edge.
 */
const SAFE_FRACTION = 0.85

export function HudOverlay({
  sizeMetres,
  canvasSize,
  anchor,
  renderOrder,
  draw,
}: {
  sizeMetres: [number, number]
  canvasSize: HudCanvasSize
  /** [x, y, forwardMetres]: x/y in [-1, 1] toward right/up edge of view; forward in metres. */
  anchor: [number, number, number]
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
    tex.colorSpace = SRGBColorSpace
    tex.generateMipmaps = false
    tex.minFilter = LinearFilter
    tex.magFilter = LinearFilter

    // Draw the very first frame so the texture isn't empty when it hits the GPU.
    const ctx = canvas.getContext('2d')
    if (ctx) {
      draw(ctx, canvas.width, canvas.height)
    }
    tex.needsUpdate = true

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

    // Rotate the local offset (right, up, forward) into world space.
    const q = dome.quaternion
    const [xFrac, yFrac, oz] = anchor

    // Derived from the projection matrix rather than a fixed FOV, so this holds for both
    // the desktop camera and the XR array camera. For a symmetric perspective projection,
    // elements[0]/[5] are the horizontal/vertical scale (cot(fov/2), and cot(fov/2)/aspect);
    // the half-extent of the frustum at depth `d` in front of the camera is d / that scale.
    //
    // The XR camera is not symmetric: `gl.xr.getCamera()` returns an ArrayCamera whose
    // projection matrix is the *union* of the left/right eye frustums (three's
    // `setProjectionFromUnion`), which is off-axis — elements[8]/[9] (the x/y skew terms)
    // are non-zero. Ignoring that skew shifts every anchor by a few degrees, which is
    // invisible for a centred HUD but pushes an edge anchor (top, bottom-left, ...) outside
    // the real per-eye frustums entirely: the quad rendered, but on nothing either eye could
    // see. `skewX`/`skewY` are that missing centre offset; they're exactly zero for the
    // desktop camera's symmetric matrix, so this is a strict generalisation, not a special case.
    const proj = head.projectionMatrix.elements
    const d = Math.abs(oz)
    const halfW = d / proj[0]
    const halfH = d / proj[5]
    const skewX = (d * proj[8]) / proj[0]
    const skewY = (d * proj[9]) / proj[5]
    const ox = skewX + xFrac * halfW * SAFE_FRACTION
    const oy = skewY + yFrac * halfH * SAFE_FRACTION

    // `offset`'s forward component follows the local -Z-is-forward convention (matching
    // the caller's comment), but `fwd` below is *already* that forward direction — so its
    // contribution is `-oz * fwd`, not `oz * fwd`. Dropping the minus here once sent every
    // HUD quad 1.5m behind the head instead of in front of it: correct geometry, correct
    // material, invisible because it was outside the frustum entirely.
    const fwd = rotateVec(q, { x: 0, y: 0, z: -1 })
    const up = rotateVec(q, { x: 0, y: 1, z: 0 })
    const right = rotateVec(q, { x: 1, y: 0, z: 0 })

    dome.position.x += right.x * ox + up.x * oy - fwd.x * oz
    dome.position.y += right.y * ox + up.y * oy - fwd.y * oz
    dome.position.z += right.z * ox + up.z * oy - fwd.z * oz

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
