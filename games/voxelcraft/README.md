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
- **The deep** — sloped **cave mouths** breach the surface on dry land, so
  the old-sky caves are discoverable on foot; cave walls, floors, and
  ceilings are an ore-rich shell that beats strip-mining blind. Below the
  cavern belt the carvings flood with **the Emberwash** (static lava: glows,
  burns, swimmable if you insist), lit by scattered **Wispcaps** (glowing
  cave mushrooms you can replant as lamps) and tufts of **Gleam Moss** (a
  faint self-lit moss that presses onto any solid face — floor, wall, or
  ceiling). Ores run coal → **sky-iron** (below y28) → **gloamgold** (below
  y14, seamed through the lava's territory), plus a vanishingly rare buried
  starstone in the deep cave skin.
- **Structures** — **the Steads-Before** (surface homestead ruins: collapsed
  cottages, leaning watch posts, root cellars) and **the Delvings-Under**
  (buried timbered mining galleries with rung shafts up to collapsed
  head-frames). Both carry seeded loot chests and weathered Notice Post
  fragments, dealt exactly once per world. A rare few homesteads came
  through the flip WHOLE: **the Living Steads** — intact cottages, a well,
  a fenced meal-root patch, and 2-3 resident **Steadfolk** who potter the
  courtyard by day, head indoors at dusk, each barter three goods a day
  from their job (grower/wright/keeper), warm to a repeat customer, and
  persist: the same folk are there when you come back, unless the dark
  got one while you were away.
- **The Undersky** — a second dimension: the drowned old floor of the
  flip, reached through a **Cinder Door** (below). Permanent dusk under
  close bright stars, pearlsand dunes over slate, glowing **Starkelp**,
  and **the pearl-beds** — basins where lit starstone studs the open
  floor and the **Shellback** keeps it.
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
  reduced-value fall formula. Never drops on death. Two one-off pieces sit
  above the sets: the **Wanderwing** (a Loomstone-woven wing-cape in the
  jerkin slot — no plate, dur spent by glide seconds) and the **Nacre
  Crown** (gloam-crown protection, and the air meter doubles — the
  wearer's lungs remember the sea).
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
  across saves.
- **Bondlings** — feed a snuffet bog berries enough times (one-in-three per
  berry, cap of three) and it ties on a scarf in your colors: it follows,
  sits on command, teleports after you when stranded, and headbutts whatever
  hurts its person — hostiles feud back, mob-vs-mob. Bondlings persist
  across saves and never drop loot, only a mourning chime.
- **The Prowl** — a seeded night-siege event: some nights (deterministic in
  seed + night, never a Pearlfall night, never while The Unshaken stalks) a
  horn sounds at dusk and tagged hunters press toward you all night at 3×
  cadence, +20% pace, double loot. Torchlight holds; standing the whole
  night earns the quiet-morning mend.
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

**The Sky-Iron Pail & the Cinder Door** — the Pail scoops and pours the
world's own Water/Emberwash cells; where the two fluids meet, the molten
cell slakes into **Cinderglass** (a renewable quarry: caves + pail).
Stand a Cinderglass ring upright (interior 2-4 wide, 3-4 tall, corners
optional), give it back a full Ember Pail, and the ring fills with a
glowing film: stand in it a moment and you cross to the Undersky.
Arrival reuses (or politely raises) a return door; breaking any ring
stone folds the whole film; each sky keeps its own boats, carts, and
ground drops, while bonded companions always cross with you. Death under
the far sky sends you home.

**Festival Rockets** — three crafted variants (coal wound with a colour
agent) whose burst follows the agent: gold willow, red sphere, nacre
ring. Launched from the hand to bloom overhead (nearby grazers bolt;
the dark is unmoved), or spent MID-GLIDE to thrust the Wanderwing — the
long-distance flight loop. Every seventh world-day is Fairday, and the
Peddler's board tops with one.

## Creatures

Snuffets (and Snufflets, and berry-bonded bondlings), Murklings (night —
and by day in dark caves), Stalkids (cave ambush), Pricklebacks (desert
spines), Mirewalkers (shore bruisers, now lords of the bog), Tuftlings, the
day-only wandering **Peddler** (three deterministic barter offers per
world-day, holds a grudge if kicked), the **Steadfolk** (a Living Stead's
residents — passive, leashed to their well, trading from job tables), the
**Shellback** (the pearl-beds' keeper: a nacre-shelled ambusher that parks
as one more boulder of the bed floor, sheds **Nacre** — the material of
the Nacre Crown — and is the one hostile the light doesn't turn away),
and The Unshaken. Spawning is time/biome/surface gated; proper lights
(torches, starstone, the Emberwash) suppress hostile spawns nearby, while
dim flora (Wispcaps, Gleam Moss, Starkelp) only guards its own small pool
of light. Night creatures caught by dawn deep in a cave keep their posts.
Creatures share the player's fluid contract — they float in water and
burn in lava.

## Getting around

**Waybars & Trundles** — auto-shaping rail track (straights, corners, and
stepped slopes bake into the block as the web of neighbors changes) and a
rideable sky-iron cart that rolls it: gravity on the slopes, a parked wake on
reload, two kicks to fold it back into the satchel. **The Wanderwing** —
hold Space while falling with the wing worn and glide: the camera steers,
pitch trades height for speed, a flare lands you soft, and a Festival
Rocket spent mid-glide thrusts you forward. Also Reed Skiff boats,
fishing with the Dib-Pole, and the wayfinding kit: the
Homeward Needle (compass), Sky Dial (clock), and Field Chart (a parchment map
that inks the terrain you walk while held). The pause menu has teleport
buttons (spawn, every biome, mountain, ocean, nearest ruin, nearest delving,
nearest stead), a Creative/Survival toggle, mouse sensitivity, and
generative-music controls (**the Murmur**: day/night/delve/cold/undersky
moods with crossfades, plus rain and Prowl-pulse overlays).

## Controls

| Input | Action |
| --- | --- |
| WASD / Space | move / jump |
| double-tap W (or hold Ctrl) | sprint |
| double-tap Space | toggle flight, creative only (Space/Shift = up/down) |
| hold Space, falling | deploy the Wanderwing (worn) and glide |
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
src/undersky.js    the far side: pearlsand dunes, pearl-beds, starkelp
src/portal.js      the Cinder Door: frame scan, film collapse, arrivals
src/mesher.js      culled faces + AO + BFS block light -> 3 buckets + shader
src/ruins.js       the Steads-Before: seeded surface ruins + loot
src/delvings.js    the Delvings-Under: buried galleries + loot
src/steads.js      the Living Steads: intact homesteads + resident manager
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
src/mobs.js        species, spawn director, AI, courting, taming, bondlings, the boss
src/prowl.js       the Prowl: seeded night sieges + the quiet morning
src/entities.js    ground item drops
src/projectiles.js sling stones + quills (substepped ballistics)
src/explosives.js  the Blast Keg's primed entities + craters
src/fireworks.js   Festival Rockets: ascent, bursts, the glide boost
src/meteors.js     the Pearlfall: showers, landings, starstone
src/boats.js       Reed Skiffs: buoyancy, boarding, paddling
src/rails.js       the Waybar auto-shaper + track geometry oracle
src/carts.js       Trundles: rolling physics, boarding, parking
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

All world features (height, biome, trees, ores, ruins, delvings, pearl-beds)
are pure functions of world coordinates and the seed, so chunks generate
independently and features that straddle chunk borders stay coherent. Each
dimension is its own World instance behind a current-dimension binding — the
Undersky partitions its edits, stations, and fleets automatically, and a
Cinder Door crossing just re-points the world and restreams. Persistence is a
single localStorage save with strictly additive fields — every wave's new
state loads as sane defaults on older saves.
