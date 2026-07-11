# Delve

A from-scratch turn-based roguelike for the Claude Arcade, set in the caves of
the old sky beneath the Upturn (the arcade's Voxelcraft setting). Nine
procedurally generated floors down sleeps the **First Pearl** — the star that
fell deepest when the world turned over. Take it and the run is won. Die and
the run is gone: permadeath is real, and the save goes with you.

## Controls

- **Arrows / WASD / hjkl + yubn (vi diagonals) / numpad** — move; bump into a
  monster to attack it
- **.** or **numpad 5** — wait a turn
- **g** — pick up what's underfoot
- **i** — open the satchel (then **1–0** to use/equip, **d** + number to drop)
- **>** — descend stairs · **<** — ascend stairs
- **m** — toggle sound · **Esc** — close the satchel
- **R / Enter** — instant restart from the death/win screen

The run auto-saves to `localStorage` whenever you take the stairs
(`arcade.delve.save`); death or victory deletes the save. Sound preference and
lifetime records persist under `arcade.delve.audio` / `arcade.delve.best`.

## The mechanics

- **Dungeon generation** — non-overlapping rooms joined by L-corridors (plus a
  couple of loops), regenerated until a flood fill confirms every walkable
  tile is reachable and the down-stairs sit at least 22 walk-steps from the
  entry. Monster and item budgets scale with depth; the artifact spawns at the
  farthest point of floor 9, warded by old-sky horrors.
- **FOV** — recursive shadowcasting over all 8 octants, radius 8. Tiles have
  three states: unseen (black), remembered (dim geometry, no entities), and
  visible (lit, with torchlight falloff). Map memory persists per floor, and
  floors themselves are persistent — revisit one and its monsters, items and
  memory are exactly as you left them.
- **Turn scheduling** — an energy/speed system. Every tick each actor gains
  its speed in energy and acts when it crosses 100: skitterlimbs (speed 150)
  get three actions to your two, stalkids (speed 75) three to your four, and a
  quicksilver philtre runs you at 150 yourself.
- **Monster AI** — seven types. All idle/wander until you cross their line of
  sight or make noise nearby (combat is loud); then they chase your last known
  position via A* (greedy fallback) and bump-attack. Craven whelps flee below
  25% HP, gallspitters keep their distance and spit, skitterlimbs are fast and
  brittle, stalkids are slow slabs of hit points.
- **Combat & growth** — to-hit rolls from accuracy vs evasion, damage ranges
  from stats, armor subtracts from incoming hits. Kills grant XP; levels add
  HP, accuracy, damage and the odd point of evasion. Monster stats scale with
  the depth they spawn on.
- **Items** — healing and haste potions, teleport and magic-mapping scrolls,
  three weapon tiers and three armor tiers in dedicated equip slots.

## Architecture

Vanilla ES modules, no build step. The core is completely DOM-free and is
driven headlessly by the test suite:

    src/core/rng.js      seedable, serializable PRNG (mulberry32)
    src/core/dungeon.js  floor generation + BFS flood fill
    src/core/fov.js      recursive shadowcasting + Bresenham LOS
    src/core/path.js     A* (binary heap, octile heuristic) + greedy fallback
    src/core/data.js     bestiary, item catalogue, depth-scaled spawn tables
    src/core/game.js     state, scheduler, AI, combat, items, save/load
    src/ui/render.js     canvas glyph renderer (tile states, effects, flicker)
    src/ui/audio.js      Web Audio synth (created only after a user gesture)
    src/main.js          input, overlays, sidebar, log, localStorage glue

Logic is strictly turn-based — nothing advances without input, so there is no
tick-rate-dependent physics; the render loop only animates torch flicker and
short hit/projectile effects. Saves serialize the full game (all visited
floors, entities, map memory, message tail and the RNG state), so a resumed
run continues with the exact same dice.

`package.json` exists only so node treats the modules as ESM for testing.

## Tests

    node test/test.js

69 assertions: generation connectivity across 100 seeds, shadowcasting shadow
shapes, A* validity, exact energy-scheduling ratios, combat/XP/level-ups,
flee/ranged/noise AI behaviors, the three FOV states, byte-identical
save/load round-trips with identical futures, floor persistence on revisit,
and a god-mode bot that descends all nine floors and wins by taking the Pearl.
