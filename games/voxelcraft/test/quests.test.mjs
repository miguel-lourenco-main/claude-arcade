// Errands / the quest engine, phase 1 (quests.js). Run with:
// node test/quests.test.mjs
import "./_hooks.cjs";
import { check, section, done, near } from "./_assert.cjs";

const B = await import("../src/blocks.js");
const Q = await import("../src/quests.js");
const { valueOf } = await import("../src/rarity.js");
const { EVENTS: STANDING_EVENTS } = await import("../src/standing.js");

// a stand-in satchel: counts per id
function satchel(init = {}) {
  const c = new Map(Object.entries(init).map(([k, v]) => [Number(k), v]));
  return {
    count: (id) => c.get(id) || 0,
    removeCount: (id, n) => c.set(id, (c.get(id) || 0) - n),
    _c: c,
  };
}

section("the daily deal");
{
  const a = Q.questFor(99, "3,4", 1, "keeper", 12), b = Q.questFor(99, "3,4", 1, "keeper", 12);
  check(JSON.stringify(a) === JSON.stringify(b), "the same resident asks the same thing on the same day");
  let varies = false, perJob = true;
  for (let day = 0; day < 30; day++) {
    if (Q.questFor(99, "3,4", 1, "keeper", day).text !== a.text) varies = true;
    for (const job of ["grower", "wright", "keeper"]) {
      const q = Q.questFor(5, "0,0", 0, job, day);
      if (!Q.ERRANDS[job].some((t) => q.text === t.text.replace("{n}", String(t.want ? t.want[1] : t.event[2])))) perJob = false;
    }
  }
  check(varies, "...and something else another day");
  check(perJob, "every errand comes from the giver's own job table, its count filled in");
  check(a.id === "3,4:1:12" && a.giver.job === "keeper", "an errand names its giver and day");
  const skills = new Set(Object.values(Q.ERRANDS).flat().map((t) => t.skill));
  check(Q.SKILLS.every((s) => skills.has(s)), "the tables teach all five skills: build, fight, mine, farm, craft");
  const kinds = new Set(Object.values(Q.ERRANDS).flat().map((t) => t.kind));
  check(kinds.has("fetch") && kinds.has("event") && !kinds.has("story"), "fetch and event errands; no story ones yet");
  check(Q.questFor(1, "0,0", 0, "nobody", 0) === null, "a job with no table has no errand");
}

section("rewards follow effort (rarity value)");
{
  let ok = true, gleamOk = true;
  for (const job of Object.keys(Q.ERRANDS)) for (const t of Q.ERRANDS[job]) {
    const r = Q.rewardFor(job, Q.effortOf(t), () => 0.3);
    const [id, n] = r.items[0];
    const got = valueOf(id) * n, want = Q.effortOf(t) * 1.6;
    // whole units: off by at most half a unit's worth (or clamped to a stack)
    if (Math.abs(got - want) > valueOf(id) * 0.5 + 1e-9 && n !== 1 && n !== B.BLOCKS[id].maxStack) ok = false;
    if (r.gleam < 1 || r.gleam > 6) gleamOk = false;
  }
  check(ok, "each payout is worth ~1.6x the errand's effort, in whole units");
  check(gleamOk, "and a little gleam (1..6)");
  near(Q.effortOf({ kind: "fetch", want: [B.COAL_ORE, 6] }), valueOf(B.COAL_ORE) * 6, 1e-9, "a fetch's effort is what it asks for");
  check(Q.effortOf({ kind: "event", event: ["kill", "murkling", 4] }) > Q.effortOf({ kind: "event", event: ["kill", "murkling", 2] }), "more work, more effort");
  check(STANDING_EVENTS.quest === 8, "a finished errand is a +8 standing turn (standing.js)");
}

section("the log: accept, count, hand in");
{
  const log = new Q.QuestLog();
  const fetch = { ...Q.questFor(1, "0,0", 0, "keeper", 0), kind: "fetch", want: [B.COAL_ORE, 6], event: null, id: "f" };
  const ev = { ...Q.questFor(1, "0,1", 0, "keeper", 0), kind: "event", event: ["mine", B.COAL_ORE, 3], want: null, id: "e" };
  check(log.accept(fetch) && log.accept(ev), "two errands from two givers");
  check(!log.accept({ ...fetch, id: "f2" }), "one errand per giver at a time");
  check(!log.accept({ ...ev, id: "story1", kind: "story", giver: { steadKey: "9,9", resIdx: 0, job: "keeper" } }), "story errands are refused until phase 2");
  log.accept({ ...ev, id: "e3", giver: { steadKey: "5,5", resIdx: 0, job: "keeper" } });
  check(!log.accept({ ...ev, id: "e4", giver: { steadKey: "6,6", resIdx: 0, job: "keeper" } }), `no more than ${Q.MAX_ACTIVE} at once`);

  const inv = satchel({ [B.COAL_ORE]: 4 });
  check(!log.isReady(log.active[0], inv) && log.handIn("f", inv) === null && inv.count(B.COAL_ORE) === 4,
    "a fetch isn't ready short of the goods, and nothing is taken");
  inv._c.set(B.COAL_ORE, 7);
  const reward = log.handIn("f", inv);
  check(reward && reward.items.length && inv.count(B.COAL_ORE) === 1, "handing in takes the goods and pays out");

  check(log.onEvent("mine", B.IRON_ORE).length === 0, "the wrong block doesn't count");
  check(log.onEvent("place", B.COAL_ORE).length === 0, "nor the wrong kind of deed");
  log.onEvent("mine", B.COAL_ORE); log.onEvent("mine", B.COAL_ORE, 5);
  const e = log.active.find((q) => q.id === "e");
  check(e.progress === 3 && log.isReady(e, inv), "the right deed counts, capped at the ask");
  check(log.handIn("e", inv) && !log.has("e"), "an event errand hands in once done");
  check(log.abandon("e3") && log.active.length === 0, "an errand can be let go");
}

section("save: only who, when and how far");
{
  const log = new Q.QuestLog();
  const q = Q.questFor(77, "2,-3", 1, "wright", 5);
  log.accept(q);
  if (q.kind === "event") log.onEvent(q.event[0], q.event[1], 2);
  const saved = JSON.parse(JSON.stringify(log.serialize()));
  check(saved.length === 1 && saved[0].length === 5, "one compact row per errand");
  const back = new Q.QuestLog();
  back.load(saved, 77);
  check(back.active.length === 1 && back.active[0].text === q.text && back.active[0].progress === log.active[0].progress,
    "it re-deals the same errand with its progress");
  const junk = new Q.QuestLog();
  junk.load([["x"], ["2,-3", "a", "wright", 5, 0], null, ["2,-3", 1, "wright", 5, 1]], 77);
  check(junk.active.length === 1, "junk rows are dropped");
  const none = new Q.QuestLog();
  none.load(undefined, 77);
  check(none.active.length === 0, "an older save carries no errands");
}

section("the hooks: dialogue now, story/epic later");
{
  check(Q.storyQuestFor() === null && Q.epicQuestFor() === null, "story and epic errands are reserved (null until C1)");
  check(Q.KINDS.story.reserved && Q.KINDS.epic.reserved, "their kinds are marked reserved");
  const hi = Q.dialogueFor("grower", "friendly", true, () => 0);
  check(/hand/.test(hi), `a resident with an errand says so ("${hi}")`);
  check(!/hand/.test(Q.dialogueFor("grower", "hostile", true, () => 0)), "a hostile stead doesn't ask you for anything");
  check(Q.describeQuest({ kind: "event", event: ["kill", "murkling", 3], progress: 1, giver: { job: "keeper" } }) ===
    "the keeper: fell murklings — 1/3", "the journal line reads plainly");
}

done();
