# DungeonCrawlerVR — Build Plan

## Context

Greenfield build (`/home/carl/projects/DungeonCrawlerVR` is empty, not yet a git repo). We are building a browser-based 3D dungeon crawler with RPG and roguelite elements, playable fullscreen on desktop and in VR on the Meta Quest 3 browser via WebXR.

**Game Mode 1 — Wave Defence** is the entire scope of this plan:
- Player starts in a lit **foyer** with **100 gold** and a shop dialog for buying/upgrading weapons.
- Walking to the **door** and pressing `Space` (desktop) or grabbing the **handle** (VR) starts a wave.
- Waves take place in a **dark, procedurally generated dungeon** lit only by fire torches.
- Enemies spawn at random valid points and aggro on proximity. Killing them earns gold.
- Surviving the wave returns you to the foyer to spend it. Progression is persistent (pure RPG — gold and weapons are never lost).

The target feel: fluid, punchy spellcasting and melee with strong hit feedback, and genuine horror in VR — darkness, spatial sound, things you hear before you see.

### Confirmed decisions

| Area | Decision |
|---|---|
| Stack | React Three Fiber + drei + `@react-three/xr`, TypeScript, Vite |
| Art | Free CC0 packs from day one (Quaternius / Kenney / Mixamo) |
| Physics | Rapier (WASM) via `@react-three/rapier` |
| Progression | Everything persists — gold and weapon upgrades are never lost |
| VR locomotion | Smooth (default) + teleport, player-selectable, snap-turn + comfort vignette |
| VR combat | Trigger-fire for spells/ranged; physical velocity-based melee swings |
| Level gen | Procedural from day one, seeded |
| Camera | First-person default (shares the VR code path), third-person toggle added later |

Additional defaults being assumed (flag now if wrong): single-player only, no backend — saves go to `localStorage`; no account system or leaderboards.

---

## Tech Stack

**Core:** `vite`, `typescript`, `react`, `three`, `@react-three/fiber`, `@react-three/drei`, `@react-three/xr` (v6), `@react-three/rapier`, `zustand` (game state), `three-mesh-bvh` (fast raycasts against level geometry).

**Content:** GLTF/GLB from Quaternius (rigged low-poly monsters, dungeon kit), Kenney (props, UI, audio), Mixamo (animation clips, retargeted). Draco/meshopt compression at build time. All licences recorded in `ASSETS.md` as they're added.

**Audio:** native WebAudio with `PannerNode` HRTF panning (not Howler — we need per-source HRTF and Quest-friendly control). Thin `AudioEngine` wrapper.

**Dev:** `r3f-perf` (frame HUD), `leva` (live tuning of weapon/enemy stats), `vitest` (pure logic: damage, wave tables, RNG, save migration), `@vitejs/plugin-basic-ssl` or `mkcert` — **WebXR requires HTTPS**, so Quest testing needs `vite --host` over a LAN HTTPS cert, or `adb reverse tcp:5173 tcp:5173` over USB. Set this up in Sprint 0.2, not later.

### Performance budget (the hard constraint)

Quest 3 must hold **72fps stereo**. This shapes several designs up front:
- **Light budget manager** — real-time point lights are the #1 cost. Cap to the N (≈4) nearest active torches; distant torches become emissive-only quads + baked ambience. Sprint 3.1 owns this.
- **No heavy postprocessing in VR.** Effects are achieved with emissive materials, additive sprites, and fog, not a bloom pass. Desktop may enable a richer pipeline.
- Instanced rendering + object pooling for enemies, projectiles, and particles. Nothing allocates per-frame in the hot loop.
- `XRSession` fixed foveation enabled; `framebufferScaleFactor` exposed as a setting.

---

## Weapon Design

Ten weapons across three archetypes. All are designed so a **trigger pull** or a **physical swing** is the whole input — no gesture recognition. Each has a distinct VR verb.

### Wands & Staves (ranged, mana-cost)
1. **Emberwand** *(starter, owned at game start)* — rapid arcing fire bolts, small splash. Forgiving, readable, cheap.
2. **Boneshard Staff** — hold trigger to charge, release for a shotgun cone of bone splinters. The charge hum + release is the VR feel.
3. **Stormcaller Rod** — hitscan lightning beam that chains to 3 nearby enemies; overheats if held.
4. **Voidcaller Orb** — physically **thrown** (Rapier rigid body); creates a singularity that drags enemies together, then implodes. Showcase for the physics layer.
5. **Arcane Crossbow** — two-handed grip in VR, slow, piercing, high headshot multiplier. The precision option.

### Melee (velocity-based damage in VR, swing animation on desktop)
6. **Frostbrand Sword** — chills on hit; frozen enemies shatter for bonus damage.
7. **Grave Warden's Maul** — slow, heavy; a hard downward swing triggers a ground-slam shockwave with knockback.
8. **Reaper's Scythe** — wide arc hitting multiple enemies, heals on kill.

### Offhand (equipped in the left hand; changes how you see the dungeon)
9. **Soulcatcher Lantern** — hold it up to drain HP from nearby enemies into yourself and reveal them through walls — but **your light dims while draining**. Direct horror/risk trade.
10. **Hex Grimoire** — lobs a curse orb marking an enemy for +50% damage; marked enemies explode on death.

**Upgrade axes** (per weapon, purchased in the foyer, persistent): Damage, Rate/Cooldown, Projectile Count, Crit, Element Infusion, Mana Efficiency. Data-driven from a single weapon definition table so adding weapon 11 is a data change, not a code change.

---

## Enemy Design

| Enemy | Behaviour | First seen |
|---|---|---|
| **Goblin Skulker** | Fast erratic strafing melee, cackles constantly | Wave 1 |
| **Grave Hound** | Pack AI, flanks, lunges | Wave 2 |
| **Skeleton Warrior** | Shield blocks frontal damage — flank or stagger it; reassembles once after death | Wave 3 |
| **Skeleton Archer** | Kites, arcs arrows, repositions when approached | Wave 4 |
| **Wraith** | Floats, **phases through walls**, physical-immune (magic only), screams then rushes. The primary jump-scare unit | Wave 5 |
| **Crypt Spider** | Drops from the ceiling on proximity, webs slow you | Wave 6 |
| **Bloated Cadaver** | Slow; bursts into a lingering poison cloud on death — punishes point-blank kills | Wave 7 |
| **Cultist Acolyte** | Channels heals/buffs on other enemies; audible chanting makes it a priority target | Wave 8 |
| **The Hollow King** *(boss)* | Summons skeletons, ground-slam shockwaves, phase change at 50% | Wave 10 |
| **The Weeping Widow** *(boss)* | Ceiling-dwelling spider-wraith; **snuffs the torches** as an attack | Wave 20 |

Enemies share one `EnemyDefinition` data shape (HP, speed, damage, resistances, AI profile, audio set, loot). The **Wave Director** composes each wave from a table with a rising budget, so difficulty curves are tunable without touching code.

---

## Epics & Sprints

Every sprint ends with a **testable build**. Sprints from 0.2 onward are verified on both desktop and a real Quest 3.

---

### Epic 0 — Foundation & VR Bootstrap
*Goal: a player-controlled body that moves correctly in a physics world, on desktop and in VR.*

**Sprint 0.1 — Project scaffold**
- Vite + TS + React + R3F; `git init`; ESLint/Prettier; folder structure (`src/core`, `src/systems`, `src/entities`, `src/scenes`, `src/ui`, `src/data`, `src/assets`).
- Fullscreen canvas, resize handling, fixed-timestep game loop separated from render.
- `r3f-perf` HUD toggle, `leva` dev panel, grey-box test room.
- ✅ **Test:** `npm run dev` shows the grey-box room at 60fps; production build succeeds.

**Sprint 0.2 — WebXR on Quest 3**
- `@react-three/xr` session setup, VR entry button, HTTPS dev server + documented Quest connection steps in `README.md`.
- Controller models, input mapping (triggers, grips, sticks, buttons), haptics helper, fixed foveation, framebuffer scale setting.
- ✅ **Test:** open the LAN HTTPS URL in the Quest 3 browser, enter VR, see the room in stereo with both controllers tracked and a haptic pulse on trigger.

**Sprint 0.3 — Movement & physics**
- Rapier world, capsule character controller, level colliders, step/slope handling.
- Desktop: WASD + pointer-lock mouselook, jump, sprint.
- VR: smooth locomotion (head-relative), snap-turn, comfort vignette, teleport arc with valid-surface check; settings store persisted to `localStorage`.
- ✅ **Test:** traverse the room in desktop FP and in VR under both locomotion schemes without clipping through walls or falling out of the level.

---

### Epic 1 — The Foyer & Meta Loop
*Goal: the persistent hub — buy a weapon, open the door, come back richer.*

**Sprint 1.1 — Foyer scene & interaction**
- Foyer built from the dungeon asset kit; warm torchlight (deliberate contrast with the dark waves).
- Generic `Interactable` system: desktop raycast + on-screen prompt on `Space`; VR ray/near-grab on the handle.
- The door with a grabbable handle.
- ✅ **Test:** walk up to the door in both modes, get a prompt, activate it, see `startWave()` fire in the console.

**Sprint 1.2 — Game state & persistence**
- Zustand store: gold, owned weapons + upgrade levels, equipped loadout, wave number, settings.
- Save/load to `localStorage` with a schema version and migration path.
- Run state machine: `Foyer → Loading → Wave → WaveComplete → Foyer` (plus `Death → Foyer`, keeping everything, per pure-RPG progression).
- Vitest coverage for save/load, migration, and gold arithmetic.
- ✅ **Test:** gold and owned weapons survive a page reload; state machine transitions log correctly.

**Sprint 1.3 — Shop & weapon dialog**
- **Diegetic 3D shop panel** (a world-space surface, not a DOM overlay) so desktop and VR use one identical UI — this is the pattern for all in-game UI.
- Buy/upgrade flow, stat comparison, equip to left/right hand, gold validation, purchase SFX.
- Emberwand owned at start; two more weapons purchasable.
- ✅ **Test:** start with 100 gold, buy and equip a weapon, watch gold decrement, reload the page and it's still owned and equipped.

**Sprint 1.4 — In-world options & new game**
- Added after the first headset passes on 1.3, which made the gap obvious: the comfort
  settings could only be changed from the F2 dev panel — DOM, desktop-only, stripped from
  production builds, and invisible the moment the headset takes over the page. A player who
  needs teleport locomotion needs it *while wearing the headset*, having just been made ill.
- **Settings board** on the foyer wall beside the door: locomotion, turn style, snap size,
  turn speed, walk speed, comfort vignette, foveation, render scale, and Restore defaults.
- **"New game" plaque** on the back wall: wipes gold, weapons, upgrades and wave counters.
  Two presses — arm, then confirm — and it stands down on its own. Settings are untouched.
- One shared registration path for every world-space panel (`src/ui/panelButtons.ts`), so a
  button's pick shape and its drawn shape cannot drift apart. That drift is what made the
  shop unusable in the headset on the first pass.
- ✅ **Test:** in VR, switch to teleport from inside the headset and have it take effect
  immediately and survive a reload; wipe the save from the plaque and confirm it takes two
  presses, and that the comfort settings are *not* wiped with it.

---

### Epic 2 — Wave Combat Core
*Goal: the game is actually playable and fun.*

**Sprint 2.1 — Procedural dungeon generation**
- Seeded RNG; modular room-and-corridor graph generator using the dungeon tile kit.
- Validation pass (fully connected, no unreachable regions, minimum area).
- Collider generation, nav-grid bake for pathfinding, torch placement, spawn-point selection (weighted away from the player's entry).
- Debug top-down map view for inspecting a seed.
- ✅ **Test:** regenerate 20 seeds — every one is connected and traversable end-to-end; the same seed always produces the same map.

**Sprint 2.2 — Weapon & attack framework**
- Hand-anchored weapon rigs (VR: attached to controllers; desktop: viewmodel with fluid idle/fire/reload animation).
- Pooled projectiles, a unified damage pipeline (damage, element, status, crit, source). Projectiles are swept against a damageable registry and Rapier, not hitscan — `three-mesh-bvh` stays unused for now, and the case for it arrives with the enemy meshes in 2.3.
- Velocity-based melee: controller speed → damage, with a swing cooldown so waggling isn't optimal; desktop equivalent swing animation with an active hitbox window.
- Mana + cooldown resource system. Implement **Emberwand** and **Frostbrand Sword** end-to-end.
- ✅ **Test:** shoot and swing at training dummies in the foyer; damage numbers, mana drain, and cooldowns behave in both modes.

**Sprint 2.3 — Enemies, AI & the wave loop**
- `Enemy` base: HP, stagger, hit reactions, death, loot drop. GLTF models with Mixamo clips were the plan and did not land — the CC0 art gap this project has carried since 1.1 is still open, so enemies are primitives whose *states* are readable (lean, bob, eye flare) rather than animated. `three-mesh-bvh` stays unused for the same reason: there are no enemy meshes to build one over yet.
- AI: proximity aggro, nav-grid pathfinding, steering/separation, attack telegraph → strike → recover.
- **Wave Director**: budget-based composition table, staggered spawning, wave-clear detection, gold payout.
- Implement **Goblin Skulker**, **Skeleton Warrior**, **Wraith**.
- ✅ **Test:** the complete loop — foyer → door → dungeon → clear waves 1–3 → earn gold → return to foyer → spend it. Death returns you to the foyer with everything intact.

**Sprint 2.4 — Stealth & enemy awareness**
- Replace the flat `HUNT_DELAY` fallback (every idle enemy starts hunting ~2s after spawn
  regardless of sight) with real detection: line-of-sight + `aggroRadius`, scaled by how much
  noise the player is making. Slow movement shrinks the effective aggro radius; normal/fast
  movement doesn't. Being seen is still being seen — an enemy with real LOS at close range
  finds you no matter how quiet you're being.
- A noise pulse on weapon use — firing the Emberwand, swinging the Frostbrand, hit or miss —
  alerts idle enemies within a noise radius with no line-of-sight required, the same way
  `enemy.alerted` already works for a landed hit. Shooting breaks stealth even from behind
  cover.
- A long safety-valve timer (tens of seconds, not 2) replacing `HUNT_DELAY`'s current job:
  the last-resort guarantee that a wave can't stall forever against a player camped somewhere
  an enemy's spawn point can never get line of sight to.
- No change to `chase`: once an enemy has you, it has you for the fight — that half of the
  brief ("once they see you, they advance") is already built. Large rooms need no new code
  either; longer real sightlines from `hasLineOfSight` already make big open rooms harder to
  cross unseen than a corridor.
- ✅ **Test:** walk a wave slowly and quietly past enemies outside their shrunk aggro radius
  without triggering it; fire a shot from behind a wall and watch enemies without line of
  sight still turn hostile; confirm a deliberately-hidden player still gets found eventually
  by the safety-valve timer rather than stalling the wave.

**Sprint 2.5 — HUD overlays: enemy counter & map**
- Enemy counter overlay, top of screen: killed / total for the current wave (e.g. `2 / 6`),
  driven by the same Wave Director state that already tracks spawn and death counts.
- Small explored-area map overlay, bottom-left corner. Static and screen-locked — it does not
  rotate with the player's heading, only the player marker moves within it. Fills in as the
  player explores rather than revealing the whole generated level up front.
- Both are screen-space HUD, not world-space/diegetic, and both must render correctly in VR
  (headset HUD/overlay layer) as well as desktop.
- ✅ **Test:** clear a wave and watch the counter tick as each enemy dies; walk a level and
  confirm the map only fills in the rooms and corridors actually visited, staying fixed in
  orientation and corner throughout.

**Sprint 2.6 — Hit feedback & VFX**
- Impact sparks, ash/blood bursts, hit flash, brief hitstop, muzzle flash, projectile trails, dissolve-on-death shader.
- Screenshake on desktop only (**never** in VR — it causes nausea); VR feedback is haptics + audio + visual flash instead.
- Floating damage numbers billboarded in world space.
- ✅ **Test:** side-by-side playtest — combat reads as punchy in both modes, and nothing in VR moves the camera without the player's head.

**Sprint 2.7 — Enemy models & textures**
- Added after 2.6, because by then everything an enemy *does* was right and it still looked
  like three capsules. This is the sprint that finally closes the CC0 art gap this project has
  carried since 1.1 — for enemies only. The foyer, the dungeon and the weapons stay primitives
  until someone decides otherwise; enemies come first because they are the thing the player
  looks at hardest and the only thing that moves.
- **The kit is Quaternius (CC0).** Rigged, animated GLB monsters, public domain, no account
  and no attribution requirement. Carl downloads the pack and puts it in `public/models/` —
  fetching an asset pack is a deliberate decision and it is his to make, not something to do
  mid-sprint. Everything below is written so the sprint can be built *before* the files land
  and finished the moment they do.
- **One loader, one place.** GLBs are loaded once at startup and cached, never per spawn:
  `Enemies.tsx` mounts one group per pool slot and nothing mounts or unmounts during a wave,
  which is the rule that keeps a skeleton coming round a corner from costing a material
  compile. A model arriving asynchronously must not stall the wave — a slot draws its current
  primitive until its model is ready, and swaps.
- **`EnemyShape` is the seam.** Sprint 2.3 said swapping in a kit is a change to that
  component alone, and this sprint is the test of that claim. If it turns out not to be true,
  the fix belongs there rather than in a second rendering path.
- **The readability rules from 2.3 survive the swap, or the swap is a regression.** Every AI
  state has to stay legible across a dark room: the telegraph rearing back, the walking bob
  following actual speed, the eyes carrying the wind-up, the halo that makes something visible
  before the torchlight reaches it. A model with a beautiful idle and an unreadable wind-up is
  worse than the capsule. Where the kit's own clips can carry a state, they should; where they
  cannot, the procedural channel stays.
- **Animation.** One `AnimationMixer` per pool slot, clips mapped to AI phases (idle, chase,
  telegraph, strike, recover, stagger, dying) with the mapping as *data* in `src/data/enemies.ts`
  next to the numbers, not as a switch in a component. Clip playback is visual, driven on the
  render frame — no AI decision may depend on an animation event.
- **The material contract with 2.6.** The dissolve is injected with `onBeforeCompile` and
  samples noise in object space; on a skinned mesh that is the bind pose, which is the right
  answer — the pattern stays welded to the body. Every imported material an enemy uses has to
  go through the same injection, and the hit flash, the burning tint and the chill tint have to
  keep working on whatever the kit ships (they currently write `emissive` on a material we
  built ourselves). This is the most likely thing to break silently.
- **Hit spheres stay the hit test.** Nothing about collision changes: a model is drawing.
  `three-mesh-bvh` finally has meshes to build over, and the honest answer is still probably
  no — a swept segment against one sphere is cheaper than a BVH query, and a *generous* hit
  volume is a better game than an exact one. Revisit only if the silhouette makes the sphere
  read as wrong.
- **Budget before beauty.** Triangle count, draw calls and texture memory measured on the
  Quest 3 with a full wave standing, against the numbers 2.1 established. Textures compressed
  to KTX2/Basis if the raw PNGs blow the budget; a wave that drops below 72fps because the
  skeletons look nice is a wave that ships as capsules.
- ✅ **Test:** clear a wave in the headset. Every enemy reads as a *creature* rather than a
  capsule, and from across a dark room you can still tell — without being told which is which
  — a Skulker from a Warrior from a Wraith, and a wind-up from a walk, in time to step out of
  it. Frame time with a full wave on screen is no worse than it was with primitives.

---

### Epic 3 — Look, Sound & Feel
*Goal: make the dungeon read, sound, and hit right — the look, the sound, and the feel of the game. The torch-lit dungeon stays a torch-lit dungeon; the foyer is the safe room; the combat is the point.*

**Pre-Sprint 3.0 — In-headset frame readout**
*Prerequisite for 3.1: the plan already calls out 3.1's own acceptance test as unrunnable without it.*

- A pure `frameStats` system: ring buffer of render-frame deltas, current fps (1/last), 1s avg, 1s min, 1% low, and a 5s slice ready for a sparkline. Unit-tested. Tracking fed from a `useFrame` peer — the fixed loop's `MAX_FRAME_DELTA` clamp would hide exactly the dips this is for.
- A head-locked HUD overlay at the top of view showing just the current fps as an integer (*e.g.* "73 fps"). On or off via a `showFpsReadout` setting in the store.
- A popup chart on hold-side-button (the 2.5 pattern): a 5s sparkline of frame times with a target line at 13.9ms (72fps), and the 1s avg / 1s min / 1% low as supporting numbers. Redraws per frame inside the existing `HudOverlay` — the chart is real-time, not a snapshot.
- `showFpsReadout` defaults to `import.meta.env.DEV` (on in dev, off in production). Tracking is always on in dev so the chart has data when you summon it; the setting only gates the display.
- Exposed via the F2 dev panel as a placeholder, alongside the existing XR / Movement / Physics / Lighting sections. The F2 panel is the only path — the toggle is dev-only, with no production lift.
- Dev-only. The plan's "must be dev-only" rule, applied uniformly.
- **Out of scope:** settings board integration (the current 1.4 board is fine), replacing F1 r3f-perf entirely, a wrist variant, persisting the toggle across reloads, an "ms vs fps" toggle, fancy chart annotations.
- ✅ **Test:** in the headset, the HUD shows the integer fps at the top of view; holding a face button on either controller brings up the chart; in a populated arena on the Quest 3 the readout holds near 72 over a wave. Unit tests cover the ring buffer and the stats invariants; headless frames are 0.6s and prove the *invariants*, not the experience.

**Sprint 3.1 — Lighting**
- **Light budget manager** (N nearest lights active, the rest emissive-only) — the key perf system. Sprint 2.1 laid the groundwork in `src/systems/lightPool.ts`: nearest-N with hysteresis, and a rate-limited hand-over so a light only ever moves while it is dark. This sprint sets N by profiling and takes over the emissive fallback.
- Shadow strategy: one shadow-casting light maximum, tight cascades, everything else unshadowed.
- The torches on the walls are the player's light. (No dark ambient, no fog, no player-held light — the dungeon is what it is.)
- ✅ **Test:** profile a fully populated arena on Quest 3 — sustained 72fps, read from inside the headset (the readout itself lands in Pre-Sprint 3.0).

**Sprint 3.2 — Audio**
- `AudioEngine`: HRTF-panned positional sources, distance/occlusion attenuation, pooled voices, a global mixer with per-bus volume in settings.
- Torch crackle, footsteps (yours and *theirs* — audible from behind), weapon and impact SFX, enemy vocalisations, low-HP heartbeat (combat feedback).
- Music is split across 3.3 (foyer) and 3.4 (gameplay).
- ✅ **Test:** in VR with headphones, close your eyes and point at an approaching unseen enemy — you should be able to.

**Sprint 3.3 — Foyer enhance**
- New wallpaper: the foyer is the safe room, and the walls should say so on their own.
- **Wave complete signal**: a sound effect + a screen-space HUD overlay ("Wave Complete") that fires the moment the Wave Director clears the wave, so the player knows before they start walking home.
- Background foyer music: a light, non-scary ambience that says "you are not in the dungeon anymore."
- The walk home stays the walk home — the player walks back through the dungeon after the wave ends, both as the existing breath between run and shop, and to leave room for future loot collection.
- ✅ **Test:** in VR, clear a wave and the sound + text fire together before the player turns around; the wallpaper reads as wallpaper at any reasonable distance; the foyer music plays in the foyer and only in the foyer.

**Sprint 3.4 — Dungeon tweaking & gameplay music**
- Dungeon geometry: a taller roof, slightly bigger and more open rooms, pillars in the larger rooms.
- More room templates: the generator currently has one shape; variety is the point.
- Skylights: vertical light shafts from above (visual + ambient).
- Breakable walls: hidden passages, short-cuts, optional loot behind them.
- Floor and roof textures: variation, not the uniform materials the primitives currently ship with.
- Gameplay music: a dungeon bed, distinct from the foyer music, that supports the combat without trying to be horror.
- ✅ **Test:** regenerate twenty seeds — every one is connected, every large room has pillars, every other room has visible variety in floor / roof / template, and the gameplay music plays in the dungeon and only in the dungeon.

---

### Epic 4 — Depth & Polish
*Goal: enough content and finish to be a real game.*

**Sprint 4.1 — Full weapon roster**
- The remaining 8 weapons (Boneshard Staff, Stormcaller Rod, Voidcaller Orb, Arcane Crossbow, Grave Warden's Maul, Reaper's Scythe, Soulcatcher Lantern, Hex Grimoire), upgrade trees, elemental status effects (burn, chill, shock, curse) and their interactions. Balance pass via the leva tuning panel.
- Soulcatcher Lantern stays as designed. Its "drain HP to reveal enemies through walls, light dims while draining" mechanic is a combat-coded risk/reward trade — the dungeon can have dark pockets (the Weeping Widow's torch-snuffing), they're just not the *theme* of the game.
- Weapon-material requirements are the **4.3** deliverable, not this one — this sprint adds the weapons and their mechanics, the gating is in 4.3.
- ✅ **Test:** buy and equip every weapon in the shop; verify each upgrade track levels up; verify the Soulcatcher Lantern's drain mechanic works as designed.

**Sprint 4.2 — Full enemy roster & bosses**
- Remaining enemies: Grave Hound, Skeleton Archer, Crypt Spider, Bloated Cadaver, Cultist Acolyte, plus elite variants with affixes.
- **Four bosses, every 5th wave:**
  - **The Bone Marshal** (wave 5) — Skeleton Warrior scaled up. Shield stance (frontal block) → shield bash (telegraphed, knockback) → 50% HP phase change (drops shield, gains double-overhead swing). Vulnerable from the back/flank. Drops Bone Fragments + Boss Soul. First boss, teaches the player what a boss is.
  - **The Hollow King** (wave 10) — summons skeletons, ground-slam shockwaves, phase change at 50%.
  - **The Wizard** (wave 15) — fireball (projectile), frost nova (AoE slow), summon skeletons. 50% HP phase (more fireballs, more summons). Vulnerable after the frost nova. Drops Wraith Essence + Boss Soul. First ranged boss — distinct from the two melee bosses before it.
  - **The Weeping Widow** (wave 20) — ceiling-dwelling spider-wraith, snuffs torches as an attack.
- **Wave Director refactor.** Every 5th wave gets a `boss: enemyId | null` field on the wave table. When non-null, the boss *is* the wave — no minions. The composition logic splits into "boss wave" and "regular wave" paths.
- ✅ **Test:** regenerate forty seeds (10 waves × 4 bosses), each boss is present on its wave and absent elsewhere; hand-tune a regular wave to verify the non-boss path still composes correctly.
- **Model assignment note.** The model library has no dedicated Spider or Hound model. The Crypt Spider and Grave Hound either use primitives (the 2.3-era approach) or pick the closest fit from the existing models. To be decided when 4.2 starts.

**Sprint 4.3 — Loot (material drops)**
- Enemies drop *materials*, not equipment. No inventory — materials are account-bound, spent at the shop. Reasoning: equipment drops would mean a full inventory system; materials give the walk-home a reason to exist without one.
- **Seven material types**, each dropped by specific enemies and required by specific weapons and upgrades:

  | Material | Dropped by | Used for |
  |---|---|---|
  | Bone Fragments | Skeleton Warrior, Skeleton Archer, Bone Marshal, Hollow King | Boneshard Staff, Soulcatcher Lantern |
  | Hound Pelt | Grave Hound | Frostbrand Sword, Voidcaller Orb |
  | Wraith Essence | Wraith, The Wizard | Stormcaller Rod, Soulcatcher Lantern |
  | Spider Silk | Crypt Spider, Weeping Widow | Reaper's Scythe |
  | Cadaver Ichor | Bloated Cadaver | Grave Warden's Maul, Hex Grimoire |
  | Cultist Cloth | Cultist Acolyte | Arcane Crossbow, Hex Grimoire |
  | Boss Soul | All four bosses | Ultimate-tier upgrades (one per weapon) |

- **Shop board (1.3) gains a second requirement column.** Alongside the gold cost, a list of materials. A purchase is allowed when both gold *and* materials are sufficient. The existing 1.3 tests pin "not enough gold" — equivalent "not enough materials" cases follow the same pattern.
- The walk-home protected since 3.4 is now the collecting beat — the player walks back through the dungeon to scoop up whatever they missed.
- ✅ **Test:** kill a Skeleton Warrior, get Bone Fragments; buy a Boneshard Staff with sufficient gold + materials, succeed; buy with insufficient materials, refusal tells you why on the board.

**Sprint 4.4 — HUD redesign**
- Health on the left wrist (a diegetic panel, parented to the controller).
- Mana on the weapon (a diegetic readout on the weapon model).
- The other screen-space HUDs (enemy counter, explored map, frame readout) stay where they are — the "no screen-space HUD in VR" line was dropped with the pivot.
- ✅ **Test:** in VR, the health readout tracks damage taken and the mana readout tracks mana spent; both visible only on the wrist / weapon, not anywhere on the screen.

**Sprint 4.5 — Ship it**
- The remainder of the old 4.4 after 4.4 was pulled out, settings screen was dropped, and VR-safe pause was dropped: main menu, short tutorial, asset compression, production build with HTTPS deploy, full Quest 3 QA pass.
- Tests stay on device (the standing rule from the Cross-Cutting Practices): the Quest 3 QA pass is the trip — the headset is what the game ships on.

**Dropped from the original 4.x plan:**
- Third-person mode (desktop parity) — dropped.
- Settings screen — the current F2 dev panel + 1.4 settings board is fine.
- VR-safe pause — dropped.
- "No screen-space HUD in VR" — the screen-space HUDs (enemy counter, map, FPS) stay where they are.

---

## Cross-Cutting Practices

- **Data-driven content.** Weapons, enemies, and wave tables live in `src/data/*.ts` as typed definitions. Adding content is editing data.
- **One UI system.** All in-game UI is world-space and diegetic, so desktop and VR never diverge. DOM is reserved for the pre-session main menu only.
- **VR comfort is a hard rule.** Nothing moves the VR camera except the player's head. No forced rotation, no screenshake, no cutscene cameras.
- **Pooling everywhere.** Projectiles, particles, damage numbers, audio voices, and enemies are all pooled. No per-frame allocation in the update loop.
- **Test on the Quest every sprint**, not at the end of an epic. Desktop performance tells you nothing about a stereo mobile GPU.

---

## Verification

**Per-sprint:** each sprint's ✅ line above is its acceptance test, run on desktop *and* in the Quest 3 browser.

**Automated (`npm test`, vitest):** damage/crit/resistance math, wave composition budgets, seeded RNG determinism, dungeon connectivity validation, save serialisation and version migration, gold economy transactions. Rendering and VR are verified by hand — that's the correct trade here.

**End-to-end smoke test** (the manual script to run before every merge to main):
1. Load fullscreen on desktop → foyer, 100 gold.
2. Open the shop, buy a weapon, equip it, reload the page → still owned.
3. Activate the door → dungeon generates and loads.
4. Clear a wave with both a spell and a melee weapon → gold awarded.
5. Return to the foyer, spend the gold.
6. Repeat steps 1–5 in VR on the Quest 3, with the frame HUD visible, confirming ≥72fps throughout.

## Open Items

- Hand-tracking (controller-free) support is **out of scope**; controllers only. Revisit post-Epic 4.
