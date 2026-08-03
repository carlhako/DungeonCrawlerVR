/**
 * Which lights are real, and how they hand over.
 *
 * A level has seventy-odd torches and can afford a handful of real lights, so the pool has to
 * move. The naive version — sort by distance every frame, slot 0 gets the nearest — is correct
 * and looks broken: walk into a dark room and the far torches snap to full brightness as you
 * cross some invisible line, and two torches at similar distances trade a slot back and forth
 * as you turn your head.
 *
 * Three things fix that, and they are separable and pure, so they are here rather than tangled
 * into a `useFrame`:
 *
 * - **Fade at the edge of range.** A light that arrives at zero and ramps up never pops. This
 *   is the artificial part of the budget made gradual — real falloff is already handled by the
 *   renderer's 1/d².
 * - **Hysteresis on the slots.** A slot keeps its torch while that torch is still close, even
 *   if a nearer one appears, and slots are re-used in place rather than re-sorted. A handover
 *   then only ever happens out at the edge, where both sides of it are near zero brightness.
 * - **A slow, decelerating ramp, separate from the flicker.** The first two alone still read
 *   as a light switching on: a torch getting its first slot used to jump onto a fast, linear,
 *   constant-velocity ramp — over in a third of a second, with a hard start. `stepLightSlot`
 *   eases towards its target exponentially instead, and flicker is applied *after* the ramp,
 *   not folded into what it is ramping towards, so the two no longer fight over one timescale.
 * - **Urgency only when something is actually waiting.** The fast drop that makes a handover
 *   invisible is only invisible if it starts from near zero. A torch simply losing budget
 *   contention with nothing else claiming its slot has no reason to hurry, so it eases down in
 *   place at the same pace as growth — which is also what makes "fades, then suddenly switches
 *   off" a bug rather than "how the budget works": that mismatch of urgencies was the bug.
 */

/**
 * Fraction of the range at which a light starts fading out, for the *visual* falloff.
 *
 * Deliberately separate from `HOLD_FRACTION` below, which governs slot stickiness — this one
 * is purely "how far out does a torch start dimming", and pushing it out further widens the
 * distance over which a torch visibly grows as the player approaches, rather than sitting at
 * full brightness until close range and then only having the budget's own pop to hide.
 */
export const FALLOFF_START = 0.42

/**
 * Brightness multiplier for the budget's own cutoff: 1 up close, 0 beyond `range`.
 *
 * Smoothstepped rather than linear so there is no visible crease at either end of the ramp.
 */
export function rangeFalloff(
  distance: number,
  range: number,
  fadeStart = FALLOFF_START,
): number {
  const start = range * fadeStart
  if (distance <= start) return 1
  if (distance >= range) return 0
  const t = (distance - start) / (range - start)
  const eased = 1 - t
  return eased * eased * (3 - 2 * eased)
}

/**
 * Fraction of range within which a slot holds its torch regardless of what else is nearby.
 *
 * Must stay well out past `FALLOFF_START`, not equal to it. A torch is only safe to hand to a
 * competitor once its *own* brightness has already faded to near nothing — otherwise a torch
 * at, say, 70% brightness can be preempted by something nearer and hit the fast,
 * meant-to-be-invisible drop in `stepLightSlot` while still clearly lit. That mismatch — the
 * two fractions drifting apart when `FALLOFF_START` was widened without widening this to
 * match — was the actual bug behind "torches fade, then suddenly switch off" backing away from
 * one in a room with others nearby to contend for the slot.
 */
export const HOLD_FRACTION = 0.82

/**
 * Decide which torch each light slot should be on.
 *
 * `current` is last step's assignment and is not mutated. A slot holds its torch while that
 * torch is within `holdDistance` — chosen by the caller to be the distance at which a light is
 * still fully bright — so a newly-nearer torch waits for a slot to free up naturally instead
 * of yanking a lit torch dark in front of the player.
 *
 * Returns a new array of torch indices, `null` for a slot with nothing worth lighting.
 */
export function assignLightSlots(
  current: ReadonlyArray<number | null>,
  distances: ReadonlyArray<number>,
  slotCount: number,
  holdDistance: number,
  range: number,
): Array<number | null> {
  // The torches that would light the scene best right now, nearest first.
  const wanted: number[] = []
  for (let index = 0; index < distances.length; index++) {
    const distance = distances[index] as number
    if (distance > range) continue
    wanted.push(index)
  }
  wanted.sort((a, b) => (distances[a] as number) - (distances[b] as number))
  wanted.length = Math.min(wanted.length, slotCount)

  const next: Array<number | null> = new Array(slotCount).fill(null)
  const taken = new Set<number>()

  // Keep first: a slot that is already on a torch worth keeping stays exactly where it is, so
  // the light does not teleport across the room to a torch of the same rank.
  for (let slot = 0; slot < slotCount; slot++) {
    const held = current[slot]
    if (held == null || taken.has(held)) continue
    const distance = distances[held]
    if (distance == null) continue
    if (distance <= holdDistance || wanted.includes(held)) {
      next[slot] = held
      taken.add(held)
    }
  }

  // Then fill whatever is left, in order of how much it is wanted.
  let cursor = 0
  for (let slot = 0; slot < slotCount; slot++) {
    if (next[slot] != null) continue
    while (cursor < wanted.length && taken.has(wanted[cursor] as number)) cursor++
    if (cursor >= wanted.length) break
    const pick = wanted[cursor] as number
    next[slot] = pick
    taken.add(pick)
  }

  return next
}

/**
 * Seconds for a slot to fall dark before it swaps to a *different, waiting* torch.
 *
 * Deliberately fast, and deliberately only used for that one case — an active handover, where
 * something else genuinely needs the slot right now. A torch that simply drifts out of range
 * with nothing waiting for its slot is not urgent at all; forcing it through this same fast
 * drop was the bug ("fades, then suddenly switches off"), because the fast drop was only ever
 * meant to be invisible, and it is only invisible when it starts from near zero.
 */
export const DROP_SECONDS = 0.18

/** Below this, a fading-with-nothing-waiting slot is treated as settled and cleared to null. */
const SETTLED = 0.05

/**
 * Time constant, in seconds, for a slot easing towards its target once it has a torch.
 *
 * This is the number that was missing before: a torch getting a slot used to jump straight
 * onto the same linear ramp used for handovers — fast, constant-velocity, over in a third of a
 * second — which is indistinguishable from a light switching on. A slot's *distance* to a
 * torch already changes continuously as the player walks (that is what `rangeFalloff` is), so
 * the only thing left to fix was the ramp's own shape: exponential easing moves a constant
 * *fraction* of the remaining gap each instant, fastest when furthest from the target and
 * slowing as it arrives, rather than a constant speed with a hard start. That is the difference
 * between an ember catching and a bulb being switched on.
 *
 * At normal walking pace this spreads the visible rise over a couple of metres of approach
 * rather than one step. Tune by walking it, not by reading the number.
 */
export const GROWTH_TAU = 0.6

/** A light in the pool: which torch it is on, and how bright it currently is. */
export interface LightSlot {
  torch: number | null
  intensity: number
}

/**
 * Advance one slot towards what it should be showing.
 *
 * `targetIntensity` must **not** include flicker — flicker is fast (a couple of Hz) and this
 * function's whole job is to be slow, so mixing them here would mean either the ramp smears
 * the flicker into mush or the flicker's speed leaks into the ramp and the pop comes right
 * back. Apply `flicker()` to this function's *output*, once per frame, outside the ramp.
 *
 * Three cases, not two — the middle one is what fixed the "sudden switch off":
 *
 * - `wantTorch` is the slot's own torch: ease towards `targetIntensity`, same as growth.
 * - `wantTorch` is `null` — nothing is waiting for this slot: ease towards zero *in place*,
 *   at the same unhurried pace as growth, keeping the torch (and so the light's position)
 *   until it is actually settled. Nothing is being denied a slot by taking this slowly, so
 *   there is no reason for it to look like anything other than the light fading on its own —
 *   and if the player is only oscillating near the edge of its range, the slot picks the same
 *   torch back up without ever having reset, which a hard drop-to-zero-and-regrow would not.
 * - `wantTorch` is a *different* torch — an active handover, something else needs the slot
 *   now: drop at `dropRate` and swap once dark. This is the one genuinely urgent case, and by
 *   the time it fires the outgoing torch has almost always already faded near zero via the
 *   branch above, so the fast drop rarely has any real brightness left to hide.
 *
 * Pure and dt-driven.
 */
export function stepLightSlot(
  slot: LightSlot,
  wantTorch: number | null,
  targetIntensity: number,
  dt: number,
  dropRate: number,
): LightSlot {
  if (wantTorch == null && slot.torch != null) {
    const alpha = 1 - Math.exp(-dt / GROWTH_TAU)
    const intensity = slot.intensity - slot.intensity * alpha
    return intensity < SETTLED
      ? { torch: null, intensity: 0 }
      : { torch: slot.torch, intensity }
  }

  if (slot.torch !== wantTorch) {
    const intensity = Math.max(0, slot.intensity - dropRate * dt)
    // Only adopt the new torch once this one is dark, so the jump in position happens at zero
    // brightness and is invisible.
    if (intensity <= 0) return { torch: wantTorch, intensity: 0 }
    return { torch: slot.torch, intensity }
  }

  if (slot.torch == null) return { torch: null, intensity: 0 }

  const alpha = 1 - Math.exp(-dt / GROWTH_TAU)
  return {
    torch: slot.torch,
    intensity: slot.intensity + (targetIntensity - slot.intensity) * alpha,
  }
}
