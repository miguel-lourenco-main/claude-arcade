#!/usr/bin/env node
/* Headless-Chrome CDP feature test for Wyrm.
 *
 * Self-contained: no npm deps (node >= 22 has fetch + WebSocket). Spawns its
 * own local http server, drives /usr/bin/google-chrome over the DevTools
 * websocket, and runs the FULL feature suite over BOTH http:// and file://.
 * Asserts zero non-favicon console errors / exceptions. Exits 0 on pass.
 *
 *   node games/wyrm/test/browser.test.mjs
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
const HTTP_URL = `http://127.0.0.1:${server.address().port}/index.html?wyrmtest=1`;
const FILE_URL = "file://" + path.join(GAME_DIR, "index.html") + "?wyrmtest=1";

// ---- chrome ----------------------------------------------------------------------
const profile = mkdtempSync(path.join(os.tmpdir(), "wyrm-cdp-"));
const debugPort = 9222 + Math.floor(Math.random() * 800);
const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check",
  "--disable-gpu", "--mute-audio", "--window-size=900,800",
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
  await sleep(120);
}

async function evalJS(expression) {
  const r = await send("Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) {
    throw new Error("eval threw: " +
      (r.exceptionDetails.exception?.description || r.exceptionDetails.text) +
      "\n  in: " + expression.slice(0, 120));
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
  ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39,
  KeyW: 87, KeyA: 65, KeyS: 83, KeyD: 68,
  KeyP: 80, KeyM: 77, KeyX: 88, Escape: 27,
};
const KEYNAME = {
  ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight",
  KeyW: "w", KeyA: "a", KeyS: "s", KeyD: "d",
  KeyP: "p", KeyM: "m", KeyX: "x", Escape: "Escape",
};
async function press(code) {
  const base = { code, key: KEYNAME[code], windowsVirtualKeyCode: VK[code] };
  await send("Input.dispatchKeyEvent", { type: "keyDown", ...base }, sessionId);
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...base }, sessionId);
}

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

const W = "window.__wyrm"; // guarded test handle (page loaded with ?wyrmtest=1)
const text = (sel) => `document.querySelector(${JSON.stringify(sel)}).textContent`;

// Choreographed ember bite: pause, place the wyrm and one ember dead ahead,
// resume, wait for the bite (the poll relocates the next random ember to a
// far corner in the same breath, so the roaming wyrm can't double-dip).
async function eatOneEmber() {
  const before = await evalJS(`${W}.score`);
  await press("KeyP"); // pause so setup can't race the tick loop
  await evalJS(`(() => {
    const w = ${W};
    w.setDir("right");
    w.setSnake([{x:5,y:5},{x:4,y:5},{x:3,y:5},{x:2,y:5}]);
    w.setFood(7, 5);
  })()`);
  await press("KeyP"); // resume
  await waitFor(
    `(() => { const w = ${W}; if (w.score > ${before}) { w.setFood(0, 21); return true; } return false; })()`,
    "wyrm ate the ember placed in its path"
  );
  return (await evalJS(`${W}.score`)) - before;
}

// ================= the feature suite (runs once per URL scheme) =================
async function runSuite(url, scheme) {
  console.log(`\n=== ${scheme} :: ${url} ===`);

  // fresh storage, then a clean load whose console we police
  await navigate(url);
  await evalJS("localStorage.clear()");
  consoleErrors = [];
  await navigate(url);

  // -- boot & menu ------------------------------------------------------------
  ok(await evalJS("document.title") === "Wyrm", `[${scheme}] page title is "Wyrm"`);
  ok(await evalJS("!!window.WyrmLogic && !!window.__wyrm"),
    `[${scheme}] scripts loaded (classic tags): WyrmLogic + guarded test handle present`);
  ok(await evalJS(`document.getElementById("overlay").className`) === "show",
    `[${scheme}] menu overlay is shown on boot`);
  ok(await evalJS(text("#overlay-title")) === "WYRM",
    `[${scheme}] menu overlay titled WYRM`);
  ok(await evalJS(text("#overlay-sub")).then((t) => t.includes("press any direction")),
    `[${scheme}] menu prompts "press any direction"`);
  ok(await evalJS(text("#score")) === "0", `[${scheme}] HUD score starts at 0`);
  ok(await evalJS(text("#best")) === "0", `[${scheme}] HUD best starts at 0 (storage cleared)`);
  ok(await evalJS(text("#length")) === "4", `[${scheme}] HUD length starts at 4`);
  ok(await evalJS(text("#speed")) === "1.0x", `[${scheme}] HUD speed starts at 1.0x`);
  ok(await evalJS(`document.querySelector("#topbar .back").getAttribute("href")`) === "../../index.html",
    `[${scheme}] back-to-arcade link points at the arcade index`);
  ok(await evalJS(`(() => { const c = document.getElementById("game"); return c.width > 0 && c.height > 0; })()`),
    `[${scheme}] canvas has a real backing size`);

  // -- sound toggle button (real mouse click) ----------------------------------
  await click("#audio-toggle");
  ok(await evalJS(text("#audio-toggle")) === "sound: off",
    `[${scheme}] clicking the sound button turns audio off`);
  ok(await evalJS(`localStorage.getItem("arcade.wyrm.audio")`) === "off",
    `[${scheme}] audio preference persists to localStorage`);
  await click("#audio-toggle");
  ok(await evalJS(text("#audio-toggle")) === "sound: on",
    `[${scheme}] clicking again turns audio back on`);

  // -- start with an arrow key --------------------------------------------------
  await press("ArrowRight");
  ok(await evalJS(`${W}.state`) === "playing", `[${scheme}] a direction key starts the run`);
  ok(await evalJS(`document.getElementById("overlay").className`) === "",
    `[${scheme}] overlay hides once playing`);
  await waitFor(`${W}.snake[0].x > 11`, `[${scheme}] wyrm slithers right after start`);

  // -- steering: WASD then arrows ------------------------------------------------
  await press("KeyS"); // down
  await waitFor(`${W}.dir.y === 1`, `[${scheme}] KeyS (WASD) steers the wyrm down`);
  await press("ArrowLeft"); // moving down, left is legal
  await waitFor(`${W}.dir.x === -1`, `[${scheme}] ArrowLeft steers the wyrm left`);

  // -- 180-degree reversal is rejected --------------------------------------------
  await evalJS(`${W}.setDir("right")`); // known heading, empty queue
  await press("ArrowLeft");
  ok(await evalJS(`${W}.dirQueue.length`) === 0,
    `[${scheme}] a 180-degree reversal key is rejected (queue stays empty)`);

  // -- eating: score, growth, speed ramp -------------------------------------------
  // (each staged bite starts from a fresh 4-long body, so length lands on 5)
  const gain1 = await eatOneEmber();
  ok(gain1 === 10, `[${scheme}] first ember pays exactly 10 (no speed bonus yet), got +${gain1}`);
  ok(await evalJS(`${W}.snake.length`) === 5,
    `[${scheme}] eating grows the wyrm by one segment`);
  const gain2 = await eatOneEmber();
  ok(gain2 === 11, `[${scheme}] second ember pays 11 (speed bonus kicked in), got +${gain2}`);
  const gain3 = await eatOneEmber();
  ok(gain3 === 12, `[${scheme}] third ember pays 12 (bonus scales with tick speed), got +${gain3}`);
  ok(await evalJS(text("#score")) === "33", `[${scheme}] HUD score reads 33 after three embers`);
  ok(await evalJS(text("#length")) === "5",
    `[${scheme}] HUD length tracks growth (staged 4-long body grew to 5)`);
  ok(await evalJS(text("#speed")) === "1.1x",
    `[${scheme}] HUD speed ramped to 1.1x after three embers`);

  // -- pause / resume ------------------------------------------------------------------
  await press("KeyP");
  ok(await evalJS(`${W}.state`) === "paused", `[${scheme}] P pauses the game`);
  ok(await evalJS(text("#overlay-title")) === "PAUSED",
    `[${scheme}] pause overlay reads PAUSED`);
  await press("KeyP");
  ok(await evalJS(`${W}.state`) === "playing", `[${scheme}] P resumes the game`);
  await press("Escape");
  ok(await evalJS(`${W}.state`) === "paused", `[${scheme}] Escape also pauses`);
  await press("ArrowUp");
  ok(await evalJS(`${W}.state`) === "playing",
    `[${scheme}] a direction key resumes from pause (and steers)`);

  // -- auto-pause on window blur ----------------------------------------------------------
  await evalJS(`window.dispatchEvent(new Event("blur"))`);
  ok(await evalJS(`${W}.state`) === "paused", `[${scheme}] losing window focus auto-pauses`);
  await press("KeyP"); // back to playing

  // -- M toggles sound mid-game -------------------------------------------------------------
  await press("KeyM");
  ok(await evalJS(text("#audio-toggle")) === "sound: off",
    `[${scheme}] M key toggles sound off while playing`);
  await press("KeyM");
  ok(await evalJS(text("#audio-toggle")) === "sound: on",
    `[${scheme}] M key toggles sound back on`);

  // -- tail-chase is legal (tail vacates on the same tick) -----------------------------------
  await press("KeyP");
  await evalJS(`(() => {
    const w = ${W};
    w.setDir("down");
    w.setSnake([{x:10,y:10},{x:11,y:10},{x:11,y:11},{x:10,y:11}]);
    w.setFood(0, 21);
  })()`);
  await press("KeyP");
  await waitFor(`(() => { const w = ${W}; const h = w.snake[0];
    return w.state === "playing" && h.x === 10 && h.y >= 11; })()`,
    `[${scheme}] moving into the vacating tail cell is legal (no death)`);

  // -- death by self-bite, DEVOURED overlay, best persistence ---------------------------------
  await press("KeyP");
  await evalJS(`(() => {
    const w = ${W};
    w.setDir("down");
    w.setSnake([{x:10,y:10},{x:10,y:11},{x:11,y:11},{x:11,y:10},{x:12,y:10}]);
    w.setFood(0, 21);
  })()`);
  await press("KeyP");
  await waitFor(`["dying","over"].includes(${W}.state)`,
    `[${scheme}] biting your own body kills the wyrm`);
  await waitFor(`${W}.state === "over"`,
    `[${scheme}] death settles into the game-over state`, 3000);
  ok(await evalJS(text("#overlay-title")) === "DEVOURED",
    `[${scheme}] game-over overlay reads DEVOURED`);
  ok(await evalJS(text("#overlay-sub")).then((t) => t.includes("any key")),
    `[${scheme}] game-over overlay offers any-key restart`);
  ok(await evalJS(text("#overlay-score")).then((t) => t.includes("33") && t.includes("new best")),
    `[${scheme}] game-over overlay shows the score and flags the new best`);
  ok(await evalJS(`localStorage.getItem("arcade.wyrm.best")`) === "33",
    `[${scheme}] best score persisted under arcade.wyrm.best`);
  ok(await evalJS(text("#best")) === "33", `[${scheme}] HUD best updated to 33`);

  // -- any-key instant restart -----------------------------------------------------------------
  await press("KeyX");
  ok(await evalJS(`${W}.state`) === "playing",
    `[${scheme}] any key restarts instantly after death`);
  ok(await evalJS(text("#score")) === "0", `[${scheme}] restart resets the score`);
  ok(await evalJS(`${W}.snake.length`) === 4, `[${scheme}] restart resets the wyrm length`);

  // -- death by wall ------------------------------------------------------------------------------
  await press("KeyP");
  await evalJS(`(() => {
    const w = ${W};
    w.setDir("right");
    w.setSnake([{x:25,y:10},{x:24,y:10},{x:23,y:10},{x:22,y:10}]);
    w.setFood(0, 21);
  })()`);
  await press("KeyP");
  await waitFor(`${W}.state === "over"`, `[${scheme}] hitting the wall kills the wyrm`, 3000);

  // -- restart straight into a chosen direction ---------------------------------------------------
  await press("ArrowUp");
  ok(await evalJS(`${W}.state`) === "playing",
    `[${scheme}] a direction key restarts after death`);
  await waitFor(`${W}.dir.y === -1`, `[${scheme}] the restart direction key is applied (heading up)`);

  // -- the ASCENDED win: board full, no free cell for food -----------------------------------------
  await press("KeyP"); // freeze ticks while we fill the world
  await evalJS(`(() => {
    const w = ${W};
    const cells = [];
    for (let y = 0; y < 22; y++) {
      if (y % 2 === 0) for (let x = 0; x < 26; x++) cells.push({ x, y });
      else for (let x = 25; x >= 0; x--) cells.push({ x, y });
    }
    w.setSnake(cells);
    w.forceSpawnFood();
  })()`);
  ok(await evalJS(`${W}.state`) === "over",
    `[${scheme}] filling the board ends the run`);
  ok(await evalJS(text("#overlay-title")) === "ASCENDED",
    `[${scheme}] win overlay reads ASCENDED`);
  ok(await evalJS(text("#length")) === "572",
    `[${scheme}] HUD shows the world-filling length (26*22)`);

  // -- best survives a reload ------------------------------------------------------------------------
  await navigate(url);
  ok(await evalJS(text("#best")) === "33", `[${scheme}] best score survives a reload`);
  ok(await evalJS(text("#overlay-score")).then((t) => t.includes("best")),
    `[${scheme}] menu overlay shows the persisted best`);

  // -- starting with LEFT is safe: run starts, wyrm keeps facing right -------------------------------
  await press("ArrowLeft");
  ok(await evalJS(`${W}.state`) === "playing",
    `[${scheme}] ArrowLeft also starts the run from the menu`);
  await waitFor(`${W}.snake[0].x > 11`,
    `[${scheme}] left-start does not reverse the wyrm into itself (still heads right)`);

  // -- console hygiene ---------------------------------------------------------------------------------
  ok(consoleErrors.length === 0,
    `[${scheme}] zero non-favicon console errors/exceptions` +
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
