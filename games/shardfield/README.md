# Shardfield

An inertial vector space shooter, rebuilt from scratch. You pilot a lone ship
through a wrapping field of splitting rock shards while saucers cross the field
and take pot-shots at you. Glowing polygon outlines, no sprites — everything is
drawn line by line on a canvas, and every sound is synthesized in Web Audio.

## Controls

| Key | Action |
| --- | --- |
| `←` `→` / `A` `D` | rotate |
| `↑` / `W` | thrust |
| `Space` | fire (one shot per press, max 4 alive) |
| `P` | pause (also pauses on window blur) |
| `M` | sound toggle |
| `Enter` / `Space` / `R` | start / restart |

## The feel

- **Frictionless inertia** — thrust adds acceleration along the nose to a
  persistent velocity vector. There is zero damping while coasting, and
  rotation never redirects existing velocity; you aim one way and glide
  another. Speed is capped so it never becomes uncontrollable.
- **Toroidal arena** — ship, shards, bullets, and wreckage all wrap. Entities
  near an edge are drawn on both sides. Aiming (small saucer) and collision
  distances are computed across the torus too.
- **Bullets** inherit the ship's velocity plus a fixed muzzle speed, and live
  just under one screen-crossing.
- **Shards** split large → 2 medium → 2 small → gone, with randomized headings
  and higher speeds as they shrink. Points run inverse to size: 20 / 50 / 100.
  Each shard is a unique irregular polygon.
- **Saucers** — the big one fires at random and is worth 200; the small one
  aims at you with an error cone that tightens as your score climbs, and is
  worth 1000. Saucer shots shatter shards too, and shards shatter saucers.
- **Respawning** waits for a clear safe zone around the center of the field.
- **Waves** add two more large shards each time, spawned away from the ship.
- A two-tone **heartbeat** accelerates as the field thins; extra ship every
  10,000 points; a destroyed ship breaks into its own line segments and
  drifts apart.

## Architecture

- `index.html` — shell: HUD, canvas stage, overlay, controls footer.
- `style.css` — dark arcade chrome, electric-cyan accent.
- `game.js` — a single IIFE:
  - Fixed-timestep simulation (`DT = 1/60`, accumulator pattern) with
    interpolated rendering; every entity keeps previous-tick position/angle
    and the renderer lerps by the accumulator remainder. Wrap teleports adjust
    the previous position so interpolation never streaks across the screen.
  - Entities are plain objects in flat arrays (`shards`, `bullets`,
    `ebullets`, `debris`, `sparks`), collisions are toroidal circle tests,
    removal is dead-flag + filter.
  - `AC` is a small Web Audio module: lazily created `AudioContext` (first
    key press), a shared noise buffer for explosions/thrust, oscillator blips
    for fire/heartbeat/extra-life, and a persistent warbling oscillator while
    a saucer is on screen. Continuous sounds are reconciled with world state
    every tick, so pausing silences them naturally.
  - Persistence: `localStorage` under `arcade.shardfield.best` and
    `arcade.shardfield.sound`.

No dependencies, no build step, no external assets.
