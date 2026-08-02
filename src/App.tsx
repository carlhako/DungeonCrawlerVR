import { Canvas } from '@react-three/fiber'
import { Suspense } from 'react'
import { ACESFilmicToneMapping } from 'three'
import { XR } from '@react-three/xr'
import { Physics } from '@react-three/rapier'
import { FIXED_STEP } from '@/core/loop'
import { SimulationDriver } from '@/core/simulation'
import { PhysicsDriver } from '@/core/physics'
import { xrStore } from '@/core/xr'
import { Foyer } from '@/scenes/Foyer'
import { GreyboxRoom } from '@/scenes/GreyboxRoom'
import { XRDiagnostics } from '@/scenes/XRDiagnostics'
import { InteractionDriver } from '@/systems/InteractionDriver'
import { RunDriver } from '@/systems/RunDriver'
import { InteractPrompt } from '@/ui/InteractPrompt'
import { PointerBeam } from '@/ui/PointerBeam'
import { PlayerRig } from '@/entities/PlayerRig'
import { TeleportAim } from '@/entities/Teleport'
import { ComfortVignette } from '@/ui/ComfortVignette'
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
import { VRButton } from '@/ui/VRButton'
import { DesktopHint } from '@/ui/DesktopHint'

/**
 * Which room to load. The foyer is the game; the greybox is the movement test rig.
 *
 * Kept rather than deleted, and reachable at `?scene=greybox`, because it is the only place
 * with a staircase, a ramp and a ledge to walk at — the character controller's behaviour is
 * invisible without them, and the smoke test still drives it.
 */
const scene = new URLSearchParams(window.location.search).get('scene') === 'greybox'
  ? 'greybox'
  : 'foyer'

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
      <PlayerRig />
      <TeleportAim />
      <InteractionDriver />
      <InteractPrompt />
      <PointerBeam />
      <RunDriver />
      {/* Sprint 0.2's controller readout, kept only in the greybox now that the foyer has
          real things to point at. It is still the fastest way to tell "the stick is dead"
          apart from "locomotion is broken" while wearing a headset. */}
      {scene === 'greybox' && <XRDiagnostics />}
    </Physics>
  )
}

export function App() {
  const { showPerf, showPanel } = useDevToggles()

  return (
    <>
      <Canvas
        shadows
        // Physically-correct-ish defaults. Tone mapping matters a lot once the game is lit
        // only by torches — without it, bright flames blow out to flat white.
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.toneMapping = ACESFilmicToneMapping
          gl.toneMappingExposure = 1.0
        }}
        camera={{ position: [0, 1.6, 4], fov: 70, near: 0.05, far: 100 }}
      >
        <XR store={xrStore}>
          <SimulationDriver />
          <XRInputSampler />
          <DesktopInputSampler />
          <XRRenderSettings />

          <color attach="background" args={['#0b0b10']} />
          {/* Loose while greyboxing so the whole room reads. The dungeon pulls this in hard
              (Sprint 3.1) — tight fog is most of what makes the torch-lit rooms frightening. */}
          <fog attach="fog" args={['#0b0b10', 20, 70]} />

          <Suspense fallback={null}>
            <World />
          </Suspense>

          {/* Outside <Physics>: it follows the head, not a rigid body. */}
          <ComfortVignette />
          <DevPerf visible={showPerf} />
        </XR>
      </Canvas>

      <VRButton />
      <DevPanel visible={showPanel} />
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
