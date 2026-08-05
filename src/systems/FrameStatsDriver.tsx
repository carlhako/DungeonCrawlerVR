/**
 * Feeds the frame-time buffer from the render loop.
 *
 * A `useFrame` peer, **not** a `useFixedUpdate` system, and that is the whole point: the fixed
 * loop clamps its input at `MAX_FRAME_DELTA` (0.25s) to avoid the spiral of death, so a system
 * registered there can never see a frame worse than 4fps — which is precisely the dip this
 * readout exists to catch. It also runs at 60Hz regardless of what the display is doing, and
 * "what the display is actually doing" is the measurement.
 *
 * Dev-only, like the rest of Sprint 3.0: `App` does not mount it in a production build.
 */

import { useFrame } from '@react-three/fiber'
import { frameStats, pushFrame } from '@/systems/frameStats'

export function FrameStatsDriver() {
  useFrame((_state, delta) => {
    pushFrame(frameStats, delta)
  })
  return null
}
