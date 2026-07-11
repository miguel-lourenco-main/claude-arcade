# Quarry

A falling-block puzzler built on the **twelve pentominoes** (F I L N P T U V W X Y Z —
five cells each) in a **12 x 24** pit. Stack the stones, close full seams across the pit,
and dig deeper as the drop speed climbs. Five-cell pieces are far less forgiving than
four-cell ones — the lock delay, kick offsets, and stash slot exist so you have a
fighting chance.

Everything here is original: the piece set (pentominoes are public-domain mathematics),
the field size, the rotation kick table, the earthy quarry palette, and the naming.

## Controls

| Key | Action |
| --- | --- |
| ← → / A D | shift stone (held: auto-repeat after ~170 ms, then every ~40 ms) |
| ↓ / S | ease down (~10x gravity, +1 point per cell) |
| ↑ / W / X | turn clockwise |
| Z | turn counter-clockwise |
| Space | drop (instant lock, +2 points per cell) |
| C / Shift | stash the stone (once per drop) |
| P | pause (also pauses on window blur) |
| M | sound on/off |
| R | restart |

Any key starts a game from the title or game-over screen.

## Rules

- **Gravity**: ~800 ms per row at depth 1, tightening on a curve to a floor of 80 ms.
  Depth increases every 10 cleared seams.
- **Lock delay**: a resting stone locks after 500 ms; each successful move or turn while
  resting resets the timer, up to 12 times per stone.
- **Rotation kicks** (original list, tried in order): in place, left 1, right 1, left 2,
  right 2, up 1.
- **Randomizer**: a shuffled bag of all 12 pentominoes, redealt when empty. The next
  three stones are previewed; a ghost outline marks the landing spot.
- **Seams**: full rows flash, then collapse. Base scores 100 / 300 / 700 / 1600 / 4000
  for 1–5 simultaneous seams, multiplied by depth. Four and five at once (AVALANCHE /
  MOTHERLODE) bring screen shake, stone-chip particles, and a proper rumble.
- **Top-out**: stones spawn in four hidden rows above the pit (with one extra row of
  grace); the game ends only when a new stone cannot be placed at all.

## Architecture

- `index.html` — shell: header HUD, canvas stage, start/pause/game-over overlay, footer.
- `style.css` — arcade house chrome (dark, monospace), ochre accent.
- `game.js` — everything else, in sections:
  - **Piece data**: the 12 pentominoes as 5x5 masks; the 4 orientations are precomputed
    with a clockwise map `(x, y) -> (4 - y, x)`.
  - **Logic**: fixed 60 Hz timestep via an accumulator; gravity, DAS auto-shift, lock
    delay, and clear animation are all millisecond timers advanced per tick, so feel is
    frame-rate independent.
  - **Rendering**: single canvas; each cell is drawn as chiseled stone (bevel highlights
    and shadows plus seeded speckle/crack texture from a per-cell PRNG seed, so every
    block face is subtly different but stable).
  - **Audio**: Web Audio oscillator blips and filtered noise bursts, synthesized on the
    fly. The context is created on the first user gesture; M toggles.
  - **Persistence**: `arcade.quarry.high` and `arcade.quarry.audio` in localStorage.
