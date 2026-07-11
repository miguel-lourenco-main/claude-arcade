# Dustkart

A from-scratch pseudo-3D kart racer for the Claude Arcade. Six burrowfolk
critters race 3 laps on closed-loop circuits rendered with classic
segment-projection: drift for mini-boosts, grab items from glowing pads,
and out-fox five AI karts that follow a racing line and fight back.

All drivers, items, circuits and art are original. Vanilla JS, zero
dependencies, no build step — works from `file://` directly.

## How to play

Open `index.html` (double-click works). Pick a circuit, race 3 laps.

| key | action |
| --- | --- |
| ← → / A D | steer |
| ↑ / W | accelerate |
| ↓ / S | brake |
| SHIFT (hold) | drift |
| SPACE | use held item |
| P | pause / resume |
| M | sound on/off |
| ESC | back to circuit select |
| ↑↓ + ENTER / 1-3 / click | choose circuit on the menu |

## Features

- **Circuit select** — three original closed-loop circuits with distinct
  themes and shapes: SUNSPUR FLATS (fast sweepers + snap chicane),
  BRAMBLE HOLLOW (two hairpins), EMBERDOWN RIDGE (climbs, drops and a
  killer hairpin). Each menu entry shows your persisted best lap.
- **Race vs 5 AI karts** — each follows an apex-cutting racing line with
  its own top-speed personality; mild capped rubberbanding keeps races
  tight but winnable; AI karts pick up and fire items with heuristics.
- **Live position ranking** — 1st–6th computed from laps + track distance,
  shown big in the HUD; lap counter, lap timer and best lap alongside.
- **Drift & boost** — hold SHIFT while turning at speed to slide; charge
  builds through two spark tiers (amber, then cyan); release for a
  mini-boost scaled to the tier. Drifting the wrong way or too slow
  cancels the charge.
- **Start boost** — press accelerate in the last moment of the 3-2-1
  countdown for a launch boost; jump the gun and you bog down.
- **Item pads** — glowing diamonds on the road (respawn after ~4s) grant
  a random item weighted by your position: the leader draws weak, last
  place draws strong. One item held at a time, shown in the HUD box,
  fired with SPACE.
- **The item kit** — gust vial (speed boost), sap slick (dropped behind,
  spins whoever hits it), homing burr (chases the kart ahead), barkshield
  (orbiting shield that absorbs one hit), tangleroot (snares every kart
  ahead of you).
- **Spin-outs & bumps** — hits spin a kart twice around over ~1s with
  heavy slowdown and brief invulnerability after; kart-vs-kart contact
  bumps both apart with speed loss.
- **Off-road** — running wide costs heavy speed unless you are boosting.
- **Minimap** — circuit polyline with live colored kart dots.
- **Results & persistence** — final table with positions and best laps;
  circuit-best lap saved to `localStorage` (`arcade.dustkart.*`), sound
  preference persisted too.
- **Arcade housekeeping** — fixed-timestep sim with render interpolation,
  pause on blur, instant restart from the results screen, Web Audio synth
  SFX (engine pitch, drift screech, boost whoosh, item pips, spin sting,
  countdown beeps, finish fanfare) gated behind a user gesture.

## Tests

- `node test/logic.test.js` — pure-logic tests (circuits, handling, drift,
  start boost, items, AI, laps, ranking, results).
- `node test/browser.test.mjs` — headless-Chrome feature test over both
  `http://` and `file://` (requires `/usr/bin/google-chrome`).
