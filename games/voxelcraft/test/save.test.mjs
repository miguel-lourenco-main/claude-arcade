// Save files (save.js export/import). Run with: node test/save.test.mjs
import "./_hooks.cjs";
import { check, section, done } from "./_assert.cjs";

// a minimal localStorage for node
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const S = await import("../src/save.js");
const KEY = "voxelcraft.save.v1";

const sample = {
  v: 2, seed: 3141592653, time: 0.42, day: 17,
  inventory: [[86, 12], 0, [127, 1]], edits: [[1, 2, 3, 4]], chests: [], kilns: [], signs: [],
  steads: [["3,-4", [["wright", 0, 10, 2, 17, 0, [[9, 2, 9000]]]], [37.5, 17, 6]]],
  player: { x: 1, y: 70, z: -3, yaw: 0, pitch: 0, flying: false },
  hunger: 14, saturation: 6.5, peddler: [17, [], -1],
};

section("export wraps the live save in a named envelope");
{
  check(S.exportSaveFile() === null, "nothing to export before the first save");
  store.set(KEY, JSON.stringify(sample));
  const f = S.exportSaveFile(new Date("2026-10-16T12:00:00Z"));
  check(f && f.name === "voxelcraft-3141592653-day17-2026-10-16.json", `the file is named by seed, day and date (${f && f.name})`);
  const env = JSON.parse(f.text);
  check(env.format === S.SAVE_FILE_FORMAT && env.version === S.SAVE_FILE_VERSION, "the envelope names its format and version");
  check(JSON.stringify(env.save) === JSON.stringify(sample), "the save inside is exactly the stored one");
}

section("import round-trips and validates");
{
  const f = S.exportSaveFile();
  const res = S.parseSaveFile(f.text);
  check(res.ok && JSON.stringify(res.save) === JSON.stringify(sample), "an exported file parses back to the same save");
  store.clear();
  S.importSave(res.save);
  check(store.get(KEY) === JSON.stringify(sample), "importing writes it as the live save");
  const bare = S.parseSaveFile(JSON.stringify(sample));
  check(bare.ok && bare.save.seed === sample.seed, "a bare save object (a raw localStorage dump) imports too");
  // additive fields the game doesn't know yet ride along untouched
  const future = S.parseSaveFile(JSON.stringify({ ...sample, someNewWaveField: [1, 2] }));
  check(future.ok && future.save.someNewWaveField.length === 2, "unknown additive fields are kept");
}

section("bad files are refused with a reason, before anything is touched");
{
  const bad = [
    ["not json at all", /not JSON/],
    ["42", /isn't a save/],
    [JSON.stringify({ format: "some-other-game", version: 1, save: sample }), /other game/],
    [JSON.stringify({ format: S.SAVE_FILE_FORMAT, version: 99, save: sample }), /newer/],
    [JSON.stringify({ format: S.SAVE_FILE_FORMAT, version: 1 }), /no world/],
    [JSON.stringify({ ...sample, seed: "abc" }), /no seed/],
    [JSON.stringify({ ...sample, v: 7 }), /version/],
    [JSON.stringify({ ...sample, inventory: "lots" }), /inventory is damaged/],
    [JSON.stringify({ ...sample, edits: { a: 1 } }), /edits is damaged/],
    [JSON.stringify({ ...sample, player: 5 }), /player is damaged/],
    [JSON.stringify([sample]), /no world/],
  ];
  for (const [text, why] of bad) {
    const r = S.parseSaveFile(text);
    check(!r.ok && why.test(r.error), `refused: ${text.slice(0, 40)}… (${r.error})`);
  }
}

done();
