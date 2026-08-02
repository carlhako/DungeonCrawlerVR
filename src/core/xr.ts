import { createXRStore } from '@react-three/xr'
import { readStoredSettings } from '@/systems/settings'

/**
 * The single XR store for the game.
 *
 * Created at module load rather than inside a component, for two reasons: the framebuffer
 * scale has to be decided before any session can start (it sizes the swapchain, which is
 * allocated once per session), and the Enter VR button lives in the DOM *outside* the
 * Canvas, so it needs a handle to the store that doesn't come from React context.
 */

const stored = readStoredSettings()

/**
 * `?xremulate` in the URL runs the iwer Quest 3 emulator on a desktop browser.
 *
 * Off by default and opt-in on purpose: the emulator injects a fake `navigator.xr`, which
 * would otherwise make the headless smoke test exercise a code path no real player hits.
 * Real VR verification happens on the headset; this is only for poking at the input
 * plumbing without putting it on.
 */
const emulatorRequested =
  import.meta.env.DEV &&
  typeof location !== 'undefined' &&
  new URLSearchParams(location.search).has('xremulate')

export const xrStore = createXRStore({
  // Offer *VR* explicitly. The default is to prefer immersive-ar where supported, and the
  // Quest 3 supports passthrough AR — which would drop the player into a see-through
  // version of a game whose entire premise is darkness.
  offerSession: 'immersive-vr',

  frameRate: 'high',
  foveation: stored.foveation,
  frameBufferScaling: stored.framebufferScale,

  // Controllers only. Hand tracking is explicitly out of scope (see docs/PLAN.md) — the
  // combat design is trigger-fire and velocity-based swings, neither of which works
  // without a controller in your fist.
  hand: false,

  // Every optional feature requested is work the runtime does on our behalf, so ask for
  // nothing we don't use. `layers` stays on: it lets the compositor sample the eye buffers
  // directly, which is a straight quality and latency win on the Quest.
  layers: true,
  anchors: false,
  handTracking: false,
  bodyTracking: false,
  meshDetection: false,
  planeDetection: false,
  hitTest: false,
  depthSensing: false,
  domOverlay: false,

  emulate: emulatorRequested ? 'metaQuest3' : false,
})

/**
 * Whether this browser exposes WebXR at all.
 *
 * Note that `navigator.xr` is only present in a **secure context**. Over plain http on a
 * LAN address it is absent even on the Quest, which is the single most common reason for
 * "it works on my laptop but there's no VR button on the headset" — use `npm run dev:xr`.
 */
export function hasWebXR(): boolean {
  return typeof navigator !== 'undefined' && navigator.xr != null
}

/** True when the page can't offer VR because it isn't being served over HTTPS. */
export function isBlockedByInsecureContext(): boolean {
  return !hasWebXR() && typeof window !== 'undefined' && !window.isSecureContext
}
