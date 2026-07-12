// Dowser browser test — headless Chrome over raw CDP, no npm deps.
// Loads the game over a local http server AND via file://, asserts zero
// non-favicon console errors/exceptions on both, and exercises every
// user-facing feature in the game README with real input events.
// Run: node games/dowser/test/browser.test.mjs
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
    "--window-size=1280,900",
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

async function navigate(cdp, url) {
  const loaded = new Promise((resolve) => {
    const fn = () => resolve();
    cdp.on("Page.loadEventFired", fn);
  });
  await cdp.send("Page.navigate", { url });
  await loaded;
  // wait for the game to boot
  for (let i = 0; i < 50; i++) {
    if (await evaluate(cdp, "typeof window.__dowser !== 'undefined'")) return;
    await sleep(100);
  }
  throw new Error("game did not boot (window.__dowser missing) at " + url);
}

async function elementCenter(cdp, selector) {
  return evaluate(cdp, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
}

async function mouseClick(cdp, x, y, button = "left") {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount: 1 });
}

async function clickSelector(cdp, selector, button = "left") {
  const { x, y } = await elementCenter(cdp, selector);
  await mouseClick(cdp, x, y, button);
}

async function cellCenter(cdp, r, c) {
  return evaluate(cdp, `(() => {
    const g = window.__dowser.game;
    const rect = document.getElementById("board").getBoundingClientRect();
    const cell = rect.width / g.cols;
    return { x: rect.left + (${c} + 0.5) * cell, y: rect.top + (${r} + 0.5) * cell };
  })()`);
}

async function clickCell(cdp, r, c, button = "left") {
  const { x, y } = await cellCenter(cdp, r, c);
  await mouseClick(cdp, x, y, button);
}

async function pressKey(cdp, key, opts = {}) {
  const base = { key, ...opts };
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...base });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

// ---------------------------------------------------------------- feature suite

async function runSuite(cdp, url, label) {
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
    const text = d.exception?.description || d.text || "unknown exception";
    errors.push(`exception: ${text}`);
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

  // --- "Walk the field" starts a game (intro overlay dismissed) ---
  ok(await evaluate(cdp, `!document.getElementById("intro").classList.contains("hidden")`),
    "intro overlay is shown on load");
  await clickSelector(cdp, "#begin");
  ok(await evaluate(cdp, `document.getElementById("intro").classList.contains("hidden")`),
    "'Walk the field' dismisses the intro and exposes the board");
  ok(await evaluate(cdp, `window.__dowser.game.state === "idle"`),
    "game starts idle, waiting for the first dig");

  // Force the seedplot preset so cell math below is stable.
  await pressKey(cdp, "1");
  ok(await evaluate(cdp, `window.__dowser.game.presetKey === "seedplot" && window.__dowser.game.cols === 9`),
    "key 1 selects the Seedplot 9x9 preset");

  // --- first dig: safety + flood fill + timer start ---
  ok(await evaluate(cdp, `document.getElementById("timer").textContent === "0:00"`),
    "timer reads 0:00 before the first dig");
  await clickCell(cdp, 4, 4);
  const firstDig = await evaluate(cdp, `(() => {
    const d = window.__dowser, g = d.game;
    let safe = true;
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++)
        if (g.hazard[d.idx(4 + dr, 4 + dc)]) safe = false;
    return { state: g.state, safe, revealed: g.revealedCount,
             hollows: g.hazard.reduce((a, v) => a + v, 0) };
  })()`);
  ok(firstDig.state === "playing", "first dig starts play");
  ok(firstDig.safe, "first-click safety: clicked cell and all 8 neighbors are clear");
  ok(firstDig.hollows === 10, "10 hollows seeded after the first dig");
  ok(firstDig.revealed >= 9, `flood fill opened a region (${firstDig.revealed} cells) from the guaranteed zero-plot`);

  await sleep(1300);
  ok(await evaluate(cdp, `window.__dowser.game.time > 0.5`),
    "the clock started on the first dig and is running");

  // --- flag toggle + block ---
  const hidden = await evaluate(cdp, `(() => {
    const d = window.__dowser, g = d.game;
    for (let r = 0; r < g.rows; r++)
      for (let c = 0; c < g.cols; c++) {
        const i = d.idx(r, c);
        if (!g.revealed[i] && !g.hazard[i]) return { r, c, i };
      }
    return null;
  })()`);
  await clickCell(cdp, hidden.r, hidden.c, "right");
  ok(await evaluate(cdp, `window.__dowser.game.flagged[${hidden.i}] === 1`),
    "right-click plants a marker");
  ok(await evaluate(cdp, `document.getElementById("hollow-count").textContent === "09"`),
    "HUD hollow counter drops to 09 while a marker is planted");
  const beforeBlockedDig = await evaluate(cdp, `window.__dowser.game.revealedCount`);
  await clickCell(cdp, hidden.r, hidden.c, "left");
  ok(await evaluate(cdp, `window.__dowser.game.revealed[${hidden.i}] === 0 && window.__dowser.game.revealedCount === ${beforeBlockedDig}`),
    "a marker blocks digging that plot");
  await clickCell(cdp, hidden.r, hidden.c, "right");
  ok(await evaluate(cdp, `window.__dowser.game.flagged[${hidden.i}] === 0`),
    "right-click again pulls the marker");

  // --- chord: flag a number's hollows exactly, then click the number ---
  const chordSetup = await evaluate(cdp, `(() => {
    const d = window.__dowser, g = d.game;
    for (let r = 0; r < g.rows; r++)
      for (let c = 0; c < g.cols; c++) {
        const i = d.idx(r, c);
        if (!g.revealed[i] || g.count[i] === 0) continue;
        const hollows = [], safeHidden = [];
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            if (!dr && !dc) continue;
            const nr = r + dr, nc = c + dc;
            if (nr < 0 || nr >= g.rows || nc < 0 || nc >= g.cols) continue;
            const ni = d.idx(nr, nc);
            if (g.hazard[ni]) hollows.push([nr, nc]);
            else if (!g.revealed[ni] && !g.flagged[ni]) safeHidden.push([nr, nc]);
          }
        if (safeHidden.length > 0 && hollows.length === g.count[i]) {
          for (const [hr, hc] of hollows) d.actOnCell(hr, hc, "flag");
          return { r, c, before: g.revealedCount };
        }
      }
    return null;
  })()`);
  if (chordSetup) {
    await clickCell(cdp, chordSetup.r, chordSetup.c, "left");
    ok(await evaluate(cdp, `window.__dowser.game.revealedCount > ${chordSetup.before} || window.__dowser.game.state === "won"`),
      "chord: clicking a satisfied number digs its remaining neighbors");
  } else {
    ok(false, "chord: no chordable number found on the frontier (unexpected)");
  }

  // --- R restarts instantly ---
  await pressKey(cdp, "r");
  ok(await evaluate(cdp, `window.__dowser.game.state === "idle" && window.__dowser.game.revealedCount === 0`),
    "R restarts with a fresh idle field");

  // --- pause on blur / resume on focus (README rule) ---
  await clickCell(cdp, 4, 4);
  await evaluate(cdp, `window.dispatchEvent(new Event("blur")); document.getElementById("banner").className`);
  ok(await evaluate(cdp, `document.getElementById("banner").className === "paused" && window.__dowser.game.paused`),
    "losing window focus pauses the clock with a PAUSED banner");
  await evaluate(cdp, `window.dispatchEvent(new Event("focus"))`);
  ok(await evaluate(cdp, `document.getElementById("banner").className === "hidden" && !window.__dowser.game.paused`),
    "regaining focus resumes play");

  // --- loss flow: dig a hollow ---
  const hollow = await evaluate(cdp, `(() => {
    const d = window.__dowser, g = d.game;
    for (let r = 0; r < g.rows; r++)
      for (let c = 0; c < g.cols; c++)
        if (g.hazard[d.idx(r, c)]) return { r, c };
    return null;
  })()`);
  await clickCell(cdp, hollow.r, hollow.c, "left");
  const lossState = await evaluate(cdp, `(() => ({
    state: window.__dowser.game.state,
    banner: document.getElementById("banner").className,
    text: document.getElementById("banner-text").textContent,
  }))()`);
  ok(lossState.state === "lost", "digging a hollow loses the run");
  ok(lossState.banner === "lost" && lossState.text === "A HOLLOW BURST",
    "loss shows the A HOLLOW BURST banner");

  // --- Enter restarts after a loss ---
  await pressKey(cdp, "Enter", { windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  ok(await evaluate(cdp, `window.__dowser.game.state === "idle" && document.getElementById("banner").className === "hidden"`),
    "Enter restarts after a loss and hides the banner");

  // --- win flow + banner + best time ---
  await clickCell(cdp, 4, 4);
  await sleep(1200); // make sure the winning time is >= 1s so a best is recorded
  const endState = await evaluate(cdp, `(() => {
    const d = window.__dowser, g = d.game;
    for (let r = 0; r < g.rows; r++)
      for (let c = 0; c < g.cols; c++) {
        if (g.state !== "playing") return g.state;
        const i = d.idx(r, c);
        if (!g.hazard[i] && !g.revealed[i]) d.actOnCell(r, c, "dig");
      }
    return g.state;
  })()`);
  ok(endState === "won", "revealing every safe plot wins the run");
  const winState = await evaluate(cdp, `(() => ({
    banner: document.getElementById("banner").className,
    text: document.getElementById("banner-text").textContent,
    best: localStorage.getItem("arcade.dowser.best.seedplot"),
    bestLabel: document.getElementById("best").textContent,
  }))()`);
  ok(winState.banner === "won" && winState.text === "THE FIELD IS CLEAR",
    "win shows THE FIELD IS CLEAR banner");
  ok(Number(winState.best) >= 1, `best time persisted to localStorage (${winState.best}s)`);
  ok(/best: \d+:\d\d/.test(winState.bestLabel), `HUD shows the best time (${winState.bestLabel})`);

  // --- best-time persistence across a reload ---
  await navigate(cdp, url);
  ok(await evaluate(cdp, `/best: \\d+:\\d\\d/.test(document.getElementById("best").textContent)`),
    "best time survives a page reload");
  await clickSelector(cdp, "#begin");

  // --- three presets via their buttons ---
  await clickSelector(cdp, `.preset[data-preset="meadow"]`);
  ok(await evaluate(cdp, `(() => { const g = window.__dowser.game; return g.cols === 16 && g.rows === 16 && g.hollows === 40 && g.state === "idle"; })()`),
    "Meadow preset button sets up 16x16 / 40 hollows");
  await clickSelector(cdp, `.preset[data-preset="longfield"]`);
  ok(await evaluate(cdp, `(() => { const g = window.__dowser.game; return g.cols === 30 && g.rows === 16 && g.hollows === 99 && g.state === "idle"; })()`),
    "Longfield preset button sets up 30x16 / 99 hollows");
  await clickSelector(cdp, `.preset[data-preset="seedplot"]`);
  ok(await evaluate(cdp, `(() => { const g = window.__dowser.game; return g.cols === 9 && g.rows === 9 && g.hollows === 10; })()`),
    "Seedplot preset button sets up 9x9 / 10 hollows");
  await pressKey(cdp, "2");
  ok(await evaluate(cdp, `window.__dowser.game.presetKey === "meadow"`),
    "key 2 switches to Meadow");
  await pressKey(cdp, "3");
  ok(await evaluate(cdp, `window.__dowser.game.presetKey === "longfield"`),
    "key 3 switches to Longfield");
  await pressKey(cdp, "1");

  // --- new field button ---
  await clickCell(cdp, 4, 4);
  ok(await evaluate(cdp, `window.__dowser.game.revealedCount > 0`), "dug into the field before testing new-field");
  await clickSelector(cdp, "#newfield");
  ok(await evaluate(cdp, `window.__dowser.game.state === "idle" && window.__dowser.game.revealedCount === 0`),
    "'new field' button resets to a fresh idle field");

  // --- sound toggle (button + key) ---
  const soundBefore = await evaluate(cdp, `document.getElementById("sound-toggle").textContent`);
  await clickSelector(cdp, "#sound-toggle");
  const soundAfter = await evaluate(cdp, `(() => ({
    label: document.getElementById("sound-toggle").textContent,
    stored: localStorage.getItem("arcade.dowser.sound"),
  }))()`);
  ok(soundAfter.label !== soundBefore && /sound: (on|off)/.test(soundAfter.label),
    `sound button toggles the label (${soundBefore} -> ${soundAfter.label})`);
  ok(soundAfter.stored === (soundAfter.label.endsWith("off") ? "off" : "on"),
    "sound preference persists to localStorage");
  await pressKey(cdp, "m");
  ok(await evaluate(cdp, `document.getElementById("sound-toggle").textContent === ${JSON.stringify(soundBefore)}`),
    "M key toggles sound back");

  // --- touch: tap digs, long-press plants a marker ---
  const tapTarget = await cellCenter(cdp, 4, 4);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: tapTarget.x, y: tapTarget.y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(100);
  ok(await evaluate(cdp, `window.__dowser.game.state === "playing" && window.__dowser.game.revealedCount > 0`),
    "a tap digs (touch)");
  const lpCell = await evaluate(cdp, `(() => {
    const d = window.__dowser, g = d.game;
    for (let r = 0; r < g.rows; r++)
      for (let c = 0; c < g.cols; c++) {
        const i = d.idx(r, c);
        if (!g.revealed[i] && !g.flagged[i]) return { r, c, i };
      }
    return null;
  })()`);
  const lpPos = await cellCenter(cdp, lpCell.r, lpCell.c);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: lpPos.x, y: lpPos.y }] });
  await sleep(550);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(100);
  ok(await evaluate(cdp, `window.__dowser.game.flagged[${lpCell.i}] === 1`),
    "a long-press plants a marker (touch)");

  // --- zero non-favicon console errors / exceptions ---
  await sleep(300);
  ok(errors.length === 0, `zero non-favicon console errors/exceptions (${errors.length} found)`);
  for (const e of errors) console.error("    " + e);
}

// ---------------------------------------------------------------- main

async function main() {
  const server = await startServer();
  const port = server.address().port;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dowser-chrome-"));
  const { proc, port: debugPort } = await launchChrome(userDataDir);

  try {
    const httpUrl = `http://127.0.0.1:${port}/games/dowser/index.html`;
    const fileUrl = "file://" + path.join(GAME_DIR, "index.html");

    for (const [label, url] of [["http", httpUrl], ["file", fileUrl]]) {
      const { cdp, ws } = await openTab(debugPort, "about:blank");
      await runSuite(cdp, url, label);
      ws.close();
    }
  } finally {
    proc.kill("SIGKILL");
    server.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  if (failures > 0) {
    console.error(`\ndowser browser tests: ${failures} FAILURE(S)`);
    process.exit(1);
  }
  console.log("\ndowser browser tests: all passed (http + file://)");
}

main().catch((err) => {
  console.error("browser test crashed:", err);
  process.exit(1);
});
