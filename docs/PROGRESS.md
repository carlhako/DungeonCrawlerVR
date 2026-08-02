# Progress

**Single source of truth for where the build is up to.** Update this at the end of every
sprint, before committing. The roadmap itself lives in [PLAN.md](PLAN.md).

---

## Current position

> **Next up: Sprint 1.1 — Foyer scene & interaction**
>
> Sprint 0.3 is built and verified on desktop, but **awaiting VR sign-off on the Quest 3** —
> smooth locomotion, snap-turn, the comfort vignette and teleport cannot be judged on a
> monitor. See the checklist in the sprint log below.
>
> Epic 0 is otherwise complete: there is a physics world, a character controller that
> handles steps and slopes, and movement schemes for both desktop and VR.

---

## Status board

| Epic | Sprint | Status |
| --- | --- | --- |
| **0 — Foundation & VR Bootstrap** | 0.1 Project scaffold | ✅ Done |
| | 0.2 WebXR on Quest 3 | ✅ Done |
| | 0.3 Movement & physics | 🟡 Awaiting headset sign-off |
| **1 — Foyer & Meta Loop** | 1.1 Foyer scene & interaction | ⬜ Next |
| | 1.2 Game state & persistence | ⬜ |
| | 1.3 Shop & weapon dialog | ⬜ |
| **2 — Wave Combat Core** | 2.1 Procedural dungeon generation | ⬜ |
| | 2.2 Weapon & attack framework | ⬜ |
| | 2.3 Enemies, AI & wave loop | ⬜ |
| | 2.4 Hit feedback & VFX | ⬜ |
| **3 — Fear & Atmosphere** | 3.1 Darkness & lighting | ⬜ |
| | 3.2 Spatial audio | ⬜ |
| | 3.3 Horror direction | ⬜ |
| **4 — Depth & Polish** | 4.1 Full weapon roster | ⬜ |
| | 4.2 Full enemy roster & bosses | ⬜ |
| | 4.3 Third-person mode | ⬜ |
| | 4.4 Ship it | ⬜ |

---

## Sprint log

### ✅ Sprint 0.1 — Project scaffold

**Verified:** typecheck clean · 7/7 unit tests · production build succeeds · headless smoke
test renders the room (56% lit pixels, no console errors, simulated time tracking
wall-clock).

Delivered:

- Vite + TypeScript + React + R3F project, `@` → `src/` path alias.
- `src/core/loop.ts` — fixed 60Hz simulation decoupled from render rate, with a clamp on
  the maximum simulated slice per frame to prevent the spiral of death.
- `src/core/simulation.tsx` — `useFixedUpdate` for gameplay; R3F's `useFrame` stays for
  visual-only work. Driver kept at priority 0 so R3F retains rendering ownership (taking a
  non-zero priority would break WebXR frame submission).
- `src/scenes/GreyboxRoom.tsx` — 16×16m room, metre grid, 1.7m scale reference, pillars,
  and a constant-rate spinning probe that makes frame-rate-dependence visible.
- Dev instrumentation: F1 perf HUD, F2 leva tuning panel, both dev-only.
- `scripts/smoke.mjs` — headless render check.

Decisions made during the sprint:

- Vite 8 ships rolldown, which only accepts the **function** form of `manualChunks`.
- TypeScript 7 has **removed `baseUrl`**; path mapping must be relative (`./src/*`).
- Smoke test reuses whatever Chromium is already in the Playwright cache rather than
  pinning an exact build, so `npm update` doesn't trigger a 150MB download.
- The smoke test's fps figure is **not** a performance signal — it runs on SwiftShader.
  Real performance is measured on-device with the F1 HUD.

### ✅ Sprint 0.2 — WebXR on Quest 3

**Verified on desktop:** typecheck clean · 32/32 unit tests · production build succeeds ·
headless smoke test renders (55% lit pixels, no console errors, simulated time tracking
wall-clock, VR entry UI correctly resolving to "unavailable" with no XR device present).

**Verified on a Quest 3 (2026-08-02):** entered VR over LAN HTTPS; stereo rendering, 1:1
metre scale against the 1.7m reference column, both controllers tracked with rays, all
inputs mapped correctly on the diagnostics panel (analog triggers and grips, face buttons,
thumbsticks), per-controller haptics firing on the correct hand, and no camera motion other
than the player's head. Full acceptance test passed.

Delivered:

- `src/core/xr.ts` — the XR store. Requests `immersive-vr` explicitly (the library default
  prefers `immersive-ar`, and the Quest 3 supports passthrough — which would have dropped
  the player into a see-through version of a game whose whole premise is darkness).
  Optional session features we don't use are switched off; `layers` stays on.
- `src/systems/xrInput.ts` — controller state sampled once per fixed step into a plain
  mutable snapshot with one-step edge flags. The interface every later sprint's combat code
  reads from.
- `src/systems/haptics.ts` — named intensity presets, no-ops when no actuator is present so
  desktop and VR share one call path.
- `src/systems/settings.ts` — persisted settings with clamping and a version/migration path,
  seeded with the two XR render knobs. Kept separate from the game save on purpose.
- `src/ui/VRButton.tsx` — VR entry, with an explicit message for the insecure-context case.
- `src/entities/PlayerRig.tsx` — `XROrigin` at the spawn point (feet, not eyes).
- `src/scenes/XRDiagnostics.tsx` — world-space controller readout. Scaffolding; removed in
  Sprint 1.1 when the foyer lands.

Decisions made during the sprint:

- **Orbit controls unmount inside a session.** In XR the camera belongs to the headset;
  leaving them mounted would have them writing to it every frame behind the runtime's back.
- **Foveation is live, framebuffer scale is not.** The latter sizes the swapchain, which
  WebXR allocates once per session, so it only lands on the next VR entry. The tuning panel
  label says so rather than appearing to do nothing.
- **Indicators carry colour in `emissive`, not albedo.** A green lamp still looks green when
  it's off under ambient light, which made a disconnected controller indistinguishable from
  a tracked one. This is the rule the whole torch-lit dungeon will need.
- **The device emulator is opt-in** via `?xremulate`, not on by default — it injects a fake
  `navigator.xr` that would have the smoke test exercising a path no real player takes.
- Known, deferred to Sprint 4.4: the emulator's synthetic environments (~4.6MB) land in
  `dist/` as dead chunks. They're dynamically imported and never fetched at runtime with
  `emulate: false`, so this is deploy size only, not load time.

### 🟡 Sprint 0.3 — Movement & physics

**Verified on desktop:** typecheck clean · 111/111 unit tests · production build succeeds ·
smoke test passes, and it now *walks the player* rather than only checking that something
rendered — up the greybox staircase, a standing jump, staying grounded and inside the level
throughout.

**Awaiting VR sign-off.** Locomotion comfort is the one thing that genuinely cannot be
assessed on a monitor. In the headset, check:

1. **Smooth locomotion** — the left stick moves you where you are *looking*, not where the
   controller points. No drift when the stick is centred.
2. **Turning** — smooth by default (Carl's call, 2026-08-02); the right stick
   should rotate you at a steady, readable rate. Then switch `turn` to `snap` in the F2
   panel and confirm one turn per flick, never a spin while the stick is held.
3. **Comfort vignette** — closes as you move, opens as you stop, and never appears while
   you are standing still or turning your head.
4. **Teleport** — switch `locomotion` to `teleport` in the F2 panel before entering VR.
   Green arc on floor, red on walls and steep slopes, and you arrive where the marker was.
5. **Traversal** — walk up the stairs and the ramp without jumping. Walk into every wall,
   the pillars and the 0.7m ledge. Nothing should let you leave the room.
6. **Comfort rule** — nothing moves your view except your head and the turn you asked for.

Delivered:

- `src/systems/locomotion.ts` — the movement maths as pure functions, free of three.js and
  Rapier: radial deadzone, head-relative direction, the snap-turn latch, gravity and jump
  integration, vignette response, ballistic arc sampling and landing validity. 51 tests.
- `src/systems/desktopInput.ts` + sampler — keyboard/mouse into the same snapshot shape as
  `xrInput`, so the player controller reads one interface and doesn't care which device
  produced the numbers.
- `src/entities/PlayerRig.tsx` — kinematic capsule on Rapier's character controller, with
  the XR origin riding on it in VR and the camera on desktop.
- `src/entities/Teleport.tsx` — arc aiming, surface validation, landing marker.
- `src/ui/ComfortVignette.tsx` — head-locked dome that narrows the field of view under
  artificial motion.
- `src/core/physics.tsx` — steps Rapier from our fixed loop.
- Greybox gained colliders plus a staircase, a ramp and two ledges, so the controller's
  behaviour is visible rather than assumed.

Decisions made during the sprint:

- **One physics clock.** `<Physics paused>`, stepped from our fixed loop. Two accumulators
  both nominally at 60Hz drift in and out of phase, and a character controller querying a
  world that is sometimes half a step stale inherits that jitter into ground detection and
  every raycast downstream.
- **Smooth turning is the default**, at Carl's request, overriding the usual convention.
  Snap is the single most effective anti-nausea measure in VR, so it stays the first thing
  to reach for if anyone reports discomfort — but it is a preference, and the person playing
  it gets to set it. Both modes are wired, validated and persisted, so the settings screen
  in Sprint 4.4 is UI over an interface that already exists.
- **`migrate` is not optional on a versioned persist store.** Without one, zustand discards
  the whole stored blob on a version bump — so adding a movement setting silently reset the
  foveation and framebuffer scale tuned on-device in 0.2. The symptom is that the game just
  feels worse than it did yesterday, with nothing in the console.
- **Yaw lives on a group inside the rigid body**, not on the body. A capsule is rotationally
  symmetric, so pushing rotation through the physics pipeline buys nothing.
- **The vignette is a dome, not a plane.** A plane close enough to fill the view has stereo
  disparity, which reads as an object floating in front of your face. Every point on a dome
  is equidistant, so it reads as an absence of light.
- **The vignette is VR-only.** On a monitor there is no vestibular conflict to mask, and the
  same effect just looks like the game going dark at the edges whenever you walk.
- **Head heading blends the forward and up vectors** rather than switching between them at a
  threshold. Past vertical the forward vector still has enough horizontal length to pass any
  sensible threshold while already pointing *backwards* — so leaning your head back to look
  at the ceiling silently reversed "walk forward".
- `autostepMinWidth` **is bounded by tread depth minus capsule radius**, not tread depth.
  On 0.35m treads a 0.3m capsule leaves 0.05m; the default 0.2 wedged the player halfway up
  the stairs with no indication why. This sets the floor for the Sprint 2.1 tile kit: treads
  want to be at least `PLAYER_RADIUS + 0.05` deep.
- **Key presses are latched, not polled.** A tap shorter than one fixed step was being
  dropped outright — intermittently, and feeling like the game ignoring you rather than a
  bug. Caught by the smoke test's jump check.
- Known gap, deferred to Sprint 1.1: the capsule does not follow the headset when the player
  physically walks around their room, so in a small play space you can put your head through
  a wall. Doing it properly needs a decision about what happens when the capsule is blocked
  and the head isn't, and that wants real level geometry to tune against.
- Still open from 0.2: `Space` is jump here, but PLAN.md has it activating the door in
  Sprint 1.1. Likely resolution is contextual — activate when a prompt is showing, otherwise
  jump.

---

## How to pick this up in a new session

1. Read this file, then [PLAN.md](PLAN.md) for the sprint's scope and its ✅ acceptance test.
2. `npm install && npm run dev`
3. Confirm the current state still passes: `npm run typecheck && npm test && npm run smoke`
   (smoke needs the dev server running).
4. Work the next sprint, then update the status board and add a sprint log entry here.
