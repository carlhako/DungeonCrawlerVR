import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { BufferAttribute, BufferGeometry, Color, Line, LineBasicMaterial } from 'three'
import { interactionState } from '@/systems/interaction'
import { playerState } from '@/systems/player'

/**
 * The line out of a controller that shows where you are pointing.
 *
 * Added after the shop was tested in a headset: aiming at a button with nothing drawn to
 * aim *with* is guesswork, and it made a panel that worked read as a panel that didn't.
 * Pointing needs a visible pointer — you cannot correct an aim you cannot see.
 *
 * Dim and short by default so it is a cue rather than a torch beam, and it stretches out to
 * whatever the player has picked out the moment they hit something.
 *
 * Mounted **inside the controller's target ray space** (see `GameXRController`), and drawn
 * as a unit line down its own -Z that is scaled to length. The first version drew world
 * space vertices at the hand's current pose instead, which put the beam a frame behind the
 * controller: moving, turning or waving the hand smeared it into what looked like a second
 * lagging line that snapped back the moment you held still. Nothing that is attached to a
 * tracked pose should be positioned by hand — parent it and let the pose carry it.
 */

/** How far the idle stub reaches. Long enough to read as a direction, short enough to ignore. */
const IDLE_LENGTH = 0.55

const IDLE_COLOUR = '#8d8a86'
const IDLE_OPACITY = 0.35

/** The same amber as every other "you can use this" cue. */
const ACTIVE_COLOUR = '#ffcf8a'
const ACTIVE_OPACITY = 0.85

export function PointerBeam({ handedness }: { handedness: 'left' | 'right' }) {
  const beam = useMemo(() => makeBeam(), [])
  const colours = useMemo(
    () => ({ idle: new Color(IDLE_COLOUR), active: new Color(ACTIVE_COLOUR) }),
    [],
  )

  useEffect(() => {
    return () => {
      beam.geometry.dispose()
      beam.material.dispose()
    }
  }, [beam])

  useFrame(() => {
    // Lit and extended only when *this* hand is the one holding a pointed focus. A hand that
    // has reached out and touched something is not pointing at it, and drawing a beam through
    // the thing it is resting on says the opposite.
    const active = interactionState.source === 'ray' && interactionState.hand === handedness

    // The teleport arc comes out of the same hand. Two lines from one controller saying
    // different things is not a pointer, it is a mess.
    beam.line.visible = !playerState.aiming
    beam.line.scale.z = active ? interactionState.distance : IDLE_LENGTH
    beam.material.color.copy(active ? colours.active : colours.idle)
    beam.material.opacity = active ? ACTIVE_OPACITY : IDLE_OPACITY
  })

  return <primitive object={beam.line} />
}

interface Beam {
  line: Line
  geometry: BufferGeometry
  material: LineBasicMaterial
}

function makeBeam(): Beam {
  // One metre down -Z, the axis a target ray points along. Length comes from the z scale.
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([0, 0, 0, 0, 0, -1]), 3),
  )
  const material = new LineBasicMaterial({ transparent: true, depthWrite: false })
  const line = new Line(geometry, material)
  return { line, geometry, material }
}
