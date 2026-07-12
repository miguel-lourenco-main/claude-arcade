# Gloamkeep

A from-scratch software-raycast first-person game on a 2D canvas — the
classic early-90s raycaster *technique* (grid map, DDA rays, billboarded sprites),
with entirely original setting, maps, art, and sound. You carry an emberlock
through three floors of a haunted keep where shadow-creatures — gloams —
roam torch-lit halls. Find the sigil-keys, open what's sealed, use the
glowing way-sigil to descend.

The automap is fogged: it only charts what you have actually seen. Some
secret push-walls are mere shortcuts; a rare few guard **hidden vaults** —
sealed rooms that don't exist on the automap until the wall grinds open,
holding the keep's best loot.

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
treasures (chalice +250, idol +500, Duskcrown +1000), exit bonus (+500).
Best score persists in `localStorage` (`arcade.gloamkeep.*`).
Health/ammo/ward/score carry between floors; keys and buffs do not.

## Items

| Item | Effect |
| --- | --- |
| **Pale tonic** | +25 vigor |
| **Grand tonic** | +60 vigor |
| **Ember vials** | +12 shots |
| **Ember cache** | +30 shots |
| **Warding stone** | +50 ward — each hit is half-soaked by ward before vigor |
| **Wraith ember** | emberlock deals double damage for 15 s |
| **Phase draught** | move 40% faster for 20 s |
| **Seer's orb** | bares the whole floor on the automap and tints unopened secret walls gold |
| **Ember shard / chalice / idol / Duskcrown** | score (+100 / +250 / +500 / +1000) |
| **Sigil-keys** | open the matching sealed door |

The best of these — warding stones, wraith embers, seer's orbs, idols and
the Duskcrown — live in the hidden vaults.

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
  on a separate pass; vault rules — no keys/spawn inside, openable from
  outside, no items on push-wall slide paths). Hidden regions are *derived*:
  any floor pocket sealed off except for a push-wall becomes a vault
  automatically. Pure module.
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
