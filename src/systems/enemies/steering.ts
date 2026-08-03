/**
 * How a body gets from where it is to where it wants to be, in two dimensions.
 *
 * Split out from the state machine because these are the parts with real arithmetic in them,
 * and arithmetic that can only be checked by watching a goblin in a headset is arithmetic
 * that does not get checked. Nothing here knows what an enemy is: it is a position, a list of
 * waypoints, some neighbours, and a question about whether a point is standable.
 *
 * Enemies are **not rigid bodies**. A dozen Rapier character controllers stepping against a
 * few hundred wall colliders is most of a Quest's frame, for movement that is fully described
 * by a grid the pathfinder has already baked. So they move kinematically and ask the nav grid
 * whether the place they are going is floor — which has the useful side effect that an enemy
 * can never be shoved through a wall by a physics impulse, because there are none.
 */

import type { Waypoint } from '@/systems/enemies/pool'

/** A horizontal direction and how strongly it is wanted. Never normalised for you. */
export interface Steer {
  x: number
  z: number
}

/**
 * Advance along a path and report the direction to walk.
 *
 * The index only ever moves **forward**, and a waypoint counts as reached once the body is
 * within `arriveRadius` of it. Chasing waypoint centres exactly makes a body stop dead at
 * every corner of an L-shaped corridor; the tolerance is what turns a staircase of grid cells
 * back into a walk.
 *
 * Returns a zero direction at the end of the path, which is the honest answer — "I am there" —
 * and leaves it to the caller to decide whether that means idling or repathing.
 */
export function followPath(
  position: Waypoint,
  path: readonly Waypoint[],
  index: number,
  arriveRadius: number,
): { x: number; z: number; index: number } {
  let at = Math.max(0, index)

  while (at < path.length) {
    const waypoint = path[at] as Waypoint
    const dx = waypoint.x - position.x
    const dz = waypoint.z - position.z
    const distance = Math.hypot(dx, dz)
    if (distance > arriveRadius) return { x: dx / distance, z: dz / distance, index: at }
    at += 1
  }

  return { x: 0, z: 0, index: at }
}

/** What `separation` needs to know about a neighbour. */
export interface Neighbour {
  x: number
  z: number
  radius: number
}

/**
 * Push away from anything standing too close.
 *
 * Without this a pack converges on the same waypoints and arrives as one enemy-shaped stack:
 * five things occupying one hit sphere, five sets of damage coming out of a single point, and
 * a player who cannot tell what they are fighting. It is also the only thing keeping enemies
 * apart at all, since they have no colliders to keep them apart with.
 *
 * The push falls off with distance and is capped at 1, so a body wedged between two others
 * gets a firm shove rather than an infinite one — separation that overwhelms the path is a
 * pack that scatters instead of attacking.
 *
 * `skip` exists so the caller can pass one shared list of everything alive rather than
 * building a fresh list per enemy every step. Without it, an enemy finds itself at distance
 * zero and shoves itself sideways forever.
 */
export function separation(
  self: Waypoint,
  radius: number,
  neighbours: readonly Neighbour[],
  skip = -1,
): Steer {
  let x = 0
  let z = 0

  for (let i = 0; i < neighbours.length; i++) {
    if (i === skip) continue
    const other = neighbours[i] as Neighbour
    const dx = self.x - other.x
    const dz = self.z - other.z
    const distance = Math.hypot(dx, dz)
    const spacing = radius + other.radius
    if (distance >= spacing) continue

    if (distance < 1e-4) {
      // Exactly on top of each other — which happens when two spawn on the same cell. Any
      // direction will do, as long as it is deterministic and they do not pick the same one.
      x += 1
      z += 0
      continue
    }

    const push = (spacing - distance) / spacing
    x += (dx / distance) * push
    z += (dz / distance) * push
  }

  const length = Math.hypot(x, z)
  if (length <= 1) return { x, z }
  return { x: x / length, z: z / length }
}

/**
 * Blend a path direction with a separation push into one unit heading.
 *
 * The path wins by weight, deliberately. Separation is a correction, not a goal: an enemy that
 * weights them equally spends a crowded fight orbiting the player instead of reaching them.
 */
export function blendSteering(path: Steer, apart: Steer, separationWeight: number): Steer {
  const x = path.x + apart.x * separationWeight
  const z = path.z + apart.z * separationWeight
  const length = Math.hypot(x, z)
  if (length < 1e-6) return { x: 0, z: 0 }
  return { x: x / length, z: z / length }
}

/** Whether a body of `radius` may stand centred on this point. */
export type Standable = (x: number, z: number) => boolean

function fits(x: number, z: number, radius: number, open: Standable): boolean {
  return (
    open(x, z) &&
    open(x + radius, z) &&
    open(x - radius, z) &&
    open(x, z + radius) &&
    open(x, z - radius)
  )
}

/**
 * Move, sliding along whatever it runs into.
 *
 * Try the whole step; failing that, try each axis on its own; failing that, stand still. The
 * axis fallbacks are what stop an enemy from sticking to a wall it approached at an angle —
 * without them, a body walking diagonally into a corridor wall stops dead and stays there,
 * which reads as the pathfinder having given up rather than as a collision.
 *
 * The body is tested as five points rather than a circle. Exact enough at a 2m cell size,
 * where the error is a couple of centimetres at the corners, and it costs four grid lookups
 * instead of a swept-circle solve for every enemy every step.
 */
export function resolveMove(
  from: Waypoint,
  dx: number,
  dz: number,
  radius: number,
  open: Standable,
): Waypoint {
  const x = from.x + dx
  const z = from.z + dz
  if (fits(x, z, radius, open)) return { x, z }
  if (dx !== 0 && fits(x, from.z, radius, open)) return { x, z: from.z }
  if (dz !== 0 && fits(from.x, z, radius, open)) return { x: from.x, z }
  return { x: from.x, z: from.z }
}

/**
 * Turn towards a heading, at a limited rate.
 *
 * Snapping to face the player is what makes a creature read as a turret. It also hides the
 * one piece of information a telegraph depends on: an enemy that has to turn before it can
 * hit you is an enemy you can walk around, and that has to be visible.
 */
export function turnTowards(yaw: number, wanted: number, maxStep: number): number {
  let delta = wanted - yaw
  // Shortest way round. Without this a body turning past ±π takes the long route, spinning
  // most of a full circle to make a few degrees of correction.
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  if (Math.abs(delta) <= maxStep) return wanted
  return yaw + Math.sign(delta) * maxStep
}

/**
 * The yaw that faces along a horizontal direction.
 *
 * three.js convention: an object at yaw θ points along `(-sin θ, 0, -cos θ)`, because yaw 0
 * looks down -Z. The same expression the desktop camera's `lookAt` uses, and worth stating
 * once: getting it wrong by π gives you enemies that walk backwards, convincingly.
 */
export function headingOf(x: number, z: number): number {
  return Math.atan2(-x, -z)
}
