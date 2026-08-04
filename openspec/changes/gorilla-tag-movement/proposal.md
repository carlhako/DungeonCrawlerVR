## Why

The current movement system offers thumbstick-driven smooth walking and arc teleportation. A subset of players — including younger ones with no inner-ear sensitivity and a strong preference for physical, arm-driven movement — want Gorilla Tag-style locomotion: arms-swinging walk, wall climbing, and ledge mantle, all driven by hand motion rather than a thumbstick. The mode is opt-in, off by default, and ships as a third option alongside the existing two.

## What Changes

- **New locomotion mode `gorilla`** added to `LocomotionMode`, alongside the existing `smooth` and `teleport`.
- **Default stays `smooth`.** Existing players see no change unless they pick the new option.
- **New module `src/systems/gorillaLocomotion.ts`** owns the driver: per-hand grip state, hand-position tracking, an internal state machine (`floor` / `wall` / `air` / `mantle`), and a `desiredMotion()` function consumed by the player rig.
- **Pure math in `src/systems/locomotion.ts`** — `gorillaHandContribution(prev, current, gripping)` and `gorillaBodyFromHands(h1, h2, wallNormal)` — fully unit-tested, no three.js, no Rapier.
- **PlayerRig integration:** when `locomotion === 'gorilla'`, the rig reads desired motion from the gorilla module. In the `wall` state, the rig bypasses Rapier's character controller and solves body position analytically from the two hand positions, so climbing actually works against a wall.
- **Joystick fallback:** while not gripping either controller, the gorilla module routes left-stick input through the existing `moveDirection()` path. Players can rest their arms and cruise with the stick, or backpedal out of trouble without dropping out of gorilla mode.
- **Dungeon wall colliders tagged grippable** (default true). The procedural kit needs one flag; existing colliders pick it up.
- **Settings panel gets a third button** alongside `Smooth` and `Teleport` on the in-world settings board. Storage migration is a one-line addition because new enum values don't invalidate existing blobs.

## Capabilities

### New Capabilities

- `locomotion-gorilla`: The `gorilla` locomotion mode — hand-driven arms-swinging walk, wall climbing, ledge mantle, and joystick fallback. State machine, grip detection, surface tagging, and rig integration.

### Modified Capabilities

None. The existing `smooth` and `teleport` modes are unchanged. No requirements in any existing capability are being altered.

## Impact

**New files:**
- `src/systems/gorillaLocomotion.ts` — driver module
- `src/systems/locomotion.gorilla.test.ts` — pure-function tests for the new math
- `openspec/changes/gorilla-tag-movement/specs/locomotion-gorilla/spec.md`

**Modified files:**
- `src/systems/locomotion.ts` — add the pure gorilla math functions
- `src/systems/settings.ts` — extend `LocomotionMode` union and `SETTING_OPTIONS.locomotion`
- `src/systems/settingsPanel.ts` — third button on the board
- `src/entities/PlayerRig.tsx` — driver branch for gorilla mode; bypass character controller in `wall` state
- `src/systems/dungeon/` collider construction — tag walls grippable
- `src/systems/XRInputSampler.tsx` — publish hand pose positions for both controllers
- `src/systems/xrInput.ts` snapshot — add previous-frame hand position per hand (or read on demand in the gorilla module)

**Out of scope:**
- Visual hand-glow when near a grippable surface (deferred to a polish sprint)
- Hand-tracking (controller-free) support
- Climbing + combat reconciliation rules (e.g., enemy knockback off walls)
- Dedicated high-ceiling / vertical dungeon areas (separate level-design work)
- Desktop parity (gorilla is VR-only by design)
