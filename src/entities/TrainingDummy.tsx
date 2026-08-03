import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { RigidBody } from '@react-three/rapier'
import type { Group, Mesh, MeshStandardMaterial } from 'three'
import type { Element } from '@/data/elements'
import { SystemOrder } from '@/core/loop'
import { useFixedUpdate } from '@/core/simulation'
import { registerDamageable, type Damageable } from '@/systems/combat/targets'
import { createLabel } from '@/ui/label'

/**
 * A thing in the foyer to shoot at.
 *
 * Sprint 2.2's acceptance test is "shoot and swing at training dummies in the foyer", and
 * this is the whole of that: a target that takes damage, shows what it took, dies, and comes
 * back. It is also the first consumer of the damageable registry, which is deliberate —
 * Sprint 2.3's enemies register through the same interface, so anything that works here
 * works on a skeleton without a line changing in the combat driver.
 *
 * It reacts *in the world* rather than in the console. That is the rule the shop bell taught
 * in Sprint 1.1 and it applies with more force here: a weapon whose hits are invisible is
 * indistinguishable from a weapon that does not fire.
 */

const RESPAWN_SECONDS = 3

/** Width of the health bar above a dummy, in metres. */
const BAR_WIDTH = 0.44

/** How long the hit flash lasts. Short: it is punctuation, not a light. */
const FLASH_SECONDS = 0.18

export interface DummyProfile {
  id: string
  position: [number, number, number]
  label: string
  hp: number
  resistances?: Partial<Record<Element, number>>
}

/**
 * Three dummies, not one.
 *
 * One dummy proves a bolt can land. Three with different resistances prove the *pipeline* —
 * that the element a weapon deals is carried all the way to the target and changes the
 * number, which is the part of the damage path that can be silently wrong while everything
 * still looks like it works.
 */
/**
 * Set along the left-hand side of the room, and deliberately not on the line from the spawn
 * point to the settings board. Everything on that wall is something the player points at
 * from where they stand up, and a dummy parked in front of it is a dummy in the way of the
 * one control that decides whether somebody can play at all.
 */
export const FOYER_DUMMIES: DummyProfile[] = [
  { id: 'dummy-plain', position: [-3.0, 0, 0.8], label: 'Straw', hp: 220 },
  {
    id: 'dummy-fireproof',
    position: [-4.3, 0, -1.0],
    label: 'Soaked · resists fire',
    hp: 220,
    resistances: { fire: 0.6 },
  },
  {
    id: 'dummy-brittle',
    position: [-2.5, 0, -2.0],
    label: 'Brittle · weak to frost',
    hp: 220,
    resistances: { frost: -0.5 },
  },
]

export function TrainingDummies() {
  return (
    <>
      {FOYER_DUMMIES.map((profile) => (
        <TrainingDummy key={profile.id} profile={profile} />
      ))}
    </>
  )
}

function TrainingDummy({ profile }: { profile: DummyProfile }) {
  const group = useRef<Group>(null)
  const torso = useRef<Mesh>(null)
  const bar = useRef<Mesh>(null)
  const track = useRef<Mesh>(null)
  const plate = useRef<Group>(null)

  /**
   * The reaction state, in a ref rather than in React.
   *
   * A dummy is hit several times a second and none of it should re-render the scene graph —
   * the same rule the input snapshots follow. `flash` and `rock` are seconds remaining.
   */
  const reaction = useRef({ flash: 0, rock: 0, rockFrom: { x: 0, z: 0 }, dead: 0 })

  const target = useMemo<Damageable>(
    () => ({
      id: profile.id,
      // Chest height on a 1.7m player: the point a bolt aimed at "the dummy" arrives at.
      position: { x: profile.position[0], y: 1.05, z: profile.position[2] },
      radius: 0.34,
      hp: profile.hp,
      maxHp: profile.hp,
      resistances: profile.resistances,
      statuses: [],
      enabled: true,
      onDamage: (event) => {
        reaction.current.flash = FLASH_SECONDS
        reaction.current.rock = 0.35
        // Rocked away from the hit, so the direction it moves says where it was struck.
        const dx = target.position.x - event.point.x
        const dz = target.position.z - event.point.z
        const length = Math.hypot(dx, dz) || 1
        reaction.current.rockFrom = { x: dx / length, z: dz / length }
        if (event.killed) reaction.current.dead = RESPAWN_SECONDS
      },
    }),
    [profile],
  )

  useEffect(() => registerDamageable(target), [target])

  const nameplate = useMemo(
    () => createLabel(profile.label, { fontSize: 42, background: 'rgba(10, 9, 12, 0.6)' }),
    [profile.label],
  )
  useEffect(() => nameplate.dispose, [nameplate])

  useFixedUpdate(
    (dt) => {
      const state = reaction.current
      state.flash = Math.max(0, state.flash - dt)
      state.rock = Math.max(0, state.rock - dt)

      if (state.dead > 0) {
        state.dead -= dt
        if (state.dead <= 0) {
          // Back on its feet, whole. A training dummy that stays dead makes the room a worse
          // place to practise every time you use it.
          target.hp = target.maxHp
          target.statuses.length = 0
          target.burnCarry = 0
          target.enabled = true
        }
      } else if (target.hp <= 0) {
        target.enabled = false
      }
    },
    SystemOrder.Effects,
    [target],
  )

  const camera = useThree((state) => state.camera)

  useFrame(() => {
    const root = group.current
    if (!root) return

    const state = reaction.current
    const dying = target.hp <= 0

    // Toppled over while dead, upright otherwise, with the rock easing back to nothing.
    const rock = state.rock / 0.35
    root.rotation.x = dying ? -1.35 : -state.rockFrom.z * rock * 0.28
    root.rotation.z = dying ? 0 : state.rockFrom.x * rock * 0.28

    const material = torso.current?.material as MeshStandardMaterial | undefined
    if (material) {
      const burning = target.statuses.some((status) => status.kind === 'burning')
      const chilled = target.statuses.some((status) => status.kind === 'chilled')
      // Enough to say "this one is on fire" across a dark room, and no more. Pushed higher
      // it stops reading as a status on a straw dummy and starts reading as a straw dummy
      // made of light — the torso's own colour disappears entirely under it.
      material.emissiveIntensity =
        (state.flash / FLASH_SECONDS) * 2.4 + (burning ? 0.45 : 0) + (chilled ? 0.18 : 0)
      material.emissive.set(burning ? '#ff6a1f' : chilled ? '#8fd8ff' : '#ffffff')
    }

    // The health bar's fill, scaled from its left edge. Hidden while the dummy is whole: a
    // full bar over something nobody has hit yet is a permanent red line across the room
    // that means nothing, and the room already has enough to read.
    const fraction = Math.max(0, target.hp / target.maxHp)
    const fill = bar.current
    if (fill) {
      fill.scale.x = Math.max(0.001, fraction)
      fill.position.x = -(1 - fraction) * BAR_WIDTH * 0.5
    }
    if (track.current) track.current.visible = fraction < 1 && !dying
    if (fill) fill.visible = fraction < 1 && !dying

    // The nameplate and bar face the player. A readout you have to walk around to read is
    // not a readout.
    plate.current?.lookAt(camera.position)
  })

  return (
    <group position={profile.position}>
      {/* Fixed, so the player cannot shove a dummy across the room, and solid so a bolt that
          misses the hit sphere still stops on something. */}
      <RigidBody type="fixed" colliders="cuboid">
        <mesh position={[0, 0.06, 0]} receiveShadow>
          <cylinderGeometry args={[0.34, 0.4, 0.12, 12]} />
          <meshStandardMaterial color="#3a3128" roughness={1} />
        </mesh>
      </RigidBody>

      {/* Everything above the base rocks and topples, so the reaction reads from across the
          room rather than only from close up. Hinged at the foot of the post, not the middle. */}
      <group ref={group} position={[0, 0.12, 0]}>
        <mesh position={[0, 0.55, 0]} castShadow>
          <cylinderGeometry args={[0.055, 0.06, 1.1, 8]} />
          <meshStandardMaterial color="#4a3722" roughness={0.9} />
        </mesh>
        <mesh ref={torso} position={[0, 0.93, 0]} castShadow>
          <capsuleGeometry args={[0.22, 0.3, 6, 12]} />
          <meshStandardMaterial
            color="#b8a071"
            roughness={0.95}
            emissive="#ffffff"
            emissiveIntensity={0}
            toneMapped={false}
          />
        </mesh>
        {/* Arms, so it reads as a figure at a glance in a dim room. */}
        <mesh position={[0, 1.05, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.045, 0.045, 0.8, 6]} />
          <meshStandardMaterial color="#4a3722" roughness={0.9} />
        </mesh>
      </group>

      <group ref={plate} position={[0, 1.72, 0]}>
        <mesh position={[0, 0.16, 0]}>
          <planeGeometry args={[nameplate.aspect * 0.11, 0.11]} />
          <meshBasicMaterial map={nameplate.texture} transparent toneMapped={false} />
        </mesh>
        <mesh ref={track} visible={false}>
          <planeGeometry args={[BAR_WIDTH, 0.045]} />
          <meshBasicMaterial color="#1a1512" toneMapped={false} />
        </mesh>
        <mesh ref={bar} position={[0, 0, 0.002]}>
          <planeGeometry args={[BAR_WIDTH, 0.045]} />
          <meshBasicMaterial color="#c8452f" toneMapped={false} />
        </mesh>
      </group>
    </group>
  )
}
