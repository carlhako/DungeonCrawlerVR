# Progress

**Single source of truth for where the build is up to.** Update this at the end of every
sprint, before committing. The roadmap itself lives in [PLAN.md](PLAN.md).

---

## Current position

> **Next up: Sprint 0.2 — WebXR on Quest 3**
>
> Blocked on nothing. First sprint that needs on-headset testing by Carl —
> stereo rendering, controller tracking, and haptics can't be verified from a desktop.

---

## Status board

| Epic | Sprint | Status |
| --- | --- | --- |
| **0 — Foundation & VR Bootstrap** | 0.1 Project scaffold | ✅ Done |
| | 0.2 WebXR on Quest 3 | ⬜ Next |
| | 0.3 Movement & physics | ⬜ |
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

---

## How to pick this up in a new session

1. Read this file, then [PLAN.md](PLAN.md) for the sprint's scope and its ✅ acceptance test.
2. `npm install && npm run dev`
3. Confirm the current state still passes: `npm run typecheck && npm test && npm run smoke`
   (smoke needs the dev server running).
4. Work the next sprint, then update the status board and add a sprint log entry here.
