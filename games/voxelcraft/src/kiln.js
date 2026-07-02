// The Kiln: Voxelcraft's smelter. Each placed Kiln block owns a tiny state
// machine — three slots (input, fuel, output), a burn timer, and a smelt
// progress timer — stored in world.kilns and ticked every frame from main.js
// (there are never more than a handful, so a flat Map walk is fine).
//
// Classic rules: fuel is only consumed when there is something smeltable AND
// the output has room; once lit, the burn timer keeps counting down even if
// the input is pulled out (heat doesn't wait for you).

import {
  SAND, GLASS, COBBLE, STONE, IRON_ORE, IRON_INGOT, SNUFFET_LOIN, ROAST_LOIN,
  MEAL_ROOT, BAKED_ROOT, SILVERFIN, SEARED_SILVERFIN, COAL_ORE, LOG, PLANKS,
  STARSTONE, STARGLASS,
} from "./blocks.js";
import { MAX_STACK } from "./inventory.js";

// what goes in -> what comes out
export const SMELTS = {
  [SAND]: GLASS,
  [COBBLE]: STONE,
  // ore renders down to the Sky-Iron Ingot — the head material of the iron
  // tool tier; four ingots fold back into an Iron Block at the workbench
  [IRON_ORE]: IRON_INGOT,
  [SNUFFET_LOIN]: ROAST_LOIN,
  [MEAL_ROOT]: BAKED_ROOT,
  [SILVERFIN]: SEARED_SILVERFIN,
  // a landed pearl of the old sky runs molten into a pane that keeps the
  // glow (see the Pearlfall in meteors.js)
  [STARSTONE]: STARGLASS,
};

// seconds of heat per unit of fuel
export const FUEL_SECONDS = {
  [COAL_ORE]: 80,
  [LOG]: 15,
  [PLANKS]: 8,
};

export const SMELT_SECONDS = 10; // one item, input -> output

export function makeKiln() {
  return { slots: [null, null, null], burnLeft: 0, progress: 0 };
}

// true when the input is smeltable and its product fits in the output slot
function canSmelt(k) {
  const inp = k.slots[0];
  if (!inp || SMELTS[inp.id] === undefined) return false;
  const out = k.slots[2];
  return !out || (out.id === SMELTS[inp.id] && out.count < MAX_STACK);
}

// Advance every kiln by dt seconds. Returns true if any SLOT content changed
// (fuel consumed or an item smelted) — the caller re-renders an open kiln
// window on that signal; timer-only ticks don't need a grid repaint.
export function tickKilns(kilns, dt) {
  let changed = false;
  for (const k of kilns.values()) {
    const smeltable = canSmelt(k);

    // light a new unit of fuel only when there's work to do
    if (smeltable && k.burnLeft <= 0) {
      const fuel = k.slots[1];
      if (fuel && FUEL_SECONDS[fuel.id]) {
        k.burnLeft = FUEL_SECONDS[fuel.id];
        fuel.count -= 1;
        if (fuel.count === 0) k.slots[1] = null;
        changed = true;
      }
    }

    if (k.burnLeft > 0) {
      k.burnLeft = Math.max(0, k.burnLeft - dt);
      if (smeltable) {
        k.progress += dt;
        if (k.progress >= SMELT_SECONDS) {
          k.progress = 0;
          const inp = k.slots[0];
          const outId = SMELTS[inp.id];
          inp.count -= 1;
          if (inp.count === 0) k.slots[0] = null;
          const out = k.slots[2];
          if (out) out.count += 1;
          else k.slots[2] = { id: outId, count: 1 };
          changed = true;
        }
      } else {
        k.progress = 0; // nothing (valid) on the fire — heat escapes
      }
    } else {
      k.progress = 0; // cold kilns don't hold half-done work
    }
  }
  return changed;
}
