# Reversi

A from-scratch build of the classic disc-flipping strategy board game for the
Claude Arcade. 8×8 board, standard rules: a legal move brackets at least one
contiguous line of enemy discs (in any of the 8 directions) between the placed
disc and one of your own, and flips every bracketed line at once. A player
with no legal move is forced to pass; the game ends on a double pass or a full
board, and the most discs wins (draws are possible).

Play against the computer at three difficulty levels, or hotseat two-player.

## Controls

- **Click / tap** a highlighted cell to place a disc
- **U** — undo (against the computer this rewinds the whole pair: your move
  and the computer's reply)
- **N** — open the new-game panel (opponent, side, difficulty)
- **H** — toggle legal-move hints
- **M** — toggle sound
- **Esc** — open/close the menu
- **Enter** on the game-over screen — instant rematch with the same settings

## Difficulty tiers

1. **Greedy** — plays the move that flips the most discs right now.
2. **Positional** — evaluates each immediate move with a weight table
   (corners hugely positive, X/C squares next to corners negative, edges
   positive) and picks the best.
3. **Deep** — alpha-beta negamax to depth 5 using the weight table plus a
   mobility term (legal-move count differential), switching to an **exact
   end-game solve** once 12 or fewer empty squares remain. The search runs in
   a Web Worker so the UI never freezes; a "thinking…" indicator shows while
   it computes.

## Architecture

- `index.html` — page shell, overlays (setup, game over), toolbar.
- `style.css` — dark arcade theme, green accent.
- `src/engine.js` — pure rules + AI engine as a classic script exposing a
  single `ReversiEngine` global, so the same file is loaded both by the page
  and by the worker via `importScripts`. Contains move
  generation/validation, apply/undo, the weight table, the mid-game
  evaluation, alpha-beta negamax, the exact end-game solver, and the three
  move pickers.
- `src/ai-worker.js` — thin Web Worker wrapper around `searchDeep`. If
  workers are unavailable (e.g. the page is opened via `file://`), the game
  falls back to a slightly shallower synchronous search on the main thread.
- `src/audio.js` — Web Audio synth blips (place, ripple flips, pass,
  win/lose/draw). The `AudioContext` is created only after a user gesture and
  respects the sound toggle.
- `src/main.js` — game state, turn flow (including forced-pass announcements
  and double-pass game end), history/undo, canvas rendering, and input.

Rendering is a `requestAnimationFrame` canvas loop. Flip animations ripple
outward from the placed disc, staggered by Chebyshev distance ring, and the
live disc counts tally the colours actually shown on screen, so the score
ticks up as the ripple travels. Game logic is turn-based and event-driven
(no physics tick), so no fixed-timestep accumulator is needed; all animation
timing is wall-clock based and cancellable via a sequence token (used by
undo and new-game to invalidate pending timers and AI replies).

Persistence (localStorage): `arcade.reversi.settings` (mode, side,
difficulty, hints, sound) and `arcade.reversi.stats` (win/draw/loss tallies
per difficulty, shown on the game-over screen).
