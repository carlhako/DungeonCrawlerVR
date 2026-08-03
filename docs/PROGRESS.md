# Progress

**Single source of truth for where the build is up to.** Update this at the end of every
sprint, before committing. The roadmap itself lives in [PLAN.md](PLAN.md).

---

## Current position

> **Sprint 1.3 is signed off on the Quest 3. Epic 1 is complete and verified.**
>
> Three headset passes each found something — spherical picking on flat buttons, a duplicate
> pointer aimed from the wrong pose, a beam a frame behind the hand — and all of it is fixed
> and checked in the headset. A "new game" plaque on the foyer's back wall wipes progression
> when you want to start over.
>
> Epic 1 is now complete end to end: start with 100 gold, buy and equip a weapon at a board
> on the shop counter, open the door, clear a wave, come back richer and spend it. All of it
> survives a reload.
>
> Next after sign-off is **Epic 2 — Wave Combat Core**, starting with **Sprint 2.1 —
> Procedural dungeon generation**. That is where the wave stops being a walk into an empty
> passage and the CC0 tile kit finally lands.

---

## Status board

| Epic | Sprint | Status |
| --- | --- | --- |
| **0 — Foundation & VR Bootstrap** | 0.1 Project scaffold | ✅ Done |
| | 0.2 WebXR on Quest 3 | ✅ Done |
| | 0.3 Movement & physics | ✅ Done |
| **1 — Foyer & Meta Loop** | 1.1 Foyer scene & interaction | ✅ Done |
| | 1.2 Game state & persistence | ✅ Done |
| | 1.3 Shop & weapon dialog | ✅ Verified on Quest 3 |
| **2 — Wave Combat Core** | 2.1 Procedural dungeon generation | ⬜ Next |
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

### ✅ Sprint 0.3 — Movement & physics

**Verified on desktop:** typecheck clean · 116/116 unit tests · production build succeeds ·
smoke test passes, and it now *walks the player* rather than only checking that something
rendered — up the greybox staircase, a standing jump, staying grounded and inside the level
throughout.

**Verified on a Quest 3 (2026-08-03):** full acceptance test passed. Head-relative smooth
locomotion with no drift on a centred stick, smooth turning at a readable rate, the comfort
vignette closing under artificial motion only, teleport arcs validating floor against walls
and steep slopes, and traversal of the stairs, ramp and ledges with every wall and pillar
holding. Nothing moved the view except the player's head and the requested turn.

One bug found in the headset and nowhere else: turning was still snapping after the default
changed, because the persisted value shadowed it. See the last decision below — the lesson
generalises well past this one setting.

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
- **Changing a default reaches nobody who has already played.** `partialize` persists every
  key, so a stored blob can't tell "the player chose snap" from "snap was the default the
  day this was written" — and the stored value shadows the new default forever. Caught in
  the headset: turning was still snapped after the default changed. Fixed with a version
  bump plus a `RESET_ON_MIGRATION` list naming the settings whose stored value to drop.
  **Every future default change needs the same treatment**, or it only applies to players
  with empty storage. The durable alternative — persisting only keys the player has actually
  touched — is worth doing before the settings screen lands in 4.4.
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

### ✅ Sprint 1.1 — Foyer scene & interaction

**Verified on desktop:** typecheck clean · 153/153 unit tests · production build succeeds ·
smoke test walks the acceptance test end to end — across the foyer until the door offers
itself, `Space` to open it, a wave started, no accidental jump, and out through the doorway —
then loads the greybox and re-runs the whole Sprint 0.3 movement course.

**Verified on a Quest 3 (2026-08-03):** the door can be opened and walked through into the
dark, and room-scale holds up — physically walking a couple of metres, then turning and
moving on, felt natural with nothing moving the view.

One thing found in the headset: the shop bell did nothing observable. It only wrote to the
console, which is invisible in VR, so pressing it was indistinguishable from a broken
interaction. It now rocks and glows when struck. The rule this hands to every later
interactable: **feedback has to exist in the world, or it does not exist.**

Delivered:

- `src/systems/interaction.ts` — the focus model: candidates register, one focus is picked
  per fixed step by reach, proximity or ray, and everything downstream reads it. 21 tests.
- `src/systems/InteractionDriver.tsx` — picks the focus from the camera on desktop and from
  both hands in VR, and turns a button press into an activation.
- `src/ui/InteractPrompt.tsx` + `src/ui/label.ts` — the world-space prompt, with text
  rasterised on a 2D canvas.
- `src/entities/Door.tsx` — a hinged kinematic door with a grabbable handle, which calls
  `startWave()` when it opens.
- `src/scenes/Foyer.tsx` — the room, with flickering torches, a shop counter for Sprint 1.3
  and a dark vestibule beyond the door.
- `src/systems/run.ts` — `startWave()`, deliberately a stub until 1.2.
- `src/entities/PlayerRig.tsx` — room-scale recentring, and `Space` resolved contextually.

Decisions made during the sprint:

- **Desktop needs proximity, VR does not.** A standing eye at 1.6m pointing dead level sails
  over a door handle at 1.05m *at every distance*, so a pure look-ray means the door is never
  offered and reads as broken. Reaching for something with your hand already answers the
  question in VR.
- **Reach beats ray, always.** "Nearest wins" reads as the game changing its mind about what
  you are holding as your hand drifts. Touch it, or point at it — a rule you can feel.
- **`Space` is contextual.** The interaction system runs before the player controller and
  reports whether it spent the key. A separate "use" key is one more thing to explain, and
  you are never trying to jump and open a door at the same instant.
- **Text is rasterised on a canvas, not fetched as a font.** The SDF text libraries pull a
  default font from a CDN on first use. A dungeon that silently loses all its text on a
  flaky connection is not worth nicer kerning. Revisit with a committed font file if the
  Sprint 1.3 shop panel needs to scale smoothly.
- **The door swings away from the player.** It is a solid kinematic collider; opening it
  towards them shoves them backwards, which is exactly the unrequested motion the comfort
  rule forbids. The sign is easy to get backwards and was, at first — caught by the smoke
  test, which found the player barged sideways out of their own doorway.
- **Room-scale is a second, separate collider query.** Locomotion resolves first, then the
  capsule is asked to chase the head; keeping them apart is what makes it possible to know
  how much of the *head's* movement the world refused, which is what drives the fade.
- **A blocked head fades the view even at `comfortVignette: 0`.** That setting is a statement
  about motion sickness, not a request to see the inside of the walls. There is no third
  option: the alternative is moving the camera.
- **An interaction with no world-space feedback reads as a bug.** The bell logged to the
  console, which does not exist in a headset. Every interactable from here needs a visible
  or felt response on activation — the haptic click is not enough on its own, and audio
  doesn't arrive until Sprint 3.2.
- **The foyer is bright, on purpose.** It is the one room that is meant to feel safe, and the
  dungeon's darkness is worth nothing without it. A dim foyer costs the dungeon its impact.
- Known gap: the foyer is built from primitives at real scale, not from an art kit. No CC0
  assets have been imported yet — that lands with the tile kit in Sprint 2.1, and this room's
  layout is the brief for it.
- Retired: `XRDiagnostics` now only mounts in the greybox, where it is still the fastest way
  to tell a dead thumbstick from broken locomotion.

### ✅ Sprint 1.2 — Game state & persistence

**Verified on desktop:** typecheck clean · 212/212 unit tests · production build succeeds ·
smoke test plays the whole loop — a fresh save with 100 gold, out through the door into the
wave, back in to clear it, the payout landing, a weapon bought, then a real page reload with
the gold, the weapon and the wave number all still there.

**Verified on a Quest 3 (2026-08-03):** the full loop — board, door, wave, clear, payout,
back to the foyer on the next wave — and the save survived a reload in the headset browser.

Delivered:

- `src/systems/save.ts` — the save as pure functions: gold arithmetic, purchases, upgrades,
  the loadout, and the sanitiser that has to survive whatever is actually in `localStorage`.
  No React, no browser. 41 tests.
- `src/systems/game.ts` — the persisted store, deliberately thin over those functions.
- `src/systems/run.ts` — the run state machine (`foyer → loading → wave → waveComplete →
  foyer`, plus `wave → death → foyer`), with illegal transitions refused and every legal one
  logged.
- `src/systems/RunDriver.tsx` — the placeholder that drives it until 2.3: a loading beat, and
  "walk out and come back" standing in for clearing a wave.
- `src/data/weapons.ts` — three weapon definitions with prices and upgrade tracks, which is
  what the save validates against. The full roster of ten lands in 4.1.
- `src/ui/StatusBoard.tsx` — gold and run state on a board by the door.
- `src/test/setup.ts` — an in-memory `localStorage` for the test environment.

Decisions made during the sprint:

- **The economy is pure functions, and the store is a wrapper.** Gold that vanishes costs a
  player their evening; gold that multiplies costs the game its progression. Both fail
  silently. Every rule about what a transaction may do lives in `save.ts` and is tested at
  that level — if a decision is being made in the store instead, it is in the wrong file and
  cannot be tested without a browser.
- **`merge` runs on a first launch too**, with nothing stored. Sanitising `undefined` there
  handed every brand-new player a zeroed save instead of their 100 gold. Caught by a test,
  and it would have been invisible in play — the only person affected is someone whose
  storage is empty, which is never the developer.
- **zustand's persist reaches through `window.localStorage`,** so it silently disables itself
  in a node test environment: `persist` isn't even attached, and every "the save survives a
  reload" test passes while proving nothing. The save now names its storage explicitly and
  the test environment supplies one. This is the second time this middleware's quiet failure
  mode has cost real time (see 0.3's `migrate`); it will not be the last.
- **Nothing is lost on death.** `death` and `waveComplete` differ only in whether a payout
  happened. There is a test asserting the save is untouched, specifically so a future
  "drop your gold" idea has to be an argued change rather than an accident.
- **The run phase is not persisted.** A restored mid-wave state would drop the player into a
  dungeon that was never generated. Reloading always returns you to the foyer — but the
  *wave number* comes from the save, or a returning player is greeted with a wave they
  cleared an hour ago. Caught by the smoke test's reload check.
- **A repeated `cleared` is refused rather than ignored quietly.** The stub clear condition
  is a position check running sixty times a second, so a payout that fired on every matching
  step is not hypothetical — it is what happens without the machine.
- **The board exists because of 1.1's rule.** A state machine and a balance that only appear
  in `console.info` are indistinguishable from nothing at all inside a headset. It is also a
  rehearsal for the 1.3 shop panel, which is the same problem at ten times the size.
- Known scaffolding, all of it with an owner: the loading pause and the walk-out-walk-back
  clear condition belong to the Wave Director in 2.3; buying a weapon goes through the dev
  console until the shop lands in 1.3.

### 🟨 Sprint 1.3 — Shop & weapon dialog

**Headset pass 1 (2026-08-03) — two defects, both fixed.** Reported: "you have to touch the
board to trigger the buttons, you can't just stand back a little and point"; and "I touch a
button with my hand but it highlights the button below."

One root cause: **buttons are flat rectangles and the picker only understood spheres.**

- An upgrade row is drawn 45cm × 7cm. Its inscribed sphere is 4cm across, so pointing needed
  ~1.5° of accuracy at 1.5m — on a button 45cm wide. Pointing read as broken.
- Near-grab reach was `radius + 12cm` = 16cm, across rows 8cm apart. Four rows were in reach
  at once and the nearest *centre* won. The controller's reported pose sits in the palm,
  behind and below the fingertip, so the winner was reliably the row below.

Fixed by giving `Interactable` an optional `surface` — a rectangle in world space — that both
pickers test against directly: a ray-plane intersection with a bounds check, and a hand test
that is generous perpendicular to the board (6cm either side) and exact in-plane. The pickable
target is now the drawn target, and a hand over the gap between two buttons picks neither,
which is the honest answer.

Three more things came out of it:

- **A visible pointer beam** (`src/ui/PointerBeam.tsx`). Aiming at something with nothing
  drawn to aim *with* is guesswork — you cannot correct an aim you cannot see. A dim 55cm stub
  from each controller, stretching to the target and lighting amber when it has one. Hidden
  while the teleport arc is up: two lines out of one hand saying different things is a mess.
- **Both hands point now**, not just the right. Which hand you point with is handedness, not
  something the game gets an opinion on.
- **The trigger that confirms is the one on the hand that found the focus**, so pointing with
  one hand is no longer confirmed by a trigger pull on the other.

Covered by seven new tests built on the real board geometry (`interaction.test.ts`, "flat
buttons on a panel") and by a new smoke step that stands 1.8m back and aims 15cm off the
centre of a button — an ordinary way to use a board, and a certain miss before this.

**Headset pass 2 (2026-08-03) — the picking works; the pointer itself was wrong twice
over.** Reported: "the virtual controllers have 2 pointers, one must be a default that
hasn't been turned off"; and "the new one points the wrong direction, I have to almost point
the controller at the ground to hit the buttons."

- **Two beams.** `@react-three/xr`'s default controller ships a ray pointer for DOM-style
  pointer events on 3D objects. We don't use those — interaction goes through
  `src/systems/interaction.ts`, which owns the one-focus-per-step rule — so it was drawing a
  second line that nothing in the game read. The store now takes our own controller
  (`src/entities/XRController.tsx`): the model, an aim anchor, and no pointers.
- **The beam pointed at the floor.** WebXR gives an input source two poses. The **grip** pose
  sits in the fist with its axes following the controller's body; the **target ray** pose is
  the one the runtime says the player is aiming with, tilted up from the grip by roughly the
  angle at which a controller sits in a relaxed hand. `@react-three/xr` only exposes the grip
  object — it is where the controller model hangs — so aiming with its -Z meant aiming down
  the controller's body at the ground. `src/systems/xrAim.ts` now publishes each hand's
  target ray pose, and the beam, the picker's ray and the teleport arc all use it. Touching
  still uses the grip, which is the pose that knows where the hand is.

The teleport arc was aimed from the grip too. It read as usable because an arc bends
downwards anyway, but it was aimed several degrees below where the hand was pointing the
whole time; it now agrees with the beam.

**Headset pass 3 (2026-08-03) — the beam lagged the hand.** Reported: "when moving there are
2 pointer lines, one lagging behind the main pointer; as soon as I stop moving the 2nd line
merges into the main line." Also while turning, and while waving the hand about.

One line, drawn a frame late. The beam wrote *world space* vertices at the aim pose read from
`matrixWorld`, but an `XRSpace` object's matrix is written by a `useFrame` at priority -100
and composed into `matrixWorld` during the render that follows — so the pose we read was
always the previous frame's. Standing still that is invisible; moving, it separates from the
controller by however far the hand travelled in 14ms, and the headset's reprojection smears
the gap into a convincing second line.

Fixed by parenting: `PointerBeam` is now a child of the controller's target ray space
(`src/entities/XRController.tsx`) and draws a unit line down its own -Z, scaled to length.
The pose carries it, so there is no pose to read and nothing to be late. **Anything attached
to a tracked pose should be parented to it, not positioned from it** — the same rule the
teleport arc breaks deliberately, because that geometry has to stay in the world while the
player teleports out from under it.

**Verified on desktop:** typecheck clean · 252/252 unit tests · production build succeeds ·
smoke test buys and equips a weapon *through the panel* — walking to the counter, aiming at
each button, pressing the key — including a purchase it cannot afford, then reloading the
page and finding the gold, the weapon, the loadout and the wave number all still there.

**Verified on the Quest 3 (2026-08-03), on the fourth pass.** What was checked:

1. Walk to the counter. The board reads your gold, the three weapons and what you own.
2. **Stand back a step and point** at a weapon row, with either hand, and pull the trigger.
   There should be exactly **one** beam per hand, leaving along the line the controller looks
   like it is aiming down — not tipped at the floor, and staying welded to the hand while you
   walk, turn and wave it about. The beam should reach the row you are
   aimed at, that row alone should highlight, and aiming anywhere along it — not just at its
   centre — should work.
3. **Reach out** and press a button with your hand instead. The button under your hand must
   win over whatever the ray is crossing — and it must be the button you are touching, not
   its neighbour. Try the row directly above and below the one you want, deliberately.
4. Buy something you can afford, then put it in each hand in turn.
5. Try to buy something you cannot afford. The refusal must say why, on the board.
6. Reload the page. Everything you bought and equipped is still there.
7. Switch to teleport locomotion and aim the arc. It now leaves along the same line as the
   beam, so check it still lands where you expect after years of muscle memory elsewhere.

Delivered:

- `src/systems/shop.ts` — the shop as a *layout*: the save in, a list of buttons out, each
  with a rectangle, a state and a prompt. 20 tests, including that no two buttons overlap and
  none is drawn off the edge of the board.
- `src/ui/ShopPanel.tsx` — one canvas texture for the whole board, with an interactable
  registered at the world position of each rectangle.
- `src/data/weapons.ts` — base stats and the upgrade effects, so the shop's "12 → 14" reads
  from the same table Sprint 2.2 will fire from.
- `src/systems/interaction.ts` — a `proximity` opt-out, a corrected focus precedence, and
  rectangular (`surface`) picking for anything flat.
- `src/ui/PointerBeam.tsx` — the line out of each controller that shows where you are aiming.
- `src/systems/reset.ts` + `src/ui/ResetPlaque.tsx` — the "new game" plaque, added after
  sign-off. A board on the foyer's back wall that wipes gold, weapons, upgrades and wave
  counters back to a first launch. **Two presses:** the first arms it and says what the
  second one will do, and it stands down on its own after six seconds. Settings are not
  touched — comfort options are about the person, not the run. 10 tests on the arming
  machine, and a smoke step whose central assertion is that the *first* press changes
  nothing at all.

Decisions made during the sprint:

- **Aim beats proximity on desktop.** Standing at the counter offered the *bell* — the
  nearest thing to the player's body — no matter which button they were staring at. Focus now
  resolves reach → ray → proximity, so proximity is the fallback it was always meant to be:
  it exists because a level look-ray sails over a door handle, not because being near
  something is a statement of intent. Caught by the smoke test on its first run at the shop.
- **Panels opt out of proximity entirely.** With eight buttons 12cm apart, "nearest to the
  player" is a coin toss. They are aimed at, or touched. A hand *on* a button still wins.
- **The layout is data and the canvas is presentation.** Every question worth asking about a
  shop — is the buy button still offered for something you own, does an unaffordable upgrade
  read as unaffordable, can a two-hander go in your off hand — is a question about a list of
  objects. Answering those in a headset is an appalling way to spend an evening.
- **The focus highlight is a quad, not part of the drawing.** Pointing along a row changes
  the focus several times a second, and re-rasterising a megapixel to move a border is a
  hitch you can feel in a headset. The canvas now redraws only when the *contents* change.
- **The panel is drawn at 0.72 scale.** At full size, a player standing where the counter
  puts them had a board filling most of their field of view. Physically large UI is
  uncomfortable in VR in a way it never is on a monitor.
- **Prices are measured before labels are drawn**, and the label condenses into what is
  left. "Boneshard Staff120g" was the first thing the render showed; weapon names are content
  and will get longer.
- **Stats are shown for what you don't own yet**, next to what you are currently holding.
  A price with no numbers beside it is not a decision anyone can make.
- **Refusals are spoken, not silent.** "Not enough gold." on the board. A button that quietly
  does nothing is indistinguishable from a broken one — the same rule the bell taught in 1.1.
- Known scaffolding: purchase SFX is deferred to Sprint 3.2 with the rest of the audio; the
  visible flash, the message strip and the haptic click stand in for it. `__DCVR__.lookAt`
  exists because headless Chromium has no pointer lock, and without it the shop — which
  necessarily faces the room from behind the counter — could not be tested outside a headset.

---

## How to pick this up in a new session

1. Read this file, then [PLAN.md](PLAN.md) for the sprint's scope and its ✅ acceptance test.
2. `npm install && npm run dev`
3. Confirm the current state still passes: `npm run typecheck && npm test && npm run smoke`
   (smoke needs the dev server running).
4. Work the next sprint, then update the status board and add a sprint log entry here.
