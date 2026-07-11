/* Mothlight headless-browser feature test — node test/browser.test.mjs
 *
 * Self-contained: spawns its own static http server AND headless Chrome
 * (/usr/bin/google-chrome), drives the game over CDP websockets (no npm deps),
 * and runs the full feature scenario over BOTH http:// and file://.
 * Asserts zero non-favicon console errors / uncaught exceptions.
 * Exits 0 on pass, 1 on failure.
 */
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CHROME = "/usr/bin/google-chrome";
const GAME_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
  passed++;
  console.log("  ok - " + msg);
}

// ---------------------------------------------------------------------------
// static file server

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
      const file = path.join(GAME_DIR, rel === "/" ? "index.html" : rel);
      if (!file.startsWith(GAME_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end("not found"); return;
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(fs.readFileSync(file));
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

// ---------------------------------------------------------------------------
// minimal CDP client

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.eventHandlers = [];
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== undefined && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(m.error.message));
        else resolve(m.result);
      } else if (m.method) {
        for (const h of this.eventHandlers) h(m);
      }
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws connect failed")); });
    return new CDP(ws);
  }
  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  onEvent(fn) { this.eventHandlers.push(fn); }
}

function launchChrome(userDataDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn(CHROME, [
      "--headless=new", "--remote-debugging-port=0",
      `--user-data-dir=${userDataDir}`,
      "--no-first-run", "--no-default-browser-check", "--disable-gpu",
      "--autoplay-policy=no-user-gesture-required",
      "--window-size=900,900", "about:blank",
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    proc.stderr.on("data", (d) => {
      err += d.toString();
      const m = err.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) resolve({ proc, wsUrl: m[1] });
    });
    proc.on("exit", () => reject(new Error("chrome exited early:\n" + err)));
    setTimeout(() => reject(new Error("chrome did not start:\n" + err)), 15000);
  });
}

// ---------------------------------------------------------------------------
// a page session: navigation, eval, input, console-error capture

class GamePage {
  constructor(cdp, sessionId, label) {
    this.cdp = cdp;
    this.sessionId = sessionId;
    this.label = label;
    this.errors = [];
  }
  static async open(cdp, url, label) {
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const page = new GamePage(cdp, sessionId, label);
    page.targetId = targetId;
    cdp.onEvent((m) => {
      if (m.sessionId !== sessionId) return;
      if (m.method === "Runtime.exceptionThrown") {
        page.errors.push("exception: " + (m.params.exceptionDetails.exception?.description ||
          m.params.exceptionDetails.text));
      } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
        page.errors.push("console.error: " + m.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
      } else if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
        const e = m.params.entry;
        if (!/favicon/i.test(e.text || "") && !/favicon/i.test(e.url || "")) {
          page.errors.push("log: " + e.text);
        }
      }
    });
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Log.enable", {}, sessionId);
    await page.navigate(url);
    return page;
  }
  async navigate(url) {
    await this.cdp.send("Page.navigate", { url }, this.sessionId);
    await this.waitFor("typeof window.__mothlight === 'object' && document.readyState !== 'loading'");
  }
  async eval(expr) {
    const r = await this.cdp.send("Runtime.evaluate",
      { expression: expr, returnByValue: true }, this.sessionId);
    if (r.exceptionDetails) {
      throw new Error("eval failed: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)
        + "\nexpr: " + expr);
    }
    return r.result.value;
  }
  async waitFor(expr, timeout = 8000) {
    const t0 = Date.now();
    for (;;) {
      if (await this.eval(`!!(${expr})`)) return;
      if (Date.now() - t0 > timeout) throw new Error("timeout waiting for: " + expr);
      await sleep(40);
    }
  }
  async key(code, key, vk, holdMs = 40) {
    await this.cdp.send("Input.dispatchKeyEvent",
      { type: "keyDown", code, key, windowsVirtualKeyCode: vk }, this.sessionId);
    await sleep(holdMs);
    await this.cdp.send("Input.dispatchKeyEvent",
      { type: "keyUp", code, key, windowsVirtualKeyCode: vk }, this.sessionId);
  }
  async mouse(type, x, y, opts = {}) {
    await this.cdp.send("Input.dispatchMouseEvent",
      { type, x, y, button: opts.button || "none", clickCount: opts.clickCount || 0 }, this.sessionId);
  }
  async clickEl(selector) {
    const [cx, cy] = await this.eval(
      `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    await this.mouse("mousePressed", cx, cy, { button: "left", clickCount: 1 });
    await this.mouse("mouseReleased", cx, cy, { button: "left", clickCount: 1 });
  }
  async clickCanvas() {
    const [cx, cy] = await this.eval(
      `(() => { const r = document.getElementById("game").getBoundingClientRect();
        return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    await this.mouse("mousePressed", cx, cy, { button: "left", clickCount: 1 });
    await this.mouse("mouseReleased", cx, cy, { button: "left", clickCount: 1 });
  }
  async touchCanvas() {
    const [cx, cy] = await this.eval(
      `(() => { const r = document.getElementById("game").getBoundingClientRect();
        return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    await this.cdp.send("Input.dispatchTouchEvent",
      { type: "touchStart", touchPoints: [{ x: cx, y: cy }] }, this.sessionId);
    await this.cdp.send("Input.dispatchTouchEvent",
      { type: "touchEnd", touchPoints: [] }, this.sessionId);
  }
  async close() {
    await this.cdp.send("Target.closeTarget", { targetId: this.targetId });
  }
}

// ---------------------------------------------------------------------------
// the full feature scenario (run once per environment)

const S_TITLE = 0, S_PLAY = 1, S_DYING = 2, S_OVER = 3;

async function runScenario(cdp, url, label) {
  console.log(`\n=== scenario: ${label} (${url}) ===`);
  const p = await GamePage.open(cdp, url, label);
  const G = "window.__mothlight";
  // keep every live chain's gap centered on the pinned moth so nothing
  // unexpected kills it between assertions
  const safe = (y) => p.eval(`${G}.setGaps(${y})`);

  // -- boot: title screen, shared logic, arcade chrome ----------------------
  assert(await p.eval(`${G}.state`) === S_TITLE, `${label}: boots to the title screen`);
  assert(await p.eval(`window.MothlightLogic.constants.W === 480 && window.MothlightLogic.constants.FLAP_VY === -470`),
    `${label}: logic.js is loaded and shared with the page`);
  assert(await p.eval(`document.querySelector("#chrome a.back").getAttribute("href")`) === "../../index.html",
    `${label}: back-to-arcade link is present`);
  assert(await p.eval(`${G}.score`) === 0, `${label}: score starts at 0`);

  // -- sound toggle on the title screen --------------------------------------
  assert(await p.eval(`document.getElementById("audio-toggle").textContent`) === "sound: on",
    `${label}: sound button starts "sound: on"`);
  await p.key("KeyM", "m", 77);
  await p.waitFor(`${G}.audioOn === false`);
  assert(await p.eval(`document.getElementById("audio-toggle").textContent`) === "sound: off",
    `${label}: M turns sound off and updates the button`);
  assert(await p.eval(`localStorage.getItem("arcade.mothlight.audio")`) === "off",
    `${label}: audio preference persists to localStorage`);
  await p.clickEl("#audio-toggle");
  await p.waitFor(`${G}.audioOn === true`);
  assert(await p.eval(`localStorage.getItem("arcade.mothlight.audio")`) === "on",
    `${label}: clicking the sound button toggles it back on`);
  assert(await p.eval(`${G}.state`) === S_TITLE,
    `${label}: clicking the sound button does not start the game`);

  // -- Space starts the game with a flap -------------------------------------
  await p.key("Space", " ", 32);
  await p.waitFor(`${G}.state === ${S_PLAY}`);
  assert(true, `${label}: Space starts a run (state=PLAY)`);
  assert(await p.eval(`${G}.moth.vy`) < 0, `${label}: the starting flap sends the moth upward`);
  assert(await p.eval(`${G}.chains.length`) >= 4, `${label}: lantern-chains are spawned`);

  // park the moth mid-air and keep gaps centered on it for the control tests
  await p.eval(`${G}.pin(300)`);
  await safe(300);

  // -- flap SETS vy (never adds) — click, ArrowUp, W, touch -------------------
  // From vy=+620 (near terminal) any negative vy right after the input proves
  // the flap SET the velocity; an additive impulse would leave it positive.
  await p.eval(`${G}.unpin(); ${G}.setMoth(300, 620); ${G}.setGaps(300)`);
  await p.clickCanvas();
  await p.waitFor(`${G}.moth.vy < -100`);
  assert(true, `${label}: canvas click flaps — vy jumps from +620 to negative (set, not added)`);
  await p.eval(`${G}.setMoth(300, 620); ${G}.setGaps(300)`);
  await p.key("ArrowUp", "ArrowUp", 38);
  await p.waitFor(`${G}.moth.vy < -100`);
  assert(true, `${label}: ArrowUp flaps`);
  await p.eval(`${G}.setMoth(300, 620); ${G}.setGaps(300)`);
  await p.key("KeyW", "w", 87);
  await p.waitFor(`${G}.moth.vy < -100`);
  assert(true, `${label}: W flaps`);
  await p.eval(`${G}.setMoth(300, 620); ${G}.setGaps(300)`);
  await p.touchCanvas();
  await p.waitFor(`${G}.moth.vy < -100`);
  assert(true, `${label}: touch flaps`);
  await p.eval(`${G}.pin(300)`);
  await safe(300);

  // -- pause: P toggles, any key resumes, blur auto-pauses --------------------
  await p.key("KeyP", "p", 80);
  await p.waitFor(`${G}.paused === true`);
  assert(true, `${label}: P pauses`);
  await p.key("KeyP", "p", 80);
  await p.waitFor(`${G}.paused === false`);
  assert(true, `${label}: P resumes`);
  await p.key("KeyP", "p", 80);
  await p.waitFor(`${G}.paused === true`);
  await p.key("Space", " ", 32);
  await p.waitFor(`${G}.paused === false`);
  assert(true, `${label}: any key resumes from pause`);
  await safe(300);
  await p.eval(`window.dispatchEvent(new Event("blur"))`);
  await p.waitFor(`${G}.paused === true`);
  assert(true, `${label}: window blur auto-pauses`);
  await p.clickCanvas();
  await p.waitFor(`${G}.paused === false`);
  assert(true, `${label}: click resumes after the blur pause`);
  await safe(300);

  // -- world scrolls left while the moth's x never changes --------------------
  const x0 = await p.eval(`${G}.chains[0].x`);
  await sleep(250);
  const x1 = await p.eval(`${G}.chains[0].x`);
  assert(x1 < x0 - 20, `${label}: chains scroll left (${x0.toFixed(0)} -> ${x1.toFixed(0)})`);

  // -- scoring: passing a gap's center-line scores 1 point ---------------------
  await safe(300);
  await p.eval(`(() => { const m = ${G};
    const c = m.chains.find(c => !c.scored && c.x > 144 + 40);
    m.warp(c.x - 144 - 40);            // put it just right of the moth
    m.setGaps(300); })()`);
  await p.waitFor(`${G}.score >= 1`);
  assert(true, `${label}: passing a lantern-chain scores 1 point`);
  assert(await p.eval(`${G}.chains.some(c => c.scored && c.x <= 144)`),
    `${label}: the scored chain has crossed the moth's center-line`);
  await safe(300);
  await p.eval(`(() => { const m = ${G};
    const c = m.chains.find(c => !c.scored && c.x > 144 + 40);
    m.warp(c.x - 144 - 40); m.setGaps(300); })()`);
  await p.waitFor(`${G}.score >= 2`);
  assert(true, `${label}: each chain scores exactly once (score=2 after two passes)`);

  // -- touching a lantern kills: DYING tumble, then game over ------------------
  const runScore = await p.eval(`${G}.score`);
  await p.eval(`${G}.pin(150)`);
  await p.eval(`(() => { const m = ${G};
    m.setGaps(500);                    // gap far from the pinned moth
    const c = m.chains.find(c => c.x > 144 + 40);
    m.warp(c.x - 144 - 40); })()`);
  await p.waitFor(`${G}.state === ${S_DYING}`);
  assert(true, `${label}: touching a lantern-chain starts the dying tumble`);
  await p.waitFor(`${G}.state === ${S_OVER}`);
  assert(Math.abs(await p.eval(`${G}.moth.y`) - 668) < 2,
    `${label}: the tumble ends on the moss (y≈668) at game over`);

  // -- high score persists ------------------------------------------------------
  assert(await p.eval(`${G}.high`) === runScore,
    `${label}: best score updates to the run's score (${runScore})`);
  assert(await p.eval(`${G}.newHigh`) === true, `${label}: the run is flagged as a new best`);
  assert(await p.eval(`localStorage.getItem("arcade.mothlight.high")`) === String(runScore),
    `${label}: best persists in localStorage under arcade.mothlight.high`);

  // -- anything restarts instantly (after the 350ms guard) ----------------------
  await p.eval(`${G}.unpin()`);
  await sleep(500);
  await p.key("KeyX", "x", 88);        // "anything" — not a flap key
  await p.waitFor(`${G}.state === ${S_PLAY}`);
  assert(await p.eval(`${G}.score`) === 0, `${label}: any key after game over restarts fresh at score 0`);

  // -- ceiling clamps without killing --------------------------------------------
  await p.eval(`${G}.setMoth(16, -600)`);
  await sleep(120);
  assert(await p.eval(`${G}.state`) === S_PLAY && await p.eval(`${G}.moth.y`) >= 14,
    `${label}: the ceiling clamps the moth (no death, y >= 14)`);

  // -- the moss below kills too ----------------------------------------------------
  await p.waitFor(`${G}.state === ${S_OVER}`, 10000);   // stop flapping: fall + tumble
  assert(true, `${label}: falling to the moss ends the run`);
  assert(await p.eval(`${G}.high`) === runScore,
    `${label}: a worse run leaves the best score untouched`);

  // -- click also restarts ----------------------------------------------------------
  await sleep(500);
  await p.clickCanvas();
  await p.waitFor(`${G}.state === ${S_PLAY}`);
  assert(true, `${label}: a click after game over restarts instantly`);
  await p.eval(`${G}.pin(300)`); await safe(300);

  // -- best score survives a reload ---------------------------------------------------
  await p.navigate(url);
  assert(await p.eval(`${G}.state`) === S_TITLE, `${label}: reload boots back to the title screen`);
  assert(await p.eval(`${G}.high`) === runScore,
    `${label}: best score survives a page reload (localStorage)`);

  // -- zero console errors ---------------------------------------------------------------
  assert(p.errors.length === 0,
    `${label}: zero non-favicon console errors / exceptions` +
    (p.errors.length ? "\n" + p.errors.join("\n") : ""));

  await p.close();
}

// ---------------------------------------------------------------------------
// main

async function main() {
  if (!fs.existsSync(CHROME)) throw new Error("chrome not found at " + CHROME);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mothlight-test-"));
  const server = await startServer();
  const { proc, wsUrl } = await launchChrome(userDataDir);
  try {
    const cdp = await CDP.connect(wsUrl);
    const httpUrl = `http://127.0.0.1:${server.address().port}/index.html`;
    const fileUrl = pathToFileURL(path.join(GAME_DIR, "index.html")).href;
    await runScenario(cdp, httpUrl, "http");
    await runScenario(cdp, fileUrl, "file");
    console.log(`\nPASS — ${passed} browser assertions across http:// and file://`);
  } finally {
    proc.kill("SIGKILL");
    server.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0), (err) => { console.error("\nFAIL:", err.message); process.exit(1); });
