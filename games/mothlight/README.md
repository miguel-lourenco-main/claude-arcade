# Mothlight

A one-button flight game. You are a moth drawn down a lantern-lit hollow at
night — flap to stay aloft and weave through the gaps between hanging
lantern-chains. One touch of a lantern (or the moss below) and the light
goes out.

## Controls

| Input | Action |
| --- | --- |
| **Space** / **↑** / **W** / click / tap | flap |
| **M** | toggle sound |
| **P** | pause (also auto-pauses on window blur) |
| anything (after game over) | instant restart |

## Rules

- Each lantern-chain you pass scores 1 point.
- Best score persists in `localStorage` under `arcade.mothlight.high`.

## Mechanics notes

- **Flap sets velocity.** A flap assigns `vy = -470` outright — it never adds
  to the current velocity. That fixed impulse is the whole feel of the game.
- **Gravity + terminal velocity.** Constant 1750 px/s² gravity, falls capped
  at 640 px/s. The moth's rotation is driven by `vy`: it snaps nose-up right
  after a flap and eases into a nose-dive as it approaches terminal velocity.
- **Fixed obstacles, random gaps.** Chains spawn at a fixed 236 px horizontal
  spacing; each gap's center is random within a safe band that keeps gaps
  clear of the ceiling and the ground.
- **Forgiving hitbox.** Collision is a 9 px-radius circle around the moth's
  body; the drawn moth (wings out) is roughly three times wider. Chains
  collide as 30 px-wide rectangles.
- **World scrolls, moth doesn't.** The world moves left at a constant
  156 px/s while the moth's x never changes. A point is awarded the exact
  tick the moth's x crosses a gap's vertical center-line.
- **Fixed-timestep physics.** 120 Hz accumulator loop, so the difficulty is
  identical at any display refresh rate; rendering interpolates between the
  last two physics states.
- **Death.** A brief warm flash and screen shake, then the moth tumbles
  (spinning, still under gravity) until it hits the moss. Any input after
  that restarts instantly.

## Architecture

Zero dependencies, no build step, classic `<script>` tags (works straight
from `file://`):

- `index.html` — canvas + arcade chrome (back link, sound toggle, controls footer).
- `style.css` — dark shell styling; the canvas is a fixed 480×720 logical
  resolution scaled to fit the viewport.
- `logic.js` — the pure rules: every constant above plus gravity, gap
  placement, collision, scoring, and tilt as side-effect-free functions.
  Dual-environment (`window.MothlightLogic` in the browser,
  `module.exports` in node), so the tests exercise the exact shipped code.
- `game.js` — one IIFE containing everything else:
  - a tiny Web Audio synth (oscillator blips + filtered noise bursts;
    `AudioContext` is created only after the first user gesture, and the
    toggle persists in `arcade.mothlight.audio`),
  - the fixed-timestep sim (`step()`) and interpolated renderer (`render(alpha)`),
  - procedural drawing for everything: the moth (beating wings, eyespots,
    antennae), glowing paper lanterns on swaying chains, and four parallax
    layers (twinkling stars + moon, a far treeline, drifting fireflies at two
    depths, a near treeline), each scrolling at its own fraction of world speed.

## Tests

- `node test/logic.test.js` — node-only pure-logic suite against `logic.js`.
- `node test/browser.test.mjs` — headless-Chrome CDP suite; drives every
  README feature with real input over both `http://` and `file://` and
  asserts zero console errors. See `test/README.md` for the full list.
