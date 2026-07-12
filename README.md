# Claude Arcade

A deliberately barebones browser arcade: one static HTML page that lists games,
each game a self-contained static page under `games/<slug>/`. No framework, no
bundler, no build step — everything runs straight from the file tree.

The games are from-scratch rebuilds of classics, written by Claude as a
capability exercise. All code, textures, and sounds are original (procedurally
generated) — no third-party game assets.

## Run it

Just open `index.html` in a browser — every game works straight from the file
tree (classic scripts, no modules). A static server works too, and is the one
way to play Voxelcraft (the only game still built on ES modules):

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Test it

Every game ships a test suite in `games/<slug>/test/`: node-runnable logic
tests plus a headless-Chrome suite that plays the real UI over both `http://`
and `file://`.

```sh
node run-tests.mjs            # everything (needs google-chrome)
node run-tests.mjs --logic    # fast: logic/engine tests only
node run-tests.mjs wyrm fuse  # only the named games
```

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
| [Palisade](games/palisade/) | Strategy / tower defense | Waypoint-path TD: 4 towers with upgrades, first/last/nearest/strongest targeting, 20 scripted waves, 3 maps. |
| [Slipstream](games/slipstream/) | Arcade / racer | Pseudo-3D segment racer: accumulated-curve projection, centrifugal pull, traffic, checkpoint timer, 5 stages. |
| [Rootguard](games/rootguard/) | Strategy / lane defense | Lane defense: dew economy, seed-card cooldowns, 6 plants vs 5 blight types, per-lane root surges, 5 levels. |
| [Fernfoot](games/fernfoot/) | Platformer | Momentum platformer: variable jump, coyote time, jump buffering, stomps, power-ups, 6 levels with secrets. |
| [Dustkart](games/dustkart/) | Racing / kart | Kart racer: drift-charge boosts, launch window, position-weighted items, rubberband AI, 3 circuits. |

## Mobile

Each game is tagged `mobile: true|false` in `games/manifest.js`. The shell shows
a **📱 Mobile / 🖥 Desktop** badge on every card and a filter to show only the
games that play on a phone; on a small touch device it defaults to the mobile
list. Mobile-tagged games take touch input and are laid out to work on a phone;
desktop-tagged games need a keyboard, mouse-look, or precise pointing.

## In-game rules & player ideas

Every game page loads a small shared widget (`games/_common/arcade-widget.js`,
Shadow-DOM isolated so it can't clash with a game's CSS):

- **? Rules** — opens that game's how-to-play at any time, not just on the start
  screen (it clones the game's existing controls text).
- **★ Ideas** — a structured suggestion form plus a roadmap of accepted ideas.

The roadmap is read client-side from the project's **public** GitLab issues API
(no token). Submissions go through a serverless worker that holds the token and
files a triage issue — see [`serverless/`](serverless/). The whole pipeline is
optional: until `feedbackEndpoint` is set in `games/_common/arcade-config.js`,
the form opens but explains it isn't wired up, and nothing calls the network on
page load.

```
player → ★ Ideas form → serverless worker (holds token)
       → GitLab issue (suggestion, needs-triage, type::*, game::<slug>)
you triage → relabel `accepted` → shows on the arcade + game-page roadmap
```

Games with mouse-look (**gloamkeep**, **voxelcraft**) expose a **mouse
sensitivity** slider on their start/pause screens, persisted per game.

## Structure

```
index.html                arcade shell (lists + filters games, ideas widget)
games/manifest.js          game registry the shell reads (incl. mobile flags)
games/_common/             shared, game-agnostic bits (config + ideas/rules widget)
games/<slug>/              each game, fully self-contained
serverless/                feedback intake worker (files GitLab issues) + its tests
```

## Adding a game

1. Create `games/<slug>/index.html` (plus whatever the game needs).
2. Add an entry to `games/manifest.js` (including `mobile: true|false`).
3. Before `</body>`, load the shared widget so the game gets the rules + ideas
   buttons:
   ```html
   <script src="../_common/arcade-config.js"></script>
   <script src="../_common/arcade-widget.js"></script>
   <script>
     ArcadeWidget.init({ slug: "<slug>", title: "<Title>", rulesSelector: "<your controls element>" });
   </script>
   ```

That's the whole integration surface.
