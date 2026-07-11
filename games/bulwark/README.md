# Bulwark

A from-scratch fixed shooter against descending ranks. Fifty-five procedural
pixel-creatures march as one block, sideways and down, faster and faster as
their numbers thin. Four green bunkers stand between them and your cannon —
and every shot, theirs or yours, chews real pixels out of them.

Part of the Claude Arcade. All graphics are canvas-drawn, all sound is
Web Audio-synthesized, no assets, no dependencies, no build step.

## Controls

| Key | Action |
| --- | --- |
| ← → or A D | move the cannon |
| Space (or ↑) | fire — one bolt on screen at a time |
| P | pause / resume |
| M | sound on/off |
| any key | restart after game over |

The game pauses itself when the window loses focus.

## The ranks

- **Spry** (pink, top rank) — 30 pts
- **Drifter** (cyan, middle two ranks) — 20 pts
- **Burrower** (green, bottom two ranks) — 10 pts
- **Mystery saucer** (red, crosses the top now and then) — 50–300 pts,
  shown at the spot where you clipped it

An extra cannon is awarded at 1,500 points. Each cleared wave brings the next
fleet on one row lower. If the ranks reach your row, the bulwark falls.

## Architecture notes

Single vanilla-JS file (`game.js`), fixed 60 Hz logic via an accumulator
loop; rendering is plain canvas 2D at a crisp 448×512 with
`image-rendering: pixelated`.

The interesting bits:

- **Fleet emulation** — like the 1978 hardware, exactly *one* invader is
  advanced per logic tick, bottom rank first. A full pass over the alive
  invaders equals one discrete fleet step, so the step interval is
  `aliveCount` ticks: 55 invaders step roughly once a second, the last
  survivor sprints at 60 steps a second. The march animation flips each
  creature's frame the moment it moves, which makes the two-frame walk
  ripple visibly up through the ranks. Edge detection happens at pass
  boundaries: if the fleet would cross a margin, the whole next pass becomes
  a one-row drop and the direction reverses.
- **Shields** — each bunker is a `Uint8Array` bitmask mirrored onto a small
  offscreen canvas. Bullet and bomb tips test the mask per-pixel; hits blast
  a speckle-fringed circle out of both mask and canvas
  (`destination-out`). Invaders that overlap a bunker erase their footprint
  as they pass through.
- **Bombing** — bombs (max 3 alive) fire from the bottom-most invader of a
  randomly chosen occupied column, in two styles: a straight bolt and a
  slower wiggler that zigzags as it falls.
- **Sound** — everything is synthesized on the fly: square-wave zaps,
  filtered noise bursts, a warbling saucer hum, and the four-note descending
  bass loop that plays one note per fleet pass, so it accelerates exactly
  with the march. AudioContext is only created after a user gesture; M (or
  the header button) toggles it, persisted.
- **Storage** — `arcade.bulwark.hiscore`, `arcade.bulwark.audio`.
- **Testing hook** — when a harness sets `window.__BULWARK_TEST` before the
  script loads, `window.__bulwark` exposes a state snapshot used by the
  headless mechanics test suite (inert in normal play).
