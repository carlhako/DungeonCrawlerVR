import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three'

/**
 * Text as a texture, drawn on a 2D canvas at runtime.
 *
 * Every in-game label goes through here rather than through an SDF text library, for one
 * blunt reason: those libraries fetch a default font from a CDN on first use. A dungeon that
 * silently loses all its text on a flaky hotel wifi — or on a Quest that has lost its
 * connection mid-session — is not a trade worth making for nicer kerning. The browser
 * already has fonts; this uses them.
 *
 * Fine for prompts, signs and shop panels. When something needs text that scales smoothly
 * from 10cm to arm's length (Sprint 1.3's shop is the first candidate) this is the thing to
 * revisit, with a font file committed to the repo rather than fetched.
 */

export interface LabelOptions {
  /** Pixels of texture per line of text. Larger reads more crisply up close. */
  fontSize?: number
  colour?: string
  background?: string
  /** Padding around the text, in the same pixel units as `fontSize`. */
  padding?: number
  font?: string
}

export interface Label {
  texture: CanvasTexture
  /** Texture dimensions in pixels, so a caller can size a quad without distorting the text. */
  width: number
  height: number
  /** width / height. Multiply by the plane's height to get its width. */
  aspect: number
  dispose: () => void
}

const DEFAULT_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

/**
 * Draw one line of text into a texture.
 *
 * The canvas is sized to the measured text rather than to a fixed power of two: these are
 * small, short-lived, and mip-mapping is off anyway (see below), so the usual reasons to
 * round up don't apply.
 */
export function createLabel(text: string, options: LabelOptions = {}): Label {
  const {
    fontSize = 64,
    colour = '#f4ead8',
    background = 'rgba(10, 9, 12, 0.72)',
    padding = 28,
    font = DEFAULT_FONT,
  } = options

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable — cannot rasterise label text')

  const fontSpec = `600 ${fontSize}px ${font}`
  ctx.font = fontSpec
  const measured = ctx.measureText(text)
  const width = Math.ceil(measured.width + padding * 2)
  const height = Math.ceil(fontSize * 1.4 + padding * 2)

  canvas.width = width
  canvas.height = height

  // Re-set after resizing: changing canvas dimensions resets the whole 2D context state.
  ctx.font = fontSpec
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'

  if (background !== 'none') {
    ctx.fillStyle = background
    roundedRect(ctx, 0, 0, width, height, Math.min(height / 2, 24))
    ctx.fill()
  }

  ctx.fillStyle = colour
  ctx.fillText(text, width / 2, height / 2)

  const texture = new CanvasTexture(canvas)
  // The label is emissive and read at a glance; sRGB keeps it from looking washed out under
  // tone mapping.
  texture.colorSpace = SRGBColorSpace
  // No mipmaps: these are viewed roughly head-on at a roughly known distance, and mip
  // selection on a billboarded quad at a grazing angle blurs text that should stay sharp.
  texture.generateMipmaps = false
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.anisotropy = 4

  return {
    texture,
    width,
    height,
    aspect: width / height,
    dispose: () => texture.dispose(),
  }
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
