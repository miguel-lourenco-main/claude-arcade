// Headless-Chrome tests for Voxelcraft. Run with: node test/browser.test.mjs
//
// Self-contained (no npm deps): spawns a static http server over the repo
// root (so ../_common resolves as on GitLab Pages), drives
// /usr/bin/google-chrome over raw CDP websockets, boots the game with
// ?nolock (the automated-test handle, window.voxelcraft), and asserts zero
// console errors / page exceptions. Three.js comes from the pinned CDN in
// the import map, so this suite needs network access. Voxelcraft is the
// one ES-module game: it is served over http only (file:// can't load
// modules).

import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAME_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(GAME_DIR, "..", "..");
const CHROME_BIN = "/usr/bin/google-chrome";

let passed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; console.log(`  ok - ${name}`); }
  else { failures.push(name); console.error(`  FAIL - ${name}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml",
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
      const file = path.normalize(path.join(REPO_ROOT, urlPath));
      if (!file.startsWith(REPO_ROOT)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end("not found"); return; }
        res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.data || ""})`));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg);
      }
    });
  }
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener("open", () => resolve(new CDP(ws)));
      ws.addEventListener("error", (e) => reject(new Error(`websocket error: ${e.message || e}`)));
    });
  }
  send(method, params = {}, sessionId = undefined) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }
      }, 30000);
    });
  }
  on(fn) { this.listeners.push(fn); }
}

function launchChrome(userDataDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn(CHROME_BIN, [
      "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${userDataDir}`,
      "--no-first-run", "--no-default-browser-check", "--enable-unsafe-swiftshader",
      "--use-angle=swiftshader", "--hide-scrollbars", "--mute-audio",
      "--window-size=1280,800", "about:blank",
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let buf = "";
    const onData = (d) => {
      buf += d.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { proc.stderr.off("data", onData); resolve({ proc, wsUrl: m[1] }); }
    };
    proc.stderr.on("data", onData);
    proc.on("exit", (code) => reject(new Error(`chrome exited early (code ${code})`)));
    setTimeout(() => reject(new Error("chrome did not report DevTools endpoint")), 15000);
  });
}

class Page {
  constructor(cdp, sessionId) { this.cdp = cdp; this.sessionId = sessionId; }
  send(method, params) { return this.cdp.send(method, params, this.sessionId); }
  async navigate(url) {
    const loaded = new Promise((resolve) => {
      const fn = (msg) => {
        if (msg.sessionId === this.sessionId && msg.method === "Page.loadEventFired") {
          this.cdp.listeners.splice(this.cdp.listeners.indexOf(fn), 1);
          resolve();
        }
      };
      this.cdp.on(fn);
    });
    await this.send("Page.navigate", { url });
    await loaded;
  }
  async eval(expression) {
    const res = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) {
      const d = res.exceptionDetails;
      throw new Error(`page eval failed: ${d.exception?.description || d.text}`);
    }
    return res.result.value;
  }
  // real pointer input (so dblclick/mouseenter fire the way a hand makes them)
  async mouse(type, x, y, clickCount = 1) {
    await this.send("Input.dispatchMouseEvent", {
      type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount,
      buttons: type === "mousePressed" ? 1 : 0,
    });
  }
  async dblclick(x, y) {
    await this.mouse("mouseMoved", x, y);
    await this.mouse("mousePressed", x, y, 1); await this.mouse("mouseReleased", x, y, 1);
    await this.mouse("mousePressed", x, y, 2); await this.mouse("mouseReleased", x, y, 2);
    await sleep(60);
  }
  async waitFor(expression, ms = 30000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { if (await this.eval(expression)) return true; } catch { /* not yet */ }
      await sleep(200);
    }
    return false;
  }
}

async function openPage(cdp, errors, label) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const page = new Page(cdp, sessionId);
  cdp.on((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      errors.push(`[${label}] exception: ${d.exception?.description || d.text}`);
    } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
      if (!/favicon/i.test(text)) errors.push(`[${label}] console.error: ${text}`);
    } else if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
      const text = `${msg.params.entry.text} ${msg.params.entry.url || ""}`;
      if (!/favicon/i.test(text)) errors.push(`[${label}] log: ${text}`);
    }
  });
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Log.enable");
  return page;
}

// ------------------------------------------------------------------- suites

// VC_SHOTS=<dir> saves a PNG at named moments (for eyeballing UI changes)
async function shot(page, name) {
  const dir = process.env.VC_SHOTS;
  if (!dir) return;
  const { data } = await page.send("Page.captureScreenshot", { format: "png" });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.png`), Buffer.from(data, "base64"));
}

// boot a fresh world and wait for the test handle + some loaded terrain
async function boot(page, url) {
  await page.navigate(url);
  await page.eval("localStorage.clear()");
  await page.navigate(url);
  const up = await page.waitFor("!!(window.voxelcraft && window.voxelcraft.world.chunks.size > 4)", 45000);
  assert(up, "game boots: test handle present and chunks streaming");
  // dismiss the start screen so the fixed-step loop drives the player (in
  // nolock mode the overlay state, not pointer lock, gates input)
  await page.eval("window.voxelcraft.hud.paused && window.voxelcraft.hud.hidePause()");
  await sleep(1500); // let a few frames of the loop run
  return up;
}

async function smoke(page) {
  console.log("\n== smoke");
  assert(await page.eval("typeof window.voxelcraft.player.update === 'function'"),
    "player is live");
  const t0 = await page.eval("window.voxelcraft.sky.time");
  await sleep(1200);
  const t1 = await page.eval("window.voxelcraft.sky.time");
  assert(t1 !== t0, "the game loop is ticking (sky time advances)");
}

// A2: the shared worth table is live, and satchel slots name their tier
async function rarity(page) {
  console.log("\n== rarity -> value (A2)");
  const r = await page.eval(`(() => { const R = window.voxelcraft.rarity;
    return { dirt: R.valueOf(2), ore: R.rarityOf(22), tier: R.rarityTier(22).name }; })()`);
  assert(Math.abs(r.dirt - 1) < 1e-9, "a dirt block is the unit of value in-game");
  assert(r.ore > 0.3 && r.ore < 0.6 && typeof r.tier === "string", `sky-iron ore resolves (${r.ore.toFixed(3)}, ${r.tier})`);
  const title = await page.eval(`(() => { const vc = window.voxelcraft;
    vc.inventory.add(22, 1); vc.hud.openPicker();
    const cell = [...document.querySelectorAll('#palette-grid .inv-slot, #main-grid .inv-slot, #hotbar-grid .inv-slot')]
      .find((c) => c.title.startsWith('Sky-Iron Ore')); const t = cell ? cell.title : ''; vc.hud.closePicker(); return t; })()`);
  assert(/ · (Underfoot|Everyday|Seamwise|Deepkept|Pearl-rare)$/.test(title), `a satchel slot's hover names its tier ("${title}")`);
}

// A3: sneaking lowers the live camera eye and the hitbox
async function crouch(page) {
  console.log("\n== crouch (A3)");
  const before = await page.eval("window.voxelcraft.player.eyeY - window.voxelcraft.player.pos.y");
  await page.eval("window.voxelcraft.player.keys.add('ShiftLeft')");
  await sleep(600);
  const during = await page.eval(`(() => { const p = window.voxelcraft.player;
    return { eye: p.eyeY - p.pos.y, h: p.height, crouched: p.crouched, flying: p.flying, water: p.inWater }; })()`);
  await page.eval("window.voxelcraft.player.keys.delete('ShiftLeft')");
  if (during.flying || during.water) {
    assert(true, "crouch probe skipped (spawned flying or in water)");
    return;
  }
  assert(during.crouched && during.eye < before - 0.3 && during.h < 1.5,
    `holding sneak crouches in-game (eye ${before.toFixed(2)} -> ${during.eye.toFixed(2)}, box ${during.h})`);
}

// A4: the saturation buffer is live and persisted; hearty foods say so on hover
async function saturation(page) {
  console.log("\n== saturation (A4)");
  const r = await page.eval(`(() => { const vc = window.voxelcraft, p = vc.player;
    const h = p.hunger, s = p.saturation; p.hunger = 10; p.saturation = 0;
    p.eat(10, 16); const out = { h: p.hunger, s: p.saturation }; p.hunger = h; p.saturation = s;
    vc.inventory.add(127, 1); vc.hud.openPicker();
    const cell = [...document.querySelectorAll('.inv-slot')].find((c) => c.title.startsWith("Wanderer's Pottage"));
    out.title = cell ? cell.title : ''; vc.hud.closePicker(); return out; })()`);
  assert(r.h === 20 && r.s === 16, "eating grants hidden saturation in-game");
  assert(/\nThe heartiest pot/.test(r.title), "the pottage's hover text says it keeps you full");
}

// travel to the nearest Living Stead and wait for a live resident; returns
// true once window.__res holds one (a steadfolk mob)
async function atStead(page) {
  const ok = await page.eval(`(() => { const vc = window.voxelcraft;
    const r = vc.teleportTo('stead'); vc.hud.paused && vc.hud.hidePause(); return r.ok; })()`);
  if (!ok) return false;
  return page.waitFor(`(() => { const vc = window.voxelcraft;
    for (const [, act] of vc.steads.active) for (const e of act.entries)
      if (vc.mobs.mobs.includes(e.mob)) { window.__res = e.mob; return true; }
    return false; })()`, 40000);
}

// C2: a new world generates tiered settlements; the nearest one wakes with
// a resident per cottage, and the save records the worldgen generation
async function settlements(page) {
  console.log("\n== settlement tiers (C2)");
  const r = await page.eval(`(() => { const vc = window.voxelcraft;
    const p = vc.findNearestStead(vc.player.pos.x, vc.player.pos.z);
    vc.saveNow();
    const saved = JSON.parse(localStorage.getItem('voxelcraft.save.v1'));
    return { tier: p && p.tier, span: p && p.span, homes: p && p.buildings.length, key: p && p.key,
      mode: vc.terrain.settlementMode, worldgen: saved.worldgen }; })()`);
  assert(r.mode === "cells" && r.worldgen === 2, `a new world uses the tiered settlements and saves worldgen 2 (${r.mode}, ${r.worldgen})`);
  assert(["hamlet", "village", "dense"].includes(r.tier), `the nearest settlement has a tier (${r.tier}, ${r.span}x${r.span}, ${r.homes} cottages)`);
  }

// B2: standing — the trade window reads it, gifts raise it, a blow sinks it
async function standing(page) {
  console.log("\n== standing (B2)");
  const live = await atStead(page);
  assert(live, "a Living Stead's resident comes alive after the teleport");
  if (!live) return;
  await sleep(1500); // let every footprint chunk load so the whole stead wakes
  const woke = await page.eval(`(() => { const vc = window.voxelcraft, m = window.__res;
    const act = vc.steads.active.get(m.steadKey);
    return { live: act.entries.length, homes: act.plan.buildings.length, tier: act.plan.tier }; })()`);
  assert(woke.live === woke.homes, `every cottage's resident is awake (${woke.live}/${woke.homes} in a ${woke.tier})`);
  await shot(page, "stead-arrival");
  const r = await page.eval(`(() => { const vc = window.voxelcraft, m = window.__res;
    const S = vc.standing, rec = vc.world.steads.get(m.steadKey);
    const out = { mode: vc.player.mode, start: S.standingOf(rec) };
    vc.tradeWithMob(m);
    out.title = document.getElementById('trade-title').textContent;
    out.hint = document.getElementById('trade-hint').textContent;
    vc.hud.closeTrade();
    vc.inventory.set(vc.hud.selected, { id: 86, count: 3 });
    S.gift(m);
    out.afterGift = S.standingOf(rec);
    out.left = (vc.inventory.get(vc.hud.selected) || { count: 0 }).count;
    vc.mobs.strike(m, 1, vc.player.pos);
    out.afterHit = S.standingOf(rec);
    out.blame = m.blameT;
    out.global = S.global();
    return out; })()`);
  assert(r.title === `The ${await page.eval("window.__res.job")}` && /standing: Neutral/.test(r.hint),
    `the stead's trade window names the job and the standing ("${r.title}" ${r.hint})`);
  assert(r.afterGift > r.start && (r.mode !== "survival" || r.left === 2),
    `a sneak-gift raises standing (${r.start} -> ${r.afterGift}) and hands over one ingot (${r.left} left)`);
  assert(r.mode !== "survival" || (Math.abs(r.afterHit - (r.afterGift - 10)) < 1e-9 && r.blame > 0),
    `a player's blow sinks standing by 10 and lays blame (${r.afterHit})`);
  assert(Number.isFinite(r.global), `the global aggregate is live (${r.global.toFixed(1)})`);
}

// B4: finite stock on the board, and the raider's fork (run after standing,
// on the same resident)
async function lootAndStock(page) {
  console.log("\n== trader stock + the raider path (B4)");
  const alive = await page.eval("!!window.__res && window.voxelcraft.mobs.mobs.includes(window.__res)");
  if (!alive) { assert(false, "the probe resident is still alive for B4"); return; }
  const r = await page.eval(`(() => { const vc = window.voxelcraft, m = window.__res;
    m.grudgeT = 0;
    const rec = vc.world.steads.get(m.steadKey);
    rec.standing = 0; // back to neutral so the window opens
    vc.tradeWithMob(m);
    const rows = [...document.querySelectorAll('#trade-list .craft-row small')].map((e) => e.textContent);
    vc.hud.closeTrade();
    const before = vc.drops.drops.length;
    window.__before = { drops: before, standing: rec.standing };
    vc.mobs.strike(m, 100, vc.player.pos);
    return { rows, mode: vc.player.mode }; })()`);
  assert(r.rows.length >= 3 && r.rows.every((t) => / left$| sold out$/.test(t)),
    `every board line shows its shelf (${r.rows[0]})`);
  const died = await page.waitFor("!window.voxelcraft.mobs.mobs.includes(window.__res)", 5000);
  assert(died, "a lethal blow fells the resident");
  const after = await page.eval(`(() => { const vc = window.voxelcraft, m = window.__res;
    const rec = vc.world.steads.get(m.steadKey);
    return { drops: vc.drops.drops.length, standing: rec.standing, dead: m.record.dead }; })()`);
  const b = await page.eval("window.__before");
  assert(after.dead, "the felled resident is marked dead (it stays gone)");
  if (r.mode === "survival") {
    assert(after.drops > b.drops, `the raider's take spills on the ground (${after.drops - b.drops} drops)`);
    assert(after.standing <= b.standing - 40 + 1e-9, `and the stead remembers (standing ${b.standing} -> ${after.standing})`);
  }
}

// B6: export the live world to a file, import it back over a cleared
// browser, and check the reloaded world is the same one (this reloads the
// page, so it runs last). Also proves the additive fields this wave added
// (saturation, standing, stock, dead residents) survive a real save.
async function saveFiles(page) {
  console.log("\n== save export/import (B6)");
  const before = await page.eval(`(() => { const vc = window.voxelcraft;
    vc.player.hunger = 15; vc.player.saturation = 7.25;
    vc.inventory.set(20, { id: 98, count: 5 }); // starstone in the satchel
    const steads = [...vc.world.steads].map(([k, r]) => [k, r.standing, r.residents.map((x) => x.dead)]);
    const f = vc.exportSave();
    window.__file = f ? f.text : null;
    return { seed: vc.world.seed, name: f && f.name, steads,
      status: document.getElementById('save-status').textContent }; })()`);
  assert(/^voxelcraft-\d+-day\d+-\d{4}-\d\d-\d\d\.json$/.test(before.name || ""), `export names the file (${before.name})`);
  assert(/Saved to/.test(before.status), "the pause menu reports the export");
  const bad = await page.eval("window.voxelcraft.parseSaveFile('{nope').ok");
  assert(bad === false, "a damaged file is refused before anything is touched");
  await page.eval(`(() => { const text = window.__file; localStorage.clear();
    window.__preImport = true; setTimeout(() => window.voxelcraft.importSaveText(text), 0); return true; })()`);
  const back = await page.waitFor("!window.__preImport && !!(window.voxelcraft && window.voxelcraft.world.chunks.size > 4)", 45000);
  assert(back, "importing reloads into the game");
  if (!back) return;
  const after = await page.eval(`(() => { const vc = window.voxelcraft;
    const steads = [...vc.world.steads].map(([k, r]) => [k, r.standing, r.residents.map((x) => x.dead)]);
    const s = vc.inventory.get(20);
    return { seed: vc.world.seed, sat: vc.player.saturation, hunger: vc.player.hunger, steads,
      star: s ? [s.id, s.count] : null }; })()`);
  assert(after.seed === before.seed, "the same world (seed) came back");
  assert(Math.abs(after.sat - 7.25) < 1e-6 && after.hunger === 15, `hunger + hidden saturation survive (${after.hunger}/${after.sat})`);
  assert(after.star && after.star[0] === 98 && after.star[1] === 5, "the satchel came back");
  assert(JSON.stringify(after.steads) === JSON.stringify(before.steads),
    `every stead's standing and its dead came back (${JSON.stringify(after.steads).slice(0, 80)})`);
}

// B1: the cookbook, driven by real pointer events in the Satchel window
async function cookbook(page) {
  console.log("\n== cookbook (B1)");
  const setup = await page.eval(`(() => { const vc = window.voxelcraft;
    if (vc.player.mode !== 'survival') return null;
    vc.inventory.set(12, { id: 7, count: 5 });   // knotwood logs
    vc.inventory.set(13, { id: 86, count: 4 });  // sky-iron ingots
    vc.inventory.set(14, { id: 65, count: 2 });  // sling stones
    vc.hud.cookbook.pins = []; vc.hud.openPicker();
    const at = (i) => { const r = document.querySelectorAll('#main-grid .inv-slot')[i].getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2]; };
    return { log: at(3), ingot: at(4), sling: at(5),
      ready: document.querySelectorAll('#field-recipes .craft-row').length }; })()`);
  if (!setup) { assert(true, "cookbook probe skipped (not survival)"); return; }
  assert(setup.ready >= 1, `the compact default lists what the satchel can make now (${setup.ready})`);
  await page.mouse("mouseMoved", ...setup.log); await sleep(60);
  const hover = await page.eval(`({ head: document.querySelector('#field-recipes .cb-head').textContent,
    rows: [...document.querySelectorAll('#field-recipes .craft-row b')].map((b) => b.textContent) })`);
  assert(hover.head === "Uses Knotwood Log" && hover.rows.some((t) => /Planks/.test(t)),
    `resting on a log previews its recipes (${hover.head}: ${hover.rows.join(", ")})`);
  await shot(page, "cookbook-hover");
  await page.dblclick(...setup.log);
  const pinned = await page.eval(`(() => { const vc = window.voxelcraft, s = vc.inventory.get(12);
    return { pins: vc.hud.cookbook.pins.slice(), slot: s && [s.id, s.count], cursor: vc.hud.slotUI.cursor,
      chips: document.querySelectorAll('#field-recipes .cb-chip').length }; })()`);
  assert(pinned.pins.length === 1 && pinned.pins[0] === 7 && pinned.chips === 1, "a double-click pins the log into the tray");
  assert(pinned.slot && pinned.slot[0] === 7 && pinned.slot[1] === 5 && !pinned.cursor,
    "...net-zero: the stack is back in its slot and nothing is on the cursor");
  await page.dblclick(...setup.log);
  await page.dblclick(...setup.ingot);
  await page.dblclick(...setup.sling);
  const narrowed = await page.eval(`(() => ({ pins: window.voxelcraft.hud.cookbook.pins.slice(),
    rows: [...document.querySelectorAll('#field-recipes .craft-row b')].map((b) => b.textContent) }))()`);
  assert(narrowed.pins.length === 2 && !narrowed.pins.includes(7), "double-clicking again unpins");
  // the field list holds field recipes only, so a bench-only Needle must not show
  assert(narrowed.rows.length === 0, `ingot + sling stone: no FIELD recipe uses both (${narrowed.rows.join(", ")})`);
  await shot(page, "cookbook-pinned-field");
  const bench = await page.eval(`(() => { const vc = window.voxelcraft; vc.hud.closePicker(); vc.hud.openBench();
    return [...document.querySelectorAll('#craft-list .craft-row b')].map((b) => b.textContent); })()`);
  await shot(page, "cookbook-pinned-bench");
  await page.eval("window.voxelcraft.hud.closeBench(); window.voxelcraft.hud.cookbook.pins = []");
  assert(bench.length === 1 && /Homeward Needle/.test(bench[0]), `at the bench the same pins narrow to exactly the Needle (${bench.join(", ")})`);
}

// ---------------------------------------------------------------------- main

const hardTimeout = setTimeout(() => {
  console.error("FATAL: browser test timed out after 240s");
  process.exit(1);
}, 240000);
hardTimeout.unref();

let chrome = null, server = null, userDataDir = null;
const consoleErrors = [];
try {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "voxelcraft-cdp-"));
  server = await startServer();
  const url = `http://127.0.0.1:${server.address().port}/games/voxelcraft/index.html?nolock`;
  ({ proc: chrome, wsUrl: globalThis.__wsUrl } = await launchChrome(userDataDir));
  const cdp = await CDP.connect(globalThis.__wsUrl);
  const page = await openPage(cdp, consoleErrors, "http");
  if (await boot(page, url)) {
    await smoke(page);
    await rarity(page);
    await crouch(page);
    await saturation(page);
    await cookbook(page);
    await settlements(page);
    await standing(page);
    await lootAndStock(page);
    await saveFiles(page); // reloads the page: keep last
  }
  console.log("\n== console errors / exceptions");
  assert(consoleErrors.length === 0,
    `zero console errors/exceptions${consoleErrors.length ? `:\n    ${consoleErrors.join("\n    ")}` : ""}`);
} catch (err) {
  failures.push(`suite crashed: ${err.message}`);
  console.error("SUITE ERROR:", err);
} finally {
  if (chrome) chrome.kill("SIGKILL");
  if (server) server.close();
  if (userDataDir) { try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ } }
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error(" -", f);
  process.exit(1);
}
process.exit(0);
