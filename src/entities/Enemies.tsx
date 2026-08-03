import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending, Color, Group, MeshStandardMaterial } from 'three'
import type { IUniform } from 'three'
import { CORPSE_SECONDS, ENEMIES, SPAWN_SECONDS } from '@/data/enemies'
import { hasStatus } from '@/systems/combat/damage'
import { dissolveAmount } from '@/systems/fx/dissolve'
import type { Enemy } from '@/systems/enemies/pool'
import { enemyPool } from '@/systems/enemies/state'

/**
 * Enemies, as things you can see.
 *
 * One group per pool slot, mounted once and hidden when the slot is empty. Nothing mounts or
 * unmounts during a wave — the same argument the pools themselves make, and it matters more
 * here: mounting a mesh compiles or looks up a material, and doing that at the moment a
 * skeleton comes round a corner is a hitch exactly when the player is least able to afford it.
 *
 * Built from primitives at real scale, like the foyer, the dungeon and the weapons. PLAN.md
 * had GLTF models with Mixamo clips landing here; that is the deliberate art gap this project
 * has been carrying since Sprint 1.1, and swapping a kit in is a change to `EnemyShape` alone.
 * What is **not** deferred is the thing those animations were there to do — every state the AI
 * can be in has to be readable across a dark room. That is what the lean, the bob and the eyes
 * below are for, and it is why the telegraph gets three separate visual channels.
 *
 * **There are no health bars.** Three floating red bars advancing on you down a corridor is a
 * strategy game, not a horror one, and the player already learns what they did from the damage
 * numbers and the hit flash. The training dummies have bars because a dummy exists to be
 * measured against; an enemy exists to be frightening.
 */

/** How far an enemy rears back at the top of its wind-up, in radians. */
const TELEGRAPH_LEAN = 0.45

/** How far a corpse sinks into the floor before its slot is recycled, in metres. */
const CORPSE_SINK = 0.9

/** The height every slot is modelled at, before it is scaled to the type it is holding. */
const NOMINAL_HEIGHT = 1.8

/**
 * The dissolve, injected into three's standard material rather than replacing it.
 *
 * A body that arrives or leaves by fading its opacity is a transparent body: it sorts against
 * every other transparent surface in the scene, it stops writing depth, and in a corridor lit
 * by six torches it reads as a ghost rather than as a thing appearing. A dissolve stays fully
 * opaque throughout — fragments are either there or discarded — so nothing sorts, and the
 * burning edge gives the effect a direction, which is what makes materialising and dying read
 * as opposites rather than as the same fade played backwards.
 *
 * `onBeforeCompile` because the alternative is reimplementing three's lighting in a
 * `ShaderMaterial`, and this model still wants to be lit by the torches around it. The cache
 * key is what stops three sharing a compiled program between the dissolving and plain
 * variants of the same material — without it, the injection silently applies to neither or
 * both depending on which compiled first.
 */
function withDissolve(material: MeshStandardMaterial, edge: string) {
  const uniforms: { uDissolve: IUniform<number>; uEdge: IUniform<Color> } = {
    uDissolve: { value: 0 },
    uEdge: { value: new Color(edge) },
  }

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDissolve = uniforms.uDissolve
    shader.uniforms.uEdge = uniforms.uEdge

    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vDissolvePosition;\nvoid main() {')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vDissolvePosition = position;',
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        /* glsl */ `
        uniform float uDissolve;
        uniform vec3 uEdge;
        varying vec3 vDissolvePosition;

        float dcvrHash(vec3 p) {
          return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        }

        // Value noise, trilinearly interpolated. Cheap, and smooth enough that the edge reads
        // as burning across the body rather than as a checkerboard of discarded pixels.
        float dcvrNoise(vec3 p) {
          vec3 i = floor(p);
          vec3 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float n000 = dcvrHash(i);
          float n100 = dcvrHash(i + vec3(1.0, 0.0, 0.0));
          float n010 = dcvrHash(i + vec3(0.0, 1.0, 0.0));
          float n110 = dcvrHash(i + vec3(1.0, 1.0, 0.0));
          float n001 = dcvrHash(i + vec3(0.0, 0.0, 1.0));
          float n101 = dcvrHash(i + vec3(1.0, 0.0, 1.0));
          float n011 = dcvrHash(i + vec3(0.0, 1.0, 1.0));
          float n111 = dcvrHash(i + vec3(1.0, 1.0, 1.0));
          return mix(
            mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
            mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
            f.z
          );
        }

        void main() {`,
      )
      // Sampled in *object* space, so the pattern is welded to the body and does not swim
      // across it as the thing walks or falls over.
      .replace(
        '#include <dithering_fragment>',
        /* glsl */ `
        float dcvrThreshold = dcvrNoise(vDissolvePosition * 7.0);
        if (uDissolve > 0.0 && dcvrThreshold < uDissolve) discard;
        // The band just ahead of the threshold glows, so the dissolve has a burning edge.
        float dcvrEdge = uDissolve > 0.0
          ? smoothstep(uDissolve + 0.16, uDissolve, dcvrThreshold)
          : 0.0;
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uEdge * 2.4, dcvrEdge);
        #include <dithering_fragment>`,
      )
  }

  material.customProgramCacheKey = () => 'dcvr-dissolve'
  return uniforms
}

export function Enemies() {
  return (
    <>
      {enemyPool.items.map((enemy) => (
        <EnemyBody key={enemy.slot} enemy={enemy} />
      ))}
    </>
  )
}

function EnemyBody({ enemy }: { enemy: Enemy }) {
  const root = useRef<Group>(null)
  const lean = useRef<Group>(null)
  const scale = useRef<Group>(null)

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
    // light does not crumble — they fade, which is also what keeps the last thing visible on
    // a dying enemy the pair of eyes going out.
    return {
      materials: built,
      dissolve: [withDissolve(built.skin, '#ff7a2a'), withDissolve(built.dark, '#ff7a2a')],
    }
  }, [])

  useEffect(() => {
    return () => {
      for (const material of Object.values(materials)) material.dispose()
    }
  }, [materials])

  // Nothing here goes through React. The pool is mutated in place by the fixed loop and read
  // on the render frame — sixty AI decisions a second must not touch a scene graph.
  const bob = useRef(0)

  useFrame((state, delta) => {
    const group = root.current
    if (!group) return

    group.visible = enemy.active
    if (!enemy.active || !enemy.type) return

    const definition = ENEMIES[enemy.type]

    // Feet on the floor. The record's position is the hit sphere's centre, at chest height —
    // one authoritative position, with the drawing hanging off it rather than beside it.
    group.position.set(enemy.position.x, enemy.position.y - definition.centre, enemy.position.z)
    group.rotation.y = enemy.yaw

    // Arriving and dying are both fades, and both are why the slot is not hittable at the
    // time. Something that pops into existence is a startle with no information in it;
    // something that vanishes on the frame it dies leaves the player unsure they killed it.
    const arriving = enemy.phase === 'spawning' ? Math.min(1, enemy.timer / SPAWN_SECONDS) : 1
    const dying = enemy.phase === 'dying' ? Math.min(1, enemy.timer / CORPSE_SECONDS) : 0
    const presence = arriving * (1 - dying)
    group.position.y -= dying * CORPSE_SINK

    // The body itself arrives and leaves by dissolving rather than by fading — see
    // `withDissolve`. The eyes and the halo still use `presence`, below.
    const amount = dissolveAmount({
      phase: enemy.phase,
      timer: enemy.timer,
      spawnSeconds: SPAWN_SECONDS,
      corpseSeconds: CORPSE_SECONDS,
    })
    for (const uniforms of dissolve) uniforms.uDissolve.value = amount

    if (scale.current) scale.current.scale.setScalar(definition.height / NOMINAL_HEIGHT)

    const tilt = lean.current
    if (tilt) {
      if (dying > 0) {
        // Corpses fall over, hinged at the feet like the training dummies.
        tilt.rotation.x = -1.4 * Math.min(1, dying * 3)
        tilt.position.y = 0
      } else {
        // The telegraph, made visible. It rears back through the wind-up and is furthest back
        // at the moment it commits — the read the player has to be able to make from six
        // metres away in the dark, and the whole reason the wind-up exists.
        const wind =
          enemy.phase === 'telegraph' ? Math.min(1, enemy.timer / definition.telegraph) : 0
        const swinging = enemy.phase === 'strike' || enemy.phase === 'recover'
        const follow = swinging ? Math.max(0, 1 - enemy.timer * 5) : 0
        const flinch = enemy.phase === 'stagger' ? 0.35 : 0
        tilt.rotation.x = TELEGRAPH_LEAN * wind - 0.7 * follow + flinch

        // A walking bob whose speed follows how fast it is actually moving, so a chilled
        // enemy visibly labours. `seed` keeps a pack out of lockstep.
        const speed = Math.hypot(enemy.velocity.x, enemy.velocity.z)
        bob.current += delta * speed * 5
        tilt.position.y = Math.abs(Math.sin(bob.current + enemy.seed)) * 0.045
      }
    }

    const burning = hasStatus(enemy.target.statuses, 'burning')
    const chilled = hasStatus(enemy.target.statuses, 'chilled')
    materials.skin.color.set(definition.colour)
    materials.skin.emissive.set(
      enemy.flash > 0 ? '#ffffff' : burning ? '#ff6a1f' : chilled ? '#8fd8ff' : definition.colour,
    )
    materials.skin.emissiveIntensity =
      (enemy.flash > 0 ? 2.6 : definition.glow) + (burning ? 0.5 : 0) + (chilled ? 0.2 : 0)

    // The eyes carry the state, and they are the most informative thing on the model. The
    // dungeon is lit by six torches, and something approaching between two of them is
    // otherwise genuinely invisible — which is not tension, it is the game failing to say
    // anything at all.
    const winding = enemy.phase === 'telegraph' ? Math.min(1, enemy.timer / definition.telegraph) : 0
    const flicker = 0.9 + 0.1 * Math.sin(state.clock.elapsedTime * 2 + enemy.seed)
    materials.eyes.emissiveIntensity = (2.2 + 9 * winding) * flicker * presence
    materials.eyes.opacity = presence
    materials.eyes.transparent = presence < 1

    // A soft additive glow, for the same reason the torches have one: visible at any distance
    // for the cost of one draw, so a corridor tells you something is in it before the light
    // reaches it. It swells with the wind-up too.
    materials.halo.opacity = 0.1 * presence * (1 + winding * 1.4)
  })

  return (
    <group ref={root} visible={false}>
      <group ref={lean}>
        <group ref={scale}>
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
          <mesh position={[0, 1.25, 0]} rotation={[0, 0, Math.PI / 2]} castShadow material={materials.dark}>
            <cylinderGeometry args={[0.055, 0.055, 0.78, 6]} />
          </mesh>

          <mesh position={[0, 1.0, 0]} material={materials.halo}>
            <sphereGeometry args={[0.75, 10, 8]} />
          </mesh>
        </group>
      </group>
    </group>
  )
}
