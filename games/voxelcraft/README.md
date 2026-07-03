# Voxelcraft

A voxel sandbox set in **the Upturn** (see [LORE.md](LORE.md)), written from
scratch as static ES modules and inspired by classic block-building sandboxes
such as Minecraft.

> **Disclaimer:** Voxelcraft is an original hobby work. It is not affiliated
> with, endorsed by, or connected to Mojang or Microsoft. All code, textures,
> sounds, names, and fiction in this project are original — nothing was
> extracted from or copied out of any other game.

The only dependency is Three.js, pinned from a CDN via an import map — there is
no build step and no assets: every texture is painted pixel-by-pixel onto a
canvas atlas at boot, and every sound is synthesized with WebAudio.

## The world

- **Infinite procedural terrain** — seeded Perlin/fBm heightmap (continents,
  mountain-masked hills), **five biomes** (plains, forest, desert, the
  Rimelands' snow, the Mirelands' bog), beaches, sea level, spaghetti +
  cavern caves (guarded so they never breach standing water), deterministic
  grid-jittered cross-chunk trees (knotwood + rimewood), cacti, flowers,
  berry brambles, marsh reeds, and tall grass.
- **The deep** — below the cavern belt the carvings flood with **the
  Emberwash** (static lava: glows, burns, swimmable if you insist), lit by
  scattered **Wispcaps** (glowing cave mushrooms you can replant as lamps).
  Ores run coal → **sky-iron** (below y28) → **gloamgold** (below y14, seamed
  through the lava's territory).
- **Structures** — **the Steads-Before** (surface homestead ruins: collapsed
  cottages, leaning watch posts, root cellars) and **the Delvings-Under**
  (buried timbered mining galleries with rung shafts up to collapsed
  head-frames). Both carry seeded loot chests and weathered Notice Post
  fragments, dealt exactly once per world.
- **Weather & sky** — 10-minute day/night cycle (sun, moon, stars, blocky
  clouds, dusk tint, matched fog), rain showers that fall as snow over the
  Rimelands (settling real Snowdrifts), and **the Pearlfall**: clear-night
  meteor showers that occasionally land and seat a glowing **Starstone**.

## Survival

- **The body** — 10 hearts, hunger with a real exertion economy (sprinting
  and jumping eat), drowning with an air meter, fall damage, cactus, void,
  lava burns, starvation (gnaws to half a heart), slow well-fed regen.
- **Tools & tiers** — the Cracker (pick), Hewer (axe), Scoop (shovel), Shiv
  (blade), and **Furrower** (hoe) in plank → stone → sky-iron → **gloamgold**
  tiers, plus the meteor-forged **Star-Edge Shiv**. Per-instance durability;
  pick-gated ore drops.
- **Armor** — bark, sky-iron, and gloamgold sets (crown/jerkin/leggings/
  treads) worn in the Satchel's wear column, with per-hit durability and a
  reduced-value fall formula. Never drops on death.
- **Gleam** — the XP economy: motes shed by mining wild ore, felling wild
  beasts, the kiln's pour, and finishing gear at the bench. Fills jars
  (levels) shown on a meter over the hotbar; death spills nothing.
- **The Loomstone** — the gleam sink: weave permanent **Threads** into gear
  (Keen +2 bite, Flint 1.5× digging, Knotwood half wear, Ward +4%
  protection, and the post-boss Dusk Thread). One thread per item, carried
  on the stack through every save, chest, and drop.
- **The Whims** — timed status effects with HUD badges: Fleetfoot, Emberglow,
  Mire-rot (the Mirewalker's gift), Kelpguard, and Dimmed. Broths simmer in
  the kiln from meadow flowers and a Mirewalker's own Kelp Gland.
- **Farming** — till dirt/turf/Mire Sod into Turned Earth with a Furrower,
  plant Root Pips (meal roots) or Bogbean Pods, watch them grow (rain
  helps), and simmer Wanderer's Pottage. Feed two snuffets Root Pips and a
  **Snufflet** happens.
- **Combat** — melee with falling crits and sprint knockback, thrown sling
  stones, and the **Springstave**: hold to draw (the crosshair pinches),
  release to loose a Quill — damage and speed scale with the pull.
- **The Tuftling** — a rare meadow burrower tameable with a Silverfin
  (one-in-three; it keeps the fish either way). Follows at heel, waits on
  command, teleports after you, harries whatever you strike, and persists
  across saves — the only creature that stays.
- **The Unshaken** — the boss. Craft a **Murk Lantern** (a lantern that
  sheds dark), raise it on open ground at night, and fight the one shadow
  the flip couldn't shake off: 60 hp, Dimming blows, and a half-health
  split that peels murklings off its flanks before it starts lunging.
  Drops the **Dusk Pearl** — the Dusk Thread's material.

## Stations, blocks & fixtures

Workbench cookbook + field recipes (no crafting grid — shapes would be
ceremony), the Kiln (3-slot smelter with live progress and persistent burn),
chests, the Moss Cot (sleep to dawn, respawn anchor), Rung Ladders, two-block
Plank Doors, Wattle Fences and Gates (neighbor-aware meshing), slabs and
facing-baked stairs, writable Notice Posts, the Blast Keg (primed explosive
with chain reactions), torches with real BFS block light (custom two-channel
voxel shader — sky light dims with the day, torch light stays warm), and the
Loomstone.

## Creatures

Snuffets (and Snufflets), Murklings (night), Stalkids (cave ambush),
Pricklebacks (desert spines), Mirewalkers (shore bruisers, now lords of the
bog), Tuftlings, the day-only wandering **Peddler** (three deterministic
barter offers per world-day, holds a grudge if kicked), and The Unshaken.
Spawning is time/biome/surface gated; proper lights (torches, starstone, the
Emberwash) suppress hostile spawns nearby. Creatures share the player's fluid
contract — they float in water and burn in lava.

## Getting around

Reed Skiff boats, fishing with the Dib-Pole, and the wayfinding kit: the
Homeward Needle (compass), Sky Dial (clock), and Field Chart (a parchment map
that inks the terrain you walk while held). The pause menu has teleport
buttons (spawn, every biome, mountain, ocean, nearest ruin, nearest delving),
a Creative/Survival toggle, mouse sensitivity, and generative-music controls
(**the Murmur**: day/night/delve/cold/rain moods with crossfades).

## Controls

| Input | Action |
| --- | --- |
| WASD / Space | move / jump |
| double-tap W (or hold Ctrl) | sprint |
| double-tap Space | toggle flight, creative only (Space/Shift = up/down) |
| Shift | sneak (slow, won't fall off edges; overrides right-click routing) |
| LMB / RMB / MMB | break / use-place / pick block |
| hold RMB | eat food, draw the Springstave |
| Q | toss one item |
| 1–9 / wheel | hotbar selection |
| E | Satchel / block picker |
| F3 / F5 | debug overlay / third person |
| Esc | pause |

## Architecture

```
index.html         import map (three) + HUD DOM
src/main.js        boot, chunk streaming, fixed-step game loop, all wiring
src/noise.js       seeded Perlin 2D/3D + fBm + integer hashes
src/textures.js    procedural 16px atlas (120+ tiles) + avg tile colors
src/blocks.js      block/item registry (tiles, buckets, tools, armor, food)
src/world.js       chunk store, get/set, emitters, persistent edit overlay
src/terrain.js     heightmap/biomes/caves/ores/lava — pure fn of (x,z,seed)
src/mesher.js      culled faces + AO + BFS block light -> 3 buckets + shader
src/ruins.js       the Steads-Before: seeded surface ruins + loot
src/delvings.js    the Delvings-Under: buried galleries + loot
src/player.js      pointer-lock look, AABB physics, survival, the Whims
src/player-model.js the Wanderling body, held tools, armor overlays
src/player-viewer.js the Satchel's spinnable model viewer
src/interact.js    voxel raycast, break/place/use routing, draw, particles
src/inventory.js   slot inventory, stacks (dur + thread), save shapes
src/slotui.js      slot-grid + cursor-stack UI engine
src/craft.js       the recipe list (field + workbench)
src/kiln.js        smelting: per-kiln slots + burn/progress timers
src/gleam.js       the XP model (jars + motes)
src/loom.js        the Loomstone's threads (definitions + weaving)
src/mobs.js        species, spawn director, AI, courting, taming, the boss
src/entities.js    ground item drops
src/projectiles.js sling stones + quills (substepped ballistics)
src/explosives.js  the Blast Keg's primed entities + craters
src/meteors.js     the Pearlfall: showers, landings, starstone
src/boats.js       Reed Skiffs: buoyancy, boarding, paddling
src/fishing.js     the Dib-Pole and the dib-float
src/signs.js       Notice Post text boards
src/trade.js       the Peddler's ledger + daily offers
src/wayfinding.js  Needle/Dial widgets + the Field Chart
src/hud.js         hotbar, windows, meters, badges, boss bar (DOM)
src/sky.js         day/night lights, stars, clouds, fog, weather machine
src/rain.js        rain/snow streak rendering + drift settling support
src/audio.js       WebAudio synthesized SFX
src/music.js       the Murmur: generative ambient moods
src/save.js        localStorage save/load (additive fields, v1 migration)
```

All world features (height, biome, trees, ores, ruins, delvings) are pure
functions of world coordinates and the seed, so chunks generate independently
and features that straddle chunk borders stay coherent. Persistence is a
single localStorage save with strictly additive fields — every wave's new
state loads as sane defaults on older saves.
