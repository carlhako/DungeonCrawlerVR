# Progress

**Single source of truth for where the build is up to.** Update this at the end of every
sprint, before committing. The roadmap itself lives in [PLAN.md](PLAN.md).

---

## Current position

> **Epics 0 and 1 are signed off on the Quest 3, and so are Sprints 2.1 and 2.2. Sprint 2.3 —
> enemies, AI and the wave loop — is written and green on the desktop, and is waiting on a
> Quest 3 pass. Sprint 2.4 — stealth & enemy awareness — is also desktop-green and awaiting
> its Quest 3 pass. Sprint 2.5 — HUD overlays: enemy counter and explored-area map — is
> signed off on the Quest 3: both HUDs were invisible in the headset on the first pass (the
> XR camera's projection matrix is asymmetric and the placement math assumed it wasn't), and
> once visible they were pinned to the top edge and a bottom corner, past where a headset's
> FOV reaches without turning the head. Both are now a hold-to-show popup near screen centre,
> summoned by holding a face button on either controller. Sprint 2.6 — hit feedback & VFX — is also
> desktop-green and awaiting its Quest 3 pass: bolts leave a muzzle flash and a trail, hits
> throw sparks, kills come apart in ash and dissolve, and the camera never moves in VR.
> Sprint 2.7 — enemy models & textures — is **built and desktop-green, and waiting on the
> art**. Everything that turns a GLB into an enemy is in and tested: the loader, the clip
> mapping, the material contract, and `EnemyShape` as the seam Sprint 2.3 promised. What is not
> in is the pack itself — `public/models/` is empty by design, Carl downloads it (its README
> says exactly what and where), and until he does, every enemy is still the capsule it has been
> since 2.3. That is not a broken state: a missing model is a resolved answer, not an error.
> Four Quest 3 passes are outstanding behind it.**
>
> **There is something in the dungeon now.** Open the door, walk down the passage into the
> generated level, and a wave composed from the wave number comes looking for you: Goblin
> Skulkers that hit and back off, Skeleton Warriors that plant and telegraph a swing you can
> step out of, and — from wave three — Wraiths, which ignore the walls entirely. They arrive
> out of sight and out of reach, a few seconds apart, and they path around the level rather
> than through it.
>
> The wave is over when everything in it is dead, and it pays what you actually killed. Then
> you walk home; nothing teleports you. You can retreat into the foyer mid-wave — it is the
> safe room, and health only comes back there — but the wave will still be waiting.
>
> You can also die now. Dying costs the wave and nothing else: you come back to the foyer
> whole, with exactly the gold, weapons and wave number you left with.
>
> The weapons are the Sprint 2.2 pair, unchanged: the Emberwand throws arcing fire bolts that
> cost mana and set things burning; the Frostbrand cuts when you actually swing it, chills
> what it hits, and interrupts a wind-up if you land it hard enough.
>
> The meta loop it hangs off is complete and verified: 100 gold, buy and equip a weapon at
> the shop board, set your comfort options on the wall without taking the headset off, open
> the door, clear a wave, come back richer and spend it — or wipe the lot from the plaque on
> the back wall. All of it survives a reload.

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
| | 1.4 In-world options & new game | ✅ Verified on Quest 3 |
| **2 — Wave Combat Core** | 2.1 Procedural dungeon generation | ✅ Verified on Quest 3 |
| | 2.2 Weapon & attack framework | ✅ Verified on Quest 3 |
| | 2.3 Enemies, AI & wave loop | 🟡 Desktop green — Quest 3 pass outstanding |
| | 2.4 Stealth & enemy awareness | ✅ Desktop green — Quest 3 pass outstanding |
| | 2.5 HUD overlays: enemy counter & map | ✅ Verified on Quest 3 |
| | 2.6 Hit feedback & VFX | ✅ Desktop green — Quest 3 pass outstanding |
| | 2.7 Enemy models & textures | 🟡 Built & desktop-green — needs the Quaternius pack in `public/models/` |
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

### ✅ Sprint 1.3 — Shop & weapon dialog

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

### ✅ Sprint 1.4 — In-world options & new game

Not in the original plan. It was added the moment the question "how do I get to game
options?" had no good answer: they were in the **F2 dev panel** — DOM, desktop-only, stripped
from production builds, and gone the instant the headset takes over the page. Which meant a
player who discovered they needed teleport locomotion had to take the headset off, press a
key, and put it back on, *after* being made ill once. A comfort setting that can only be
changed outside VR is not a comfort setting.

So both remaining out-of-world controls became things in the room, the same way the shop did.

**Verified on desktop:** typecheck clean · 268/268 unit tests · production build succeeds ·
smoke test walks to the settings board, switches to teleport, steps two values, checks the
change reached `localStorage`, restores the defaults — then walks to the plaque and presses
it twice, asserting the save is untouched after the first press and reset after the second,
with the settings not wiped along with it.

**Verified on the Quest 3 (2026-08-03).** What was checked:

1. **The settings board** is on the wall left of the door, readable from where you spawn.
   Point at **Teleport** and pull the trigger. The choice should go green, and the change
   should be live *immediately* — push the left stick forward and you should be aiming an
   arc, without leaving VR.
2. Step **Vignette** and **Walk speed** up and down. Values change on the board as you press,
   and a stepper at the end of its range greys out rather than doing nothing silently.
3. **Render scale** says on the board that it applies on your next VR entry — because the
   swapchain is allocated once per session, and a button that visibly does nothing is
   indistinguishable from a broken one. Change it, leave VR, come back, and it should hold.
4. **Restore defaults** puts everything back and then greys itself out.
5. Reload the page. Every setting you chose is still chosen.
6. **The new game plaque** is on the back wall, behind the spawn — turn around. One press
   arms it and the board turns red and says what the next press does; a second wipes gold,
   weapons and upgrades. Leave it armed and walk away: it must stand down by itself.
7. **Wipe the save, then check the settings board.** Your comfort options must still be
   exactly as you left them.

Delivered:

- `src/systems/settingsPanel.ts` — the board as a *layout*: settings in, buttons with
  rectangles and states out. 18 tests, including that no two buttons overlap, none runs off
  the board, and a stepper lands exactly on its limit rather than near it.
- `src/ui/SettingsBoard.tsx` — the canvas board, on the wall beside the door.
- `src/systems/reset.ts` + `src/ui/ResetPlaque.tsx` — the "new game" plaque and the arming
  machine behind it. 10 tests.
- `src/ui/panelButtons.ts` — one registration path shared by every world-space panel.
- `src/core/debug.ts` — `__DCVR__.settings`, so the smoke test can assert the thing that
  matters about two stores: wiping one does not touch the other.

Decisions made during the sprint:

- **The comfort settings go where you can see them from the spawn point**, beside the door,
  not tucked away. They decide whether somebody can play at all; they are the last thing that
  should need finding.
- **The destructive control goes on the opposite wall.** A reset that shares a wall with the
  door you use every run is a reset somebody presses by accident.
- **Two presses for the wipe, one for everything else.** Nothing else in the game is
  irreversible, and the player's entire vocabulary is "point and pull the trigger".
- **The render-scale caveat is printed permanently, not shown as a message after a press.**
  It was briefly a transient strip along the bottom of the board — which sat on top of the
  Restore defaults button. A fact that is always true should always be on the wall.
- **Stepped values are rounded to their step.** `0.7 - 0.05` is `0.6499999999999999`, and a
  few presses of a 0.05 stepper leave a vignette that can never land back on zero: the "off"
  button stays live forever and the board grows a tail of digits. There is a test for it.
- **The third copy of "register these rectangles as interactables" became the only copy.**
  The shop, the settings board and the plaque all do it, and a button's *pick* shape drifting
  from its *drawn* shape is precisely what made the shop unusable on the first headset pass.
- Known scaffolding: the F2 panel stays for now. It tunes things the player has no business
  setting (physics, lighting, collider display), and it is still the faster tool at a desk.

### ✅ Sprint 2.1 — Procedural dungeon generation

**Verified on desktop:** typecheck clean · 365/365 unit tests · production build succeeds ·
smoke test opens the door, walks 16m down the passage into the generated level, and checks
the player is standing on a cell the generator calls floor — then walks back out, which puts
the level away.

The sprint's own acceptance test is a unit test: **twenty seeds, every one connected and
traversable, and the same seed always the same map.**

Delivered:

- `src/systems/dungeon/rng.ts` — seeded RNG (mulberry32) and a string hash, so a level that
  goes wrong is reproducible from one number. Nothing procedural may call `Math.random`.
- `src/systems/dungeon/generate.ts` — rooms by rejection sampling, joined with a minimum
  spanning tree plus a few extra links for loops; L-shaped corridors; wall marking; torch
  placement; spawn selection; and `validate`, which flood-fills the finished grid.
- `src/systems/dungeon/nav.ts` — the navigation bake and 8-way A*, ready for the enemies in
  2.3. Diagonals need both orthogonals open, so nothing squeezes through a wall corner.
- `src/systems/dungeon/store.ts` — the live dungeon and its placement in the world.
- `src/scenes/Dungeon.tsx` — the level as geometry: instanced meshes, merged wall colliders,
  and a small pool of torch lights moved onto whichever torches are nearest.
- `src/systems/lightPool.ts` — which torches get a real light, and how a light hands over
  from one torch to the next without the player seeing it happen. Pure and unit-tested.
- `src/ui/DungeonMapView.tsx` — the `F3` top-down debug map: rooms, torches, spawns, and
  where you are. The only non-diegetic UI in the game, and dev-only.
- `src/core/debug.ts` — `__DCVR__.render` (draw calls, triangles, live lights) and
  `__DCVR__.dungeon`, both of which the smoke test now asserts against.

Decisions made during the sprint:

- **Connectivity is built in *and* checked.** The spanning tree makes every room reachable by
  construction; `validate` then flood-fills anyway and `generate` retries a seed that fails.
  A wave that cannot be finished because two rooms never joined up is not a difficulty spike,
  and in the dark it is indistinguishable from being lost.
- **`generate` throws rather than returning something broken.** A caller that has to handle
  "the dungeon didn't work" will handle it by crashing in front of somebody in a headset.
- **The player walks in; they are never teleported in.** The level is anchored so its mouth
  meets the end of the foyer's passage exactly. A cut to black in VR is a cut to somebody
  wondering where they went.
- **The level has exactly one hole in it.** Every edge cell is solid except the mouth, and
  there is a test that says so. The first build sealed *every* edge, including the one the
  passage attached to — so the player walked into the dark and stopped against an invisible
  wall.
- **One seed per wave, forever.** Wave 3 is always the same dungeon: the player gets to learn
  a level rather than being handed noise, and "wave 3 is broken" becomes a complete bug
  report.
- **Six lights, seventy torches.** Every torch is emissive geometry — free, and visible far
  enough away to read a corridor before you are in it — and a small pool of point lights moves
  onto the nearest ones. Moving lights rather than mounting one per torch matters: creating
  and destroying lights recompiles every material they touch, which on a Quest is a hitch
  every few steps as you walk.
- **Torch intensity is 24, not 7.** Quadratic falloff makes that number much bigger than it
  looks. At 7 the corridors were not atmospheric, they were unlit — found by walking the
  level headlessly and looking at the screenshots.
- **Wall colliders are merged into strips**, turning ~800 cuboids into a couple of hundred
  for geometry that never moves.
- The passage cap got **its own rigid body**. A Rapier body with `colliders="cuboid"` builds
  its colliders from the children it had when it mounted, so removing the cap's mesh left the
  collider standing — an invisible wall exactly where the dungeon was supposed to start.

### 2.1 — headset pass 1, two defects fixed

Reported from the Quest: *"as you walk into dark rooms the lights come on as you get closer,
like they are triggered"*, and *"I can't see the lamps, it's like they are on the other side
of the wall"*.

- **The flames were inside the wall.** The offset from the wall cell's centre *subtracted* the
  clearance where it should have added it, putting every 9cm flame 12cm short of the wall
  face — that is, buried in solid rock. Only the point light, which is not occluded, escaped;
  hence light with no visible source. Torches are now a flame standing clear of the face, a
  dark bracket below it, and a small additive halo so an unlit torch still reads as fire from
  across a room. Three instanced draws for every torch in the level.
- **The light pop-in took two attempts.** Fading a torch out by distance was the obvious first
  fix and it barely moved the measurement, because range fade only smooths a torch on its way
  *out*. Rounding a corner onto a torch three metres away lands inside the full-brightness
  radius, so the slot still jumped straight to full. The second attempt rate-limited every
  slot towards its target — fixed the jump, but still read as "the light switches on" from the
  headset, because a fixed-duration *linear* ramp has a hard onset: constant velocity from a
  standing start. The third attempt is what's in now: an **exponential** ease (`GROWTH_TAU` in
  `src/systems/lightPool.ts`) that moves a shrinking fraction of the remaining gap each
  instant — fastest when furthest off, decelerating into the target, the difference between an
  ember catching and a bulb being switched on. Flicker was also pulled out of the ramped value
  entirely: it used to share a timescale with the ramp, which meant tuning one always fought
  the other; flicker is now applied to the ramp's *output*, once per frame, so the two no
  longer trade off against each other. A reassigned slot still drives itself to zero before
  swapping torch and ramping up on the other side — the light only ever moves while dark —
  and slots still hold their torch under hysteresis so two similar-distance torches don't trade
  a light back and forth as the player turns. The visual falloff's own start point also moved
  further out (`FALLOFF_START`, separated from the unrelated hysteresis threshold that used to
  share its value), widening the distance over which a torch visibly grows on approach.
- The pool went from four lights to six. Four covered about one room, so the fifth torch in a
  large room stayed dark until the player displaced one.
- **A fourth pass, from the headset: torches faded, then suddenly switched off.** Splitting
  `FALLOFF_START` from the hysteresis threshold (previous point) widened *where a torch starts
  dimming* without widening *where it becomes safe to take from its slot* — they'd shared one
  value before. A torch between the old hold distance and the new, wider fade start could be
  60-70% bright and still lose its slot to a nearer competitor, hitting the fast handover drop
  — which is only invisible when it starts near zero — while clearly lit. `HOLD_FRACTION`
  moved out to 0.82 to fix that, and `stepLightSlot` gained a third case: a slot that has
  simply lost budget contention, with nothing else waiting for it, now eases towards zero *in
  place* at the same unhurried pace as growth, rather than being forced through the fast drop
  meant only for an active handover. That also means a slot picks its own torch back up
  without restarting if the player just oscillates near the edge of its range, since the slot
  never actually let go of it.

Worth recording, because it cost time twice: the *feel* of this ramp **cannot be judged under
SwiftShader**. Headless frames run at roughly 0.6s each and the fixed-step loop catches up
across them, so a metre of walking spans hundreds of simulation steps and every per-frame or
per-metre intensity metric is dominated by movement rather than by the ramp's own shape — it
could not tell a linear ramp from an exponential one, which is exactly the distinction that
mattered. What headless verification actually proves here is the *invariants*: unit tests pin
that no input — reassignment, a torch appearing point-blank, a flicker spike — can move a slot
by more than its rate allows, and that the exponential phase's per-frame step strictly shrinks
rather than holding constant. Screenshots earn their keep for *placement*, not smoothness.
Whether the ease itself now reads as natural, rather than merely bounded, is a headset call.

Also corrected: headset checklist item 13 told Carl to watch the frame HUD in the biggest
room. `r3f-perf` is a DOM overlay and does not composite into an immersive session, so there
was nothing to look at. The item now asks for judder on head turns, and notes that an
in-headset readout is Sprint 3.1's job — which that sprint's own acceptance test requires, so
it cannot ship without one.

**Verified on the Quest 3 (2026-08-03), on the second pass.** The door leads into a generated
level, the torches read as sconces on the wall rather than light from nowhere, the level can be
walked deep into and back out of without an invisible wall, and the lights now grow and fade the
way an ember catches instead of switching on — no partway fade-then-cutoff. Sprint 2.1 is
signed off; the light pool's remaining work is Sprint 3.1's budget manager, not a defect.

Known scaffolding, and the one deliberate gap:

- **No CC0 art kit yet.** The plan had the Quaternius dungeon tiles landing here; the level is
  built from primitives at real scale instead, the same way the foyer is. Importing an asset
  pack means downloading it, which is a decision to make deliberately rather than in the
  middle of a sprint — and the generator emits a tile grid, so swapping primitives for a kit
  is a change to `Dungeon.tsx` alone.
- Lighting is the honest minimum, not a lighting pass. **Sprint 3.1** owns fog, the ambient
  floor, shadow strategy and the real light budget manager.
- The wave still clears by walking back into the foyer. **Sprint 2.3**'s Wave Director takes
  that over, along with the spawn points and the nav grid this sprint bakes for it.

### ✅ Sprint 2.2 — Weapon & attack framework

**Verified on desktop:** typecheck clean · 474/474 unit tests · production build succeeds ·
smoke test walks up to a training dummy, holds the trigger, and checks that health came off,
that mana was spent and came back, that the wand fired at its rate rather than every step —
then walks to a fire-resistant dummy and checks the same volley costs it visibly less, and
finally swings the blade and checks the target ends up **chilled**, which only the Frostbrand
can do.

Delivered — the rules, all pure and unit-tested, none of them importing three.js:

- `src/systems/combat/damage.ts` — the one path from "something hit something" to "the target
  lost health": crit, element, resistance, and the statuses an element leaves behind. 26 tests.
- `src/systems/combat/resources.ts` — mana, and cooldowns derived from the weapon table's
  `rate`. One pool for the whole player. 19 tests.
- `src/systems/combat/melee.ts` — swing speed, the damage curve it drives, and the conversion
  into the player's own frame that keeps walking from counting as swinging. 20 tests.
- `src/systems/combat/projectiles.ts` — the pool, flight, expiry, and the swept-segment
  contract with the world. 15 tests.
- `src/systems/combat/targets.ts` — the damageable registry, segment/sphere sweeps, the single
  `applyDamage`, and the ring buffer the damage numbers read. 23 tests.
- `src/systems/combat/weapon.ts` — one hand holding one weapon, and the four reasons it may
  refuse to attack. 20 tests.

And the wiring:

- `src/systems/CombatDriver.tsx` — the ordering, at `SystemOrder.Combat`: mana, then each
  hand, then flight, then impacts, then the status tick.
- `src/entities/WeaponRig.tsx` — the weapon in a hand, in both modes, and the anchor every
  other system measures from.
- `src/entities/Projectiles.tsx` — the whole pool as one instanced draw.
- `src/entities/TrainingDummy.tsx` — three dummies in the foyer, with different resistances.
- `src/ui/DamageNumbers.tsx` — billboarded, pooled, with the digits cached by text.
- `src/systems/settings.ts` — a **main hand** setting, and the board row for it.

Decisions made during the sprint:

- **Every attack goes through one `resolveDamage` and one `applyDamage`.** Crit, element,
  resistance and status are four rules that each want to apply "just this once, for my case",
  and the moment two of them exist in two places the game has a weapon that cannot crit and
  an enemy immune to nothing. A burning status ticking damage goes through the same path, so
  a target that burns to death dies properly rather than quietly losing health.
- **Damage is rounded to a whole number when it is resolved, not when it is drawn.** The
  player is shown the figure and the target loses exactly it. A number that says 14 while
  13.6 came off is a health bar that never quite adds up and a bug nobody can reproduce.
- **A wand is pointed; a blade is an extension of the fist.** So the wand's rig hangs in the
  controller's target-ray space, on the same line as the pointer beam, and the sword's hangs
  off the grip. Aiming a wand down the grip is the Sprint 1.3 defect that pointed at the
  floor. *(The direction the blade sticks out of the grip is the one thing here that cannot be
  checked without a headset — see the checklist.)*
- **Melee speed is measured in the player's own frame.** Carrying a blade at a 3 m/s walk is
  faster than the speed floor, so a world-space measurement makes *walking into things* an
  attack, and stick-turning on the spot sweeps the blade through several metres a second
  without the player moving their arm. Found by the smoke test, which reported the sword
  swinging while the player was walking to it.
- **The swing's cooldown starts when it *hits*, not when it gets fast.** The first version
  spent the swing on the single fixed step where the speed crossed the floor — nine
  centimetres of arc, at the start of the movement, which is where the blade is furthest from
  what it is aimed at. Every number looked right and the sword hit nothing. With the cooldown
  on the hit, the window stays open across the arc: swinging at air is free, connecting costs
  a full swing, and waggling is still worthless because each *hit* spends one.
- **Nothing is ever tested as a point.** A bolt at 18m/s covers 30cm in a fixed step and a
  sword tip covers 10cm — both wider than most of what they are aimed at, and than every wall.
  Projectiles and swings both sweep the segment from where they were to where they now are.
- **The weapon is the HUD.** A wand's tip dims while it is cooling and brightens when it is
  ready; the mana bar is drawn on the weapon that spends it, and only on weapons that spend
  it. A floating cooldown wheel is a tax on every second of a horror game, and this readout is
  already where the player is looking.
- **Three dummies, not one.** One proves a bolt can land. Three with different resistances
  prove the *pipeline* — that the element a weapon deals survives the trip to the target,
  which is the part that can be silently wrong while everything still looks like it works.
- **A main-hand setting, because `main` and `off` had to mean something.** The save has
  equipped weapons to `main`/`off` since 1.2 specifically so a left-handed player is not made
  to hold the sword in their weak hand; this sprint is where that meets a real controller, and
  the headset cannot guess. Settings version bumped to 4, and the board's rows were tightened
  to fit a ninth — with a test that two rows never come closer than twice the near-grab
  tolerance, which is what made the shop unusable on its first headset pass.
- **The desktop viewmodel is drawn at half scale.** At full size a real 30cm wand held 55cm
  from a 70° camera filled a quarter of the screen. In a headset that is correct and
  unremarkable, because your eyes and your arm agree how far away it is; on a monitor there is
  no such agreement and it reads as a comedy prop. Only the drawing is scaled — the anchor,
  which is where bolts leave from, is not.
- **R3F's default camera is not in the scene graph.** A viewmodel portalled into it had its
  world matrix computed correctly — the driver fired from exactly the right place — and was
  never drawn. A weapon that works and is invisible is the most confusing possible pair of
  symptoms; `scene.add(camera)` costs nothing, since a camera draws nothing itself.
- **Desktop melee is one animation, not a second damage path.** The viewmodel's arc moves the
  same anchor a real arm moves, and the same speed rule measures it. The "active hitbox
  window" the plan asks for is not a flag: it is the blade actually moving fast enough.

**Headset pass 1 (2026-08-03) — two defects, both fixed.** Reported: "I can no longer move or
turn" in VR; and, against the README's own acceptance line, "[the wand's tip] doesn't change
brightness, or if it does its not enough — it seems to be the same brightness all the time."

- **Entering VR froze movement and turning completely.** `@react-three/xr`'s `<XR>` swaps
  R3F's `state.camera` to `gl.xr.getCamera()` the instant a session starts, and `XROrigin`
  parents that camera under the player rig so the head moves and turns with it.
  `DesktopWeaponRig`'s new `scene.add(camera)` effect (below) had `camera` in its dependency
  array, so it fired again on that swap and reparented the XR camera onto the scene root —
  the headset kept tracking, but disconnected from the rig, so walking the capsule or
  snap/smooth-turning the yaw group no longer moved what you saw. Fixed by skipping the
  effect entirely while `inSession`, so it only ever touches the desktop camera.
- **The wand's cooldown glow read as constant.** Two compounding causes: the emissive
  intensity (`base * (0.25 + 0.75 * ready)`, base 5) pushed a saturated element colour like
  fire's past 1.0 on most channels at *both* ends of the cooldown, so the display clipped the
  "just fired" and "fully ready" states to nearly the same bright colour; and `ready` ramped
  linearly, so a fast weapon like the Emberwand (rate 3.2/s) spent most of its ~0.3s cycle
  already past halfway brightness — the genuinely dim moment was one or two fixed steps, too
  short to register at a glance. Fixed by lowering peak intensity (wand 5→2.4, blade 0.45→0.9)
  so the bright end has headroom instead of clipping to the same colour as the dim end, and by
  squaring the cooldown fraction so the tip stays visibly dim through the first half of the
  window and saves the climb for the last stretch — the read that actually matters, "nearly
  ready" rather than "just fired". Both weapon archetypes share this code, so the Boneshard
  Staff — a slower weapon, more time to read — gets the same fix for free.

**Verified on the Quest 3 (2026-08-03).** Full acceptance test passed: the Emberwand fires
arcing bolts from the tip, its mana bar drains and refills, its cooldown tip now visibly dims
and brightens; the Frostbrand only cuts on a real swing, not on walking into a dummy or
stick-turning with the blade held out; the resistant dummy visibly takes less from the same
element; a burning-to-death dummy dies through the same path as everything else. Movement and
turning work throughout a session. Sprint 2.2 is signed off.

Known scaffolding, and the gaps:

- **`three-mesh-bvh` is still unused.** The plan had hitscan raycasts going through it; every
  attack in this sprint is a swept segment against a small registry of spheres plus one Rapier
  ray, which is both cheaper and simpler at this scale. The case for a BVH arrives with real
  enemy meshes in 2.3, and PLAN.md now says so rather than leaving a promise nobody kept.
- **The Boneshard Staff does not charge.** It fires as an expensive slow wand. Hold-to-charge
  is its whole identity and it belongs with the rest of the roster work in 4.1; the two weapons
  this sprint owes end-to-end are the Emberwand and the Frostbrand, and both are.
- Impact VFX, hitstop and the dissolve are **Sprint 2.4**. The damage numbers landed early
  because this sprint's acceptance test names them; everything around them is still a haptic
  pulse and a hit flash.
- Purchase and combat **audio is Sprint 3.2**, as it has been since 1.3.
- The dummies are primitives, like everything else. Still no CC0 art kit.

### 🟡 Sprint 2.3 — Enemies, AI & the wave loop

**Verified on desktop:** typecheck clean · 602/602 unit tests · production build succeeds ·
smoke test plays the whole loop — out of the door, into the generated level, waits for the
wave to arrive, checks it *closed the gap* rather than idling where it spawned, kills one with
the wand, clears the rest, walks home, and checks the payout is exactly the sum of what died.
Then it goes back out, gets hit by a real enemy, dies to one, and checks it came back to the
foyer whole with exactly the gold, weapons and wave number it left with.

**Not yet verified on the Quest 3.** The headset checklist is README items 16 and 17, and the
one thing on it that cannot be judged at a desk is the telegraph: whether the wind-up is
actually readable from across a dark room, and whether you can step out of a swing. That is
the whole design of this sprint and a monitor cannot answer it.

Delivered — the rules, all pure and unit-tested, none of them importing three.js:

- `src/data/enemies.ts` — three enemies that are three *different problems*, not three sets of
  numbers. The Skulker hits and leaves; the Warrior plants and telegraphs; the Wraith walks
  through the walls.
- `src/data/waves.ts` — a budget and a cost per enemy rather than a hand-written roster, so
  wave seventeen composes itself. 36 tests.
- `src/systems/enemies/ai.ts` — the state machine: spawning, idle, chase, telegraph, strike,
  recover, stagger, dying. 32 tests, shared with the pool.
- `src/systems/enemies/steering.ts` — path following, separation, wall sliding and turn rate,
  as arithmetic over numbers. 25 tests.
- `src/systems/enemies/pool.ts` — every enemy that can exist, allocated once.
- `src/systems/waves.ts` — the Wave Director: composition, staggered spawning, the clear
  condition, and gold per kill. 16 tests.
- `src/systems/vitals.ts` — the player's health, invulnerability frames and death. 11 tests.
- `src/systems/dungeon/nav.ts` — `hasLineOfSight`, a supercover walk that refuses to thread a
  wall corner, the same way `findPath` does. 7 tests.

And the wiring:

- `src/systems/EnemyDriver.tsx` — the ordering, at `SystemOrder.AI`: begin or end the wave,
  spawn, decide, move, strike, bury, then ask whether it is over.
- `src/entities/Enemies.tsx` — one group per pool slot, mounted once.
- `src/entities/WeaponRig.tsx` — a health bar beside the mana bar, on every weapon.
- `src/ui/ComfortVignette.tsx` — the same head-locked dome now carries the hurt flash.
- `src/systems/run.ts` — `cleared` takes what the player earned; `waveReward` is a floor
  under it rather than a curve.
- `src/systems/RunDriver.tsx` — lost the placeholder clear condition it has carried since 1.2.

Decisions made during the sprint:

- **The telegraph is the whole design.** Every other number in `enemies.ts` is in service of
  the wind-up existing and being legible: an enemy plants, does not move, rears back, and
  flares its eyes before it commits. An enemy without one is not difficult, it is arbitrary —
  damage arrives with no preceding information, and in VR being hurt by something you had no
  chance to read is precisely what makes people take the headset off. It gets three separate
  visual channels because one of them will be invisible in a dark corridor.
- **The reach check happens on the strike step, not at the start of the wind-up.** The player
  has had the whole telegraph to leave; a blow that lands because a range check ran a second
  ago is exactly the unfair damage the telegraph exists to prevent.
- **Aggro is reaction; hunting is intent.** Seeing the player inside the aggro radius, or being
  shot, turns an enemy on you immediately — with a real line-of-sight test, so a level does not
  read as a set of trip-wires. But nothing here is ambient: every enemy is placed by the
  director as part of a wave the player has to clear. Left to line of sight alone they idle
  sixty metres away forever and the only way to finish a wave is to go room to room looking for
  them. So an idle enemy starts hunting a couple of seconds later regardless. Found by walking
  the level headlessly and watching two skeletons stand still for forty-five seconds.
- **They come from near the player, not from the deep end.** `map.spawns` is sorted
  furthest-from-the-entry first, and taking the front of it put wave one's skeletons in the far
  corner of a forty-cell level — a hundred and ten metres of corridor at 1.5 m/s, which is a
  minute and a half of standing in an empty dungeon waiting for a fight. The pathfinding was
  right the whole time and the geography was absurd. Spawns are now the nearest candidate that
  is at least nine metres away **and out of line of sight**, capped at twenty-six. Something
  that fades into existence while you are looking at it is not frightening, it is a spawner.
- **Enemies are not rigid bodies.** A dozen Rapier character controllers stepping against a few
  hundred wall colliders is most of a Quest's frame, for movement the nav bake already
  describes. They move kinematically and ask the grid whether where they are going is floor —
  which has the useful side effect that nothing can be shoved through a wall by an impulse,
  because there are none.
- **The wave clears when everything is dead, not when the player walks back.** That was the
  placeholder from 1.2 and it made the foyer an exit rather than a refuge. Retreating is now
  allowed and always was — the foyer is the safe room, health only comes back there — it just
  does not finish anything, so eventually you have to come out.
- **After clearing, you walk home.** The level stays standing and empty until the player is
  back in the foyer. Sprint 2.1 built the whole passage so that nobody is ever teleported into
  a dungeon; teleporting them *out* of one the instant the fight ends gives that back for
  nothing. Death is the single exception, and the only forced camera move in the game: there is
  no walk home available from dead.
- **The payout is per kill.** A flat clear bonus pays the same for fighting through a wave as
  for hiding in a corridor until the last thing wanders off, and it makes the shop's prices
  meaningless once the wave count outruns the difficulty.
- **Invulnerability frames, because three enemies reach you on the same fixed step.** Without
  them a pack deals 3×18 in sixteen milliseconds, which is not difficulty — it is a player with
  nothing to react to. Half a second, which is deliberately shorter than the fastest enemy's
  recovery so a single attacker is still dangerous.
- **Health is restored in the foyer and nowhere else.** Regeneration during a wave rewards
  backing into a corridor and waiting, which is the least interesting thing a player can do in
  a horror game.
- **Enemy damage goes through `resolveDamage` and then into `vitals.ts`, not `applyDamage`.**
  The player is deliberately *not* in the damageable registry: they would be swept by their own
  projectiles and cut by their own sword, and a floating damage number would appear inside their
  face. So the element, resistance and rounding rules are shared and the landing is not.
- **A wave that has never started looks exactly like one that has finished** — empty queue,
  nothing spawned, nothing alive. The director needs an explicit `running` flag, and without it
  the very first wave the player ever opens the door on ends on the step it begins. Which is
  what it did, for one memorable headless run.
- **React effects are the wrong place to react to a phase change made inside the fixed loop.**
  The wave used to be started by a `useEffect` watching the run phase, which does not run until
  React has re-rendered — at least a frame, and possibly several fixed steps, later. Every wave
  therefore ran its first steps against a director that had not been started. Reacting to the
  transition on the same step it happens is the only ordering that is actually true.
- **No health bars on enemies.** Three floating red bars advancing down a corridor is a
  strategy game. The player already learns what they did from the damage numbers and the hit
  flash; the training dummies keep their bars because a dummy exists to be measured against.
- **Nothing about being hit moves the camera.** No shake, no knockback, no forced turn — the
  feedback is haptics in both hands and red at the edge of vision, drawn on the *same*
  head-locked dome as the comfort vignette, because there is exactly one thing allowed to sit
  between the player's eyes and the world.

Known scaffolding, and the gaps:

- **Still no CC0 art kit.** PLAN.md had GLTF models with Mixamo clips landing here. Enemies are
  primitives, like the foyer, the dungeon, the weapons and the dummies before them. What is not
  deferred is the job those animations were there to do: every AI state is readable at a
  distance. Swapping in a kit is a change to `EnemyShape` alone.
- **`three-mesh-bvh` is still unused,** for the same reason it was in 2.2 — there are no enemy
  meshes to build one over. Hit spheres plus swept segments remain both cheaper and simpler.
- **No loot drops.** Gold is paid on death rather than dropped as a pickup. A pickup is an
  interactable, a physics body and a VFX, and all three belong with the rest of the feel work.
- Impact VFX, hitstop and the dissolve are **Sprint 2.4**, as they have been since 2.2. A dying
  enemy currently falls over and sinks into the floor.
- **Audio is Sprint 3.2**, as it has been since 1.3 — which costs more here than anywhere so
  far. Half of what makes something behind you frightening is hearing it.
- The light budget still does not know enemies exist. **Sprint 3.1** owns that.

---

### ✅ Sprint 2.4 — Stealth & enemy awareness

**Verified on desktop:** typecheck clean · 619/619 unit tests · production build succeeds.

Delivered:

- `src/systems/stealth.ts` — the detection rules as pure functions: aggro radius scaled by
  player movement speed, weapon noise pulses that ignore line of sight, and a 30-second
  safety valve that replaces the old 2-second `HUNT_DELAY`. 14 tests.
- `src/systems/enemies/ai.ts` — the idle detection now uses three paths: `enemy.alerted`
  (from damage or noise), LOS within `aggroRadius × detectionScale`, and the safety valve
  at `MAX_IDLE_SECONDS`. `detectionScale` added to `AiContext`.
- `src/systems/EnemyDriver.tsx` — computes `detectionScale` from `playerState.speed` each
  step; processes `noiseEvent` to alert idle enemies within range with no LOS required.
- `src/systems/CombatDriver.tsx` — emits a noise pulse on every wand fire and every melee
  swing fast enough to register, hit or miss, before the sweep check.

Decisions made during the sprint:

- **Three detection paths, not one.** The old `HUNT_DELAY` was a single flat timer. The new
  system separates detection into three independent paths — being hurt/alerted, being seen at
  speed-scaled range, and the safety valve — so each can be tuned and tested independently.
- **The noise pulse sits before the hit sweep.** For melee, `emitNoise` fires before
  `sweepDamageables`, so a swing that misses still breaks stealth. For wands, it fires before
  `spawnProjectile`, so the muzzle report itself is what alerts enemies.
- **The noise origin is the player, not the weapon tip.** A 20m radius covers most rooms
  regardless of where exactly the muzzle was, and keeping it simple avoids questions about
  which hand fired and whether the noise source is inside a wall.
- **`detectionScale` is linear between quiet and loud.** No hard cliff at a threshold that a
  player can't see — speed just above 1.0 m/s is only slightly more detectable than speed
  just below.
- **The safety valve is 30s, not 2s.** The old `HUNT_DELAY` made stealth impossible — every
  enemy was on you two seconds after spawning regardless. Now the safety valve is the
  *last resort*, not the primary mechanic. It exists to prevent wave stalls, not to be the
  normal way fights begin.
- **No changes to `chase`.** Once an enemy has you, it has you — exactly as the spec says.
  Breaking line of sight during a chase does not reset to idle, and there is no route back.
- **Large rooms need no new code.** `hasLineOfSight` already sees further in open rooms, so
  crossing one unseen is naturally harder than a corridor — the detection scaling plays out
  correctly with no special cases.

### ✅ Sprint 2.5 — HUD overlays: enemy counter & explored-area map

**Verified on desktop:** typecheck clean · 628/628 unit tests · production build succeeds ·
both HUDs render in a live wave, correctly positioned.

**Verified on the Quest 3**, after two rounds of headset-only fixes below: typecheck clean ·
666/666 unit tests · both HUDs invisible until a face button is held, then appear near
centre without needing to look up or into the periphery.

Delivered:

- `src/systems/dungeon/explored.ts` — cell-level fog of war: which dungeon cells the player
  has visited, stored as a packed-integer `Set`. Cleared when the dungeon is built or torn
  down. The map renderer reads this to decide what to draw; it writes nothing itself. 19 tests.
- `src/systems/ExploredDriver.tsx` — marks the cell the player stands on (plus immediate
  neighbours) as explored each fixed step, at `SystemOrder.HUD`. Runs during `wave`,
  `waveComplete` and `death` — any time the player is in the dungeon.
- `src/ui/HudOverlay.tsx` — a head-locked canvas-textured quad, the shared foundation for
  both Sprint 2.5 HUDs. Follows the XR camera in VR and the desktop camera otherwise, using
  the same pattern as `ComfortVignette`. Draws a caller-supplied function every frame onto a
  small offscreen canvas; the quad is positioned with a head-local offset so the caller
  places it at top, bottom-left, or wherever it belongs.
- `src/ui/EnemyCounter.tsx` — "killed / total" counter at the top centre of the view.
  Reads the Wave Director's `killed` and `total` directly; only mounts during the `wave`
  phase. Killed count drawn in gold for at-a-glance readability.
- `src/ui/ExploredMap.tsx` — small north-up minimap at the bottom-left corner. Reads
  the explored-cell set and draws floor cells as the player visits them; unvisited areas
  stay dark. The player marker is a triangle that rotates to show body yaw. The map view
  centres on the player and shows roughly a 12-cell radius.
- Dungeon store (`src/systems/dungeon/store.ts`) now clears the explored set on `build`
  and `clear`, so entering a new dungeon starts with a fresh map.

Decisions made during the sprint:

- **Head-locked 3D quads, not DOM.** A DOM overlay is invisible inside an immersive WebXR
  session — the browser compositor does not draw HTML on top of the stereo render. A
  head-locked quad parented to the camera works identically in both modes, and the pattern
  was already proven by `ComfortVignette`.
- **One `HudOverlay`, two HUDs.** The enemy counter and the map share a single foundation
  component that handles head tracking, canvas creation, and positioning. The caller
  provides size, offset, and a draw function — nothing else. Two screen-space HUDs that
  each built their own head-locked mesh would diverge the first time one of them got the
  render-order wrong.
- **The HUD redraws every frame.** Both canvases are tiny (256×64 and 200×200) and the
  drawing operations are a handful of filled rects and text. Caching the static portions
  of the map (explored cells don't un-explore) would save microseconds on a canvas this
  size — not worth the complexity of cache-invalidation when the explored set grows or
  the dungeon changes.
- **`SystemOrder.HUD` runs after combat and effects.** The explored driver needs the player's
  final position for the step, and the counter reads director state that was updated during
  the AI phase. Running at 550 puts it after everything that mutates state and before audio
  (600), which doesn't exist yet.
- **The map is north-up, not forward-up.** The spec says it does not rotate with the
  player's heading. The quad itself is head-locked (follows the camera), but the map
  content is drawn with a fixed world orientation — the arrow rotates, not the terrain.
- **Radius-1 explore fill.** Marking the cell the player is on plus its immediate neighbours
  means opening a door on a room fills the room rather than filling one cell. Torches light
  a space; the map shows what the player could reasonably have seen.

Known gaps:

- The map resolution is low (4px/cell, 200×200 canvas). A larger dungeon shows more area
  but at lower detail; room labels and a zoom/scale function belong with the wrist-mounted
  diegetic HUD in Sprint 4.4.
- The enemy counter has no animation — the number ticks immediately. A brief flash or
  count-up is a feel polish item for Sprint 2.6 or later.
- In VR both HUDs are now hold-to-show (see the headset pass below) rather than always on,
  which covers most of the immersion-preference case. Desktop still has no visibility toggle
  or opacity setting — the settings board already has a row budget, so straightforward to add
  when asked.
- Noise pulses (Sprint 2.4) and the explored driver share the same fixed step but don't
  interact — they don't need to. The explored set is purely a map concern.

Fixed after the first desktop pass:

- **Both HUDs were invisible — a sign error, not a rendering bug.** `HudOverlay`'s head-local
  offset composed the forward component as `fwd * oz` where `fwd` is already the world-space
  forward direction and `oz` follows the same -Z-is-forward convention; the two negatives
  should have cancelled and didn't, so every quad sat behind the camera instead of in front
  of it. Correct geometry, correct material, correct texture — just outside the frustum.
  Five commits chased this as a mesh/texture/orientation problem before the actual cause
  turned up in the offset math.
- **Fixed-metre placement doesn't mean "top" or "bottom-left."** A small constant nudge only
  reads as an edge position at one particular FOV and window aspect; it drifts toward centre
  as the frustum widens. `offset` became `anchor`: `[x, y, forwardMetres]` where x/y are
  signed fractions of the visible frustum at that depth, derived from the camera's projection
  matrix each frame (works for both the desktop camera and the XR array camera), pulled in by
  a `SAFE_FRACTION` so a quad's own size never clips the edge it's anchored to.

**Headset pass (2026-08-04) — two defects, both fixed.** Reported: "the enemy counter and
minimap does not display on the VR headset when out in the dungeon. its just not on the
screen."

- **`gl.xr.getCamera()` returns an off-axis camera, and the placement math assumed a
  symmetric one.** In VR, `HudOverlay` reads the head from the XR `ArrayCamera`, whose
  projection matrix is the *union* of the left/right eye frustums (three's
  `setProjectionFromUnion`) and carries real skew — `elements[8]`/`[9]` are non-zero. The
  anchor math derived a half-width/height from `elements[0]`/`[5]` alone, which is exactly
  right for the desktop camera's symmetric matrix and silently wrong for the headset's: every
  anchor landed a few degrees off from where it should, and an edge anchor (top, bottom-left)
  landed outside the real per-eye frustums entirely — rendered, but on nothing either eye
  could see. Desktop testing could not have caught this; the desktop camera has no skew to
  get wrong. Fixed by folding the skew term into the anchor offset, which reduces to the old
  formula exactly when skew is zero.
- **Edge anchors don't survive contact with a headset's FOV.** Even correctly placed, "top
  centre" and "bottom-left" sat past what the Quest 3's field of view reaches without turning
  the head — you cannot look up at a HUD quad that tracks your look direction. Both HUDs moved
  to just above/below screen centre and became a hold-to-show popup: hidden by default in VR,
  shown while holding A/X or B/Y on either controller (`sideButtonHeld()` in `xrInput.ts`,
  `HudOverlay`'s new `requireSideButton` prop), gone the instant it's released. Desktop is
  unaffected — no controller to hold, so the overlay stays on as it always did, just
  recentred.

### ✅ Sprint 2.6 — Hit feedback & VFX

**Verified on desktop:** typecheck clean · 666/666 unit tests · production build succeeds ·
smoke test fires a held volley and samples the effect state *while it is firing* — particles
in the air, camera trauma rising — then waits out the burn and checks both have gone back to
zero. The wave screenshot shows a body coming apart in ash.

**Not yet verified on the Quest 3.** The headset checklist is README item 18, and almost all
of it is a judgement a monitor cannot make: whether a burst reads in a corridor lit by six
torches without whiting out the thing you are fighting, whether the dissolve reads as a body
burning away rather than blinking out — and, the one that beats everything else, whether
anything at all moves the view.

Delivered — the rules, all pure and unit-tested, none of them importing three.js:

- `src/systems/fx/particles.ts` — the pool every spark, ember and ash fleck comes out of, and
  the burst maths that throws them. Randomness is injected, so a test can assert the *shape*
  of a burst rather than that something roughly happened. 12 tests.
- `src/systems/fx/hitstop.ts` — the multiplier on how much time the simulation is handed when
  a blow lands, and the rule that there is no such multiplier in VR. 7 tests.
- `src/systems/fx/shake.ts` — trauma in, camera angles out, and zeros whenever `inVR`. 9 tests.
- `src/systems/fx/dissolve.ts` — how dissolved a body is, from the phase it is in. 6 tests.
- `src/systems/fx/signals.ts` — the ring buffer for the things worth drawing that are *not*
  damage: a wand firing, and a bolt meeting stone. 4 tests.

And the wiring:

- `src/systems/FxDriver.tsx` — at `SystemOrder.Effects`: reads the damage buffer and the
  signal buffer, turns both into bursts, trauma and hitstop, sheds a trail ember behind every
  bolt in the air, then steps the pool and the shake.
- `src/entities/Particles.tsx` — the whole pool as one additive instanced draw.
- `src/entities/Enemies.tsx` — the dissolve shader, injected into three's standard material
  with `onBeforeCompile` so a dissolving body is still lit by the torches around it.
- `src/core/simulation.tsx` — hitstop, applied where the frame delta is handed to the loop.
- `src/entities/PlayerRig.tsx` — screenshake, applied in the one function that places the
  desktop camera.
- `src/systems/CombatDriver.tsx` — publishes the muzzle flash and the wall impact. It does not
  know what either looks like.
- `src/core/debug.ts` — `__DCVR__.fx`: live particles, trauma and hitstop.

Decisions made during the sprint:

- **No screenshake and no hitstop in VR, and both rules live in the pure function.**
  `sampleShake` returns zeros when `inVR` and `timeScale` returns 1, each with a test that
  says so, rather than the callers remembering. Screenshake in a headset is one of the fastest
  ways to make somebody ill; hitstop is subtler and just as wrong — the camera is the player's
  head and it does *not* slow down with the world, so a stop arrives as the world lurching
  under a head that kept moving, at the exact moment the player is swinging hardest. VR gets
  the same information through haptics, the flash and the burst, none of which touch the
  relationship between the head and the world. This is the sprint most likely to have that
  rule broken by a later change, which is why it is enforced two layers down from the caller.
- **Effects read what happened; nothing tells them.** `FxDriver` consumes the damage buffer
  and the signal buffer, so the combat driver still contains no opinion about what a hit looks
  like. The one thing it does publish is the muzzle flash, because a shot that hits nothing
  produces no damage event and there is otherwise no evidence the weapon fired.
- **Hitstop scales the delta rather than skipping steps.** Skipping banks time in the
  accumulator and the loop then sprints to catch up, which is a lurch immediately after the
  stop — the opposite of the intended effect. Scaling means the time was never accumulated,
  so the world simply resumes.
- **The stop is aged by real time, not scaled time.** Ageing it by the scaled delta would make
  a 90ms stop last 90ms ÷ 0.15 — six times longer than it asked for, which is long enough to
  read as the game hanging.
- **Requests take the longest rather than the sum.** Three things dying on the same step is
  one stop; summing them is a quarter of a second of slow motion every time a pack breaks.
- **Trauma, squared, rather than a timer per source.** Sources add, trauma decays on its own,
  and the offset is trauma². Half the trauma is a quarter of the shake, so a glancing hit is
  almost imperceptible and a kill lands — from one number, with no per-source tuning.
- **The shake is angular, not positional.** A camera shoved 5cm sideways in a two-metre
  corridor puts its near plane through the wall; a camera rotated three degrees reads as the
  same jolt and cannot end up inside anything.
- **The shake is deterministic.** Summed sines rather than `Math.random`: a random offset per
  frame is white noise, which reads as a buzz rather than a shock — and a shake that depends
  on the RNG is a shake no test can pin.
- **Bodies dissolve; they do not fade.** Fading opacity makes a body transparent, which means
  it sorts against every other transparent surface, stops writing depth, and in a torch-lit
  corridor reads as a ghost rather than as a thing arriving. A dissolve stays fully opaque —
  fragments are there or discarded — and the burning edge gives it a direction, which is what
  makes materialising and dying read as opposites rather than as one fade played backwards.
- **The dissolve is injected into the standard material, not a `ShaderMaterial`.** The model
  still wants to be lit by the torches around it, and the alternative is reimplementing three's
  lighting. `customProgramCacheKey` is not optional here: without it three shares a compiled
  program between the injected and plain variants, and the effect then applies to neither or
  both depending on which compiled first.
- **The noise is sampled in object space.** In world space the pattern stays put while the
  body walks through it, so a corpse appears to dissolve *sideways* as it falls.
- **A fresh corpse holds together for the first third of its time.** The fall is half of what
  tells the player the thing is dead; a body that starts coming apart on the frame it dies
  never reads as a corpse at all.
- **The eyes and the halo still fade.** They are light rather than body, and light does not
  crumble — which also means the last thing visible on a dying enemy is a pair of eyes going
  out, which is the read this game wants.
- **Sparks shrink rather than fade.** Additive geometry fading out passes through every
  intermediate brightness, which in the dark reads as the spark smearing. One that shrinks
  reads as a spark going out.
- **Three legible tiers of impact.** An ordinary hit is a handful of element-coloured sparks,
  a crit adds a white flare, a kill is a wide burst of ash. The player should know what they
  did from the size of the burst before they have read the number — which matters most in a
  pack, where several things are being hit and only one of them just died.
- **A trail every third step, not every step.** Sixty particles a second per bolt, with five
  in the air, is a third of the pool spent on trails; every third step still leaves a
  continuous streak behind something crossing a room in a fifth of a second.
- **The muzzle flash is a particle, not a light.** Creating and destroying a point light
  recompiles every material it touches — the hitch the torch pool exists to avoid — and a wand
  fires three times a second.

Two things found in the smoke test, both in the test rather than the game:

- **The "particles never retired" failure was the burn doing its job.** Fire leaves a
  three-second burning status that ticks damage through the same path a bolt does, so it keeps
  producing perfectly legitimate impact bursts long after the shooting stops. The idle check
  now waits the burn out.
- **The enemy-approach check had been failing since Sprint 2.4, and not for a reason in this
  sprint.** Its 45-second window was written against 2.3's two-second `HUNT_DELAY`; 2.4
  replaced that with a 30-second safety valve, and a headless player standing still falls
  straight through to it. Thirty *simulated* seconds is well over a minute of wall clock under
  SwiftShader, because `MAX_FRAME_DELTA` clamps each of those long frames to 0.25s of
  simulation. The window is now 150s, with the arithmetic written down next to it.

Known scaffolding, and the gaps:

- **Still no CC0 art kit**, so the dissolve burns away a capsule. The shader is on the
  material rather than the mesh, so a real model inherits it unchanged.
- **No impact decals and no lingering smoke.** Both want a lifetime longer than a second and
  a different pool policy; neither is what makes a hit read.
- **Audio is Sprint 3.2**, and it costs more here than anywhere: half of what makes an impact
  feel heavy is the sound of it. Every effect in this sprint is currently silent.
- The particle pool does not know about the light budget. **Sprint 3.1** owns that, and a
  burst of additive geometry is the cheapest thing in this game to draw — but it is also the
  thing most likely to be on screen when everything else is.
- The enemy counter still ticks without animation, noted as a 2.6 polish item in 2.5's log.
  Left alone deliberately: the HUD is not where this sprint's feedback belongs, and a counter
  that animates competes with the burst that caused it.

### 🟡 Sprint 2.7 — Enemy models & textures

**Verified on desktop:** typecheck clean · 716/716 unit tests · production build succeeds ·
smoke test plays the whole loop and now also reports what became of every model file, asserting
that each one *settled* — loaded or gave up — rather than leaving a fetch hanging.

**The art is not here, and that is the state the sprint was designed to ship in.**
`public/models/` contains a README and nothing else. Carl downloads the Quaternius CC0 pack into
it — three files, named in that README — and every enemy becomes a creature with no other change
anywhere. Until then they are the capsules they have been since 2.3. A missing GLB is a resolved
answer, not an error: no exception, no retry loop, no red console, and a wave that plays exactly
as it did yesterday.

**Not yet verified on the Quest 3**, and it cannot be until the pack lands. The checklist is
README item 19, and its acceptance test is one question a monitor cannot answer: from across a
dark room, can you still tell a Skulker from a Warrior from a Wraith, and a wind-up from a walk,
in time to step out of it.

Delivered — the rules, pure and unit-tested, none of them importing three.js:

- `src/systems/enemies/appearance.ts` — how an enemy *reads*, resolved from what it is doing:
  dissolve, presence, the lean, the sink, the tint, the eyes, the halo. 17 tests.
- `src/systems/enemies/animation.ts` — AI phase to clip name with a fallback chain and tolerant
  matching, loop versus clamp, and the timescale that fits a clip to a phase's window. 26 tests.

And the wiring:

- `src/systems/enemies/models.ts` — one fetch per file at startup, parsed once, cloned per pool
  slot. 7 tests, all of them about the file *not* being there, because that is the state this
  repository is actually in.
- `src/entities/EnemyShape.tsx` — the seam. Primitives and model clones behind one component,
  one `AnimationMixer` per slot, the dissolve injected into every imported material.
- `src/entities/enemyMaterials.ts` — the dissolve injection, lifted out of `Enemies.tsx` so the
  primitive path and the model path cannot use two different copies of it.
- `src/data/enemies.ts` — an `EnemyModelSpec` per enemy: file, measured height, clip candidates.
- `src/core/debug.ts` — `__DCVR__.models`, and `scripts/makeModelFixture.mjs`.

Decisions made during the sprint:

- **`EnemyShape` did not exist.** Sprint 2.3 wrote down that swapping in a kit would be "a change
  to `EnemyShape` alone" and then inlined the primitives in `Enemies.tsx`; this sprint was the
  test of that claim and the claim was aspirational. It is real now: `Enemies.tsx` owns *where an
  enemy is standing* and nothing else. Worth recording as a pattern — a seam that is only named
  in a comment is not a seam, and the sprint that relies on it pays for building it.
- **How an enemy reads is decided once, in a pure function, and both bodies consume it.** PLAN.md
  named the material contract as the most likely thing here to break silently, and it was right
  about the shape of the risk while understating it: the failure is not just a flash that misses
  an imported material, it is *two* renderers drifting apart over a year. `resolveAppearance`
  means there is one answer to "how bright is a telegraph", and a path that stopped calling it is
  a path that is visibly wrong rather than subtly wrong.
- **The lean, the bob and the halo are applied above the swap.** So they are on for the model
  too, always, and a kit with no stagger clip still visibly flinches. This is what makes "the
  readability rules survive the swap or the swap is a regression" enforceable rather than a hope:
  the procedural channel is not a fallback that gets switched off when a model arrives, it is the
  floor underneath whatever the model does.
- **A window is fitted to the clip, not hoped for.** A wind-up is stretched or compressed to the
  definition's `telegraph` exactly, so the model is furthest back at the instant the AI commits.
  A kit whose attack animation happens to run 1.2s would otherwise still be rearing back after
  the blow had landed — which is not a cosmetic mismatch, it is the game lying about the one
  number the player's survival depends on.
- **Clip names are matched tolerantly, in tiers.** `Attack`, `attack` and
  `CharacterArmature|Sword_Attack` are one clip as far as this game is concerned. Nobody here
  chose the names inside a CC0 kit and a re-export can change them, so the table lists
  *candidates*. Exact matches across every candidate are tried before any fuzzy one, or a loose
  substring hit on a first preference beats an exact hit on a second.
- **The model keeps its own albedo; the state speaks through emissive.** Painting the
  definition's flat colour over the kit's textures would make three creatures out of one. The
  flash, the burn tint and the chill tint already used emissive on the capsule, so they transfer
  unchanged — and the wind-up gets an emissive boost because a model has no eyes this game can
  address, which is a channel the capsule had and would otherwise have been lost.
- **Every type is cloned into every slot at load time.** Ten slots × three types, all hidden but
  one. The alternative — clone when a type first occupies a slot — is a `SkeletonUtils.clone`
  plus a material compile at the moment a skeleton comes round a corner, which is the exact hitch
  the pool discipline exists to prevent. Geometry and textures are shared between clones, so a
  spare clone costs a skeleton and an invisible object.
- **`SkeletonUtils.clone`, not `Object3D.clone`.** The plain clone leaves a skinned mesh's bones
  pointing at the original's skeleton, so ten enemies share one pose and move as a single animal.
- **Materials are cloned per slot.** They are shared by the clone, and every write here is
  per-enemy: one skeleton taking a hit would otherwise flash the whole wave white.
- **The AI never waits on an animation.** Playback is visual and runs on the render frame. The
  moment a decision depends on a clip event, the game's timing becomes a property of an art asset
  somebody else exported.
- **A missing file is `console.info`, not a warning.** Before the pack lands this is the expected
  state of the world, and a console full of red every session trains everyone to ignore it.

Found while verifying, and worth recording:

- **A wrong filename arrives as a successful fetch.** The dev server — and most static hosts —
  answer an unknown path with the SPA's `index.html` and a **200**, so `response.ok` was true and
  the failure surfaced from deep inside the glTF parser as `Unexpected token '<'`. Checking the
  GLB magic number turns that into a sentence naming the actual mistake. This will be the most
  common thing to go wrong when the pack lands, and it is the one that looked least like itself.
- **The model path had nothing to exercise it**, which is a poor way to hand two hundred lines to
  a headset. `scripts/makeModelFixture.mjs` writes a two-bone skinned box carrying the four clips
  a Quaternius character ships with, and running the smoke test against three copies of it proved
  the whole chain — fetch, clone, skeleton, mixer, clip plan, material injection — with the wave
  screenshot showing a body leaning into its hit flash where a capsule used to be. The fixture is
  not art and is not a fallback; `public/models/*.glb` is gitignored, so using it leaves nothing
  behind.

Known scaffolding, and the gaps:

- **No texture compression pass.** PLAN.md asks for KTX2/Basis if the raw PNGs blow the budget,
  and "the budget" is a measurement that has to happen on a Quest 3 with a full wave standing.
  Nothing to compress until there is something to measure, so this is explicitly the first thing
  to do after the headset pass if the frame time moved.
- **`three-mesh-bvh` is still unused**, and the answer is still no. A swept segment against one
  sphere is cheaper than a BVH query, and a generous hit volume is a better game than an exact
  one. Revisit only if a silhouette makes the sphere read as wrong.
- **Skinned meshes keep frustum culling on**, with three's bounding sphere computed from the bind
  pose. A wildly-reaching animation could in principle be culled early at a screen edge. Cheaper
  to look for it in the headset than to pay for `frustumCulled = false` on every enemy up front.
- **The foyer, the dungeon and the weapons are still primitives.** Enemies came first because
  they are the thing the player looks at hardest and the only thing that moves. Everything built
  here — the loader, the cache, the material injection — is enemy-shaped for now; generalising it
  is a decision for whoever decides the walls need a kit too.

## How to pick this up in a new session

1. Read this file, then [PLAN.md](PLAN.md) for the sprint's scope and its ✅ acceptance test.
2. `npm install && npm run dev`
3. Confirm the current state still passes: `npm run typecheck && npm test && npm run smoke`
   (smoke needs the dev server running).
4. Work the next sprint, then update the status board and add a sprint log entry here.
