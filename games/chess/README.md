# Chess

A complete from-scratch chess implementation with a worker-driven AI opponent.
Full legal chess: castling, en passant, promotion (with a picker), stalemate,
the 50-move rule, threefold repetition, and insufficient-material draws.
Play against the computer at three strengths, or hotseat two players.

## Controls

- **Click or drag** a piece to move it (legal targets are shown as dots, rings on captures).
- **U** — undo (vs the computer this undoes the AI reply + your move together)
- **F** — flip the board
- **N** — new-game panel (opponent, side, strength)
- **S** — toggle sound
- **Enter** — instant rematch after game over
- **FEN** button — export the current position or paste one in to load it.

## Architecture

Plain script tags, no build step. Everything below `src/`:

- `engine.js` — pure chess logic, no DOM. 0x88 mailbox board, packed-integer
  moves, pseudo-legal move generation with a make/test-king-attack/unmake
  legality filter. `makeMove`/`unmakeMove` are exactly reversible: castling
  rights, en-passant square, halfmove clock, and both position hashes are
  saved on a history stack. Dual 32-bit Zobrist keys (placement + side +
  castling + ep file) drive threefold-repetition detection and the search's
  transposition table. Also: FEN import/export, SAN with disambiguation and
  +/# suffixes, perft, and full draw detection (stalemate, 50-move,
  repetition, insufficient material incl. same-color-bishop endings).
- `search.js` — iterative-deepening negamax with alpha-beta, transposition
  table (TT move first), MVV-LVA capture ordering, killer moves and a history
  heuristic, check extension, and quiescence search on captures/promotions
  with delta pruning. Evaluation: material + piece-square tables (tapered
  king table for the endgame) + small mobility and pawn-shield king-safety
  terms. Difficulty = depth/time caps (2/4/6); the lowest level picks
  randomly among near-best root moves.
- `worker.js` — Web Worker wrapper so the UI thread never blocks; posts
  depth progress for the thinking indicator. If workers are unavailable
  (e.g. the page is opened via `file://`, where Chrome blocks worker
  scripts), `ui.js` detects the failure and falls back to running the same
  search on the main thread, sliced across `setTimeout` ticks so the UI
  stays responsive.
- `pieces.js` — original vector piece designs drawn with canvas paths,
  cached as per-size sprites.
- `audio.js` — Web Audio synthesized move/capture/check/promote/game-end
  blips; AudioContext starts only after a user gesture; toggleable.
- `ui.js` — canvas board rendering (highlights for last move, selection,
  check), click-move + drag-and-drop input, SAN move list, captured-piece
  rows, FEN panel, overlays (setup, promotion picker, game over), keyboard
  shortcuts, and localStorage settings under `arcade.chess.*`.

Chess is turn-based, so there is no real-time loop to pause; the AI runs in
its own worker and its result is dropped if you undo or start a new game.

## Testing

Run headless engine tests with node:

```
node games/chess/test/perft.test.js    # perft + rules + draw detection + SAN
node games/chess/test/search.test.js   # mates, tactics, timing, self-play smoke
```

Perft from the standard start position passes 20 / 400 / 8902 / 197281
(depths 1-4), plus a castling/en-passant-rich position and a promotion-heavy
position against known node counts.
