# Softfall test suite

Run: `node test/logic.test.js` then `node test/browser.test.mjs` (needs `/usr/bin/google-chrome`).
Both exit 0 on pass; no npm dependencies.

## logic.test.js — pure logic (`src/logic.js` in node)

- `wrapX wraps into [0, W)` — horizontal world wrap math.
- `clamp / lerp behave` — shared numeric helpers.
- `normAng folds into (-PI, PI]` — tilt normalization used by the ±8° rule.
- `genTerrain: 200 seeds` — SEGS+1 samples, wrap-consistent endpoints, height clamps, exactly four flat pads carved into the heightline, sorted, width↔multiplier pairing (×1–×5), one guaranteed easy pad.
- `terrainY interpolates linearly` — heightline sampling between samples + wrap.
- `padAt finds the pad under x` — inclusive pad edges, null off-pad, wrapped x.
- `stepShip: gravity` — vy += g·dt while coasting.
- `stepShip: upright thrust` — thrust counters gravity and burns fuel at BURN_RATE.
- `stepShip: empty tank` — no thrust and no negative fuel at 0 fuel.
- `stepShip: tilted thrust` — acceleration follows the nose (sin/cos of angle).
- `stepShip: rotation` — ←/→ constant angular speed, both keys cancel.
- `stepShip: wrap and ceiling` — x wraps at world edges, y clamps at the soft ceiling.
- `contactPoints upright / rotated` — the 2 feet + 3 hull probe points transform with the ship.
- `landing: in the air` — no contact → no event.
- `landing: gentle upright on pad` — the safe-landing happy path.
- `landing: threshold edges inclusive` — vx=14, vy=26, <8° all still land.
- `crash: too fast sideways` — |vx| > 14.
- `crash: came down too hard` — vy > 26.
- `crash: came in tilted` — tilt beyond ±8°.
- `crash: rough ground` — feet touching terrain off any pad.
- `crash: straddling the pad edge` — feet on different surfaces.
- `crash: hull impact` — hull contact beats every other check.
- `grazing while moving up` — vy < 0 contact is not a landing.
- `landingPoints` — score = mult × (100 + round(fuel)).
- `refuel decays ×0.72 with floor 10` — 65, 47, 34, … down to 10.
- `simulated free-fall from 8u lands` / `from 60u crashes` — full stepShip+evaluateLanding integration.

## browser.test.mjs — headless Chrome over CDP, run twice: http:// AND file://

- scripts loaded — `SoftfallLogic` + `__softfall` handle present on both origins (file:// proof).
- boots into the menu — start overlay visible, sound defaults on, no best label on a clean origin.
- terrain invariants — four flat pads at their labeled heights, multipliers ×1–×5, an easy pad.
- Start button (real mouse click, http) / thrust-key start (file) — run begins, overlay hides.
- rotation — ArrowLeft/ArrowRight and A/D each turn the ship the right way (real key events).
- thrust — Space engages `keys.thrust`, burns fuel, pushes vy upward; W and ArrowUp also thrust.
- pause — P pauses (sim provably frozen), P resumes, Esc pauses, window blur auto-pauses.
- sound toggle — M flips `arcade.softfall.audio` in localStorage and the button label, both ways.
- safe landing — gentle upright drop onto a pad → `landed`, landings=1, score = mult×(100+fuel), refuel applied (capped at 100).
- next round — run continues on fresh terrain, score carries over.
- crash — slamming into the ground → `crashed` with a cause, then the game-over screen.
- high score — persisted to `arcade.softfall.high` when the run ends.
- R restart — from game over and mid-run; score and landings reset.
- reload persistence — menu shows the padded best score, audio preference survives.
- zero non-favicon console errors / page exceptions across both origins.
