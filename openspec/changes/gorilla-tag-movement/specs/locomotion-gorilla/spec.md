## Purpose

Adds an opt-in Gorilla Tag-style locomotion mode that drives the player's body from hand motion: arms-swinging floor walking, wall climbing, ledge mantle, with a left-thumbstick fallback for when the player's arms need a rest. The mode sits alongside the existing smooth and teleport modes and is off by default, so existing players see no change unless they pick it.

## ADDED Requirements

### Requirement: Gorilla mode is selectable and off by default

Players SHALL be able to choose between `smooth`, `teleport`, and `gorilla` as their locomotion mode. The default value SHALL remain `smooth`, so that no existing player is silently switched into gorilla mode on first run or on reload.

#### Scenario: First-run player gets smooth mode
- **WHEN** the game loads with no previously-saved locomotion setting
- **THEN** the active locomotion mode is `smooth`

#### Scenario: Player selects gorilla mode
- **WHEN** the player chooses `gorilla` from the settings board
- **THEN** the locomotion setting is `gorilla` and survives a page reload

#### Scenario: Existing player's setting is preserved
- **WHEN** a player who has previously chosen `smooth` or `teleport` reloads the game
- **THEN** their previously-selected mode is unchanged and gorilla is not silently activated

### Requirement: Gorilla mode is VR-only

The gorilla locomotion mode SHALL be active only while the player is inside an immersive XR session. On desktop, the locomotion mode SHALL behave identically to `smooth` regardless of the stored setting.

#### Scenario: Gorilla setting inert on desktop
- **WHEN** the player is on desktop and the stored locomotion setting is `gorilla`
- **THEN** horizontal movement uses the existing smooth-stick behaviour, and vertical movement uses the existing gravity and jump behaviour

#### Scenario: Gorilla mode becomes active on VR entry
- **WHEN** the player enters an XR session with the stored locomotion setting set to `gorilla`
- **THEN** hand-driven movement is active for that session

### Requirement: Floor walking is driven by hand motion

When the player is on a horizontal surface in gorilla mode and grips one or both controllers, the body's horizontal motion for that step SHALL be the inverse of the per-step displacement of the gripping hands. Pulling a hand toward the body SHALL push the body in the opposite direction.

#### Scenario: Pulling both hands forward walks the body forward
- **WHEN** the player is on the floor, grips both controllers, and pulls both hands toward their chest
- **THEN** the body translates forward at a speed proportional to the combined hand displacement

#### Scenario: A single gripping hand contributes motion
- **WHEN** the player is on the floor and grips only one controller
- **THEN** the body's horizontal motion is driven by that hand's displacement alone

#### Scenario: No grip means no hand-driven motion
- **WHEN** the player is on the floor and is not gripping either controller
- **THEN** no hand-driven motion is applied (the joystick fallback path applies instead)

### Requirement: Wall climbing holds the body against the wall

When both hands are gripping the same grippable vertical surface (a wall), the body SHALL be held in place by the hand positions such that pulling both hands upward moves the body upward along the wall. The body's contact with the wall SHALL be maintained by this grip rather than by pushing the body into the wall.

#### Scenario: Pulling both hands up climbs the wall
- **WHEN** the player has both hands gripped on a wall and raises both hands
- **THEN** the body rises along the wall by an amount equal to the inverse of the hands' vertical displacement

#### Scenario: One-hand grip on a wall holds the body in place
- **WHEN** the player has one hand gripped on a wall and the other hand not gripping
- **THEN** the body is held against the wall by the gripping hand

#### Scenario: Releasing both hands from a wall starts a fall
- **WHEN** the player releases both grips from a wall while elevated above the floor
- **THEN** the body begins falling under gravity

### Requirement: Joystick fallback while not gripping

When the player is in gorilla mode, on the floor, and not gripping either controller, the left thumbstick SHALL drive horizontal movement using the same rule as `smooth` mode. The hand-grip path SHALL take over as soon as a grip is established.

#### Scenario: Stick walk without grip
- **WHEN** the player is in gorilla mode, on the floor, not gripping, and pushes the left thumbstick forward
- **THEN** the body walks forward at the configured move speed in the head-relative direction

#### Scenario: Gripping overrides the stick
- **WHEN** the player is in gorilla mode, on the floor, pushing the left thumbstick, and then grips either controller
- **THEN** hand-driven motion takes over from the same step and the stick input is ignored

### Requirement: Falling and grip-rescue from the air

When the player is not supported by a grippable surface and not standing on the floor, the body SHALL fall under gravity. Gripping a grippable surface mid-fall SHALL arrest the fall and hold the body at the grip point.

#### Scenario: Stepping off a ledge falls
- **WHEN** the player walks off a ledge in gorilla mode without gripping
- **THEN** the body falls under gravity until it lands on a floor or catches a surface

#### Scenario: Catching a wall mid-fall
- **WHEN** the player is falling and grips a grippable wall with at least one hand
- **THEN** the body's downward motion stops and the body is held by the grip

### Requirement: Grippable surfaces are recognised

The dungeon SHALL mark its walls and other climbable structures as grippable, so that a grip established near them is valid. Non-grippable surfaces (such as a future lava hazard or magical barrier) SHALL refuse grip.

#### Scenario: Stone dungeon wall is grippable
- **WHEN** the player is in the dungeon and brings a controller close enough to a stone wall to grip it
- **THEN** the grip is established and the wall can be climbed

#### Scenario: Marked non-grippable surface refuses grip
- **WHEN** a surface is explicitly marked as non-grippable
- **THEN** holding the grip button near it does not establish a grip and the body does not interact with it as if it were a wall

### Requirement: Grip means locomotion, trigger means use-or-fire

In gorilla mode, holding the grip button SHALL mean the player is gripping a surface (or air) for locomotion; it SHALL NOT mean "use the object under the hand". Pressing the trigger button SHALL perform the existing context-sensitive action — using a reachable object if one is present, otherwise firing the weapon in that hand.

#### Scenario: Gripping near a door does not open it
- **WHEN** the player is in gorilla mode and holds the grip button while a reachable door handle is under the same hand
- **THEN** the door does not open; pulling the trigger on that hand opens the door

#### Scenario: Trigger still fires a weapon
- **WHEN** the player is in gorilla mode with a weapon equipped in a hand and pulls that hand's trigger
- **THEN** the weapon fires (or, for a melee weapon, the swing is registered) by the existing weapon pipeline

#### Scenario: Melee swing while climbing is possible
- **WHEN** the player is climbing a wall in gorilla mode and swings the weapon hand
- **THEN** the swing motion is registered by the weapon pipeline and may deal incidental damage

### Requirement: Settings panel exposes the gorilla option

The in-world settings board SHALL present `gorilla` as a third option alongside `smooth` and `teleport`, with the same visual treatment, prompt, and activation behaviour as the other two options.

#### Scenario: Third button visible on the board
- **WHEN** the player opens the settings board
- **THEN** three mutually-exclusive locomotion buttons are visible and clearly labelled

#### Scenario: Selecting gorilla updates and persists the setting
- **WHEN** the player points at the Gorilla button and pulls the trigger
- **THEN** the locomotion setting changes to `gorilla`, the Gorilla button is marked as the active selection, and the new value survives a page reload
