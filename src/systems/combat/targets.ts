/**
 * Everything in the world that can be hit, and the queries that find it.
 *
 * The same registry pattern as `interaction.ts`, for the same reason: a projectile in flight
 * must not care whether the thing in front of it is a training dummy in the foyer or a
 * skeleton in wave four, and the enemies in Sprint 2.3 should be able to arrive without a
 * single line changing here. Register, be hittable; unregister, stop being hittable.
 *
 * The two queries are the two shapes an attack has. A projectile sweeps a segment between
 * where it was and where it now is — never a point test, because a bolt travelling 18m/s
 * covers 30cm in a fixed step and would tunnel straight through anything thinner than that.
 * A melee swing sweeps the same way, along the path the blade's tip took.
 *
 * Pure except for the registry itself, and tested against spheres rather than against a
 * headset.
 */

import type { Vec3 } from '@/systems/locomotion'
import type { DamageEvent, Resistances, ResolvedDamage, StatusState } from '@/systems/combat/damage'
import { applyStatus, clampResistance, stepStatuses } from '@/systems/combat/damage'

export interface Damageable {
  readonly id: string
  /**
   * Centre, in world space. Mutable and read every step, so something that walks around
   * needs no re-registration — which is the whole of what Sprint 2.3 needs from this.
   */
  position: Vec3
  /** Hit sphere/capsule radius. Generous rather than exact: a near miss that reads as a hit is worse. */
  radius: number
  /**
   * Half the length of the hit volume's vertical axis, above and below `position`. Absent or
   * zero keeps the hit volume a sphere — training dummies and anything else that doesn't set
   * it are unaffected. Set on enemies so the whole visible body is hittable, not just a sphere
   * at chest height. See `sweepDamageables`.
   */
  halfHeight?: number
  hp: number
  maxHp: number
  resistances?: Resistances
  /** Statuses currently on it. Owned here so the driver can tick them in one pass. */
  statuses: StatusState[]
  /** A disabled target stays registered but cannot be hit. A dead dummy, mid-respawn. */
  enabled: boolean
  /**
   * Fractional burn damage carried between steps. Owned by `tickTargetStatuses`.
   *
   * It exists because damage is a whole number the player is shown — see `resolveDamage` —
   * and a burn dealing 4/second billed sixty times a second would round every step up to 1
   * and set things on fire fifteen times too hard. The fraction accumulates here until it is
   * worth a point.
   */
  burnCarry?: number
  /** Called after health has changed. Hit flash, stagger, death — the target's own business. */
  onDamage?: (event: DamageEvent) => void
}

const registry = new Map<string, Damageable>()

/** Register for the lifetime of a component; the returned function unregisters. */
export function registerDamageable(target: Damageable): () => void {
  registry.set(target.id, target)
  return () => {
    if (registry.get(target.id) === target) registry.delete(target.id)
  }
}

export function damageables(): Damageable[] {
  return [...registry.values()]
}

export function findDamageable(id: string): Damageable | null {
  return registry.get(id) ?? null
}

/** Test-only, and the scene teardown between `?scene=` swaps. */
export function clearDamageables(): void {
  registry.clear()
}

export interface SweepHit {
  target: Damageable
  /** How far along the segment, 0..1. */
  t: number
  /** Where the surface was struck, in world space. */
  point: Vec3
}

/**
 * The nearest target whose sphere the segment `from → to` passes through.
 *
 * Standard segment/sphere intersection, kept explicit rather than pulled from three.js: this
 * runs inside the fixed loop for every live projectile every step, and it has no business
 * allocating a `Vector3` to answer a question about six numbers.
 *
 * A segment that *starts* inside a sphere counts as a hit at t=0. That case is a sword tip
 * already touching something when the swing begins, and refusing it would mean a blade
 * resting against an enemy could never connect.
 */
export function sweepDamageables(
  list: readonly Damageable[],
  from: Vec3,
  to: Vec3,
  radius = 0,
  skip?: ReadonlySet<string>,
): SweepHit | null {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dz = to.z - from.z
  const lengthSq = dx * dx + dy * dy + dz * dz

  let best: SweepHit | null = null

  for (const target of list) {
    if (!target.enabled || target.hp <= 0) continue
    if (skip?.has(target.id)) continue

    const r = target.radius + radius

    if (target.halfHeight && target.halfHeight > 0) {
      // A vertical capsule: the whole body, not a ball at chest height. Closest distance
      // between the attack segment and the capsule's own vertical axis, which is exact for
      // capsule-vs-swept-sphere the same way it is for capsule-vs-capsule — a capsule is the
      // Minkowski sum of a segment and a sphere, so two capsules intersect iff their core
      // segments come within the sum of their radii.
      const hit = closestOnSegments(
        from,
        dx,
        dy,
        dz,
        target.position.x,
        target.position.y - target.halfHeight,
        target.position.z,
        0,
        target.halfHeight * 2,
        0,
      )
      if (hit.distSq > r * r) continue
      if (best && hit.t >= best.t) continue
      best = {
        target,
        t: hit.t,
        point: { x: from.x + dx * hit.t, y: from.y + dy * hit.t, z: from.z + dz * hit.t },
      }
      continue
    }

    const ox = from.x - target.position.x
    const oy = from.y - target.position.y
    const oz = from.z - target.position.z

    // Already inside: a hit at the start of the segment.
    if (ox * ox + oy * oy + oz * oz <= r * r) {
      if (!best || best.t > 0) best = { target, t: 0, point: { ...from } }
      continue
    }

    // A zero-length segment that wasn't already inside cannot reach anything.
    if (lengthSq === 0) continue

    const b = ox * dx + oy * dy + oz * dz
    const c = ox * ox + oy * oy + oz * oz - r * r
    const discriminant = b * b - lengthSq * c
    if (discriminant < 0) continue

    const t = (-b - Math.sqrt(discriminant)) / lengthSq
    if (t < 0 || t > 1) continue
    if (best && t >= best.t) continue

    best = {
      target,
      t,
      point: { x: from.x + dx * t, y: from.y + dy * t, z: from.z + dz * t },
    }
  }

  return best
}

/**
 * Closest distance between segment `p1 + t*d1` (`t` in [0,1], `d1` given as `dx1,dy1,dz1`) and
 * segment `p2 + s*d2` (`s` in [0,1], `d2` given as `dx2,dy2,dz2`). Returns `t`, the parameter
 * on the *first* segment (the attack), since that is the ordering `sweepDamageables` needs.
 *
 * The standard two-segment closest-point algorithm (Ericson, *Real-Time Collision Detection*
 * §5.1.9), specialised to nothing — `d2` happens to always be vertical here (a capsule's axis)
 * but the general form costs nothing extra and needs no separate proof. No allocations: this
 * runs inside the fixed loop for every live projectile and melee swing every step.
 */
function closestOnSegments(
  p1: Vec3,
  dx1: number,
  dy1: number,
  dz1: number,
  p2x: number,
  p2y: number,
  p2z: number,
  dx2: number,
  dy2: number,
  dz2: number,
): { t: number; distSq: number } {
  const EPS = 1e-9
  const rx = p1.x - p2x
  const ry = p1.y - p2y
  const rz = p1.z - p2z

  const a = dx1 * dx1 + dy1 * dy1 + dz1 * dz1
  const e = dx2 * dx2 + dy2 * dy2 + dz2 * dz2
  const f = dx2 * rx + dy2 * ry + dz2 * rz

  // `sAttack` walks segment 1 (`p1`, the attack), `sAxis` walks segment 2 (`p2`, the capsule
  // axis) — Ericson's own naming swaps `s`/`t` between the two segments, which reads as a typo
  // if not called out.
  let sAttack: number
  let sAxis: number

  if (a <= EPS && e <= EPS) {
    sAttack = 0
    sAxis = 0
  } else if (a <= EPS) {
    sAttack = 0
    sAxis = clamp01(f / e)
  } else {
    const c = dx1 * rx + dy1 * ry + dz1 * rz
    if (e <= EPS) {
      sAxis = 0
      sAttack = clamp01(-c / a)
    } else {
      const b = dx1 * dx2 + dy1 * dy2 + dz1 * dz2
      const denom = a * e - b * b
      sAttack = denom > EPS ? clamp01((b * f - c * e) / denom) : 0
      sAxis = (b * sAttack + f) / e
      if (sAxis < 0) {
        sAxis = 0
        sAttack = clamp01(-c / a)
      } else if (sAxis > 1) {
        sAxis = 1
        sAttack = clamp01((b - c) / a)
      }
    }
  }

  const cx = p1.x + dx1 * sAttack - (p2x + dx2 * sAxis)
  const cy = p1.y + dy1 * sAttack - (p2y + dy2 * sAxis)
  const cz = p1.z + dz1 * sAttack - (p2z + dz2 * sAxis)
  return { t: sAttack, distSq: cx * cx + cy * cy + cz * cz }
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/**
 * Take health off a target and hand back the event describing it.
 *
 * The single place health changes. `resolveDamage` decides the number; this decides what it
 * did — including whether it was the killing blow, which is asked here and answered once so
 * that two hits landing on the same step cannot both claim the kill.
 */
export function applyDamage(
  target: Damageable,
  resolved: ResolvedDamage,
  point: Vec3,
): DamageEvent {
  const wasAlive = target.hp > 0
  target.hp = Math.max(0, target.hp - resolved.amount)

  if (resolved.status && target.hp > 0) applyStatus(target.statuses, resolved.status)

  const event: DamageEvent = {
    ...resolved,
    targetId: target.id,
    point: { ...point },
    remaining: target.hp,
    killed: wasAlive && target.hp <= 0,
  }

  target.onDamage?.(event)
  return event
}

/**
 * Age a target's statuses by one step, and hand back the burn damage that came due.
 *
 * Null on almost every step, which is the point: a burn worth four damage a second owes a
 * whole point roughly once every fifteen steps, and the other fourteen are carried rather
 * than rounded. The damage it does return goes through `applyDamage` like everything else,
 * so a target that burns to death dies properly — with a kill event, and in Sprint 2.3 a
 * corpse and a loot drop.
 */
export function tickTargetStatuses(target: Damageable, dt: number): ResolvedDamage | null {
  if (target.statuses.length === 0) return null

  const burning = target.statuses.some((status) => status.kind === 'burning')
  const fractional = stepStatuses(target.statuses, dt)
  if (!burning || fractional <= 0) return null

  // Resisted like any other fire damage. A target described as resisting fire that burns at
  // the full rate anyway is a target whose description is a lie — and with a burn attached to
  // every bolt, the burn is a large enough share of the total to hide the resistance
  // entirely.
  const resistance = clampResistance(target.resistances?.fire ?? 0)
  const carry = (target.burnCarry ?? 0) + fractional * (1 - resistance)
  const whole = Math.floor(carry)
  target.burnCarry = carry - whole
  if (whole <= 0) return null

  return {
    amount: whole,
    element: 'fire',
    crit: false,
    // A burn does not re-apply itself, or nothing on fire would ever stop being on fire.
    status: null,
    source: { kind: 'status', weaponId: null, hand: null },
  }
}

/**
 * A ring buffer of the damage events the world has just produced.
 *
 * A buffer rather than callbacks, because the readers are all *presentation* — the floating
 * numbers, and in 2.4 the sparks and the hitstop — and presentation runs on the render frame
 * while damage happens on the fixed step. Several hits can land between two frames, and a
 * callback into React from inside the fixed loop is a re-render per bolt.
 *
 * Fixed capacity, oldest dropped. Losing the twelfth simultaneous damage number is not a
 * failure worth allocating for.
 */
const EVENT_CAPACITY = 32
const events: DamageEvent[] = []
let eventSeq = 0

export function publishDamage(event: DamageEvent): void {
  eventSeq += 1
  events.push(event)
  if (events.length > EVENT_CAPACITY) events.shift()
}

/** Events published since `since`, plus the sequence number to pass in next time. */
export function damageSince(since: number): { events: DamageEvent[]; seq: number } {
  const skip = Math.max(0, events.length - (eventSeq - since))
  return { events: events.slice(skip), seq: eventSeq }
}

export function damageSeq(): number {
  return eventSeq
}

export function clearDamageEvents(): void {
  events.length = 0
  eventSeq = 0
}
