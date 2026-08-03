import { useEffect, useMemo, useRef } from 'react'
import { CanvasTexture, Group, LinearFilter, Mesh, SRGBColorSpace, Vector3 } from 'three'
import { SystemOrder } from '@/core/loop'
import { useFixedUpdate } from '@/core/simulation'
import { useGame } from '@/systems/game'
import { interactionState, registerInteractable, type Interactable } from '@/systems/interaction'
import {
  IDLE_RESET,
  armSecondsLeft,
  pressReset,
  resetPrompt,
  tickReset,
  type ResetState,
} from '@/systems/reset'
import { useRun } from '@/systems/run'
import { useShop } from '@/systems/shop'
import { STARTING_GOLD } from '@/systems/save'

/**
 * The "new game" plaque: a small board on the back wall that wipes progression.
 *
 * On a wall rather than in a menu because this game has no menus in the world — every
 * control the player has is a thing in a room, and a reset that lived in the F2 dev panel
 * would exist only on desktop. It is on the wall *behind* the spawn, away from the door and
 * the counter, for the same reason a fire alarm isn't next to the light switch.
 *
 * Two presses, never one: the first arms it, the second does it, and it stands down on its
 * own after a few seconds (`src/systems/reset.ts`). Everything in this game can be earned
 * back except this, and the player's whole interaction vocabulary is "point at a thing and
 * pull the trigger" — which is one twitch away from an accident.
 *
 * Settings are *not* touched. Comfort options are about the person, not the run, and making
 * somebody re-pick their locomotion mode because they wanted to start again is a small
 * cruelty.
 */

const PLAQUE_WIDTH = 0.68
const PLAQUE_HEIGHT = 0.44

/** The one button, in plaque-local metres, origin at the centre. */
const BUTTON = { cx: 0, cy: -0.1, w: 0.56, h: 0.14 }

const PIXELS_PER_METRE = 768

/** Matches the shop board: how far in front a hand still counts as touching. */
const TOUCH_DEPTH = 0.06

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

type PlaqueLook = 'idle' | 'armed' | 'done' | 'locked'

const STYLES: Record<PlaqueLook, { fill: string; border: string; text: string }> = {
  idle: { fill: '#2b2f38', border: '#4a5262', text: '#e8e2d6' },
  // Red, and the only red button in the game. It should not look like the others.
  armed: { fill: '#5e2e28', border: '#c2705f', text: '#ffd9d0' },
  done: { fill: '#33422f', border: '#6f8f5f', text: '#eaf3e0' },
  locked: { fill: '#232329', border: '#32323a', text: '#6a6a72' },
}

interface ResetPlaqueProps {
  position: [number, number, number]
  /** Yaw in radians. 0 faces +Z. */
  rotation?: number
}

export function ResetPlaque({ position, rotation = 0 }: ResetPlaqueProps) {
  const group = useRef<Group>(null)
  const highlight = useRef<Mesh>(null)
  const state = useRef<ResetState>(IDLE_RESET)

  const surface = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(PLAQUE_WIDTH * PIXELS_PER_METRE)
    canvas.height = Math.round(PLAQUE_HEIGHT * PIXELS_PER_METRE)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas unavailable — cannot draw the reset plaque')
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    texture.generateMipmaps = false
    texture.minFilter = LinearFilter
    texture.magFilter = LinearFilter
    texture.anisotropy = 4
    return { canvas, ctx, texture }
  }, [])

  const scratch = useMemo(
    () => ({
      local: new Vector3(),
      right: new Vector3(),
      up: new Vector3(),
      normal: new Vector3(),
      signature: '',
      /** Simulation seconds, kept here so `onActivate` can stamp the press. */
      now: 0,
    }),
    [],
  )

  const item = useMemo<Interactable>(
    () => ({
      id: 'reset-game',
      position: { x: 0, y: 0, z: 0 },
      radius: Math.min(BUTTON.w, BUTTON.h) / 2,
      surface: {
        right: { x: 1, y: 0, z: 0 },
        up: { x: 0, y: 1, z: 0 },
        normal: { x: 0, y: 0, z: 1 },
        halfWidth: BUTTON.w / 2,
        halfHeight: BUTTON.h / 2,
        depth: TOUCH_DEPTH,
      },
      label: resetPrompt(IDLE_RESET),
      enabled: true,
      // Like the shop buttons: standing near a wall is not a statement about wanting to
      // wipe your save. This one has to be aimed at or touched, deliberately.
      proximity: false,
      onActivate: () => {
        const { next, wipe } = pressReset(state.current, scratch.now)
        state.current = next
        if (!wipe) return
        useGame.getState().resetSave()
        // The run machine holds the wave number it read at the start of the run, and the
        // shop holds a selection and a message about a purchase that no longer happened.
        useRun.getState().reset()
        useShop.getState().clearFeedback()
      },
    }),
    [scratch],
  )

  useEffect(() => registerInteractable(item), [item])

  useEffect(() => {
    const { texture } = surface
    return () => texture.dispose()
  }, [surface])

  useFixedUpdate((_dt, elapsed) => {
    const node = group.current
    if (!node) return

    scratch.now = elapsed
    state.current = tickReset(state.current, elapsed)

    // Wiping the save while a wave is running would leave the run holding a wave number and
    // a dungeon that the save has never heard of. The plaque is in the foyer, so this only
    // comes up if the player walks back in through the door mid-wave — but "only if" is not
    // an argument for leaving a live control on the wall.
    const phase = useRun.getState().phase
    const busy = phase === 'loading' || phase === 'wave'
    const look: PlaqueLook = busy ? 'locked' : state.current.phase

    placeButton(node, item, scratch)
    item.enabled = !busy
    item.label = busy ? 'Not while a wave is running' : resetPrompt(state.current)

    const marker = highlight.current
    if (marker) marker.visible = !busy && interactionState.focus?.id === item.id

    const secondsLeft = armSecondsLeft(state.current, elapsed)
    const signature = `${look}~${secondsLeft}`
    if (signature === scratch.signature) return
    scratch.signature = signature

    draw(surface.ctx, surface.canvas, look, secondsLeft)
    surface.texture.needsUpdate = true
  }, SystemOrder.Effects)

  return (
    <group ref={group} position={position} rotation={[0, rotation, 0]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[PLAQUE_WIDTH + 0.05, PLAQUE_HEIGHT + 0.05, 0.04]} />
        <meshStandardMaterial color="#2a2118" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0, 0.021]}>
        <planeGeometry args={[PLAQUE_WIDTH, PLAQUE_HEIGHT]} />
        <meshBasicMaterial map={surface.texture} toneMapped={false} />
      </mesh>
      <mesh ref={highlight} position={[BUTTON.cx, BUTTON.cy, 0.023]} visible={false}>
        <planeGeometry args={[BUTTON.w, BUTTON.h]} />
        <meshBasicMaterial
          color="#ffcf8a"
          transparent
          opacity={0.22}
          toneMapped={false}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}

/**
 * Keep the interactable on the button, in world space.
 *
 * Same approach as the shop board: the axes come from the plaque's own matrix rather than
 * from the yaw prop, so the button stays on the button if this is ever hung on something
 * that moves.
 */
function placeButton(
  node: Group,
  item: Interactable,
  scratch: { local: Vector3; right: Vector3; up: Vector3; normal: Vector3 },
): void {
  node.updateWorldMatrix(true, false)
  const { local, right, up, normal } = scratch
  node.matrixWorld.extractBasis(right, up, normal)
  right.normalize()
  up.normalize()
  normal.normalize()

  // Slightly proud of the face, so a hand meets the button rather than the board behind it.
  local.set(BUTTON.cx, BUTTON.cy, 0.04)
  node.localToWorld(local)
  item.position.x = local.x
  item.position.y = local.y
  item.position.z = local.z

  const surface = item.surface
  if (!surface) return
  surface.right.x = right.x
  surface.right.y = right.y
  surface.right.z = right.z
  surface.up.x = up.x
  surface.up.y = up.y
  surface.up.z = up.z
  surface.normal.x = normal.x
  surface.normal.y = normal.y
  surface.normal.z = normal.z
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

const BLURB: Record<PlaqueLook, string> = {
  idle: 'Wipes gold, weapons and every upgrade.',
  armed: 'This cannot be undone. Press again.',
  done: `Everything is back to ${STARTING_GOLD} gold.`,
  locked: 'Finish the wave first.',
}

function label(look: PlaqueLook, secondsLeft: number): string {
  switch (look) {
    case 'idle':
      return 'Start a new game'
    case 'armed':
      return `Confirm — wipe everything  ${secondsLeft}s`
    case 'done':
      return 'New game started'
    case 'locked':
      return 'Unavailable'
  }
}

function draw(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  look: PlaqueLook,
  secondsLeft: number,
): void {
  const { width, height } = canvas
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#15141a'
  ctx.fillRect(0, 0, width, height)

  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.font = `600 34px ${FONT}`
  ctx.fillStyle = '#cfc4b0'
  ctx.fillText('NEW GAME', 28, 44)

  ctx.strokeStyle = '#3a3630'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(24, 72)
  ctx.lineTo(width - 24, 72)
  ctx.stroke()

  ctx.font = `400 23px ${FONT}`
  ctx.fillStyle = look === 'armed' ? '#f0b0a4' : '#9a938a'
  ctx.fillText(BLURB[look], 28, 108, width - 56)

  const style = STYLES[look]
  const x = width / 2 - (BUTTON.w * PIXELS_PER_METRE) / 2
  const y = height / 2 - (BUTTON.cy + BUTTON.h / 2) * PIXELS_PER_METRE
  const w = BUTTON.w * PIXELS_PER_METRE
  const h = BUTTON.h * PIXELS_PER_METRE

  roundedRect(ctx, x, y, w, h, 12)
  ctx.fillStyle = style.fill
  ctx.fill()
  ctx.strokeStyle = style.border
  ctx.lineWidth = look === 'armed' ? 4 : 2
  ctx.stroke()

  ctx.textAlign = 'center'
  ctx.font = `600 27px ${FONT}`
  ctx.fillStyle = style.text
  ctx.fillText(label(look, secondsLeft), x + w / 2, y + h / 2, w - 32)
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + width, y, x + width, y + height, radius)
  ctx.arcTo(x + width, y + height, x, y + height, radius)
  ctx.arcTo(x, y + height, x, y, radius)
  ctx.arcTo(x, y, x + width, y, radius)
  ctx.closePath()
}
