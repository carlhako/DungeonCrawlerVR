import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useXRInputSourceState } from '@react-three/xr'
import type { Group, Mesh, MeshStandardMaterial } from 'three'
import { SystemOrder } from '@/core/loop'
import { useFixedUpdate } from '@/core/simulation'
import { Haptic, pulsePreset } from '@/systems/haptics'
import { xrInput, type ButtonState, type HandInput } from '@/systems/xrInput'

/**
 * A world-space readout of both controllers, for verifying Sprint 0.2 from inside the
 * headset.
 *
 * Deliberately geometric rather than text: legible at a glance across the room, readable
 * at any framebuffer scale, and it needs no font to load. It is also the first thing built
 * to the rule that in-game UI is world-space and diegetic — a DOM overlay would be
 * invisible in VR, so the pattern is established here where the stakes are low.
 *
 * This panel is scaffolding. It comes out once the foyer exists in Sprint 1.1.
 */

const PANEL_WIDTH = 1.6
const PANEL_HEIGHT = 1.1
const BAR_HEIGHT = 0.36

/**
 * Vertical layout within one hand's column, in panel-local metres. Kept together so the
 * elements can't be nudged into overlapping each other one edit at a time.
 */
const ROW_Y = {
  connection: 0.42,
  bars: 0.16,
  buttons: -0.13,
  stick: -0.34,
} as const

const IDLE = '#3c3c48'
const ACTIVE = '#ff8a3d'
const CONNECTED = '#6fdc8c'

/**
 * Indicators are near-black in albedo and carry their colour entirely in `emissive`.
 *
 * A lamp coloured bright green still looks green when it is *off*, because ambient light
 * bounces off it — which makes a disconnected controller indistinguishable from a tracked
 * one at a glance. Driving the colour from emission only means unlit reads as genuinely
 * dark, which is also how everything in the torch-lit dungeon will have to behave.
 */
const UNLIT_ALBEDO = '#15151a'

/** A vertical fill bar for an analog input. */
function AnalogBar({ x, read }: { x: number; read: () => ButtonState }) {
  const fill = useRef<Mesh>(null)
  const material = useRef<MeshStandardMaterial>(null)

  useFrame(() => {
    if (!fill.current || !material.current) return
    const { value, pressed } = read()
    // Clamped: a controller reporting slightly over 1 would otherwise overshoot the frame.
    const amount = Math.min(1, Math.max(0.001, value))
    fill.current.scale.y = amount
    // Anchor the fill to the bottom of the track rather than its centre.
    fill.current.position.y = -BAR_HEIGHT / 2 + (BAR_HEIGHT * amount) / 2
    material.current.emissiveIntensity = pressed ? 2.5 : 0.6 + amount * 1.2
  })

  return (
    <group position={[x, ROW_Y.bars, 0]}>
      {/* Track */}
      <mesh>
        <boxGeometry args={[0.09, BAR_HEIGHT, 0.02]} />
        <meshStandardMaterial color={IDLE} roughness={0.9} />
      </mesh>
      {/* Fill — scaled on Y each frame, so the geometry is full height at scale 1. */}
      <mesh ref={fill} position={[0, -BAR_HEIGHT / 2, 0.015]}>
        <boxGeometry args={[0.07, BAR_HEIGHT, 0.02]} />
        <meshStandardMaterial
          ref={material}
          color={UNLIT_ALBEDO}
          emissive={ACTIVE}
          roughness={0.5}
        />
      </mesh>
    </group>
  )
}

/** A lamp that lights while a digital button is held. */
function ButtonLamp({ x, y, read }: { x: number; y: number; read: () => ButtonState }) {
  const material = useRef<MeshStandardMaterial>(null)

  useFrame(() => {
    if (!material.current) return
    const { pressed, touched } = read()
    material.current.emissiveIntensity = pressed ? 3 : touched ? 0.7 : 0.05
  })

  return (
    <mesh position={[x, y, 0.02]}>
      <sphereGeometry args={[0.045, 16, 12]} />
      <meshStandardMaterial
        ref={material}
        color={UNLIT_ALBEDO}
        emissive={ACTIVE}
        roughness={0.4}
      />
    </mesh>
  )
}

/** A pad whose dot tracks the thumbstick, and lights when the stick is clicked. */
function StickPad({ y, read }: { y: number; read: () => HandInput }) {
  const dot = useRef<Mesh>(null)
  const material = useRef<MeshStandardMaterial>(null)
  const travel = 0.09

  useFrame(() => {
    if (!dot.current || !material.current) return
    const { thumbstick } = read()
    dot.current.position.x = Math.min(1, Math.max(-1, thumbstick.x)) * travel
    // WebXR reports +Y as *down* on the stick; negate so pushing forward moves the dot up.
    dot.current.position.y = -Math.min(1, Math.max(-1, thumbstick.y)) * travel
    material.current.emissiveIntensity = thumbstick.pressed ? 3 : 1.2
  })

  return (
    <group position={[0, y, 0]}>
      <mesh>
        <boxGeometry args={[0.26, 0.26, 0.02]} />
        <meshStandardMaterial color={IDLE} roughness={0.9} />
      </mesh>
      <mesh ref={dot} position={[0, 0, 0.025]}>
        <sphereGeometry args={[0.035, 16, 12]} />
        <meshStandardMaterial
          ref={material}
          color={UNLIT_ALBEDO}
          emissive={CONNECTED}
          roughness={0.4}
        />
      </mesh>
    </group>
  )
}

/** Lit while the controller is being tracked. */
function ConnectionLamp({ read }: { read: () => HandInput }) {
  const material = useRef<MeshStandardMaterial>(null)

  useFrame(() => {
    if (!material.current) return
    material.current.emissiveIntensity = read().connected ? 2.5 : 0.05
  })

  return (
    <mesh position={[0, ROW_Y.connection, 0.02]}>
      <boxGeometry args={[0.3, 0.05, 0.02]} />
      <meshStandardMaterial
        ref={material}
        color={UNLIT_ALBEDO}
        emissive={CONNECTED}
        roughness={0.5}
      />
    </mesh>
  )
}

function HandReadout({ x, hand }: { x: number; hand: 'left' | 'right' }) {
  const read = () => xrInput[hand]

  return (
    <group position={[x, 0, 0]}>
      <ConnectionLamp read={read} />
      <AnalogBar x={-0.13} read={() => read().trigger} />
      <AnalogBar x={0.13} read={() => read().grip} />
      <ButtonLamp x={-0.13} y={ROW_Y.buttons} read={() => read().primary} />
      <ButtonLamp x={0.13} y={ROW_Y.buttons} read={() => read().secondary} />
      <StickPad y={ROW_Y.stick} read={read} />
    </group>
  )
}

/**
 * Pulses a controller when its own trigger goes down.
 *
 * Runs on the fixed loop after `SystemOrder.Input`, so it reads the edge the sampler set
 * this same step. This is the haptics half of the sprint's acceptance test.
 */
function TriggerHaptics() {
  const left = useXRInputSourceState('controller', 'left')
  const right = useXRInputSourceState('controller', 'right')
  const controllers = useRef({ left, right })
  controllers.current = { left, right }

  useFixedUpdate(() => {
    if (xrInput.left.trigger.justPressed) pulsePreset(controllers.current.left, Haptic.fire)
    if (xrInput.right.trigger.justPressed) pulsePreset(controllers.current.right, Haptic.fire)
  }, SystemOrder.Effects)

  return null
}

export function XRDiagnostics({
  position = [0, 1.4, 1],
}: {
  position?: [number, number, number]
}) {
  const group = useRef<Group>(null)

  return (
    <group ref={group} position={position}>
      <TriggerHaptics />

      {/* Backing board. Emissive-free but pale, so it reads against the dark room. */}
      <mesh position={[0, 0, -0.03]} castShadow receiveShadow>
        <boxGeometry args={[PANEL_WIDTH, PANEL_HEIGHT, 0.05]} />
        <meshStandardMaterial color="#1b1b22" roughness={0.95} />
      </mesh>

      {/* Each hand's readout sits on that side of the panel from the player's point of
          view. The panel's front face is +z and the player looks down -z, which puts their
          left hand at -x here. */}
      <HandReadout x={-0.4} hand="left" />
      <HandReadout x={0.4} hand="right" />

      {/* Divider, so the two halves aren't mistaken for one readout. */}
      <mesh position={[0, 0, 0.01]}>
        <boxGeometry args={[0.01, PANEL_HEIGHT * 0.8, 0.02]} />
        <meshStandardMaterial color="#3a3a45" roughness={0.9} />
      </mesh>
    </group>
  )
}
