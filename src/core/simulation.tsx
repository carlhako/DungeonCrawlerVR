import { useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { gameLoop, type SystemUpdate } from './loop'
import { stepHitstop, timeScale } from '@/systems/fx/hitstop'
import { hitstopState } from '@/systems/fx/state'

/**
 * Drives the fixed-timestep simulation from R3F's render loop.
 *
 * Mounted once, as the first child of <Canvas>. It stays at the default priority (0) so
 * R3F keeps ownership of rendering — taking a non-zero priority would make us responsible
 * for calling `gl.render` ourselves, which breaks WebXR's frame submission.
 *
 * It is also where hitstop lands, because hitstop is not a system — it is a multiplier on how
 * much time the simulation is handed. Scaling the delta rather than skipping steps keeps the
 * accumulator honest: no time is banked, so the world resumes at normal speed with nothing to
 * catch up on. The stop is desktop-only, and that rule lives in `timeScale` rather than here;
 * see `fx/hitstop.ts` for why a headset must never have the world slow under a moving head.
 */
export function SimulationDriver() {
  useFrame((state, delta) => {
    const scale = timeScale(hitstopState, { inVR: state.gl.xr.isPresenting })
    // Aged by *real* time: a stop that aged by scaled time would take 1/scale as long as it
    // asked for, which is the whole duration multiplied by seven.
    stepHitstop(hitstopState, delta)
    gameLoop.advance(delta * scale)
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
