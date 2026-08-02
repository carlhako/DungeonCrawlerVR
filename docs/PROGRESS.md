# Progress

**Single source of truth for where the build is up to.** Update this at the end of every
sprint, before committing. The roadmap itself lives in [PLAN.md](PLAN.md).

---

## Current position

> **Sprint 0.2 is built and awaiting on-headset sign-off. Next up: Sprint 0.3 — Movement & physics.**
>
> Everything verifiable from a desktop passes. The parts that only a Quest 3 can confirm —
> stereo rendering, controller tracking, haptics, true scale — are listed under
> "What to check in the headset" in the README. Sprint 0.3 can start before that sign-off;
> if the headset turns up a problem it will be a fix to 0.2's code, not a rewrite of 0.3's.

---

## Status board

| Epic | Sprint | Status |
| --- | --- | --- |
| **0 — Foundation & VR Bootstrap** | 0.1 Project scaffold | ✅ Done |
| | 0.2 WebXR on Quest 3 | 🟡 Built — awaiting headset sign-off |
| | 0.3 Movement & physics | ⬜ Next |
| **1 — Foyer & Meta Loop** | 1.1 Foyer scene & interaction | ⬜ |
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

### 🟡 Sprint 0.2 — WebXR on Quest 3

**Verified on desktop:** typecheck clean · 32/32 unit tests · production build succeeds ·
headless smoke test renders (55% lit pixels, no console errors, simulated time tracking
wall-clock, VR entry UI correctly resolving to "unavailable" with no XR device present).

**Not yet verified — needs the headset.** Stereo rendering, controller tracking, haptics
and true 1:1 scale cannot be checked from a desktop at all. The step-by-step check is in
the README under "What to check in the headset".

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

---

## How to pick this up in a new session

1. Read this file, then [PLAN.md](PLAN.md) for the sprint's scope and its ✅ acceptance test.
2. `npm install && npm run dev`
3. Confirm the current state still passes: `npm run typecheck && npm test && npm run smoke`
   (smoke needs the dev server running).
4. Work the next sprint, then update the status board and add a sprint log entry here.
