# Claude Arcade

A deliberately barebones browser arcade: one static HTML page that lists games,
each game a self-contained static page under `games/<slug>/`. No framework, no
bundler, no build step — everything runs straight from the file tree.

The games are from-scratch rebuilds of classics, written by Claude as a
capability exercise. All code, textures, and sounds are original (procedurally
generated) — no third-party game assets.

## Run it

Any static file server works:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

(A server is needed because the games use ES modules; opening `index.html`
directly via `file://` only works for the arcade shell itself.)

## Games

| Game | Genre | Notes |
| --- | --- | --- |
| [Voxelcraft](games/voxelcraft/) | Sandbox / voxel | A voxel sandbox in the Upturn: infinite procedural terrain, biomes, caves, trees, day/night, block building, saving. Three.js via CDN. |

## Structure

```
index.html          arcade shell (lists games)
games/manifest.js   game registry the shell reads
games/<slug>/       each game, fully self-contained
```

## Adding a game

1. Create `games/<slug>/index.html` (plus whatever the game needs).
2. Add an entry to `games/manifest.js`.

That's the whole integration surface.
