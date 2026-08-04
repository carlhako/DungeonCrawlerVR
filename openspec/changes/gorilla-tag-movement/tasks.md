## 1. Settings schema

- [x] 1.1 Add `'gorilla'` to the `LocomotionMode` union in `src/systems/settings.ts`
- [x] 1.2 Add `'gorilla'` to `SETTING_OPTIONS.locomotion` in display order (after `'teleport'`)
- [x] 1.3 Confirm `DEFAULT_SETTINGS.locomotion` stays `'smooth'` and `SETTINGS_VERSION` does not need to bump
- [x] 1.4 Run `npm run typecheck` and confirm `sanitiseSettings` / `pickOption` accept the new enum value without changes

## 2. Pure gorilla math

- [x] 2.1 Implement `gorillaHandContribution(prev: Vec3, current: Vec3, gripping: boolean, transferFactor?: number): Vec3` in `src/systems/locomotion.ts` — returns `-(current - prev) * transferFactor` when gripping, zero otherwise
- [x] 2.2 Implement `gorillaBodyFromHands(h1: Vec3, h2: Vec3, wallNormal: Vec3, bodyOffset: number): Vec3` in `src/systems/locomotion.ts` — returns the midpoint of `h1` and `h2` plus `wallNormal * bodyOffset`
- [x] 2.3 Create `src/systems/locomotion.gorilla.test.ts` with tests covering: zero contribution when not gripping, inverse-direction contribution when gripping, both-hand sum equals single-hand double, single-hand contribution, midpoint behaviour, body-offset projection, default transfer factor of 1.0
- [x] 2.4 Run `npm test` and confirm all new and existing tests pass

## 3. Grippable surface tagging

- [x] 3.1 Locate the Rapier collider construction helpers in `src/systems/dungeon/` that build wall colliders
- [x] 3.2 Add a `grippable: true` field to the collider user data on every dungeon wall by default
- [x] 3.3 Confirm collider user data is accessible at query time (the gorilla module will read it from the raycast hit)

## 4. Hand pose publishing

- [x] 4.1 Confirm `src/systems/xrAim.ts` exposes a `getWorldPosition()`-able Object3D per hand with the controller's grip pose (the same pose used for the pointer beam)
- [x] 4.2 Confirm the gorilla module can read both hands' positions and grip state from `xrAim` and `xrInput` inside the fixed loop
- [x] 4.3 Confirm the desktop path (no XR session) provides neutral values so the gorilla module's raycasts do not run and the rig falls back to smooth

## 5. Gorilla driver module

- [x] 5.1 Create `src/systems/gorillaLocomotion.ts` with a module singleton mirroring the structure of `src/entities/Teleport.tsx` (`runtime` object, `consume*` accessor, `useFixedUpdate` registration)
- [x] 5.2 Add per-hand state in the singleton: `previousHandPosition: Vec3`, `isGripping: boolean`, `gripNormal: Vec3`, `gripContactPoint: Vec3`
- [x] 5.3 Implement the state machine: `floor`, `wall`, `air` with explicit transitions (mantle deferred to v2)
- [x] 5.4 Implement per-hand grip detection: one short raycast (initial range 5 cm) from the controller's grip pose along its forward direction; hit a collider whose user data has `grippable: true` → grip established
- [x] 5.5 Implement `gorillaDesiredMotion(): { motion: Vec3, bodyPositionOverride: Vec3 | null }`: in `floor + grip` returns hand math; in `floor + no grip + grounded` returns `moveDirection(stick, facing) * speed * dt`; in `wall` returns zero motion and a non-null body position from `gorillaBodyFromHands`; in `air` returns zero horizontal motion
- [x] 5.6 Register the module in the fixed loop at `SystemOrder.Player - 1` (same slot as `Teleport`) so its output is available the same step the rig reads it
- [x] 5.7 Expose tuning constants (`GRIP_RANGE`, `BODY_OFFSET`, `TRANSFER_FACTOR`) as named exports so the F2 dev panel can expose them later

## 6. PlayerRig integration

- [x] 6.1 In `src/entities/PlayerRig.tsx`, branch on `config.locomotion`: when `'gorilla'`, read desired motion from `gorillaDesiredMotion()` instead of `moveDirection` + `integrateVertical`
- [x] 6.2 Implement the wall-state bypass: when the gorilla module returns a non-null `bodyPositionOverride`, write `setNextKinematicTranslation` directly and skip `character.computeColliderMovement` for this step
- [x] 6.3 Confirm room-scale recentring, teleport recall, smooth/snap turn, and the head-block fade still work; jump (`A` button) is reserved for use-or-fire in gorilla mode
- [x] 6.4 Confirm the desktop path is unchanged: gorilla mode is inert outside an XR session, so desktop falls back to the existing smooth-stick behaviour (satisfies the "VR only" requirement)
- [x] 6.5 Confirm `playerState.speed` is set from actual displacement in gorilla mode (so the comfort vignette tracks real motion, not requested motion)

## 7. Settings panel UI

- [x] 7.1 In `src/systems/settingsPanel.ts`, extend the locomotion row to render three buttons (`smooth`, `teleport`, `gorilla`) by iterating over `SETTING_OPTIONS.locomotion`
- [x] 7.2 Adjust `OPTION_CX` (and `OPTION_W` if needed) so three buttons fit the existing row width without overlap, or widen the row if the panel layout permits
- [x] 7.3 Add a `prompt` string for `'gorilla'` in `src/systems/settingsPanel.ts` matching the tone of the existing prompts (e.g. "Swing arms to walk; grip walls to climb")
- [x] 7.4 Confirm the panel renders correctly on desktop (three buttons visible, `gorilla` button is highlighted when active) and in VR

## 8. Smoke test and in-headset verification

- [x] 8.1 Extend `scripts/smoke.mjs` to exercise the Gorilla button on the settings board and confirm the setting round-trips
- [x] 8.2 Verify smoke test syntax (`node --check scripts/smoke.mjs`) — full run requires a dev server
- [ ] 8.3 Build and deploy to Quest 3, enter VR, switch locomotion to `'gorilla'` from the in-world settings board
- [ ] 8.4 In the foyer: arms-swinging walk (grip both hands, pump back and forth) and confirm forward motion
- [ ] 8.5 Joystick fallback: release both grips, push the left stick forward, confirm stick walk still works
- [ ] 8.6 Wall climb: walk to a wall, grip it with both hands, raise the hands, confirm the body rises along the wall; release both grips, confirm a fall
- [ ] 8.7 Combat while climbing: equip the Frostbrand, climb a wall, pull the trigger on the sword hand, confirm the swing registers
- [ ] 8.8 Grip-vs-use: stand near the door handle, hold the grip button, confirm the door does NOT open; pull the trigger, confirm it does
- [ ] 8.9 Frame rate: watch the in-headset frame readout during arms-swinging walk and wall climbing; confirm the Quest 3 holds 72fps
