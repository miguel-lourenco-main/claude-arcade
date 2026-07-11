# Fuse — tests

Run:

```
node games/fuse/test/logic.test.js
node games/fuse/test/browser.test.mjs   # needs /usr/bin/google-chrome
```

## logic.test.js (pure rules, no browser)

- `constants: 4x4 board, win at 2048` — board size and win threshold.
- `new game starts with exactly two tiles and score 0` — initial spawn count/flags.
- `tiles slide across empty cells to the destination edge` — basic slide.
- `equal tiles fuse and double; score gains the merged value` — merge + scoring.
- `merge-locking: 4 2 2 →left gives 4 4, never 8` — a merged tile can't merge again this move.
- `merge-locking: 2 2 2 2 →left gives 4 4 (two separate merges)` — same rule, full line.
- `destination-edge priority: 2 2 2 →left gives 4 2` — pair nearest the edge merges first.
- `all four directions slide to their destination edge` — left/right/up/down traversal.
- `illegal move: nothing slides/merges → no spawn, no score, no snapshot` — illegal-move no-spawn.
- `legal move spawns exactly one new tile` — post-move spawn.
- `spawn value: rng < 0.9 gives 2, rng >= 0.9 gives 4` — the 90/10 rule, deterministic.
- `spawn lands in the rng-chosen EMPTY cell only` — spawns never overlap; full board spawns nothing.
- `spawn statistics: roughly 10% fours over 5000 spawns` — the 90/10 rule, statistical.
- `undo restores the exact pre-move state and is single-step` — one-step undo.
- `an illegal move does not clobber the undo snapshot` — snapshot taken only on legal moves.
- `first 2048 fuse sets justWon + won` — win detection.
- `after winning once, later big fuses do not re-trigger justWon` — win banner fires once.
- `canMove: full board with one adjacent pair → true; none → false` — game-over predicate.
- `game over: move that fills the last cell with no pairs sets over` — game over detection.
- `moves are rejected once the game is over (undo still possible)` — dead board is frozen; undo escapes it.
- `serialize/restore roundtrip preserves tiles, score and flags` — persistence encoding.
- `load() accepts a valid {cur, prev} bundle including the undo snapshot` — save-file loading.
- `load() rejects corrupt saves and leaves the game untouched` — save validation.
- `load() with a corrupt prev keeps cur but drops the snapshot` — partial-save handling.

## browser.test.mjs (headless Chrome over CDP, no npm deps)

Runs the identical suite twice — once over a local http server it spawns, once
via `file://` (the arcade's double-click path) — and asserts **zero non-favicon
console errors/exceptions** on both. Per run:

- `game booted` — classic scripts loaded; the page is not dead on file://.
- `new game has 2 tiles, score 0` / `2 tile elements rendered` — fresh boot state and DOM.
- `merge-locking — 4 2 2 →left never makes 8` / `equal pair fused to 4 4` / `merge scored +4` — real ArrowLeft key: slides, merges, merge-locking, scoring.
- `legal move spawned exactly one tile` / `spawned tile is a 2 or a 4` / `spawned tile rendered` — 90/10 spawn after a legal move (distribution proven in logic tests).
- `WASD (W) slides the grid up` — WASD input.
- `illegal move spawns nothing and takes no undo snapshot` — illegal-move no-spawn.
- `undo button enabled/restored/disabled` — one-step undo via the real button, including button state.
- `two 1024s fused into 2048` / `win banner shown` / `offers Keep going` / `Keep going dismisses` / `play continues` — win banner at 2048 + keep going.
- `best score updated and persisted (>= 2048)` — best score (`arcade.fuse.best`).
- `filling the last cell with no pairs sets game over` / `game-over banner shown` / `no Keep going on lose` — game over detection.
- `Z undoes out of a game over` — undo escapes a finished game.
- `Try again starts a fresh game` — the lose-banner button.
- `new button restarts` / `R key restarts` — restart paths.
- `board + score survive a reload` / `undo snapshot survives` / `best survives` — state persistence across reload (`arcade.fuse.state`).
- `sound starts on` / `sound button mutes and persists 'off'` / `M key unmutes and persists 'on'` — audio toggle (`arcade.fuse.audio`).
- `swipe right slides the grid` / `sub-threshold swipe (<24px) is ignored` / `swipe up slides the grid up` — swipe input via simulated TouchEvents.
- `zero non-favicon console errors` — clean console for the whole run.
