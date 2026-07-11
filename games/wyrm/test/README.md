# Wyrm — test suite

Run from anywhere (no npm deps):

```sh
node games/wyrm/test/logic.test.js     # pure rules, node-only
node games/wyrm/test/browser.test.mjs  # headless-Chrome CDP, http:// AND file://
```

## logic.test.js — pure rules (`logic.js`, the exact module the game runs)

- `board constants match the README` — 26x22 grid, start length 4, 2-deep input buffer.
- `tps starts at 8/s and ramps +0.28 per ember` — the speed-up-as-you-grow rule.
- `tps caps at 15/s` — the ramp ceiling.
- `each ember pays 10 base points plus a speed bonus` — the README scoring formula, including the cap.
- `dirNameOf round-trips every direction vector` — direction helper sanity.
- `KEYMAP covers arrows and WASD` — both steering key families are mapped.
- `queueDirection rejects a 180-degree reversal` — can't reverse into your own neck.
- `queueDirection rejects a no-op` — same-direction taps don't waste queue slots.
- `queueDirection accepts a perpendicular turn` — normal steering queues.
- `double-tap 180 is rejected against the LAST QUEUED direction` — the classic double-tap self-kill guard.
- `queue buffers at most QUEUE_MAX (2) turns` — input buffer bound.
- `queueDirection ignores unknown direction names` — defensive input handling.
- `makeSnake builds a 4-long body head-first at mid-board` — starting layout.
- `a normal step pushes the head and pops the tail` — constant-length movement; input array never mutated.
- `hitting each of the four walls dies` — wall collision on every edge.
- `stepping into your own body dies` — self collision.
- `stepping into the current TAIL cell is legal when not eating` — tail vacates on the same tick (README movement rule).
- `eating grows the wyrm by one (tail is kept)` — growth skips the tail pop.
- `when eating, the tail does NOT vacate — entering it dies` — the growth exception to tail-chase legality.
- `freeCells excludes exactly the snake's cells` — free-cell bookkeeping.
- `spawnFood never lands on the snake (500 random trials)` — embers spawn on free cells only.
- `spawnFood is deterministic under an injected rng` — uniform pick over free cells.
- `spawnFood with one free cell returns exactly that cell` — endgame spawning.
- `spawnFood on a full board returns null` — the ASCENDED win condition.

## browser.test.mjs — headless Chrome, every check run over BOTH http:// and file://

- `page title is "Wyrm"` — the page boots.
- `scripts loaded (classic tags)` — `logic.js` + `game.js` load as classic scripts (file:// safe).
- `menu overlay is shown on boot` / `titled WYRM` / `prompts "press any direction"` — the start menu.
- `HUD score/best/length/speed start at 0 / 0 / 4 / 1.0x` — initial HUD state.
- `back-to-arcade link points at the arcade index` — the header link.
- `canvas has a real backing size` — the board renders.
- `clicking the sound button turns audio off/on` + `preference persists to localStorage` — the sound toggle button.
- `a direction key starts the run` / `overlay hides` / `wyrm slithers right` — README: any direction key starts.
- `KeyS (WASD) steers down` / `ArrowLeft steers left` — README: Arrows / WASD steer.
- `a 180-degree reversal key is rejected` — reversal guard under real key events.
- `first/second/third ember pays 10/11/12` — README scoring: 10 base + speed-scaled bonus, via real staged bites.
- `eating grows the wyrm` + `HUD length tracks growth` — growth on eat.
- `HUD speed ramped to 1.1x after three embers` — README: the board speeds up as the wyrm lengthens.
- `P pauses` / `overlay reads PAUSED` / `P resumes` — README: P pause/resume.
- `Escape also pauses` — README: Esc pause.
- `a direction key resumes from pause` — pause exits on steering input.
- `losing window focus auto-pauses` — README: auto-pause on blur.
- `M key toggles sound off/on while playing` — README: M toggles sound.
- `moving into the vacating tail cell is legal` — README movement rule, live in the browser.
- `biting your own body kills the wyrm` / `death settles into game-over` / `overlay reads DEVOURED` — self-collision death flow.
- `game-over shows the score and flags the new best` — end-of-run summary.
- `best persisted under arcade.wyrm.best` + `HUD best updated` — README: best persists in localStorage.
- `any key restarts instantly after death` + `score/length reset` — README: any-key restart.
- `hitting the wall kills the wyrm` — wall death through the real tick loop.
- `a direction key restarts after death` + `restart direction applied` — steering restart.
- `filling the board ends the run` / `overlay reads ASCENDED` — README: full board is a win.
- `best score survives a reload` + `menu shows the persisted best` — persistence across page loads.
- `ArrowLeft also starts from the menu` + `does not reverse the wyrm` — the left-start safety rule.
- `zero non-favicon console errors/exceptions` — console hygiene, asserted per scheme.
