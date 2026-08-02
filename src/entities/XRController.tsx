import { Suspense } from 'react'
import { XRControllerModel, XRSpace, useXRInputSourceStateContext } from '@react-three/xr'
import type { Object3D } from 'three'
import { setAim } from '@/systems/xrAim'

/**
 * What a controller is in this game: a model, and a published aim pose. No pointers.
 *
 * `@react-three/xr` ships a default controller that also carries a ray pointer for
 * DOM-style pointer events on 3D objects. We don't use those — interaction goes through
 * `src/systems/interaction.ts`, which owns the "one focus per step" rule that the prompt,
 * the haptics and the shop highlight all read from. Leaving the default pointer on drew a
 * second, longer line out of each hand that could highlight things the game's own picker
 * had not chosen, so it is turned off here by simply not rendering it.
 *
 * The anchor in target-ray space is the other half of the same job — see `xrAim`.
 */
export function GameXRController() {
  const state = useXRInputSourceStateContext('controller')
  const handedness = state.inputSource.handedness

  return (
    <>
      {/* Suspense because the model is fetched from the WebXR input profile registry, and
          a controller that pops in a frame late is much better than a blank session. */}
      <Suspense>
        <XRControllerModel />
      </Suspense>
      <XRSpace
        space="target-ray-space"
        ref={(object: Object3D | null) => {
          setAim(handedness, object)
        }}
      />
    </>
  )
}
