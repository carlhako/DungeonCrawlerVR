import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  AdditiveBlending,
  AnimationMixer,
  Color,
  Group,
  LoopOnce,
  LoopRepeat,
  Mesh,
  MeshStandardMaterial,
  type AnimationAction,
  type AnimationClip,
  type Material,
} from 'three'
import { ENEMIES, ENEMY_IDS, type EnemyDefinition, type EnemyId } from '@/data/enemies'
import { hasStatus } from '@/systems/combat/damage'
import {
  MODEL_WIND_GLOW,
  createAppearance,
  resolveAppearance,
  type EnemyAppearance,
} from '@/systems/enemies/appearance'
import { clipTimeScale, modelScale, planClip, selectClip } from '@/systems/enemies/animation'
import { cloneEnemyModel, getEnemyModel, subscribeEnemyModels } from '@/systems/enemies/models'
import type { Enemy } from '@/systems/enemies/pool'
import { injectDissolve, isTintable, type DissolveUniforms } from '@/entities/enemyMaterials'

/**
 * What an enemy is drawn as.
 *
 * Sprint 2.3 claimed that swapping a CC0 kit in would be "a change to `EnemyShape` alone", and
 * then did not write an `EnemyShape` — the primitives were inlined in `Enemies.tsx`. Sprint 2.7
 * is where that claim was tested, so this is the component it was promising: everything about
 * *what geometry appears* lives here, and `Enemies.tsx` is left holding only where the thing is
 * standing.
 *
 * Two bodies, one set of rules:
 *
 * - The **primitive** body from 2.3. Still the default, still what every slot draws when the
 *   kit is not on disk, and still the fallback for any enemy the pack has no model for.
 * - A **model** out of the kit, cloned once per pool slot per type at load time and hidden until
 *   its type occupies the slot. Nothing mounts, clones or compiles during a wave.
 *
 * The readability rules are not duplicated across the two. `resolveAppearance` decides what the
 * enemy looks like, both paths consume it, and the lean, the walk bob and the halo are applied
 * to groups *above* the swap — so a kit with an unreadable wind-up degrades to what the capsule
 * did rather than to nothing. PLAN.md: a model with a beautiful idle and an unreadable wind-up
 * is worse than the capsule.
 */

/** The height the primitive body is modelled at, before it is scaled to the type in the slot. */
const NOMINAL_HEIGHT = 1.8

/** How fast the walk bob cycles per metre per second of travel. */
const BOB_RATE = 5
const BOB_HEIGHT = 0.045

interface ModelInstance {
  id: EnemyId
  /** Parent of the clone. Visibility, scale and the kit's own offsets live on the clone. */
  root: Group
  mixer: AnimationMixer
  clips: Map<string, AnimationClip>
  clipNames: string[]
  /** Every material on the clone that can be told what colour to glow. */
  tints: MeshStandardMaterial[]
  /** Every material on the clone, dissolving. Not the same list: some materials cannot tint. */
  dissolve: DissolveUniforms[]
  /** All cloned materials, for disposal. */
  owned: Material[]
  action: AnimationAction | null
  /** The phase the current action was chosen for. A phase change re-plans, even to the same clip. */
  phase: Enemy['phase'] | null
}

export function EnemyShape({ enemy }: { enemy: Enemy }) {
  const lean = useRef<Group>(null)
  const primitive = useRef<Group>(null)
  const halo = useRef<Group>(null)
  const modelHost = useRef<Group>(null)

  /**
   * One set of materials per slot, created once and mutated in place.
   *
   * Both eyes share one material instance, which is the only way "the eyes flare together"
   * stays true without a second ref and a second copy of the same arithmetic.
   */
  const { materials, dissolve } = useMemo(() => {
    const built = {
      skin: new MeshStandardMaterial({
        color: '#8a8a8a',
        roughness: 0.85,
        emissive: new Color('#ffffff'),
        emissiveIntensity: 0,
        toneMapped: false,
      }),
      dark: new MeshStandardMaterial({ color: '#2a2622', roughness: 0.9 }),
      eyes: new MeshStandardMaterial({
        color: '#ffffff',
        emissive: new Color('#ff5522'),
        emissiveIntensity: 2,
        toneMapped: false,
      }),
      halo: new MeshStandardMaterial({
        color: '#ff8855',
        transparent: true,
        opacity: 0.1,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    }

    // Only the solid parts dissolve. The eyes and the halo are light rather than body, and
    // light does not crumble — they fade, which is also what keeps the last thing visible on a
    // dying enemy the pair of eyes going out.
    return {
      materials: built,
      dissolve: [injectDissolve(built.skin), injectDissolve(built.dark)],
    }
  }, [])

  useEffect(() => {
    return () => {
      for (const material of Object.values(materials)) material.dispose()
    }
  }, [materials])

  const instances = useRef(new Map<EnemyId, ModelInstance>()).current

  /**
   * Clones arrive when the loader says so, and never again after that.
   *
   * Every type gets a clone in every slot, up front, rather than one built when a type first
   * occupies the slot: the second is a `SkeletonUtils.clone` plus a material compile at the
   * moment a skeleton walks round a corner, which is the hitch this whole file is arranged to
   * avoid. Geometry and textures are shared between clones, so what a spare clone costs is a
   * skeleton and a hidden object, and three does not draw what it cannot see.
   */
  useEffect(() => {
    function sync() {
      const host = modelHost.current
      if (!host) return
      for (const id of ENEMY_IDS) {
        if (instances.has(id)) continue
        const instance = buildInstance(id)
        if (!instance) continue
        instances.set(id, instance)
        host.add(instance.root)
      }
    }

    sync()
    const unsubscribe = subscribeEnemyModels(sync)

    return () => {
      unsubscribe()
      for (const instance of instances.values()) {
        instance.mixer.stopAllAction()
        instance.root.removeFromParent()
        for (const material of instance.owned) material.dispose()
      }
      instances.clear()
    }
  }, [instances])

  // Nothing here goes through React. The pool is mutated in place by the fixed loop and read on
  // the render frame — sixty AI decisions a second must not touch a scene graph.
  const bob = useRef(0)
  const appearance = useRef<EnemyAppearance>(createAppearance()).current

  useFrame((state, delta) => {
    if (!enemy.active || !enemy.type) return
    const definition = ENEMIES[enemy.type]

    const speed = Math.hypot(enemy.velocity.x, enemy.velocity.z)
    resolveAppearance(
      appearance,
      {
        phase: enemy.phase,
        timer: enemy.timer,
        flash: enemy.flash,
        burning: hasStatus(enemy.target.statuses, 'burning'),
        chilled: hasStatus(enemy.target.statuses, 'chilled'),
        speed,
        seed: enemy.seed,
      },
      definition,
      state.clock.elapsedTime,
    )

    // The lean and the bob sit above the swap, so they apply to whichever body is drawn. The
    // telegraph rearing back is the read the player's survival depends on and it is not being
    // handed to an art asset.
    const tilt = lean.current
    if (tilt) {
      tilt.rotation.x = appearance.lean
      if (appearance.dying > 0) {
        tilt.position.y = 0
      } else {
        // A walking bob whose speed follows how fast it is actually moving, so a chilled enemy
        // visibly labours. `seed` keeps a pack out of lockstep.
        bob.current += delta * speed * BOB_RATE
        tilt.position.y = Math.abs(Math.sin(bob.current + enemy.seed)) * BOB_HEIGHT
      }
    }

    const instance = instances.get(enemy.type) ?? null

    if (primitive.current) {
      primitive.current.visible = instance === null
      primitive.current.scale.setScalar(definition.height / NOMINAL_HEIGHT)
    }
    // The halo belongs to both bodies. It is the thing that makes an enemy visible before the
    // torchlight reaches it, and a kit does not ship one.
    if (halo.current) halo.current.scale.setScalar(definition.height / NOMINAL_HEIGHT)

    for (const other of instances.values()) other.root.visible = other === instance

    if (instance) {
      applyModel(instance, appearance, definition, enemy, speed, delta)
    } else {
      applyPrimitive(materials, dissolve, appearance)
    }

    materials.halo.opacity = appearance.haloOpacity
  })

  return (
    <group ref={lean}>
      <group ref={primitive}>
        <mesh position={[0, 0.95, 0]} castShadow material={materials.skin}>
          <capsuleGeometry args={[0.3, 0.7, 6, 12]} />
        </mesh>

        {/* Head, set forward a little so the silhouette has a direction to it. */}
        <mesh position={[0, 1.62, -0.04]} castShadow material={materials.dark}>
          <sphereGeometry args={[0.19, 10, 8]} />
        </mesh>

        <mesh position={[-0.075, 1.65, -0.2]} material={materials.eyes}>
          <sphereGeometry args={[0.035, 8, 6]} />
        </mesh>
        <mesh position={[0.075, 1.65, -0.2]} material={materials.eyes}>
          <sphereGeometry args={[0.035, 8, 6]} />
        </mesh>

        {/* Arms, so it reads as a figure rather than a pillar. */}
        <mesh
          position={[0, 1.25, 0]}
          rotation={[0, 0, Math.PI / 2]}
          castShadow
          material={materials.dark}
        >
          <cylinderGeometry args={[0.055, 0.055, 0.78, 6]} />
        </mesh>
      </group>

      <group ref={modelHost} />

      <group ref={halo}>
        <mesh position={[0, 1.0, 0]} material={materials.halo}>
          <sphereGeometry args={[0.75, 10, 8]} />
        </mesh>
      </group>
    </group>
  )
}

type PrimitiveMaterials = {
  skin: MeshStandardMaterial
  dark: MeshStandardMaterial
  eyes: MeshStandardMaterial
  halo: MeshStandardMaterial
}

function applyPrimitive(
  materials: PrimitiveMaterials,
  dissolve: DissolveUniforms[],
  appearance: EnemyAppearance,
) {
  for (const uniforms of dissolve) uniforms.uDissolve.value = appearance.dissolve

  materials.skin.color.set(appearance.colour)
  materials.skin.emissive.set(appearance.emissive)
  materials.skin.emissiveIntensity = appearance.emissiveIntensity

  materials.eyes.emissiveIntensity = appearance.eyeIntensity
  materials.eyes.opacity = appearance.eyeOpacity
  materials.eyes.transparent = appearance.eyeOpacity < 1
}

function applyModel(
  instance: ModelInstance,
  appearance: EnemyAppearance,
  definition: EnemyDefinition,
  enemy: Enemy,
  speed: number,
  delta: number,
) {
  for (const uniforms of instance.dissolve) uniforms.uDissolve.value = appearance.dissolve

  // The model keeps its own albedo — the kit's textures are the whole reason it is here, and
  // painting the definition's flat colour over them would make three creatures out of one. The
  // state speaks through emissive instead, which is also the channel the hit flash, the burn and
  // the chill already used on the capsule.
  const intensity = appearance.emissiveIntensity + appearance.wind * MODEL_WIND_GLOW
  for (const material of instance.tints) {
    material.emissive.set(appearance.emissive)
    material.emissiveIntensity = intensity
  }

  if (instance.phase !== enemy.phase) {
    retarget(instance, definition, enemy, speed)
    instance.phase = enemy.phase
  } else if (enemy.phase === 'chase' && instance.action) {
    // The only rate that keeps moving after the plan is made. A chilled enemy has to look
    // chilled, and its speed changes without its phase changing.
    instance.action.timeScale = clipTimeScale('chase', definition, { speed, duration: 1 })
  }

  // Clip playback is visual and is driven on the render frame, at real time. No AI decision
  // waits on it — see `animation.ts`.
  instance.mixer.update(delta)
}

function retarget(
  instance: ModelInstance,
  definition: EnemyDefinition,
  enemy: Enemy,
  speed: number,
) {
  const spec = ENEMIES[instance.id].model
  if (!spec) return

  // Resolved twice on purpose: the clip has to be known before its duration can be measured,
  // and the duration is what a phase window is fitted to.
  const name = selectClip(enemy.phase, spec.clips, instance.clipNames)
  const clip = name ? instance.clips.get(name) : undefined
  const plan = planClip(enemy.phase, spec.clips, instance.clipNames, definition, {
    speed,
    duration: clip?.duration ?? 0,
  })

  if (!plan.clip || !clip) {
    // Nothing in the kit for this phase. The procedural channel already has it.
    instance.action?.fadeOut(0.12)
    instance.action = null
    return
  }

  const previous = instance.action
  const next = instance.mixer.clipAction(clip)
  next.reset()
  next.setLoop(plan.loop ? LoopRepeat : LoopOnce, Infinity)
  next.clampWhenFinished = !plan.loop
  next.timeScale = plan.timeScale
  next.play()

  if (previous && previous !== next && plan.fade > 0) {
    next.crossFadeFrom(previous, plan.fade, true)
  } else if (previous && previous !== next) {
    previous.stop()
  }

  instance.action = next
}

function buildInstance(id: EnemyId): ModelInstance | null {
  const model = getEnemyModel(id)
  const clone = cloneEnemyModel(id)
  if (!model || !clone) return null

  const definition = ENEMIES[id]
  const spec = model.spec

  // A kit's own scale is an accident of whoever exported it; the definition's height is what
  // every readability decision in the game was tuned against, including "a Skulker is small".
  clone.scale.setScalar(modelScale(spec.sourceHeight, definition.height))
  clone.position.y = spec.yOffset ?? 0
  clone.rotation.y = spec.yawOffset ?? 0

  const tints: MeshStandardMaterial[] = []
  const dissolve: DissolveUniforms[] = []
  const owned: Material[] = []

  clone.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = false

    // Materials are shared by the clone, and every one of the writes below is per-enemy: one
    // skeleton taking a hit would flash the whole wave white.
    const source = mesh.material
    const replace = (material: Material) => {
      const copy = material.clone()
      owned.push(copy)
      dissolve.push(injectDissolve(copy))
      if (isTintable(copy)) tints.push(copy)
      return copy
    }
    mesh.material = Array.isArray(source) ? source.map(replace) : replace(source)
  })

  const root = new Group()
  root.visible = false
  root.add(clone)

  const clips = new Map<string, AnimationClip>()
  for (const clip of model.clips) clips.set(clip.name, clip)

  return {
    id,
    root,
    mixer: new AnimationMixer(clone),
    clips,
    clipNames: model.clipNames,
    tints,
    dissolve,
    owned,
    action: null,
    phase: null,
  }
}
