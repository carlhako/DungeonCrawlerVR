# Enemy models — what to download, and what to call it

This folder is empty on purpose, and the game runs perfectly well with it empty: every enemy
falls back to the primitive body it has had since Sprint 2.3. Dropping the files below in is
what turns three capsules into three creatures. Nothing else has to change — no rebuild step,
no import, no code edit.

**Licence: CC0.** Quaternius releases everything into the public domain. No account, no
attribution requirement, no licence file to ship. That is the whole reason this kit was chosen
over the better-looking paid ones, and it is why nothing here is committed to the repository —
fetching an asset pack is a deliberate decision, not something a sprint does on your behalf.

## Where to get it

<https://quaternius.com/> → the **Ultimate Monsters** pack (and, if the goblin in it does not
convince, **RPG Characters** has a better one). Download the **glTF/GLB** version, not the FBX
or the .blend.

## What to call it

Three files, in this folder, with these exact names:

| File | Enemy | Drawn height |
| --- | --- | --- |
| `goblin-skulker.glb` | Goblin Skulker | 1.2 m |
| `skeleton-warrior.glb` | Skeleton Warrior | 1.85 m |
| `wraith.glb` | Wraith | 1.9 m |

Any one of them can be missing. A file that is not here is not an error — that enemy draws its
capsule and everything else carries on, which is also what happens on a connection bad enough to
drop the fetch.

## What the game does with them

- **It rescales them.** A kit's export scale is an accident; the heights in the table above are
  what the game's readability was tuned against, and `src/data/enemies.ts` carries each model's
  measured `sourceHeight` so it can be corrected. **If a creature comes out the wrong size, that
  number is the one to fix** — measure the model floor-to-head in Blender and put it there.
- **It finds the clips by name, tolerantly.** `Attack`, `attack` and
  `CharacterArmature|Sword_Attack` are all the same clip as far as `matchClip` is concerned. The
  names it looks for are listed per enemy in `src/data/enemies.ts`; add to those lists rather
  than renaming clips in the file.
- **It fits animations to the AI's timing, not the other way round.** A wind-up clip is stretched
  or compressed to the enemy's `telegraph` exactly, so the model is furthest back at the moment
  the blow commits. No AI decision waits on an animation.
- **It keeps the kit's own textures** and speaks the enemy's state through emissive — the hit
  flash, the burn tint, the chill tint and the wind-up glow.
- **A phase with no clip is fine.** The lean, the walk bob and the halo are applied above the
  model and are always on, so a kit with no stagger animation still visibly flinches.

## If a model does not show up

Open the browser console and read `__DCVR__.models`. It reports, per file, whether it loaded,
what the URL was, what went wrong, and — when it loaded — every clip name inside it. All three
failure modes look identical on screen (you get a capsule), and this is what tells them apart:

```js
__DCVR__.models
```

- `status: 'missing'`, error `404` — wrong folder or wrong filename.
- `status: 'ready'` but the creature stands still — the kit's clip names are not in the
  candidate lists. `clips` in that readout is the actual list; copy the right names into
  `src/data/enemies.ts`.

## Checking the plumbing without downloading anything

There is a fixture generator for exactly this — a two-bone skinned box carrying the four clips a
Quaternius character ships with:

```bash
node scripts/makeModelFixture.mjs public/models/skeleton-warrior.glb
```

Reload, walk into a wave, and the skeleton should be a box that leans into its wind-up, flashes
white when hit and dissolves when killed. That proves the loader, the clone, the skeleton, the
mixer, the clip plan and the material injection all work; the only thing left for the real pack
to get wrong is looking like a skeleton. Delete the file afterwards — `*.glb` here is gitignored,
so nothing else needs undoing.

## Facing and floor

If a model comes in facing backwards, set `yawOffset: Math.PI` on its spec in
`src/data/enemies.ts`. If it sinks into or floats above the floor, set `yOffset`. The Wraith
already has a small positive `yOffset` deliberately — it comes through walls and should not look
like it is walking.
