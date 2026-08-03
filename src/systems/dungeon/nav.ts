import { Tile, type Cell, type DungeonMap } from './generate'

/**
 * The navigation bake: where things can walk, and how they get there.
 *
 * Baked once when a dungeon is generated rather than queried against physics every frame.
 * Sprint 2.3 will have a dozen enemies asking "how do I get to the player?" several times a
 * second, and a raycast-based answer to that costs more than everything else in the frame
 * put together on a Quest.
 *
 * Eight-way movement, because four-way pathing makes enemies walk in visible staircases and
 * nothing alive moves like that. Diagonals are only allowed when *both* orthogonal cells
 * beside them are open, so a hound cannot squeeze through the corner where two walls meet —
 * which looks, from inside a headset, exactly like it walked through a wall.
 */

export interface NavGrid {
  width: number
  height: number
  /** 1 where a body may stand, 0 otherwise. */
  walkable: Uint8Array
}

export function bakeNav(map: DungeonMap): NavGrid {
  const walkable = new Uint8Array(map.width * map.height)
  for (let i = 0; i < map.tiles.length; i++) {
    walkable[i] = map.tiles[i] === Tile.Floor ? 1 : 0
  }
  return { width: map.width, height: map.height, walkable }
}

export function isOpen(nav: NavGrid, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= nav.width || y >= nav.height) return false
  return nav.walkable[y * nav.width + x] === 1
}

/** Straight, diagonal. Diagonals cost √2 so a path doesn't prefer a zigzag to a straight line. */
const STEPS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
]

/**
 * A* from one cell to another. Empty when there is no route.
 *
 * The returned path includes both ends, and every step is to a neighbouring cell — the
 * caller can walk it without checking anything. An empty array is a real answer ("nowhere to
 * go"), which the caller must handle: an enemy that cannot reach the player should give up
 * and idle, not walk into a wall forever.
 */
export function findPath(nav: NavGrid, from: Cell, to: Cell): Cell[] {
  const { width, height } = nav
  if (!isOpen(nav, from.x, from.y) || !isOpen(nav, to.x, to.y)) return []

  const start = from.y * width + from.x
  const goal = to.y * width + to.x
  if (start === goal) return [{ ...from }]

  const cost = new Float32Array(width * height).fill(Infinity)
  const cameFrom = new Int32Array(width * height).fill(-1)
  cost[start] = 0

  // A binary heap would be faster; a sorted insert over a small open set is plenty for a
  // 40x40 grid and much easier to be sure of. Revisit if the grids get big.
  const open: Array<{ index: number; estimate: number }> = [
    { index: start, estimate: heuristic(from, to) },
  ]

  while (open.length > 0) {
    const current = open.shift() as { index: number; estimate: number }
    if (current.index === goal) return retrace(cameFrom, start, goal, width)

    const x = current.index % width
    const y = (current.index - x) / width

    for (const [dx, dy, step] of STEPS) {
      const nx = x + dx
      const ny = y + dy
      if (!isOpen(nav, nx, ny)) continue
      // No cutting corners: a diagonal needs both of its orthogonal neighbours open.
      if (dx !== 0 && dy !== 0 && (!isOpen(nav, x + dx, y) || !isOpen(nav, x, y + dy))) continue

      const next = ny * width + nx
      const nextCost = (cost[current.index] as number) + step
      if (nextCost >= (cost[next] as number)) continue

      cost[next] = nextCost
      cameFrom[next] = current.index
      const estimate = nextCost + heuristic({ x: nx, y: ny }, to)
      const at = open.findIndex((entry) => entry.estimate > estimate)
      const entry = { index: next, estimate }
      if (at === -1) open.push(entry)
      else open.splice(at, 0, entry)
    }
  }

  return []
}

/** Octile distance: the exact cost of an unobstructed 8-way walk, so A* stays admissible. */
function heuristic(a: Cell, b: Cell): number {
  const dx = Math.abs(a.x - b.x)
  const dy = Math.abs(a.y - b.y)
  return dx + dy - (2 - Math.SQRT2) * Math.min(dx, dy)
}

function retrace(cameFrom: Int32Array, start: number, goal: number, width: number): Cell[] {
  const path: Cell[] = []
  let index = goal
  while (index !== -1) {
    const x = index % width
    path.push({ x, y: (index - x) / width })
    if (index === start) break
    index = cameFrom[index] as number
  }
  return path.reverse()
}

/**
 * Can `from` see `to` across open floor?
 *
 * Aggro asks this before it wakes anything up, and it is the difference between a dungeon
 * that has things living in it and a dungeon wired with trip-wires. Something that charges
 * you through two walls because you came within eleven metres of it is not hunting you — and
 * the player, who cannot see it happen, only learns that the level reacts to their position
 * rather than to their presence.
 *
 * A supercover walk: every cell the line between the two centres passes through is tested,
 * including both cells it clips when it crosses a corner exactly. That last case is why this
 * is not the obvious Bresenham loop — a diagonal squeezing between two wall corners is a
 * sightline through solid rock, and it is the same corner-cutting rule `findPath` refuses.
 */
export function hasLineOfSight(nav: NavGrid, from: Cell, to: Cell): boolean {
  let x = from.x
  let y = from.y
  if (!isOpen(nav, x, y)) return false

  const stepX = Math.sign(to.x - from.x)
  const stepY = Math.sign(to.y - from.y)
  let ax = Math.abs(to.x - from.x)
  let ay = Math.abs(to.y - from.y)

  let steps = ax + ay
  let error = ax - ay
  ax *= 2
  ay *= 2

  while (steps > 0) {
    if (error > 0) {
      x += stepX
      error -= ay
    } else if (error < 0) {
      y += stepY
      error += ax
    } else {
      // Dead through the corner. Both cells beside it have to be open, or the line is
      // threading a gap that nothing can see through.
      if (!isOpen(nav, x + stepX, y) || !isOpen(nav, x, y + stepY)) return false
      x += stepX
      y += stepY
      error += ax - ay
      steps -= 1
    }
    steps -= 1
    if (!isOpen(nav, x, y)) return false
  }

  return true
}

/**
 * The nearest cell a body may stand in, searched outwards.
 *
 * Physics puts things where physics puts them, and a body resting a few centimetres inside a
 * wall is a body whose cell is solid. Without this, one nudge from a collider would leave an
 * enemy unable to path anywhere at all.
 */
export function nearestOpen(nav: NavGrid, from: Cell, maxRadius = 6): Cell | null {
  if (isOpen(nav, from.x, from.y)) return { ...from }
  for (let radius = 1; radius <= maxRadius; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        // The ring only, not the filled square: inner cells were checked on earlier passes.
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue
        if (isOpen(nav, from.x + dx, from.y + dy)) return { x: from.x + dx, y: from.y + dy }
      }
    }
  }
  return null
}
