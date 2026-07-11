# Palisade

A from-scratch tower defense for the Claude Arcade. Creeps march along fixed paths
toward your palisade gate; buy, upgrade, and sell towers to stop them across 20
scripted waves on three maps.

## How to play

Pick a map, place towers on the grass, and hold all 20 waves. Every kill pays a
bounty, every cleared wave pays a bonus, and calling the next wave before the
timer runs out pays extra gold per second remaining. Leaked creeps cost 1 life
(hulks cost 2); you have 20.

### Controls

| Input | Action |
| --- | --- |
| Click | Place selected tower / select a placed tower |
| 1–4 | Pick tower type (Arrow / Mortar / Frost / Thorn) |
| Right-click / Esc | Cancel placement, deselect |
| Space | Call the next wave early (+2 gold per second left on the timer) |
| T | Cycle targeting: first → last → nearest → strongest |
| U | Upgrade selected tower (2 levels) |
| X | Sell selected tower (70% refund) |
| F | Fast-forward toggle (1× / 2×) |
| P | Pause (also pauses on window blur) |
| M | Sound on/off |
| R | Restart map |

### Towers

- **Arrow** — fast single-target homing bolts.
- **Mortar** — slow lobbed shell, area damage that falls off from the blast center.
- **Frost** — instant hit, slows creeps to 55% speed; repeat hits **extend the
  slow's duration** (the factor never stacks).
- **Thorn** — venom dart whose damage keeps ticking after the hit.

### Creeps

Walker (baseline), Skitter (fast), Hulk (tanky, leaks 2 lives), Mender
(regenerates), Mite (weak but swarms). HP bars appear only once damaged; slowed
creeps tint blue, poisoned creeps ring green.

## Architecture

Vanilla ES modules, zero dependencies, no build step.

```
index.html         shell + sidebar UI
style.css          dark arcade chrome
src/
  engine/
    data.js        towers, creeps, waves, scaling curves (pure data)
    maps.js        3 maps, waypoint paths, path/water/buildable grid
    game.js        the whole simulation: pure logic, no DOM
  render.js        procedural canvas art + particles/floats/beams
  sfx.js           Web Audio synthesized SFX (created on first gesture)
  main.js          fixed-timestep loop, input, HUD, persistence
test/
  engine.test.js   node-run headless suite (node test/engine.test.js)
```

Key design decisions:

- **Distance-along-path creeps.** A creep stores only `s`, its distance along a
  fixed waypoint path; x/y come from segment interpolation. First/last targeting
  is a max/min over `s`, and there is no pathfinding at all — towers can never
  block the route, so placement rules stay trivial (any grass cell).
- **Fixed timestep.** The engine advances in exact 1/60 s ticks via an
  accumulator; rendering interpolates between `prevS`/`s` (and projectile
  positions) with the accumulator remainder. Fast-forward just feeds the
  accumulator double time — the simulation stays deterministic.
- **Event stream.** The engine pushes typed events (shot, hit, death, leak,
  waveClear, …) that the browser layer drains for sound and particles, keeping
  the simulation headless-testable.
- **Homing projectiles.** Shots track their target and always land; if the
  target dies mid-flight they retarget the nearest creep within a small radius
  or fizzle. Mortar shells fly to the last known position and detonate there.
  Frost is a hitscan beam.

localStorage keys: `arcade.palisade.best.<mapIdx>` (per-map best score),
`arcade.palisade.audio`.
