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
- **t** — throw a pocket pebble: aim mode prompts for a direction key
  (**Esc** cancels); the pebble flies up to 7 tiles and lures monsters to the
  clatter
- **1–4** — choose a level-up boon (vigor / might / agility / focus) when the
  overlay appears; play is paused until you pick
- **>** — descend stairs · **<** — ascend stairs
- **m** — toggle sound · **Esc** — close the satchel / cancel aiming
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
  its speed in energy and acts when it crosses 100. The player gains
  `100 + 5×agi` (base 105), so agility literally outruns murklings and
  gallspitters (90) and old-sky horrors (95); skitterlimbs (150) can never be
  outrun, stalkids (75) never keep up, and a quicksilver philtre multiplies
  your speed by 1.5.
- **Monster AI** — seven types. ~40% of spawns start **asleep** (rendered dim
  with a drowsy "z"): they skip every turn until noise, damage, or the player
  standing adjacent wakes them — sneaking past is a real option. The two
  artifact wardens never sleep. Awake monsters idle/wander until you cross
  their line of sight or make noise nearby (combat is loud); then they chase
  your last known position via A* (greedy fallback) and bump-attack. Hunters
  that lose sight of you run down a **patience** meter (sight + 6 turns); when
  it empties they search around your last known position for 5 turns, then go
  back to idling — breaking line of sight actually ends pursuit. A thrown
  pebble retargets any hunter that can't currently see you. Craven whelps flee
  below 25% HP, gallspitters keep their distance and spit, skitterlimbs are
  fast and brittle, stalkids are slow slabs of hit points.
- **Combat & growth** — to-hit rolls from accuracy vs evasion (evasion gains
  `floor(agi/2)`), damage ranges from stats, armor subtracts from incoming
  hits. Kills grant XP; each level gives +5 max HP and banks a **boon point**
  spent in a pick-one overlay: vigor (+6 max HP), might (+1 damage), agility
  (+1 agi — speed and dodge), or focus (+1 accuracy). Monster stats scale with
  the depth they spawn on.
- **Healing** — out-of-combat regen ticks +1 HP every 6 turns while no monster
  is in sight; the elderbark salve heals +2/turn for 6 turns but is spoiled by
  taking any damage; the glowmoss draught is the burst heal; the pearl-dew
  elixir (depth 5+) restores everything.
- **Items** — healing/haste potions, salve and elixir, teleport / magic-map /
  **dimming** scrolls (the veil caps every monster's sight at 2 tiles for 12
  turns — the panic button), pocket pebbles to throw as lures, three weapon
  tiers and three armor tiers, and a third equip slot for **trinkets**:
  keen-eye charm (+1 acc), mosskeeper charm (regen every 3 turns), barrow-hide
  wrap (+1 armor), strider's anklet (+1 agi), vigorstone (+10 max HP).

## Architecture

Vanilla JS, no build step. Every file is a classic script (an IIFE attaching
its exports to the page-global `Delve` namespace) loaded with plain
`<script>` tags in dependency order, so the game works when `index.html` is
opened directly via `file://` — no server needed. The core is completely
DOM-free and is driven headlessly by the test suite:

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

`package.json` exists only to hold the test scripts; there are no
dependencies.

## Tests

    node test/logic.test.js      # core rules, headless, no browser
    node test/browser.test.mjs   # headless Chrome over http:// AND file://

`logic.test.js` — 133 assertions: generation connectivity across 100 seeds,
shadowcasting shadow shapes, A* validity, exact energy-scheduling ratios
(including agility-scaled player speed), combat/XP/boon-choice level-ups,
sleep/wake rules, hunt-patience decay into search and idle,
flee/ranged/noise AI behaviors, veiled sight caps, pebble lures,
out-of-combat regen gating, salve ticks and spoiling, elixir, every trinket
effect, spawn budgets and the sleeping fraction over 100 seeds, the three
FOV states, byte-identical save/load round-trips (v2 fields, v1 rejection,
defensive defaults) with identical futures, floor persistence on revisit,
and a god-mode bot that descends all nine floors — auto-spending its boon
points — and wins by taking the Pearl.

`browser.test.mjs` — spawns its own static server and drives real headless
Chrome (raw CDP, no npm deps) through every control listed above — including
the log scroll-hold pip, the boon overlay, pebble aim mode, HUD badges and
trinket equipping — twice: once over http:// and once over file://,
asserting zero console errors on both (65 assertions per origin). See
`test/README.md` for the per-test breakdown.
