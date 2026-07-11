# Gloamkeep

A from-scratch software-raycast first-person game on a 2D canvas — the
classic early-90s raycaster *technique* (grid map, DDA rays, billboarded sprites),
with entirely original setting, maps, art, and sound. You carry an emberlock
through three floors of a haunted keep where shadow-creatures — gloams —
roam torch-lit halls. Find the sigil-keys, open what's sealed, use the
glowing way-sigil to descend.

## Controls

| Input | Action |
| --- | --- |
| **WASD** | move + strafe |
| **Mouse** (pointer lock) | look; **←/→** arrow keys turn without it |
| **LMB / Space** | fire the emberlock |
| **E** | use: open/close doors, shove suspicious walls, take the exit |
| **M** | toggle minimap |
| **N** | toggle sound |
| **P / Esc** | pause (also pauses on window blur / losing pointer lock) |
| **R / Enter** | instant restart on the death screen |

Scoring: kills (100–500 by type), ember shards (+100), secrets (+250),
exit bonus (+500). Best score persists in `localStorage`
(`arcade.gloamkeep.*`). Health/ammo/score carry between floors; keys do not.

## Bestiary

- **Gloam** — wispy shadow-blob; patrols, lunges.
- **Stalker** — fast, thin, fragile; closes distance alarmingly.
- **Husk** — robed ember-core caster; looses shadow bolts from range.
- **Warden** — the hulking keeper of the third floor's gold sigil.

Enemies idle or patrol until they see you — or *hear* a shot fired nearby
(hearing propagates through open space, not walls). They chase via grid
pathing, open unlocked doors, and attack with cooldowns (melee lunge or
ranged bolt). 2–3 animation frames each, plus a death frame.

## Architecture

Vanilla JS, zero dependencies, no build step. The files are classic scripts
(not ES modules, which Chrome blocks on `file://`) loaded in dependency
order; each attaches its API to the page-global `Gloamkeep` namespace, so
double-clicking `index.html` just works.

- `src/maps.js` — three handcrafted ASCII grid maps + parser + reachability
  validator (progressive BFS that respects key/door gating; secrets checked
  on a separate pass). Pure module.
- `src/game.js` — the whole simulation, DOM-free and deterministic (seeded
  RNG): DDA raycast (`castRay`, shared by rendering, hitscan, line-of-sight
  and the use-key), circle-vs-grid collision resolved per axis (wall
  sliding), sliding doors with animated offset (affects both rays and
  collision), secret push-walls (analytic ray-vs-moving-box while in
  motion), enemy AI state machine (idle/patrol → alert → chase via a
  BFS distance field → attack), projectiles, pickups, scoring. Fixed
  timestep (`tick`, 60 Hz accumulator in `main.js`).
- `src/textures.js` — all art generated once at boot into offscreen
  canvases and extracted as `Uint32Array` pixel data: 64×64 wall textures
  (stone, moss, banner, doors, sealed doors, way-sigil exit), enemy sprite
  frame sets, pickups, torch flames, the first-person weapon.
- `src/render.js` — software renderer at 480×300 upscaled with crisp
  pixels, FOV 66°: one DDA ray per column, fisheye corrected with
  `cos(rayAngle − viewAngle)`, slice height ∝ 1/perpDistance, texture
  column from the fractional hit position, distance darkening + darker
  E/W faces, torch-flicker light. Sprites are projected, scaled by depth,
  sorted far-to-near and clipped per column against the wall z-buffer.
  Floor/ceiling are vertical gradients. Wall and sprite inner loops are
  allocation-free. Plus: weapon bob/recoil/muzzle flash, directional
  damage flashes, low-health vignette, minimap.
- `src/audio.js` — Web Audio synth SFX (shot, growls scaled by proximity,
  door rumble, pickup chimes, bolt zaps, jingles). Context created only
  after a user gesture; respects the sound toggle.
- `src/main.js` — input (pointer lock + keyboard fallback), the
  accumulator loop, HUD, overlays and flow (title / pause / level tally /
  death / victory), persistence.

## Tests

The logic core runs in Node with no DOM, and a headless-Chrome suite drives
the real page (over both `http://` and `file://`) through every feature
above — see `test/README.md`:

```
node test/logic.test.js       # core rules, plain asserts
node test/engine.test.mjs     # deep engine suite + perf smoke
node test/browser.test.mjs    # headless Chrome, real buttons and keys
```
