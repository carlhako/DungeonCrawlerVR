import { generate, Tile, validate } from './src/systems/dungeon/generate'
for (const seed of [1, 4]) {
  const m = generate(seed)
  const v = validate(m)
  console.log(`seed ${m.seed}: ${m.rooms.length} rooms, ${v.floorCells} floor, ${m.torches.length} torches, ${m.spawns.length} spawns`)
  let out = ''
  for (let y = 0; y < m.height; y++) {
    let row = ''
    for (let x = 0; x < m.width; x++) {
      const t = m.tiles[y * m.width + x]
      if (x === m.entry.x && y === m.entry.y) row += 'E'
      else if (m.torches.some((tt) => tt.x === x && tt.y === y)) row += 'i'
      else row += t === Tile.Floor ? '.' : t === Tile.Wall ? '#' : ' '
    }
    out += row + '\n'
  }
  console.log(out)
}
