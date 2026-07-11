# Gemgrove test suite

Run from the repo root (or anywhere — paths are self-contained):

```sh
node games/gemgrove/test/logic.test.js     # pure rules, plain node asserts
node games/gemgrove/test/browser.test.mjs  # headless-Chrome CDP, http:// + file://
```

## logic.test.js — pure rules (`logic.js` under node)

- `key/kr/kc round-trip` — cell-key encoding is bijective over the 8x8 board.
- `isAdjacent` — only orthogonal neighbours count (no diagonals, no self, no distance 2).
- `levelTarget` — rising score targets: 1000 base + 850 per level.
- `levelMoves` — move budget: 20 base + 1 every 3 levels.
- `findRuns: inert pattern` — the reference no-match board yields zero runs.
- `findRuns: horizontal 3-run` — a planted row run is found with exact cells/type/dir.
- `findRuns: vertical 4-run` — column runs are detected with their full length.
- `findRuns: run of 2` — pairs are not matches.
- `findRuns: L-intersection` — crossing runs are reported as both a row and a column run.
- `matchAt` — true exactly on cells crossed by a 3+ line.
- `computeValidMoves: zero` — a deadlocked board reports no valid moves.
- `computeValidMoves: single planted swap` — finds exactly the one valid move and restores the grid after probing.
- `generateBoard (x50)` — 8x8, sane gem types, never a ready-made match, always at least one valid move.
- `resolveClear: plain 3-run` — clears 3 cells and forges nothing.
- `resolveClear: 4-run` — forges a cross gem at the player's swap site.
- `resolveClear: 4-run mid-cascade` — with no swap site the special forges at the run middle.
- `resolveClear: 5-run` — forges a burst gem.
- `resolveClear: L/T intersection` — forges a burst on the crossing cell.
- `resolveClear: matched cross` — expands the clear to the full row + column (15 cells).
- `resolveClear: matched burst` — detonates the 3x3 around it.
- `resolveClear: special chaining` — a fired cross ignites a burst caught in its row.
- `resolveClear: corner burst` — the 3x3 clips to the board frame.
- `compactAndRefill: holes` — survivors keep order, new gems drop in from above (negative offsets), no nulls remain.
- `compactAndRefill: full column` — untouched columns keep their exact cells with no animation offset.
- `applyShuffle` — preserves the gem multiset and specials, ends with no matches and at least one valid move.
- `applyShuffle: pathological` — an unshufflable single-colour board falls back to a fresh constrained fill, re-seeding specials.

## browser.test.mjs — full game in headless Chrome (run twice: http:// and file://)

Each pass asserts, in order:

- boot: start overlay (title, target/moves detail), fresh HUD (level 1 / score 0 / best 0), goal bar `0 / 1000`, arcade back link, sound defaulting on.
- click-to-begin: overlay hides, play mode, 20 moves, target 1000, dealt board settles with a valid move, full 8x8 grid.
- rendering: the canvas is painted with non-background pixels.
- selection: click selects a gem, clicking it again deselects, clicking a non-adjacent gem moves the selection.
- invalid swap: an adjacent no-match swap animates, reverts both gems, and costs no move.
- valid click-swap: costs exactly one move, banks >= 30 points, HUD score and target progress bar update.
- R: retries the level with score and moves reset.
- drag-swap: dragging a gem toward a neighbour performs the same swap.
- cascade: a crafted board where the post-clear fall forms a second match — `chain` reaches 2 and the x2 multiplier pays out.
- 4-in-a-row: forges a cross gem at the swap site.
- 5-in-a-row: forges a burst gem at the swap site.
- cross firing: a matched cross clears its whole row + column (>= 150 points).
- burst firing: a matched burst detonates its 3x3 (>= 90 points).
- reshuffle: the shuffle phase engages with its notice toast, ends matchless with a valid move, score preserved.
- hint: after ~5s idle the only valid move is offered as the hint.
- pause: P pauses (PAUSED overlay) and resumes; board input is ignored while paused.
- auto-pause: window blur pauses; clicking the overlay resumes.
- sound: M mutes (label + `arcade.gemgrove.audio`), the button unmutes, both persist.
- level clear: banking the target on the last move shows LEVEL 1 CLEAR, persists level/best, a key press starts level 2 (target 1850) with the score carried.
- game over: running out of moves below the target shows OUT OF MOVES; R retries the level with the carried score restored.
- persistence: a reload resumes at level 2 (start overlay says so), keeping best score and the sound preference.
- hygiene: zero non-favicon console errors / exceptions across the whole pass.
