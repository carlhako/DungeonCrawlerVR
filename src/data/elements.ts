/**
 * Damage elements and the statuses they leave behind.
 *
 * Its own file rather than a corner of `weapons.ts` or of the damage pipeline, because both
 * of those need it and neither owns it: a weapon *has* an element, and the damage pipeline
 * *resolves* one. Putting it in either would have the other importing from a module it has
 * no other business with, and enemies in Sprint 2.3 will need it without caring about
 * weapons at all.
 *
 * Three elements, matching the weapon roster's intent: the ordinary case, and the two the
 * Emberwand and the Frostbrand are built around. The status each one applies is part of the
 * element's identity rather than a per-weapon field, so "fire burns and frost chills" is
 * stated once and cannot drift between the wand and the staff.
 */

export type Element = 'physical' | 'fire' | 'frost'

export type StatusKind = 'burning' | 'chilled'

/** What a hit of this element leaves on the target, if anything. */
export const ELEMENT_STATUS: Record<Element, StatusKind | null> = {
  physical: null,
  fire: 'burning',
  frost: 'chilled',
}

/**
 * How a status behaves once applied.
 *
 * `magnitude` means different things per status and deliberately so: burning is damage per
 * second, chilled is the fraction of movement speed taken away. They are not the same
 * quantity and pretending otherwise would only produce a shared field that every reader has
 * to interpret anyway.
 *
 * Refreshing rather than stacking. Stacking damage-over-time turns "keep shooting" into the
 * only tactic worth having, and an enemy that dies to a status it acquired eight seconds ago
 * has no readable cause of death.
 */
export interface StatusRule {
  seconds: number
  magnitude: number
}

export const STATUS_RULES: Record<StatusKind, StatusRule> = {
  burning: { seconds: 3, magnitude: 4 },
  chilled: { seconds: 2.5, magnitude: 0.4 },
}

/**
 * The colour each element reads as, for the projectile, its light, and the damage number.
 *
 * Here rather than in the component that draws them, because Sprint 2.4's impact VFX and
 * Sprint 3.2's audio both need to key off the same thing, and an element whose colour is
 * decided in three files is an element that ends up three different colours.
 */
export const ELEMENT_COLOUR: Record<Element, string> = {
  physical: '#dcd2c0',
  fire: '#ff8a3c',
  frost: '#8fd8ff',
}
