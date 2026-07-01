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
- **Movement feel** — classic camera-relative WASD with a proper
  acceleration/friction model applied as a vector (crisp starts, firm stops,
  no speed bleed while the camera turns), pointer-lock spike filtering, and a
  mouse-sensitivity slider. Flight is omnidirectional: W follows the camera
  pitch, so look down to descend. An experimental world-static mode (W is
  always north) is available via the pause-menu toggle.
- **Survival mode** — new worlds start as "normal" Steve: 10 hearts, fall
  damage (blocks fallen − 3), drowning with an air-bubble meter, cactus and
  void damage, slow passive regen, death screen with respawn. Blocks take
  real time to mine (per-block hardness with a crack overlay) and drop
  collectible items (MC rules: stone → cobblestone, grass → dirt, leaves and
  glass → nothing) that magnetize into a counted inventory; placing consumes
  them and the picker becomes your inventory. No flying, shorter reach.
  Simplifications: no hunger (no food exists) and no tools (hand-mining times
  are scaled to stay fun). Toggle Creative/Survival any time in the pause
  menu; pre-survival saves stay creative.
- **Getting around** — new worlds spawn in a forest; the pause menu has
  teleport buttons (spawn, forest, plains, desert, snow, mountain, ocean) that
  search the world outward from where you stand.
- **First-person hand** — the selected block bobs in your hand and swings on
  every break/place.
- **Crafting** — a flat recipe list in the survival inventory (E): log → 4
  planks, 8 planks → chest, coal ore + planks → 4 torches, sand → glass,
  4 sand → sandstone, cobblestone → stone, 4 stone → 4 bricks. Smelting is
  folded into recipes (no furnace) and there's no crafting grid — with no
  tools or intermediate items, shapes would be ceremony without depth.
- **Chests** — craft and place them, right-click to open (sneak-place to
  build against them), click stacks to move them between chest and
  inventory. Contents persist in the save and spill out as drops when the
  chest is broken.
- **Saplings** — leaves have a 10% chance to drop one; plant it and it grows
  into a real tree after 30–60 seconds. Grown trees are written as block
  edits, so they persist like anything you build.
- **Mobs** — blocky pigs wander the grass around you: idle/walk AI, real
  collision with 1-block hops, occasional oinks, day/night shading. Punch
  them (3 HP) and they knock back; no drops — there's nothing to cook them
  on yet.
- **Persistence** — seed, player state, hotbar, movement mode, game mode,
  health/air, inventory, chest contents, growing saplings, time of day, and
  every block edit autosaved to localStorage (validated on load). Reset from
  the pause menu.

## Controls

| Input | Action |
| --- | --- |
| WASD / Space | move / jump |
| double-tap W | sprint |
| double-tap Space | toggle flight (Space/Shift = up/down) |
| Shift | sneak (slow, won't fall off edges) |
| LMB / RMB / MMB | break / place / pick block |
| 1–9 / wheel | hotbar selection |
| E | block picker (your inventory, in survival) |
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
