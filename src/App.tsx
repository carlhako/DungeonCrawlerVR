import { Canvas } from '@react-three/fiber'
import { Suspense } from 'react'
import { ACESFilmicToneMapping } from 'three'
import { XR, useXR } from '@react-three/xr'
import { SimulationDriver } from '@/core/simulation'
import { xrStore } from '@/core/xr'
import { GreyboxRoom } from '@/scenes/GreyboxRoom'
import { XRDiagnostics } from '@/scenes/XRDiagnostics'
import { PlayerRig } from '@/entities/PlayerRig'
import { XRInputSampler, XRRenderSettings } from '@/systems/XRInputSampler'
import {
  DevPanel,
  DevPerf,
  XRSettingsControls,
  useDevToggles,
  useLightingControls,
} from '@/ui/DevOverlay'
import { VRButton } from '@/ui/VRButton'
import { OrbitControls } from '@react-three/drei'

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

/**
 * Placeholder camera control until the character controller lands in Sprint 0.3.
 *
 * Unmounted inside a session: in XR the camera belongs to the headset, and orbit controls
 * would be writing to it every frame behind the runtime's back. That is exactly the class
 * of bug the comfort rule exists to prevent.
 */
function DesktopCameraControls() {
  const inSession = useXR((state) => state.session != null)
  if (inSession) return null
  return <OrbitControls target={[0, 1.2, 0]} maxPolarAngle={Math.PI * 0.49} />
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
        camera={{ position: [0, 1.7, 8], fov: 70, near: 0.05, far: 100 }}
      >
        <XR store={xrStore}>
          <SimulationDriver />
          <XRInputSampler />
          <XRRenderSettings />

          <color attach="background" args={['#0b0b10']} />
          {/* Loose while greyboxing so the whole room reads. The dungeon pulls this in hard
              (Sprint 3.1) — tight fog is most of what makes the torch-lit rooms frightening. */}
          <fog attach="fog" args={['#0b0b10', 20, 70]} />

          <Suspense fallback={null}>
            <SceneLighting />
            <GreyboxRoom />
            <XRDiagnostics />
            <PlayerRig />
          </Suspense>

          <DesktopCameraControls />
          <DevPerf visible={showPerf} />
        </XR>
      </Canvas>

      <VRButton />
      <DevPanel visible={showPanel} />
      {import.meta.env.DEV && <XRSettingsControls />}
      <div className="hint">
        Sprint 0.2 — WebXR bring-up · drag to orbit
        {import.meta.env.DEV && <> · F1 perf · F2 tuning</>}
      </div>
    </>
  )
}
