import { useEffect, useMemo, useRef } from 'react'
import { CanvasTexture, Group, LinearFilter, Mesh, SRGBColorSpace, Vector3 } from 'three'
import { SystemOrder } from '@/core/loop'
import { useFixedUpdate } from '@/core/simulation'
import { interactionState } from '@/systems/interaction'
import { useSettings, type Settings } from '@/systems/settings'
import {
  FOOTNOTE_CY,
  LABEL_X,
  RENDER_SCALE_NOTE,
  SETTINGS_PANEL_HEIGHT,
  SETTINGS_PANEL_WIDTH,
  VALUE_CX,
  applySettingsAction,
  settingsButtons,
  settingsRows,
  type SettingsButton,
  type SettingsButtonState,
} from '@/systems/settingsPanel'
import { syncPanelButtons, type PanelRegistration } from '@/ui/panelButtons'

/**
 * The settings board: comfort and render options, on a wall, in the world.
 *
 * It is beside the door on purpose. A player who cannot tolerate smooth locomotion cannot
 * play at all, and until this existed the only way to change that was the F2 dev panel —
 * DOM, desktop-only, stripped from production builds, and invisible the moment the headset
 * takes over the page. Which meant discovering you needed teleport, taking the headset off,
 * pressing a key, and putting it back on. The setting a player needs *because they feel ill*
 * cannot live behind taking the headset off.
 *
 * Same machinery as the shop: layout in `settingsPanel.ts`, one canvas texture, buttons
 * registered as the rectangles they are drawn as.
 */

const PIXELS_PER_METRE = 768

/** Matches the shop board — comfortable to read from where you stand, not overwhelming. */
const PANEL_SCALE = 0.72

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

const STYLES: Record<SettingsButtonState, { fill: string; border: string; text: string }> = {
  available: { fill: '#2b2f38', border: '#4a5262', text: '#e8e2d6' },
  // The chosen option, in the same green the shop uses for "already true".
  done: { fill: '#33422f', border: '#6f8f5f', text: '#eaf3e0' },
  locked: { fill: '#232329', border: '#32323a', text: '#6a6a72' },
}

interface SettingsBoardProps {
  position: [number, number, number]
  /** Yaw in radians. 0 faces +Z. */
  rotation?: number
}

export function SettingsBoard({ position, rotation = 0 }: SettingsBoardProps) {
  const group = useRef<Group>(null)
  const highlight = useRef<Mesh>(null)

  const surface = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(SETTINGS_PANEL_WIDTH * PIXELS_PER_METRE)
    canvas.height = Math.round(SETTINGS_PANEL_HEIGHT * PIXELS_PER_METRE)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas unavailable — cannot draw the settings board')
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    texture.generateMipmaps = false
    texture.minFilter = LinearFilter
    texture.magFilter = LinearFilter
    texture.anisotropy = 4
    return { canvas, ctx, texture }
  }, [])

  const registrations = useMemo(() => new Map<string, PanelRegistration>(), [])
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

  /** Press a button by id, reading the settings fresh — see `syncPanelButtons`. */
  const activate = useMemo(
    () => (id: string) => {
      const store = useSettings.getState()
      const button = settingsButtons(store).find((b) => b.id === id)
      if (!button) return
      const patch = applySettingsAction(store, button.action)
      for (const [key, value] of Object.entries(patch)) {
        store.set(key as keyof Settings, value as never)
      }
    },
    [],
  )

  useFixedUpdate(() => {
    const node = group.current
    if (!node) return

    const settings = useSettings.getState()
    const buttons = settingsButtons(settings)

    syncPanelButtons(
      node,
      registrations,
      buttons.map((b) => ({
        id: b.id,
        rect: b.rect,
        prompt: b.prompt,
        enabled: b.state !== 'locked',
      })),
      PANEL_SCALE,
      scratch,
      activate,
    )

    // The highlight is a quad that moves, not part of the drawing: pointing along a row of
    // steppers changes the focus several times a second, and re-rasterising a megapixel to
    // move a border is a hitch you can feel in a headset.
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

    const signature = [
      buttons.map((b) => `${b.id}:${b.state}`).join('|'),
      settingsRows(settings)
        .map((r) => r.value)
        .join('|'),
    ].join('~')
    if (signature === scratch.signature) return
    scratch.signature = signature

    draw(surface.ctx, surface.canvas, settings, buttons)
    surface.texture.needsUpdate = true
  }, SystemOrder.Effects)

  return (
    <group
      ref={group}
      position={position}
      rotation={[0, rotation, 0]}
      scale={PANEL_SCALE}
    >
      <mesh castShadow receiveShadow>
        <boxGeometry
          args={[SETTINGS_PANEL_WIDTH + 0.06, SETTINGS_PANEL_HEIGHT + 0.06, 0.04]}
        />
        <meshStandardMaterial color="#2a2118" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0, 0.021]}>
        <planeGeometry args={[SETTINGS_PANEL_WIDTH, SETTINGS_PANEL_HEIGHT]} />
        <meshBasicMaterial map={surface.texture} toneMapped={false} />
      </mesh>
      <mesh ref={highlight} visible={false}>
        <planeGeometry args={[1, 1]} />
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

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function draw(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  settings: Settings,
  buttons: SettingsButton[],
): void {
  const { width, height } = canvas
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#15141a'
  ctx.fillRect(0, 0, width, height)

  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.font = `600 40px ${FONT}`
  ctx.fillStyle = '#cfc4b0'
  ctx.fillText('COMFORT & DISPLAY', 30, 48)

  ctx.strokeStyle = '#3a3630'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(26, 82)
  ctx.lineTo(width - 26, 82)
  ctx.stroke()

  for (const row of settingsRows(settings)) {
    const y = toPixelY(height, row.cy)
    ctx.textAlign = 'left'
    ctx.font = `600 26px ${FONT}`
    ctx.fillStyle = '#c8c0b2'
    ctx.fillText(row.label, toPixelX(width, LABEL_X), y)

    if (!row.value) continue
    // The number lives between its own two steppers, so which pair changes it is never a
    // guess. Amber, like every other live value in the game.
    ctx.textAlign = 'center'
    ctx.font = `700 28px ${FONT}`
    ctx.fillStyle = row.deferred ? '#a2917a' : '#ffd479'
    ctx.fillText(row.value, toPixelX(width, VALUE_CX), y)
  }

  for (const button of buttons) drawButton(ctx, width, height, button)

  // Always on the board, because it is always true — see RENDER_SCALE_NOTE.
  ctx.textAlign = 'center'
  ctx.font = `400 21px ${FONT}`
  ctx.fillStyle = '#8d8880'
  ctx.fillText(RENDER_SCALE_NOTE, width / 2, toPixelY(height, FOOTNOTE_CY))
}

function drawButton(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  button: SettingsButton,
): void {
  const style = STYLES[button.state]
  const x = toPixelX(width, button.rect.cx - button.rect.w / 2)
  const y = toPixelY(height, button.rect.cy + button.rect.h / 2)
  const w = button.rect.w * PIXELS_PER_METRE
  const h = button.rect.h * PIXELS_PER_METRE

  roundedRect(ctx, x, y, w, h, 10)
  ctx.fillStyle = style.fill
  ctx.fill()
  ctx.strokeStyle = style.border
  ctx.lineWidth = 2
  ctx.stroke()

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `600 27px ${FONT}`
  ctx.fillStyle = style.text
  ctx.fillText(button.label, x + w / 2, y + h / 2, w - 20)
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
