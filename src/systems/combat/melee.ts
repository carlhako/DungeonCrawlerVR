/**
 * Melee: how hard you swung, measured from where the blade's tip actually went.
 *
 * The whole design problem here is that VR melee has exactly one degenerate strategy —
 * waggle. Tiny, fast wrist movements produce enormous instantaneous speeds and cost nothing,
 * so if damage is a plain function of speed then vibrating your hand at an enemy is the
 * optimal play and also the least fun thing anyone has ever done in a headset. Three rules
 * between them make a real swing better than a waggle:
 *
 * 1. **A speed floor.** Below `MELEE_MIN_SPEED` the blade does not cut at all, so resting it
 *    against something is not an attack.
 * 2. **A cooldown**, from the weapon's `rate` (see `resources.ts`). This is the one that
 *    actually kills waggling: extra swings inside the window simply do not land.
 * 3. **Diminishing returns above a real swing's speed**, so the reward for a frantic swing
 *    over a committed one is small.
 *
 * And a fourth rule that is not about waggling at all:
 *
 * 4. **Speed is measured in the player's own frame, not the world's.** Carrying a blade
 *    while walking at 3 m/s is faster than the floor in rule 1, so a world-space measurement
 *    makes *walking into things* an attack — and stick-turning on the spot sweeps the blade
 *    through an arc at several metres a second without the player moving their arm at all.
 *    Subtracting the rig's position and yaw leaves exactly the motion the player put into
 *    the weapon, which is what the whole system is trying to reward. The hit test still
 *    sweeps the world-space segment: where the blade *was* is a question about the room.
 *
 * Pure, and measured in metres per second against numbers you can check by swinging your own
 * arm — a comfortable sword swing moves the tip at roughly 4-6 m/s.
 */

import type { Vec3 } from '@/systems/locomotion'

/** Below this the blade is being carried, not swung. */
export const MELEE_MIN_SPEED = 1.5
/** A committed swing. Full weapon damage. */
export const MELEE_FULL_SPEED = 4.5
/** Past this, no more reward — see rule 3. */
export const MELEE_MAX_SPEED = 8

/** What the slowest cutting swing is worth, as a fraction of the weapon's damage. */
export const MELEE_MIN_POWER = 0.5
/** What the hardest swing is worth. Deliberately modest. */
export const MELEE_MAX_POWER = 1.4

/**
 * How fast the held peak speed decays, per second, as an exponential rate.
 *
 * The reason this exists at all: people decelerate *into* the thing they are hitting. The
 * instantaneous tip speed at the moment of contact is often a fraction of the swing's real
 * speed, so damage read from the contact frame alone would punish a well-aimed swing and
 * reward a wild follow-through. Holding the recent peak for a moment measures the swing
 * rather than the instant. At 12/s the held value has halved after about 60ms, which is
 * roughly the length of a contact.
 */
export const SWING_DECAY = 12

export interface SwingTracker {
  /**
   * Where the tip was on the previous step, **in the player's own frame**, or null before
   * the first sample.
   *
   * Player-relative and not world-relative, which is the whole of rule 4 below.
   */
  last: Vec3 | null
  /** Where the tip was in world space, which is what the hit test sweeps. */
  lastWorld: Vec3 | null
  /** Peak-held speed in m/s. This is what damage is computed from. */
  speed: number
  /** The instantaneous speed of the last step, for anything drawing a trail. */
  instant: number
}

export function createSwingTracker(): SwingTracker {
  return { last: null, lastWorld: null, speed: 0, instant: 0 }
}

/**
 * What one step of swinging produced: how fast, and the segment the tip swept getting there.
 *
 * Both come back from the same call because the tracker's stored position is the segment's
 * start *and* the thing the next call overwrites. Handing them back separately means an
 * ordering rule ("query the segment before you advance the tracker") that is invisible at
 * the call site and produces a zero-length sweep — a sword that only ever hits what its tip
 * is already touching.
 */
export interface SwingStep {
  speed: number
  /** The swept segment, for the hit test. Never a point. */
  from: Vec3
  to: Vec3
}

/**
 * Fold this step's tip position into the tracker, and report the held speed and the sweep.
 *
 * The first sample after the weapon appears establishes a position and nothing else. Without
 * that, equipping a sword — or a controller reconnecting — reads as a swing from the origin
 * to the player's hand, which is several hundred metres per second and an instant kill on
 * whatever happens to be nearby.
 */
export function trackSwing(
  tracker: SwingTracker,
  /** The tip in world space. Only the sweep uses this. */
  world: Vec3,
  /** The tip in the player's own frame. Only the speed uses this — see rule 4. */
  local: Vec3,
  dt: number,
): SwingStep {
  const previous = tracker.last
  const previousWorld = tracker.lastWorld

  if (!previous || !previousWorld) {
    tracker.last = { ...local }
    tracker.lastWorld = { ...world }
    tracker.instant = 0
    tracker.speed = 0
    return { speed: 0, from: { ...world }, to: { ...world } }
  }

  const from = { x: previousWorld.x, y: previousWorld.y, z: previousWorld.z }

  const dx = local.x - previous.x
  const dy = local.y - previous.y
  const dz = local.z - previous.z
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)

  previous.x = local.x
  previous.y = local.y
  previous.z = local.z
  previousWorld.x = world.x
  previousWorld.y = world.y
  previousWorld.z = world.z

  tracker.instant = dt > 0 ? distance / dt : 0
  const decayed = tracker.speed * Math.exp(-SWING_DECAY * dt)
  tracker.speed = Math.max(tracker.instant, decayed)
  return { speed: tracker.speed, from, to: { ...world } }
}

/** Forget where the tip was, without forgetting the speed. Call when the weapon is put away. */
export function resetSwing(tracker: SwingTracker): void {
  tracker.last = null
  tracker.lastWorld = null
  tracker.instant = 0
  tracker.speed = 0
}

/**
 * A world-space point in the player's own frame: origin at their feet, +Z behind them.
 *
 * Written into `out` rather than returned, because this runs twice per fixed step.
 */
export function toPlayerFrame(
  point: Vec3,
  player: { position: Vec3; yaw: number },
  out: Vec3,
): Vec3 {
  const dx = point.x - player.position.x
  const dy = point.y - player.position.y
  const dz = point.z - player.position.z
  // Rotating a world offset *into* the player's frame is the inverse of the yaw that took
  // their local axes out to the world, which for a Y-up yaw is this pair — not `cos(-yaw)`
  // and `sin(-yaw)`, which rotates the wrong way and leaves a pure turn looking like motion.
  const cos = Math.cos(player.yaw)
  const sin = Math.sin(player.yaw)
  out.x = dx * cos - dz * sin
  out.y = dy
  out.z = dx * sin + dz * cos
  return out
}

/**
 * Speed to a damage multiplier. Zero means "this was not a swing".
 *
 * Piecewise linear rather than a curve, because these are the numbers a player feels and
 * every one of the four of them should be a thing you can state: it does nothing below 1.5,
 * half damage at 1.5, full damage at 4.5, and 1.4× at 8 and above.
 */
export function swingPower(speed: number): number {
  if (!Number.isFinite(speed) || speed < MELEE_MIN_SPEED) return 0
  if (speed >= MELEE_MAX_SPEED) return MELEE_MAX_POWER
  if (speed <= MELEE_FULL_SPEED) {
    const t = (speed - MELEE_MIN_SPEED) / (MELEE_FULL_SPEED - MELEE_MIN_SPEED)
    return MELEE_MIN_POWER + t * (1 - MELEE_MIN_POWER)
  }
  const t = (speed - MELEE_FULL_SPEED) / (MELEE_MAX_SPEED - MELEE_FULL_SPEED)
  return 1 + t * (MELEE_MAX_POWER - 1)
}
