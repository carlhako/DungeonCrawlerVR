import { Canvas } from '@react-three/fiber'
import { Suspense } from 'react'
import { ACESFilmicToneMapping } from 'three'
import { XR } from '@react-three/xr'
import { Physics } from '@react-three/rapier'
import { FIXED_STEP } from '@/core/loop'
import { SimulationDriver } from '@/core/simulation'
import { PhysicsDriver } from '@/core/physics'
import { xrStore } from '@/core/xr'
import { GreyboxRoom } from '@/scenes/GreyboxRoom'
import { XRDiagnostics } from '@/scenes/XRDiagnostics'
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

function SceneLighting() {
  const { ambient, keyIntensity, keyHeight } = useLightingControls()
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
      <GreyboxRoom />
      <PlayerRig />
      <TeleportAim />
      {/* Sprint 0.2 scaffolding, kept because it is still how you tell "the stick is dead"
          apart from "locomotion is broken" while wearing a headset. Retires in Sprint 1.1
          when the foyer lands. No collider — you walk straight through it. */}
      <XRDiagnostics />
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
