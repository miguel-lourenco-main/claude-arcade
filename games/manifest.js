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
];
