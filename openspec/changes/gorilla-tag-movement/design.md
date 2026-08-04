## Context

The player rig is a Rapier `KinematicPosition` capsule driven by a `KinematicCharacterController`. The fixed loop feeds it desired motion derived from the left thumbstick (smooth), the teleport arc, or recall; the character controller resolves that motion against walls and floors. The rig never rotates the capsule, only translates it. All locomotion math lives in `src/systems/locomotion.ts`, is pure, and is unit-tested.

Gorilla Tag-style movement inverts the source of motion: instead of "the stick says walk", it is "the hands say move the body". The naïve port replaces the capsule with a dynamic rigid body and uses hand joints to hold it. That is a large rewrite and is out of scope for this change.

What we are doing instead: gorilla mode is a *different driver* of the same body, with one architectural exception — when climbing a wall, the rig bypasses the character controller and solves body position analytically from the two hand positions, because the kinematic capsule cannot move into a wall.

See `proposal.md` for the motivation and `specs/locomotion-gorilla/spec.md` for the requirements this design satisfies.

## Goals / Non-Goals

**Goals:**
- Add a third opt-in locomotion mode without disturbing the existing two.
- Reuse the kinematic capsule, character controller, and smooth-stick path unchanged.
- Make all of the new behaviour unit-testable by keeping the math pure.
- Keep the comfort rule intact — nothing in the rig ever moves the VR camera except the player's head.

**Non-Goals:**
- Replacing the kinematic capsule with a dynamic rigid body.
- Climbing-specific combat rules (knockback, invulnerability frames while climbing).
- Hand-glow visual feedback for grippable surfaces.
- Hand-tracking (controller-free) input.
- Desktop parity for gorilla mode.
- Dedicated high-ceiling dungeon areas (separate level-design work).

## Decisions

### Decision: Kinematic capsule stays the body

The player capsule stays a Rapier `KinematicPosition` body. Gorilla mode does not change the body model.

**Why:** Keeps Rapier step-up, slope handling, room-scale recentring, teleport integration, and recall integration unchanged. The character controller already resolves "I want to move here" against walls and floors; gorilla mode just gives it a different "I want to move here".

**Alternative considered:** Replace the kinematic capsule with a dynamic rigid body and use Rapier joints to anchor the hands. Rejected: it conflicts with the character controller, requires re-deriving comfort, and turns the change from an additive mode into a rewrite.

### Decision: Wall state bypasses the character controller

When the gorilla module's internal state is `wall` (both hands gripping the same grippable surface), the rig does not call `character.computeColliderMovement`. Instead, the rig reads the body position computed by `gorillaBodyFromHands(h1, h2, wallNormal)` directly and writes it to the kinematic body.

**Why:** A kinematic capsule cannot move into a wall. If we fed "move up by N" into the character controller while the player is gripping a wall, the controller would refuse the motion and climbing would not work.

**Alternative considered:** Use a Rapier kinematic-position-based controller with `setNextKinematicTranslation` directly (bypassing `computeColliderMovement`) but still constraining the body to avoid penetrating walls. Rejected: a wall geometry check from outside the controller is more code and more error-prone than reusing the existing analytic solve that Gorilla Locomotion is built around.

### Decision: Body-from-hands formula

```
body_position = midpoint(h1, h2) + wallNormal * BODY_OFFSET
```

Where `BODY_OFFSET` is a small constant (initial value 0.4 m, tuned in playtest).

**Why:** A single-line closed-form is the simplest possible "body held by hands" solver. The midpoint is the natural anchor point, and pushing it slightly away from the wall keeps the capsule from intersecting the wall mesh.

**Alternative considered:** Inverse-kinematics chain from hands through arms to torso. Rejected: visually interesting but adds a lot of code for no benefit when the player can only see their hands in the headset.

### Decision: Per-hand grip state lives in the gorilla module, not xrInput

The gorilla module maintains its own `previousHandPosition` per hand and `isGripping` per hand. The xrInput snapshot continues to expose only buttons, sticks, and connected state.

**Why:** Keeps xrInput focused on input. The previous-position buffer is only meaningful in the context of a fixed-step integration against the current step's pose, which is exactly what the gorilla module is doing.

**Alternative considered:** Add a `previousPosition: Vec3` field to the `HandInput` snapshot. Rejected: leaks gorilla-specific state into the input layer.

### Decision: Grip detection by short raycast from the hand

Each fixed step, for each hand, the gorilla module performs a single short raycast (initial range 5 cm) from the controller's grip pose along the controller's forward direction. If the raycast hits a collider marked grippable, the hand is considered gripping.

**Why:** Five centimetres covers natural arm-extension grip and rejects the "hand near but not on the wall" case. One raycast per hand per step is well within the budget on Quest 3.

**Alternative considered:** Sphere cast with a small radius. Rejected: more expensive, and a raycast is sufficient because the grip is meant to be a discrete event.

### Decision: Joystick fallback reuses the smooth-locomotion path

When the gorilla module's internal state is `floor` and neither hand is gripping, it calls `moveDirection(stick, facing)` directly — the same function used by smooth mode — and applies the result as desired motion.

**Why:** Same speed, same deadzone, same head-relative direction, zero new walking math. Players who rest their arms get exactly the smooth-mode experience without switching settings.

**Alternative considered:** Reimplement stick walking in the gorilla module with a different speed or curve. Rejected: duplication with no benefit and a guaranteed source of subtle behaviour drift.

### Decision: Grippable is a single bool on colliders

Each Rapier collider in the dungeon kit carries a `grippable: boolean` user-data field. Default for dungeon walls is `true`. Future content (lava, magical barriers) sets it to `false`.

**Why:** One boolean is the minimum that lets the gorilla module reject non-climbable surfaces. No new collider type, no new tag system.

**Alternative considered:** Layer-based filter (a "grippable" Rapier collision group). Rejected: more infrastructure for the same behaviour, and Rapier groups are already used for player-vs-enemy filtering in this project.

### Decision: Settings persistence needs no migration

The new enum value `gorilla` is added to `LocomotionMode` and `SETTING_OPTIONS.locomotion`. The settings store does not require a version bump, because existing stored blobs that omit `gorilla` will be sanitised to the default (`smooth`) and that has always been the desired behaviour for stored values outside the new enum.

**Why:** `pickOption()` in `src/systems/settings.ts` already falls back to the default for any stored value not in the option list, and the default is unchanged. Existing players see no change.

**Alternative considered:** Bump `SETTINGS_VERSION` and write a migration. Rejected: there is no setting to migrate *to* — existing players should not have `gorilla` silently activated.

### Decision: Comfort vignette is unchanged in gorilla mode

The vignette closes at the same threshold as in smooth mode. Strength, smoothing, and the "actual speed not requested" rule from `playerState.speed` apply as today.

**Why:** The mode is opt-in with full information. Players who pick it know what they signed up for. Stronger vignette would be paternalistic and would not help anyone who tolerates the movement at all.

**Alternative considered:** Bump the vignette default for gorilla mode. Rejected for v1; can revisit if reports come in.

## Risks / Trade-offs

- **Climb feel is highly dependent on tuning constants.** The body offset (0.4 m), the grip range (5 cm), the wall-normal detection tolerance, and the transition thresholds between states all need playtest tuning. → Mitigation: each constant is named, centralised, and reachable from the F2 dev panel (the same panel already used for `moveSpeed` and other tuning).

- **Performance of two extra raycasts per step on Quest 3.** This adds to the per-step physics budget. → Mitigation: raycasts are short (5 cm), the colliders are static, and Rapier's broadphase will reject most candidates cheaply. The `F1` HUD frame readout will surface any regression immediately.

- **Climbing + combat interaction is unspecified.** A Skeleton Warrior can hit a climbing player; this is not yet a defined behaviour. → Mitigation: this is explicitly out of scope. The first sprint ships the locomotion; a follow-up defines the combat rule.

- **Joystick fallback only works on the floor.** A player in the air cannot use the stick to recover; they fall. → Mitigation: this matches player intuition — you can't walk on the air with a stick — and the spec captures the behaviour explicitly so it can be tested.

- **One-hand grip on a wall is an ambiguous state.** The body hangs from the one hand; it neither walks nor climbs. → Mitigation: the body holds position, which is the safe interpretation. Players will discover the pattern in playtest; we can add special handling if reports come in.

- **Grippable surface tagging can be forgotten.** A new wall added to the dungeon kit must remember to set `grippable: true`. → Mitigation: the default in collider construction helpers is `true`, so the flag only needs to be set explicitly for non-grippable surfaces (the rarer case).

## Migration Plan

No migration is required:

1. Add `'gorilla'` to `LocomotionMode` and `SETTING_OPTIONS.locomotion`.
2. Existing stored settings blobs (in `localStorage` under `dcvr.settings`) are unaffected — they have a stored value of `'smooth'` or `'teleport'`, both of which remain valid enum members.
3. Default settings are unchanged. `SETTINGS_VERSION` does not need a bump.
4. The in-world settings board regenerates with the third button on next render.
5. Players who already had the game running see no behaviour change until they open the settings board and pick the new option.

Rollback: revert the change. No data is left in an unrecoverable state because the new enum value is only ever written by a player who has explicitly chosen it.

## Open Questions

- **Exact transfer factor per hand.** The Gorilla Locomotion algorithm uses 1.0 (the body's motion exactly cancels the hand's motion) as the default, but in practice some games tune this slightly above or below 1.0 to make movement feel more or less "weighty". → Defer to playtest; the constant will live in a single named location reachable from the F2 panel.

- **Wall climb orientation.** Should the body tilt to face the wall when climbing (Gorilla Tag does this), or stay upright? → Defer to playtest. The default is "stay upright" because the kinematic rig does not currently support body rotation; adding it is a larger change if needed.

- **Ledge mantle detection threshold.** When the hands reach a height above the body where there is a horizontal surface, the player should be able to pull themselves onto it. The exact threshold (height above the hand, depth of grabbable ledge) needs tuning. → Defer to playtest; the constant will be exposed in the dev panel.
