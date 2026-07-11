# Brickstorm

A from-scratch paddle-ball brick-breaker for the Claude Arcade. A paddle, a ball,
and a wall of bricks that gets meaner every level.

## Controls

| Input | Action |
| --- | --- |
| Mouse / touch drag | Move paddle |
| `←` `→` or `A` `D` | Move paddle |
| Click / `Space` / `↑` / `W` | Serve the ball, start, restart |
| `P` / `Esc` | Pause (also pauses on window blur) |
| `M` | Toggle sound |

## Gameplay

- 3 lives. Clear the wall to advance; each level draws a new procedural pattern
  (solid band, checkerboard, pyramid, rain columns, diamond, twin fortresses)
  with more rows and tougher bricks as you climb.
- Multi-hit bricks (up to 3 hp) show cracks as they take damage.
- Bricks marked with a dark diamond drop a capsule — catch it with the paddle:
  - **W** (blue): wide paddle, 12 s.
  - **M** (pink): multiball — splits into two extra balls (max 6 in play).
  - **S** (green): slow ball, 8 s.
- Score: 5 per chip, 10–70 per broken brick (tougher + higher rows pay more),
  50 per capsule caught. High score persists in `localStorage`
  (`arcade.brickstorm.*`).

## The feel (mechanics that matter)

- **Positional paddle bounce** — where the ball lands on the paddle decides the
  exit angle: normalized offset in `[-1, 1]` maps linearly to ±60° from
  vertical, plus ~±1.5° of jitter so a dead-center return can't lock into a
  vertical loop. Every bounce is then clamped to a minimum vertical component
  (28 % of speed) so the ball can never grind near-horizontal.
- **Speed ramp** — ball speed bumps +9 % at brick-hit thresholds (4, 12, 24,
  40 hits) and +14 % on the first contact with the top two brick rows each
  level (with a brief flash to telegraph it). Capped at 640 px/s; base speed
  also rises per level.
- **Side-resolving collisions** — circle-vs-rect with penetration-depth
  comparison decides whether a brick was struck on its horizontal or vertical
  face, so edge hits reflect on the correct axis; when several bricks overlap
  the ball, the nearest brick center wins.
- **Sub-stepped movement** — each fixed tick the ball advances in sub-steps of
  at most 0.6 × its radius, so it cannot tunnel through a brick at high speed.
- **Serve variance** — the ball launches from the paddle on input at a random
  angle within ±13° of vertical.

## Architecture

- `index.html` — DOM chrome (HUD, overlay, footer) around a single canvas.
- `style.css` — dark arcade theme, monospace UI.
- `game.js` — one IIFE, no dependencies:
  - fixed-timestep simulation (120 Hz accumulator), rendering interpolates
    ball/paddle/capsule positions between ticks;
  - `mulberry32`-seeded level generator so each level is deterministic;
  - a tiny Web Audio synth (`blip` / `noise` / `arp`) for all sound effects —
    the `AudioContext` is only created after a user gesture, and the toggle
    persists;
  - screen shake + brick-shatter particles for juice.

Everything is procedural — no external assets, no build step.
