# Shardfield test suite

Run:

```
node games/shardfield/test/logic.test.js
node games/shardfield/test/browser.test.mjs   # needs /usr/bin/google-chrome
```

`logic.test.js` exercises `logic.js` (the same file the game loads) in node.
`browser.test.mjs` spawns its own http server + headless Chrome (raw CDP, no
npm deps) and runs the full feature suite twice — over http:// and over
file:// — with real key events, then re-checks a plain no-query file:// load.

## logic.test.js — one line per test

- `clamp pins values to [a, b]` — clamp helper.
- `lerp interpolates linearly` — lerp helper used by interpolated rendering.
- `rand / irand stay within bounds` — RNG helpers.
- `dist2 is plain euclidean away from the seams` — collision distance.
- `dist2 measures across the toroidal seams` — README: toroidal collision distances.
- `torusDelta returns the shortest wrapped vector` — README: small-saucer aiming across the torus.
- `wrapEntity wraps all four edges and drags prev-pos along` — README: wrap teleports never streak interpolation.
- `wrapEntity leaves in-field entities alone` — wrap no-op inside the field.
- `shard size table: points run inverse to size, 20 / 50 / 100` — README scoring table.
- `shard size table: smaller shards are faster` — README: higher speeds as shards shrink.
- `makeShard: speed within its size band (plus parent boost)` — shard speed tuning.
- `makeShard: unique irregular polygon of 9-12 verts within radius bounds` — README: each shard a unique polygon.
- `makeShard: collision radius is 0.82 of nominal, prev-pos primed` — shard collision + interpolation setup.
- `bullet life is just under one screen-crossing` — README bullet lifetime.
- `makeBullet inherits ship velocity plus fixed muzzle speed along the nose` — README bullet physics.
- `makeBullet respects the ship heading` — muzzle direction follows the nose.
- `max 4 bullets alive is the tuned cap` — README: max 4 alive.
- `saucer points: big 200, small 1000` — README saucer scoring.
- `smallSaucerProb: rare early, rises with score, capped` — small-saucer appearance odds.
- `smallSaucerAimError: error cone tightens as score climbs, floored` — README: aim tightens with score.
- `waveShardCount: wave 1 has 4, +2 per wave, capped at 12` — README: waves add two more large shards.
- `extra ship every 10,000 points; 3 ships to start` — README extra-life rule.
- `heartbeatInterval accelerates as the field thins` — README heartbeat.
- `heartbeatInterval also tightens with wave time, and is clamped` — heartbeat bounds.
- `isCenterSafe: empty field is safe` — respawn safe-zone base case.
- `isCenterSafe: a shard inside the safe radius blocks respawn` — README: respawn waits for a clear safe zone.
- `isCenterSafe: a nearby saucer or saucer bullet blocks respawn` — safe zone vs foes.
- `isCenterSafe respects the torus` — safe zone uses toroidal distance.
- `ship tuning matches the README feel` — capped speed / thrust / fixed timestep constants.

## browser.test.mjs — one line per assert (run twice: http:// and file://)

- `attract overlay shows SHARDFIELD / press ENTER to launch` — attract screen.
- `attract mode seeds a drifting six-shard field` — attract backdrop simulation.
- `HUD wave and ships read — before launch` — HUD idle state.
- `shards drift in attract mode` — simulation runs behind the overlay.
- `canvas renders vector graphics over the star backdrop` — line-by-line canvas rendering happens.
- `Enter/Space launches a game` — README start keys (Enter on http, Space on file://).
- `wave 1 starts with 4 large shards, 3 ships, score 0` — fresh-game state.
- `launch hides the overlay` — overlay lifecycle.
- `HUD shows wave 1 and three ship pips` — HUD sync.
- `ArrowRight rotates clockwise` / `A rotates counter-clockwise` — README rotate keys (arrows + AD).
- `rotating while coasting leaves the velocity vector untouched` — README: rotation never redirects velocity.
- `ArrowUp thrusts (thrusting flag + flame timer while held)` — README thrust key.
- `thrust accelerates along the nose` — inertial thrust.
- `zero damping while coasting: velocity persists exactly` — README frictionless inertia.
- `the ship keeps gliding with no keys held` — coasting.
- `speed is capped at 460 px/s` — README speed cap.
- `W also thrusts` — WASD alternate.
- `ship wraps across the left edge onto the right` — README toroidal arena.
- `Space fires exactly one bullet` — README fire key.
- `bullet inherits ship velocity + muzzle speed` — README bullet physics in the live game.
- `holding Space does not autofire` — README: one shot per press.
- `at most 4 bullets alive` — README: max 4 alive.
- `bullets expire just under one screen-crossing` — README bullet lifetime.
- `a large shard scores 20` / `splits into 2 mediums` — README split chain + scoring.
- `a medium shard scores 50` / `splits into 2 smalls` — README split chain + scoring.
- `a small shard scores 100` / `just vanishes` — README split chain end.
- `HUD score tracks the live score` — HUD sync.
- `a saucer shot shatters a shard` / `awards no points` — README: saucer shots shatter shards too.
- `a big saucer enters the field` — README big saucer.
- `the big saucer takes pot-shots` — README: fires at random.
- `the saucer crosses the field horizontally` — saucer movement.
- `shooting the big saucer scores 200` — README saucer scoring.
- `ramming a shard destroys the saucer` / `awards no points and still splits the shard` — README: shards shatter saucers.
- `a small saucer enters the field` — README small saucer.
- `the small saucer aims at the ship (within its error cone)` — README: aimed shots with an error cone.
- `shooting the small saucer scores 1000` — README saucer scoring.
- `crossing 10,000 points awards an extra ship` — README extra-life rule.
- `HUD ship pips track lives` — HUD sync.
- `a saucer shot destroys the ship` — README: saucer shots kill the ship.
- `the destroyed ship breaks into drifting line segments and costs a life` — README wreckage.
- `the ship respawns once the center is clear` / `at the field center` — respawn flow.
- `flying into a shard destroys the ship` / `ramming still splits the shard and scores 20` — ship-vs-shard collision.
- `respawn holds while a shard squats on the safe zone` — README: respawn waits for a clear safe zone.
- `clearing the safe zone releases the respawn` — safe-zone release.
- `an empty field rolls over to wave 2` — wave progression.
- `wave 2 spawns 6 fresh large shards (+2 per wave)` — README wave growth.
- `new-wave shards spawn away from the ship` — README: spawned away from the ship.
- `HUD tracks the wave number` — HUD sync.
- `P pauses with a PAUSED overlay` — README pause key.
- `the simulation is frozen while paused` — pause actually stops the world.
- `Enter resumes from pause` / `P also resumes` — resume paths.
- `losing window focus auto-pauses` / `resumed after the blur pause` — README: also pauses on window blur.
- `M toggles the sound label` — README sound key.
- `sound preference persists to localStorage` — README persistence.
- `the header button toggles sound back` — sound toggle button.
- `losing the last ship ends the game` — game-over flow.
- `game over shows the FIELD LOST overlay` — game-over overlay.
- `the run's score is persisted as best` — README best-score persistence.
- `R restarts a fresh game after FIELD LOST` — README restart key.
- `best score survives a page reload` — persistence across loads.
- `zero non-favicon console errors/exceptions` — clean console on http:// and file://.
- `without ?test the game boots to attract mode and exposes no debug handle` — plain double-click file:// load, guard intact.
- `plain load has zero console errors/exceptions` — clean plain load.

Untested: actual audio output (Web Audio synthesis, warble, heartbeat sound —
only the on/off flag and persistence are asserted) and visual details of the
rendering (glow, interpolation smoothness, edge-duplicate drawing) beyond the
lit-pixel check and the absence of errors.
