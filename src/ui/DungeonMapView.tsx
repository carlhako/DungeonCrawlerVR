import { useEffect, useRef } from 'react'
import { Tile } from '@/systems/dungeon/generate'
import { useDungeon, worldToPlacedCell } from '@/systems/dungeon/store'
import { playerState } from '@/systems/player'

/**
 * Top-down debug map, on `F3`.
 *
 * A dungeon you can only inspect by walking around inside it in the dark is a dungeon whose
 * bugs you find slowly and describe badly. This draws the whole grid at once — rooms,
 * corridors, torches, spawn points, and where the player currently is — so "seed 4 has a
 * room you can see into and never enter" is a glance rather than an expedition.
 *
 * DOM, not world-space, and dev-only. It is the one piece of UI in the game that is
 * deliberately *not* diegetic: it is scaffolding for whoever is building the level
 * generator, and it must never appear in a headset.
 */

const SCALE = 5
const COLOURS = {
  floor: '#3a3630',
  wall: '#17161a',
  entry: '#6fdc8c',
  torch: '#ff9d4a',
  spawn: '#c2705f',
  player: '#ffd479',
}

export function DungeonMapView({ visible }: { visible: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const map = useDungeon((state) => state.map)
  const offset = useDungeon((state) => state.offset)
  const nav = useDungeon((state) => state.nav)

  useEffect(() => {
    if (!visible || !map || !offset || !nav) return
    const node = canvas.current
    const ctx = node?.getContext('2d')
    if (!node || !ctx) return

    node.width = map.width * SCALE
    node.height = map.height * SCALE

    // The static half is drawn once into an offscreen canvas; only the player marker moves,
    // and re-rasterising a whole grid sixty times a second to move one dot is silly.
    const base = document.createElement('canvas')
    base.width = node.width
    base.height = node.height
    const baseCtx = base.getContext('2d')
    if (!baseCtx) return

    baseCtx.fillStyle = '#0b0b10'
    baseCtx.fillRect(0, 0, base.width, base.height)
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const tile = map.tiles[y * map.width + x]
        if (tile === Tile.Rock) continue
        baseCtx.fillStyle = tile === Tile.Floor ? COLOURS.floor : COLOURS.wall
        baseCtx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE)
      }
    }
    // Only the first few spawns: all of them is every floor cell in the level, which tells
    // you nothing. The far end of the list is where a wave starts filling from.
    baseCtx.fillStyle = COLOURS.spawn
    for (const spawn of map.spawns.slice(0, 40)) {
      baseCtx.fillRect(spawn.x * SCALE + 1, spawn.y * SCALE + 1, SCALE - 2, SCALE - 2)
    }
    baseCtx.fillStyle = COLOURS.torch
    for (const torch of map.torches) {
      baseCtx.fillRect(torch.x * SCALE + 1, torch.y * SCALE + 1, SCALE - 2, SCALE - 2)
    }
    baseCtx.fillStyle = COLOURS.entry
    baseCtx.fillRect(map.entry.x * SCALE, map.entry.y * SCALE, SCALE, SCALE)
    baseCtx.fillRect(map.mouth.x * SCALE, map.mouth.y * SCALE, SCALE, SCALE)

    let running = true
    const frame = () => {
      if (!running) return
      ctx.drawImage(base, 0, 0)
      const cell = worldToPlacedCell(
        { map, offset, nav },
        playerState.position.x,
        playerState.position.z,
      )
      ctx.fillStyle = COLOURS.player
      ctx.beginPath()
      ctx.arc((cell.x + 0.5) * SCALE, (cell.y + 0.5) * SCALE, SCALE * 0.8, 0, Math.PI * 2)
      ctx.fill()
      requestAnimationFrame(frame)
    }
    frame()
    return () => {
      running = false
    }
  }, [visible, map, offset, nav])

  if (!visible) return null

  return (
    <div className="dungeon-map">
      {map ? (
        <>
          <canvas ref={canvas} />
          <p>
            seed {map.seed} · {map.rooms.length} rooms · {map.torches.length} torches
          </p>
        </>
      ) : (
        <p>No dungeon — open the door.</p>
      )}
    </div>
  )
}
