# Reversi tests

Run with:

```
node games/reversi/test/logic.test.js
node games/reversi/test/browser.test.mjs   # needs /usr/bin/google-chrome
```

## logic.test.js — pure engine rules (node, no browser)

- `initial position: Black has exactly the four standard openings` — move generation from the start position.
- `computeFlips: d3 opening flips exactly the bracketed white disc` — flip computation for a single line.
- `computeFlips: occupied or non-bracketing squares are illegal (null)` — move legality rejection.
- `computeFlips: flips every bracketed line in multiple directions at once` — multi-direction flipping in one move.
- `computeFlips: a line ending on the board edge without an own disc does not flip` — no wrap/edge false positives.
- `applyMove/undoMove: roundtrip restores the exact board` — apply/undo symmetry used by the search.
- `counts: tallies discs and empties` — score counting.
- `forced-pass scenario: after Black plays 2, White has no move but Black does` — the pass rule (also the exact position the browser test drives through the UI).
- `double-pass terminal: after Black's second move nobody can move` — game-end detection by double pass.
- `bestMoveGreedy picks the move that flips the most discs` — difficulty I move picker.
- `bestMoveGreedy returns -1 with no legal move` — AI pass signalling.
- `bestMovePositional prefers a corner over a same-flip edge move` — difficulty II weight-table picker.
- `searchDeep returns a legal move from the initial position` — difficulty III alpha-beta search.
- `searchDeep does not mutate the board it searches` — search side-effect safety.
- `searchDeep exact endgame: solver engages and returns the exact score` — exact end-game solve (score −22 position).
- `negamax/solveExact are exported` — the engine API the file:// main-thread fallback depends on.
- `chunked-fallback root loop picks the same move as searchDeep` — the setTimeout-sliced fallback is move-for-move equivalent to the worker search.
- `full game simulation: greedy vs positional terminates legally` — whole-game invariants (legal moves only, ≤60 discs placed, terminal double-pass).

## browser.test.mjs — headless Chrome over CDP, run twice (http:// AND file://)

Each line below is asserted on BOTH protocols unless marked http-only.

- `setup panel is shown on load` / `status prompts for setup` — boot state.
- `hotseat: two-player mode selected via setup` / `setup closes` / `Black moves first` — two-player game start via real button clicks.
- `legal-move set is the four standard openings` + `legal-move dot is visibly rendered on the canvas` — legal-move dots (state and actual canvas pixels).
- `black move at d3 resolves` / `bracketed white disc flipped` / `live counts settled at 4-1` — disc placement via a real pointer event and completion of the flip animation.
- `last-move marker tracks the placed disc` — last-move indicator.
- `hotseat: turn passes to White` / `White placed a disc` — both hotseat players can move.
- `undo …` (×3) + `undo button disables` — single-step undo in 2-player mode via the U key.
- `H key turns hints off` / `hints button turns hints back on` / `persists to localStorage` — hints toggle (key + button) and persistence.
- `sound button turns sound off` / `M key turns sound back on` / `persists to localStorage` — sound toggle (button + key) and persistence.
- `Esc opens the menu` / `Esc closes the menu again` — menu key.
- `level N: AI (White) move arrived` for N = 1, 2, 3 — an AI reply arrives at every difficulty.
- `undo pair: board back to the start` — vs-AI undo rewinds human+AI moves together.
- `deep level shows the thinking indicator` — the "thinking" status while the deep search runs.
- `http: deep search ran in the Web Worker` — the worker path is really used when served.
- `file://: worker is unavailable and the main-thread fallback engaged` — the file:// fallback path is really used.
- http-only: `worker onerror marks the worker broken` + `deep AI move still arrives … after worker death` — async worker-failure path (a real `error` event on the live worker).
- http-only: `deep AI move arrives via fallback when the Worker constructor throws` — sync worker-failure path (throwing `Worker` ctor).
- `forced-pass toast appears` / `announces the passing side` / `turn returns` — forced-pass flow through the real UI.
- `double pass ends the game` / `summary names the winner` / `shows the 7-0 score` — game end + summary overlay.
- `Change setup returns to the setup panel` — game-over "Change setup" button.
- `win is tallied into arcade.reversi.stats` / `stats accumulate across games` / `per-difficulty record` shown — stats persistence.
- `Rematch button starts a fresh game` and `Enter … instant rematch` — both rematch paths.
- `hints/sound/mode+difficulty survive a reload` — settings persistence across a real page reload.
- `zero non-favicon console errors or exceptions` — asserted once per protocol over the whole run.
