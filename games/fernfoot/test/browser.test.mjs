#!/usr/bin/env node
/* Headless-Chrome CDP feature test for Fernfoot.
 *
 * Self-contained: no npm deps (node >= 22 has fetch + WebSocket). Spawns its
 * own local http server, drives /usr/bin/google-chrome over the DevTools
 * websocket, and runs the FULL feature suite over BOTH http:// and file://.
 * Asserts zero non-favicon console errors / exceptions. Exits 0 on pass.
 *
 *   node games/fernfoot/test/browser.test.mjs
 */

import { spawn } from "node:child_process";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAME_DIR = path.resolve(__dirname, "..");
const CHROME = "/usr/bin/google-chrome";

let checks = 0;
const failures = [];
function ok(cond, msg) {
  checks++;
  if (cond) console.log("ok - " + msg);
  else { failures.push(msg); console.error("FAIL - " + msg); }
}
function fatal(msg) {
  failures.push(msg);
  console.error("FATAL - " + msg);
  finish();
}

// ---- local http server -------------------------------------------------------
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".md": "text/markdown" };
const server = http.createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const fp = path.normalize(path.join(GAME_DIR, p === "/" ? "index.html" : p));
    if (!fp.startsWith(GAME_DIR)) { res.writeHead(403); res.end(); return; }
    const body = await readFile(fp);
    res.writeHead(200, { "content-type": MIME[path.extname(fp)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const HTTP_URL = `http://127.0.0.1:${server.address().port}/index.html?fftest=1`;
const FILE_URL = "file://" + path.join(GAME_DIR, "index.html") + "?fftest=1";

// ---- chrome --------------------------------------------------------------------
const profile = mkdtempSync(path.join(os.tmpdir(), "fernfoot-cdp-"));
const debugPort = 9222 + Math.floor(Math.random() * 800);
const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check",
  "--disable-gpu", "--mute-audio", "--window-size=1100,900",
  "about:blank",
], { stdio: "ignore" });

let wsDebuggerUrl = null;
for (let i = 0; i < 100 && !wsDebuggerUrl; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
    wsDebuggerUrl = (await r.json()).webSocketDebuggerUrl;
  } catch { await sleep(100); }
}
if (!wsDebuggerUrl) fatal("could not reach chrome devtools endpoint");

// ---- minimal CDP client -----------------------------------------------------------
const ws = new WebSocket(wsDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
const eventHandlers = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id !== undefined && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
  } else if (msg.method) {
    for (const h of eventHandlers) h(msg);
  }
};
function send(method, params = {}, sessionId) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, sessionId);
await send("Runtime.enable", {}, sessionId);
await send("Log.enable", {}, sessionId);

let consoleErrors = [];
eventHandlers.push((msg) => {
  if (msg.sessionId !== sessionId) return;
  if (msg.method === "Runtime.exceptionThrown") {
    consoleErrors.push("exception: " +
      (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
  } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
    consoleErrors.push("console.error: " + msg.params.args.map((a) => a.value ?? a.description ?? "?").join(" "));
  } else if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
    const e = msg.params.entry;
    if ((e.url || "").includes("favicon")) return;
    consoleErrors.push("log: " + e.text + " (" + (e.url || "") + ")");
  }
});

async function navigate(url) {
  const loaded = new Promise((resolve) => {
    const h = (msg) => {
      if (msg.sessionId === sessionId && msg.method === "Page.loadEventFired") {
        eventHandlers.splice(eventHandlers.indexOf(h), 1);
        resolve();
      }
    };
    eventHandlers.push(h);
  });
  await send("Page.navigate", { url }, sessionId);
  await loaded;
  await sleep(150);
}

async function evalJS(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) {
    throw new Error("eval threw: " +
      (r.exceptionDetails.exception?.description || r.exceptionDetails.text) +
      "\n  in: " + expression.slice(0, 140));
  }
  return r.result.value;
}

async function waitFor(expression, label, timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evalJS(expression)) { ok(true, label); return true; }
    await sleep(35);
  }
  ok(false, label + " (timed out: " + expression.slice(0, 110) + ")");
  return false;
}

const VK = {
  ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39,
  Space: 32, Enter: 13, Escape: 27, ShiftLeft: 16,
  KeyP: 80, KeyM: 77, KeyX: 88, KeyZ: 90, KeyW: 87, KeyA: 65, KeyS: 83, KeyD: 68,
};
const KEYNAME = {
  ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight",
  Space: " ", Enter: "Enter", Escape: "Escape", ShiftLeft: "Shift",
  KeyP: "p", KeyM: "m", KeyX: "x", KeyZ: "z", KeyW: "w", KeyA: "a", KeyS: "s", KeyD: "d",
};
async function keyDown(code) {
  await send("Input.dispatchKeyEvent", { type: "keyDown", code, key: KEYNAME[code], windowsVirtualKeyCode: VK[code] }, sessionId);
}
async function keyUp(code) {
  await send("Input.dispatchKeyEvent", { type: "keyUp", code, key: KEYNAME[code], windowsVirtualKeyCode: VK[code] }, sessionId);
}
async function press(code) { await keyDown(code); await keyUp(code); }

async function click(selector) {
  const box = await evalJS(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  const base = { x: box.x, y: box.y, button: "left", clickCount: 1 };
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...base }, sessionId);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...base }, sessionId);
}

const F = "window.__fernfoot";
const text = (sel) => `document.querySelector(${JSON.stringify(sel)}).textContent`;

// ================= the feature suite (runs once per URL scheme) ==================
async function runSuite(url, scheme) {
  console.log(`\n=== ${scheme} :: ${url} ===`);

  await navigate(url);
  await evalJS("localStorage.clear()");
  consoleErrors = [];
  await navigate(url);

  // -- boot & level-select menu -------------------------------------------------
  ok(await evalJS("document.title") === "Fernfoot", `[${scheme}] page title is "Fernfoot"`);
  ok(await evalJS("!!window.FernfootLogic && !!window.FernfootLevels && !!window.__fernfoot"),
    `[${scheme}] classic script tags loaded logic + levels + guarded test handle`);
  ok(await evalJS(`${F}.mode`) === "menu", `[${scheme}] boots into the level-select menu`);
  ok((await evalJS(text("#overlay-title"))) === "FERNFOOT", `[${scheme}] menu overlay titled FERNFOOT`);
  ok(await evalJS(`document.querySelectorAll(".level-card").length`) === 6, `[${scheme}] six level cards`);
  ok(await evalJS(`document.querySelectorAll(".level-card.locked").length`) === 5,
    `[${scheme}] five levels locked on a fresh save`);
  ok(await evalJS(`document.querySelector("#topbar .back").getAttribute("href")`) === "../../index.html",
    `[${scheme}] back-to-arcade link points at the arcade index`);
  ok(await evalJS(`(() => { const c = document.getElementById("game"); return c.width === 512 && c.height === 240; })()`),
    `[${scheme}] canvas has its 512x240 backing size`);
  ok(await evalJS(text("#hud-lives")) === "3", `[${scheme}] HUD lives start at 3`);
  ok(await evalJS(text("#hud-sparks")) === "0", `[${scheme}] HUD sparks start at 0`);

  // -- sound toggle (click + persistence) -----------------------------------------
  await click("#audio-toggle");
  ok(await evalJS(text("#audio-toggle")) === "sound: off", `[${scheme}] clicking the sound button turns audio off`);
  ok(await evalJS(`localStorage.getItem("arcade.fernfoot.audio")`) === "off",
    `[${scheme}] audio preference persists to localStorage`);
  await click("#audio-toggle");
  ok(await evalJS(text("#audio-toggle")) === "sound: on", `[${scheme}] clicking again turns audio back on`);

  // -- locked levels can't start ----------------------------------------------------
  await press("ArrowRight");
  ok(await evalJS(`${F}.menuSel`) === 0, `[${scheme}] selection clamps to unlocked levels`);
  await evalJS(`document.querySelectorAll(".level-card")[3].click()`);
  ok(await evalJS(`${F}.mode`) === "menu", `[${scheme}] clicking a locked card does nothing`);

  // -- start level 1 with Enter --------------------------------------------------------
  await press("Enter");
  ok(await evalJS(`${F}.mode`) === "playing", `[${scheme}] Enter starts the selected level`);
  ok(await evalJS(`document.getElementById("overlay").className`) === "", `[${scheme}] overlay hides once playing`);
  await waitFor(`${text("#hud-level")}.includes("First Steps")`, `[${scheme}] HUD names level 1 "First Steps"`);

  // -- real-key movement: walk, run, friction, jump --------------------------------------
  const x0 = await evalJS(`${F}.game.hero.x`);
  await keyDown("ArrowRight");
  await sleep(600);
  ok(await evalJS(`${F}.game.hero.x`) > x0 + 30, `[${scheme}] holding right moves the hero`);
  const walkVx = await evalJS(`${F}.game.hero.vx`);
  ok(walkVx > 70 && walkVx <= 95, `[${scheme}] walk speed tops out near max (vx=${walkVx?.toFixed?.(1)})`);
  await keyDown("ShiftLeft");
  let runVx = 0; // sample the peak so a wall stop can't fake the reading
  for (let i = 0; i < 16; i++) { await sleep(60); runVx = Math.max(runVx, await evalJS(`${F}.game.hero.vx`)); }
  ok(runVx > 115, `[${scheme}] Shift-run is ~1.5x faster (peak vx=${runVx?.toFixed?.(1)})`);
  await keyUp("ShiftLeft");
  await keyUp("ArrowRight");
  await sleep(500);
  ok(Math.abs(await evalJS(`${F}.game.hero.vx`)) < 10, `[${scheme}] friction stops the hero without input`);
  await keyDown("Space");
  await sleep(160);
  ok(await evalJS(`${F}.game.hero.y`) < 200, `[${scheme}] Space jumps (hero rose)`);
  await keyUp("Space");
  await sleep(700);
  ok(await evalJS(`${F}.game.hero.onGround`), `[${scheme}] hero landed again`);
  // camera stayed inside the level
  ok(await evalJS(`${F}.cam.x >= 0 && ${F}.cam.x <= ${F}.game.level.w * 16 - 512`),
    `[${scheme}] camera clamps inside the level`);

  // -- pause ---------------------------------------------------------------------------------
  await press("KeyP");
  ok(await evalJS(`${F}.mode`) === "paused", `[${scheme}] P pauses`);
  ok(await evalJS(text("#overlay-title")) === "PAUSED", `[${scheme}] pause overlay reads PAUSED`);

  // ==== deterministic physics scenarios (driven while paused via the handle) ====
  // variable jump height: hold vs tap
  const jumps = await evalJS(`(() => {
    const F = ${F};
    const apex = (holdSteps) => {
      F.setHero(160, 210);
      for (let i = 0; i < 6; i++) F.step({}, 1);
      let minY = 1e9;
      for (let i = 0; i < 130; i++) { F.step(i < holdSteps ? { jump: true } : {}, 1); minY = Math.min(minY, F.game.hero.y); }
      return 210 - minY;
    };
    return { hold: apex(120), tap: apex(6) };
  })()`);
  ok(jumps.hold >= 64, `[${scheme}] held jump clears 4 tiles (rise ${jumps.hold.toFixed(1)}px)`);
  ok(jumps.tap < jumps.hold * 0.6, `[${scheme}] tap jump is a short hop (${jumps.tap.toFixed(1)}px vs ${jumps.hold.toFixed(1)}px)`);

  // coyote time off the first pit ledge (pit tiles 30..32)
  const coyoteVy = await evalJS(`(() => {
    const F = ${F};
    F.setHero(29 * 16, 210);
    for (let i = 0; i < 6; i++) F.step({}, 1);
    let guard = 0;
    while (F.game.hero.onGround && guard++ < 200) F.step({ right: true }, 1);
    for (let i = 0; i < 5; i++) F.step({ right: true }, 1);   // ~42ms airborne
    F.step({ right: true, jump: true }, 1);
    return F.game.hero.vy;
  })()`);
  ok(coyoteVy < -300, `[${scheme}] coyote jump fires just after a ledge (vy=${coyoteVy.toFixed(0)})`);

  // jump buffering before landing
  const buffered = await evalJS(`(() => {
    const F = ${F};
    F.setHero(160, 210);
    for (let i = 0; i < 6; i++) F.step({}, 1);
    for (let i = 0; i < 50; i++) F.step({ jump: true }, 1);
    for (let i = 0; i < 24; i++) F.step({}, 1);
    if (F.game.hero.onGround) return "landed-too-early";
    for (let i = 0; i < 30; i++) {
      F.step({ jump: true }, 1);
      if (F.game.events.some((e) => e.type === "jump")) return "jumped";
    }
    return "no-jump";
  })()`);
  ok(buffered === "jumped", `[${scheme}] buffered jump fires on landing (got: ${buffered})`);

  // stomp the first plodder: bounce + score
  const stomp = await evalJS(`(() => {
    const F = ${F};
    const e = F.game.enemies[0];
    const s0 = F.game.score;
    F.setHero(e.x + 1, e.y - 24);
    F.game.hero.vy = 120;
    let bounceVy = null;
    for (let i = 0; i < 80; i++) {
      F.step({}, 1);
      if (!e.alive && bounceVy === null) bounceVy = F.game.hero.vy;
    }
    return { dead: !e.alive, bounceVy, gain: F.game.score - s0 };
  })()`);
  ok(stomp.dead, `[${scheme}] stomping kills the critter`);
  ok(stomp.bounceVy !== null && stomp.bounceVy < -200, `[${scheme}] stomp bounces the hero (vy=${stomp.bounceVy})`);
  ok(stomp.gain >= 100, `[${scheme}] stomp scores 100 (+${stomp.gain})`);

  // sparks: collect one, HUD updates
  const sparkRes = await evalJS(`(() => {
    const F = ${F};
    const s0 = F.game.sparks;
    F.setHero(86 * 16 + 2, 13 * 16 + 2);   // untouched spark far from the walked stretch
    for (let i = 0; i < 4; i++) F.step({}, 1);
    return F.game.sparks - s0;
  })()`);
  ok(sparkRes >= 1, `[${scheme}] touching a spark collects it (+${sparkRes})`);
  await waitFor(`${text("#hud-sparks")} === String(${F}.game.sparks)`, `[${scheme}] HUD spark counter updates`);

  // 100 sparks = extra life
  const oneUp = await evalJS(`(() => {
    const F = ${F};
    F.addSparks(99 - (F.game.sparks % 100));
    const lives0 = F.game.lives;
    F.setHero(88 * 16 + 2, 13 * 16 + 2);
    let saw = false;
    for (let i = 0; i < 6; i++) { F.step({}, 1); if (F.game.events.some((e) => e.type === "1up")) saw = true; }
    return { gained: F.game.lives - lives0, saw };
  })()`);
  ok(oneUp.gained === 1 && oneUp.saw, `[${scheme}] 100 sparks award an extra life with a 1up chime event`);

  // two-stage health: empowered hit drops the stage with invulnerability
  const hurt = await evalJS(`(() => {
    const F = ${F};
    F.grant("ember");
    const e = F.game.enemies.find((e) => e.alive && e.kind === "plodder");
    F.setHero(e.x - 11, e.y);              // already overlapping: deterministic side hit
    for (let i = 0; i < 20; i++) F.step({}, 1);
    return { power: F.game.hero.power, inv: F.game.hero.inv, status: F.game.status };
  })()`);
  ok(hurt.power === "none" && hurt.inv > 0 && hurt.status === "playing",
    `[${scheme}] empowered hit drops to normal with invulnerability (power=${hurt.power}, inv=${hurt.inv.toFixed(2)})`);

  // gustfruit double jump
  const dj = await evalJS(`(() => {
    const F = ${F};
    F.grant("gust");
    F.setHero(160, 210);
    for (let i = 0; i < 6; i++) F.step({}, 1);
    for (let i = 0; i < 30; i++) F.step({ jump: true }, 1);
    for (let i = 0; i < 10; i++) F.step({}, 1);
    const before = F.game.hero.vy;
    F.step({ jump: true }, 1);
    return { before, after: F.game.hero.vy, spent: F.game.hero.airJumps };
  })()`);
  ok(dj.after < dj.before - 100 && dj.spent === 0,
    `[${scheme}] gustfruit grants a mid-air double jump (vy ${dj.before.toFixed(0)} -> ${dj.after.toFixed(0)})`);

  // pit death -> respawn with a life lost
  const death = await evalJS(`(() => {
    const F = ${F};
    const lives0 = F.game.lives;
    F.setHero(31 * 16, 320);
    F.step({}, 3);
    const died = F.game.status === "dead";
    F.step({}, 150);
    return { died, status: F.game.status, lost: lives0 - F.game.lives, x: F.game.hero.x };
  })()`);
  ok(death.died, `[${scheme}] falling into a pit kills`);
  ok(death.status === "playing" && death.lost === 1, `[${scheme}] respawn costs one life`);
  ok(Math.abs(death.x - (2 * 16 + 2)) < 3, `[${scheme}] no checkpoint yet: respawn at the level start`);

  // game over on the last life + any-key instant restart
  await evalJS(`(() => { const F = ${F}; F.setLives(1); F.setHero(31 * 16, 320); F.step({}, 3); F.step({}, 150); })()`);
  ok(await evalJS(`${F}.mode`) === "gameover", `[${scheme}] losing the last life shows game over`);
  ok(await evalJS(text("#overlay-title")) === "FALLEN", `[${scheme}] game-over overlay reads FALLEN`);
  await press("KeyX");
  ok(await evalJS(`${F}.mode`) === "playing", `[${scheme}] any key restarts the level instantly`);
  ok(await evalJS(`${F}.game.lives`) === 3 && (await evalJS(`${F}.game.score`)) === 0,
    `[${scheme}] restart resets lives and score`);

  // reach the waystone -> tally + unlock + best time persisted
  await press("KeyP"); // freeze the rAF stepper again for determinism
  await evalJS(`(() => { const F = ${F}; F.setHero(95 * 16, 208); for (let i = 0; i < 60 && F.game.status === "playing"; i++) F.step({ right: true }, 1); })()`);
  ok(await evalJS(`${F}.game.status`) === "cleared", `[${scheme}] touching the waystone clears the level`);
  ok(await evalJS(`${F}.mode`) === "tally", `[${scheme}] tally screen appears`);
  ok(await evalJS(text("#overlay-title")) === "WAYSTONE REACHED", `[${scheme}] tally overlay titled WAYSTONE REACHED`);
  ok(await evalJS(`(() => { const b = ${text("#overlay-body")}; return b.includes("sparks") && b.includes("time") && b.includes("best"); })()`),
    `[${scheme}] tally shows sparks, time and best`);
  ok(await evalJS(`localStorage.getItem("arcade.fernfoot.unlocked")`) === "1",
    `[${scheme}] clearing level 1 unlocks level 2 (persisted)`);
  ok(await evalJS(`localStorage.getItem("arcade.fernfoot.best.0") !== null`),
    `[${scheme}] best time persisted for level 1`);

  // Enter -> next level
  await press("Enter");
  ok(await evalJS(`${F}.mode`) === "playing", `[${scheme}] Enter on the tally starts the next level`);
  await waitFor(`${text("#hud-level")}.includes("Canopy Rise")`, `[${scheme}] level 2 "Canopy Rise" is running`);
  await press("KeyP"); // deterministic mode

  // one-way platforms: land on top, then drop through with down+jump
  const oneway = await evalJS(`(() => {
    const F = ${F};
    F.setHero(14 * 16, 8 * 16);
    let landed = false, top = 0;
    for (let i = 0; i < 200; i++) { F.step({}, 1); if (F.game.hero.onGround) { landed = true; top = F.game.hero.y + F.game.hero.h; break; } }
    F.step({ down: true, jump: true }, 1);
    const dropped = !F.game.hero.onGround;
    let floor = 0;
    for (let i = 0; i < 300; i++) { F.step({}, 1); if (F.game.hero.onGround) { floor = F.game.hero.y + F.game.hero.h; break; } }
    return { landed, top, dropped, floor };
  })()`);
  ok(oneway.landed && Math.abs(oneway.top - 11 * 16) < 1.5,
    `[${scheme}] hero lands ON TOP of a one-way platform (bottom=${oneway.top.toFixed(1)})`);
  ok(oneway.dropped && Math.abs(oneway.floor - 14 * 16) < 1.5,
    `[${scheme}] down+jump drops through to the floor (bottom=${oneway.floor.toFixed(1)})`);

  // checkpoint saves the respawn point
  const cp = await evalJS(`(() => {
    const F = ${F};
    F.setHero(50 * 16 + 2, 13 * 16 + 2);
    F.step({}, 3);
    const set = !!F.game.checkpoint;
    F.setHero(42 * 16, 320);
    F.step({}, 3);
    F.step({}, 150);
    return { set, x: F.game.hero.x, status: F.game.status };
  })()`);
  ok(cp.set, `[${scheme}] touching a checkpoint post registers it`);
  ok(cp.status === "playing" && Math.abs(cp.x - (50 * 16 + 2)) < 3,
    `[${scheme}] death respawns at the checkpoint (x=${cp.x.toFixed(0)})`);

  // cracked blocks need the emberseed and pay out caches (level 3)
  await evalJS(`${F}.startLevel(2)`);
  await press("KeyP");
  const crack = await evalJS(`(() => {
    const F = ${F};
    const L = window.FernfootLogic;
    F.setHero(30 * 16 + 2, 13 * 16 + 2);
    for (let i = 0; i < 6; i++) F.step({}, 1);
    for (let i = 0; i < 40; i++) F.step({ jump: true }, 1);   // normal hero: no break
    const stillThere = L.isCracked(L.tileAt(F.game, 30, 10));
    F.grant("ember");
    F.setHero(30 * 16 + 2, 13 * 16 + 2);
    const s0 = F.game.sparks;
    for (let i = 0; i < 6; i++) F.step({}, 1);
    for (let i = 0; i < 40; i++) F.step({ jump: true }, 1);
    return { stillThere, broken: L.tileAt(F.game, 30, 10) === L.T.EMPTY, cache: F.game.sparks - s0 };
  })()`);
  ok(crack.stillThere, `[${scheme}] a normal hero cannot break cracked blocks`);
  ok(crack.broken, `[${scheme}] an emberseed hero breaks them from below`);
  ok(crack.cache >= 3, `[${scheme}] the cracked cache paid out sparks (+${crack.cache})`);

  // spitter lobs globs that die on terrain (level 4)
  await evalJS(`${F}.startLevel(3)`);
  await press("KeyP");
  const spit = await evalJS(`(() => {
    const F = ${F};
    F.setHero(68 * 16, 210);   // near the second spitter, clear of the plodder
    let saw = false, died = false;
    for (let i = 0; i < 900; i++) {
      F.step({}, 1);
      if (F.game.globs.length > 0) saw = true;
      if (saw && F.game.globs.length === 0) { died = true; break; }
    }
    return { saw, died };
  })()`);
  ok(spit.saw, `[${scheme}] the spitter lobs globs`);
  ok(spit.died, `[${scheme}] globs die on terrain`);

  // moving platforms carry the hero (level 5)
  await evalJS(`${F}.startLevel(4)`);
  await press("KeyP");
  const ride = await evalJS(`(() => {
    const F = ${F};
    const m = F.game.movers[0];
    F.setHero(m.x + 4, m.y - 16);
    let rode = false, rel0 = null;
    for (let i = 0; i < 300; i++) {
      F.step({}, 1);
      if (F.game.hero.riding >= 0) { if (rel0 === null) rel0 = F.game.hero.x - m.x; rode = true; }
    }
    return { count: F.game.movers.length, rode, drift: rel0 === null ? 999 : Math.abs((F.game.hero.x - m.x) - rel0), riding: F.game.hero.riding };
  })()`);
  ok(ride.count >= 2, `[${scheme}] level 5 has moving platforms`);
  ok(ride.rode && ride.riding >= 0, `[${scheme}] hero lands on and rides a moving platform`);
  ok(ride.drift < 2, `[${scheme}] platform delta carries the hero (drift ${ride.drift.toFixed(2)}px)`);

  // Esc returns to the menu; progression is reflected there
  await press("Escape");
  ok(await evalJS(`${F}.mode`) === "menu", `[${scheme}] Esc returns to the level list`);
  ok(await evalJS(`document.querySelectorAll(".level-card.locked").length`) === 4,
    `[${scheme}] level 2 now shows unlocked in the menu`);
  ok(await evalJS(`document.querySelectorAll(".level-card")[0].textContent.includes("best")`),
    `[${scheme}] the menu shows the recorded best time`);

  // clicking an unlocked card starts it
  await click('[data-level="1"]');
  ok(await evalJS(`${F}.mode`) === "playing" && (await evalJS(text("#hud-level"))).includes("Canopy Rise"),
    `[${scheme}] clicking an unlocked card starts that level`);

  // auto-pause on blur
  await evalJS(`window.dispatchEvent(new Event("blur"))`);
  ok(await evalJS(`${F}.mode`) === "paused", `[${scheme}] losing window focus auto-pauses`);
  ok(await evalJS(text("#overlay-title")) === "PAUSED", `[${scheme}] blur shows the pause overlay`);

  // M toggles sound anywhere
  await press("KeyM");
  ok(await evalJS(text("#audio-toggle")) === "sound: off", `[${scheme}] M toggles sound off`);
  await press("KeyM");
  ok(await evalJS(text("#audio-toggle")) === "sound: on", `[${scheme}] M toggles sound back on`);

  // persistence across reload
  await navigate(url);
  ok(await evalJS(`document.querySelectorAll(".level-card.locked").length`) === 4,
    `[${scheme}] unlock progression survives a reload`);
  ok(await evalJS(`document.querySelectorAll(".level-card")[0].textContent.includes("best")`),
    `[${scheme}] best time survives a reload`);

  // console hygiene
  ok(consoleErrors.length === 0,
    `[${scheme}] zero non-favicon console errors/exceptions` +
    (consoleErrors.length ? " — got:\n    " + consoleErrors.join("\n    ") : ""));
}

let hadThrow = false;
try {
  await runSuite(HTTP_URL, "http");
  await runSuite(FILE_URL, "file");
} catch (err) {
  hadThrow = true;
  failures.push("suite threw: " + err.message);
  console.error("FAIL - suite threw:", err);
}
finish();

function finish() {
  try { chrome.kill("SIGKILL"); } catch {}
  try { server.close(); } catch {}
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
  console.log(`\nbrowser.test.mjs: ${checks - failures.length}/${checks} checks passed` +
    (failures.length ? `, ${failures.length} FAILED` : ""));
  process.exit(failures.length ? 1 : 0);
}
