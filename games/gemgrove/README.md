# Gemgrove

A from-scratch swap-adjacent match-3 for the Claude Arcade. Swap neighbouring
gems on an 8x8 board to line up 3 or more, ride the cascades, and beat each
level's score target before the moves run out.

## Controls

- **Click / tap** a gem, then click an adjacent gem to swap — or **drag** a gem
  toward a neighbour.
- **P** — pause (also auto-pauses when the window loses focus)
- **M** — toggle sound
- **R** — retry the current level
- On game over / level clear: click or press a key to continue instantly.

## Rules

- Only adjacent swaps are allowed; a swap that makes no match animates, then
  reverts.
- Matches of 3+ clear with a cascade multiplier: x1 for the first clear, x2 for
  the chain it triggers, x3 after that, and so on. Chain chimes rise in pitch.
- A **4-in-a-row** forges a **cross gem** at the swap site — when matched it
  clears its whole row and column.
- A **5-in-a-row** (or an L/T intersection) forges a **burst gem** — when
  matched it detonates a 3x3 area. Specials can chain each other.
- Levels are move-limited with rising score targets. Progress (level, carried
  score, best score) persists in `localStorage` under `arcade.gemgrove.*`.
- If no valid move remains, the board reshuffles itself with a notice — score
  is preserved. Idle for ~5 seconds and one valid move pulses as a hint.

## Architecture

- `index.html` — shell: HUD (level / moves / score / best), target progress
  bar, canvas stage, overlay, controls footer.
- `style.css` — dark arcade theme, amethyst accent.
- `game.js` — everything else, one IIFE:
  - **Fixed timestep** (1/60s accumulator) drives all animation/logic;
    rendering interpolates between the previous and current tick.
  - **Phase machine**: `awaiting → swapping → clearing → falling → (repeat |
    awaiting)`, plus `shuffling`; game modes `start / play / levelend /
    gameover` gate input.
  - **Resolution loop**: `findRuns()` scans rows+columns for 3+ runs; matched
    specials expand the clear set via a work queue (crosses add row+column,
    bursts add 3x3, chaining); columns compact and refill from above with
    gravity-animated drops; repeats until stable, incrementing the cascade
    multiplier each pass.
  - **Board generation** rejects ready-made matches cell-by-cell and re-rolls
    until at least one valid move exists; the mid-game reshuffle permutes the
    existing gems (specials preserved) under the same constraints.
  - **Gems** are procedural canvas shapes — diamond, hexagon, triangle,
    circle, square, star — so colour is never the only signal.
  - **Audio** is Web Audio synthesis only (oscillators + filtered noise),
    created after the first user gesture, with an on/off toggle persisted to
    `localStorage`.
