import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Group, Mesh, MeshBasicMaterial } from 'three'
import { ELEMENT_COLOUR } from '@/data/elements'
import { damageSince } from '@/systems/combat/targets'
import { createLabel, type Label } from '@/ui/label'

/**
 * The number that comes off a target when you hit it.
 *
 * The one piece of Sprint 2.4's feedback work that cannot wait for Sprint 2.4, because this
 * sprint's acceptance test is "damage numbers, mana drain and cooldowns behave in both
 * modes" — and without a number on the screen the only way to tell a crit from a resist is
 * to read the console, which does not exist in a headset.
 *
 * Billboarded, because a damage number you have to be standing in the right place to read is
 * not feedback. It rises and fades, which is the whole animation: anything more elaborate
 * competes with the thing that just happened.
 */

const POOL_SIZE = 12
const LIFE_SECONDS = 0.9
const RISE = 0.55

/**
 * Digits are rasterised once and reused.
 *
 * A canvas per hit would be a texture upload per hit, several times a second, on the frames
 * where the player is fighting hardest. There are only so many numbers a weapon can produce,
 * and caching them by text means the common ones are drawn once for the whole session.
 */
const cache = new Map<string, Label>()

function labelFor(text: string, colour: string): Label {
  const key = `${text}|${colour}`
  const existing = cache.get(key)
  if (existing) return existing
  const label = createLabel(text, { fontSize: 72, colour, background: 'rgba(0,0,0,0)' })
  cache.set(key, label)
  return label
}

interface Slot {
  group: Group | null
  mesh: Mesh | null
  age: number
  live: boolean
}

export function DamageNumbers() {
  const camera = useThree((state) => state.camera)
  const slots = useRef<Slot[]>(
    Array.from({ length: POOL_SIZE }, () => ({ group: null, mesh: null, age: 0, live: false })),
  )
  const cursor = useRef(0)
  const seen = useRef(0)

  // Start from whatever the buffer has already published rather than from zero: mounting
  // must not replay every hit landed before this component existed.
  useEffect(() => {
    seen.current = damageSince(0).seq
  }, [])

  const groups = useMemo(() => Array.from({ length: POOL_SIZE }, (_, i) => i), [])

  useFrame((_state, delta) => {
    const { events, seq } = damageSince(seen.current)
    seen.current = seq

    for (const event of events) {
      const slot = slots.current[cursor.current % POOL_SIZE]!
      cursor.current += 1
      if (!slot.group || !slot.mesh) continue

      const colour = event.crit ? '#ffe27a' : ELEMENT_COLOUR[event.element]
      const label = labelFor(event.crit ? `${event.amount}!` : `${event.amount}`, colour)

      const material = slot.mesh.material as MeshBasicMaterial
      material.map = label.texture
      material.needsUpdate = true

      // Sized from the label's own aspect so the digits are never stretched, and a crit is
      // drawn larger — the size is the tell you read before the colour.
      const height = event.crit ? 0.16 : 0.115
      slot.mesh.scale.set(label.aspect * height, height, 1)

      // Nudged towards the shooter and jittered sideways, so two hits in the same place do
      // not draw exactly on top of one another and read as one.
      slot.group.position.set(
        event.point.x + (Math.random() - 0.5) * 0.18,
        event.point.y + 0.1,
        event.point.z + (Math.random() - 0.5) * 0.18,
      )
      slot.age = 0
      slot.live = true
    }

    for (const slot of slots.current) {
      if (!slot.live || !slot.group || !slot.mesh) continue

      slot.age += delta
      if (slot.age >= LIFE_SECONDS) {
        slot.live = false
        slot.group.visible = false
        continue
      }

      const t = slot.age / LIFE_SECONDS
      slot.group.visible = true
      slot.group.position.y += (RISE * delta) / LIFE_SECONDS
      slot.group.lookAt(camera.position)

      const material = slot.mesh.material as MeshBasicMaterial
      // Held at full opacity for the first half, then faded. A number that starts fading
      // immediately is a number you have to have already been looking at.
      material.opacity = t < 0.5 ? 1 : 1 - (t - 0.5) / 0.5
    }
  })

  return (
    <>
      {groups.map((index) => (
        <group
          key={index}
          visible={false}
          ref={(group: Group | null) => {
            slots.current[index]!.group = group
          }}
        >
          <mesh
            ref={(mesh: Mesh | null) => {
              slots.current[index]!.mesh = mesh
            }}
          >
            <planeGeometry args={[1, 1]} />
            {/* `depthTest` off so a number is never swallowed by the thing it came out of —
                the hit point is on the target's surface, which is exactly where the geometry
                is. */}
            <meshBasicMaterial transparent depthTest={false} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </>
  )
}
