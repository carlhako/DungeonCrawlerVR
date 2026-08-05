import RAPIER from '@dimforge/rapier3d-compat'
import { Object3D } from 'three'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  consumeGorillaMotion,
  createGorillaScratch,
  resetGorillaRuntime,
  stepGorilla,
  type GorillaScratch,
} from './gorillaLocomotion'
import { setHand } from './xrHands'

/**
 * Gorilla locomotion against a real Rapier world.
 *
 * The pure-maths tests next door cannot catch the failure this file exists for. Twice now
 * the mode has shipped unable to move the player at all, and both times the arithmetic was
 * fine — what was broken was *contact detection*, which only exists once there is a physics
 * world and a hand pose in it. So this drives the actual step function against a real floor
 * and a real wall, and asserts the body moves.
 *
 * The single most important assertion is `orientation is irrelevant`: the bug that made the
 * mode unusable was a raycast along the controller's forward axis, which meant contact
 * depended on where the controller happened to be *pointing*. Nothing about swinging your
 * arm to walk involves aiming it.
 */

const FLOOR_Y = 0

/**
 * Head height while pushing off the ground.
 *
 * Not the 1.6m of a standing player: `clampArmReach` is real, and a head 1.6m up cannot put
 * a hand on the floor 0.4m in front of it without exceeding a 1.5m arm — the hand gets
 * clamped back up off the floor and contact is correctly lost. You lean down to knuckle
 * along the ground, so the tests lean down too.
 */
const CROUCHED_HEAD = { x: 0, y: 1.3, z: 0 }

let world: RAPIER.World
let scratch: GorillaScratch

beforeAll(async () => {
  await RAPIER.init()
})

/** A dungeon-shaped world: a grippable floor, a grippable wall, one non-grippable prop. */
function buildWorld(): RAPIER.World {
  const w = new RAPIER.World({ x: 0, y: -22, z: 0 })

  const floor = w.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  floor.userData = { grippable: true }
  w.createCollider(RAPIER.ColliderDesc.cuboid(20, 0.1, 20).setTranslation(0, FLOOR_Y - 0.1, 0), floor)

  const wall = w.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  wall.userData = { grippable: true }
  w.createCollider(RAPIER.ColliderDesc.cuboid(0.1, 3, 5).setTranslation(-2, 1.5, 0), wall)

  // Props are not handholds. A sweep must pass straight through one.
  const prop = w.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  prop.userData = { grippable: false }
  w.createCollider(RAPIER.ColliderDesc.cuboid(0.3, 0.3, 0.3).setTranslation(4, 0.3, 0), prop)

  w.step()
  return w
}

/** Place a tracked hand at a world point. Rotation is set too, so the tests can prove it
 *  makes no difference. */
function placeHand(handedness: 'left' | 'right', x: number, y: number, z: number, yaw = 0): void {
  const obj = new Object3D()
  obj.position.set(x, y, z)
  obj.rotation.y = yaw
  obj.updateMatrixWorld(true)
  setHand(handedness, obj)
}

function setHead(at: { x: number; y: number; z: number }): void {
  scratch.head.x = at.x
  scratch.head.y = at.y
  scratch.head.z = at.z
}

function step(): { x: number; y: number; z: number } {
  stepGorilla(world, 3, scratch)
  const { displacement } = consumeGorillaMotion()
  return { ...displacement }
}

beforeEach(() => {
  world = buildWorld()
  scratch = createGorillaScratch()
  setHead(CROUCHED_HEAD)
  resetGorillaRuntime()
  setHand('left', null)
  setHand('right', null)
})

describe('hand contact', () => {
  it('a hand dragged backwards along the floor pushes the body forwards', () => {
    // Hand down at the floor, then pulled back towards the player. The body must go the
    // other way — this is walking.
    placeHand('right', 0.3, 0.04, -0.35)
    step() // first frame seeds the anchor, contributes nothing

    placeHand('right', 0.3, 0.04, -0.05)
    const moved = step()

    expect(moved.z).toBeLessThan(-0.2)
    expect(Math.abs(moved.x)).toBeLessThan(0.01)
  })

  it('orientation is irrelevant — the hand sweeps a sphere, it does not aim a ray', () => {
    // The regression guard. The old implementation raycast along the controller's -Z axis,
    // so a hand pointing away from the floor could never register contact and the player
    // could not move at all. Same motion, four different controller yaws, same result.
    const results: number[] = []
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      resetGorillaRuntime()
      placeHand('right', 0.3, 0.04, -0.35, yaw)
      step()
      placeHand('right', 0.3, 0.04, -0.05, yaw)
      results.push(step().z)
    }
    for (const z of results) expect(z).toBeLessThan(-0.2)
    // And they should all agree, not merely all be non-zero.
    const spread = Math.max(...results) - Math.min(...results)
    expect(spread).toBeLessThan(1e-6)
  })

  it('a hand waving in mid-air moves the body only by gravity', () => {
    placeHand('right', 0.3, 1.2, -0.35)
    step()
    placeHand('right', 0.3, 1.2, -0.05)
    const moved = step()

    expect(Math.abs(moved.x)).toBeLessThan(1e-6)
    expect(Math.abs(moved.z)).toBeLessThan(1e-6)
    expect(moved.y).toBeLessThan(0)
  })

  it('pulling down on a wall lifts the body — climbing', () => {
    // The hand is pressed *into* the wall face at x=-1.9, not floating at exactly the
    // sphere's resting distance from it. That distinction is not cosmetic: a sweep running
    // perfectly parallel to a surface at exactly the resting gap registers nothing, because
    // there is no separation for it to close. A hand holding a wall is pushing on it.
    setHead({ x: -1.2, y: 1.5, z: 0 })
    placeHand('right', -1.88, 1.9, 0)
    step()
    placeHand('right', -1.88, 1.5, 0)
    const moved = step()

    expect(moved.y).toBeGreaterThan(0.35)
  })

  it('two hands pulling together move the body once, not twice', () => {
    placeHand('left', -0.3, 0.04, -0.35)
    placeHand('right', 0.3, 0.04, -0.35)
    step()
    placeHand('left', -0.3, 0.04, -0.05)
    placeHand('right', 0.3, 0.04, -0.05)
    const both = step()

    resetGorillaRuntime()
    setHand('left', null)
    placeHand('right', 0.3, 0.04, -0.35)
    step()
    placeHand('right', 0.3, 0.04, -0.05)
    const one = step()

    // Averaged, so two hands making the same motion move the body the same distance as one.
    expect(both.z).toBeCloseTo(one.z, 2)
  })

  it('a non-grippable prop is not a handhold', () => {
    setHead({ x: 4, y: 1.5, z: -0.6 })
    placeHand('right', 4, 0.65, -0.35)
    step()
    placeHand('right', 4, 0.65, -0.05)
    const moved = step()

    expect(Math.abs(moved.z)).toBeLessThan(1e-6)
  })
})

/**
 * Which bodies count as handholds.
 *
 * These exist because the suite above passed in full while the game was unplayable. Every
 * body in `buildWorld` carries an explicit `userData.grippable`, so the tests silently
 * assumed the thing that was actually broken: the real foyer's floor and walls are plain
 * fixed bodies with no `userData` at all, and the strict opt-in rule filtered every one of
 * them out. A world built by hand is not evidence about a world built by a scene.
 */
describe('what counts as a handhold', () => {
  /** A floor with no `userData` whatsoever — the foyer, and any scene that forgets. */
  function floorOnly(kind: 'fixed' | 'kinematic'): RAPIER.World {
    const w = new RAPIER.World({ x: 0, y: -22, z: 0 })
    const desc =
      kind === 'fixed' ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.kinematicPositionBased()
    const body = w.createRigidBody(desc)
    w.createCollider(
      RAPIER.ColliderDesc.cuboid(20, 0.1, 20).setTranslation(0, FLOOR_Y - 0.1, 0),
      body,
    )
    w.step()
    return w
  }

  it('an untagged static floor is a handhold — the foyer regression', () => {
    world = floorOnly('fixed')
    placeHand('right', 0.3, 0.04, -0.35)
    step()
    placeHand('right', 0.3, 0.04, -0.05)

    expect(step().z).toBeLessThan(-0.2)
  })

  it('an untagged moving body is not', () => {
    // An anchor is a world-space point. Holding something that moves would tether the
    // player to a position it has already left, so movement must opt in, never default in.
    world = floorOnly('kinematic')
    placeHand('right', 0.3, 0.04, -0.35)
    step()
    placeHand('right', 0.3, 0.04, -0.05)

    expect(Math.abs(step().z)).toBeLessThan(1e-6)
  })
})
