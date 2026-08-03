import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { setDebugView } from './debug'

/**
 * Hands the scene and renderer to the debug handle.
 *
 * Dev-only, and mounted inside the Canvas because that is the only place those two exist.
 * It is what lets `__DCVR__.render` answer "how many draw calls, how many lights?" — the two
 * numbers that decide whether the Quest holds 72fps, and the two that are easiest to lose by
 * accident when a level goes from a few objects to a few thousand.
 */
export function DebugView() {
  const scene = useThree((state) => state.scene)
  const gl = useThree((state) => state.gl)

  useEffect(() => {
    setDebugView(scene, gl)
    return () => setDebugView(null, null)
  }, [scene, gl])

  return null
}
