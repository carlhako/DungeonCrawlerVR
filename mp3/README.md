# Music — where these came from

Twenty tracks, generated with **MiniMax AI** on 2026-08-05. Not licensed stock, not composed by
hand, and not recorded from anything: they came out of a text-to-music model, one prompt per
file, and the filenames are the prompts in short form.

Recorded here rather than left implicit because provenance on generated audio is the thing
nobody can reconstruct later. Six months from now "where is this from, and can it ship?" is a
question only this file can answer, and the answer wants to be found next to the files rather
than in a commit message nobody will think to look for.

## What is here

| Folder | Tracks | For |
| --- | --- | --- |
| `lobby/` | 10 | The foyer — the safe room. Sprint 3.3's "light, non-scary ambience that says you are not in the dungeon anymore" |
| `battle/` | 10 | The dungeon and its waves. Sprint 3.4's gameplay bed |

Nothing in the game reads this folder yet. Audio arrives in **Sprint 3.2** (the engine: HRTF
panning, pooled voices, per-bus volume), and the music that sits on top of it in **3.3** (foyer)
and **3.4** (dungeon). These are the candidates to pick from when those sprints land, not a
finished soundtrack — expect most of them not to make it.

## Before any of this ships

- **Pick, then trim.** 190 MB of raw MP3 for twenty tracks, several of them 17 MB, is far more
  than a browser game should download. Whichever survive want re-encoding to something much
  smaller — the loop is background ambience under torch crackle and combat, not something a
  player listens to closely.
- **Move the survivors to `public/`.** Anything the game fetches has to be served, and only
  `public/` is. This folder is the library; `public/audio/` will be the shipped set.
- **Check the terms.** Generated audio's commercial-use position depends on the generator's
  terms at the time of generation, and this game is not free of that question just because a
  model produced the file. Worth settling before 4.5 rather than at it.

Unlike the enemy models and wall textures — which are CC0 downloads, gitignored, and fetchable
again in a minute (see `public/models/README.md`) — these cannot be re-fetched: the same prompt
does not produce the same track twice. That is why they are committed despite the weight.
