import { Canvas } from '@react-three/fiber'
import { Suspense } from 'react'
import { ACESFilmicToneMapping } from 'three'
import { XR } from '@react-three/xr'
import { Physics } from '@react-three/rapier'
import { FIXED_STEP } from '@/core/loop'
import { SimulationDriver } from '@/core/simulation'
import { DebugView } from '@/core/DebugView'
import { PhysicsDriver } from '@/core/physics'
import { xrStore } from '@/core/xr'
import { Dungeon } from '@/scenes/Dungeon'
import { Foyer } from '@/scenes/Foyer'
import { GreyboxRoom } from '@/scenes/GreyboxRoom'
import { LAB_BACKGROUND_CSS, ModelLab } from '@/scenes/ModelLab'
import { XRDiagnostics } from '@/scenes/XRDiagnostics'
import { CombatDriver } from '@/systems/CombatDriver'
import { EnemyDriver } from '@/systems/EnemyDriver'
import { FxDriver } from '@/systems/FxDriver'
import { InteractionDriver } from '@/systems/InteractionDriver'
import { RunDriver } from '@/systems/RunDriver'
import { InteractPrompt } from '@/ui/InteractPrompt'
import { DamageNumbers } from '@/ui/DamageNumbers'
import { PlayerRig } from '@/entities/PlayerRig'
import { Enemies } from '@/entities/Enemies'
import { Particles } from '@/entities/Particles'
import { Projectiles } from '@/entities/Projectiles'
import { TeleportAim } from '@/entities/Teleport'
import { DesktopWeaponRig } from '@/entities/WeaponRig'
import { ComfortVignette } from '@/ui/ComfortVignette'
import { EnemyCounter } from '@/ui/EnemyCounter'
import { ExploredMap } from '@/ui/ExploredMap'
import { ExploredDriver } from '@/systems/ExploredDriver'
import { DesktopInputSampler } from '@/systems/DesktopInputSampler'
import { XRInputSampler, XRRenderSettings } from '@/systems/XRInputSampler'
import {
  DevPanel,
  DevPerf,
  MovementControls,
  XRSettingsControls,
  useDevToggles,
  useLightingControls,
  usePhysicsDebug,
} from '@/ui/DevOverlay'
import { DungeonMapView } from '@/ui/DungeonMapView'
import { VRButton } from '@/ui/VRButton'
import { DesktopHint } from '@/ui/DesktopHint'

/**
 * Which room to load. The foyer is the game; the greybox is the movement test rig; the model
 * lab is neither a room nor gameplay — it's the enemy roster laid out for inspection.
 *
 * Kept rather than deleted, and reachable at `?scene=greybox` or `?scene=models`, because they
 * are each the only place to see something: the greybox is the only staircase, ramp and ledge
 * to test the character controller against, and the lab is the only place a kit model can be
 * looked at under the game's own lighting before it reaches a headset.
 */
const sceneParam = new URLSearchParams(window.location.search).get('scene')
const scene = sceneParam === 'greybox' ? 'greybox' : sceneParam === 'models' ? 'models' : 'foyer'

function SceneLighting() {
  const { ambient, keyIntensity, keyHeight } = useLightingControls()

  // The foyer lights itself with torches. A key light here would flatten them and hand the
  // room a sun it has no window for — and the contrast between this room and the dark past
  // the door is the entire point of the foyer.
  // A warm, low fill so the corners the torches don't reach are dim rather than pitch black.
  // Tinted, because neutral ambient in a torch-lit room reads as moonlight.
  if (scene === 'foyer') {
    return <ambientLight intensity={ambient * 0.9} color="#ffcfa0" />
  }

  return (
    <>
      <ambientLight intensity={ambient} />
      <directionalLight
        position={[4, keyHeight, 3]}
        intensity={keyIntensity}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
        shadow-camera-far={30}
      />
    </>
  )
}

/** Everything that needs a physics world, kept together so the ordering is visible. */
function World() {
  const debug = usePhysicsDebug()

  return (
    <Physics
      // Mounted paused and stepped from the fixed loop instead. See PhysicsDriver.
      paused
      timeStep={FIXED_STEP}
      debug={debug}
    >
      <PhysicsDriver />
      <SceneLighting />
      {scene === 'foyer' ? <Foyer /> : <GreyboxRoom />}
      {/* Mounted only while a wave exists, and continuous with the foyer's passage rather
          than a scene the player is teleported into. */}
      {scene === 'foyer' && <Dungeon />}
      <PlayerRig />
      <TeleportAim />
      <InteractionDriver />
      <InteractPrompt />
      <RunDriver />
      {/* Combat needs the physics world for its projectile raycasts, so it lives inside
          <Physics> with everything else that does. */}
      <CombatDriver />
      {/* Enemies decide at SystemOrder.AI, before physics and combat, so a wind-up resolves
          against the position the player finished this step at. */}
      <EnemyDriver />
      <Enemies />
      <DesktopWeaponRig />
      <Projectiles />
      {/* Effects run after combat has resolved: they read what happened rather than being
          told, so nothing in the combat path knows what a hit looks like. */}
      <FxDriver />
      <Particles />
      <DamageNumbers />
      {/* Sprint 0.2's controller readout, kept only in the greybox now that the foyer has
          real things to point at. It is still the fastest way to tell "the stick is dead"
          apart from "locomotion is broken" while wearing a headset. */}
      {scene === 'greybox' && <XRDiagnostics />}
    </Physics>
  )
}

export function App() {
  const { showPerf, showPanel, showMap } = useDevToggles()

  return (
    <>
      <Canvas
        shadows
        // Physically-correct-ish defaults. Tone mapping matters a lot once the game is lit
        // only by torches — without it, bright flames blow out to flat white.
        gl={{
          antialias: true,
          powerPreference: 'high-performance',
          // Only the lab needs this: reading the drawing buffer back for the luminance
          // readout requires it to survive past the frame that drew it, which costs a copy
          // the game itself never asks for. Scoped to `?scene=models` so the cost never
          // reaches a headset.
          preserveDrawingBuffer: scene === 'models',
        }}
        onCreated={({ gl }) => {
          gl.toneMapping = ACESFilmicToneMapping
          gl.toneMappingExposure = 1.0
        }}
        camera={{ position: [0, 1.6, 4], fov: 70, near: 0.05, far: 100 }}
      >
        <XR store={xrStore}>
          <SimulationDriver />
          <DebugView />
          <XRInputSampler />
          <DesktopInputSampler />
          <XRRenderSettings />

          {scene === 'models' ? (
            // Neutral grey, no fog — nothing but the models and the lab's own lights should
            // land on a pixel here, or the luminance readout the capture script takes is
            // measuring the room instead of the specimen.
            <color attach="background" args={[LAB_BACKGROUND_CSS]} />
          ) : (
            <>
              <color attach="background" args={['#0b0b10']} />
              {/* Loose while greyboxing so the whole room reads. The dungeon pulls this in
                  hard (Sprint 3.1) — tight fog is most of what makes the torch-lit rooms
                  frightening. */}
              <fog attach="fog" args={['#0b0b10', 20, 70]} />
            </>
          )}

          <Suspense fallback={null}>
            {/* No <Physics>, no player rig, no drivers — the lab draws models, nothing plays. */}
            {scene === 'models' ? <ModelLab /> : <World />}
          </Suspense>

          {/* Outside <Physics>: they follow the head, not a rigid body. Skipped in the lab —
              there is no run, no dungeon and no player for any of these to describe. */}
          {scene !== 'models' && (
            <>
              <ComfortVignette />
              <EnemyCounter />
              <ExploredMap />
              <ExploredDriver />
            </>
          )}
          <DevPerf visible={showPerf} />
        </XR>
      </Canvas>

      <VRButton />
      <DevPanel visible={showPanel} />
      <DungeonMapView visible={showMap} />
      {import.meta.env.DEV && (
        <>
          <XRSettingsControls />
          <MovementControls />
        </>
      )}
      <DesktopHint />
    </>
  )
}
