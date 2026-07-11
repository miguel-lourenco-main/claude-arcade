# Patience tests

Run them from the repo root:

```
node games/patience/test/logic.test.js
node games/patience/test/browser.test.mjs   # needs /usr/bin/google-chrome
```

## logic.test.js — pure rules (node, no browser)

Loads `src/cards.js` + `src/game.js` (classic scripts on `window.Patience`) into a node VM.

- mulberry32 determinism + range — the seeded PRNG behind every deal
- shuffledDeck: 52 unique face-down cards, valid ranks/suits
- deal shape: tableau piles of 1..7 with only tops face-up, 24-card stock, empty waste/foundations, all 52 cards present
- seeded reproducibility: same seed → identical deal, different seed → different deal
- draw-1: exactly one card, old stock top, face-up, counted as a move
- draw-3: three cards per draw, short final draw, full drain to a 24-card waste
- recycle: empty stock flips the waste back face-down and preserves the original draw order; draw on empty stock+waste is a null no-op
- canDrop tableau: descending alternate colors, same-color/rank-gap/face-down rejections, Kings (and King-led runs) only on empty columns
- canDrop foundation: ace on empty, suit match, in-sequence rank, single cards only
- move + auto-flip: legal move relocates the card, exposes and flips the card beneath, counts the move; illegal moves rejected and uncounted
- run moves: a two-card face-up run moves as a unit and keeps its order (verified layout, seed 3)
- undo: restores a tableau move including the auto-flip, a draw, and a recycle exactly; a full history unwind returns to the initial deal; undo on empty history is null
- foundationTargetFor: aces target their empty foundation, next-in-suit becomes playable, others null
- auto-complete: offered only with empty stock/waste and an all-face-up tableau, always plays the lowest available rank, finishes to `isWon()`, and the whole finish is undoable

## browser.test.mjs — headless Chrome over CDP (http AND file://)

Spawns its own static server, launches `/usr/bin/google-chrome --headless=new`, and runs the
identical feature suite twice: once over `http://127.0.0.1:<port>` and once via `file://`.
All input is real CDP input (mouse presses/moves, key events, typed text). One `ok -` line
per feature, per origin:

- classic-script boot: `window.Patience` populated (the file:// fix itself)
- seed box + Deal button deals the typed deal number; deal shape verified (piles 1..7, tops up, stock 24)
- `N` deals a new random game; re-dealing #1 reproduces the identical shuffle; header shows the deal number
- legal drag & drop (real mouse drag) moves the card, auto-flips the exposed card, increments the HUD move counter
- Undo button reverses the move including the flip
- illegal drag is rejected and snaps back (state and move count untouched)
- a face-up run drags as one unit and keeps its order; auto-flip after it leaves
- double-click sends an ace to its foundation
- draw modes: stock click draws 3, `Space` and `D` draw, mode button switches to Draw 1 (single card)
- recycle: draining the stock then drawing again recycles the waste
- full undo (`Z` spam) unwinds every draw and the recycle; Undo button disables at empty history
- sound toggle via button and `M`, persisted in `arcade.patience.settings`
- timer pause tag on window blur, cleared on focus
- regression for the setPointerCapture bug: a synthetic `PointerEvent` (inactive pointerId) still draws and raises no uncaught error
- auto-complete: button appears when safe, clicking it plays the staged endgame to the win
- win cascade launches cards from the foundations; win panel shows the deal number
- stats (`arcade.patience.stats`): wins/streak/best time/fewest moves recorded, persist across a reload, shown in the footer
- any key on the win screen starts a new deal; `R` restarts the same seed
- zero non-favicon console errors / uncaught exceptions on BOTH origins (asserted last, covers the whole session)
