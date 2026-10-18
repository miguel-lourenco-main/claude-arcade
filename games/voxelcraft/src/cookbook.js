// The ingredient-filter cookbook: reverse recipe lookup over craft.js's
// shapeless list (still no grid — see craft.js). Pure logic only; hud.js
// draws it.
//
// The ways in, in the order they win:
//   1. PINS: items double-clicked into the filter tray. The list narrows to
//      recipes using ALL of them (AND) — combine two or three pins and you
//      are down to the exact recipe. "Only these" flips to a subset match:
//      recipes made from nothing BUT pinned items.
//   2. HOVER: resting the pointer on a satchel item previews every recipe
//      that uses it (with pins, the preview is pins + that item — what
//      pinning it would show). No commitment: nothing changes until a pin.
//   3. TABS + SEARCH: the secondary paths. The default tab, "Ready", is the
//      compact view: only what the satchel can make right now.

import { BLOCKS } from "./blocks.js";

export const CATEGORIES = [
  { id: "ready", name: "Ready" },
  { id: "all", name: "All" },
  { id: "blocks", name: "Blocks" },
  { id: "tools", name: "Tools" },
  { id: "wear", name: "Wear" },
  { id: "food", name: "Food" },
  { id: "other", name: "Other" },
];

// what shelf a recipe's output sits on
export function categoryOf(recipe) {
  const def = BLOCKS[recipe.out[0]];
  if (!def) return "other";
  if (def.armor) return "wear";
  if (def.tool) return "tools";
  if (def.food) return "food";
  if (def.placeable) return "blocks";
  return "other";
}

// ingredient id -> the recipes that use it (built once per recipe list)
const indexCache = new WeakMap();
export function ingredientIndex(recipes) {
  let idx = indexCache.get(recipes);
  if (idx) return idx;
  idx = new Map();
  for (const r of recipes) {
    for (const [id] of r.in) {
      if (!idx.has(id)) idx.set(id, []);
      const list = idx.get(id);
      if (!list.includes(r)) list.push(r);
    }
  }
  indexCache.set(recipes, idx);
  return idx;
}

// every recipe that uses all of `ids` (AND), via the reverse index
export function recipesUsingAll(recipes, ids) {
  if (!ids.length) return [];
  const idx = ingredientIndex(recipes);
  // start from the rarest ingredient's list, then require the rest
  const lists = ids.map((id) => idx.get(id) || []);
  lists.sort((a, b) => a.length - b.length);
  return lists[0].filter((r) => ids.every((id) => r.in.some(([i]) => i === id)));
}

// recipes made from nothing but `ids` (the "only these" subset match)
export function recipesFromOnly(recipes, ids) {
  if (!ids.length) return [];
  const set = new Set(ids);
  return recipes.filter((r) => r.in.every(([i]) => set.has(i)));
}

function matchesSearch(recipe, q) {
  if (!q) return true;
  const hay = [recipe.out[0], ...recipe.in.map(([id]) => id)]
    .map((id) => (BLOCKS[id] ? BLOCKS[id].name.toLowerCase() : ""));
  return hay.some((name) => name.includes(q));
}

// the list to show. state: { pins: [ids], hover: id|null, onlyThese,
// search, category }; canCraft(recipe) => bool for the "Ready" tab.
// Returns { recipes, mode: "pins" | "hover" | "tab", ids } (ids = the
// filter actually applied, for the header line).
export function cookbookQuery(recipes, state, canCraft = () => true) {
  const pins = state.pins || [];
  const q = (state.search || "").trim().toLowerCase();
  let out, mode, ids = [];
  if (pins.length || state.hover != null) {
    ids = pins.slice();
    if (state.hover != null && !ids.includes(state.hover)) ids.push(state.hover);
    mode = pins.length ? "pins" : "hover";
    out = state.onlyThese && pins.length ? recipesFromOnly(recipes, ids) : recipesUsingAll(recipes, ids);
  } else {
    mode = "tab";
    const cat = state.category || "ready";
    out = recipes.filter((r) =>
      cat === "all" ? true : cat === "ready" ? canCraft(r) : categoryOf(r) === cat);
  }
  return { recipes: out.filter((r) => matchesSearch(r, q)), mode, ids };
}

// pin/unpin an id (the double-click); returns the new pin list
export function togglePin(pins, id) {
  return pins.includes(id) ? pins.filter((p) => p !== id) : [...pins, id];
}
