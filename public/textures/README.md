# Wall texture — what to download, and what to call it

This folder is empty on purpose, and the game runs perfectly well with it empty: walls draw as
the flat stone colour they've had since Sprint 1.1. Dropping the three files below in is what
turns that into stone. Nothing else has to change — no rebuild step, no import, no code edit.

**Licence: CC0.** [ambientCG](https://ambientcg.com/) releases everything into the public
domain — no account, no attribution requirement. Same reason the enemy pack is CC0 too (see
`public/models/README.md`): nothing here is committed to the repository, because fetching a
texture is a deliberate decision, not something a sprint does on your behalf.

## Where to get it

**Bricks096** — "dark grey medieval stones", a good match for a torch-lit dungeon:

- <https://ambientcg.com/a/Bricks096>
- Download the **1K-JPG** package: <https://ambientcg.com/get?file=Bricks096_1K-JPG.zip>

Anything else CC0 and stone-ish from ambientCG or [3dtextures.me](https://3dtextures.me/) works
just as well — nothing checks which texture is inside, only that the three files below exist.
If Bricks096 reads too clean, **Bricks089** (also dark medieval brick) is a rougher alternative
on the same site.

## What to call it

Three files, in this folder, with these exact names. The zip's filenames are close to this
already — rename, don't re-export:

| File | From the zip |
| --- | --- |
| `stone-diffuse.jpg` | `Bricks096_1K-JPG_Color.jpg` |
| `stone-normal.jpg` | `Bricks096_1K-JPG_NormalGL.jpg` (the **GL** variant, not DX — see below) |
| `stone-roughness.jpg` | `Bricks096_1K-JPG_Roughness.jpg` |

The zip also has an `AmbientOcclusion.jpg` and a `Displacement.jpg`; neither is used yet. Any
one of the three required files can be missing — a partial set is treated the same as no set,
and walls fall back to flat colour, rather than showing a stone colour with plastic-looking
lighting because the roughness map didn't make it.

## Normal map convention: GL, not DX

Three.js expects OpenGL-convention normal maps (green channel points up). ambientCG ships both;
the file with `NormalGL` in its name is the right one. Using the `NormalDX` variant by mistake
doesn't error — it just makes the mortar lines look inverted, like the grooves are bumps.

## What the game does with it

- **It tiles per metre, not per wall.** A dungeon cell and the foyer's ten-metre back wall would
  otherwise show the same single tile stretched to wildly different sizes, since a box's UVs run
  0–1 per face regardless of that face's real dimensions. `useTiledWallMaterial` in
  `src/systems/environment/textures.ts` clones the base maps per wall size and re-tiles them so
  the stone reads the same texel size everywhere.
- **It only touches walls.** Floor and ceiling keep their flat colour for now — this is the
  answer to "the walls look the same", not a full material pass.

## If it does not show up

Open the browser console and read `__DCVR__.textures`. `status: 'missing'` and an `error` field
say why — almost always a 404, which means one of the three filenames above doesn't match what's
in this folder.

```js
__DCVR__.textures
```
