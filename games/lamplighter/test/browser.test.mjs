/* Lamplighter — headless-Chrome feature test over CDP. No npm deps.
   Run: node games/lamplighter/test/browser.test.mjs   (exit 0 on pass)

   Spawns its own http server and a headless Chrome, then runs the full
   feature scenario twice: once over http:// and once over file://.
   Asserts zero non-favicon console errors / uncaught exceptions. */

import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GAME_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(GAME_DIR, "..", "..");
const CHROME = "/usr/bin/google-chrome";

/* ---------------- tiny assert + log helpers ---------------- */

let checks = 0;
function ok(cond, msg) {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
  checks++;
}
function eq(a, b, msg) {
  ok(Object.is(a, b), msg + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- static http server ---------------- */

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml",
};
function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (urlPath === "/favicon.ico") { res.writeHead(204); res.end(); return; }
      let fp = path.join(REPO_ROOT, urlPath === "/" ? "index.html" : urlPath);
      if (!fp.startsWith(REPO_ROOT)) { res.writeHead(403); res.end(); return; }
      fs.readFile(fp, (err, data) => {
        if (err) { res.writeHead(404); res.end("not found"); return; }
        res.writeHead(200, { "Content-Type": MIME[path.extname(fp)] || "application/octet-stream" });
        res.end(data);
      });
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

/* ---------------- minimal CDP client ---------------- */

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const h of this.handlers) h(msg);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  on(fn) { this.handlers.push(fn); }
}

function connectWS(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => resolve(ws));
    ws.addEventListener("error", (e) => reject(new Error("ws error: " + e.message)));
  });
}

/* ---------------- chrome ---------------- */

function launchChrome(userDataDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn(CHROME, [
      "--headless=new", "--remote-debugging-port=0",
      "--user-data-dir=" + userDataDir,
      "--no-first-run", "--no-default-browser-check", "--disable-gpu",
      "--mute-audio", "--window-size=760,860", "--hide-scrollbars",
      "about:blank",
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    const onData = (d) => {
      err += d.toString();
      const m = err.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) resolve({ proc, wsUrl: m[1] });
    };
    proc.stderr.on("data", onData);
    proc.on("exit", (code) => reject(new Error("chrome exited early (" + code + "): " + err)));
    setTimeout(() => reject(new Error("chrome did not report a DevTools endpoint")), 15000);
  });
}

/* ---------------- page session wrapper ---------------- */

class Page {
  constructor(cdp, sessionId, label) {
    this.cdp = cdp;
    this.sessionId = sessionId;
    this.label = label;
    this.errors = [];
    cdp.on((msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === "Runtime.exceptionThrown") {
        this.errors.push("exception: " + JSON.stringify(msg.params.exceptionDetails).slice(0, 400));
      } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
        const text = msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
        if (!/favicon/i.test(text)) this.errors.push("console.error: " + text.slice(0, 400));
      } else if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
        const e = msg.params.entry;
        if (!/favicon/i.test(e.url || "") && !/favicon/i.test(e.text || ""))
          this.errors.push("log: " + e.text.slice(0, 400));
      }
    });
  }
  send(method, params) { return this.cdp.send(method, params, this.sessionId); }

  async eval(expression) {
    const r = await this.send("Runtime.evaluate", {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error("eval failed: " + expression.slice(0, 120) + " -> " +
        JSON.stringify(r.exceptionDetails).slice(0, 300));
    }
    return r.result.value;
  }

  /* poll a page-side expression until truthy; returns its value */
  async waitFor(expression, desc, timeoutMs = 6000) {
    const t0 = Date.now();
    for (;;) {
      const v = await this.eval(expression);
      if (v) return v;
      if (Date.now() - t0 > timeoutMs) throw new Error("timeout waiting for: " + desc);
      await sleep(60);
    }
  }

  async key(code, key, vk) {
    await this.send("Input.dispatchKeyEvent", {
      type: "keyDown", code, key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
    });
    await this.send("Input.dispatchKeyEvent", {
      type: "keyUp", code, key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
    });
  }

  async clickSelector(sel) {
    const r = await this.eval(
      `(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();
         return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`
    );
    await this.send("Input.dispatchMouseEvent", {
      type: "mousePressed", x: r.x, y: r.y, button: "left", clickCount: 1,
    });
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseReleased", x: r.x, y: r.y, button: "left", clickCount: 1,
    });
  }
}

async function openPage(cdp, label) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const page = new Page(cdp, sessionId, label);
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Log.enable");
  /* arm the guarded debug handle before any game script runs */
  await page.send("Page.addScriptToEvaluateOnNewDocument", {
    source: "window.__LAMPLIGHTER_TEST__ = true;",
  });
  return page;
}

/* ---------------- the feature scenario ---------------- */

const SNAP = "window.__lamplighter.snapshot()";
const KEYS = {
  up: ["ArrowUp", "ArrowUp", 38], down: ["ArrowDown", "ArrowDown", 40],
  left: ["ArrowLeft", "ArrowLeft", 37], right: ["ArrowRight", "ArrowRight", 39],
  w: ["KeyW", "w", 87], a: ["KeyA", "a", 65], s: ["KeyS", "s", 83], d: ["KeyD", "d", 68],
  p: ["KeyP", "p", 80], m: ["KeyM", "m", 77], space: ["Space", " ", 32],
};

async function parkGloams(page) {
  await page.eval(`(() => { const d = window.__lamplighter;
    const slots = [9.5, 10.5, 11.5, 10.5];
    for (let i = 0; i < 4; i++)
      d.setGloam(i, { state: "den", x: slots[i], y: 11.5, dir: null, fleeing: false, release: 99999 });
  })()`);
}

async function runScenario(page, url, label) {
  const L = (s) => console.log("  [" + label + "] " + s);

  await page.send("Page.navigate", { url });
  await page.waitFor("document.readyState === 'complete'", "page load");
  await page.waitFor("typeof window.__lamplighter === 'object'", "debug handle armed");

  /* --- title screen --- */
  let snap = await page.eval(SNAP);
  eq(snap.state, "title", "boots to the title screen");
  ok(await page.eval("document.getElementById('overlay').classList.contains('show')"),
    "title overlay is visible");
  eq(await page.eval("document.getElementById('overlay-title').textContent"),
    "LAMPLIGHTER", "title text");
  ok(await page.eval("document.getElementById('overlay-sub').textContent.includes('light every lantern')"),
    "title explains the goal");
  L("title screen ok");

  /* --- M mute toggle (works on the title screen without starting a game) --- */
  eq(await page.eval("document.getElementById('audio-toggle').textContent"),
    "sound: on", "audio starts on");
  await page.key(...KEYS.m);
  await page.waitFor("document.getElementById('audio-toggle').textContent === 'sound: off'",
    "M mutes");
  eq(await page.eval("localStorage.getItem('arcade.lamplighter.audio')"), "off",
    "mute state persisted to localStorage");
  eq((await page.eval(SNAP)).state, "title", "M does not start the game");
  /* the sound button itself toggles too (real mouse click) */
  await page.clickSelector("#audio-toggle");
  await page.waitFor("document.getElementById('audio-toggle').textContent === 'sound: on'",
    "clicking the sound button unmutes");
  eq(await page.eval("localStorage.getItem('arcade.lamplighter.audio')"), "on",
    "unmute persisted");
  L("sound toggle ok (key + button, persisted)");

  /* --- any key starts the game --- */
  await page.key(...KEYS.space);
  snap = await page.eval(SNAP);
  eq(snap.state, "ready", "any key starts night 1 (READY phase)");
  eq(snap.level, 1, "night 1");
  eq(snap.lives, 3, "3 lives");
  ok(snap.totalLamps >= 32, "lamps to light: lanterns(>=28) + 4 braziers");
  ok(!(await page.eval("document.getElementById('overlay').classList.contains('show')")),
    "overlay hides during play");
  eq(await page.eval("document.getElementById('level').textContent"), "1", "HUD night = 1");
  eq(await page.eval("document.getElementById('lamps').textContent"),
    "0/" + snap.totalLamps, "HUD lamp counter");
  eq(await page.eval("document.querySelectorAll('#lives .life').length"), 3, "HUD 3 life dots");

  /* --- pre-buffered turning: a key pressed during READY is held in the buffer --- */
  const maze0 = await page.eval("window.__lamplighter.mazeInfo()");
  const dirName = (d) =>
    d.dx === 1 ? "right" : d.dx === -1 ? "left" : d.dy === 1 ? "down" : "up";
  const dirsAll = [{ dx: 0, dy: -1 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 1, dy: 0 }];
  const openDir = dirsAll.find((d) => maze0.grid[17 + d.dy][10 + d.dx] === 1);
  const wallDir = dirsAll.find((d) => maze0.grid[17 + d.dy][10 + d.dx] !== 1);
  ok(openDir, "spawn has an open direction");
  ok(wallDir, "spawn has a walled direction");
  await page.key(...KEYS[dirName(wallDir)]);
  snap = await page.eval(SNAP);
  ok(snap.player.buf && snap.player.buf.dx === wallDir.dx && snap.player.buf.dy === wallDir.dy,
    "turn toward a wall is pre-buffered, not dropped");
  L("turn pre-buffering ok");

  /* --- movement (arrow keys) --- */
  await page.waitFor(`${SNAP}.state === 'playing'`, "READY -> playing", 4000);
  await parkGloams(page); /* keep the hunt deterministic while we probe features */
  await page.key(...KEYS[dirName(openDir)]);
  await page.waitFor(
    `(() => { const p = ${SNAP}.player;
       return Math.abs(p.x - ${maze0.spawn.x + 0.5}) + Math.abs(p.y - ${maze0.spawn.y + 0.5}) > 0.4; })()`,
    "arrow key walks the player");
  L("arrow-key movement ok");

  /* --- movement (WASD): reverse back toward spawn --- */
  const wasdKey = { up: "w", left: "a", down: "s", right: "d" }[
    dirName({ dx: -openDir.dx, dy: -openDir.dy })];
  const before = (await page.eval(SNAP)).player;
  await page.key(...KEYS[wasdKey]);
  await page.waitFor(
    `(() => { const p = ${SNAP}.player;
       return (p.x - ${before.x}) * ${-openDir.dx} + (p.y - ${before.y}) * ${-openDir.dy} > 0.3; })()`,
    "WASD reverses the player");
  L("WASD movement + free reversal ok");

  /* --- P pauses and freezes the simulation --- */
  await page.key(...KEYS.p);
  snap = await page.eval(SNAP);
  eq(snap.paused, true, "P pauses");
  eq(await page.eval("document.getElementById('overlay-title').textContent"),
    "PAUSED", "pause overlay shows");
  const frozen = snap.player;
  await sleep(350);
  const still = (await page.eval(SNAP)).player;
  eq(still.x, frozen.x, "player x frozen while paused");
  eq(still.y, frozen.y, "player y frozen while paused");
  await page.key(...KEYS.p);
  eq((await page.eval(SNAP)).paused, false, "P resumes");
  ok(!(await page.eval("document.getElementById('overlay').classList.contains('show')")),
    "pause overlay hides on resume");

  /* --- window blur pauses too --- */
  await page.eval("window.dispatchEvent(new Event('blur'))");
  eq((await page.eval(SNAP)).paused, true, "window blur pauses");
  await page.key(...KEYS.p);
  eq((await page.eval(SNAP)).paused, false, "resume after blur-pause");
  L("pause (P + blur) ok");

  /* --- lighting a lantern: +10, counter, HUD --- */
  await parkGloams(page);
  let m = await page.eval("window.__lamplighter.mazeInfo()");
  const lantern = m.lanterns.find((l) => !l.lit);
  let s0 = await page.eval(SNAP);
  await page.eval(`window.__lamplighter.setPlayer(${lantern.x + 0.5}, ${lantern.y + 0.5})`);
  await page.waitFor(
    `window.__lamplighter.mazeInfo().lanterns.find(l => l.x === ${lantern.x} && l.y === ${lantern.y}).lit`,
    "walking over a lantern lights it");
  snap = await page.eval(SNAP);
  eq(snap.score, s0.score + 10, "lantern scores 10");
  eq(snap.litCount, s0.litCount + 1, "lamp counter advances");
  eq(await page.eval("document.getElementById('score').textContent"),
    String(snap.score), "HUD score updates");
  eq(await page.eval("document.getElementById('lamps').textContent"),
    snap.litCount + "/" + snap.totalLamps, "HUD lamps update");
  L("lantern lighting ok");

  /* --- lit streets carry you faster; gloams are faster in the dark --- */
  const spOnLit = await page.eval("window.__lamplighter.playerSpeed()"); /* still on the lit lantern tile */
  ok(await page.eval(`window.__lamplighter.glowAt(${lantern.x}, ${lantern.y}) > 0`),
    "the lit lantern's tile glows");
  /* genuinely dark, lamp-free, non-tunnel corridor tiles (teleporting there
     cannot light anything or start a tunnel-speed effect) */
  const darkTiles = await page.eval(`(() => {
    const d = window.__lamplighter, m = d.mazeInfo();
    const lampAt = new Set(m.lanterns.concat(m.braziers).map((o) => o.x + "," + o.y));
    const out = [];
    for (let y = 1; y < 22; y++) for (let x = 1; x < 20; x++) {
      if (y === 11) continue;
      if (m.grid[y][x] !== 1) continue;
      if (lampAt.has(x + "," + y)) continue;
      if (d.glowAt(x, y) !== 0) continue;
      out.push({ x, y });
    }
    return out;
  })()`);
  const dA = darkTiles[0];
  const dB = darkTiles.find((t) => Math.abs(t.x - dA.x) + Math.abs(t.y - dA.y) >= 3);
  ok(dA && dB, "found two distant dark corridor tiles");
  await page.eval(`window.__lamplighter.setPlayer(${dA.x + 0.5}, ${dA.y + 0.5})`);
  const spOnDark = await page.eval("window.__lamplighter.playerSpeed()");
  ok(spOnLit > spOnDark, "player is faster on lit tiles (" + spOnLit + " > " + spOnDark + ")");
  /* gloam 0 measured on the lit lantern tile vs a dark tile away from the player */
  await page.eval(`window.__lamplighter.setGloam(0, { state: "normal", x: ${lantern.x + 0.5}, y: ${lantern.y + 0.5}, dir: null, fleeing: false })`);
  const gLit = await page.eval("window.__lamplighter.gloamSpeed(0)");
  await page.eval(`window.__lamplighter.setGloam(0, { x: ${dB.x + 0.5}, y: ${dB.y + 0.5} })`);
  const gDark = await page.eval("window.__lamplighter.gloamSpeed(0)");
  ok(gDark > gLit, "gloams are faster in the dark (" + gDark + " > " + gLit + ")");

  /* --- gloams crawl at half speed inside the wrapping tunnels --- */
  const tunnelX = (await page.eval("window.__lamplighter.glowAt(0, 11)")) === 0 ? 0 : 20;
  ok(await page.eval(`window.__lamplighter.glowAt(${tunnelX}, 11) === 0`),
    "found a dark tunnel mouth");
  await page.eval(`window.__lamplighter.setGloam(0, { x: ${tunnelX + 0.5}, y: 11.5 })`);
  const gTunnel = await page.eval("window.__lamplighter.gloamSpeed(0)");
  ok(Math.abs(gTunnel / gDark - 0.5) < 1e-9,
    "tunnel halves gloam speed (" + gTunnel + " vs " + gDark + ")");
  await parkGloams(page); /* gloam 0 must not hunt the player between sections */
  L("speed rules (lit/dark/tunnel) ok");

  /* --- the four gloam targeting personalities --- */
  await page.eval("window.__lamplighter.setMode('pursue')");
  snap = await page.eval(SNAP);
  const ptx = Math.floor(snap.player.x), pty = Math.floor(snap.player.y);
  const t0 = await page.eval("window.__lamplighter.target(0)");
  eq(t0.x, ptx, "Ashen targets the player tile (x)");
  eq(t0.y, pty, "Ashen targets the player tile (y)");
  const t1 = await page.eval("window.__lamplighter.target(1)");
  eq(t1.x, ptx + snap.player.face.dx * 4, "Vesper intercepts 4 ahead (x)");
  eq(t1.y, pty + snap.player.face.dy * 4, "Vesper intercepts 4 ahead (y)");
  const g0 = (await page.eval(SNAP)).gloams[0];
  const t2 = await page.eval("window.__lamplighter.target(2)");
  eq(t2.x, 2 * ptx - Math.floor(g0.x), "Murk mirrors Ashen across the player (x)");
  eq(t2.y, 2 * pty - Math.floor(g0.y), "Murk mirrors Ashen across the player (y)");
  const t3 = await page.eval("window.__lamplighter.target(3)");
  m = await page.eval("window.__lamplighter.mazeInfo()");
  ok(m.lanterns.some((l) => !l.lit && l.x === t3.x && l.y === t3.y) ||
     (t3.x === 19 && t3.y === 21),
    "Smolder drifts toward an unlit lantern cluster");
  await page.eval("window.__lamplighter.setMode('scatter')");
  const sc = await page.eval("window.__lamplighter.target(0)");
  ok(sc.x === 19 && sc.y === 1, "in scatter mode Ashen heads for its corner");
  L("gloam personalities ok");

  /* --- pursue/scatter alternation is driven by a running clock --- */
  const mc1 = (await page.eval(SNAP)).modeClock;
  await sleep(400);
  const mc2 = (await page.eval(SNAP)).modeClock;
  ok(mc2 !== mc1, "mode clock advances during play");

  /* --- brazier: +50, gloams flee --- */
  await parkGloams(page);
  m = await page.eval("window.__lamplighter.mazeInfo()");
  const brazier = m.braziers.find((b) => !b.lit);
  s0 = await page.eval(SNAP);
  await page.eval(`window.__lamplighter.setPlayer(${brazier.x + 0.5}, ${brazier.y + 0.5})`);
  await page.waitFor(
    `window.__lamplighter.mazeInfo().braziers.find(b => b.x === ${brazier.x} && b.y === ${brazier.y}).lit`,
    "walking over a brazier lights it");
  snap = await page.eval(SNAP);
  eq(snap.score, s0.score + 50, "brazier scores 50");
  ok(snap.fleeTimer > 0, "brazier starts the flee window");
  ok(snap.gloams.every((g) => g.fleeing), "all gloams turn pale and flee");
  L("brazier + flee ok");

  /* --- banishing fleeing gloams: 200 then 400 (combo) --- */
  snap = await page.eval(SNAP);
  const px = snap.player.x, py = snap.player.y;
  s0 = snap;
  await page.eval(`window.__lamplighter.setGloam(0, { state: "normal", fleeing: true, x: ${px}, y: ${py}, dir: { dx: 1, dy: 0 } })`);
  await page.waitFor(`${SNAP}.score >= ${s0.score + 200}`, "first banish scores 200");
  snap = await page.eval(SNAP);
  eq(snap.score, s0.score + 200, "banish #1 = 200 exactly");
  eq(snap.gloams[0].state, "returning", "banished gloam streaks home to the den");
  eq(snap.lives, 3, "touching a FLEEING gloam costs no life");
  await page.eval(`window.__lamplighter.setGloam(1, { state: "normal", fleeing: true, x: ${px}, y: ${py}, dir: { dx: 1, dy: 0 } })`);
  await page.waitFor(`${SNAP}.score >= ${s0.score + 600}`, "second banish scores 400 (combo)");
  eq((await page.eval(SNAP)).score, s0.score + 600, "banish #2 = 400 exactly");
  L("banish combo ok");

  /* --- banished gloam returns to the den and re-emerges --- */
  await page.waitFor(`['descend','den','leaving','normal'].includes(${SNAP}.gloams[0].state)`,
    "banished gloam reaches the den door", 12000);
  L("banished gloam homing ok");

  /* --- death: a non-fleeing gloam costs a life, then respawn --- */
  await parkGloams(page);
  await page.eval("window.__lamplighter.clearFlee()");
  snap = await page.eval(SNAP);
  await page.eval(`window.__lamplighter.setGloam(0, { state: "normal", fleeing: false, x: ${snap.player.x}, y: ${snap.player.y}, dir: { dx: 1, dy: 0 } })`);
  await page.waitFor(`${SNAP}.state === 'dying'`, "touching a gloam kills");
  await page.waitFor(`${SNAP}.lives === 2`, "death costs a life", 4000);
  await page.waitFor(`${SNAP}.state === 'playing'`, "respawn back to play", 4000);
  snap = await page.eval(SNAP);
  eq(snap.player.x, m.spawn.x + 0.5, "player respawns at spawn (x)");
  eq(snap.player.y, m.spawn.y + 0.5, "player respawns at spawn (y)");
  eq(await page.eval("document.querySelectorAll('#lives .life').length"), 2,
    "HUD shows 2 life dots after a death");
  L("death + respawn ok");

  /* --- game over on the last life; high score persists; any key restarts --- */
  await parkGloams(page);
  await page.eval("window.__lamplighter.setLives(1)");
  snap = await page.eval(SNAP);
  const finalScore = snap.score;
  await page.eval(`window.__lamplighter.setGloam(0, { state: "normal", fleeing: false, x: ${snap.player.x}, y: ${snap.player.y}, dir: { dx: 1, dy: 0 } })`);
  await page.waitFor(`${SNAP}.state === 'gameover'`, "last life ends the night", 5000);
  eq(await page.eval("document.getElementById('overlay-title').textContent"),
    "THE STREET WENT DARK", "game-over overlay");
  ok(await page.eval("document.getElementById('overlay-info').textContent.includes('any key')"),
    "game-over invites a restart");
  const storedHigh = await page.eval("parseInt(localStorage.getItem('arcade.lamplighter.high'), 10)");
  ok(storedHigh >= finalScore, "high score persisted (" + storedHigh + " >= " + finalScore + ")");
  eq((await page.eval(SNAP)).high, storedHigh, "in-game best matches storage");
  await page.key(...KEYS.space);
  snap = await page.eval(SNAP);
  eq(snap.state, "ready", "any key restarts instantly");
  eq(snap.score, 0, "restart resets the score");
  eq(snap.lives, 3, "restart resets lives");
  eq(snap.level, 1, "restart resets to night 1");
  eq(await page.eval("document.getElementById('best').textContent"),
    String(storedHigh), "HUD best shows the stored high score");
  L("game over + restart + high score ok");

  /* --- clearing the night: bonus, THE QUARTER IS LIT, next night is a new maze --- */
  await page.waitFor(`${SNAP}.state === 'playing'`, "night 1 (restarted) begins", 4000);
  await parkGloams(page);
  const gridBefore = JSON.stringify((await page.eval("window.__lamplighter.mazeInfo()")).grid);
  const last = await page.eval("window.__lamplighter.lightAllButOne()");
  s0 = await page.eval(SNAP);
  eq(s0.litCount, s0.totalLamps - 1, "test handle left exactly one lamp unlit");
  await page.eval(`window.__lamplighter.setPlayer(${last.x + 0.5}, ${last.y + 0.5})`);
  await page.waitFor(`${SNAP}.state === 'levelclear'`, "lighting the last lamp clears the night");
  snap = await page.eval(SNAP);
  ok(snap.score >= s0.score + 600, "night-clear bonus awarded (500 + 100*night)");
  await page.waitFor(`${SNAP}.level === 2`, "night 2 begins", 6000);
  await page.waitFor(`${SNAP}.state === 'playing'`, "night 2 playing", 4000);
  snap = await page.eval(SNAP);
  eq(snap.litCount, 0, "new night starts unlit");
  const gridAfter = JSON.stringify((await page.eval("window.__lamplighter.mazeInfo()")).grid);
  ok(gridAfter !== gridBefore, "every night is a brand-new procedurally generated maze");
  eq(await page.eval("document.getElementById('level').textContent"), "2", "HUD night = 2");
  L("night clear -> night 2 ok");

  /* --- the side tunnels wrap around --- */
  await parkGloams(page);
  await page.eval("window.__lamplighter.setPlayer(1.5, 11.5)");
  await page.key(...KEYS.left);
  await page.waitFor(`${SNAP}.player.x > 14`, "walking off the left edge wraps to the right", 5000);
  L("tunnel wrap-around ok");

  /* --- zero non-favicon console errors over the whole scenario --- */
  eq(page.errors.length, 0,
    "no console errors/exceptions; got: " + page.errors.join(" | "));
  L("zero console errors");
}

/* ---------------- main ---------------- */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lamplighter-test-"));
let chrome = null, server = null;
let exitCode = 1;
try {
  server = await startServer();
  const httpUrl = "http://127.0.0.1:" + server.address().port + "/games/lamplighter/index.html";
  const fileUrl = "file://" + path.join(GAME_DIR, "index.html");

  chrome = await launchChrome(path.join(tmp, "profile"));
  const cdp = new CDP(await connectWS(chrome.wsUrl));

  console.log("scenario over http:// (" + httpUrl + ")");
  await runScenario(await openPage(cdp, "http"), httpUrl, "http");

  console.log("scenario over file:// (" + fileUrl + ")");
  await runScenario(await openPage(cdp, "file"), fileUrl, "file");

  console.log("\nall browser checks passed (" + checks + " asserts, http + file)");
  exitCode = 0;
} catch (err) {
  console.error("\nBROWSER TEST FAILED: " + err.message);
} finally {
  if (chrome) chrome.proc.kill("SIGKILL");
  if (server) server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(exitCode);
