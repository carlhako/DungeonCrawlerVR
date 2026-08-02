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

Open <http://localhost:5173>.

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server on localhost (http) |
| `npm run dev:xr` | Dev server over HTTPS on the LAN — required for Quest 3 |
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

## Architecture notes

- **`src/core/loop.ts`** — fixed 60Hz simulation, decoupled from render rate. Gameplay
  registers here via `useFixedUpdate`; purely visual work uses R3F's `useFrame`. This is
  what keeps behaviour identical at 60fps on a desktop and 72/90/120fps in a headset.
- **One unit is one metre.** The headset reports real-world metres; any other scale makes
  the player feel wrongly sized.
- **VR comfort is a hard rule.** Nothing moves the VR camera except the player's head — no
  screenshake, no forced rotation.
- **In-game UI is world-space and diegetic**, so desktop and VR share one implementation.
  DOM is reserved for the pre-session menu.

## Layout

```
src/
  core/      simulation loop, debug hooks
  systems/   cross-cutting gameplay systems
  entities/  player, enemies, projectiles
  scenes/    foyer, dungeon, greybox
  ui/        diegetic panels and dev overlays
  data/      weapon / enemy / wave definitions
scripts/     smoke test
```
