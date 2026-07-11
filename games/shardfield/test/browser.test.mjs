// Shardfield browser test — headless Chrome over raw CDP, no npm deps.
// Loads the game over a local http server AND via file://, asserts zero
// non-favicon console errors/exceptions on both, and exercises every
// user-facing feature in the game README with real input events.
// Run: node games/shardfield/test/browser.test.mjs
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHROME = "/usr/bin/google-chrome";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAME_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(GAME_DIR, "..", "..");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function ok(cond, label) {
  if (cond) {
    console.log(`  ok - ${label}`);
  } else {
    failures++;
    console.error(`  FAIL - ${label}`);
  }
}

// ---------------------------------------------------------------- static server

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json",
};

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = path.normalize(path.join(REPO_ROOT, urlPath));
    if (!file.startsWith(REPO_ROOT)) { res.writeHead(403); res.end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end("not found"); return; }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

// ---------------------------------------------------------------- chrome + CDP

function launchChrome(userDataDir) {
  const proc = spawn(CHROME, [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--mute-audio",
    "--autoplay-policy=no-user-gesture-required",
    "--window-size=1280,960",
    "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });

  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("chrome did not report DevTools endpoint\n" + buf)), 20000);
    proc.stderr.on("data", (d) => {
      buf += d.toString();
      const m = buf.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (m) { clearTimeout(timer); resolve({ proc, port: Number(m[1]) }); }
    });
    proc.on("exit", (code) => reject(new Error(`chrome exited early (${code})\n` + buf)));
  });
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        (this.listeners.get(msg.method) || []).forEach((fn) => fn(msg.params));
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }
}

async function openTab(port, url) {
  const res = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  const info = await res.json();
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", () => reject(new Error("ws connect failed")));
  });
  return { cdp: new CDP(ws), targetId: info.id, ws };
}

// ---------------------------------------------------------------- page helpers

async function evaluate(cdp, expression) {
  const res = await cdp.send("Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise: true,
  });
  if (res.exceptionDetails) {
    throw new Error("evaluate failed: " + (res.exceptionDetails.exception?.description || res.exceptionDetails.text));
  }
  return res.result.value;
}

// poll an in-page expression until truthy (or timeout); returns the last value
async function until(cdp, expression, timeout = 4000, step = 60) {
  const t0 = Date.now();
  let v;
  while (Date.now() - t0 < timeout) {
    v = await evaluate(cdp, expression);
    if (v) return v;
    await sleep(step);
  }
  return v;
}

async function navigate(cdp, url) {
  const loaded = new Promise((resolve) => cdp.on("Page.loadEventFired", () => resolve()));
  await cdp.send("Page.navigate", { url });
  await loaded;
  for (let i = 0; i < 50; i++) {
    if (await evaluate(cdp, "typeof window.__shardfield !== 'undefined'")) return;
    await sleep(100);
  }
  throw new Error("game did not boot (window.__shardfield missing) at " + url);
}

const VK = {
  Enter: 13, Space: 32, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39,
  KeyA: 65, KeyD: 68, KeyM: 77, KeyP: 80, KeyR: 82, KeyW: 87,
};
const KEYTXT = {
  Enter: "Enter", Space: " ", ArrowLeft: "ArrowLeft", ArrowUp: "ArrowUp",
  ArrowRight: "ArrowRight", KeyA: "a", KeyD: "d", KeyM: "m", KeyP: "p",
  KeyR: "r", KeyW: "w",
};

async function keyDown(cdp, code, autoRepeat = false) {
  await cdp.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown", code, key: KEYTXT[code],
    windowsVirtualKeyCode: VK[code], nativeVirtualKeyCode: VK[code], autoRepeat,
  });
}
async function keyUp(cdp, code) {
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp", code, key: KEYTXT[code],
    windowsVirtualKeyCode: VK[code], nativeVirtualKeyCode: VK[code],
  });
}
async function press(cdp, code) {
  await keyDown(cdp, code);
  await sleep(35);
  await keyUp(cdp, code);
}
async function hold(cdp, code, ms) {
  await keyDown(cdp, code);
  await sleep(ms);
  await keyUp(cdp, code);
}

// shorthand for expressions over the debug handle
const H = (body) => `(() => { const h = window.__shardfield, L = h.L; ${body} })()`;

// park the saucer clock far away and freeze all shards along the top edge,
// well away from the ship at center — makes the following asserts deterministic
const FREEZE = H(`
  h.setSaucerTimer(99999);
  h.shards.forEach((s, i) => {
    s.x = s.px = 60 + (i % 8) * 115;
    s.y = s.py = 40 + Math.floor(i / 8) * 70;
    s.vx = 0; s.vy = 0; s.spin = 0;
  });
  return h.shards.length;
`);

const RECENTER = H(`
  const s = h.ship;
  s.x = s.px = L.W / 2; s.y = s.py = L.H / 2;
  s.vx = 0; s.vy = 0;
  return true;
`);

// ---------------------------------------------------------------- feature suite

async function runSuite(cdp, url, label, startKey) {
  const errors = [];
  const isFavicon = (s) => /favicon/i.test(String(s));

  cdp.on("Runtime.consoleAPICalled", (p) => {
    if (p.type === "error") {
      const text = p.args.map((a) => a.value ?? a.description ?? "").join(" ");
      if (!isFavicon(text)) errors.push(`console.error: ${text}`);
    }
  });
  cdp.on("Runtime.exceptionThrown", (p) => {
    const d = p.exceptionDetails;
    errors.push(`exception: ${d.exception?.description || d.text || "unknown"}`);
  });
  cdp.on("Log.entryAdded", (p) => {
    if (p.entry.level === "error" && !isFavicon(p.entry.text) && !isFavicon(p.entry.url || "")) {
      errors.push(`log: ${p.entry.text}`);
    }
  });

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");

  console.log(`\n=== ${label}: ${url}`);
  await navigate(cdp, url);

  // --- attract mode ---
  ok(await evaluate(cdp, `document.getElementById("overlay").classList.contains("show")
      && document.getElementById("overlay-title").textContent === "SHARDFIELD"
      && document.getElementById("overlay-msg").textContent.includes("ENTER")`),
    "attract overlay shows SHARDFIELD / press ENTER to launch");
  ok(await evaluate(cdp, H(`return h.state === "attract" && h.shards.length === 6;`)),
    "attract mode seeds a drifting six-shard field");
  ok(await evaluate(cdp, `document.getElementById("wave").textContent === "—"
      && document.getElementById("lives").textContent === "—"`),
    "HUD wave and ships read — before launch");
  const drift = await evaluate(cdp, H(`
    const s = h.shards[0]; const x0 = s.x, y0 = s.y;
    return new Promise((res) => setTimeout(() =>
      res(h.shards[0].x !== x0 || h.shards[0].y !== y0), 250));
  `));
  ok(drift, "shards drift in attract mode (simulation runs)");
  const lit = await evaluate(cdp, `(() => {
    const c = document.getElementById("game");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 64) if (d[i] > 25 || d[i + 1] > 25 || d[i + 2] > 25) lit++;
    return lit;
  })()`);
  ok(lit > 40, `canvas renders vector graphics over the star backdrop (${lit} lit samples)`);

  // --- start (Enter over http, Space over file:// — both start keys covered) ---
  await press(cdp, startKey);
  ok(await until(cdp, H(`return h.state === "play";`)), `${startKey} launches a game`);
  ok(await evaluate(cdp, H(`
    return h.wave === 1 && h.lives === 3 && h.score === 0
      && h.shards.length === 4 && h.shards.every((s) => s.size === 3)
      && !!h.ship;
  `)), "wave 1 starts with 4 large shards, 3 ships, score 0");
  ok(await evaluate(cdp, `!document.getElementById("overlay").classList.contains("show")`),
    "launch hides the overlay");
  ok(await evaluate(cdp, `document.getElementById("wave").textContent === "1"
      && document.getElementById("lives").textContent === "▲▲▲"`),
    "HUD shows wave 1 and three ship pips");
  await evaluate(cdp, FREEZE);   // deterministic field for the asserts below

  // --- rotation ---
  const a0 = await evaluate(cdp, H(`return h.ship.a;`));
  await hold(cdp, "ArrowRight", 220);
  const a1 = await evaluate(cdp, H(`return h.ship.a;`));
  ok(a1 > a0 + 0.4, `ArrowRight rotates clockwise (${a0.toFixed(2)} -> ${a1.toFixed(2)})`);
  await hold(cdp, "KeyA", 220);
  const a2 = await evaluate(cdp, H(`return h.ship.a;`));
  ok(a2 < a1 - 0.4, "A rotates counter-clockwise");

  // rotation never redirects existing velocity (README: frictionless inertia)
  await evaluate(cdp, H(`h.ship.vx = 77; h.ship.vy = -33; return true;`));
  await hold(cdp, "ArrowLeft", 200);
  ok(await evaluate(cdp, H(`return h.ship.vx === 77 && h.ship.vy === -33;`)),
    "rotating while coasting leaves the velocity vector untouched");
  await evaluate(cdp, RECENTER);

  // --- thrust, inertia, speed cap ---
  await evaluate(cdp, H(`h.ship.a = h.ship.pa = -Math.PI / 2; return true;`));
  await keyDown(cdp, "ArrowUp");
  await sleep(160);
  ok(await evaluate(cdp, H(`return h.ship.thrusting === true && h.ship.flame > 0;`)),
    "ArrowUp thrusts (thrusting flag + flame timer while held)");
  await sleep(160);
  await keyUp(cdp, "ArrowUp");
  const v1 = await evaluate(cdp, H(`return { vx: h.ship.vx, vy: h.ship.vy };`));
  ok(v1.vy < -60 && Math.abs(v1.vx) < 10,
    `thrust accelerates along the nose (vy ${v1.vy.toFixed(1)} px/s facing up)`);
  const p1 = await evaluate(cdp, H(`return { x: h.ship.x, y: h.ship.y };`));
  await sleep(400);
  const after = await evaluate(cdp, H(`return { vx: h.ship.vx, vy: h.ship.vy, x: h.ship.x, y: h.ship.y };`));
  ok(after.vx === v1.vx && after.vy === v1.vy,
    "zero damping while coasting: velocity persists exactly");
  ok(after.y !== p1.y, "the ship keeps gliding with no keys held");

  await evaluate(cdp, H(`h.ship.a = h.ship.pa = 0; h.ship.vx = 455; h.ship.vy = 0; return true;`));
  await hold(cdp, "ArrowUp", 400);
  const spd = await evaluate(cdp, H(`return Math.hypot(h.ship.vx, h.ship.vy);`));
  ok(spd <= 460.001, `speed is capped at 460 px/s (got ${spd.toFixed(1)})`);
  await evaluate(cdp, RECENTER);

  // W thrust variant
  await hold(cdp, "KeyW", 150);
  ok(await evaluate(cdp, H(`return Math.hypot(h.ship.vx, h.ship.vy) > 20;`)),
    "W also thrusts");
  await evaluate(cdp, RECENTER);

  // --- toroidal wrap of the ship ---
  await evaluate(cdp, H(`h.ship.x = h.ship.px = 2; h.ship.vx = -120; return true;`));
  await sleep(150);
  ok(await evaluate(cdp, H(`return h.ship.x > L.W - 40;`)),
    "ship wraps across the left edge onto the right (toroidal arena)");
  await evaluate(cdp, RECENTER);

  // --- firing ---
  await evaluate(cdp, H(`h.ship.a = h.ship.pa = 0; h.ship.vx = 60; h.ship.vy = 0; return true;`));
  await press(cdp, "Space");
  const shot = await until(cdp, H(`return h.bullets.length === 1 ? { vx: h.bullets[0].vx, vy: h.bullets[0].vy } : null;`));
  ok(!!shot, "Space fires exactly one bullet");
  ok(shot && Math.abs(shot.vx - (60 + 560)) < 1 && Math.abs(shot.vy) < 1,
    `bullet inherits ship velocity + muzzle speed (vx ${shot && shot.vx.toFixed(1)})`);

  // held key auto-repeat must not fire again (one shot per press)
  await keyDown(cdp, "Space");
  await keyDown(cdp, "Space", true);
  await keyDown(cdp, "Space", true);
  await keyUp(cdp, "Space");
  await sleep(120);
  ok(await evaluate(cdp, H(`return h.bullets.length === 2;`)),
    "holding Space does not autofire (one shot per press)");

  for (let i = 0; i < 5; i++) { await press(cdp, "Space"); await sleep(45); }
  ok(await evaluate(cdp, H(`return h.bullets.length === 4;`)),
    "at most 4 bullets alive");

  await sleep(1750);   // BULLET_LIFE is ~1.58s
  ok(await evaluate(cdp, H(`return h.bullets.length === 0;`)),
    "bullets expire just under one screen-crossing");
  await evaluate(cdp, H(`h.ship.vx = 0; return true;`));

  // --- shard splitting + scoring: 20 / 50 / 100, large -> 2 medium -> 2 small ---
  let r = await evaluate(cdp, H(`
    const before = { n: h.shards.length, score: h.score };
    const s = h.shards.find((s) => s.size === 3);
    h.splitShard(s, true);
    return { before, score: h.score };
  `));
  ok(r.score === r.before.score + 20, "a large shard scores 20");
  ok(await until(cdp, H(`return h.shards.length === ${r.before.n + 1} && h.shards.filter((s) => s.size === 2).length >= 2;`)),
    "a large shard splits into 2 mediums");
  await evaluate(cdp, FREEZE);

  r = await evaluate(cdp, H(`
    const before = { n: h.shards.length, score: h.score };
    h.splitShard(h.shards.find((s) => s.size === 2), true);
    return { before, score: h.score };
  `));
  ok(r.score === r.before.score + 50, "a medium shard scores 50");
  ok(await until(cdp, H(`return h.shards.length === ${r.before.n + 1} && h.shards.filter((s) => s.size === 1).length >= 2;`)),
    "a medium shard splits into 2 smalls");
  await evaluate(cdp, FREEZE);

  r = await evaluate(cdp, H(`
    const before = { n: h.shards.length, score: h.score };
    h.splitShard(h.shards.find((s) => s.size === 1), true);
    return { before, score: h.score };
  `));
  ok(r.score === r.before.score + 100, "a small shard scores 100");
  ok(await until(cdp, H(`return h.shards.length === ${r.before.n - 1};`)),
    "a small shard just vanishes (no children)");
  ok(await evaluate(cdp, H(`return document.getElementById("score").textContent === String(h.score);`)),
    "HUD score tracks the live score");

  // --- saucer shots shatter shards too, without scoring (README) ---
  r = await evaluate(cdp, H(`
    const before = { n: h.shards.length, score: h.score };
    const s = h.shards.find((x) => x.size === 3) || h.shards[0];
    h.ebullets.push({ x: s.x, y: s.y, px: s.x, py: s.y, vx: 0, vy: 0, t: 1 });
    return before;
  `));
  ok(await until(cdp, H(`return h.shards.length === ${r.n + 1} && h.ebullets.length === 0;`)),
    "a saucer shot shatters a shard");
  ok(await evaluate(cdp, H(`return h.score === ${r.score};`)),
    "saucer-shot splits award no points");
  await evaluate(cdp, FREEZE);

  // --- big saucer: crosses the field, fires at random, worth 200 ---
  await evaluate(cdp, H(`
    const sc = h.spawnSaucer("big");
    sc.y = sc.py = 560; sc.vy = 0; sc.zigTimer = 999;
    return true;
  `));
  ok(await evaluate(cdp, H(`return h.saucer && h.saucer.kind === "big";`)),
    "a big saucer enters the field");
  const sx0 = await evaluate(cdp, H(`return h.saucer.x;`));
  ok(await until(cdp, H(`return h.ebullets.length > 0;`), 3500),
    "the big saucer takes pot-shots");
  ok(await evaluate(cdp, H(`return h.saucer.x !== ${sx0};`)),
    "the saucer crosses the field horizontally");
  r = await evaluate(cdp, H(`
    h.ebullets.length = 0;
    const before = h.score;
    h.killSaucer(true);
    h.setSaucerTimer(99999);
    return { before, score: h.score };
  `));
  ok(r.score === r.before + 200 && await evaluate(cdp, H(`return h.saucer === null;`)),
    "shooting the big saucer scores 200");

  // --- shards shatter saucers (README: rocks don't care whose side you're on) ---
  await evaluate(cdp, H(`
    const sc = h.spawnSaucer("big");
    sc.y = sc.py = 200; sc.vy = 0; sc.zigTimer = 999;
    return true;
  `));
  await sleep(400);   // let it come on-screen
  r = await evaluate(cdp, H(`
    const before = { n: h.shards.length, score: h.score };
    const s = L.makeShard(h.saucer.x, h.saucer.y, 3);
    s.vx = 0; s.vy = 0; s.spin = 0;
    h.pushShard(s);
    return before;
  `));
  ok(await until(cdp, H(`return h.saucer === null;`)),
    "ramming a shard destroys the saucer");
  ok(await evaluate(cdp, H(`return h.score === ${r.score} && h.shards.length === ${r.n + 2};`)),
    "shard-vs-saucer awards no points and still splits the shard");
  await evaluate(cdp, H(`h.setSaucerTimer(99999); return true;`));
  await evaluate(cdp, FREEZE);

  // --- small saucer: aims at the ship within its error cone, worth 1000 ---
  await evaluate(cdp, H(`
    const sc = h.spawnSaucer("small");
    sc.y = sc.py = 560; sc.vy = 0; sc.zigTimer = 999;
    return true;
  `));
  ok(await evaluate(cdp, H(`return h.saucer && h.saucer.kind === "small" && h.saucer.cfg.pts === 1000;`)),
    "a small saucer enters the field");
  const aim = await until(cdp, H(`
    const b = h.ebullets[0];
    if (!b) return null;
    const [dx, dy] = L.torusDelta(b.px, b.py, h.ship.x, h.ship.y);
    let d = Math.atan2(b.vy, b.vx) - Math.atan2(dy, dx);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    h.ebullets.length = 0;
    return { off: Math.abs(d), err: L.smallSaucerAimError(h.score) };
  `), 3500, 40);
  ok(aim && aim.off <= aim.err + 0.05,
    `the small saucer aims at the ship (off by ${aim && aim.off.toFixed(2)} rad, cone ${aim && aim.err.toFixed(2)})`);
  r = await evaluate(cdp, H(`
    h.ebullets.length = 0;
    const before = h.score;
    h.killSaucer(true);
    h.setSaucerTimer(99999);
    return { before, score: h.score };
  `));
  ok(r.score === r.before + 1000, "shooting the small saucer scores 1000");

  // --- extra ship every 10,000 points ---
  r = await evaluate(cdp, H(`
    const before = h.lives;
    h.addScore(10000);
    return { before, lives: h.lives };
  `));
  ok(r.lives === r.before + 1, "crossing 10,000 points awards an extra ship");
  ok(await evaluate(cdp, H(`return document.getElementById("lives").textContent === "▲".repeat(Math.min(h.lives, 8));`)),
    "HUD ship pips track lives");

  // --- a saucer shot kills the ship; wreckage drifts; safe respawn follows ---
  r = await evaluate(cdp, H(`
    const before = h.lives;
    h.ebullets.push({ x: h.ship.x, y: h.ship.y, px: h.ship.x, py: h.ship.y, vx: 0, vy: 0, t: 1 });
    return before;
  `));
  ok(await until(cdp, H(`return h.ship === null;`)),
    "a saucer shot destroys the ship");
  ok(await evaluate(cdp, H(`return h.lives === ${r - 1} && h.debris.length >= 3;`)),
    "the destroyed ship breaks into drifting line segments and costs a life");
  ok(await until(cdp, H(`return h.ship !== null;`), 3500),
    "the ship respawns once the center is clear (shards parked at the edge)");
  ok(await evaluate(cdp, H(`
    const s = h.ship;
    return Math.abs(s.x - L.W / 2) < 1 && Math.abs(s.y - L.H / 2) < 1 && s.vx === 0 && s.vy === 0;
  `)), "respawn puts a fresh ship at the field center");

  // --- ramming a shard splits it, scores, and costs the ship (README) ---
  r = await evaluate(cdp, H(`
    const before = { score: h.score, lives: h.lives };
    const s = L.makeShard(h.ship.x, h.ship.y, 3);
    s.vx = 0; s.vy = 0; s.spin = 0;
    h.pushShard(s);
    return before;
  `));
  ok(await until(cdp, H(`return h.ship === null;`)),
    "flying into a shard destroys the ship");
  ok(await evaluate(cdp, H(`return h.score === ${r.score} + 20 && h.lives === ${r.lives} - 1;`)),
    "ramming still splits the shard and scores 20");

  // --- respawn waits for a clear safe zone around center (README) ---
  await evaluate(cdp, H(`
    h.clearShards();
    const s = L.makeShard(L.W / 2, L.H / 2, 3);
    s.vx = 0; s.vy = 0; s.spin = 0;
    h.pushShard(s);
    return true;
  `));
  await sleep(2100);   // respawn delay is 1.6s — well past it
  ok(await evaluate(cdp, H(`return h.ship === null && h.respawnTimer <= 0 && !h.centerSafe();`)),
    "respawn holds while a shard squats on the safe zone");
  const waveBefore = await evaluate(cdp, H(`h.clearShards(); return h.wave;`));
  ok(await until(cdp, H(`return h.ship !== null;`), 2000),
    "clearing the safe zone releases the respawn");

  // --- clearing the field spawns the next wave with +2 large shards ---
  ok(await until(cdp, H(`return h.wave === ${waveBefore + 1};`), 4500),
    `an empty field rolls over to wave ${waveBefore + 1}`);
  ok(await evaluate(cdp, H(`
    return h.shards.length === L.waveShardCount(h.wave)
      && h.shards.every((s) => s.size === 3);
  `)), `wave ${waveBefore + 1} spawns ${4 + waveBefore * 2} fresh large shards (+2 per wave)`);
  ok(await evaluate(cdp, H(`
    return h.shards.every((s) => L.dist2(s.x, s.y, h.ship.x, h.ship.y) >= 200 * 200);
  `)), "new-wave shards spawn away from the ship");
  ok(await evaluate(cdp, H(`return document.getElementById("wave").textContent === String(h.wave);`)),
    "HUD tracks the wave number");
  await evaluate(cdp, FREEZE);

  // --- pause: P toggles, Enter resumes, blur auto-pauses ---
  await evaluate(cdp, H(`h.ship.a = h.ship.pa = 0; h.ship.vx = 0; h.ship.vy = 0; return true;`));
  await press(cdp, "Space");
  await sleep(80);
  await press(cdp, "KeyP");
  ok(await evaluate(cdp, H(`
    return h.paused === true
      && document.getElementById("overlay-title").textContent === "PAUSED";
  `)), "P pauses with a PAUSED overlay");
  const frozen = await evaluate(cdp, H(`
    const b = h.bullets[0];
    const x0 = b ? b.x : null;
    return new Promise((res) => setTimeout(() =>
      res(b && h.bullets[0] === b && b.x === x0), 300));
  `));
  ok(frozen, "the simulation is frozen while paused (a bullet in flight stops)");
  await press(cdp, "Enter");
  ok(await evaluate(cdp, H(`
    return h.paused === false && !document.getElementById("overlay").classList.contains("show");
  `)), "Enter resumes from pause");
  await press(cdp, "KeyP");
  await press(cdp, "KeyP");
  ok(await evaluate(cdp, H(`return h.paused === false;`)), "P also resumes");
  await evaluate(cdp, `window.dispatchEvent(new Event("blur"))`);
  ok(await evaluate(cdp, H(`
    return h.paused === true && document.getElementById("overlay-title").textContent === "PAUSED";
  `)), "losing window focus auto-pauses");
  await press(cdp, "KeyP");
  ok(await evaluate(cdp, H(`return h.paused === false;`)), "resumed after the blur pause");

  // --- sound toggle: M key + header button, persisted ---
  const sndBefore = await evaluate(cdp, `document.getElementById("audio-toggle").textContent`);
  await press(cdp, "KeyM");
  const snd = await evaluate(cdp, H(`
    return {
      label: document.getElementById("audio-toggle").textContent,
      stored: localStorage.getItem("arcade.shardfield.sound"),
      on: h.AC.on,
    };
  `));
  ok(snd.label !== sndBefore && /sound: (on|off)/.test(snd.label),
    `M toggles the sound label (${sndBefore} -> ${snd.label})`);
  ok(snd.stored === (snd.on ? "on" : "off"),
    "sound preference persists to localStorage");
  await evaluate(cdp, `document.getElementById("audio-toggle").click()`);
  ok(await evaluate(cdp, `document.getElementById("audio-toggle").textContent === ${JSON.stringify(sndBefore)}`),
    "the header button toggles sound back");

  // --- game over -> best persisted -> R restarts ---
  const finalScore = await evaluate(cdp, H(`
    h.setLives(1);
    h.killShip();
    return h.score;
  `));
  ok(await until(cdp, H(`return h.state === "over";`), 4000),
    "losing the last ship ends the game (after the wreck settles)");
  ok(await evaluate(cdp, `document.getElementById("overlay-title").textContent === "FIELD LOST"
      && document.getElementById("overlay-msg").textContent.includes("ENTER")`),
    "game over shows the FIELD LOST overlay");
  ok(await evaluate(cdp, H(`
    return localStorage.getItem("arcade.shardfield.best") === String(${finalScore})
      && h.best === ${finalScore}
      && document.getElementById("best").textContent === String(${finalScore});
  `)), `the run's score (${finalScore}) is persisted as best`);

  await press(cdp, "KeyR");
  ok(await evaluate(cdp, H(`
    return h.state === "play" && h.score === 0 && h.lives === 3 && h.wave === 1;
  `)), "R restarts a fresh game after FIELD LOST");
  await evaluate(cdp, FREEZE);

  // --- best score survives a reload ---
  await navigate(cdp, url);
  ok(await evaluate(cdp, H(`
    return h.state === "attract" && h.best === ${finalScore}
      && document.getElementById("best").textContent === String(${finalScore});
  `)), "best score survives a page reload");

  // --- zero non-favicon console errors / exceptions ---
  await sleep(300);
  ok(errors.length === 0, `zero non-favicon console errors/exceptions (${errors.length} found)`);
  for (const e of errors) console.error("    " + e);
}

// A plain load (no ?test) must boot clean with the debug handle absent —
// the handle is test-only and unreachable in normal play.
async function runGuardCheck(cdp, url) {
  const errors = [];
  cdp.on("Runtime.exceptionThrown", (p) => errors.push(p.exceptionDetails?.text || "exception"));
  cdp.on("Runtime.consoleAPICalled", (p) => { if (p.type === "error") errors.push("console.error"); });
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  const loaded = new Promise((resolve) => cdp.on("Page.loadEventFired", () => resolve()));
  await cdp.send("Page.navigate", { url });
  await loaded;
  await sleep(500);
  console.log(`\n=== guard: ${url}`);
  ok(await evaluate(cdp, `typeof window.__shardfield === "undefined"
      && typeof window.ShardfieldLogic === "object"
      && document.getElementById("overlay-title").textContent === "SHARDFIELD"`),
    "without ?test the game boots to attract mode and exposes no debug handle");
  ok(errors.length === 0, `plain load has zero console errors/exceptions (${errors.length} found)`);
}

// ---------------------------------------------------------------- main

async function main() {
  const server = await startServer();
  const port = server.address().port;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "shardfield-chrome-"));
  const { proc, port: debugPort } = await launchChrome(userDataDir);

  try {
    const httpUrl = `http://127.0.0.1:${port}/games/shardfield/index.html?test`;
    const fileUrl = "file://" + path.join(GAME_DIR, "index.html") + "?test";

    // Enter starts the http run; Space starts the file:// run —
    // both README start keys get exercised for real.
    for (const [label, url, startKey] of [
      ["http", httpUrl, "Enter"],
      ["file", fileUrl, "Space"],
    ]) {
      const { cdp, ws } = await openTab(debugPort, "about:blank");
      await runSuite(cdp, url, label, startKey);
      ws.close();
    }

    // double-click experience: plain file:// open, no query param
    {
      const { cdp, ws } = await openTab(debugPort, "about:blank");
      await runGuardCheck(cdp, "file://" + path.join(GAME_DIR, "index.html"));
      ws.close();
    }
  } finally {
    proc.kill("SIGKILL");
    server.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  if (failures > 0) {
    console.error(`\nshardfield browser tests: ${failures} FAILURE(S)`);
    process.exit(1);
  }
  console.log("\nshardfield browser tests: all passed (http + file://)");
}

main().catch((err) => {
  console.error("browser test crashed:", err);
  process.exit(1);
});
