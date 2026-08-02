import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { BackSide, Matrix4, Mesh, ShaderMaterial, SphereGeometry } from 'three'
import { damp, vignetteTarget } from '@/systems/locomotion'
import { playerState } from '@/systems/player'
import { useSettings } from '@/systems/settings'

/**
 * The comfort vignette: narrows the field of view while the player is being moved by
 * something other than their own legs.
 *
 * VR sickness comes from vection — the illusion of self-motion produced by a moving visual
 * field when the inner ear reports no motion at all. It is strongest in the periphery,
 * which is exactly what this covers up. It is the difference between a game some people
 * can play for twenty minutes and one they can play for two hours.
 *
 * A dome centred on the head rather than a plane in front of it. A plane close enough to
 * fill the view sits at a fixed distance and so has stereo disparity — the two eyes see the
 * vignette edge in different places, which the visual system reads as an object floating in
 * front of the face. Every point on a dome is equidistant, so there is nothing to converge
 * on and it reads as an absence of light rather than a thing.
 */

/** Radius in metres. Well inside the near plane of anything else in the scene. */
const DOME_RADIUS = 0.6

/** Angular radius of the clear centre and of the fully dark periphery, at full strength. */
const INNER_DEGREES = 28
const OUTER_DEGREES = 58

/**
 * Time to close half the remaining distance to the target.
 *
 * Asymmetric on purpose. Closing has to be quick or the vignette arrives after the motion
 * it exists to mask; opening is slower because a vignette that snaps away the instant the
 * stick centres is itself a flash of motion in the periphery.
 */
const CLOSE_HALF_LIFE = 0.06
const OPEN_HALF_LIFE = 0.16

const vertexShader = /* glsl */ `
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  uniform float uAmount;
  uniform float uCosInner;
  uniform float uCosOuter;
  varying vec3 vLocal;

  void main() {
    // The dome is head-locked, so its local -Z is straight ahead.
    float alignment = dot(normalize(vLocal), vec3(0.0, 0.0, -1.0));
    float alpha = 1.0 - smoothstep(uCosOuter, uCosInner, alignment);
    gl_FragColor = vec4(0.0, 0.0, 0.0, alpha * uAmount);
  }
`

export function ComfortVignette() {
  const gl = useThree((state) => state.gl)
  const camera = useThree((state) => state.camera)
  const strength = useSettings((state) => state.comfortVignette)
  const maxSpeed = useSettings((state) => state.moveSpeed)

  const mesh = useRef<Mesh>(null)
  const amount = useRef(0)

  const { geometry, material } = useMemo(() => {
    return {
      geometry: new SphereGeometry(DOME_RADIUS, 32, 24),
      material: new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uAmount: { value: 0 },
          uCosInner: { value: Math.cos((INNER_DEGREES * Math.PI) / 180) },
          uCosOuter: { value: Math.cos((OUTER_DEGREES * Math.PI) / 180) },
        },
        transparent: true,
        // Viewed from inside, and it must never occlude or be occluded by the world.
        side: BackSide,
        depthTest: false,
        depthWrite: false,
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

  useFrame((_state, delta) => {
    const dome = mesh.current
    if (!dome) return

    // VR only. On a monitor there is no vestibular conflict to mask — the player knows
    // perfectly well they are sitting still — so the same tunnel just reads as the game
    // going dark at the edges every time they walk.
    const target = gl.xr.isPresenting
      ? vignetteTarget(playerState.speed, maxSpeed, playerState.turning, strength)
      : 0
    const halfLife = target > amount.current ? CLOSE_HALF_LIFE : OPEN_HALF_LIFE
    amount.current = damp(amount.current, target, halfLife, delta)

    const uAmount = material.uniforms.uAmount
    if (uAmount) uAmount.value = amount.current
    dome.visible = amount.current > 0.001
    if (!dome.visible) return

    // Read the *XR* camera when presenting: three updates it from the frame's pose at the
    // top of the animation callback, before any of this runs, so it is this frame's head
    // rather than the previous frame's. A vignette that lagged the head would swim.
    const head = gl.xr.isPresenting ? gl.xr.getCamera() : camera
    headMatrix.copy(head.matrixWorld)
    headMatrix.decompose(dome.position, dome.quaternion, dome.scale)
    // The head matrix carries no useful scale, and inheriting one would resize the dome.
    dome.scale.set(1, 1, 1)
  })

  return (
    <mesh
      ref={mesh}
      geometry={geometry}
      material={material}
      visible={false}
      frustumCulled={false}
      // Drawn last, over everything. Without this the transparent dome sorts by distance
      // against the world and the periphery flickers as the player turns.
      renderOrder={999}
    />
  )
}
