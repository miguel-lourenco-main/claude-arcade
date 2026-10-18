# Voxelcraft — direction

What the game is for, what it is not, and where it is going. The story itself
lives in [LORE.md](LORE.md); this file is about play.

## Pillars

1. **A world that turned over.** Everything in the Upturn traces back to the
   flip: what was sky is stone, the seabed hangs overhead, the drowned stars
   fall back as pearls. A new feature should be explainable from that premise.
2. **Polite danger.** Threats are real but they announce themselves (a horn
   at dusk, a rock with knees). Torchlight is a literal promise. The game is
   tense at night and kind in the morning.
3. **Exertion, not grind.** Survival is an economy of effort: sprinting eats,
   mining wants the right tier, travel wants a way or a wing. Rewards are
   proportional to what the player spent, and nothing is a chore for its own
   sake.
4. **The world remembers.** Chests are dealt once, steadfolk stay dead,
   turned earth stays turned, and the save is additive forever. Choices have
   weight because they persist.
5. **No ceremony.** Crafting is a list, not a grid. Every UI exists to get the
   player back into the world faster. No build step, no assets, no
   dependencies beyond Three.js.

## What it is

- A single-player survival sandbox with discoverable structures, a growing
  material ladder (knotwood → stone → sky-iron → gloamgold → starstone/nacre),
  two skies, and a small number of authored set-piece fights.
- A place with inhabitants: the Peddler, the Living Steads and their folk.
  The world's people are what the next waves build out: what you owe them, what
  they offer, what they remember about you.

## What it is not

- Not a Minecraft clone. It borrows the grammar (blocks, tiers, a day cycle)
  and then makes its own nouns. Nothing is copied: names, textures and sounds
  are all original.
- Not multiplayer, not online. A save file you can carry between browsers is
  as far as it goes.
- Not a content treadmill. A wave adds a few things that connect to what's
  already there, and each one gets a LORE entry.

## Roadmap

Tracked in GitLab epic #1. Three waves, ordered by dependency.

### Wave A: foundations and quick wins
- Foundation docs: this file, `CLAUDE.md`, README refresh (#2).
- **Rarity → value** (#3, keystone): a continuous rarity per item, seeded
  from how it enters the world and overridable per item, with one derived
  value that every economic system reads.
- Crouch lowers the camera and hitbox; sneaking grips a ladder (#4).
- A hidden saturation buffer, so a good meal fills you for longer (#5).
- Swimming always pulls you down a little; Space is how you stay up (#6).

### Wave B: crafting, economy, persistence
- The ingredient-filter cookbook: hover to preview, double-click to pin,
  pins narrow the list to an exact recipe (#7).
- **Standing** (#8, keystone): a signed reputation per stead. Trades and gifts
  raise it; violence and theft sink it.
- Fair-value trades priced by rarity, skewed by a trader's disposition and
  your standing (#9).
- Raider or friend: steadfolk carry goods and traders carry finite stock.
  Taking it by force pays, and the stead remembers (#10).
- More ore, in veins whose size falls off with rarity (#11).
- Save export/import to a file (#12).

### Wave C: world and narrative
- The Upturn's playable arc (#13), a **writing gate** that needs the owner's
  voice. Cities and story quests wait on it. A draft proposal is in
  [UPTURN-ARC.md](UPTURN-ARC.md); it isn't canon until the owner accepts it.
- Settlement tiers and spacing: hamlets, villages, dense villages, clustered by
  a density field, with a reserved hook for cities (#14).
- A quest engine with fetch and skill quests from steadfolk. Story and epic
  quests come after #13 (#15).

## Open direction questions

- How linear should the arc be, and does the Upturn have an ending? (#13)
- Should a reusable per-game docs template be extracted from this file and
  `CLAUDE.md` now, or after a second game needs one? (#2)
