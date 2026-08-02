# Dungeon Crawler VR

A browser-based 3D dungeon crawler with RPG and roguelite elements. Plays fullscreen on
desktop and in VR on the Meta Quest 3 browser via WebXR.

**Game Mode 1 — Wave Defence:** start in a foyer with 100 gold, buy and upgrade weapons,
open the door to enter a dark procedurally generated dungeon, survive waves of enemies,
return richer. Progression is persistent.

The full roadmap lives in `docs/PLAN.md`.

## Stack

React Three Fiber · three.js · `@react-three/xr` · Rapier physics · zustand · TypeScript · Vite

## Running it

```bash
npm install
npm run dev
```

The dev server binds `0.0.0.0`, so it is reachable from other machines on the network. Vite
prints both URLs on startup:

```
➜  Local:   http://localhost:5173/
➜  Network: http://10.0.1.54:5173/
```

Use the **Network** URL from your desktop or laptop. Plain HTTP is fine for desktop
testing — but **VR needs HTTPS**, so use `npm run dev:xr` for the headset (see below).

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server on `0.0.0.0:5173` (http) — localhost and LAN |
| `npm run dev:xr` | Same, but over HTTPS — required for Quest 3 |
| `npm run build` | Typecheck, then production build to `dist/` |
| `npm test` | Unit tests (gameplay logic) |
| `npm run smoke` | Headless render check against a running dev server |
| `npm run typecheck` | Typecheck only |

### Dev keys

- `F1` — frame/perf HUD
- `F2` — live tuning panel

## Testing on the Quest 3

WebXR requires a secure context. `localhost` counts, but the Quest is a different machine,
so LAN access needs HTTPS.

**Option A — HTTPS over the LAN (no cable):**

```bash
npm run dev:xr
```

Note the network URL it prints (e.g. `https://192.168.1.42:5173`), open it in the Quest 3
browser, and accept the self-signed certificate warning once. Both devices must be on the
same network.

**Option B — USB, no certificate prompt:** enable developer mode on the headset, then

```bash
adb reverse tcp:5173 tcp:5173
```

and open `http://localhost:5173` in the Quest browser. `localhost` is a secure context, so
WebXR works without a certificate.

**If there is no "Enter VR" button on the headset,** the page is almost certainly not on a
secure origin — `navigator.xr` simply does not exist over plain http on a LAN address. The
page says so explicitly rather than showing nothing; use `dev:xr` or `adb reverse`.

### What to check in the headset

Enter VR and confirm, in order:

1. **Stereo** — the room has depth, and the 1.7m scale-reference column reads as roughly
   your own height. If it looks like a doll's house or a cathedral, the metre scale is wrong.
2. **Tracking** — both controller models are visible and follow your hands, each with a ray.
3. **Input** — the diagnostics panel in front of the spawn point has one column per hand.
   Squeeze the trigger and grip (bars fill proportionally), press A/B and X/Y (lamps light),
   and push the thumbstick (the dot follows it). The bar at the top of each column is lit
   while that controller is tracked.
4. **Haptics** — each trigger pull buzzes *that* controller, not both.
5. **Comfort** — nothing moves your view except your own head. Report anything that doesn't
   hold; this is a hard rule, not a preference.

### Desktop VR emulator

Append `?xremulate` to the dev URL to run the iwer Quest 3 emulator in a desktop browser.
It is useful for poking at input plumbing without putting the headset on, and is opt-in on
purpose — it injects a fake `navigator.xr`, which would otherwise have the smoke test
exercising a path no real player takes. It is **not** a substitute for on-device testing:
it tells you nothing about performance, stereo comfort, or tracking.

### Render settings

`foveation` and `framebufferScale` persist in `localStorage` and are the two knobs that
decide whether the Quest holds 72fps. Set them from the F2 tuning panel on the desktop
before entering VR — leva is DOM, so it is invisible once the headset takes over.
Foveation applies live; framebuffer scale sizes the swapchain and so only takes effect on
the next VR entry.

## Architecture notes

- **`src/core/loop.ts`** — fixed 60Hz simulation, decoupled from render rate. Gameplay
  registers here via `useFixedUpdate`; purely visual work uses R3F's `useFrame`. This is
  what keeps behaviour identical at 60fps on a desktop and 72/90/120fps in a headset.
- **One unit is one metre.** The headset reports real-world metres; any other scale makes
  the player feel wrongly sized.
- **VR comfort is a hard rule.** Nothing moves the VR camera except the player's head — no
  screenshake, no forced rotation.
- **In-game UI is world-space and diegetic**, so desktop and VR share one implementation.
  DOM is reserved for the pre-session menu and the Enter VR button, which has to be a real
  HTML element because entering a session requires a user gesture.
- **`src/systems/xrInput.ts`** — controller state is sampled once per fixed step into a
  plain mutable snapshot, not a hook. Gameplay reads `xrInput.right.trigger.justPressed`.
  Edge flags are true for exactly one step, which is what makes "fire on trigger press"
  behave identically at 72, 90 and 120fps.
- **`src/systems/haptics.ts`** — haptics carry the weight screenshake carries on a flat
  screen, without moving the camera. Every impact and cast routes through here.

## Layout

```
src/
  core/      simulation loop, XR store, debug hooks
  systems/   input, haptics, settings, cross-cutting gameplay systems
  entities/  player rig, enemies, projectiles
  scenes/    foyer, dungeon, greybox
  ui/        diegetic panels, VR entry, dev overlays
  data/      weapon / enemy / wave definitions
scripts/     smoke test
```
