// The Loomstone — gleam woven into an edge (see LORE.md). A slab of
// starstone hollowed like a basin: gleam pools in it, and a steady hand
// weaves it THROUGH a tool or a worn piece as a Thread. One thread per
// item, permanent, carried on the stack as `mod` (a short string that
// rides the save format as the optional 4th stack element, like dur).
//
// The table is the whole system: who a thread fits, what it costs (whole
// gleam jars + a material), and the blurb the window shows. The effect
// hooks live where the numbers live — interact.js (keen bite, flint pace),
// main.js/player.js (oak wear-skips), blocks.js armorProtection (ward).

import {
  BLOCKS, IRON_INGOT, COAL_ORE, MOSS_CLUMP, STARGLASS, DUSK_PEARL,
  QUILL, BOGBEAN_POD, WANDERWING, NACRE,
} from "./blocks.js";

export const THREADS = {
  keen: {
    name: "Keen Thread",
    blurb: "+2 to the blade's bite",
    fits: (def) => !!def.tool && def.tool.kind === "blade",
    levels: 3,
    mats: [[IRON_INGOT, 2]],
  },
  flint: {
    name: "Flint Thread",
    blurb: "digs half again as fast",
    fits: (def) => !!def.tool && def.tool.kind !== "blade",
    levels: 3,
    mats: [[COAL_ORE, 4]],
  },
  // named for the Upturn's own tough wood — there is no oak here
  knot: {
    name: "Knotwood Thread",
    blurb: "wear lands half as often",
    fits: (def) => !!def.tool || !!def.armor,
    levels: 2,
    mats: [[MOSS_CLUMP, 4]],
  },
  ward: {
    name: "Ward Thread",
    blurb: "+4% protection while worn",
    fits: (def) => !!def.armor,
    levels: 4,
    mats: [[STARGLASS, 1]],
  },
  // strictly post-boss: the pearl only ever comes out of The Unshaken
  dusk: {
    name: "Dusk Thread",
    blurb: "+3 bite, and the struck are Dimmed",
    fits: (def) => !!def.tool && def.tool.kind === "blade",
    levels: 6,
    mats: [[DUSK_PEARL, 1]],
  },
  // woven from the far sea's own coin — treads only. The effect hooks live
  // in player.js (swim pace, the Mire Sod stride), read via tideCarries.
  tide: {
    name: "Tide Thread",
    blurb: "the sea carries you — swim swift, wade the mire free",
    fits: (def) => !!def.armor && def.armor.kind === "treads",
    levels: 3,
    mats: [[NACRE, 2]],
  },
};

// Loom weaves: whole NEW items woven from gleam + materials, offered at the
// Loomstone regardless of what's selected (unlike Threads, which ride the
// belt selection). The Wanderwing is the first: a patchwork wing-cape bound
// from moss-twine, ribbed with quills, and patched with speckled bogbean pods.
export const WEAVES = {
  wanderwing: {
    out: WANDERWING,
    name: "Wanderwing",
    blurb: "a patchwork wing-cape — hold Space falling to glide",
    levels: 4, // whole jars of gleam
    mats: [[MOSS_CLUMP, 6], [QUILL, 4], [BOGBEAN_POD, 2]],
  },
};

// can this weave be woven right now? "" = yes, else a reason string. Checks
// the jars, the materials, AND a free satchel slot for the finished piece.
export function weaveItemBlocker(key, gleam, inventory) {
  const w = WEAVES[key];
  if (!w) return "nothing to weave";
  if (gleam.level < w.levels) return `wants ${w.levels} jars`;
  for (const [id, n] of w.mats) {
    if (inventory.count(id) < n) return `wants ${n}× ${BLOCKS[id].name}`;
  }
  if (!inventory.slots.some((s) => !s)) return "satchel is full";
  return "";
}

// commit an item weave: spend the jars, consume the mats, hand over the piece.
// Everything is re-checked so a stale window can never over-spend.
export function weaveItem(key, gleam, inventory) {
  if (weaveItemBlocker(key, gleam, inventory) !== "") return false;
  const w = WEAVES[key];
  if (!gleam.spendLevels(w.levels)) return false;
  for (const [id, n] of w.mats) inventory.removeCount(id, n);
  inventory.add(w.out, 1); // the free-slot check above guarantees it lands
  return true;
}

// the threads that could ever sit in this item (regardless of affordability)
export function threadsFor(def) {
  if (!def) return [];
  return Object.keys(THREADS).filter((k) => THREADS[k].fits(def));
}

// can this weave happen right now? Returns a reason string ("" = yes).
export function weaveBlocker(key, stack, gleam, inventory) {
  const t = THREADS[key];
  if (!t || !stack || !BLOCKS[stack.id]) return "nothing to weave";
  if (!t.fits(BLOCKS[stack.id])) return "doesn't fit";
  if (stack.mod) return "already threaded";
  if (gleam.level < t.levels) return `wants ${t.levels} jars`;
  for (const [id, n] of t.mats) {
    if (inventory.count(id) < n) return `wants ${n}× ${BLOCKS[id].name}`;
  }
  return "";
}

// commit the weave: spend the jars, consume the mats, set the thread.
// Everything is re-checked — a stale window can never over-spend.
export function weave(key, stack, gleam, inventory) {
  if (weaveBlocker(key, stack, gleam, inventory) !== "") return false;
  const t = THREADS[key];
  if (!gleam.spendLevels(t.levels)) return false;
  for (const [id, n] of t.mats) inventory.removeCount(id, n);
  stack.mod = key;
  return true;
}

// the display name of a stack's thread, or null
export function threadName(stack) {
  const t = stack && stack.mod && THREADS[stack.mod];
  return t ? t.name : null;
}

// the Knotwood Thread's mercy: does THIS wear tick land? One rule for
// tools (main.js onToolUse) and armor (player.js _absorb) alike.
export function wearSkips(stack) {
  return !!stack && stack.mod === "knot" && Math.random() < 0.5;
}

// the Tide Thread's carry: do THESE worn treads know the water?
// player.js asks with the treads wear slot's stack.
export function tideCarries(stack) {
  return !!stack && stack.mod === "tide";
}
