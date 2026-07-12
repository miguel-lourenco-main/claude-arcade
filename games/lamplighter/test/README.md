# Lamplighter — test suite

Run:

```sh
node games/lamplighter/test/logic.test.js     # pure-logic, node only
node games/lamplighter/test/browser.test.mjs  # headless Chrome (CDP), http:// + file://
```

## logic.test.js (maze generation + audio logic, 30 seeded mazes)

- `mulberry32 is deterministic for a given seed` — seeded RNG reproducibility.
- `mulberry32 output stays in [0, 1)` — RNG range.
- `different seeds diverge` — RNG seeding actually matters.
- `generateMaze returns a maze for every seed` — generation never fails.
- `grid has the documented dimensions (21x23)` — README architecture claim.
- `maze is left-right symmetric` — mirrored growing-tree carve.
- `outer border is wall except the wrapping tunnel row` — playfield containment.
- `wrapping side tunnels exist on the middle row` — README "side tunnels on the middle row wrap around".
- `den chamber and door are where main.js expects them` — den chamber + door contract.
- `spawn tile is a corridor` — player spawn validity.
- `four braziers sit on corridor tiles at the four corners` — README "four corner braziers".
- `at least 28 lanterns, all on corridor tiles, none on spawn/braziers` — lantern placement rules.
- `lanterns are spaced at least 2 apart (Chebyshev)` — README "lanterns are spaced".
- `every corridor tile (so every lantern and brazier) is reachable from spawn` — README "validated reachable by BFS from spawn"; the night is always clearable.
- `bfsField wraps across the tunnel row (x=0 to x=20 is distance 1)` — wrap-aware BFS.
- `doorField guides gloams home: 0 at the door-top, finite on all corridors` — README "a BFS field to the den door guides banished gloams home".
- `scatter corners are the four brazier tiles` — README "scatter (the four maze corners)".
- `lamp glow pools cover the lamp tile and stay within path-distance 2` — light pooling data.
- `no dead ends outside the tunnel mouths (corridors loop)` — README "dead-end knock-out passes so corridors loop".
- `same seed generates the same maze (procedural determinism)` — README "procedurally generated maze" is seed-stable.
- `Sfx defaults to enabled and setEnabled flips the mute state` — M-toggle logic.
- `Sfx is inert before unlock: ready() false, all cues are safe no-ops` — README "AudioContext created only after a user gesture".

## browser.test.mjs (full feature scenario, run twice: over http:// AND over file://)

Spawns its own http server + headless Chrome (`/usr/bin/google-chrome` via CDP
websockets, no npm deps) and asserts **zero non-favicon console errors or
uncaught exceptions** across the whole scenario. Per README feature:

- `title screen ok` — boots to the LAMPLIGHTER title overlay with the goal text.
- `sound toggle ok` — **M** mutes/unmutes, the sound button click does too, state persisted to `arcade.lamplighter.audio`.
- `any key starts` — Space starts night 1: READY phase, 3 lives, lamp counter `0/N`, HUD night/lives/lamps.
- `turn pre-buffering ok` — README "turns are pre-buffered": a key toward a wall is held in the buffer, not dropped.
- `arrow-key movement ok` — arrow key walks the player off spawn.
- `WASD movement + free reversal ok` — WASD works; reversals are taken immediately.
- `pause (P + blur) ok` — **P** shows PAUSED and freezes the player; window blur also pauses; P resumes.
- `lantern lighting ok` — walking over a lantern lights it: +10 pts, counter and HUD advance.
- `speed rules ok` — lit streets carry the player faster; gloams are faster in the dark and at exactly half speed in the tunnels.
- `gloam personalities ok` — Ashen targets the player tile, Vesper 4 ahead of facing, Murk mirrors Ashen across the player, Smolder heads for an unlit cluster; scatter mode retargets the corner. Mode clock advances.
- `brazier + flee ok` — brazier is +50 and turns every gloam pale/fleeing for a timed window.
- `banish combo ok` — touching fleeing gloams scores 200 then 400 (rising combo), costs no life, sends them home.
- `banished gloam homing ok` — a banished gloam streaks back to the den and re-emerges.
- `death + respawn ok` — a non-fleeing gloam costs a life; respawn at spawn; HUD life dots drop to 2.
- `game over + restart + high score ok` — last life shows THE STREET WENT DARK; high score persisted to `arcade.lamplighter.high` and shown as HUD best; any key restarts with fresh score/lives/night.
- `night clear -> night 2 ok` — lighting every lamp awards the night-clear bonus and generates a brand-new maze for night 2 (grid differs), HUD night = 2.
- `tunnel wrap-around ok` — walking off the left tunnel mouth wraps the player to the right edge.
- `zero console errors` — asserted at the end of each scenario, on both http:// and file://.

The suite arms a guarded debug handle (`window.__LAMPLIGHTER_TEST__`, set via
`Page.addScriptToEvaluateOnNewDocument` before any game script runs) that
`src/main.js` exposes only under that flag; normal play is unaffected.
