/**
 * The dissolve, and the rule that everything an enemy is drawn with goes through it.
 *
 * Sprint 2.6 wrote this as a private helper inside `Enemies.tsx`, where it only ever met four
 * materials we had built ourselves. Sprint 2.7 gives an enemy a body out of a CC0 kit, which
 * means the materials are now somebody else's — and PLAN.md names this as the most likely thing
 * in that sprint to break silently. It would, too: a skeleton whose imported material never got
 * the injection dies by blinking out of existence, with nothing in the console and every test
 * still green.
 *
 * So the injection lives in one exported function, and both the primitive path and the model
 * path call it. If a material is drawn for an enemy and has not been through here, that is the
 * bug.
 */

import { Color, Material, Mesh, MeshStandardMaterial, type Object3D } from 'three'
import type { IUniform } from 'three'
import type { EnemyDefinition } from '@/data/enemies'

export interface DissolveUniforms {
  uDissolve: IUniform<number>
  uEdge: IUniform<Color>
}

/** The colour the burning edge glows. Ember, because that is what a body comes apart into. */
export const DISSOLVE_EDGE = '#ff7a2a'

/**
 * Injects the dissolve into a material, in place, and returns the handle that drives it.
 *
 * A body that arrives or leaves by fading its opacity is a transparent body: it sorts against
 * every other transparent surface in the scene, it stops writing depth, and in a corridor lit by
 * six torches it reads as a ghost rather than as a thing appearing. A dissolve stays fully
 * opaque throughout — fragments are either there or discarded — so nothing sorts, and the
 * burning edge gives the effect a direction, which is what makes materialising and dying read
 * as opposites rather than as the same fade played backwards.
 *
 * `onBeforeCompile` because the alternative is reimplementing three's lighting in a
 * `ShaderMaterial`, and an enemy still wants to be lit by the torches around it. The cache key
 * is what stops three sharing a compiled program between the dissolving and plain variants of
 * the same material — without it, the injection silently applies to neither or both depending
 * on which compiled first.
 */
export function injectDissolve(material: Material, edge = DISSOLVE_EDGE): DissolveUniforms {
  const uniforms: DissolveUniforms = {
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
      // across it as the thing walks or falls over. On a skinned mesh `position` is the bind
      // pose, which is the same answer for the same reason: the noise belongs to the body, not
      // to the pose the body happens to be in.
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
  material.needsUpdate = true
  return uniforms
}

/**
 * Whether a material can be told what colour to glow.
 *
 * A kit is free to ship whatever it likes — `MeshBasicMaterial` on a decorative plane, a
 * physical material on armour — and the hit flash has to either work or be knowingly skipped,
 * never silently write a property onto an object that has none.
 */
export function isTintable(material: Material): material is MeshStandardMaterial {
  return 'emissive' in material && (material as MeshStandardMaterial).emissive instanceof Color
}

/**
 * Lifts an FBX→glTF kit's near-black albedo off the floor, by luminance — not by clamping each
 * channel to a flat value.
 *
 * Quaternius' Phong-shaded exports (`extras.fromFBX.isTruePBR: false`) sometimes land at
 * `baseColorFactor` values under 0.05 — the Skeleton Warrior's `Black` material is
 * `[0.013, 0.014, 0.013]`, which is indistinguishable from "no light reaches this surface" once
 * it is lit by nothing but a torch. This is not a bug in the export, a nearly-unlit material is
 * a legitimate thing to author; it just reads as missing geometry in this game's lighting, and
 * there is no environment map here to fill it back in.
 *
 * The first version of this clamped each channel to the floor independently, which is wrong in
 * a way that only showed up once a real material was near-black *and coloured*: the Wraith's
 * `Ghost_Main` is a dark purple, `[0.018, 0.004, 0.023]`, and clamping every channel to the same
 * floor turned it into flat neutral grey — a material that only differs from the Skeleton's
 * near-black `Black` by hue lost that hue entirely, on the exact material a future definition
 * would reach for to prove a tint works on it. Scaling the whole colour up by luminance instead
 * preserves the channel ratios — the hue — and only raises how bright it reads.
 */
const MODEL_ALBEDO_FLOOR = 0.12

/** Rec. 709 luma coefficients — matches the readout in `debug.ts`'s lab luminance. */
function luminance(color: Color): number {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b
}

/**
 * The kit's own `metallicFactor` (0.4 across every material seen so far) with no environment
 * map to reflect is a pure diffuse loss — three has nothing to put in the mirror, so a metallic
 * surface just returns less light than a rough one for no visual benefit. Clamped to 0 until
 * the day this project gains an envmap, at which point this is the one line to change back.
 */
const MODEL_METALNESS = 0

export interface PrepareMaterialsOptions {
  /**
   * Overrides `definition.tint` for this call. `undefined` (the default) reads the
   * definition — pass `null` to force no tint, or an explicit `{ colour, strength }` to force
   * one, regardless of what the definition says. Exists for the model lab, which needs to show
   * the same body with and without a hypothetical boss tint side by side.
   */
  tint?: EnemyDefinition['tint'] | null
  /**
   * Reproduces the Sprint 2.7 bug on purpose: replaces `color` outright instead of multiplying
   * into it. Exists only so the model lab can show the regression next to the fix — nothing in
   * the game should ever pass this.
   */
  legacyReplace?: boolean
}

export interface PreparedEnemyMaterials {
  /** Every prepared material that can be told what colour to glow — the emissive channel. */
  tints: MeshStandardMaterial[]
  /** Every prepared material, dissolving. */
  dissolve: DissolveUniforms[]
  /** Every cloned material, for disposal. */
  owned: Material[]
}

/**
 * Clones and prepares every material on a cloned kit model for one enemy slot: dissolve
 * injected, an optional recolour, metalness clamped, near-black albedo lifted.
 *
 * The one function both `EnemyShape`'s production path and the model lab call — see the module
 * doc. `clone` is mutated in place; each mesh's `material` is replaced with owned copies.
 */
export function prepareEnemyMaterials(
  clone: Object3D,
  definition: EnemyDefinition,
  options: PrepareMaterialsOptions = {},
): PreparedEnemyMaterials {
  const tint = options.tint === undefined ? definition.tint : options.tint
  const tintColour = tint ? new Color(tint.colour) : null
  const tintStrength = tint?.strength ?? 1

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
      if (isTintable(copy)) {
        copy.metalness = MODEL_METALNESS
        const luma = luminance(copy.color)
        if (luma > 0 && luma < MODEL_ALBEDO_FLOOR) {
          copy.color.multiplyScalar(MODEL_ALBEDO_FLOOR / luma)
        } else if (luma === 0) {
          // True black has no hue to preserve — nothing to scale.
          copy.color.setScalar(MODEL_ALBEDO_FLOOR)
        }

        if (tintColour) {
          if (options.legacyReplace) {
            // The Sprint 2.7 bug, kept reachable on purpose — see `PrepareMaterialsOptions`.
            copy.color.copy(tintColour)
          } else {
            // Multiplies into the kit's own colour rather than replacing it, so a material with
            // no `map` — the Demon and the Ghost Skull both ship none — keeps its own baked
            // shading and only shifts hue. `lerp` toward the product so `strength` can be a
            // nudge: at 0 the kit colour is untouched, at 1 it is fully multiplied.
            const multiplied = copy.color.clone().multiply(tintColour)
            copy.color.lerp(multiplied, tintStrength)
          }
        }
        tints.push(copy)
      }
      return copy
    }
    mesh.material = Array.isArray(source) ? source.map(replace) : replace(source)
  })

  return { tints, dissolve, owned }
}
