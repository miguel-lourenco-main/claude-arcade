# Crateshift

A push-the-crates puzzle for the Claude Arcade. You are a dockworker on the
night shift: shove every crate onto its marked pad in as few moves as you can.
Crates can only be pushed — never pulled — and only one at a time.

**21 original levels**, all designed for this game and verified solvable by an
exhaustive breadth-first solver before shipping. The set ramps from single
pushes and corner awareness through corridors into multi-crate ordering
puzzles.

## Controls

| Key | Action |
| --- | --- |
| Arrows / WASD | Move (hold to repeat: ~200 ms delay, then one step per ~110 ms) |
| U / Z | Undo (full history, hold for OS key-repeat) |
| R | Restart level |
| N / P | Next / previous unlocked level |
| Esc | Back to level select |
| Enter | (level select) play · (win screen) next level |
| M | Toggle sound |

## Rules & feel

- A push moves **exactly one crate**, and only when the cell beyond it is
  free. Two crates in a row never budge; nothing can be pulled.
- A crate resting in a **non-target corner** turns red — it can never reach a
  pad again (simple static corner detection), so undo or restart.
- Logic is instant; a short (~110 ms) eased tween animates each step.
- Crates glow amber once they sit on a pad.

## Scoring

- **Moves** and **pushes** are both counted; the per-level best (fewest moves)
  is persisted.
- **Stars**: 3 for finishing at or under par, 2 within 1.6× par, 1 for any
  finish. Par is the solver-verified minimum move count (for the finale
  "Last Shift", the replayed length of a push-optimal solution).
- Finishing a level unlocks the next one.

## Architecture

- `index.html` — shell: level-select view + play view, HUD, overlays.
- `levels.js` — the level set as ASCII maps (`#` wall, `.` pad, `$` crate,
  `@` worker, `*`/`+` on-pad variants) with verified `par`/`parPushes`.
- `logic.js` — the pure rules, dependency-free and dual-environment (browser
  global `CrateLogic`, `module.exports` under node for the tests):
  - **State**: parsed grid (walls / pads / interior floor via flood fill from
    the worker), crate list, full undo history of
    `(player pos, crate from→to)` tuples. Counters derive from the history.
- `game.js` — everything else:
  - **Input**: keyboard only; held-direction repeat is timestamped
    (frame-rate independent), and held keys are dropped on window blur.
  - **Rendering**: one canvas, everything drawn procedurally each frame
    (hash-varied plank floor, beveled walls, dashed glowing pads, wooden
    crates, the worker). Rendering interpolates; logic never waits for it.
    There is no tick-rate-dependent simulation, so no fixed-timestep loop is
    needed.
  - **Audio**: Web Audio blips/noise bursts synthesized on the fly; the
    AudioContext is only created after a user gesture, and the toggle is
    persisted.
- `localStorage` keys are namespaced `arcade.crateshift.*`
  (`best.<n>`, `level`, `audio`).
- `test/` — committed suite: `logic.test.js` (pure rules under node,
  including a BFS solver that re-verifies `par` on every tractable level) and
  `browser.test.mjs` (headless-Chrome CDP run of every feature above, over
  both http:// and file://). See `test/README.md`.

Level validation tooling (BFS move-optimal solver with dead-square pruning,
plus a push-optimal solver with player-region normalization for the finale)
was used during development and is intentionally not shipped.
