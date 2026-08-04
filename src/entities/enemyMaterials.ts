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

import { Color, Material, MeshStandardMaterial } from 'three'
import type { IUniform } from 'three'

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
