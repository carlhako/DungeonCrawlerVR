import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useXR } from '@react-three/xr'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Line,
  LineBasicMaterial,
  Quaternion,
  Vector3,
  type Object3D,
} from 'three'
import { interactionState } from '@/systems/interaction'
import { playerState } from '@/systems/player'
import { xrAim } from '@/systems/xrAim'

/**
 * The line out of each controller that shows where you are pointing.
 *
 * Added after the shop was tested in a headset: aiming at a button with nothing drawn to
 * aim *with* is guesswork, and it made a panel that worked read as a panel that didn't.
 * Pointing needs a visible pointer — you cannot correct an aim you cannot see.
 *
 * Dim and short by default so it is a cue rather than a torch beam, and it stretches out to
 * whatever the player has picked out the moment they hit something.
 */

/** How far the idle stub reaches. Long enough to read as a direction, short enough to ignore. */
const IDLE_LENGTH = 0.55

const IDLE_COLOUR = '#8d8a86'
const IDLE_OPACITY = 0.35

/** The same amber as every other "you can use this" cue. */
const ACTIVE_COLOUR = '#ffcf8a'
const ACTIVE_OPACITY = 0.85

export function PointerBeam() {
  const inSession = useXR((state) => state.session != null)

  const latest = useRef({ inSession })
  latest.current = { inSession }

  const beams = useMemo(() => ({ left: makeBeam(), right: makeBeam() }), [])
  const scratch = useMemo(
    () => ({
      origin: new Vector3(),
      direction: new Vector3(),
      rotation: new Quaternion(),
      idle: new Color(IDLE_COLOUR),
      active: new Color(ACTIVE_COLOUR),
    }),
    [],
  )

  useEffect(() => {
    return () => {
      for (const beam of Object.values(beams)) {
        beam.geometry.dispose()
        beam.material.dispose()
      }
    }
  }, [beams])

  // Per rendered frame, not per fixed step: a beam attached to a hand that lags the hand by
  // up to a frame is worse than no beam at all.
  useFrame(() => {
    // The teleport arc comes out of the same hand. Two lines from one controller saying
    // different things is not a pointer, it is a mess.
    const hidden = !latest.current.inSession || playerState.aiming

    draw(beams.right, hidden ? null : xrAim.right, 'right', scratch)
    draw(beams.left, hidden ? null : xrAim.left, 'left', scratch)
  })

  return (
    <group>
      <primitive object={beams.left.line} />
      <primitive object={beams.right.line} />
    </group>
  )
}

interface Beam {
  line: Line
  geometry: BufferGeometry
  material: LineBasicMaterial
  positions: Float32Array
}

function makeBeam(): Beam {
  const positions = new Float32Array(6)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  const material = new LineBasicMaterial({ transparent: true, depthWrite: false })
  const line = new Line(geometry, material)
  // World-space vertices that move every frame: a bounding sphere computed once would cull
  // the beam the moment the player turned away from where the session started.
  line.frustumCulled = false
  line.visible = false
  return { line, geometry, material, positions }
}

function draw(
  beam: Beam,
  aim: Object3D | null,
  handedness: 'left' | 'right',
  scratch: {
    origin: Vector3
    direction: Vector3
    rotation: Quaternion
    idle: Color
    active: Color
  },
): void {
  if (!aim) {
    beam.line.visible = false
    return
  }

  aim.getWorldPosition(scratch.origin)
  aim.getWorldQuaternion(scratch.rotation)
  // The target ray points along its own -Z, the same axis the picker and the arc use.
  scratch.direction.set(0, 0, -1).applyQuaternion(scratch.rotation)

  // Lit and extended only when *this* hand is the one holding a pointed focus. A hand that
  // has reached out and touched something is not pointing at it, and drawing a beam through
  // the thing it is resting on says the opposite.
  const active = interactionState.source === 'ray' && interactionState.hand === handedness
  const length = active ? interactionState.distance : IDLE_LENGTH

  beam.positions[0] = scratch.origin.x
  beam.positions[1] = scratch.origin.y
  beam.positions[2] = scratch.origin.z
  beam.positions[3] = scratch.origin.x + scratch.direction.x * length
  beam.positions[4] = scratch.origin.y + scratch.direction.y * length
  beam.positions[5] = scratch.origin.z + scratch.direction.z * length
  beam.geometry.getAttribute('position').needsUpdate = true

  beam.material.color.copy(active ? scratch.active : scratch.idle)
  beam.material.opacity = active ? ACTIVE_OPACITY : IDLE_OPACITY
  beam.line.visible = true
}
