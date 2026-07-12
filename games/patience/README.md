# Patience

A from-scratch Klondike solitaire — "Patience" being the traditional generic name for the
family. Fifty-two procedurally drawn cards, seven tableau piles, four foundations, and the
obligatory cascading-card victory lap.

## How to play

Build the four foundations from Ace to King, one per suit. On the tableau you stack
downward in alternating colors; face-up runs move as a unit; empty columns take Kings
(or King-led runs) only. The stock deals to the waste — one or three at a time — and the
waste recycles into the stock endlessly when it runs dry.

## Controls

| Input | Action |
| --- | --- |
| drag | move a card or a face-up run (legal targets glow while you drag) |
| double-click / double-tap | send a card to its foundation if it fits |
| click stock (or `Space` / `D`) | draw; when the stock is empty, recycle the waste |
| `Z` / `U` | undo — every move, including draws and recycles |
| `N` | new random deal |
| `R` | restart the current deal (same seed) |
| `A` | auto-complete (button also appears when it's safe) |
| `M` | toggle sound |
| any key on the win screen | new deal |

Deals are seeded: the header shows the deal number, and typing a number + **Deal** replays
that exact shuffle, so deals are shareable.

## Architecture

- `index.html` / `style.css` — chrome: header (timer, moves, seed box, mode/sound
  toggles), canvas stage, footer with controls and lifetime stats.
- `src/cards.js` — seeded PRNG (mulberry32) + Fisher-Yates shuffle; all card artwork,
  rendered once per size into an offscreen-canvas cache: suit glyphs as bezier paths,
  classic pip layouts, and original geometric court designs (sash for Jacks, concentric
  diamonds for Queens, a five-point crown for Kings).
- `src/game.js` — pure rules and state: deal, draw/recycle, move legality, auto-flip,
  full undo history (every action reversible), auto-complete scanning, win detection.
- `src/audio.js` — Web Audio synth (oscillators + filtered noise bursts); the
  AudioContext is only created after a user gesture, and the toggle persists.
- `src/main.js` — layout, pointer input (drag & drop with valid-target highlighting,
  double-tap-to-foundation), fixed-timestep update loop (1/60 accumulator) driving card
  flights, the auto-complete sequencer, and the win cascade: cards launch from the
  foundations with velocity + spin, bounce off the floor with damping, and stamp slowly
  dissolving ghost trails onto a persistent trail layer.

localStorage keys: `arcade.patience.settings`, `arcade.patience.stats` (wins, streak,
best time, fewest moves). The timer pauses when the window loses focus.
