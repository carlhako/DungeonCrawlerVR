import { useEffect, useRef } from 'react'
import { createPortal, useFrame, useThree } from '@react-three/fiber'
import { useXR } from '@react-three/xr'
import type { Group, Mesh, MeshStandardMaterial } from 'three'
import { ELEMENT_COLOUR } from '@/data/elements'
import { WEAPONS, weaponStats, type Hand, type WeaponId } from '@/data/weapons'
import { cooldownProgress } from '@/systems/combat/resources'
import { handWeapons, manaPool } from '@/systems/combat/state'
import { setWeaponRig } from '@/systems/combat/rigs'
import { useGame } from '@/systems/game'
import { slotOf, useSettings } from '@/systems/settings'

/**
 * The weapon in a hand: what you see, and the anchor everything else measures from.
 *
 * Two mounts, one job. In VR the rig hangs off a tracked controller pose; on desktop it is a
 * viewmodel parented to the camera. Both publish an anchor through `rigs.ts`, and the combat
 * driver reads that anchor without knowing or caring which one it got — the same "one focus
 * model for both modes" argument the interaction system makes.
 *
 * **Which pose a weapon hangs off depends on how you hold it.** A wand is *pointed*, so it
 * mounts in the controller's target-ray space, along the same line as the pointer beam — a
 * wand that fired down the grip's axis would shoot at the floor, which is exactly the defect
 * the beam had in Sprint 1.3. A blade is an *extension of the fist*, so it mounts in grip
 * space and sticks out along the controller's own body.
 *
 * Built from primitives at real scale, like the foyer and the dungeon. The CC0 art kit is
 * still a deliberate gap; a weapon is a mesh and a colour here, and swapping in a model is a
 * change to `WeaponModel` alone.
 */

/** Where a wand's muzzle sits ahead of the hand, in metres. */
const MUZZLE_OFFSET = 0.28

export function VRWeaponRig({
  handedness,
  mount,
}: {
  handedness: 'left' | 'right'
  /** Which tracked space this instance is rendered inside. */
  mount: 'grip' | 'ray'
}) {
  const mainHand = useSettings((state) => state.mainHand)
  const slot = slotOf(handedness, mainHand)
  const weaponId = useGame((state) => (slot ? state.save.equipped[slot] : null))

  const definition = weaponId ? WEAPONS[weaponId] : null
  const wanted = definition?.archetype === 'melee' ? 'grip' : 'ray'

  // Every controller renders both mounts; only the one matching how this weapon is held
  // draws anything. Cheaper and far less error-prone than deciding in the parent, which
  // would have the controller component reading the save.
  if (!slot || !definition || wanted !== mount) return null

  return <WeaponRigBody slot={slot} weaponId={definition.id} />
}

/**
 * The desktop viewmodel: both hands' weapons, hanging off the camera.
 *
 * Portalled into the camera rather than positioned from it every frame. The camera is moved
 * by `PlayerRig` on the render frame; a viewmodel that copied its transform afterwards would
 * be a frame behind and would visibly swim as the player turns. Parenting is the same rule
 * the pointer beam ended up at, for the same reason.
 */
export function DesktopWeaponRig() {
  const camera = useThree((state) => state.camera)
  const scene = useThree((state) => state.scene)
  const inSession = useXR((state) => state.session != null)
  const equipped = useGame((state) => state.save.equipped)

  /**
   * R3F's default camera is **not** in the scene graph.
   *
   * three only draws what it can reach from the scene root, so a viewmodel portalled into
   * the camera has its world matrix computed correctly — the combat driver reads it and
   * fires from exactly the right place — and is never rendered. The weapon worked and was
   * invisible, which is the most confusing possible pair of symptoms. Putting the camera in
   * the scene costs nothing: a camera draws nothing itself.
   */
  useEffect(() => {
    if (camera.parent === scene) return
    scene.add(camera)
    return () => {
      scene.remove(camera)
    }
  }, [camera, scene])

  // In a session the controllers own the weapons and the camera belongs to the headset.
  // Leaving a viewmodel welded to the player's face would be both.
  if (inSession) return null

  return createPortal(
    <>
      {(['main', 'off'] as const).map((slot) =>
        equipped[slot] ? (
          <WeaponRigBody key={slot} slot={slot} weaponId={equipped[slot]!} desktop />
        ) : null,
      )}
    </>,
    camera,
  )
}

/**
 * Rest pose of each desktop viewmodel, in camera space.
 *
 * Held closer to the eye line than a viewmodel usually is, and deliberately. A bolt leaves
 * the muzzle travelling *parallel* to the view rather than converging on the crosshair, so
 * every centimetre the muzzle sits away from the eye is a centimetre the shot lands away
 * from what the player aimed at, at every range. At 18cm off-axis against a 34cm target that
 * is comfortably inside the hit sphere; at the 24cm it started as, it was marginal.
 *
 * The alternative — toeing each weapon in towards a convergence distance — is what a shooter
 * does, and it trades a constant small error for one that is zero at exactly one range and
 * worse everywhere else. Not worth it for a game fought at three metres in the dark.
 */
const DESKTOP_REST: Record<Hand, [number, number, number]> = {
  main: [0.2, -0.24, -0.55],
  off: [-0.2, -0.24, -0.55],
}

/**
 * How much smaller a weapon is drawn on a monitor than in a headset.
 *
 * At full scale the wand is a real 30cm object held 55cm from a 70° camera, which is exactly
 * what it would look like held 55cm from your face: it filled a quarter of the screen. In VR
 * that is correct and unremarkable, because your eyes and your arm agree about how far away
 * it is; on a monitor there is no such agreement and it just reads as a comedy prop.
 *
 * Only the *drawing* is scaled. The anchor is a transform, and its position — which is where
 * bolts leave from and where the blade's tip is measured — is unaffected by the scale it
 * applies to its children.
 */
const DESKTOP_SCALE = 0.5

/**
 * How long a desktop swing takes, and how far the tip travels.
 *
 * These two numbers are the whole of the desktop melee "animation", and they are chosen so
 * the *same* speed rule applies in both modes: 1.15m in 0.24s averages a little under 5 m/s,
 * which clears `MELEE_FULL_SPEED` around the middle of the arc and falls below
 * `MELEE_MIN_SPEED` at both ends. That is the active hitbox window — not a separate flag,
 * just the blade actually moving fast enough, exactly as in VR.
 */
const SWING_SECONDS = 0.3
const SWING_REACH = 0.55

/**
 * How far the cut falls, in metres.
 *
 * It goes **down**, and that is not a stylistic choice. The viewmodel hangs a little below
 * the eye at 1.6m; an enemy's hit sphere is centred at chest height, around 1.05m, and
 * reaches to about 1.47m. A swing that arced upwards — which is what this did first — passed
 * cleanly over the top of everything it was aimed at while looking perfectly convincing.
 */
const SWING_FALL = 0.85

/**
 * How far the cut reaches forward, in metres.
 *
 * The number that decides whether desktop melee works at all. A VR player's arm plus a
 * 85cm blade puts the tip a metre and a half from their chest; a desktop viewmodel starts
 * 55cm from the eye and only goes where this sends it. At 0.6 the tip passes about 0.9m
 * ahead of the player at the middle of the swing, which reaches something standing at
 * arm's length — the closest a capsule with a 30cm radius can get to a dummy on a 40cm base.
 */
const SWING_LUNGE = 0.6

function WeaponRigBody({
  slot,
  weaponId,
  desktop = false,
}: {
  slot: Hand
  weaponId: WeaponId
  desktop?: boolean
}) {
  const anchor = useRef<Group>(null)
  const glow = useRef<MeshStandardMaterial>(null)
  const manaFill = useRef<Mesh>(null)
  const definition = WEAPONS[weaponId]
  const melee = definition.archetype === 'melee'
  const reach = definition.reach ?? 0.6
  const rate = weaponStats(weaponId).rate

  useEffect(() => {
    setWeaponRig(slot, anchor.current, true)
    return () => setWeaponRig(slot, null, false)
  }, [slot, weaponId])

  // The desktop swing. Visual-only in the sense that nothing here decides damage — it moves
  // the anchor, and the melee tracker measures whatever the anchor did, which is the same
  // thing it does with a real arm in VR.
  const swing = useRef({ active: false, t: 0 })
  useEffect(() => {
    if (!desktop || !melee) return
    return subscribeSwing(slot, () => {
      swing.current.active = true
      swing.current.t = 0
    })
  }, [desktop, melee, slot])

  useFrame((_state, delta) => {
    /**
     * The weapon *is* the HUD.
     *
     * A wand's tip dims while it is cooling and brightens when it is ready; a blade's edge
     * does the same. Nothing else in this game is non-diegetic except the dev map, and a
     * floating cooldown wheel in a horror game is a small tax on every second of it. The
     * readout is also always where the player is already looking — at the thing they are
     * pointing.
     */
    const ready = cooldownProgress(handWeapons[slot].cooldown, rate)
    if (glow.current) {
      const base = melee ? 0.45 : 5
      // Never fully dark: an unlit weapon in a dark corridor is a weapon you cannot find.
      glow.current.emissiveIntensity = base * (0.25 + 0.75 * ready)
    }

    // The mana bar rides the weapon too, and only on something that spends mana. A bar
    // reading 100% forever next to a sword teaches the player to ignore it.
    if (manaFill.current) {
      const fraction = Math.max(0, Math.min(1, manaPool.current / manaPool.max))
      manaFill.current.scale.x = Math.max(0.001, fraction)
      manaFill.current.position.x = -(1 - fraction) * MANA_BAR_WIDTH * 0.5
    }

    const group = anchor.current
    if (!group || !desktop) return

    const rest = DESKTOP_REST[slot]
    if (!melee || !swing.current.active) {
      group.position.set(rest[0], rest[1], rest[2])
      group.rotation.set(0, 0, 0)
      return
    }

    swing.current.t += delta / SWING_SECONDS
    if (swing.current.t >= 1) {
      swing.current.active = false
      swing.current.t = 0
      group.position.set(rest[0], rest[1], rest[2])
      group.rotation.set(0, 0, 0)
      return
    }

    // A diagonal downward cut: high and out on the weapon's own side, falling across to the
    // other. The sideways sweep is cosine-shaped so the tip is slowest at both ends and
    // fastest in the middle — where a real swing lands, and where the speed rule wants the
    // damage — and the lunge in z is what puts the tip within reach of something standing in
    // front of the player rather than swiping the air by their chest.
    const t = swing.current.t
    const side = slot === 'main' ? 1 : -1
    const phase = Math.PI * t
    group.position.set(
      rest[0] + side * SWING_REACH * Math.cos(phase),
      rest[1] + SWING_FALL * (0.35 - t),
      rest[2] - SWING_LUNGE * Math.sin(phase),
    )
    group.rotation.set(0, 0, side * (0.9 - 1.8 * t))
  })

  return (
    <group
      ref={anchor}
      position={
        desktop
          ? DESKTOP_REST[slot]
          : melee
            ? [0, 0, -reach]
            : [0, 0, -MUZZLE_OFFSET]
      }
    >
      <group scale={desktop ? DESKTOP_SCALE : 1}>
        <WeaponModel weaponId={weaponId} glow={glow} />
        {definition.manaCost > 0 && <ManaBar reach={reach} melee={melee} fill={manaFill} />}
      </group>
    </group>
  )
}

/** Width of the mana bar on a weapon, in metres. Small: it is read at arm's length. */
const MANA_BAR_WIDTH = 0.09

/**
 * Mana, drawn on the weapon that spends it.
 *
 * Set back towards the hand and tilted up, so it faces the player holding it rather than
 * whatever they are pointing at. Small enough to be glanced at: a bar large enough to read
 * from across the room would be a bar in the way of the room.
 */
function ManaBar({
  reach,
  melee,
  fill,
}: {
  reach: number
  melee: boolean
  fill: React.RefObject<Mesh | null>
}) {
  const z = melee ? reach - 0.05 : 0.26

  return (
    <group position={[0, 0.035, z]} rotation={[-Math.PI / 2.6, 0, 0]}>
      <mesh>
        <planeGeometry args={[MANA_BAR_WIDTH, 0.012]} />
        <meshBasicMaterial color="#141a24" toneMapped={false} />
      </mesh>
      <mesh ref={fill} position={[0, 0, 0.001]}>
        <planeGeometry args={[MANA_BAR_WIDTH, 0.012]} />
        <meshBasicMaterial color="#4fb0ff" toneMapped={false} />
      </mesh>
    </group>
  )
}

/**
 * The weapon itself, drawn *behind* the anchor.
 *
 * The anchor is the business end — the muzzle, or the tip — because that is the point every
 * other system asks about. So the geometry extends backwards along +Z from the origin,
 * towards the hand holding it.
 */
function WeaponModel({
  weaponId,
  glow,
}: {
  weaponId: WeaponId
  /** The material whose emissive intensity reports the cooldown. */
  glow: React.RefObject<MeshStandardMaterial | null>
}) {
  const definition = WEAPONS[weaponId]
  const colour = ELEMENT_COLOUR[definition.element]

  if (definition.archetype === 'melee') {
    const reach = definition.reach ?? 0.6
    return (
      <group>
        {/* Blade, from the tip back towards the crossguard. */}
        <mesh position={[0, 0, (reach - 0.16) / 2]} castShadow>
          <boxGeometry args={[0.055, 0.014, reach - 0.16]} />
          <meshStandardMaterial
            ref={glow}
            color="#c9d6e0"
            emissive={colour}
            emissiveIntensity={0.45}
            metalness={0.85}
            roughness={0.25}
            toneMapped={false}
          />
        </mesh>
        {/* Crossguard and grip. */}
        <mesh position={[0, 0, reach - 0.15]}>
          <boxGeometry args={[0.17, 0.03, 0.035]} />
          <meshStandardMaterial color="#4a4038" metalness={0.6} roughness={0.5} />
        </mesh>
        <mesh position={[0, 0, reach - 0.07]}>
          <cylinderGeometry args={[0.021, 0.024, 0.13, 8]} />
          <meshStandardMaterial color="#2c241c" roughness={0.9} />
        </mesh>
      </group>
    )
  }

  return (
    <group>
      {/* The lit tip, at the anchor. Emissive rather than a light: the same rule the torches
          follow, and a light per hand is two more of the most expensive thing in the scene. */}
      <mesh>
        <sphereGeometry args={[0.032, 10, 8]} />
        <meshStandardMaterial
          ref={glow}
          color="#fff0dc"
          emissive={colour}
          emissiveIntensity={5}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0, 0, 0.16]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.014, 0.022, 0.3, 8]} />
        <meshStandardMaterial color="#3a2b1d" roughness={0.85} />
      </mesh>
    </group>
  )
}

/**
 * The desktop swing trigger.
 *
 * A tiny subscription rather than shared state, because the driver decides *whether* a swing
 * happens (mouse pressed, weapon is melee) and the rig owns *what it looks like*. Routing it
 * through a store would re-render the scene graph on every click.
 */
type SwingListener = () => void
const swingListeners = new Map<Hand, Set<SwingListener>>()

export function subscribeSwing(slot: Hand, listener: SwingListener): () => void {
  const set = swingListeners.get(slot) ?? new Set()
  set.add(listener)
  swingListeners.set(slot, set)
  return () => set.delete(listener)
}

/** Called by the combat driver when a desktop attack button is pressed on a melee weapon. */
export function requestSwing(slot: Hand): void {
  for (const listener of swingListeners.get(slot) ?? []) listener()
}
