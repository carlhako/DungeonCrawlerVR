import { Suspense } from 'react'
import { XRControllerModel, XRSpace, useXRInputSourceStateContext } from '@react-three/xr'
import type { Object3D } from 'three'
import { setAim } from '@/systems/xrAim'
import { setHand } from '@/systems/xrHands'
import { VRWeaponRig } from '@/entities/WeaponRig'
import { PointerBeam } from '@/ui/PointerBeam'

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

      {/* A blade is an extension of the fist, so it hangs off the grip pose and sticks out
          along the controller's own body. A wand is *pointed*, so its rig is inside the
          target-ray space below, on the same line as the beam — the distinction Sprint 1.3
          learned the hard way when aiming down the grip pointed at the floor. */}
      {(handedness === 'left' || handedness === 'right') && (
        <VRWeaponRig handedness={handedness} mount="grip" />
      )}

      {/* The grip-pose Object3D, separate from the target ray published via `xrAim`. The
          gorilla locomotion module reads `xrHands.{left,right}` to know where the hand
          actually *is*, not where it is aimed — a 45°-tilted target ray aimed at the wall
          is not the same point as the controller in the player's fist. */}
      <XRSpace
        space="grip-space"
        ref={(object: Object3D | null) => {
          setHand(handedness, object)
        }}
      />

      <XRSpace
        space="target-ray-space"
        ref={(object: Object3D | null) => {
          setAim(handedness, object)
        }}
      >
        {/* Parented, not positioned: the beam rides the tracked pose exactly, with no frame
            of lag between the line and the hand it comes out of. */}
        {(handedness === 'left' || handedness === 'right') && (
          <>
            <PointerBeam handedness={handedness} />
            <VRWeaponRig handedness={handedness} mount="ray" />
          </>
        )}
      </XRSpace>
    </>
  )
}
