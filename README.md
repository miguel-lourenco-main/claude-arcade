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
| [Wyrm](games/wyrm/) | Arcade / grid | Snake rebuilt: buffered turns, tail-vacate movement, speed ramp, interpolated glow rendering. |
| [Fuse](games/fuse/) | Puzzle / sliding | Slide-and-merge doubling tiles: merge-locking, animated slides, one-step undo, state survives reload. |
| [Dowser](games/dowser/) | Puzzle / logic | Minesweeper rebuilt: safe first dig, flood fill, chording, three presets, best times. |
| [Brickstorm](games/brickstorm/) | Arcade / paddle | Brick breaker: positional paddle bounce, speed ramps, side-resolved collisions, power-ups, procedural levels. |
| [Mothlight](games/mothlight/) | Arcade / one-button | One-button flight: impulse flaps, forgiving hitbox, parallax night, reachability-clamped gaps. |
| [Softfall](games/softfall/) | Arcade / physics | Lander: nose-vector thrust, strict touchdown gate, midpoint-displacement terrain, multiplier pads. |
| [Shardfield](games/shardfield/) | Arcade / space | Inertial vector shooter: frictionless glide, 4-bullet cap, splitting shards, two saucer types, wrap-seam rendering. |
| [Crateshift](games/crateshift/) | Puzzle / box-pusher | 21 original solver-verified crate puzzles: push-only movement, full undo, corner-deadlock hints, star ratings. |
| [Gemgrove](games/gemgrove/) | Puzzle / match-3 | Swap-adjacent match-3: cascade multipliers, cross/burst specials, no-match reverts, idle hints, move-limited levels. |

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
