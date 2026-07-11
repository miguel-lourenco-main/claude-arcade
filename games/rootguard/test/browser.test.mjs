#!/usr/bin/env node
/* Headless-Chrome CDP feature test for Rootguard.
 *
 * Self-contained: no npm deps (node >= 22 has fetch + WebSocket). Spawns its
 * own local http server, drives /usr/bin/google-chrome over the DevTools
 * websocket, and runs the FULL feature suite over BOTH http:// and file://.
 * Asserts zero non-favicon console errors / exceptions. Exits 0 on pass.
 *
 *   node games/rootguard/test/browser.test.mjs
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

// ---- tiny assert ------------------------------------------------------------
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

// ---- local http server --------------------------------------------------------
const MIME = {
  ".html": "text/html", ".js": "text/javascript",
  ".css": "text/css", ".md": "text/markdown",
};
const server = http.createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const fp = path.normalize(path.join(GAME_DIR, p === "/" ? "index.html" : p));
    if (!fp.startsWith(GAME_DIR)) { res.writeHead(403); res.end(); return; }
    const body = await readFile(fp);
    res.writeHead(200, { "content-type": MIME[path.extname(fp)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const HTTP_URL = `http://127.0.0.1:${server.address().port}/index.html?rgtest=1`;
const FILE_URL = "file://" + path.join(GAME_DIR, "index.html") + "?rgtest=1";

// ---- chrome ----------------------------------------------------------------------
const profile = mkdtempSync(path.join(os.tmpdir(), "rootguard-cdp-"));
const debugPort = 9222 + Math.floor(Math.random() * 800);
const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check",
  "--disable-gpu", "--mute-audio", "--window-size=1000,900",
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

// ---- minimal CDP client -------------------------------------------------------------
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

// ---- page session ----------------------------------------------------------------------
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
      (msg.params.exceptionDetails.exception?.description ||
       msg.params.exceptionDetails.text));
  } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
    consoleErrors.push("console.error: " +
      msg.params.args.map((a) => a.value ?? a.description ?? "?").join(" "));
  } else if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
    const e = msg.params.entry;
    if ((e.url || "").includes("favicon")) return; // the one tolerated error
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
  const r = await send("Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true }, sessionId);
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
  ok(false, label + " (timed out waiting for: " + expression.slice(0, 100) + ")");
  return false;
}

const VK = {
  KeyP: 80, KeyM: 77, KeyX: 88, KeyZ: 90, KeyL: 76, KeyR: 82,
  Escape: 27, Enter: 13, Digit2: 50,
};
const KEYNAME = {
  KeyP: "p", KeyM: "m", KeyX: "x", KeyZ: "z", KeyL: "l", KeyR: "r",
  Escape: "Escape", Enter: "Enter", Digit2: "2",
};
async function press(code) {
  const base = { code, key: KEYNAME[code], windowsVirtualKeyCode: VK[code] };
  await send("Input.dispatchKeyEvent", { type: "keyDown", ...base }, sessionId);
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...base }, sessionId);
}

async function clickAt(x, y) {
  const base = { x, y, button: "left", clickCount: 1 };
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...base }, sessionId);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...base }, sessionId);
}

async function click(selector) {
  const box = await evalJS(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  await clickAt(box.x, box.y);
}

// click a grid cell / a mote through the guarded handle's coordinate helpers
async function clickCell(lane, col) {
  const p = await evalJS(`window.__rootguard.cellPos(${lane}, ${col})`);
  await clickAt(p.x, p.y);
}
async function clickMote(id) {
  const p = await evalJS(`window.__rootguard.motePos(${id})`);
  await clickAt(p.x, p.y);
}

const R = "window.__rootguard";
const G = R + ".game";
const text = (sel) => `document.querySelector(${JSON.stringify(sel)}).textContent`;

// ================= the feature suite (runs once per URL scheme) =================
async function runSuite(url, scheme) {
  console.log(`\n=== ${scheme} :: ${url} ===`);
  const T = (m) => `[${scheme}] ${m}`;

  // fresh storage, then a clean load whose console we police
  await navigate(url);
  await evalJS("localStorage.clear()");
  consoleErrors = [];
  await navigate(url);

  // -- boot & level-select menu -------------------------------------------------
  ok(await evalJS("document.title") === "Rootguard", T(`page title is "Rootguard"`));
  ok(await evalJS("!!window.RootguardLogic && !!window.__rootguard"),
    T("scripts loaded via classic tags: RootguardLogic + guarded test handle present"));
  ok(await evalJS(`document.getElementById("overlay").className`) === "show",
    T("level-select overlay shows on boot"));
  ok(await evalJS(text("#overlay-title")) === "ROOTGUARD", T("menu overlay titled ROOTGUARD"));
  ok(await evalJS(`document.querySelectorAll(".level-btn").length`) === 5,
    T("five level buttons in the level select"));
  ok(await evalJS(`!document.querySelectorAll(".level-btn")[0].disabled`),
    T("level 1 is unlocked from the start"));
  ok(await evalJS(`[1,2,3,4].every(i => document.querySelectorAll(".level-btn")[i].disabled)`),
    T("levels 2-5 start locked (progress persisted at 0)"));
  ok(await evalJS(`document.querySelector("#topbar .back").getAttribute("href")`) === "../../index.html",
    T("back-to-arcade link points at the arcade index"));
  ok(await evalJS(`(() => { const c = document.getElementById("game"); return c.width > 0 && c.height > 0; })()`),
    T("canvas has a real backing size"));
  ok(await evalJS(text("#controls")).then((t) => t.includes("shovel") && t.includes("dew motes")),
    T("controls footer documents planting, motes and the shovel"));

  // -- sound toggle (real click) + persistence --------------------------------------
  await click("#audio-toggle");
  ok(await evalJS(text("#audio-toggle")) === "sound: off",
    T("clicking the sound button turns audio off"));
  ok(await evalJS(`localStorage.getItem("arcade.rootguard.audio")`) === "off",
    T("audio preference persists under arcade.rootguard.audio"));
  await click("#audio-toggle");
  ok(await evalJS(text("#audio-toggle")) === "sound: on", T("clicking again turns audio back on"));

  // -- start level 1 with a real click ------------------------------------------------
  await click(`.level-btn[data-level="0"]`);
  ok(await evalJS(`${R}.mode`) === "playing", T("clicking level 1 starts play"));
  ok(await evalJS(`document.getElementById("overlay").className`) === "",
    T("overlay hides once playing"));
  ok(await evalJS(text("#level-name")).then((t) => t.includes("Seedling Watch")),
    T("HUD names the level"));
  ok(await evalJS(text("#dew")) === "50", T("starting dew is 50"));
  ok(await evalJS(`document.querySelectorAll("#seedbar .seed-card").length`) === 4,
    T("tutorial seed bar: 3 unlocked plants + the shovel"));
  ok(await evalJS(`["dewblossom","thornshot","bulwarkroot","shovel"].every(t =>
      !!document.querySelector('.seed-card[data-type="'+t+'"]'))`),
    T("tutorial cards are dewblossom, thornshot, bulwarkroot, shovel"));
  ok(await evalJS(`document.querySelector('.seed-card[data-type="thornshot"]').disabled`),
    T("an unaffordable card (thornshot 100 > 50) greys out"));
  ok(await evalJS(`!document.querySelector('.seed-card[data-type="dewblossom"]').disabled`),
    T("an affordable card (dewblossom 50) is live"));
  ok(await evalJS(`document.querySelectorAll("#wave-bar .wave-mark").length`) === 6 &&
     await evalJS(`document.querySelectorAll("#wave-bar .wave-mark.final").length`) === 1,
    T("the wave bar shows one marker per wave, the final one flagged"));
  await evalJS(`${R}.disableWaves()`); // sandbox: no scripted spawns from here on

  // -- planting with real clicks ------------------------------------------------------
  await click(`.seed-card[data-type="dewblossom"]`);
  ok(await evalJS(`${R}.selected`) === "dewblossom", T("clicking a seed card selects it"));
  ok(await evalJS(`document.querySelector('.seed-card[data-type="dewblossom"]').classList.contains("selected")`),
    T("the selected card is highlighted"));
  await clickCell(2, 1);
  ok(await evalJS(`${G}.plants.length === 1 && ${G}.plants[0].type === "dewblossom" &&
      ${G}.plants[0].lane === 2 && ${G}.plants[0].col === 1`),
    T("clicking a cell plants the selected defender there"));
  ok(await evalJS(`${G}.dew`) === 0, T("planting deducts the dew cost"));
  ok(await evalJS(`${R}.selected`) === null, T("selection clears after planting"));
  ok(await evalJS(`${G}.cooldowns.dewblossom > 0`), T("planting starts the card cooldown"));
  ok(await evalJS(`document.querySelector('.seed-card[data-type="dewblossom"]').disabled`),
    T("a cooling card greys out"));
  ok(await evalJS(`parseFloat(document.querySelector('.seed-card[data-type="dewblossom"] .cd-mask').style.height) > 0`),
    T("the cooldown mask sweeps the cooling card"));
  await evalJS(`${R}.setDew(200)`);
  ok(await evalJS(`!document.querySelector('.seed-card[data-type="thornshot"]').disabled`),
    T("cards un-grey when dew suffices"));
  ok(await evalJS(`document.querySelector('.seed-card[data-type="dewblossom"]').disabled`),
    T("...but a cooling card stays grey even when affordable"));

  // one plant per cell
  await evalJS(`${R}.clearCooldowns()`);
  await click(`.seed-card[data-type="dewblossom"]`);
  await clickCell(2, 1);
  ok(await evalJS(`${G}.plants.length`) === 1 && await evalJS(`${G}.dew`) === 200,
    T("an occupied cell rejects a second plant (no dew spent)"));
  ok(await evalJS(`${R}.selected`) === "dewblossom", T("a failed plant keeps the selection"));
  await press("Escape");
  ok(await evalJS(`${R}.selected`) === null, T("Esc cancels the selected card"));

  // keyboard selection
  await press("Digit2");
  ok(await evalJS(`${R}.selected`) === "thornshot", T("number keys select seed cards (2 = thornshot)"));
  await press("Escape");
  await press("KeyX");
  ok(await evalJS(`${R}.selected`) === "shovel", T("X selects the shovel"));
  await press("Escape");

  // -- shovel: plant a wall, dig it up (all real clicks) ---------------------------------
  await click(`.seed-card[data-type="bulwarkroot"]`);
  await clickCell(4, 7);
  ok(await evalJS(`${G}.plants.some(p => p.type === "bulwarkroot" && p.lane === 4 && p.col === 7)`),
    T("a bulwarkroot plants like any other card"));
  const dewBeforeShovel = await evalJS(`${G}.dew`);
  await click(`.seed-card[data-type="shovel"]`);
  await clickCell(4, 7);
  ok(await evalJS(`!${G}.plants.some(p => p.lane === 4 && p.col === 7)`),
    T("the shovel digs the defender back up"));
  ok(await evalJS(`${G}.dew`) === dewBeforeShovel, T("shoveling refunds nothing"));

  // -- dew motes: real click to collect ---------------------------------------------------
  const moteId = await evalJS(`${R}.addMote(7, 0.5).id`);
  const dewBeforeMote = await evalJS(`${G}.dew`);
  await clickMote(moteId);
  ok(await evalJS(`${G}.dew`) === dewBeforeMote + 25,
    T("clicking a dew mote collects 25 dew"));
  ok(await evalJS(`!${G}.motes.some(m => m.id === ${moteId})`),
    T("a collected mote leaves the field"));

  // -- pause / resume / blur ----------------------------------------------------------------
  await press("KeyP");
  ok(await evalJS(`${R}.mode`) === "paused", T("P pauses the game"));
  ok(await evalJS(text("#overlay-title")) === "PAUSED", T("pause overlay reads PAUSED"));
  await press("KeyP");
  ok(await evalJS(`${R}.mode`) === "playing", T("P resumes the game"));
  await evalJS(`window.dispatchEvent(new Event("blur"))`);
  ok(await evalJS(`${R}.mode`) === "paused", T("losing window focus auto-pauses"));
  await press("KeyP");
  ok(await evalJS(`${R}.mode`) === "playing", T("resume after blur-pause"));

  // -- M toggles sound mid-game ----------------------------------------------------------------
  await press("KeyM");
  ok(await evalJS(text("#audio-toggle")) === "sound: off", T("M toggles sound off while playing"));
  await press("KeyM");
  ok(await evalJS(text("#audio-toggle")) === "sound: on", T("M toggles sound back on"));

  // ============ exact-timing mechanics (paused + handle.fastForward) ============
  await press("KeyP"); // freeze real-time ticks; fastForward drives the sim exactly

  // dewblossom production
  await evalJS(`${R}.fastForward(12.6)`);
  ok(await evalJS(`${G}.motes.some(m => Math.abs(m.x - 1.5) < 0.8 && Math.abs(m.y - 2.5) < 0.8)`),
    T("the dewblossom grows a mote beside itself (~12s first bloom)"));

  // uncollected motes fade
  const fadeId = await evalJS(`${R}.addMote(6, 4.5).id`);
  await evalJS(`${R}.fastForward(8.5)`);
  ok(await evalJS(`!${G}.motes.some(m => m.id === ${fadeId})`),
    T("an unclicked mote fades away after ~8s"));

  // lane-scan shooting gate
  await evalJS(`${R}.setDew(1000); ${R}.clearCooldowns(); ${R}.plant("thornshot", 1, 2)`);
  await evalJS(`${R}.fastForward(2)`);
  ok(await evalJS(`${G}.shots.length`) === 0, T("a shooter holds fire with no blight in its lane"));
  await evalJS(`${R}.spawn("shambler", 1, 1.0)`); // behind the shooter at col 2
  await evalJS(`${R}.fastForward(0.5)`);
  ok(await evalJS(`${G}.shots.length`) === 0, T("a blight behind the shooter does not trip the gate"));
  await evalJS(`${R}.clearBlights()`);

  // projectiles strike the first blight they touch
  await evalJS(`${R}.spawn("shambler", 1, 5); ${R}.spawn("shambler", 1, 7)`);
  await evalJS(`${R}.fastForward(1.0)`);
  ok(await evalJS(`(() => { const b = ${G}.blights.filter(x => x.lane === 1);
      const near = b.reduce((a, c) => c.x < a.x ? c : a);
      const far = b.reduce((a, c) => c.x > a.x ? c : a);
      return near.hp === 180 && far.hp === 200; })()`),
    T("the first (nearest) blight takes the thorn; the one behind is untouched"));
  await evalJS(`${R}.clearBlights()`);

  // blights stop to chomp plants, per-pixel walking otherwise
  await evalJS(`${R}.clearCooldowns(); ${R}.plant("bulwarkroot", 3, 4); ${R}.spawn("shambler", 3, 5.2)`);
  await evalJS(`${R}.fastForward(2.5)`);
  ok(await evalJS(`(() => { const b = ${G}.blights.find(x => x.lane === 3);
      const w = ${G}.plants.find(p => p.lane === 3 && p.col === 4);
      return b && w && b.eating === w.id && b.x === 5.2 && w.hp < 3000 && w.hp >= 2850; })()`),
    T("a blight latches onto the plant ahead and chomps it (walk halted)"));
  await evalJS(`${R}.clearBlights()`);

  // -- win flow + progress persistence ---------------------------------------------------------
  await evalJS(`${R}.finishWaves(); ${R}.fastForward(0.2)`);
  ok(await evalJS(`${R}.mode`) === "won", T("clearing every scripted blight wins the level"));
  ok(await evalJS(text("#overlay-title")) === "GROVE HELD", T("win overlay reads GROVE HELD"));
  ok(await evalJS(`localStorage.getItem("arcade.rootguard.progress")`) === "1",
    T("victory persists progress under arcade.rootguard.progress"));
  ok(await evalJS(`document.querySelector("#btn-next").textContent.includes("Pale Helm")`),
    T("the win overlay offers the next level"));

  await click("#btn-next");
  ok(await evalJS(`${R}.mode`) === "playing" &&
     await evalJS(text("#level-name")).then((t) => t.includes("Pale Helm Rising")),
    T("clicking next starts level 2"));
  ok(await evalJS(`document.querySelectorAll("#seedbar .seed-card").length`) === 5 &&
     await evalJS(`!!document.querySelector('.seed-card[data-type="frostfern"]')`),
    T("level 2 unlocks the frostfern card"));

  await press("KeyL");
  ok(await evalJS(`${R}.mode`) === "menu", T("L returns to the level select"));
  ok(await evalJS(`!document.querySelectorAll(".level-btn")[1].disabled`),
    T("level 2 is now unlocked in the level select"));
  ok(await evalJS(`document.querySelectorAll(".level-btn")[2].disabled`),
    T("level 3 stays locked"));
  ok(await evalJS(`document.querySelectorAll(".level-btn")[0].querySelector(".tag").textContent`) === "cleared",
    T("cleared levels are tagged"));

  // ============ full-kit sandbox on level 5 (via the test handle) ============
  await evalJS(`${R}.startLevel(4); ${R}.disableWaves(); ${R}.setDew(9999)`);
  ok(await evalJS(`document.querySelectorAll("#seedbar .seed-card").length`) === 7,
    T("level 5 fields all six plant cards + the shovel"));
  await press("KeyP"); // exact timing again

  // frostfern chill
  await evalJS(`${R}.clearCooldowns(); ${R}.plant("frostfern", 2, 0); ${R}.spawn("shambler", 2, 6)`);
  await evalJS(`${R}.fastForward(1.5)`);
  ok(await evalJS(`(() => { const b = ${G}.blights.find(x => x.lane === 2);
      return b && b.hp < b.maxHp && b.slowT > 0 && b.slowT <= 3; })()`),
    T("frost thorns chill the blight for at most 3s (no stacking)"));
  await evalJS(`${R}.clearBlights()`);

  // burstcap: 3x3, single use
  await evalJS(`${R}.clearCooldowns(); ${R}.plant("burstcap", 0, 3);
    ${R}.spawn("shambler", 0, 4.5); ${R}.spawn("shambler", 4, 4.5)`);
  await evalJS(`${R}.fastForward(2)`);
  ok(await evalJS(`!${G}.plants.some(p => p.type === "burstcap")`),
    T("a bitten burstcap detonates and is spent"));
  ok(await evalJS(`!${G}.blights.some(b => b.lane === 0) && ${G}.blights.some(b => b.lane === 4)`),
    T("the 3x3 blast kills the biter but spares a blight four lanes away"));
  await evalJS(`${R}.clearBlights()`);

  // sporelobber arcs over walls
  await evalJS(`${R}.clearCooldowns(); ${R}.plant("sporelobber", 1, 0); ${R}.plant("bulwarkroot", 1, 2);
    ${R}.spawn("shambler", 1, 6.5)`);
  await evalJS(`${R}.fastForward(3)`);
  ok(await evalJS(`(() => { const b = ${G}.blights.find(x => x.lane === 1);
      const w = ${G}.plants.find(p => p.lane === 1 && p.col === 2);
      return b && b.hp < b.maxHp && w && w.hp === w.maxHp; })()`),
    T("the sporelobber lobs clean over a bulwarkroot and still hits"));
  await evalJS(`${R}.clearBlights()`);

  // -- root surges: armed once per lane, second breach loses ----------------------------------
  ok(await evalJS(`${G}.surges.every(Boolean)`), T("all five root surges start armed"));
  await evalJS(`${R}.spawn("shambler", 3, 0.3)`);
  await evalJS(`${R}.fastForward(3)`);
  ok(await evalJS(`${G}.surges[3] === false`), T("a breach fires that lane's root surge (now spent)"));
  ok(await evalJS(`${G}.blights.filter(b => b.lane === 3).length === 0 && ${G}.status === "playing"`),
    T("the surge clears the lane; the level survives the first breach"));
  await evalJS(`${R}.spawn("shambler", 2, 0.3)`);
  await evalJS(`${R}.fastForward(3)`);
  ok(await evalJS(`${G}.surges[2] === false`), T("another lane's first breach still surges"));
  await evalJS(`${R}.spawn("shambler", 3, 0.3)`);
  await evalJS(`${R}.fastForward(3)`);
  ok(await evalJS(`${R}.mode`) === "lost", T("a second breach in a spent lane loses the level"));
  ok(await evalJS(text("#overlay-title")) === "OVERRUN", T("game-over overlay reads OVERRUN"));
  ok(await evalJS(`document.getElementById("overlay").className.includes("dead")`),
    T("the loss overlay wears the dead styling"));

  // -- instant any-key restart ---------------------------------------------------------------------
  await press("KeyZ");
  ok(await evalJS(`${R}.mode`) === "playing", T("any key replants instantly after a loss"));
  ok(await evalJS(`${G}.levelIndex === 4 && ${G}.dew === 50 && ${G}.plants.length === 0 &&
      ${G}.surges.every(Boolean)`),
    T("the restart resets dew, plants and re-arms every surge"));

  // -- FINAL SURGE banner + wave bar fill (real-time, real banner DOM) ------------------------------
  await evalJS(`${R}.disableWaves(); ${R}.setTime(${G}.finalAt - 4.05)`);
  await waitFor(`document.getElementById("banner").classList.contains("show")`,
    T("the FINAL SURGE banner flares before the last wave"));
  ok(await evalJS(`parseFloat(document.getElementById("wave-fill").style.width) > 50`),
    T("the wave progress bar tracks level time"));

  // -- progress survives a reload ---------------------------------------------------------------------
  await navigate(url);
  ok(await evalJS(`!document.querySelectorAll(".level-btn")[1].disabled &&
      document.querySelectorAll(".level-btn")[2].disabled`),
    T("level progress survives a reload"));

  // -- console hygiene -----------------------------------------------------------------------------------
  ok(consoleErrors.length === 0,
    T("zero non-favicon console errors/exceptions") +
    (consoleErrors.length ? " — got:\n    " + consoleErrors.join("\n    ") : ""));
}

// ---- run both schemes, then report ------------------------------------------------
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
