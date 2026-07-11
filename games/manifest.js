// Registry of games available in the arcade.
// Classic script (not a module) so the shell also works when opened via file://.
window.GAMES = [
  {
    slug: "voxelcraft",
    title: "Voxelcraft",
    genre: "Sandbox / Voxel",
    description:
      "A voxel sandbox set in the Upturn: infinite procedural terrain, biomes, " +
      "day/night cycle, block building. All code and textures generated from scratch.",
  },
  {
    slug: "wyrm",
    title: "Wyrm",
    genre: "Arcade / Grid",
    description:
      "Steer a glowing wyrm around a dark grid, devouring embers to grow longer " +
      "and faster — one wrong turn into a wall or your own body ends the run.",
  },
  {
    slug: "fuse",
    title: "Fuse",
    genre: "Puzzle / Sliding",
    description:
      "Slide the 4×4 grid and fuse equal tiles into their doubled value along a " +
      "cold-to-hot ember palette. Reach the burning-gold 2048 tile — then keep going.",
  },
  {
    slug: "dowser",
    title: "Dowser",
    genre: "Puzzle / Logic",
    description:
      "Something hollow sleeps under this field — dig every safe plot, read the " +
      "numbers, and plant markers where the rod trembles before the ground gives way.",
  },
  {
    slug: "brickstorm",
    title: "Brickstorm",
    genre: "Arcade / Paddle",
    description:
      "A paddle, a ball, and a wall that deserves it — smash procedural brick " +
      "patterns, catch falling power capsules, and hang on as the ball ramps faster.",
  },
  {
    slug: "mothlight",
    title: "Mothlight",
    genre: "Arcade / One-button",
    description:
      "You are a moth drawn down a lantern-lit hollow at night — flap to stay " +
      "aloft and weave through the gaps between hanging lantern-chains.",
  },
  {
    slug: "softfall",
    title: "Softfall",
    genre: "Arcade / Physics",
    description:
      "Ride gravity down and feather the throttle: land on flat pads carved into " +
      "jagged vector terrain. Smaller pads pay more — every touchdown refuels less.",
  },
  {
    slug: "shardfield",
    title: "Shardfield",
    genre: "Arcade / Space",
    description:
      "Pilot a lone ship through a wrapping field of splitting rock shards — pure " +
      "inertia, four bullets, and saucers that learn your name. Glowing vector lines.",
  },
  {
    slug: "crateshift",
    title: "Crateshift",
    genre: "Puzzle / Box-pusher",
    description:
      "Night shift at the dockyard: shove every crate onto its glowing pad. One " +
      "push at a time, no pulling — a crate in a corner is a crate lost. 21 shifts.",
  },
  {
    slug: "gemgrove",
    title: "Gemgrove",
    genre: "Puzzle / Match-3",
    description:
      "Swap neighbouring gems to line up three or more, ride the cascades, and " +
      "forge cross and burst gems to beat each level's target before moves run out.",
  },
  {
    slug: "bulwark",
    title: "Bulwark",
    genre: "Arcade / Shooter",
    description:
      "Fifty-five pixel-creatures march down in lockstep, sprinting as their ranks " +
      "thin. Four crumbling bunkers and one bolt at a time stand between them and you.",
  },
  {
    slug: "patience",
    title: "Patience",
    genre: "Cards / Solitaire",
    description:
      "Full Klondike with seeded, shareable deals: drag runs across seven piles, " +
      "undo everything, and finish with a physics-driven cascade of bouncing cards.",
  },
  {
    slug: "reversi",
    title: "Reversi",
    genre: "Board / Strategy",
    description:
      "Bracket enemy discs between two of yours to flip whole lines at once — " +
      "outwit three tiers of AI, up to a deep endgame-solving searcher, or duel hotseat.",
  },
  {
    slug: "quarry",
    title: "Quarry",
    genre: "Puzzle / Falling-block",
    description:
      "Stack the twelve five-cell pentomino stones in a 12-wide pit and collapse " +
      "full seams before the quarry floods — five rows at once is a MOTHERLODE.",
  },
  {
    slug: "lamplighter",
    title: "Lamplighter",
    genre: "Arcade / Maze",
    description:
      "Light every lantern in a night-time maze while four smoke-wisp gloams with " +
      "distinct hunting personalities close in — kindle a brazier to banish them.",
  },
  {
    slug: "chess",
    title: "Chess",
    genre: "Board / Strategy",
    description:
      "Full legal chess against a three-strength AI or a friend — castling, en " +
      "passant, promotions, every draw rule, and an engine that punishes loose tactics.",
  },
  {
    slug: "delve",
    title: "Delve",
    genre: "RPG / Roguelike",
    description:
      "Nine procedural floors beneath the Upturn stand between you and the First " +
      "Pearl. Torchlight, bump combat, and a save that dies with you.",
  },
  {
    slug: "gloamkeep",
    title: "Gloamkeep",
    genre: "FPS / Raycaster",
    description:
      "Carry an emberlock through three torch-lit floors of a haunted keep where " +
      "gloams roam — find the sigil-keys, shove suspicious walls, reach the way-sigil.",
  },
  {
    slug: "palisade",
    title: "Palisade",
    genre: "Strategy / Tower defense",
    description:
      "Creeps march the fixed trail toward your gate — buy, upgrade, and sell four " +
      "tower types to hold all 20 waves across three maps.",
  },
  {
    slug: "slipstream",
    title: "Slipstream",
    genre: "Arcade / Racer",
    description:
      "Pseudo-3D checkpoint racer: beat the clock through five themed stages, weave " +
      "through traffic, and brake into the bends before the pull throws you off the road.",
  },
  {
    slug: "rootguard",
    title: "Rootguard",
    genre: "Strategy / Lane defense",
    description:
      "Plant magical flora across a 5-lane grove to stop the shambling blights: " +
      "collect dew, manage seed cooldowns, and survive five levels to the FINAL SURGE.",
  },
  {
    slug: "fernfoot",
    title: "Fernfoot",
    genre: "Platformer",
    description:
      "Dash, leap and stomp through six handcrafted glades and ruin caverns — " +
      "collect sparks, crack hidden caches, and race your best to each waystone.",
  },
  {
    slug: "dustkart",
    title: "Dustkart",
    genre: "Racing / Kart",
    description:
      "Race six burrowfolk over 3 laps of pseudo-3D circuits: drift for spark-tier " +
      "boosts, nail the launch window, and fight back with items on three tracks.",
  },
];
