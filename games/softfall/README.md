# Softfall

A from-scratch 2D thrust-and-gravity landing game in the vector-line tradition: rotate and
thrust a small lander onto flat pads carved into procedural terrain, on a limited tank of
fuel. Glowing strokes on dark, everything canvas-drawn, every sound synthesized.

## How it plays

- Gravity pulls you down every tick; thrust accelerates you along the ship's nose.
- A safe landing needs **all** of: both feet on the same flat pad, horizontal speed ≤ 14,
  descent speed ≤ 26, and tilt within ±8° of upright. Anything else is debris.
- Smaller pads pay bigger multipliers (×2–×5, labeled on the terrain). Score per landing
  is `mult × (100 + fuel remaining)` — land fast and light on a hard pad for big points.
- A touchdown continues the run on fresh terrain and refuels you, but each successive
  refuel is smaller (65 units decaying ×0.72 per landing, floor of 10). Eventually the
  tank math catches up with you.
- High score persists in `localStorage` under `arcade.softfall.high`.

## Controls

| Key | Action |
| --- | --- |
| ← / → or A / D | rotate (constant angular speed) |
| ↑ / W / Space | thrust |
| P / Esc | pause (also pauses on window blur) |
| M | sound on/off |
| R | instant restart |

## Architecture

- `index.html` — canvas + start overlay + footer hints; no build step, plain script tag.
- `style.css` — arcade-shell dark theme (`#0d0f12`), cyan accent, monospace chrome.
- `src/main.js` — the whole game in one IIFE:
  - **Fixed timestep**: 120 Hz accumulator; rendering interpolates the ship between ticks
    (wrap-aware lerp), so physics is identical at any refresh rate.
  - **Physics**: per tick `vy += g·dt`; while thrusting `v += (sin a, −cos a)·T·dt` and
    fuel burns at a constant rate; rotation is constant angular velocity.
  - **Terrain**: 1D midpoint-displacement heightline (129 wrap-consistent samples across a
    1200-unit world; the world wraps horizontally). Four flat pad segments are flattened
    into it — one wide easy pad plus three narrower ones with ×2–×5 multipliers.
  - **Collision**: five ship-local contact points (2 feet, 3 hull) transformed by the
    ship's rotation and tested against the interpolated heightline. Hull contact is always
    a crash; foot contact runs the pad/speed/tilt checks above.
  - **Particles**: exhaust sprays from the tail opposite the nose (inherits ship velocity,
    dies on terrain); crashes burst into spinning line shards that bounce with damping.
  - **HUD** (canvas-drawn): altitude, horizontal/vertical speed and tilt color-coded
    green/red against the safe thresholds, fuel bar with low-fuel flash.
  - **Audio**: Web Audio only, created after the first user gesture. Engine rumble is a
    looping white-noise buffer through a low-pass filter whose gain/cutoff ramp with
    thrust; landings are triangle-wave blips; crashes are a filtered noise burst with a
    falling sweep. Toggle persists under `arcade.softfall.audio`.
  - A tiny `window.__softfall` handle exposes read-only state for the headless test
    harness (terrain invariants + an autopilot that verifies landings are achievable).
