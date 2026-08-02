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

### Desktop controls

Click the canvas to capture the mouse — pointer lock needs a user gesture, so mouselook is
inert until you do. `Esc` releases it.

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` / arrows | Move |
| Mouse | Look |
| `Shift` | Sprint |
| `Space` | Use, when a prompt is showing — otherwise jump |

### VR controls

| Input | Action |
| --- | --- |
| Left thumbstick | Move (smooth mode) / aim the teleport arc (teleport mode) |
| Right thumbstick | Turn — smooth by default, snap optional |
| Right controller | Points the teleport arc |
| Either controller | Points the interaction ray — one dim beam per hand shows where |
| Trigger | Use whatever your beam is on, or whatever your hand is touching |
| Grip | Use whatever your hand is on (near-grab only) |
| `A` | Jump (smooth mode only) |

Locomotion mode, turn style, speed and vignette strength all live in the F2 panel under
**Movement**, and persist. See "Comfort" below.

### Dev keys

- `F1` — frame/perf HUD
- `F2` — live tuning panel (Movement, XR render, Lighting, Physics)

### Scenes

The game opens in the **foyer**. The Sprint 0.1–0.3 greybox is still there at
`?scene=greybox` — it is the only room with a staircase, a ramp and a ledge to walk at, so
it stays as the character controller's test rig and the smoke test still drives it.

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
5. **Comfort** — nothing moves your view except your own head, other than the turn you
   asked for. Report anything that doesn't hold; this is a hard rule, not a preference.
6. **Movement** — walk with the left stick; you should go where you are *looking*, not
   where the controller points. The right stick turns you smoothly, and the vignette should
   close while it does. Walk up the stairs and the ramp without jumping; walk into the walls
   and the 0.7m ledge and stop dead. Nothing should let you leave the room.
   Then switch `turn` to `snap` and check it fires once per flick, never a spin while held.
7. **Teleport** — switch `locomotion` to `teleport` in the F2 panel *before* entering VR.
   Hold the left stick forward to aim from the right controller; the arc turns green on
   valid floor and red on walls, ceilings and steep slopes. Release to move.
8. **Interaction** — point at the door handle from across the foyer and pull the trigger,
   then walk up and grab it with your hand instead. Both should open it, and the prompt
   should name the button you would actually use. Ring the shop bell too — pointing at one
   thing while stood next to another must never address the wrong one.
9. **Room-scale** — physically walk a few steps without touching the stick. Your body should
   come with you: walk into a wall and the view fades out rather than letting you see
   through it, and it should come back as you step away.
10. **The run loop** — the board by the door reads `Gold 100` and `Wave 1 awaits`. Open the
    door, walk out through the doorway and back in: the wave clears, the board shows the
    payout, and you are handed back to the foyer on the next wave with more gold. Reload the
    page and both must still be there.
11. **The shop** — walk to the counter, then stand back a step. Point at a weapon on the
    board with either hand and pull the trigger; the beam should reach it and aiming anywhere
    along a button, not just at its centre, should work. Then reach out and press a button
    with your hand instead — including the rows directly above and below the one you want,
    which must never steal the press. Buy something you can afford, put it in each hand in
    turn, and try to buy something you cannot — the refusal has to say why. Every purchase
    must survive a reload.

### Comfort

The comfort settings are not cosmetic — smooth locomotion makes a meaningful number of
people ill, and nothing in this game will ever *require* it. Set these from the F2 panel
before entering VR; they persist.

- **`locomotion`** — `smooth` (default) or `teleport`.
- **`turn`** — `smooth` (default) or `snap` (30°). Note this is the *less* comfortable
  default: snap turning is the single most effective anti-nausea measure in VR, which is why
  nearly everything ships with it on. **If anyone reports discomfort, switch to snap first.**
- **`comfortVignette`** — how far the field of view narrows while you are being moved by
  something other than your own legs. 0 disables it.

Room-scale walking is handled: the capsule follows your head, and the play space slides back
by the same amount so nothing moves the view. When the capsule can't follow — you have
physically walked your head into a wall — the view fades out instead, because the only other
options are moving the camera (forbidden) or letting you see through the level.

### Saves

Progression (gold, owned weapons, upgrades, wave number) persists to `localStorage` under
`dcvr.save`, separately from settings under `dcvr.settings` — wiping one never wipes the
other. To start over, in the browser console:

```js
__DCVR__.resetSave()
```

`__DCVR__` is dev-only. It also exposes `save`, `run`, `shop`, `targets` (every registered
interactable and where it is), `send(event)`, `buyWeapon(id)` for setting up a state without
walking to the counter, and `lookAt(x, y, z)` — which exists because headless Chromium has no
pointer lock, so the smoke test would otherwise be unable to face anything but `-Z`.

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
- **`src/systems/locomotion.ts`** — the movement maths, free of three.js and Rapier so it
  can be unit-tested. Deadzones, the snap-turn latch, gravity, the teleport arc. VR movement
  bugs are miserable to diagnose with a headset on and trivial to reproduce here.
- **One physics clock.** Rapier is mounted `paused` and stepped from our fixed loop
  (`src/core/physics.tsx`), not from its own. Two accumulators both nominally at 60Hz drift
  in and out of phase, and a character controller querying a world that is sometimes half a
  step stale inherits that jitter into ground detection and every raycast downstream.
- **`src/systems/save.ts` is pure, `game.ts` is a wrapper.** Gold, purchases, upgrades and
  the loadout are plain functions over a plain `SaveData`, tested without a browser. The
  store's only jobs are holding the current save and writing it to `localStorage`. An economy
  bug fails silently in both directions — gold that vanishes and gold that multiplies look
  identical from inside the game — so the rules live where they can be tested exhaustively.
- **`src/systems/run.ts`** — the run state machine. `foyer → loading → wave → waveComplete →
  foyer`, plus `wave → death → foyer`. Illegal transitions are refused and logged, which is
  what stops a wave starting twice or a payout landing twice. The phase is deliberately not
  persisted; the wave number is.
- **Nothing is lost on death.** Progression is pure RPG: dying costs you the wave and nothing
  else. There is a test asserting it.
- **`src/systems/shop.ts` is a layout, not a UI.** It turns the save into a list of buttons
  with rectangles, states and prompts; `src/ui/ShopPanel.tsx` rasterises that list onto one
  canvas and registers an interactable at each rectangle. So "is the buy button still offered
  for something you already own?" is a question about a data structure, answerable in a unit
  test rather than by putting a headset on and walking to a counter.
- **`src/systems/interaction.ts`** — one focus, picked once per step, shared by desktop and
  VR. Desktop looks at a thing and presses a key; VR points at it or reaches for it. The
  moment "what is the player addressing?" gets answered in two places, the two modes start
  disagreeing about what is interactive, and nobody notices until a door won't open in the
  headset. Candidates are spheres by default and *rectangles* when they declare a `surface`:
  a shop button is drawn 45cm wide and 7cm tall, and picking the sphere inscribed in it made
  the panel unusable from more than a hand's reach away.
- **Aiming uses the target ray pose, holding uses the grip pose** (`src/systems/xrAim.ts`).
  WebXR reports both for every controller, and `@react-three/xr` only hands us the grip one
  because that is where the controller model hangs. Its -Z runs down the controller's body,
  so a beam drawn along it points at the player's feet. `src/entities/XRController.tsx`
  replaces the library's default controller to publish the target ray pose — and to *not*
  draw the library's own ray pointer, which was a second beam obeying a different picker.
- **Text is rasterised on a canvas** (`src/ui/label.ts`), not fetched as a font. SDF text
  libraries pull a default font from a CDN on first use, and a dungeon that silently loses
  all its text when the network hiccups is not a trade worth making.
- **Player state is a plain singleton** (`src/systems/player.ts`), like `xrInput`. The
  vignette reads it every frame; enemy aggro and the scare director will read it sixty times
  a second. None of that should re-render the scene graph.

## Layout

```
src/
  core/      simulation loop, physics driver, XR store, debug hooks
  systems/   input, locomotion, haptics, settings, player state, save, run machine
  entities/  player rig, teleport, enemies, projectiles
  scenes/    foyer, dungeon, greybox
  ui/        diegetic panels, comfort vignette, VR entry, dev overlays
  data/      weapon / enemy / wave definitions
scripts/     smoke test
```

The smoke test does more than check that something rendered. It plays the game: it walks the
player across the foyer until the door offers itself, presses `Space`, asserts that a wave
started and that the player did *not* also jump, walks them out through the doorway and back
in to clear the wave, checks the payout landed and the wave counter advanced, then walks to
the shop counter and buys and equips a weapon *through the panel* — aiming at each button and
pressing the key, not calling the store — including a purchase it cannot afford, which has to
be refused out loud. Then it **reloads the page** and asserts the gold, the weapon, the
loadout and the wave number all came back.
Finally it loads the greybox and runs the movement course — up the staircase and a standing
jump, staying grounded and inside the level.

Every one of those failures renders a completely convincing room the whole way. A player
sinking through the floor, strolling out through a wall, getting a prompt for the wrong
object, or losing every weapon they bought on reload all look perfect in a screenshot, which
is exactly why the assertions are about state rather than pixels.
