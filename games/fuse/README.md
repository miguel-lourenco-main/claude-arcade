# Fuse

A from-scratch 4x4 slide-and-merge doubling puzzle for the Claude Arcade.
Slide the grid; equal tiles fuse into their doubled value. Reach the 2048
tile to win, then keep going if you dare. Original code, visuals, and name —
no assets copied from anywhere.

## Controls

- **Arrows / WASD** — slide the whole grid
- **Swipe** — same thing on touch (24px threshold)
- **Z / U** — undo one move (single snapshot; works out of a game over too)
- **R / N** — new game (also Space/Enter on the game-over banner)
- **M** — toggle sound

## Rules (the details that matter)

- Each row/column is processed **from the destination edge**: tiles slide,
  and the pair nearest that edge merges first. A tile created by a merge is
  **merge-locked** for the rest of that move, so `4 2 2 →left` gives `4 4`,
  never `8`.
- A move is legal only if at least one tile slides or merges. Illegal moves
  spawn nothing (and play a low "deny" thud).
- After every legal move one tile spawns in a random empty cell:
  **2 (90%) / 4 (10%)**.
- Game over when there is no empty cell **and** no equal adjacent pair.
- A win banner appears the first time a 2048 tile is fused, with a
  **Keep going** option.

## Architecture

- `src/logic.js` — the pure logic grid. No DOM, no timers. `Game.move(dir)`
  returns a result object (`absorbed`, `merged`, `spawned`, `gained`, flags)
  that the renderer consumes. Undo is a single pre-move snapshot
  (`serialize()`/`restore()`), taken only when a move turns out to be legal.
- `src/main.js` — the animation layer. Tiles are absolutely-positioned DOM
  nodes keyed by tile id; position is a CSS `transform` driven by `--r`/`--c`
  custom properties with a ~100ms transition. Scale effects (spawn, merge
  pop) run on an inner element so they never fight the slide transform.
  Merge cleanup / value pop / spawn happen in a "finish" step after the
  slide; a `flush()` runs it early if input arrives mid-animation, so rapid
  play never drops a move.
- `src/audio.js` — a tiny Web Audio synth (oscillator + gain envelope
  blips). The AudioContext is created/resumed only from user gestures, and
  the toggle is respected before any node is created.
- The game is turn-based with no continuous simulation, so nothing depends
  on tick rate — no fixed-timestep loop is needed; animation is pure CSS.

## Persistence (`localStorage`)

- `arcade.fuse.best` — best score
- `arcade.fuse.state` — current board + score + the undo snapshot
  (a game in progress survives a reload)
- `arcade.fuse.audio` — sound on/off
