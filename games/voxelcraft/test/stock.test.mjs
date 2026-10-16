// Trader stock + loot (stock.js). Run with: node test/stock.test.mjs
import "./_hooks.cjs";
import { check, section, done } from "./_assert.cjs";

const B = await import("../src/blocks.js");
const K = await import("../src/stock.js");
const { rarityOf } = await import("../src/rarity.js");
const { World } = await import("../src/world.js");
const { JOB_GOODS } = await import("../src/steads.js");

section("cap and refill follow rarity");
{
  const ids = [B.PLANKS, B.TORCH, B.COAL_ORE, B.IRON_INGOT, B.STARGLASS, B.CART].sort((a, b) => rarityOf(a) - rarityOf(b));
  let capOk = true, refillOk = true;
  for (let i = 1; i < ids.length; i++) {
    if (K.stockCap(ids[i]) > K.stockCap(ids[i - 1])) capOk = false;
    if (!(K.refillSeconds(ids[i]) > K.refillSeconds(ids[i - 1]))) refillOk = false;
  }
  check(capOk, "rarer goods hold fewer trades");
  check(refillOk, "rarer goods restock slower");
  check(K.stockCap(B.PLANKS) >= 5 && K.stockCap(B.STARGLASS) <= 2, `planks hold ${K.stockCap(B.PLANKS)}, starglass ${K.stockCap(B.STARGLASS)}`);
  check(K.refillSeconds(B.PLANKS) < 120 && K.refillSeconds(B.STARGLASS) > 600,
    `planks restock in ${K.refillSeconds(B.PLANKS).toFixed(0)} s, starglass over ${(K.refillSeconds(B.STARGLASS) / 600).toFixed(1)} days`);
}

section("the ledger: sell down, sell out, restock lazily");
{
  const ledger = {};
  const id = B.COAL_ORE, cap = K.stockCap(id), per = K.refillSeconds(id);
  check(K.stockLeft(ledger, id, 0) === cap, "an untouched shelf is full");
  let sold = 0;
  while (K.takeStock(ledger, id, 100)) sold++;
  check(sold === cap, `sells exactly its cap (${cap}) then refuses`);
  check(K.stockLeft(ledger, id, 100) === 0, "sold out");
  check(K.stockLeft(ledger, id, 100 + per * 0.99) === 0, "not a unit back before one refill");
  check(K.stockLeft(ledger, id, 100 + per * 1.01) === 1, "one unit back after one refill");
  check(K.takeStock(ledger, id, 100 + per * 1.5), "and it sells");
  // partial progress was kept: half a refill later the next unit is due
  check(K.stockLeft(ledger, id, 100 + per * 2.01) === 1, "a partial refill keeps its progress across a sale");
  check(K.stockLeft(ledger, id, 100 + per * 1e4) === cap, "a long absence never overfills the shelf");
}

section("ledger save shape");
{
  const ledger = {};
  K.takeStock(ledger, B.TORCH, 50); K.takeStock(ledger, B.TORCH, 50); K.takeStock(ledger, B.PLANKS, 60);
  const back = K.ledgerFromSave(JSON.parse(JSON.stringify(K.ledgerToSave(ledger))));
  check(K.stockLeft(back, B.TORCH, 55) === K.stockLeft(ledger, B.TORCH, 55) &&
        K.stockLeft(back, B.PLANKS, 61) === K.stockLeft(ledger, B.PLANKS, 61), "round-trips");
  const junk = K.ledgerFromSave([[1.5, 2, 3], ["x"], [B.TORCH, "a", 3], null, [B.TORCH, 2, 7]]);
  check(Object.keys(junk).length === 1 && junk[B.TORCH][0] === 2, "junk entries are dropped, good ones kept");
  check(Object.keys(K.ledgerFromSave(undefined)).length === 0, "absent = full shelves");

  const w = new World(5);
  w.steads.set("1,1", { standing: 0, residents: [{ job: "keeper", homeIdx: 0, hp: 10, trades: 0, tradeDay: -1, dead: false, stock: ledger }] });
  const w2 = new World(5);
  w2.loadSteads(JSON.parse(JSON.stringify(w.serializeSteads())));
  const r = w2.steads.get("1,1").residents[0];
  check(K.stockLeft(r.stock, B.TORCH, 55) === K.stockLeft(ledger, B.TORCH, 55), "a resident's shelf rides the stead save");
  const w3 = new World(5);
  w3.loadSteads([["1,1", [["keeper", 0, 10, 0, -1, 0]]]]);
  check(Object.keys(w3.steads.get("1,1").residents[0].stock).length === 0, "an older save's residents load with full shelves");
}

section("the raider's take");
{
  const sells = JOB_GOODS.wright.sells;
  const full = K.traderLoot("wright", sells, {}, 0, () => 0.5);
  const ids = full.map(([id]) => id);
  check(ids.includes(B.PLANKS) && ids.includes(B.LOG), "a wright drops its pocket goods");
  // half the shelf of each good, in bundles
  const rails = full.find(([id]) => id === B.RAIL);
  check(!!rails && rails[1] > 0, "and a share of its unsold stock");
  // sell every shelf out: only the pockets remain
  const empty = {};
  for (const id of sells) while (K.takeStock(empty, id, 0));
  const pockets = K.traderLoot("wright", sells, empty, 0, () => 0.5);
  check(pockets.every(([id]) => K.JOB_CARRY.wright.some(([c]) => c === id)), "a sold-out trader drops only its pockets");
  check(K.lootValue(full) > K.lootValue(pockets) * 2, `a full shelf is the bigger prize (${K.lootValue(full).toFixed(0)} vs ${K.lootValue(pockets).toFixed(0)})`);
  check(full.every(([, n]) => n > 0), "no zero-count drops");
  const lo = K.traderLoot("grower", [], {}, 0, () => 0), hi = K.traderLoot("grower", [], {}, 0, () => 0.999);
  check(K.lootValue(hi) > K.lootValue(lo), "pocket counts are rolled inside their ranges");
}

done();
