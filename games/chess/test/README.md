# Chess tests

Run everything with node (no dependencies):

```
node games/chess/test/perft.test.js     # move-generation counts + engine sanity
node games/chess/test/logic.test.js    # game rules the UI depends on
node games/chess/test/search.test.js   # AI search quality/timing
node games/chess/test/browser.test.mjs # end-to-end in headless Chrome (http:// AND file://)
```

## perft.test.js
- perft depths 1-4 from the start position and 3 stress positions (castling/en-passant-rich, ep-pin endgame, promotion-heavy) — verifies the legal move generator against known node counts.
- FEN round-trips, make/unmake reversibility (FEN + both Zobrist hashes), incremental-hash correctness.
- Game status: checkmate, stalemate, insufficient material, 50-move rule, threefold repetition, en-passant expiry, SAN (moves, disambiguation, castling, promotion).

## logic.test.js
- start position has exactly 20 legal moves — baseline legality.
- pinned piece may not move — absolute-pin filtering.
- findMove resolves legal moves and rejects illegal ones — the UI's move lookup.
- castling: available with rights + empty path; forbidden through an attacked square; forbidden while in check; rook move drops the right.
- en passant: capture removes the passed pawn (and unmake restores it); the right expires after one move.
- promotion: all four promotion moves generated; promoting places the chosen piece.
- check detection; fool's mate is checkmate (result 0-1); stalemate is a draw.
- draws: insufficient material (K+N vs K), 50-move rule, threefold repetition.
- make/unmake through a mixed 6-move sequence restores FEN and both hashes — what Undo relies on.
- FEN round-trip of a mid-game position; invalid FEN rejected.
- SAN capture / check / mate suffixes.
- search stepper (the file:// main-thread fallback engine): finds mate in 1 and agrees with `search()`; each slice stays within its time budget (UI responsiveness); reports no move when there are none.

## search.test.js
- mate in 1 and mate in 2 found; depth-2 search returns a legal move; quiescence avoids a hanging-queen blunder; winning side finds a forced mate; depth cap and time budget respected; jitter level still returns legal moves; 60-ply self-play smoke test.

## browser.test.mjs
Self-contained headless-Chrome (CDP over websockets) end-to-end test. Spawns its own
http server and runs the identical feature suite over **http://** and **file://**
(where Chrome blocks the Web Worker, so this proves the main-thread AI fallback).
Per protocol it asserts:
- zero non-favicon console errors / uncaught exceptions.
- new game vs AI: setup overlay, mode/side/strength segments, Start begins from the initial position.
- click move (1.e4) with legal-move dots (e2 shows exactly its 2 targets).
- the AI replies — via the real worker on http://, via the main-thread fallback on file:// (`backend` asserted per protocol), with a UI-responsiveness probe while it thinks.
- drag-and-drop move (2.d4).
- undo pair: U removes the AI reply + your move together.
- board flip with F (and back).
- FEN export (panel shows the current position), FEN copy (no crash without clipboard), FEN import of a pasted position.
- promotion picker: opens on a7-a8, clicking the queen promotes (a8=Q).
- hotseat mode: both players' moves accepted from the same board.
- checkmate flow: fool's mate detected, game-over overlay names the winner, Enter rematches instantly.
- check flow: Rf8+ sets the check state and the status bar announces it; capturing the rook clears it; the resulting K vs K is an insufficient-material draw.
- sound toggle + settings persistence: saved under `arcade.chess.settings` and restored across a reload.
