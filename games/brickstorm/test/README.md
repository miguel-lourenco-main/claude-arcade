# Brickstorm tests

Run: `node test/logic.test.js` and `node test/browser.test.mjs` (needs
`/usr/bin/google-chrome`; no npm deps). Both exit 0 on pass.

## logic.test.js — pure logic (node, via `logic.js`)

- `clamp clamps below, inside, above` — utility clamp.
- `mulberry32 is deterministic and in [0,1)` — seeded RNG behind level generation.
- `every pattern yields only 0/1 and nothing below its row count` — all 6 level patterns are well-formed.
- `checkerboard pattern alternates cells` — the checkerboard level pattern.
- `pyramid pattern widens with each row` — the pyramid level pattern.
- `rain-columns pattern leaves every third column empty` — the rain-columns level pattern.
- `twin fortresses leave the outer and middle columns empty` — the twin-fortresses level pattern.
- `buildLevel is deterministic per level` — README: "each level is deterministic".
- `level 1 is a 5-row solid band: 60 bricks, top 2 rows hp 2, rest hp 1` — level-1 layout and multi-hit bricks.
- `brick x positions stay inside the playfield` — generated bricks fit the canvas.
- `row count grows with level and caps at MAX_ROWS` — README: "more rows ... as you climb".
- `hp scales with level and never exceeds 3` — README: "multi-hit bricks (up to 3 hp)", tougher on later levels.
- `power-up bricks: at least 3, ~11% of bricks, valid kinds` — capsule-dropping bricks (W/M/S).
- `ballSpeed: base, per-level, ramp, top-row boost, cap, slow` — README speed ramp: +9%/threshold, +14% top rows, 640 cap, slow x0.62.
- `computeRampLevel crosses thresholds 4/12/24/40` — README brick-hit speed thresholds.
- `circleRectSide: miss returns null` — collision broad-phase.
- `circleRectSide: side hits resolve to x, top/bottom hits to y` — README side-resolving collisions.
- `bounceOffBrick reflects and pushes the ball out of the brick` — brick bounce axis + de-penetration.
- `enforceMinVertical keeps |vy| >= 28% of speed and preserves speed` — README minimum-vertical clamp.

## browser.test.mjs — headless Chrome over CDP, run twice: http:// AND file://

Each line below is asserted in both environments; the whole run also asserts
zero non-favicon console errors / uncaught exceptions.

- boots to title state / overlay visible / shows BRICKSTORM — title screen.
- HUD score 0, level 1, 3 lives — initial HUD.
- logic.js loaded and shared — dual-environment logic file works in-browser.
- Space starts a new game, overlay hides — README: "Space ... start".
- level 1 builds 60 bricks; serve ball attached to paddle — level generation + serve state.
- ArrowRight / A move the paddle — README keyboard controls.
- mouse move places the paddle — README mouse control.
- Space serves; ball free, upward, at the 285 px/s level-1 base speed — README serve + base speed.
- brick hit scores points, damages the brick, updates the HUD — README scoring per chip/break.
- W capsule: paddle widens to 124 for ~12 s, +50 score, expires back to 76 — README wide power-up.
- S capsule: ~8 s slow timer starts and expires — README slow power-up.
- M capsule: +2 balls, capped at 6 in play — README multiball.
- missed capsule despawns off the bottom — capsule lifecycle.
- P pauses (PAUSED overlay) and resumes — README pause.
- window blur auto-pauses; clicking the overlay resumes — README "also pauses on window blur".
- M key toggles the SND button, persists to localStorage; clicking the button toggles too — README sound toggle.
- destroying the last brick triggers level clear; level 2 serves the checkerboard pattern; HUD level = 2 — README level progression.
- first top-row contact arms the +14% speed boost — README top-row speed boost.
- losing the ball drops a life on the HUD — README 3 lives.
- game over overlay; high score written to localStorage (`arcade.brickstorm.*`); HUD hiscore updates — README high score persistence.
- click after game over restarts fresh (score 0, 3 lives, level 1) — README restart.
- high score survives a page reload — README persistence.
