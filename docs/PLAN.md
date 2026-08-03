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
- Pooled projectiles, hitscan raycasts (via `three-mesh-bvh`), a unified damage pipeline (damage, element, status, crit, source).
- Velocity-based melee: controller speed → damage, with a swing cooldown so waggling isn't optimal; desktop equivalent swing animation with an active hitbox window.
- Mana + cooldown resource system. Implement **Emberwand** and **Frostbrand Sword** end-to-end.
- ✅ **Test:** shoot and swing at training dummies in the foyer; damage numbers, mana drain, and cooldowns behave in both modes.

**Sprint 2.3 — Enemies, AI & the wave loop**
- `Enemy` base: HP, stagger, hit reactions, death, loot drop; GLTF models with Mixamo idle/walk/attack/death clips and blended transitions.
- AI: proximity aggro, nav-grid pathfinding, steering/separation, attack telegraph → strike → recover.
- **Wave Director**: budget-based composition table, staggered spawning, wave-clear detection, gold payout.
- Implement **Goblin Skulker**, **Skeleton Warrior**, **Wraith**.
- ✅ **Test:** the complete loop — foyer → door → dungeon → clear waves 1–3 → earn gold → return to foyer → spend it. Death returns you to the foyer with everything intact.

**Sprint 2.4 — Hit feedback & VFX**
- Impact sparks, ash/blood bursts, hit flash, brief hitstop, muzzle flash, projectile trails, dissolve-on-death shader.
- Screenshake on desktop only (**never** in VR — it causes nausea); VR feedback is haptics + audio + visual flash instead.
- Floating damage numbers billboarded in world space.
- ✅ **Test:** side-by-side playtest — combat reads as punchy in both modes, and nothing in VR moves the camera without the player's head.

---

### Epic 3 — Fear & Atmosphere
*Goal: make it genuinely frightening in VR while holding 72fps.*

**Sprint 3.1 — Darkness & lighting**
- Dark ambient baseline, animated torch flicker, exponential fog, optional player-held light.
- **Light budget manager** (N nearest lights active, the rest emissive-only) — the key perf system.
- Shadow strategy: one shadow-casting light maximum, tight cascades, everything else unshadowed.
- ✅ **Test:** profile a fully populated arena on Quest 3 — sustained 72fps with the frame HUD as evidence.

**Sprint 3.2 — Spatial audio**
- `AudioEngine`: HRTF-panned positional sources, distance/occlusion attenuation, pooled voices, a global mixer with per-bus volume in settings.
- Ambience beds (dripping, distant chains, whispers), torch crackle, footsteps (yours and *theirs* — audible from behind), weapon and impact SFX, enemy vocalisations, low-HP heartbeat, and a **silence-before-spawn** stinger system.
- ✅ **Test:** in VR with headphones, close your eyes and point at an approaching unseen enemy — you should be able to.

**Sprint 3.3 — Horror direction**
- A budgeted scare director (paces scares; prevents both spam and dead air).
- Set pieces: Wraiths phasing through walls, torches snuffing out as something passes, eyes glinting in unlit corridors, whisper events triggered behind the player.
- VR-safe damage/death feedback: red vignette and audio ducking — never a full-screen black snap or forced camera motion.
- ✅ **Test:** a full playtest through wave 8 in VR — scares land, nothing induces nausea.

---

### Epic 4 — Depth & Polish
*Goal: enough content and finish to be a real game.*

**Sprint 4.1 — Full weapon roster** — the remaining 8 weapons, upgrade trees, elemental status effects (burn, chill, shock, curse) and their interactions. Balance pass via the leva tuning panel.

**Sprint 4.2 — Full enemy roster & bosses** — remaining enemies, elite variants with affixes, **The Hollow King** (wave 10) with a multi-phase fight and boss audio, wave table extended to 20 with **The Weeping Widow**.

**Sprint 4.3 — Third-person mode** — orbit camera with collision, player character model driven by the same animation set, aim reconciliation between camera and character, toggle bound to a key. Desktop only; VR always stays first-person.

**Sprint 4.4 — Ship it** — main menu, settings screen (comfort, audio, graphics scale), VR-safe pause, wrist-mounted diegetic HUD (health on the left wrist, mana/charge on the weapon — **no screen-space HUD in VR**), a short tutorial, asset compression, production build and HTTPS deploy, full Quest 3 QA pass.

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

- Music: whether to license a CC0 dark-ambient bed or generate tension layers procedurally — decide at Sprint 3.2.
- Hand-tracking (controller-free) support is **out of scope**; controllers only. Revisit post-Epic 4.
