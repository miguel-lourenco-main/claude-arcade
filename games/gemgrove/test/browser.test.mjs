// Gemgrove browser test — headless Chrome over raw CDP, no npm deps.
// Loads the game over a self-spawned local http server AND via file://,
// asserts zero non-favicon console errors/exceptions on both, and exercises
// every user-facing feature in the game README with real clicks/keys.
// Run: node games/gemgrove/test/browser.test.mjs
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

const G = "window.__gemgrove";

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
    cdp.on("Page.loadEventFired", () => resolve());
  });
  await cdp.send("Page.navigate", { url });
  await loaded;
  for (let i = 0; i < 50; i++) {
    if (await evaluate(cdp, `typeof ${G} !== 'undefined'`)) return;
    await sleep(100);
  }
  throw new Error("game did not boot (window.__gemgrove missing) at " + url);
}

async function waitFor(cdp, expression, timeoutMs = 6000, label = expression) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await evaluate(cdp, expression)) return true;
    await sleep(40);
  }
  throw new Error("timeout waiting for: " + label);
}

async function clickSelector(cdp, selector) {
  const { x, y } = await evaluate(cdp, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  await sleep(40);
}

async function cellPoint(cdp, r, c) {
  return evaluate(cdp, `(() => {
    const rect = document.getElementById("game").getBoundingClientRect();
    return { x: rect.left + (${c} + 0.5) * rect.width / 8,
             y: rect.top + (${r} + 0.5) * rect.height / 8 };
  })()`);
}

// click a board cell (real mouse events -> pointerdown on the canvas)
async function clickCell(cdp, r, c) {
  const { x, y } = await cellPoint(cdp, r, c);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  await sleep(40);
}

// press at a cell and drag toward a neighbour (dr/dc in {-1,0,1})
async function dragCell(cdp, r, c, dr, dc) {
  const from = await cellPoint(cdp, r, c);
  const cellPx = await evaluate(cdp, `document.getElementById("game").getBoundingClientRect().width / 8`);
  const to = { x: from.x + dc * cellPx * 0.7, y: from.y + dr * cellPx * 0.7 };
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y, button: "none" });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: to.x, y: to.y, button: "left" });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", clickCount: 1 });
  await sleep(40);
}

async function press(cdp, key) {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key });
  await sleep(40);
}

const hudText = (cdp, id) => evaluate(cdp, `document.getElementById(${JSON.stringify(id)}).textContent`);
const stored = (cdp, k) => evaluate(cdp, `localStorage.getItem("arcade.gemgrove." + ${JSON.stringify(k)})`);
const score = (cdp) => evaluate(cdp, `${G}.score`);
const movesLeft = (cdp) => evaluate(cdp, `${G}.moves`);
const cellAt = (cdp, r, c) => evaluate(cdp, `(() => { const cl = ${G}.grid[${r}][${c}]; return cl ? { t: cl.t, s: cl.s } : null; })()`);

// A matchless, moveless base pattern (verified in logic.test.js) — a quiet
// canvas to paint deterministic scenarios onto.
const INERT = [
  "01230123", "23012301", "01230123", "23012301",
  "01230123", "23012301", "01230123", "23012301",
];

// overwrite the whole board with a pattern, then edits [[r,c,t,s], ...]
async function paint(cdp, edits = []) {
  await waitFor(cdp, `${G}.phase === "awaiting"`, 8000, "awaiting before paint");
  await evaluate(cdp, `(() => {
    const rows = ${JSON.stringify(INERT)};
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++)
        ${G}.setCell(r, c, Number(rows[r][c]), null);
    for (const [r, c, t, s] of ${JSON.stringify(edits)}) ${G}.setCell(r, c, t, s || null);
    ${G}.refreshMoves();
    return true;
  })()`);
}

// the single-valid-move scenario used by the swap tests:
// swapping (3,3)<->(3,4) completes a vertical run of type 5 in column 3
const PLANT = [[1, 3, 5], [2, 3, 5], [3, 4, 5]];

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
  // arm the guarded debug handle before any game script runs
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: "window.__GEMGROVE_TEST__ = true;",
  });

  console.log(`\n=== ${label}: ${url}`);
  await navigate(cdp, url);

  // --- boot: start overlay + HUD on a fresh profile ---
  ok(await evaluate(cdp, `${G}.mode === "start" && document.getElementById("overlay").classList.contains("show")`),
    "boots into the start overlay");
  ok(await evaluate(cdp, `document.getElementById("overlay-title").textContent === "GEMGROVE"`),
    "start overlay is titled GEMGROVE");
  ok(await evaluate(cdp, `document.getElementById("overlay-detail").textContent.includes("target 1000 in 20 moves")`),
    "start overlay states level 1's target and move budget");
  ok((await hudText(cdp, "level")) === "1" && (await hudText(cdp, "score")) === "0" && (await hudText(cdp, "best")) === "0",
    "HUD reads level 1, score 0, best 0 on a fresh profile");
  ok((await hudText(cdp, "goal-text")).trim() === "0 / 1000", "goal bar reads 0 / 1000");
  ok(await evaluate(cdp, `document.querySelector("#topbar .back").getAttribute("href") === "../../index.html"`),
    "the back link points at the arcade index");
  ok(await evaluate(cdp, `document.getElementById("audio-toggle").textContent === "sound: on"`),
    "sound defaults to on");

  // --- click to begin: play mode, 20 moves, board deals in ---
  await clickSelector(cdp, "#overlay");
  ok(await evaluate(cdp, `${G}.mode === "play" && !document.getElementById("overlay").classList.contains("show")`),
    "clicking the overlay starts level 1 (overlay hides)");
  ok(await movesLeft(cdp) === 20, "level 1 grants 20 moves");
  ok(await evaluate(cdp, `${G}.target === 1000 && ${G}.level === 1`), "level 1 targets 1000 points");
  await waitFor(cdp, `${G}.phase === "awaiting"`, 8000, "deal-in settles");
  ok(await evaluate(cdp, `${G}.phase === "awaiting" && ${G}.validMoves.length > 0`),
    "the dealt board settles with at least one valid move");
  ok(await evaluate(cdp, `${G}.grid.length === 8 && ${G}.grid.every(row => row.length === 8 && row.every(cl => cl))`),
    "the board is a full 8x8 grid");

  // --- the canvas actually renders the grove ---
  ok(await evaluate(cdp, `(() => {
    const c = document.getElementById("game");
    if (!c.width || !c.height) return false;
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60) lit++;
    return lit > 2000;
  })()`), "canvas is sized and painted (non-background pixels)");

  // --- click-select, deselect, re-select ---
  await paint(cdp);
  await clickCell(cdp, 0, 0);
  ok(await evaluate(cdp, `${G}.sel && ${G}.sel.r === 0 && ${G}.sel.c === 0`),
    "clicking a gem selects it");
  await clickCell(cdp, 0, 0);
  ok(await evaluate(cdp, `${G}.sel === null`), "clicking the selected gem deselects it");
  await clickCell(cdp, 0, 0);
  await clickCell(cdp, 2, 2);
  ok(await evaluate(cdp, `${G}.sel && ${G}.sel.r === 2 && ${G}.sel.c === 2`),
    "clicking a non-adjacent gem moves the selection instead of swapping");
  await clickCell(cdp, 2, 2); // deselect

  // --- no-match swap animates then reverts ---
  const t00 = (await cellAt(cdp, 0, 0)).t, t01 = (await cellAt(cdp, 0, 1)).t;
  const movesBeforeRevert = await movesLeft(cdp);
  await clickCell(cdp, 0, 0);
  await clickCell(cdp, 0, 1);
  ok(await evaluate(cdp, `${G}.phase === "swapping"`), "an adjacent click starts the swap animation");
  await waitFor(cdp, `${G}.phase === "awaiting"`, 4000, "revert settles");
  ok((await cellAt(cdp, 0, 0)).t === t00 && (await cellAt(cdp, 0, 1)).t === t01,
    "a matchless swap reverts the gems");
  ok(await movesLeft(cdp) === movesBeforeRevert, "a reverted swap costs no move");

  // --- click-swap a real match: moves-1, score +3 gems x10 x1, goal bar moves ---
  await paint(cdp, PLANT);
  const s0 = await score(cdp), m0 = await movesLeft(cdp);
  await clickCell(cdp, 3, 3);
  await clickCell(cdp, 3, 4);
  await waitFor(cdp, `${G}.phase === "awaiting" && ${G}.mode === "play"`, 10000, "match resolves");
  ok(await movesLeft(cdp) === m0 - 1, "a matching swap costs exactly one move");
  const s1 = await score(cdp);
  ok(s1 >= s0 + 30, `a 3-match banks at least 30 points (got +${s1 - s0})`);
  ok((await hudText(cdp, "score")) === String(s1), "the score HUD tracks the state");
  ok(await evaluate(cdp, `parseFloat(document.getElementById("goal-fill").style.width) > 0`),
    "the target progress bar advances");

  // --- R retries the level: score and moves reset ---
  await press(cdp, "r");
  ok(await evaluate(cdp, `${G}.mode === "play" && ${G}.score === 0 && ${G}.moves === 20`),
    "R retries the level (score back to 0, moves back to 20)");
  await waitFor(cdp, `${G}.phase === "awaiting"`, 8000, "retry deal-in settles");

  // --- drag-swap works too ---
  await paint(cdp, PLANT);
  const s2 = await score(cdp), m2 = await movesLeft(cdp);
  await dragCell(cdp, 3, 4, 0, -1); // drag the planted gem left onto (3,3)
  await waitFor(cdp, `${G}.phase !== "awaiting"`, 2000, "drag starts a swap");
  await waitFor(cdp, `${G}.phase === "awaiting" && ${G}.mode === "play"`, 10000, "drag match resolves");
  ok(await movesLeft(cdp) === m2 - 1 && (await score(cdp)) >= s2 + 30,
    "dragging a gem toward a neighbour swaps and matches");

  // --- cascades: the fall after a clear forms a new match at x2 ---
  // Swapping (6,2)->(6,3) clears column 3 rows 5-7; the column drops 3, so
  // (4,3)'s type-4 gem lands on row 7 between the painted (7,2) and (7,4).
  await paint(cdp, [[5, 3, 5], [7, 3, 5], [6, 2, 5], [4, 3, 4], [7, 2, 4], [7, 4, 4]]);
  const sc0 = await score(cdp);
  await clickCell(cdp, 6, 2);
  await clickCell(cdp, 6, 3);
  await waitFor(cdp, `${G}.chain >= 2`, 8000, "cascade chain reaches x2");
  ok(true, "a cleared column drops gems into a second match (chain x2)");
  await waitFor(cdp, `${G}.phase === "awaiting" && ${G}.mode === "play"`, 10000, "cascade settles");
  const sc1 = await score(cdp);
  ok(sc1 >= sc0 + 30 + 60, `the chained clear scores at the x2 multiplier (got +${sc1 - sc0})`);

  // --- 4-in-a-row forges a cross gem at the swap site ---
  await paint(cdp, [[6, 2, 5], [6, 3, 5], [6, 5, 5], [5, 4, 5]]);
  await clickCell(cdp, 5, 4);
  await clickCell(cdp, 6, 4); // row 6 cols 2..5 become a 4-run
  await waitFor(cdp, `${G}.grid[6][4] && ${G}.grid[6][4].s === "cross"`, 6000, "cross forges at the swap site");
  ok(true, "a 4-in-a-row forges a cross gem at the swap site");
  await waitFor(cdp, `${G}.phase === "awaiting" && ${G}.mode === "play"`, 10000, "forge cascade settles");

  // --- 5-in-a-row forges a burst gem ---
  await paint(cdp, [[2, 1, 4], [2, 2, 4], [2, 4, 4], [2, 5, 4], [1, 3, 4]]);
  await clickCell(cdp, 1, 3);
  await clickCell(cdp, 2, 3); // row 2 cols 1..5 become a 5-run
  await waitFor(cdp, `${G}.grid[2][3] && ${G}.grid[2][3].s === "burst"`, 6000, "burst forges at the swap site");
  ok(true, "a 5-in-a-row forges a burst gem at the swap site");
  await waitFor(cdp, `${G}.phase === "awaiting" && ${G}.mode === "play"`, 10000, "forge cascade settles");

  // --- matching a cross clears its whole row + column (15 cells >= 150 pts) ---
  await paint(cdp, [[4, 2, 5], [4, 3, 5, "cross"], [3, 4, 5]]);
  const s3 = await score(cdp);
  await clickCell(cdp, 3, 4);
  await clickCell(cdp, 4, 4);
  await waitFor(cdp, `${G}.phase === "awaiting" && ${G}.mode === "play"`, 10000, "cross detonation settles");
  const s4 = await score(cdp);
  ok(s4 >= s3 + 150, `a matched cross clears its row+column (15 cells, got +${s4 - s3})`);

  // --- matching a burst detonates a 3x3 (9 cells >= 90 pts) ---
  await paint(cdp, [[4, 2, 5], [4, 3, 5, "burst"], [3, 4, 5]]);
  const s5 = await score(cdp);
  await clickCell(cdp, 3, 4);
  await clickCell(cdp, 4, 4);
  await waitFor(cdp, `${G}.phase === "awaiting" && ${G}.mode === "play"`, 10000, "burst detonation settles");
  const s6 = await score(cdp);
  ok(s6 >= s5 + 90, `a matched burst detonates a 3x3 (9 cells, got +${s6 - s5})`);

  // --- reshuffle: notice toast, gems rearranged, score preserved ---
  const s7 = await score(cdp);
  await evaluate(cdp, `${G}.startShuffle(); true`);
  ok(await evaluate(cdp, `${G}.phase === "shuffling"`), "the reshuffle phase engages");
  ok(await evaluate(cdp, `document.getElementById("toast").classList.contains("show")
    && document.getElementById("toast").textContent.includes("reshuffling")`),
    "the reshuffle notice toast appears");
  await waitFor(cdp, `${G}.phase === "awaiting"`, 8000, "reshuffle settles");
  ok(await evaluate(cdp, `${G}.validMoves.length > 0 && ${G}.findRuns().length === 0`),
    "the reshuffled board has a valid move and no ready-made matches");
  ok(await score(cdp) === s7, "reshuffling preserves the score");

  // --- idle ~5s: one valid move pulses as a hint ---
  await paint(cdp, PLANT);
  await clickCell(cdp, 0, 0); // select + deselect: resets the idle timer and
  await clickCell(cdp, 0, 0); // clears any hint chosen from the pre-paint board
  await waitFor(cdp, `${G}.hintMove !== null`, 9000, "idle hint appears");
  ok(await evaluate(cdp, `(() => {
    const h = ${G}.hintMove;
    return h && h.a.r === 3 && h.a.c === 3 && h.b.r === 3 && h.b.c === 4;
  })()`), "after ~5s idle the hint pulses the only valid move");

  // --- P pauses and resumes; input is gated while paused ---
  await press(cdp, "p");
  ok(await evaluate(cdp, `${G}.paused === true
    && document.getElementById("overlay").classList.contains("show")
    && document.getElementById("overlay-title").textContent === "PAUSED"`),
    "P pauses with a PAUSED overlay");
  await press(cdp, "p");
  ok(await evaluate(cdp, `${G}.paused === false && !document.getElementById("overlay").classList.contains("show")`),
    "P again resumes play");

  // --- losing window focus auto-pauses; clicking the overlay resumes ---
  await evaluate(cdp, `window.dispatchEvent(new Event("blur")); true`);
  ok(await evaluate(cdp, `${G}.paused === true && document.getElementById("overlay-title").textContent === "PAUSED"`),
    "window blur auto-pauses the game");
  // board input is guarded while paused (synthetic pointerdown straight at the canvas)
  await evaluate(cdp, `(() => {
    const cv = document.getElementById("game");
    const r = cv.getBoundingClientRect();
    cv.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, cancelable: true,
      clientX: r.left + r.width / 16, clientY: r.top + r.height / 16,
    }));
    return true;
  })()`);
  ok(await evaluate(cdp, `${G}.sel === null && ${G}.paused === true`),
    "board input is ignored while paused");
  await clickSelector(cdp, "#overlay");
  ok(await evaluate(cdp, `${G}.paused === false`), "clicking the overlay resumes");

  // --- M / button toggle sound, persisted ---
  await press(cdp, "m");
  ok(await evaluate(cdp, `${G}.soundOn === false && document.getElementById("audio-toggle").textContent === "sound: off"`),
    "M mutes: button reads sound: off");
  ok(await stored(cdp, "audio") === "0", "the mute persists (arcade.gemgrove.audio)");
  await clickSelector(cdp, "#audio-toggle");
  ok(await evaluate(cdp, `${G}.soundOn === true && (localStorage.getItem("arcade.gemgrove.audio") === "1")`),
    "clicking the sound button unmutes and persists");

  // --- reaching the target then running out of moves clears the level ---
  await paint(cdp, PLANT);
  await evaluate(cdp, `${G}.setScore(2000); ${G}.setMoves(1); true`);
  ok(await evaluate(cdp, `document.getElementById("goal-fill").classList.contains("met")`),
    "the goal bar turns gold once the target is met");
  await clickCell(cdp, 3, 3);
  await clickCell(cdp, 3, 4);
  await waitFor(cdp, `${G}.mode === "levelend"`, 12000, "level clears when the last move banks the target");
  ok(await evaluate(cdp, `document.getElementById("overlay-title").textContent === "LEVEL 1 CLEAR"`),
    "the LEVEL 1 CLEAR overlay appears");
  ok(await stored(cdp, "level") === "2", "the next level persists (arcade.gemgrove.level)");
  ok(Number(await stored(cdp, "best")) >= 2000, "the best score persists (arcade.gemgrove.best)");

  // --- any key continues to the next level; score carries, target rises ---
  await press(cdp, "Enter");
  ok(await evaluate(cdp, `${G}.mode === "play" && ${G}.level === 2 && ${G}.target === 1850 && ${G}.moves === 20`),
    "a key press starts level 2 (target 1850, 20 moves)");
  ok(await evaluate(cdp, `document.getElementById("level").textContent === "2"
    && document.getElementById("goal-text").textContent === "0 / 1850"`),
    "HUD and goal bar reset for level 2 (carried score banks)");
  await waitFor(cdp, `${G}.phase === "awaiting"`, 8000, "level 2 deal-in settles");

  // --- running out of moves below the target is game over; R retries ---
  await paint(cdp, PLANT);
  const carried = await score(cdp);
  await evaluate(cdp, `${G}.setMoves(1); true`);
  await clickCell(cdp, 3, 3);
  await clickCell(cdp, 3, 4);
  await waitFor(cdp, `${G}.mode === "gameover"`, 12000, "game over when moves run out below target");
  ok(await evaluate(cdp, `document.getElementById("overlay-title").textContent === "OUT OF MOVES"`),
    "the OUT OF MOVES overlay appears");
  await press(cdp, "r");
  ok(await evaluate(cdp, `${G}.mode === "play" && ${G}.level === 2 && ${G}.moves === 20 && ${G}.score === ${carried}`),
    "R on game over retries level 2 with the carried score restored");
  await waitFor(cdp, `${G}.phase === "awaiting"`, 8000, "retry deal-in settles");

  // --- progress survives a reload ---
  await press(cdp, "m"); // leave sound muted so the pref reload is observable
  await navigate(cdp, url);
  ok(await evaluate(cdp, `${G}.mode === "start" && ${G}.level === 2`),
    "a reload resumes at level 2");
  ok(await evaluate(cdp, `document.getElementById("overlay-sub").textContent === "resume at level 2"`),
    "the start overlay offers to resume level 2");
  ok(Number(await hudText(cdp, "best")) >= 2000, "the best score survives a reload");
  ok(await evaluate(cdp, `document.getElementById("audio-toggle").textContent === "sound: off"`),
    "the sound preference survives a reload");
  await press(cdp, "m"); // restore

  // --- zero non-favicon console errors / exceptions ---
  await sleep(300);
  ok(errors.length === 0, `zero non-favicon console errors/exceptions (${errors.length} found)`);
  for (const e of errors) console.error("    " + e);
}

// ---------------------------------------------------------------- main

async function main() {
  const server = await startServer();
  const port = server.address().port;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gemgrove-chrome-"));
  const { proc, port: debugPort } = await launchChrome(userDataDir);

  try {
    const httpUrl = `http://127.0.0.1:${port}/games/gemgrove/index.html`;
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
    console.error(`\ngemgrove browser tests: ${failures} FAILURE(S)`);
    process.exit(1);
  }
  console.log("\ngemgrove browser tests: all passed (http + file://)");
}

main().catch((err) => {
  console.error("browser test crashed:", err);
  process.exit(1);
});
