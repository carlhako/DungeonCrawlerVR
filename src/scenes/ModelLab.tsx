import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useControls } from 'leva'
import { Group, type Material, type Object3D } from 'three'
import { OrthographicCamera, Text } from '@react-three/drei'
import { ENEMIES, ENEMY_IDS, type EnemyDefinition, type EnemyId } from '@/data/enemies'
import {
  cloneEnemyModel,
  enemyModelsVersion,
  getEnemyModel,
  loadEnemyModels,
  subscribeEnemyModels,
} from '@/systems/enemies/models'
import { fitModel } from '@/systems/enemies/animation'
import {
  prepareEnemyMaterials,
  type DissolveUniforms,
  type PreparedEnemyMaterials,
} from '@/entities/enemyMaterials'

/**
 * A wall of specimens: every enemy model, drawn several ways side by side, lit by the game's
 * actual torch constants.
 *
 * Built to answer one question that a screenshot of a running wave can't: *why* a given model
 * is washed out, by putting the broken version and the fixed version in the same frame under
 * the same light. See `docs/PROGRESS.md` and the plan this shipped under — Sprint 2.7's tint
 * pass replaced two kit materials' baked colour outright, which reads as pure white the moment
 * a torch and ACES tone mapping get hold of a flat pale tint. This scene is also the harness
 * `scripts/captureModels.mjs` drives headlessly, and the thing to open on the headset for the
 * final call: `?scene=models`.
 *
 * Reachable only via the query string, like `?scene=greybox` — see `App.tsx`.
 */

/** Columns are enemies, rows are what was done to their materials. One cell, one specimen. */
const VARIANTS = ['raw', 'pipeline-old', 'pipeline', 'tinted', 'no-emissive'] as const
type Variant = (typeof VARIANTS)[number]

/**
 * The lab's background colour, as both the CSS/three colour string (`App.tsx`) and the raw RGB
 * triple (`debug.ts`'s luminance readout, which has to tell a specimen's own pixels apart from
 * the empty cell around it — a mean taken over the whole cell is mostly background and hides
 * exactly the washed-out-body signal this tool exists to measure).
 */
export const LAB_BACKGROUND_RGB: [number, number, number] = [0x3a, 0x3a, 0x3e]
export const LAB_BACKGROUND_CSS = `rgb(${LAB_BACKGROUND_RGB.join(',')})`

const VARIANT_LABEL: Record<Variant, string> = {
  raw: 'raw (GLB, untouched)',
  'pipeline-old': 'pipeline — the bug',
  pipeline: 'pipeline — today',
  tinted: 'pipeline — boss tint',
  'no-emissive': 'pipeline — no emissive',
}

/**
 * A synthetic recolour, forced on regardless of what the definition says, so the *capability*
 * — multiplying a tint into a material that has no texture to multiply against — is proven on
 * the two kit assets that broke in Sprint 2.7, not just on the goblin's atlas. Chosen loud and
 * saturated on purpose: subtle would leave "does this even work on an untextured material?"
 * unanswered by eye.
 */
const BOSS_TINT = { colour: '#ff3355', strength: 1 }

/**
 * Grid geometry, in metres. `CELL_H` is generous enough that a 1.9m Wraith doesn't clip its
 * row, and — just as importantly — big enough that one row's torch (see `TORCH_CUTOFF`) has
 * fallen fully to zero before it reaches the next row's specimen.
 */
const CELL_W = 2.3
const CELL_H = 3.4
const GRID_LEFT_MARGIN = 1.9
const GRID_TOP_MARGIN = 0.5

/** Reused from `Dungeon.tsx` / `Foyer.tsx` — the actual constants a body is lit by in the game. */
const TORCH_HEIGHT = 2.2
const TORCH_INTENSITY_DEFAULT = 24
const TORCH_COLOUR = '#ff9d4a'
const TORCH_DECAY = 2
/** How far the torch stands from the specimen, in metres — "at a fixed 1.5 m" per the plan. */
const TORCH_DISTANCE = 1.5
/**
 * Cutoff for each cell's own torch, deliberately **not** the game's `TORCH_RANGE` (14m, loose
 * because real torches stand rooms apart). `PointLight.distance` in three is a hard window —
 * zero past it, not just small — so as long as this stays under the distance to the *next*
 * row's light (`CELL_H` away, ~3.7m at this offset), that row gets none of it. Without this a
 * `no-emissive` row measured noticeably brighter than it should have, entirely from the next
 * row's light bleeding in, and the whole readout was untrustworthy until this was caught.
 */
const TORCH_CUTOFF = 3.0
const FOYER_AMBIENT = 0.315
const FOYER_AMBIENT_COLOUR = '#ffcfa0'

const SPIN_RATE = 0.35 // rad/s

function readQuery(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name)
}

/** `?rig=neutral|torch`, read once — leva can still switch it live after. */
const initialRig = readQuery('rig') === 'neutral' ? 'neutral' : 'torch'
/** `?spin=0` freezes the turntable, so the capture script gets a deterministic frame. */
const initialSpin = readQuery('spin') !== '0'

function useModelsReady(): number {
  const [, force] = useState(0)
  useEffect(() => {
    loadEnemyModels()
    return subscribeEnemyModels(() => force((n) => n + 1))
  }, [])
  return enemyModelsVersion()
}

interface Specimen {
  root: Object3D
  owned: Material[]
  dissolve: DissolveUniforms[]
}

/** Builds one specimen for one cell: a clone, prepared (or not) one specific way. */
function buildSpecimen(id: EnemyId, definition: EnemyDefinition, variant: Variant): Specimen | null {
  const model = getEnemyModel(id)
  const clone = cloneEnemyModel(id)
  if (!model || !clone) return null

  const fit = fitModel(model.measuredHeight, model.measuredMinY, definition.height, model.spec.yOffset)
  clone.scale.setScalar(fit.scale)
  clone.position.y = fit.y
  clone.rotation.y = model.spec.yawOffset ?? 0

  if (variant === 'raw') {
    // The ground truth: whatever the artist exported, with nothing from this game's pipeline
    // touching it — no dissolve injection, no tint, no metalness clamp, no albedo floor.
    return { root: clone, owned: [], dissolve: [] }
  }

  let prepared: PreparedEnemyMaterials
  if (variant === 'pipeline-old') {
    // The Sprint 2.7 regression, kept reachable on purpose: replace, not multiply, and always
    // on — reproducing the bug the way it actually shipped, regardless of what any definition's
    // `tint` field says today.
    prepared = prepareEnemyMaterials(clone, definition, {
      tint: { colour: definition.colour },
      legacyReplace: true,
    })
  } else if (variant === 'tinted') {
    prepared = prepareEnemyMaterials(clone, definition, { tint: BOSS_TINT })
  } else {
    // 'pipeline' and 'no-emissive' both run the real, current default path.
    prepared = prepareEnemyMaterials(clone, definition)
  }

  if (variant === 'no-emissive') {
    for (const material of prepared.tints) material.emissiveIntensity = 0
  } else {
    // Match what a resting enemy actually shows: the definition's own glow, not zero and not
    // the wind-up boost. See `resolveAppearance` — this is deliberately the same number.
    for (const material of prepared.tints) {
      material.emissive.set(definition.colour)
      material.emissiveIntensity = definition.glow
    }
  }

  return { root: clone, owned: prepared.owned, dissolve: prepared.dissolve }
}

function SpecimenCell({
  id,
  definition,
  variant,
  position,
  version,
  spin,
}: {
  id: EnemyId
  definition: EnemyDefinition
  variant: Variant
  position: [number, number, number]
  version: number
  spin: boolean
}) {
  const group = useRef<Group>(null)

  const specimen = useMemo(
    () => buildSpecimen(id, definition, variant),
    // `version` bumps once when the models finish loading — that is the only time a rebuild is
    // needed, but it is not something the linter can see from here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, definition, variant, version],
  )

  useEffect(() => {
    return () => {
      if (!specimen) return
      for (const material of specimen.owned) material.dispose()
    }
  }, [specimen])

  useFrame((_, delta) => {
    if (spin && group.current) group.current.rotation.y += delta * SPIN_RATE
  })

  if (!specimen) return null

  return (
    <group position={position}>
      <group ref={group}>
        <primitive object={specimen.root} />
      </group>
      {/* One torch, `TORCH_DISTANCE` off the specimen and `TORCH_HEIGHT` up — the actual
          distance an enemy closing to melee range is lit from. This is the light that blows a
          flat pale tint out to white; a specimen that survives it survives the game. */}
    </group>
  )
}

/** Sets `gl.toneMappingExposure` from the leva control every frame it changes — the renderer,
 *  not the scene, owns this value, so it can't be a prop on anything drawn. */
function ExposureControl({ exposure }: { exposure: number }) {
  const gl = useThree((state) => state.gl)
  useEffect(() => {
    gl.toneMappingExposure = exposure
  }, [gl, exposure])
  return null
}

export function ModelLab() {
  const version = useModelsReady()

  const { rig, spin, exposure, torchIntensity } = useControls('Model Lab', {
    rig: { value: initialRig, options: ['torch', 'neutral'] as const },
    spin: { value: initialSpin },
    exposure: { value: 1.0, min: 0.2, max: 2.5, step: 0.05 },
    torchIntensity: { value: TORCH_INTENSITY_DEFAULT, min: 0, max: 40, step: 1 },
  })

  const cols = ENEMY_IDS
  const rows = VARIANTS

  const gridWidth = cols.length * CELL_W
  const gridHeight = rows.length * CELL_H

  return (
    <>
      <ExposureControl exposure={exposure} />

      <ambientLight
        intensity={rig === 'torch' ? FOYER_AMBIENT : 0.5}
        color={rig === 'torch' ? FOYER_AMBIENT_COLOUR : '#ffffff'}
      />
      {rig === 'neutral' && (
        <directionalLight position={[gridWidth / 2, 6, 8]} intensity={2.2} />
      )}

      {/* Column headers: the enemy name. */}
      {cols.map((id, c) => (
        <Text
          key={`col-${id}`}
          position={[c * CELL_W + CELL_W / 2, GRID_TOP_MARGIN - 0.1, 0]}
          fontSize={0.14}
          color="#e8e4da"
          anchorX="center"
          anchorY="bottom"
        >
          {ENEMIES[id].name}
        </Text>
      ))}

      {/* Row headers: what happened to the materials. */}
      {rows.map((variant, r) => (
        <Text
          key={`row-${variant}`}
          position={[-0.15, -(r * CELL_H + CELL_H / 2 - 0.3), 0]}
          fontSize={0.13}
          color="#e8e4da"
          anchorX="right"
          anchorY="middle"
        >
          {VARIANT_LABEL[variant]}
        </Text>
      ))}

      {cols.map((id, c) =>
        rows.map((variant, r) => {
          const definition = ENEMIES[id]
          const x = c * CELL_W + CELL_W / 2
          const feetY = -(r * CELL_H + CELL_H - 0.25)
          return (
            <group key={`${id}-${variant}`}>
              <SpecimenCell
                id={id}
                definition={definition}
                variant={variant}
                position={[x, feetY, 0]}
                version={version}
                spin={spin}
              />
              {rig === 'torch' && (
                <pointLight
                  position={[x, feetY + TORCH_HEIGHT, TORCH_DISTANCE]}
                  intensity={torchIntensity}
                  color={TORCH_COLOUR}
                  decay={TORCH_DECAY}
                  distance={TORCH_CUTOFF}
                />
              )}
            </group>
          )
        }),
      )}

      {/* Camera framing the whole grid, orthographic so the same world-space rectangle always
          lands on the same pixel rectangle — that determinism is what lets the capture script
          measure luminance per cell without hand-tuned crop coordinates. */}
      <OrthographicCamera
        makeDefault
        position={[0, 0, 10]}
        left={-GRID_LEFT_MARGIN}
        right={gridWidth + 0.4}
        top={GRID_TOP_MARGIN}
        bottom={-gridHeight - 0.3}
        near={0.1}
        far={50}
        zoom={1}
      />
    </>
  )
}

/**
 * Grid and camera geometry, exported so the debug handle and the capture script agree on cell
 * pixel rectangles without either of them re-deriving the layout above.
 *
 * The camera is an unrotated orthographic camera at world origin looking down -Z, so world X
 * maps linearly onto `[frustum.left, frustum.right]` and world Y onto
 * `[frustum.bottom, frustum.top]` — no perspective divide, no per-model distortion. That is the
 * whole reason this scene uses an orthographic camera instead of the game's usual perspective
 * one: a cell's pixel rectangle is computable from its world position alone.
 */
export function labGridLayout() {
  const gridWidth = ENEMY_IDS.length * CELL_W
  const gridHeight = VARIANTS.length * CELL_H
  return {
    cols: ENEMY_IDS,
    rows: VARIANTS,
    cellW: CELL_W,
    cellH: CELL_H,
    frustum: {
      left: -GRID_LEFT_MARGIN,
      right: gridWidth + 0.4,
      top: GRID_TOP_MARGIN,
      bottom: -gridHeight - 0.3,
    },
  }
}
