import { useRapier } from '@react-three/rapier'
import { SystemOrder } from '@/core/loop'
import { useFixedUpdate } from '@/core/simulation'

/**
 * Steps Rapier from our own fixed loop instead of letting it step itself.
 *
 * `<Physics>` is mounted `paused`, which stops it stepping inside its own `useFrame`, and
 * this drives it at `SystemOrder.Physics` — after the player controller has asked for its
 * movement, before anything reads the result.
 *
 * Two loops each running at "60Hz" is not the same as one. Rapier keeps its own
 * accumulator, so left to itself it would drift in and out of phase with ours, and a
 * character controller that queries the world in one loop while it is being stepped by
 * another sees a world that is sometimes half a step stale. Everything downstream of that —
 * ground detection, teleport arcs, hit registration — inherits the jitter. One clock.
 */
export function PhysicsDriver() {
  const { step } = useRapier()

  useFixedUpdate(
    (dt) => {
      step(dt)
    },
    SystemOrder.Physics,
    [step],
  )

  return null
}
