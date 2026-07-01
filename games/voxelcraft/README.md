# Voxelcraft

A Minecraft-style voxel sandbox, written from scratch as static ES modules.
The only dependency is Three.js, pinned from a CDN via an import map — there is
no build step and no assets: every texture is painted pixel-by-pixel onto a
canvas atlas at boot, and every sound is synthesized with WebAudio.

## Features

- **Infinite procedural terrain** — seeded Perlin/fBm heightmap (continents,
  mountain-masked hills), four biomes (plains, forest, desert, snow), beaches,
  sea level, spaghetti + cavern caves (guarded so they never breach standing
  water), coal/iron ore veins, deterministic grid-jittered cross-chunk trees,
  cacti, flowers and tall grass.
- **Minecraft-style rendering** — chunked meshing (16×96×16) with hidden-face
  culling, per-face directional shade, classic 3-sample vertex ambient
  occlusion (with quad-diagonal flip), cheap column sky-light so caves and
  interiors actually get dark, cutout bucket for plants/glass and a
  translucent, animated, lowered-surface water bucket. 16px nearest-neighbor
  textures.
- **Player physics** — AABB collision with substepping, gravity/jump tuned to
  MC-like constants, double-tap-W sprint (with FOV kick), sneak with an edge
  guard (you can't walk off a ledge while sneaking), swimming with a water-exit
  boost, double-tap-space creative flight, view bobbing, void respawn.
- **Interaction** — 5-block voxel raycast, block highlight, instant break with
  hold-repeat plus sweep-breaking (drag the crosshair to mow through blocks),
  placement with player-overlap rejection, middle-click pick block, break
  particles, procedural dig/place/footstep sounds. Bedrock is indestructible.
- **World feel** — 10-minute day/night cycle: moving sun and moon, stars,
  scrolling blocky clouds, dusk tint, genuinely dark blue-ish nights, fog
  matched to sky and view distance, underwater fog.
- **Torch light** — a real block-light system: BFS flood fill from every torch
  (level 14, blocked by walls, wraps around corners), rendered through a custom
  two-channel voxel shader — sky light dims with the day/night cycle, torch
  light stays warm through the night.
- **Grid movement** — WASD moves along fixed world axes (W is always north),
  decoupled from the camera; look around freely without changing your heading.
  Toggle back to classic camera-relative movement in the pause menu.
- **Getting around** — new worlds spawn in a forest; the pause menu has
  teleport buttons (spawn, forest, plains, desert, snow, mountain, ocean) that
  search the world outward from where you stand.
- **First-person hand** — the selected block bobs in your hand and swings on
  every break/place.
- **Persistence** — seed, player state, hotbar, movement mode, time of day, and
  every block edit autosaved to localStorage (validated on load). Reset from
  the pause menu.

## Controls

| Input | Action |
| --- | --- |
| WASD / Space | move (world-fixed N/W/S/E by default) / jump |
| double-tap W | sprint |
| double-tap Space | toggle flight (Space/Shift = up/down) |
| Shift | sneak (slow, won't fall off edges) |
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
