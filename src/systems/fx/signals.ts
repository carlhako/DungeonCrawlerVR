/**
 * The things worth drawing that are *not* damage.
 *
 * `targets.ts` already publishes a damage event for everything that loses health, and the
 * damage numbers and the impact bursts both read it. Two things this sprint needs are not in
 * it: a bolt that hits a wall (nothing lost health, but sparks should still come off the
 * stone) and a wand firing (nothing has been hit yet at all). Rather than widen the damage
 * buffer to carry events that are not damage, they get their own — same ring-buffer contract,
 * same reason for it: presentation runs on the render frame, damage and firing happen on the
 * fixed step, and several of each can land between two frames.
 *
 * Deliberately small. If a signal needs a field that only a renderer cares about, it belongs
 * in the renderer.
 */

import type { Element } from '@/data/elements'
import type { Vec3 } from '@/systems/locomotion'

export interface FxSignal {
  kind: 'muzzle' | 'worldImpact'
  point: Vec3
  /**
   * Which way the effect is thrown. For a muzzle flash it is the direction of fire; for an
   * impact it is the surface normal we have — the reverse of the bolt's own travel, which is
   * exact for a wall met head-on and close enough for one met at an angle.
   */
  direction: Vec3
  element: Element
}

const CAPACITY = 32
const signals: FxSignal[] = []
let seq = 0

export function publishFx(signal: FxSignal): void {
  seq += 1
  signals.push(signal)
  if (signals.length > CAPACITY) signals.shift()
}

/** Signals published since `since`, plus the sequence number to pass in next time. */
export function fxSince(since: number): { signals: FxSignal[]; seq: number } {
  const skip = Math.max(0, signals.length - (seq - since))
  return { signals: signals.slice(skip), seq }
}

export function fxSeq(): number {
  return seq
}

export function clearFxSignals(): void {
  signals.length = 0
  seq = 0
}
