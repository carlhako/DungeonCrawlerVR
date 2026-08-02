import { XROrigin } from '@react-three/xr'

/**
 * The player's position in the world.
 *
 * `XROrigin` marks where the player's **feet** are — head height comes from the headset's
 * own floor-relative tracking, never from us. Setting a camera Y here would double-count
 * it and leave the player floating.
 *
 * In Sprint 0.3 the character controller drives this group's position; for now it is a
 * fixed spawn point so the greybox can be inspected at true scale.
 */

export const PLAYER_SPAWN: [number, number, number] = [0, 0, 4]

export function PlayerRig() {
  return <XROrigin position={PLAYER_SPAWN} />
}
