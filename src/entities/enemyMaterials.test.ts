import { describe, expect, it } from 'vitest'
import { Group, Mesh, MeshStandardMaterial, SphereGeometry } from 'three'
import type { EnemyDefinition } from '@/data/enemies'
import { prepareEnemyMaterials } from '@/entities/enemyMaterials'

/**
 * `prepareEnemyMaterials` is the exact function the Sprint 2.7 regression lived in — see the
 * plan this shipped under. It replaced an untextured material's colour outright instead of
 * multiplying into it, which collapsed several distinct baked colours (the Demon-cast Skeleton
 * Warrior's four materials, the Ghost-Skull-cast Wraith's two) into one flat tint and read as
 * pure white the moment a torch and ACES tone mapping got hold of it. These tests pin the
 * invariant that broke, and the multiply-tint behaviour the fix depends on for future bosses
 * and elites — see `EnemyDefinition['tint']` in `data/enemies.ts`.
 *
 * `baseColorFactor` in a glTF file is defined in **linear** space, and `GLTFLoader` assigns it
 * with `Color.setRGB(r, g, b)` — no sRGB conversion. `new Color('#hex')` does the opposite: it
 * treats the string as sRGB and converts down to linear on the way in. Building a test material
 * with a hex string therefore does not model what a loaded kit material actually looks like —
 * it is a different, brighter colour once both are compared as linear numbers. Every fixture
 * below uses `setRGB` with real values lifted from the Skeleton Warrior and Wraith GLBs, for the
 * same reason PLAN.md warns about testing a diagnosis against numbers nobody checked.
 */

/** The Skeleton Warrior's actual `Demon_Main` — a saturated dark red. Its peak channel alone
 *  clears the albedo floor, but its *luminance* does not (a saturated colour is dim even when
 *  one channel is strong), so this is a lift case too — see the floor's own doc comment. */
const DEMON_MAIN: [number, number, number] = [0.1346, 0.00778, 0.01345]
/** The Wraith's actual `Ghost_Main` — near-black *and* visibly purple. The case the first
 *  version of the albedo lift got wrong: clamping each channel to a flat floor turned this into
 *  neutral grey, losing the one thing that told it apart from the Skeleton's near-black. */
const GHOST_MAIN: [number, number, number] = [0.0183, 0.0042, 0.0233]
/** The Skeleton Warrior's actual `Eye_White` — genuinely bright, the control case that should
 *  come through completely unchanged. */
const EYE_WHITE: [number, number, number] = [0.2203, 0.2295, 0.2804]

function definition(tint?: EnemyDefinition['tint']): EnemyDefinition {
  // Only the fields `prepareEnemyMaterials` actually reads. Everything else here is
  // unreachable — a real `EnemyDefinition` is a lot of gameplay tuning this module never sees.
  return { colour: '#ffffff', tint } as EnemyDefinition
}

/** One mesh, one untextured `MeshStandardMaterial` — the shape of the Demon and Ghost Skull's
 *  materials, both of which ship a `baseColorFactor` and no `map`. `rgb` is linear, matching
 *  how `GLTFLoader` actually assigns it — see the module doc. */
function untexturedMesh(rgb: [number, number, number], metalness = 0.4) {
  const material = new MeshStandardMaterial({ metalness })
  material.color.setRGB(...rgb)
  return new Mesh(new SphereGeometry(0.1), material)
}

describe('prepareEnemyMaterials', () => {
  it("keeps an untextured material's own baked colour when no tint is set", () => {
    const group = new Group()
    group.add(untexturedMesh(EYE_WHITE))

    const { tints } = prepareEnemyMaterials(group, definition(undefined))

    expect(tints).toHaveLength(1)
    // Above the albedo floor already — nothing here should move it.
    const [r, g, b] = tints[0]!.color.toArray()
    expect(r).toBeCloseTo(EYE_WHITE[0], 3)
    expect(g).toBeCloseTo(EYE_WHITE[1], 3)
    expect(b).toBeCloseTo(EYE_WHITE[2], 3)
  })

  it('multiplies a tint into the material rather than replacing it', () => {
    const group = new Group()
    group.add(untexturedMesh([0.5, 0.25, 0.125]))

    const { tints } = prepareEnemyMaterials(group, definition({ colour: '#ff0000' }))

    // A pure-red tint multiplied in should leave red where it was and crush green/blue toward
    // zero — not replace the material with flat red, which is the Sprint 2.7 bug.
    const [r, g, b] = tints[0]!.color.toArray()
    expect(r).toBeCloseTo(0.5, 1)
    expect(g).toBeCloseTo(0, 1)
    expect(b).toBeCloseTo(0, 1)
  })

  it('leaves two differently-coloured materials different after the same tint', () => {
    const group = new Group()
    group.add(untexturedMesh(DEMON_MAIN))
    group.add(untexturedMesh(GHOST_MAIN))

    const { tints } = prepareEnemyMaterials(group, definition({ colour: '#ffcc88' }))

    expect(tints).toHaveLength(2)
    // The Sprint 2.7 bug replaced every material with the same flat colour, so a body with
    // several distinct baked materials rendered as one. Multiplying must not do that.
    const a = tints[0]!.color.toArray()
    const b = tints[1]!.color.toArray()
    expect(a).not.toEqual(b)
  })

  it("reads `definition.tint` by default, and leaves the model alone when it is unset", () => {
    // The three enemies shipped today all leave `tint` unset — this is the case that matters
    // most, since it is what every player actually sees.
    const group = new Group()
    group.add(untexturedMesh(EYE_WHITE))

    const { tints } = prepareEnemyMaterials(group, definition(undefined))
    const [r, g, b] = tints[0]!.color.toArray()
    expect(r).toBeCloseTo(EYE_WHITE[0], 3)
    expect(g).toBeCloseTo(EYE_WHITE[1], 3)
    expect(b).toBeCloseTo(EYE_WHITE[2], 3)
  })

  it('lerps toward the multiplied colour by `strength`, rather than always tinting fully', () => {
    const group = new Group()
    group.add(untexturedMesh([0.5, 0.5, 0.5]))

    const { tints } = prepareEnemyMaterials(group, definition({ colour: '#ff0000', strength: 0.5 }))

    const [r, g] = tints[0]!.color.toArray()
    // Full strength would take g to 0; half strength should land partway there, not at either
    // extreme.
    expect(g).toBeGreaterThan(0.1)
    expect(g).toBeLessThan(0.45)
    expect(r).toBeCloseTo(0.5, 1) // red channel is unaffected either way
  })

  it('clamps metalness, since nothing in this project has an environment map to reflect', () => {
    const group = new Group()
    group.add(untexturedMesh([0.5, 0.5, 0.5], 0.4))

    const { tints } = prepareEnemyMaterials(group, definition(undefined))
    expect(tints[0]!.metalness).toBe(0)
  })

  it('lifts near-black albedo off the floor while preserving its hue', () => {
    const group = new Group()
    group.add(untexturedMesh(GHOST_MAIN))

    const { tints } = prepareEnemyMaterials(group, definition(undefined))
    const [r, g, b] = tints[0]!.color.toArray() as [number, number, number]

    // Brighter than the original near-black...
    expect(r).toBeGreaterThan(GHOST_MAIN[0])
    expect(g).toBeGreaterThan(GHOST_MAIN[1])
    expect(b).toBeGreaterThan(GHOST_MAIN[2])
    // ...but still recognisably purple (red and blue well above green), not flattened to the
    // neutral grey a naive per-channel clamp produces. This is the bug the first version of the
    // albedo lift had: `[0.018, 0.004, 0.023]` clamped per-channel to a flat floor lands on
    // `[0.12, 0.12, 0.12]` — exactly grey.
    expect(r).toBeGreaterThan(g * 1.3)
    expect(b).toBeGreaterThan(g * 1.3)
    expect(Math.abs(r - g)).toBeGreaterThan(0.02)
  })

  it('leaves an already-bright material unlifted', () => {
    const group = new Group()
    group.add(untexturedMesh(EYE_WHITE))

    const { tints } = prepareEnemyMaterials(group, definition(undefined))
    const [r, g, b] = tints[0]!.color.toArray()
    expect(r).toBeCloseTo(EYE_WHITE[0], 3)
    expect(g).toBeCloseTo(EYE_WHITE[1], 3)
    expect(b).toBeCloseTo(EYE_WHITE[2], 3)
  })

  it('lifts a saturated dark colour even though its peak channel alone clears the floor', () => {
    // `Demon_Main`: luminance is what decides the lift, not any single channel — a colour can
    // have one bright-looking channel and still read as dim overall.
    const group = new Group()
    group.add(untexturedMesh(DEMON_MAIN))

    const { tints } = prepareEnemyMaterials(group, definition(undefined))
    const [r, g, b] = tints[0]!.color.toArray() as [number, number, number]
    expect(r).toBeGreaterThan(DEMON_MAIN[0])
    // Still recognisably red: red channel well clear of green and blue.
    expect(r).toBeGreaterThan(g * 3)
    expect(r).toBeGreaterThan(b * 3)
  })

  it("reproduces the Sprint 2.7 bug on purpose when asked, for the lab's regression row", () => {
    const group = new Group()
    group.add(untexturedMesh(DEMON_MAIN))
    group.add(untexturedMesh(GHOST_MAIN))

    const { tints } = prepareEnemyMaterials(group, definition(undefined), {
      tint: { colour: '#b8a888' },
      legacyReplace: true,
    })

    // The bug: every material, regardless of its own colour, ends up identical.
    expect(tints[0]!.color.toArray()).toEqual(tints[1]!.color.toArray())
  })

  it('injects the dissolve uniforms onto every prepared material', () => {
    const group = new Group()
    group.add(untexturedMesh([0.5, 0.5, 0.5]))

    const { dissolve, owned } = prepareEnemyMaterials(group, definition(undefined))
    expect(dissolve).toHaveLength(1)
    expect(owned).toHaveLength(1)
    expect(dissolve[0]!.uDissolve.value).toBe(0)
  })

  it('clones materials rather than mutating the source, so one enemy never repaints another', () => {
    const group = new Group()
    const mesh = untexturedMesh(DEMON_MAIN)
    const source = mesh.material as MeshStandardMaterial
    group.add(mesh)

    prepareEnemyMaterials(group, definition({ colour: '#ff0000' }))
    const [r, g, b] = source.color.toArray()
    expect(r).toBeCloseTo(DEMON_MAIN[0], 3)
    expect(g).toBeCloseTo(DEMON_MAIN[1], 3)
    expect(b).toBeCloseTo(DEMON_MAIN[2], 3)
  })
})
