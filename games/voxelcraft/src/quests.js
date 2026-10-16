// Errands: the steadfolk's quests (phase 1 of the quest system — see
// DIRECTION.md). A resident has one errand a day, dealt from its job's
// table by (world seed, stead, resident, day), so the same folk ask the
// same thing on the same day in every copy of a world. Two kinds:
//
//   FETCH  — bring something back ("six coal for the hearth").
//   EVENT  — go and do something, then come back and say so ("fell three
//            murklings near the patch"). Progress counts from acceptance.
//
// Each errand teaches one SKILL: build / fight / mine / farm / craft. The
// payout is goods from the giver's own trade (sized by rarity value, so a
// harder errand pays more), a little gleam, and standing (standing.js
// EVENTS.quest; errands are the road back from a wary stead).
//
// Phase 2 — STORY and EPIC quests — waits on the narrative arc (#13, the
// C1 writing gate). Their kinds and hooks are reserved below; nothing
// generates them yet.

import { mulberry32 } from "./noise.js";
import { valueOf } from "./rarity.js";
import { maxStackFor } from "./inventory.js";
import { JOB_GOODS } from "./steads.js";
import {
  BLOCKS, BOGBEAN, BERRIES, CROP_RIPE, BOGBEAN_RIPE, FARMLAND, IRON_INGOT, LOG,
  IRON_ORE, PLANKS, LADDER, SILVERFIN, COAL_ORE, TORCH, MEAL_ROOT,
} from "./blocks.js";

export const SKILLS = ["build", "fight", "mine", "farm", "craft"];
export const KINDS = {
  fetch: { id: "fetch" },
  event: { id: "event" },
  // reserved for phase 2 (C1): never dealt until the arc defines them
  story: { id: "story", reserved: true },
  epic: { id: "epic", reserved: true },
};
export const MAX_ACTIVE = 3;          // errands a Wanderling can carry at once
const REWARD_MULT = 1.6;              // an errand pays this much over its effort
const RARE_REWARD_VALUE = 60;         // at/above this, the giver digs out its rare goods
const KILL_EFFORT = 8;                // value-equivalent of felling one creature

// event types the game reports (main.js): mine (a natural block broken),
// harvest (a ripe crop broken), place (a block placed), kill (a creature
// felled — target is the species), craft (units of an item made)
export const EVENTS = ["mine", "harvest", "place", "kill", "craft"];

// the errand tables. text: the ask, in the resident's voice ({n} = count)
export const ERRANDS = {
  grower: [
    { kind: "fetch", skill: "farm", want: [BOGBEAN, 4], text: "Bring me {n} bogbeans — the pot's been thin." },
    { kind: "fetch", skill: "farm", want: [BERRIES, 8], text: "{n} bog berries, if the brambles are kind to you." },
    { kind: "event", skill: "farm", event: ["harvest", CROP_RIPE, 4], text: "Pull {n} ripe meal roots from a patch of your own and tell me how it went." },
    { kind: "event", skill: "farm", event: ["place", FARMLAND, 6], text: "Turn {n} rows of earth with a Furrower — the ground likes being asked." },
    { kind: "event", skill: "fight", event: ["kill", "murkling", 3], text: "Fell {n} murklings. They've been at the fence at night." },
  ],
  wright: [
    { kind: "fetch", skill: "mine", want: [IRON_INGOT, 3], text: "{n} sky-iron ingots for the hinges, and I'll make it worth the walk." },
    { kind: "fetch", skill: "build", want: [LOG, 10], text: "{n} knotwood logs. The roof wants mending before the rain." },
    { kind: "event", skill: "mine", event: ["mine", IRON_ORE, 4], text: "Crack {n} seams of sky-iron ore loose. Then come and brag." },
    { kind: "event", skill: "build", event: ["place", PLANKS, 20], text: "Set {n} planks into something of your own. Show me you can build." },
    { kind: "event", skill: "craft", event: ["craft", LADDER, 6], text: "Make {n} rung ladders at a bench. Hands-on is the only way." },
  ],
  keeper: [
    { kind: "fetch", skill: "farm", want: [SILVERFIN, 3], text: "{n} silverfin for the pot. The river owes us." },
    { kind: "fetch", skill: "mine", want: [COAL_ORE, 6], text: "{n} coal for the hearth, before the dark gets ideas." },
    { kind: "event", skill: "mine", event: ["mine", COAL_ORE, 8], text: "Dig {n} coal out of the stone yourself — it burns better earned." },
    { kind: "event", skill: "fight", event: ["kill", "murkling", 4], text: "Put {n} murklings back in the dark where they belong." },
    { kind: "event", skill: "craft", event: ["craft", TORCH, 16], text: "Make {n} torches. A lit road is a kind road." },
  ],
};

// what each job pays out from: its own trade goods (steads.js JOB_GOODS),
// and the rare ones it keeps back for a big errand
const REWARD_GOODS = Object.fromEntries(Object.entries(JOB_GOODS)
  .map(([job, g]) => [job, { common: g.sells, rare: g.rare }]));

// the dialogue hook: what a resident says when you come to its door, by its
// stead's standing band and whether it has an errand for you. Story lines
// (phase 2) will extend this table, not replace it.
const GREETINGS = {
  hostile: ["…", "We've nothing to say to you."],
  wary: ["You again.", "Mind the fence on your way out."],
  neutral: ["Fair day to you.", "Mind the patch, it's just come up."],
  friendly: ["Good to see you, Wanderling.", "Come in, come in — mind the dog that isn't there."],
  cherished: ["There you are! The kettle's always on for you.", "We were just talking about you. Kindly."],
};
export function dialogueFor(job, bandId, hasErrand, rand = Math.random) {
  const lines = GREETINGS[bandId] || GREETINGS.neutral;
  const hello = lines[Math.floor(rand() * lines.length)];
  return hasErrand && bandId !== "hostile" ? `${hello} I could use a hand, if you've a moment.` : hello;
}

// --- story / epic hooks (reserved for phase 2) ---------------------------------
// When the arc lands: storyQuestFor(world, stead, resident, day) returns a
// story errand (kind "story", carrying its beat id) or null; epicQuestFor the
// rare very-hard, very-rich ones. questFor asks them FIRST, so a story beat
// pre-empts the day's ordinary errand. Both return null until then.
export function storyQuestFor(/* seed, steadKey, resIdx, job, day */) { return null; }
export function epicQuestFor(/* seed, steadKey, resIdx, job, day */) { return null; }

// --- the deal ------------------------------------------------------------------

function seedOf(seed, steadKey, resIdx, day) {
  let h = (seed ^ 0x9e57) >>> 0;
  for (let i = 0; i < steadKey.length; i++) h = Math.imul(h ^ steadKey.charCodeAt(i), 0x01000193) >>> 0;
  return (h ^ Math.imul(resIdx + 1, 0x9e3779b9) ^ Math.imul(day + 1, 0x85ebca77)) >>> 0;
}

// what an errand costs to do, in rarity value (rarity.js)
export function effortOf(t) {
  if (t.kind === "fetch") return valueOf(t.want[0]) * t.want[1];
  const [type, target, n] = t.event;
  if (type === "kill") return KILL_EFFORT * n;
  if (type === "harvest") return valueOf(MEAL_ROOT) * n;
  return valueOf(target) * n;
}

// size a payout: goods from the job's pool worth ~effort x REWARD_MULT
export function rewardFor(job, effort, rand = Math.random) {
  const pool = REWARD_GOODS[job] || REWARD_GOODS.grower;
  const target = effort * REWARD_MULT;
  const goods = target >= RARE_REWARD_VALUE && pool.rare.length ? pool.rare : pool.common;
  // prefer the good that pays in a sensible count (1..one stack)
  const fits = goods.filter((id) => target / valueOf(id) >= 1 && target / valueOf(id) <= maxStackFor(id));
  const list = fits.length ? fits : goods;
  const id = list[Math.floor(rand() * list.length)];
  const n = Math.max(1, Math.min(maxStackFor(id), Math.round(target / valueOf(id))));
  return { items: [[id, n]], gleam: Math.min(6, 1 + Math.floor(effort / 10)) };
}

// the errand a resident has on `day` (null if none). Pure.
export function questFor(seed, steadKey, resIdx, job, day) {
  const story = storyQuestFor(seed, steadKey, resIdx, job, day);
  if (story) return story;
  const epic = epicQuestFor(seed, steadKey, resIdx, job, day);
  if (epic) return epic;
  const table = ERRANDS[job];
  if (!table) return null;
  const rand = mulberry32(seedOf(seed, steadKey, resIdx, day));
  const t = table[Math.floor(rand() * table.length)];
  const n = t.kind === "fetch" ? t.want[1] : t.event[2];
  return {
    id: `${steadKey}:${resIdx}:${day}`,
    giver: { steadKey, resIdx, job }, day,
    kind: t.kind, skill: t.skill,
    want: t.want ? t.want.slice() : null,
    event: t.event ? t.event.slice() : null,
    text: t.text.replace("{n}", String(n)),
    reward: rewardFor(job, effortOf(t), rand),
  };
}

// a one-line status of an errand for the journal / the trade window
export function describeQuest(q) {
  const giver = `the ${q.giver.job}`;
  if (q.kind === "fetch") {
    const [id, n] = q.want;
    return `${giver}: bring ${n}× ${BLOCKS[id].name}`;
  }
  const [type, target, n] = q.event;
  const what = typeof target === "string" ? `${target}s` : BLOCKS[target].name;
  const verb = { mine: "mine", harvest: "harvest", place: "place", kill: "fell", craft: "make" }[type] || type;
  return `${giver}: ${verb} ${what} — ${Math.min(q.progress || 0, n)}/${n}`;
}

// --- the log: what the Wanderling has agreed to do ------------------------------

export class QuestLog {
  constructor() { this.active = []; }

  has(id) { return this.active.some((q) => q.id === id); }
  fromGiver(steadKey, resIdx) {
    return this.active.find((q) => q.giver.steadKey === steadKey && q.giver.resIdx === resIdx) || null;
  }

  // take an errand on: one per giver, MAX_ACTIVE in all; story/epic kinds
  // are refused until phase 2 defines them
  accept(q) {
    if (!q || this.has(q.id) || this.fromGiver(q.giver.steadKey, q.giver.resIdx)) return false;
    if (this.active.length >= MAX_ACTIVE) return false;
    if (KINDS[q.kind] && KINDS[q.kind].reserved) return false;
    this.active.push({ ...q, progress: 0 });
    return true;
  }

  abandon(id) {
    const n = this.active.length;
    this.active = this.active.filter((q) => q.id !== id);
    return this.active.length < n;
  }

  // the game reports something the player did; returns the errands it moved
  onEvent(type, target, n = 1) {
    const moved = [];
    for (const q of this.active) {
      if (q.kind !== "event") continue;
      const [t, want, count] = q.event;
      if (t !== type || want !== target || q.progress >= count) continue;
      q.progress = Math.min(count, q.progress + n);
      moved.push(q);
    }
    return moved;
  }

  // can this errand be handed in right now? (fetch: the goods are in the
  // satchel; event: the count is met)
  isReady(q, inventory) {
    if (q.kind === "fetch") return inventory.count(q.want[0]) >= q.want[1];
    if (q.kind === "event") return q.progress >= q.event[2];
    return false;
  }

  // hand an errand in: takes a fetch's goods, removes it from the log, and
  // returns its reward (null if it isn't ready — nothing is taken then)
  handIn(id, inventory) {
    const q = this.active.find((x) => x.id === id);
    if (!q || !this.isReady(q, inventory)) return null;
    if (q.kind === "fetch") inventory.removeCount(q.want[0], q.want[1]);
    this.active = this.active.filter((x) => x.id !== id);
    return q.reward;
  }

  // save shape: [[steadKey, resIdx, job, day, progress], ...] — the errand
  // itself re-deals from (seed, stead, resident, day), so only that is kept
  serialize() {
    return this.active.map((q) => [q.giver.steadKey, q.giver.resIdx, q.giver.job, q.day, q.progress | 0]);
  }

  load(arr, seed) {
    this.active = [];
    if (!Array.isArray(arr)) return;
    for (const e of arr) {
      if (!Array.isArray(e) || e.length < 5) continue;
      const [steadKey, resIdx, job, day, progress] = e;
      if (typeof steadKey !== "string" || !Number.isInteger(resIdx) || typeof job !== "string" ||
          !Number.isInteger(day)) continue;
      const q = questFor(seed, steadKey, resIdx, job, day);
      if (!q || this.active.length >= MAX_ACTIVE) continue;
      this.active.push({ ...q, progress: Number.isFinite(progress) ? Math.max(0, progress | 0) : 0 });
    }
  }
}

// the ripe crops a "harvest" reports on
export const HARVEST_IDS = new Set([CROP_RIPE, BOGBEAN_RIPE]);
