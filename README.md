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
| [Bulwark](games/bulwark/) | Arcade / shooter | Fixed shooter: lockstep fleet that sprints as it thins, one-bullet limit, per-pixel shield erosion, mystery saucer. |
| [Patience](games/patience/) | Cards / solitaire | Klondike: draw-1/draw-3, run drag & drop, full undo, auto-complete, seeded shareable deals, cascade win physics. |
| [Reversi](games/reversi/) | Board / strategy | Disc-flipping strategy vs 3 AI tiers (greedy, positional, alpha-beta + endgame solve in a worker) or hotseat. |
| [Quarry](games/quarry/) | Puzzle / falling-block | Pentomino faller (12 five-cell stones, 12×24 pit): lock delay, original kicks, bag randomizer, DAS, ghost piece. |
| [Lamplighter](games/lamplighter/) | Arcade / maze | Maze-chase: light lanterns while 4 gloams with distinct pursuit AIs hunt you; braziers flip the chase; procedural mazes. |
| [Chess](games/chess/) | Board / strategy | Full rules + perft-verified engine: negamax, quiescence, TT/killers, 3 strengths in a Web Worker, SAN list, FEN I/O. |
| [Delve](games/delve/) | RPG / roguelike | Turn-based roguelike: shadowcasting FOV, energy scheduler, persistent floors, permadeath saves, 9 depths to the artifact. |
| [Gloamkeep](games/gloamkeep/) | FPS / raycaster | Software raycaster: DDA columns, textured walls, z-buffered sprites, sliding doors, secret push-walls, 3 floors. |

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
