import { useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { gameLoop, type SystemUpdate } from './loop'

/**
 * Drives the fixed-timestep simulation from R3F's render loop.
 *
 * Mounted once, as the first child of <Canvas>. It stays at the default priority (0) so
 * R3F keeps ownership of rendering — taking a non-zero priority would make us responsible
 * for calling `gl.render` ourselves, which breaks WebXR's frame submission.
 */
export function SimulationDriver() {
  useFrame((_state, delta) => {
    gameLoop.advance(delta)
  })
  return null
}

/**
 * Register a system with the fixed-timestep loop for the lifetime of a component.
 *
 * The callback receives a constant `dt` (never the frame delta), so anything registered
 * here behaves identically at 60Hz on a desktop and 72Hz in a headset. Use `useFrame`
 * directly for purely visual work — interpolation, billboarding, shader uniforms.
 */
export function useFixedUpdate(update: SystemUpdate, order = 0, deps: unknown[] = []) {
  useEffect(() => {
    return gameLoop.register(update, order)
    // The caller owns the identity of `update` via `deps`; re-registering every render
    // would thrash the system array on a hot path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, ...deps])
}
