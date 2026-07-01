# Voxelcraft

A Minecraft-style voxel sandbox, written from scratch as static ES modules.
The only dependency is Three.js, pinned from a CDN via an import map — there is
no build step and no assets: every texture is painted pixel-by-pixel onto a
canvas atlas at boot, and every sound is synthesized with WebAudio.

## Features

- **Infinite procedural terrain** — seeded Perlin/fBm heightmap (continents,
  mountain-masked hills), four biomes (plains, forest, desert, snow), beaches,
  sea level, spaghetti + cavern caves, deterministic cross-chunk trees, cacti,
  flowers and tall grass.
- **Minecraft-style rendering** — chunked meshing (16×96×16) with hidden-face
  culling, per-face directional shade, classic 3-sample vertex ambient
  occlusion (with quad-diagonal flip), cutout bucket for plants/glass and a
  translucent lowered-surface water bucket. Nearest-neighbor 16px textures.
- **Player physics** — AABB collision with substepping, gravity/jump tuned to
  MC-like constants, double-tap-W sprint (with FOV kick), sneak, swimming,
  double-tap-space creative flight.
- **Interaction** — 5-block voxel raycast, block highlight, instant break with
  hold-repeat, placement with player-overlap rejection, middle-click pick
  block, break particles, procedural dig/place sounds.
- **World feel** — 10-minute day/night cycle: moving sun and moon, stars,
  scrolling blocky clouds, dusk tint, fog matched to sky, underwater fog.
- **Persistence** — seed, player state, hotbar, time of day, and every block
  edit autosaved to localStorage. Reset from the pause menu.

## Controls

| Input | Action |
| --- | --- |
| WASD / Space | move / jump |
| double-tap W | sprint |
| double-tap Space | toggle flight (Space/Shift = up/down) |
| Shift | sneak (slow) |
| LMB / RMB / MMB | break / place / pick block |
| 1–9 / wheel | hotbar selection |
| E | block picker |
| F3 | debug overlay |
| Esc | pause |

## Architecture

```
index.html        import map (three) + HUD DOM
src/main.js       boot, chunk streaming, fixed-step game loop
src/noise.js      seeded Perlin 2D/3D + fBm + integer hashes
src/textures.js   procedural 16px atlas (25 tiles) + avg tile colors
src/blocks.js     block registry (tiles, buckets, collision, sounds)
src/world.js      chunk store, get/set, persistent edit overlay
src/terrain.js    heightmap/biomes/caves/trees — pure fn of (x,z,seed)
src/mesher.js     culled faces + vertex AO -> 3 geometry buckets
src/player.js     pointer-lock look + AABB physics
src/interact.js   voxel raycast, break/place/pick, particles
src/hud.js        hotbar, picker, debug, overlays (DOM)
src/sky.js        day/night lights, stars, clouds, fog
src/audio.js      WebAudio noise-burst SFX
src/save.js       localStorage save/load
```

All world features (height, biome, tree placement) are pure functions of world
coordinates and the seed, so chunks generate independently and features that
straddle chunk borders (tree canopies) stay coherent.
