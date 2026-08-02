import { useEffect, useMemo, useRef } from 'react'
import { CanvasTexture, Group, LinearFilter, Mesh, SRGBColorSpace, Vector3 } from 'three'
import { SystemOrder } from '@/core/loop'
import { useFixedUpdate } from '@/core/simulation'
import { WEAPONS, formatStat, weaponStats } from '@/data/weapons'
import { useGame } from '@/systems/game'
import { interactionState, registerInteractable, type Interactable } from '@/systems/interaction'
import { ownsWeapon, type SaveData } from '@/systems/save'
import {
  PANEL_HEIGHT,
  PANEL_WIDTH,
  upgradePips,
  useShop,
  type ShopButton,
  type ShopFeedback,
} from '@/systems/shop'

/**
 * The weapon shop: a lit board standing on the counter.
 *
 * Diegetic and world-space, not a DOM overlay — which is the rule for all in-game UI here,
 * and this is the first place it costs anything. A screen-space shop would have been an
 * afternoon's work and would exist only on the desktop build; in a headset there is no
 * screen to put it on. So the shop is a *thing in the room*: you walk up to it, point at a
 * button or reach out and touch it, and it responds where it is.
 *
 * Rendered as one canvas texture rather than as dozens of meshes. It is a single draw call,
 * it lets the layout be laid out (columns, right-aligned prices, pips) instead of assembled,
 * and it redraws only when something actually changes — which in a shop is a handful of
 * times per visit.
 *
 * The buttons are ordinary `Interactable`s registered at the world positions of the
 * rectangles the canvas drew, so the thing you press is the thing you see. They opt out of
 * proximity picking: with eight buttons 12cm apart, "nearest to the player's body" is a coin
 * toss rather than a guess at intent.
 */

/**
 * Texture resolution. 1.3m across at this density is comfortably readable at arm's length.
 *
 * Every redraw re-uploads the whole texture, so this is a direct cost every time the panel
 * changes. It is the reason the focus highlight is a separate quad rather than part of the
 * drawing: pointing along a row of buttons changes the focus several times a second, and
 * re-rasterising a megapixel to move a border is a hitch you can feel in a headset.
 */
const PIXELS_PER_METRE = 768

/**
 * How large the board actually is, as a fraction of its layout units.
 *
 * The layout is written at a comfortable size to reason about; this is what it measures on
 * the wall. At full size a player standing at the counter — about 0.7m from the near edge,
 * which is where the counter puts you — had a board filling most of their field of view.
 * That is uncomfortable in VR and it makes you step backwards to read anything.
 */
const PANEL_SCALE = 0.72

/**
 * How far in front of the board a hand still counts as touching a button, in metres.
 *
 * The only tolerance a rectangular button has, and the only one it needs. The buttons are
 * picked as the rectangles they are drawn as (see `Interactable.surface`), so being generous
 * here cannot leak a press into the row below — which is exactly what the old spherical
 * pick did, with a reach of 16cm across rows 8cm apart.
 */
const TOUCH_DEPTH = 0.06

/** How long a purchase message stays up. Long enough to read, short enough not to nag. */
const FEEDBACK_SECONDS = 3

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

interface PanelStyle {
  fill: string
  border: string
  text: string
  detail: string
}

const STYLES: Record<ShopButton['state'], PanelStyle> = {
  available: { fill: '#2b2f38', border: '#4a5262', text: '#e8e2d6', detail: '#ffd479' },
  // Shown, never hidden: the price is exactly the information the player needs.
  unaffordable: { fill: '#2a2420', border: '#543832', text: '#a89a90', detail: '#d4756a' },
  done: { fill: '#33422f', border: '#6f8f5f', text: '#eaf3e0', detail: '#bcd8a8' },
  locked: { fill: '#232329', border: '#32323a', text: '#6a6a72', detail: '#6a6a72' },
}

interface ShopPanelProps {
  position: [number, number, number]
  /** Yaw in radians. 0 faces +Z. */
  rotation?: number
}

export function ShopPanel({ position, rotation = 0 }: ShopPanelProps) {
  const group = useRef<Group>(null)
  const highlight = useRef<Mesh>(null)

  const surface = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(PANEL_WIDTH * PIXELS_PER_METRE)
    canvas.height = Math.round(PANEL_HEIGHT * PIXELS_PER_METRE)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas unavailable — cannot draw the shop panel')
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    texture.generateMipmaps = false
    texture.minFilter = LinearFilter
    texture.magFilter = LinearFilter
    texture.anisotropy = 4
    return { canvas, ctx, texture }
  }, [])

  /**
   * Live registrations, keyed by button id.
   *
   * Kept imperatively rather than as React children because the button *set* changes as the
   * player buys things, and re-rendering a subtree to move a handful of world positions is a
   * lot of machinery for something the fixed loop can do in a few lines.
   */
  const registrations = useMemo(
    () => new Map<string, { item: Interactable; unregister: () => void }>(),
    [],
  )
  const scratch = useMemo(
    () => ({
      local: new Vector3(),
      right: new Vector3(),
      up: new Vector3(),
      normal: new Vector3(),
      signature: '',
    }),
    [],
  )

  useEffect(() => {
    const live = registrations
    const { texture } = surface
    return () => {
      for (const { unregister } of live.values()) unregister()
      live.clear()
      texture.dispose()
    }
  }, [registrations, surface])

  useFixedUpdate(() => {
    const node = group.current
    if (!node) return

    const save = useGame.getState().save
    const shop = useShop.getState()

    if (shop.feedback && performance.now() - shop.feedback.at > FEEDBACK_SECONDS * 1000) {
      shop.clearFeedback()
    }

    const buttons = shop.buttons(save)

    // The highlight is a quad that moves, not part of the drawing — see PIXELS_PER_METRE.
    const focusId = interactionState.focus?.id ?? ''
    const focused = focusId ? buttons.find((b) => b.id === focusId) : undefined
    const marker = highlight.current
    if (marker) {
      marker.visible = focused !== undefined
      if (focused) {
        marker.position.set(focused.rect.cx, focused.rect.cy, 0.023)
        marker.scale.set(focused.rect.w, focused.rect.h, 1)
      }
    }

    // Redraw only when something visible changed. A shop that re-rasterises a megapixel
    // sixty times a second is a frame budget spent on a stationary board.
    const signature = [
      save.gold,
      shop.selected,
      shop.feedback?.text ?? '',
      buttons.map((b) => `${b.id}:${b.state}:${b.label}:${b.detail}`).join('|'),
    ].join('~')
    if (signature === scratch.signature) return
    scratch.signature = signature

    syncButtons(node, registrations, buttons, scratch)
    draw(surface.ctx, surface.canvas, save, buttons, shop.selected, shop.feedback)
    surface.texture.needsUpdate = true
  }, SystemOrder.Effects)

  return (
    <group ref={group} position={position} rotation={[0, rotation, 0]} scale={PANEL_SCALE}>
      {/* A frame, so the board reads as an object rather than as a floating image. */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[PANEL_WIDTH + 0.06, PANEL_HEIGHT + 0.06, 0.04]} />
        <meshStandardMaterial color="#2a2118" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0, 0.021]}>
        <planeGeometry args={[PANEL_WIDTH, PANEL_HEIGHT]} />
        {/* Unlit: a shop you can only read when a torch happens to flicker your way is a
            shop nobody uses. Emissive-style flatness is also what makes it read as lit
            signage in a dark room rather than as painted wood. */}
        <meshBasicMaterial map={surface.texture} toneMapped={false} />
      </mesh>

      {/* What you are pointing at, in the same torchlight amber as every other "you can use
          this" cue in the game. A unit quad, scaled to the button. */}
      <mesh ref={highlight} visible={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color="#ffcf8a" transparent opacity={0.22} toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  )
}

/**
 * Bring the registered interactables in line with the current button list.
 *
 * Buttons keep stable ids across redraws, so an unchanged button keeps its registration and
 * the interaction focus doesn't flicker while the player is looking straight at it.
 */
function syncButtons(
  node: Group,
  registrations: Map<string, { item: Interactable; unregister: () => void }>,
  buttons: ShopButton[],
  scratch: { local: Vector3; right: Vector3; up: Vector3; normal: Vector3 },
): void {
  node.updateWorldMatrix(true, false)
  const seen = new Set<string>()

  // The board's own axes, taken from the matrix rather than rebuilt from the yaw prop, so
  // the buttons stay attached to the board if it is ever parented to something that moves.
  const { local, right, up, normal } = scratch
  node.matrixWorld.extractBasis(right, up, normal)
  right.normalize()
  up.normalize()
  normal.normalize()

  for (const button of buttons) {
    seen.add(button.id)
    // Slightly proud of the surface, so a hand reaching for a button meets it at the glass
    // rather than having to push through the board.
    local.set(button.rect.cx, button.rect.cy, 0.04)
    node.localToWorld(local)

    // Half-extents in world metres: the rect is in layout units and the group scales them.
    const halfWidth = (button.rect.w / 2) * PANEL_SCALE
    const halfHeight = (button.rect.h / 2) * PANEL_SCALE

    const existing = registrations.get(button.id)
    if (existing) {
      existing.item.position.x = local.x
      existing.item.position.y = local.y
      existing.item.position.z = local.z
      existing.item.label = button.prompt
      existing.item.enabled = button.state !== 'locked'
      const surface = existing.item.surface
      if (surface) {
        copy(surface.right, right)
        copy(surface.up, up)
        copy(surface.normal, normal)
        surface.halfWidth = halfWidth
        surface.halfHeight = halfHeight
      }
      continue
    }

    const item: Interactable = {
      id: button.id,
      position: { x: local.x, y: local.y, z: local.z },
      // The pickable shape is the drawn rectangle — see `Interactable.surface`. `radius` only
      // sizes the prompt that floats above it now.
      radius: Math.min(halfWidth, halfHeight),
      surface: {
        right: { x: right.x, y: right.y, z: right.z },
        up: { x: up.x, y: up.y, z: up.z },
        normal: { x: normal.x, y: normal.y, z: normal.z },
        halfWidth,
        halfHeight,
        depth: TOUCH_DEPTH,
      },
      label: button.prompt,
      enabled: button.state !== 'locked',
      proximity: false,
      onActivate: () => {
        // Read the action fresh: the button list is rebuilt as the save changes, and the
        // closure must not act on a layout from three purchases ago.
        const current = useShop.getState().buttons(useGame.getState().save)
        const match = current.find((b) => b.id === button.id)
        if (match) useShop.getState().activate(match.action)
      },
    }
    registrations.set(button.id, { item, unregister: registerInteractable(item) })
  }

  for (const [id, registration] of registrations) {
    if (seen.has(id)) continue
    registration.unregister()
    registrations.delete(id)
  }
}

/** Write a three.js vector into a plain one, in place — these are read every fixed step. */
function copy(target: { x: number; y: number; z: number }, source: Vector3): void {
  target.x = source.x
  target.y = source.y
  target.z = source.z
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function draw(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  save: SaveData,
  buttons: ShopButton[],
  selected: string,
  feedback: ShopFeedback | null,
): void {
  const { width, height } = canvas
  ctx.clearRect(0, 0, width, height)

  ctx.fillStyle = '#15141a'
  ctx.fillRect(0, 0, width, height)

  // Header: what this is, and what the player has to spend. Gold is the only number in the
  // shop that matters on every single row, so it lives where the eye starts.
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.font = `600 40px ${FONT}`
  ctx.fillStyle = '#cfc4b0'
  ctx.fillText('WEAPONS', 34, 52)

  ctx.textAlign = 'right'
  ctx.fillStyle = '#ffd479'
  ctx.font = `700 44px ${FONT}`
  ctx.fillText(`${save.gold}g`, width - 34, 52)

  ctx.strokeStyle = '#3a3630'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(28, 86)
  ctx.lineTo(width - 28, 86)
  ctx.stroke()

  // The selected weapon's name and one line about it, above its upgrade rows.
  const definition = WEAPONS[selected as keyof typeof WEAPONS]
  const detailX = toPixelX(width, -0.12)
  ctx.textAlign = 'left'
  ctx.font = `600 34px ${FONT}`
  ctx.fillStyle = '#e8e2d6'
  ctx.fillText(definition.name, detailX, toPixelY(height, 0.31))
  ctx.font = `400 24px ${FONT}`
  ctx.fillStyle = '#9a938a'
  ctx.fillText(definition.blurb, detailX, toPixelY(height, 0.245))

  // For something you don't own yet there are no upgrade rows to read the numbers off, so
  // the stats go here — next to what you are currently holding, which is the comparison the
  // player is actually making.
  if (!ownsWeapon(save, definition.id)) {
    const stats = weaponStats(definition.id)
    ctx.font = `600 26px ${FONT}`
    ctx.fillStyle = '#e8e2d6'
    ctx.fillText(
      `Damage ${formatStat('damage', stats)}     Speed ${formatStat('rate', stats)}     Crit ${formatStat('crit', stats)}`,
      detailX,
      toPixelY(height, 0.15),
    )

    const main = save.equipped.main
    if (main && main !== definition.id) {
      const held = weaponStats(main, save.weapons[main]?.upgrades)
      ctx.font = `400 22px ${FONT}`
      ctx.fillStyle = '#8d8880'
      ctx.fillText(
        `Your ${WEAPONS[main].name}:  ${formatStat('damage', held)}  ·  ${formatStat('rate', held)}  ·  ${formatStat('crit', held)}`,
        detailX,
        toPixelY(height, 0.1),
      )
    }
  }

  for (const button of buttons) drawButton(ctx, width, height, button, save)

  // The message is a strip with its own background rather than floating text. Seen at an
  // angle — which is how anyone standing at a counter sees it — bare text near the bottom
  // edge reads as overlapping whatever is above it.
  if (feedback) {
    const stripHeight = 54
    const top = height - stripHeight - 14
    roundedRect(ctx, 22, top, width - 44, stripHeight, 10)
    ctx.fillStyle = feedback.ok ? 'rgba(60, 88, 46, 0.92)' : 'rgba(94, 46, 40, 0.92)'
    ctx.fill()
    ctx.textAlign = 'center'
    ctx.font = `600 27px ${FONT}`
    ctx.fillStyle = feedback.ok ? '#d6f0c4' : '#f5c2b8'
    ctx.fillText(feedback.text, width / 2, top + stripHeight / 2)
  }
}

function drawButton(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  button: ShopButton,
  save: SaveData,
): void {
  const style = STYLES[button.state]
  const x = toPixelX(width, button.rect.cx - button.rect.w / 2)
  const y = toPixelY(height, button.rect.cy + button.rect.h / 2)
  const w = button.rect.w * PIXELS_PER_METRE
  const h = button.rect.h * PIXELS_PER_METRE

  roundedRect(ctx, x, y, w, h, 12)
  ctx.fillStyle = style.fill
  ctx.fill()
  ctx.strokeStyle = style.border
  ctx.lineWidth = 2
  ctx.stroke()

  const padding = 18
  ctx.textBaseline = 'middle'

  // The price is measured first and the label is given whatever is left, condensing if it
  // has to. Weapon names are content and will get longer; a label that runs into its own
  // price is the kind of thing that only shows up when someone adds weapon eleven.
  let detailWidth = 0
  if (button.detail) {
    ctx.font = `600 26px ${FONT}`
    detailWidth = ctx.measureText(button.detail).width + 16
    ctx.textAlign = 'right'
    ctx.fillStyle = style.detail
    ctx.fillText(button.detail, x + w - padding, y + h / 2)
  }

  ctx.textAlign = 'left'
  ctx.font = `600 27px ${FONT}`
  ctx.fillStyle = style.text
  ctx.fillText(button.label, x + padding, y + h / 2, w - padding * 2 - detailWidth)

  // Pips for an upgrade track: how many levels are bought, out of how many exist. A price
  // alone doesn't tell you whether you are one purchase from the ceiling.
  if (button.action.kind === 'upgrade') {
    const { filled, total } = upgradePips(save, button.action.weapon, button.action.axis)
    const pipY = y + h - 12
    for (let i = 0; i < total; i++) {
      ctx.beginPath()
      ctx.arc(x + padding + 10 + i * 20, pipY, 5, 0, Math.PI * 2)
      ctx.fillStyle = i < filled ? '#ffd479' : '#3d3d46'
      ctx.fill()
    }
  }
}

/** Panel-local metres to canvas pixels. +x right, +y up, origin at the centre. */
function toPixelX(width: number, x: number): number {
  return width / 2 + x * PIXELS_PER_METRE
}

function toPixelY(height: number, y: number): number {
  return height / 2 - y * PIXELS_PER_METRE
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
