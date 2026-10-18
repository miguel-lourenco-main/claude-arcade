# Voxelcraft — working notes for agents

Voxelcraft is the arcade's one ES-module game: a voxel sandbox set in **the
Upturn**. Read this file first, then [DIRECTION.md](DIRECTION.md) (what the game
is for and where it's going) and [LORE.md](LORE.md) (the story and art bible).
[README.md](README.md) is the player-facing feature list and module map.

## Run it

There is no build step and no package manager. Serve the **repo root** over
http (ES modules don't load from `file://`) and open the game:

```sh
python3 -m http.server 8000          # from the repo root
# http://localhost:8000/games/voxelcraft/
# http://localhost:8000/games/voxelcraft/?nolock   (test mode, see below)
```

Three.js is the only dependency, pinned in the `index.html` import map
(`three@0.160.0` from jsDelivr). Every texture is painted onto a canvas atlas
at boot (`textures.js`) and every sound is synthesized (`audio.js`,
`music.js`). Don't add assets, a bundler, or npm dependencies.

## Test it

```sh
node run-tests.mjs voxelcraft               # every suite, via the arcade runner
node run-tests.mjs --logic voxelcraft       # node-only suites (fast, no browser)
node games/voxelcraft/test/browser.test.mjs # headless Chrome boot + feature probes
```

- Logic tests import the game's own modules under node. `test/_hooks.cjs`
  stubs the bare `three` specifier; import it first and load game modules with
  dynamic `import()`. Only pure modules work there (anything that touches
  `document` or builds meshes at import time won't).
- The browser suite boots `?nolock`, which runs input and physics without
  pointer lock and exposes `window.voxelcraft` (the test handle at the bottom
  of `main.js`). Add to that handle when a new system needs probing; never ship
  behavior that only exists in nolock mode. It needs network access for the CDN.
- Pure logic you add (formulas, tables, resolvers, save shapes) gets a logic
  test. Gameplay gets at least a browser probe and a clean-console boot.

## Code shape

- `src/main.js` boots, streams chunks, runs the fixed-step loop, and wires
  every system through small callbacks (`onKill`, `onTradeMob`, ...). New
  systems live in their own module and get wired here. Keep `main.js` as wiring.
- `src/blocks.js` is the item registry. Everything is a `def(name, opts)` entry
  in `BLOCKS[id]`; the defaults block documents every field. New fields are
  optional and default to "off".
- World features are **pure functions of (coords, seed)** — terrain, ores,
  ruins, delvings, steads, pearl-beds. A chunk must generate the same way
  regardless of load order. Footprints stay inside their own chunk unless
  the feature is designed for cross-chunk coordination (trees are).
- Randomness is seeded (`noise.js`: `hash2`, `mulberry32`). `Math.random` is
  fine for cosmetic jitter and spawn rolls, never for anything a reload must
  reproduce.
- See README "Architecture" for the module map. Update it when you add one.

## Save contract

One localStorage save (`voxelcraft.save.v1`, written by `save.js` every 5 s and
on unload). Fields are **strictly additive**: a new field must load as a sane
default when absent, and old fields are never repurposed. Validate everything
on load (`Number.isFinite`, shape checks); a bad field falls back to its
default, it never throws. Comment each new field in `writeSave` the way the
existing ones are commented.

## The LORE naming contract

- Player-facing names, captions and copy are in the Wanderlings' folk register
  (Knotwood, Sky-Iron, the Cracker, Gleam). Generic basics stay plain (Dirt,
  Stone, Torch, Chest). Never reuse another game's specific item vocabulary.
- **Code identifiers, `TILE` keys, block ids and save keys never change** when
  a display name does (`IRON_PICK` is "Sky-Iron Cracker"; `POPPY` is Emberbell).
- New flora, creatures and places get a LORE.md glossary entry in the same
  change. The tone is cozy, dry, a little melancholy at night: danger is real
  but polite and announces itself.

## Development cadence

Work lands in **waves**: a themed batch of features, one commit each, then a
docs pass that weaves the wave into README and LORE. Commits are Conventional
Commits scoped to the game, `feat(voxelcraft): <name> — <what it is>`, with a
body that lists what changed, why, and how it was verified. The current
roadmap waves (A/B/C) are tracked in GitLab epic #1 and summarized in
DIRECTION.md.

## Tuning numbers

Constants sit at the top of their module with a comment giving units and
intent (`HUNGER_JUMP = 0.12; // hunger per jump`). When you change one, keep
the comment honest. When an issue doesn't fix a number, choose a conservative
one and call it out in the MR for the owner.
