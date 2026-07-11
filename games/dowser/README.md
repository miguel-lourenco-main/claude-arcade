# Dowser

A from-scratch hidden-hazard grid puzzle. Somewhere under this field, hollows
sleep — dig every safe plot without breaking into one. A dug plot shows how
many hollows touch it; plant markers where the rod trembles.

## Controls

| Input | Action |
| --- | --- |
| Left-click | Dig a plot |
| Right-click | Plant / pull a marker |
| Click a revealed number | Chord: if adjacent markers match the number, dig the rest of its neighbors |
| Tap (touch) | Dig |
| Long-press (touch) | Plant / pull a marker |
| R | New field (instant restart) |
| Enter / Space | Restart after a win or loss |
| 1 / 2 / 3 | Switch preset (Seedplot 9×9/10, Meadow 16×16/40, Longfield 30×16/99) |
| M / S | Toggle sound |

## Rules

- Hollows are placed **after** your first dig — the first plot and all 8 of its
  neighbors are guaranteed clear, so every game opens with usable information.
- Digging a 0-plot flood-fills (BFS) its neighbors; numbered plots stop the fill.
- Markers block digging. You win by revealing every non-hollow plot — markers
  are irrelevant to the win condition.
- Losing reveals every hollow and strikes through wrong markers.
- The clock starts on your first dig and pauses when the window loses focus.
  Best times per preset persist in localStorage (`arcade.dowser.*`).

## Architecture

- `index.html` — page shell, HUD, intro overlay.
- `style.css` — dark arcade theme, amber accent.
- `src/main.js` — everything game: board state in flat `Uint8Array`s
  (hazard / adjacency count / revealed / flagged), BFS flood fill, chording,
  procedural canvas rendering (sod tiles, numbers, pennant markers, cracked
  hollows drawn with 2D primitives — no image assets), input (mouse +
  long-press touch), fixed-timestep clock (1/30 s accumulator; the render loop
  only reads state).
- `src/audio.js` — tiny Web Audio synth (oscillator blips + filtered noise
  bursts). The AudioContext is created only after a user gesture; the sound
  toggle persists.

No dependencies, no build step, all assets procedural.
