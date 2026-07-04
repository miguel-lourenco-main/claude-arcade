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
};

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
