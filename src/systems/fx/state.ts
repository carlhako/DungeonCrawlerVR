/**
 * The live effect state: what is in the air, how hard the view is shaking, and whether the
 * world is currently held.
 *
 * Its own module rather than living in `FxDriver.tsx`, for the same reason `combat/state.ts`
 * exists: the driver writes it, the particle renderer walks it, `PlayerRig` reads the shake to
 * place the desktop camera, `SimulationDriver` reads the hitstop to gate the fixed loop, and
 * the debug handle reports all of it. Hanging that off a component would have four modules
 * importing a React component, and one of them is imported by the driver.
 */

import { createHitstop } from '@/systems/fx/hitstop'
import { createParticlePool, activeParticles } from '@/systems/fx/particles'
import { createShake } from '@/systems/fx/shake'

export const particlePool = createParticlePool()

export const shakeState = createShake()

export const hitstopState = createHitstop()

/** What the debug handle and the smoke test read. */
export function fxSnapshot() {
  return {
    particles: activeParticles(particlePool),
    trauma: +shakeState.trauma.toFixed(3),
    hitstop: +hitstopState.remaining.toFixed(3),
  }
}
