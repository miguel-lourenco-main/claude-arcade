/* Brickstorm headless-browser feature test — node test/browser.test.mjs
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
const REPO_ROOT = path.resolve(GAME_DIR, "..", "..");

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
      const file = path.join(REPO_ROOT, rel === "/" ? "index.html" : rel);
      if (!file.startsWith(REPO_ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
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
    await this.waitFor("typeof window.__brickstorm === 'object' && document.readyState !== 'loading'");
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
  async waitFor(expr, timeout = 6000) {
    const t0 = Date.now();
    for (;;) {
      if (await this.eval(`!!(${expr})`)) return;
      if (Date.now() - t0 > timeout) throw new Error("timeout waiting for: " + expr);
      await sleep(40);
    }
  }
  async key(code, key, vk, holdMs = 60) {
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
  async canvasRect() {
    return this.eval(`(() => { const r = document.getElementById("game").getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
  }
  async close() {
    await this.cdp.send("Target.closeTarget", { targetId: this.targetId });
  }
}

// ---------------------------------------------------------------------------
// the full feature scenario (run once per environment)

async function runScenario(cdp, url, label) {
  console.log(`\n=== scenario: ${label} (${url}) ===`);
  const p = await GamePage.open(cdp, url, label);
  const G = "window.__brickstorm";

  // -- title screen & initial HUD ------------------------------------------
  assert(await p.eval(`${G}.state`) === "title", `${label}: boots to title state`);
  assert(await p.eval(`!document.getElementById("overlay").classList.contains("hidden")`),
    `${label}: title overlay is visible`);
  assert(await p.eval(`document.getElementById("overlay-title").textContent`) === "BRICKSTORM",
    `${label}: overlay shows BRICKSTORM`);
  assert(await p.eval(`document.getElementById("hud-score").textContent`) === "0",
    `${label}: HUD score starts at 0`);
  assert(await p.eval(`document.getElementById("hud-level").textContent`) === "1",
    `${label}: HUD level starts at 1`);
  assert(await p.eval(`document.getElementById("hud-lives").textContent`) === "●●●",
    `${label}: HUD shows 3 lives`);
  assert(await p.eval(`window.BrickstormLogic.buildLevel(1).length`) === 60,
    `${label}: logic.js is loaded and shared with the page`);

  // -- start game with Space -----------------------------------------------
  await p.key("Space", " ", 32);
  await p.waitFor(`${G}.state === "serve"`);
  assert(true, `${label}: Space starts a new game (state=serve)`);
  assert(await p.eval(`document.getElementById("overlay").classList.contains("hidden")`),
    `${label}: overlay hides when the game starts`);
  assert(await p.eval(`${G}.bricks.length`) === 60,
    `${label}: level 1 builds 60 bricks`);
  assert(await p.eval(`${G}.balls.length === 1 && ${G}.balls[0].stuck`),
    `${label}: serve ball is attached to the paddle`);

  // -- keyboard paddle movement --------------------------------------------
  let x0 = await p.eval(`${G}.paddle.x`);
  await p.key("ArrowRight", "ArrowRight", 39, 150);
  await sleep(60);
  let x1 = await p.eval(`${G}.paddle.x`);
  assert(x1 > x0 + 20, `${label}: ArrowRight moves the paddle right (${x0.toFixed(1)} -> ${x1.toFixed(1)})`);
  await p.key("KeyA", "a", 65, 150);
  await sleep(60);
  let x2 = await p.eval(`${G}.paddle.x`);
  assert(x2 < x1 - 20, `${label}: A moves the paddle left (${x1.toFixed(1)} -> ${x2.toFixed(1)})`);

  // -- mouse paddle movement -------------------------------------------------
  const rect = await p.canvasRect();
  const targetGameX = 120;
  await p.mouse("mouseMoved", rect.left + (targetGameX / 480) * rect.width, rect.top + rect.height * 0.8);
  await sleep(120);
  const mx = await p.eval(`${G}.paddle.x`);
  assert(Math.abs(mx - targetGameX) < 3, `${label}: mouse move places the paddle (got ${mx.toFixed(1)}, want ~${targetGameX})`);

  // -- serve -----------------------------------------------------------------
  await p.key("Space", " ", 32);
  await p.waitFor(`${G}.state === "play"`);
  assert(true, `${label}: Space serves the ball (state=play)`);
  assert(await p.eval(`!${G}.balls[0].stuck && ${G}.balls[0].vy < 0`),
    `${label}: served ball is free and moving upward`);
  const spd = await p.eval(`Math.hypot(${G}.balls[0].vx, ${G}.balls[0].vy)`);
  assert(Math.abs(spd - 285) < 2, `${label}: serve speed matches level-1 base (285), got ${spd.toFixed(1)}`);

  // -- brick hit: score + damage --------------------------------------------
  await p.eval(`(() => { const g = ${G};
    const low = g.bricks.filter(b => b.alive).sort((a, b) => b.y - a.y)[0];
    const ball = g.balls[0];
    ball.x = low.x + low.w / 2; ball.y = low.y + low.h + 30;
    ball.px = ball.x; ball.py = ball.y;
    ball.vx = 1; ball.vy = -280;
  })()`);
  await p.waitFor(`${G}.hitCount >= 1`);
  assert(await p.eval(`${G}.score`) >= 5, `${label}: hitting a brick scores points`);
  assert(await p.eval(`${G}.bricks.some(b => !b.alive || b.hp < b.maxHp)`),
    `${label}: the struck brick took damage (hp down or destroyed)`);
  assert(await p.eval(`document.getElementById("hud-score").textContent !== "0"`),
    `${label}: HUD score updates after a brick hit`);

  // park the ball on the paddle so no life is lost during power-up tests
  await p.eval(`(() => { const g = ${G};
    g.balls = [g.balls[0]]; g.balls[0].stuck = true; g.balls[0].stuckOff = 0; })()`);

  // -- power-up capsules ------------------------------------------------------
  const dropPower = (kind) => p.eval(`(() => { const g = ${G};
    g.powers.push({ kind: ${JSON.stringify(kind)}, x: g.paddle.x, y: 560, py: 560, vy: 130 });
  })()`);

  let scoreBefore = await p.eval(`${G}.score`);
  await dropPower("wide");
  await p.waitFor(`${G}.paddle.targetW === 124`);
  assert(true, `${label}: catching a W capsule widens the paddle to 124`);
  assert(await p.eval(`${G}.paddle.wideTimer`) > 10, `${label}: wide power lasts ~12 s`);
  assert(await p.eval(`${G}.score`) === scoreBefore + 50, `${label}: capsule catch scores +50`);
  await p.eval(`${G}.paddle.wideTimer = 0.05`);
  await p.waitFor(`${G}.paddle.targetW === 76`);
  assert(true, `${label}: wide power expires back to normal width`);

  await dropPower("slow");
  await p.waitFor(`${G}.slowTimer > 0`);
  assert(await p.eval(`${G}.slowTimer`) > 7, `${label}: catching an S capsule starts the ~8 s slow timer`);
  await p.eval(`${G}.slowTimer = 0.05`);
  await p.waitFor(`${G}.slowTimer <= 0`);
  assert(true, `${label}: slow power expires`);

  const ballsBefore = await p.eval(`${G}.balls.length`);
  await dropPower("multi");
  await p.waitFor(`${G}.balls.length > ${ballsBefore}`);
  assert(await p.eval(`${G}.balls.length`) === ballsBefore + 2,
    `${label}: catching an M capsule adds two extra balls`);
  // cap check: keep stuffing multiballs — never above 6
  await dropPower("multi"); await sleep(400);
  await dropPower("multi"); await sleep(400);
  assert(await p.eval(`${G}.balls.length`) <= 6, `${label}: multiball caps at 6 balls`);
  // clean up back to one parked ball
  await p.eval(`(() => { const g = ${G};
    g.balls = [g.balls[0]]; g.balls[0].stuck = true; g.balls[0].stuckOff = 0;
    g.powers = []; })()`);

  // capsule falls off the bottom when missed
  await p.eval(`${G}.powers.push({ kind: "wide", x: 20, y: 560, py: 560, vy: 130 })`);
  await p.waitFor(`${G}.powers.length === 0`);
  assert(true, `${label}: a missed capsule falls off the screen and despawns`);

  // -- pause: P toggles, blur pauses, click resumes ---------------------------
  await p.key("KeyP", "p", 80);
  await p.waitFor(`${G}.paused === true`);
  assert(await p.eval(`document.getElementById("overlay-title").textContent`) === "PAUSED",
    `${label}: P pauses and shows the PAUSED overlay`);
  await p.key("KeyP", "p", 80);
  await p.waitFor(`${G}.paused === false`);
  assert(true, `${label}: P resumes from pause`);

  await p.eval(`window.dispatchEvent(new Event("blur"))`);
  await p.waitFor(`${G}.paused === true`);
  assert(true, `${label}: window blur auto-pauses`);
  await p.clickEl("#overlay-panel");
  await p.waitFor(`${G}.paused === false`);
  assert(true, `${label}: clicking the overlay resumes`);

  // -- sound toggle: M key and the SND button ---------------------------------
  const sndBefore = await p.eval(`document.getElementById("audio-toggle").textContent`);
  await p.key("KeyM", "m", 77);
  await sleep(80);
  const sndAfter = await p.eval(`document.getElementById("audio-toggle").textContent`);
  assert(sndBefore !== sndAfter && /^SND (ON|OFF)$/.test(sndAfter),
    `${label}: M toggles the sound button (${sndBefore} -> ${sndAfter})`);
  const lsAudio = await p.eval(`localStorage.getItem("arcade.brickstorm.audio")`);
  assert(lsAudio === (sndAfter === "SND ON" ? "1" : "0"),
    `${label}: audio preference persists to localStorage`);
  await p.clickEl("#audio-toggle");
  await sleep(80);
  assert(await p.eval(`document.getElementById("audio-toggle").textContent`) === sndBefore,
    `${label}: clicking the SND button toggles sound back`);

  // -- top-row speed boost + level clear --------------------------------------
  await p.eval(`(() => { const g = ${G};
    const keep = g.bricks.find(b => b.alive && b.row === 0);
    for (const b of g.bricks) if (b !== keep) b.alive = false;
    keep.hp = 1;
    const ball = g.balls[0];
    ball.stuck = false;
    ball.x = keep.x + keep.w / 2; ball.y = keep.y + keep.h + 30;
    ball.px = ball.x; ball.py = ball.y;
    ball.vx = 1; ball.vy = -280;
  })()`);
  await p.waitFor(`${G}.state === "clear"`);
  assert(true, `${label}: destroying the last brick triggers the level-clear state`);
  assert(await p.eval(`${G}.topRowsTouched === true`),
    `${label}: first top-row contact arms the +14% speed boost`);
  await p.waitFor(`${G}.level === 2 && ${G}.state === "serve"`, 4000);
  assert(await p.eval(`document.getElementById("hud-level").textContent`) === "2",
    `${label}: HUD level advances to 2`);
  assert(await p.eval(`${G}.bricks.length`) ===
    await p.eval(`window.BrickstormLogic.buildLevel(2).length`),
    `${label}: level 2 rebuilds its own (checkerboard) brick pattern`);

  // -- losing a ball costs a life ----------------------------------------------
  await p.key("Space", " ", 32);
  await p.waitFor(`${G}.state === "play"`);
  await p.eval(`for (const b of ${G}.balls) { b.y = 900; b.py = 900; b.vy = 300; }`);
  await p.waitFor(`${G}.lives === 2 && ${G}.state === "serve"`);
  assert(await p.eval(`document.getElementById("hud-lives").textContent`) === "●●",
    `${label}: losing the ball drops a life on the HUD`);

  // -- game over + high score persistence ---------------------------------------
  const finalScore = await p.eval(`${G}.score`);
  await p.eval(`${G}.lives = 1`);
  await p.key("Space", " ", 32);
  await p.waitFor(`${G}.state === "play"`);
  await p.eval(`for (const b of ${G}.balls) { b.y = 900; b.py = 900; b.vy = 300; }`);
  await p.waitFor(`${G}.state === "gameover"`);
  assert(await p.eval(`document.getElementById("overlay-title").textContent`) === "GAME OVER",
    `${label}: game over shows the GAME OVER overlay`);
  assert(finalScore > 0, `${label}: run ended with a positive score (${finalScore})`);
  const storedHi = await p.eval(`localStorage.getItem("arcade.brickstorm.hiscore")`);
  assert(parseInt(storedHi, 10) >= finalScore,
    `${label}: high score persisted to localStorage (${storedHi})`);
  assert(await p.eval(`document.getElementById("hud-hiscore").textContent`) === String(await p.eval(`${G}.hiscore`)),
    `${label}: HUD shows the new high score`);

  // -- restart from game over -----------------------------------------------------
  await p.clickEl("#overlay-panel");
  await p.waitFor(`${G}.state === "serve"`);
  assert(await p.eval(`${G}.score === 0 && ${G}.lives === 3 && ${G}.level === 1`),
    `${label}: clicking after game over restarts fresh (score 0, 3 lives, level 1)`);

  // -- high score survives a reload -------------------------------------------------
  await p.navigate(url);
  assert(await p.eval(`${G}.hiscore`) >= finalScore,
    `${label}: high score survives a page reload`);
  assert(await p.eval(`document.getElementById("hud-hiscore").textContent !== "0"`),
    `${label}: reloaded HUD shows the persisted high score`);

  // -- zero console errors ------------------------------------------------------------
  assert(p.errors.length === 0,
    `${label}: zero non-favicon console errors / exceptions` +
    (p.errors.length ? "\n" + p.errors.join("\n") : ""));

  await p.close();
}

// ---------------------------------------------------------------------------
// main

async function main() {
  if (!fs.existsSync(CHROME)) throw new Error("chrome not found at " + CHROME);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "brickstorm-test-"));
  const server = await startServer();
  const { proc, wsUrl } = await launchChrome(userDataDir);
  try {
    const cdp = await CDP.connect(wsUrl);
    const httpUrl = `http://127.0.0.1:${server.address().port}/games/brickstorm/index.html`;
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
