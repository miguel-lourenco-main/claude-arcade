# Slipstream

A from-scratch pseudo-3D arcade racer built on the classic segment-projection
road technique. Point-to-point checkpoint race across five themed stages —
beat the clock, weave through traffic, brake into the bends before the
centrifugal pull throws you off the road.

Every asset is original and procedural: canvas-drawn sprites, Web
Audio-synthesized engine/wind/skid sounds, and a hand-recipe track. No
external dependencies, no build step.

## Controls

| Key | Action |
| --- | --- |
| `←` `→` / `A` `D` | steer (speed-sensitive — no steering when stopped) |
| `↑` / `W` | accelerate |
| `↓` / `S` | brake |
| `Enter` / `Space` | start from the title |
| any key | restart after game over / results |
| `P` | pause (also pauses on window blur) |
| `M` | sound toggle |
| `Esc` | back to the title |

## How it plays

- The clock starts at 45 s; each of the four stage checkpoints adds time.
  Clock at zero = game over (the car coasts to a stop).
- Centrifugal force (`speed × curve`) pushes the car toward the outside of
  every bend — the harder the bend and the faster you go, the stronger the
  pull. Hard bends (chevron signs) must be braked into.
- Rumble strips at the road edge buzz a warning; beyond them the shoulder
  drags you down to quarter speed with dust and screen shake.
- Rear-ending traffic causes a spin-out and a hard slowdown; passing close
  at speed gives a whoosh and bonus points.
- Score = distance + overtakes; finishing adds time-remaining, pass and
  top-speed bonuses. Best score persists in
  `localStorage["arcade.slipstream.best"]`.

## Architecture

```
index.html          shell (canvas + DOM overlays, house chrome)
style.css           dark arcade styling, letterboxed 640x400 canvas
src/track.js        PURE: segment list (curve + elevation per 200-unit
                    segment), stage recipes, sprite placement, traffic seeds
src/sim.js          PURE: fixed-timestep physics — handling, centrifugal
                    pull, off-road, traffic AI/collision, checkpoints,
                    scoring; emits typed events per step; also the
                    autopilot used by attract mode and the tests
src/render.js       segment-projection renderer: per-frame road walk from
                    the interpolated camera (dx += curve; x += dx),
                    back-to-front trapezoids, fog, painter's-order sprites,
                    parallax ridges, particles, in-canvas HUD
src/sprites.js      procedural sprite sheet (flora, signs, gates, cars)
src/audio.js        Web Audio synth: speed-tracking engine hum + wind +
                    skid loops, one-shot blips (gesture-gated, toggleable)
src/main.js         game modes (attract/countdown/race/over/results),
                    accumulator loop, input, persistence
test/headless.mjs   node-driven engine tests (no DOM): physics, centrifugal
                    direction/scaling, off-road, gears, collision, passes,
                    checkpoints, clock, and a full autopilot race
```

The simulation runs at a fixed 60 Hz via an accumulator; rendering
interpolates position/lateral/speed between ticks and re-walks the road
every frame from the interpolated camera. Track geometry is deterministic
(seeded PRNG), so the course is a fixed, learnable design.

Run the engine tests with:

```
node test/headless.mjs
```
