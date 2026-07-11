# Wyrm

A from-scratch grid snake for the Claude Arcade. Eat embers, grow, don't bite
yourself or the walls. The board speeds up as the wyrm lengthens.

## Controls

- **Arrows / WASD** — steer (any direction key also starts the run)
- **P / Esc** — pause and resume (auto-pauses when the window loses focus)
- **M** — toggle sound
- **Any key** — instant restart after death

## Scoring

Each ember is worth 10 points plus a small bonus that scales with the current
tick speed — the faster the wyrm, the more each bite pays. Best score persists
in `localStorage` under `arcade.wyrm.best`.

## Architecture

Vanilla JS, no dependencies, no build step. Pure grid rules live in
`logic.js` (dual-environment: `window.WyrmLogic` in the browser,
`module.exports` under node, so the test suite runs the exact game rules);
everything DOM/canvas/audio lives in `game.js`.

- **Fixed-timestep logic** — the accumulator pattern drives discrete grid
  ticks starting at 8/s and ramping (+0.28/s per ember, capped at 15/s).
  Rendering runs at display rate and interpolates every segment between its
  previous and current grid cell, so movement is grid-step but looks smooth.
- **Input queue** — up to 2 direction changes are buffered per tick window.
  A 180-degree reversal is rejected against the *last queued* direction (not
  the currently applied one), which is what prevents the classic double-tap
  self-kill (e.g. tapping up-then-left-then-down while moving right).
- **Movement** — each tick pushes a new head and pops the tail in the same
  step, so moving into the current tail cell is legal (it vacates that tick).
  Eating skips the tail pop, which is how the wyrm grows. The self-collision
  check excludes the tail segment exactly when not growing.
- **Food spawning** — uniform random pick over the set of free cells only,
  never on the snake. If no free cell exists the board is full and you win.
- **Audio** — a tiny Web Audio synth (oscillator blips for eating, a filtered
  noise burst for death). The AudioContext is only created after a user
  gesture; the toggle persists under `arcade.wyrm.audio`.
- **Juice** — canvas glow (`shadowBlur`) on the snake and food, taper and
  fade toward the tail, eat-flash, particles, screen shake and a flicker
  animation on death.
