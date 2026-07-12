# Lamplighter

A maze-chase about bringing light to a dark quarter. You are the town
lamplighter; walk over every unlit lantern to light it and clear the night.
Four **gloams** — amorphous wisps of smoke and shadow — hunt you through the
streets. Light one of the four corner **braziers** and the gloams turn pale
and flee for a few seconds; touch them while they run to banish them back to
their den for rising bonuses (200 / 400 / 800 / 1600 per brazier).

Every night is a brand-new procedurally generated maze. Lit corridors carry
you a little faster; gloams move faster in the dark, so the route you light
matters.

## Controls

| Input | Action |
| --- | --- |
| Arrow keys / WASD | Walk (turns are pre-buffered: press early, turn at the next intersection) |
| P | Pause (also pauses on window blur) |
| M | Toggle sound |
| Any key | Start / instant restart after game over |

## Rules

- Light **every lantern and brazier** to clear the night.
- Lantern 10 pts, brazier 50 pts, banish 200→1600 pts, night-clear bonus.
- 3 lives. Touching a non-fleeing gloam costs one.
- The side tunnels on the middle row wrap around; gloams crawl at half
  speed inside them.
- Later nights: everything is faster, scatter lulls are shorter, and the
  brazier flee window shrinks.

## The four gloams

| Gloam | Behavior |
| --- | --- |
| Ashen (ember red) | Direct chaser — targets your tile |
| Vesper (violet) | Interceptor — targets 4 tiles ahead of your facing |
| Murk (teal) | Flanker — targets the point mirrored across you from Ashen |
| Smolder (amber) | Wanderer — drifts toward the largest unlit region |

A global timer alternates **pursue** and **scatter** (the four maze corners),
so pressure comes in escapable waves. At intersections a gloam picks the
neighboring tile that minimizes straight-line distance to its target and may
never reverse, except when the mode flips or a brazier is lit.

## Architecture

Vanilla JS, no dependencies, no build step. Plain script tags share three
globals:

- `src/maze.js` — procedural maze generation. Growing-tree carve on the
  left-half lattice, mirrored for left-right symmetry, center-column
  connectors, a den chamber ringed by a guaranteed loop, wrapping side
  tunnels, then repeated symmetric dead-end knock-out passes so corridors
  loop. Lanterns are spaced (intersections first) and validated reachable by
  BFS from spawn; a BFS field to the den door guides banished gloams home.
- `src/audio.js` — `Sfx` class, Web Audio synthesized blips/whooshes/
  arpeggios. AudioContext created only after a user gesture; mute state
  persisted.
- `src/main.js` — fixed-timestep logic (120 Hz accumulator) with
  interpolated rendering. Movement is continuous but decisions happen only
  at tile centers; the player's next turn is pre-buffered with a
  corner-cutting tolerance. Rendering layers a static maze canvas, warm
  light pooling on lit tiles, glow sprites, a smoke-blob renderer for the
  gloams (layered drifting circles with a single faint ember core), and a
  cool vignette.

localStorage keys: `arcade.lamplighter.high`, `arcade.lamplighter.audio`.
