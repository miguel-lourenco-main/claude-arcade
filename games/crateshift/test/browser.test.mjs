// Crateshift browser test — headless Chrome over raw CDP, no npm deps.
// Loads the game over a self-spawned local http server AND via file://,
// asserts zero non-favicon console errors/exceptions on both, and exercises
// every user-facing feature in the game README with real key/click events.
// Run: node games/crateshift/test/browser.test.mjs
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
    cdp.on("Page.loadEventFired", () => resolve());
  });
  await cdp.send("Page.navigate", { url });
  await loaded;
  for (let i = 0; i < 50; i++) {
    if (await evaluate(cdp, "typeof window.__crateshift !== 'undefined'")) return;
    await sleep(100);
  }
  throw new Error("game did not boot (window.__crateshift missing) at " + url);
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
}

async function keyDown(cdp, code, key = code) {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code });
}
async function keyUp(cdp, code, key = code) {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code });
}
async function press(cdp, code, key = code) {
  await keyDown(cdp, code, key);
  await keyUp(cdp, code, key);
  await sleep(30); // let logic + HUD settle (logic is instant; this is for safety)
}

const G = "window.__crateshift";
const hudText = (cdp, id) => evaluate(cdp, `document.getElementById(${JSON.stringify(id)}).textContent`);
const moves = (cdp) => evaluate(cdp, `${G}.logic.movesCount(${G}.L)`);
const playerAt = (cdp) => evaluate(cdp, `(() => ({ x: ${G}.L.player.x, y: ${G}.L.player.y }))()`);
const crate0At = (cdp) => evaluate(cdp, `(() => ({ x: ${G}.L.crates[0].x, y: ${G}.L.crates[0].y }))()`);
const stored = (cdp, k) => evaluate(cdp, `localStorage.getItem("arcade.crateshift." + ${JSON.stringify(k)})`);

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

  console.log(`\n=== ${label}: ${url}`);
  await navigate(cdp, url);

  // --- boot: level select with 21 shifts, 0 stars, only shift 1 unlocked ---
  ok(await evaluate(cdp, `${G}.view === "select" && !document.getElementById("select").classList.contains("hidden")`),
    "boots into the level-select view");
  ok(await evaluate(cdp, `document.querySelectorAll("#level-grid .level-card").length === 21`),
    "level select shows all 21 shifts");
  ok((await hudText(cdp, "total-stars")).trim() === "★ 0/63",
    "star total reads 0/63 on a fresh profile");
  ok(await evaluate(cdp, `(() => {
    const cards = document.querySelectorAll("#level-grid .level-card");
    return !cards[0].classList.contains("locked") && cards[1].classList.contains("locked")
      && cards[1].querySelector(".name").textContent === "locked";
  })()`), "only shift 1 starts unlocked; locked cards hide their names");
  ok(await evaluate(cdp, `document.querySelector("#topbar .back").getAttribute("href") === "../../index.html"`),
    "the back link points at the arcade index");

  // --- level-select cursor + locked Enter ---
  await press(cdp, "ArrowRight");
  ok(await evaluate(cdp, `${G}.cursor === 1 && document.querySelectorAll(".level-card")[1].classList.contains("cursor")`),
    "arrow keys move the select cursor");
  await press(cdp, "Enter");
  ok(await evaluate(cdp, `${G}.view === "select"`),
    "Enter on a locked shift refuses to start it");
  await press(cdp, "ArrowLeft");
  ok(await evaluate(cdp, `${G}.cursor === 0`), "cursor moves back left");

  // --- Enter starts shift 1; HUD reflects the level ---
  await press(cdp, "Enter");
  ok(await evaluate(cdp, `${G}.view === "play" && !document.getElementById("play").classList.contains("hidden")`),
    "Enter starts the selected shift (play view)");
  ok((await hudText(cdp, "hud-level")) === "1 · First Push", "HUD names shift 1 · First Push");
  ok((await hudText(cdp, "hud-moves")) === "0" && (await hudText(cdp, "hud-par")) === "1",
    "HUD starts at 0 moves with par 1");
  ok((await hudText(cdp, "hud-best")) === "—", "HUD best is — before any finish");

  // --- the canvas actually renders the warehouse ---
  await sleep(250);
  ok(await evaluate(cdp, `(() => {
    const c = document.getElementById("game");
    if (!c.width || !c.height) return false;
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) lit++;
    return lit > 1000;
  })()`), "canvas is sized and painted (non-blank pixels)");

  // --- movement + bump + undo (arrows and WASD) ---
  await press(cdp, "ArrowUp");
  ok(await moves(cdp) === 1 && (await playerAt(cdp)).y === 1, "ArrowUp steps the worker");
  await press(cdp, "ArrowUp");
  ok(await moves(cdp) === 1, "bumping a wall costs no move");
  await press(cdp, "KeyU", "u");
  ok(await moves(cdp) === 0 && (await playerAt(cdp)).y === 2, "U undoes the step");
  await press(cdp, "KeyW", "w");
  ok(await moves(cdp) === 1 && (await playerAt(cdp)).y === 1, "W (WASD) also moves");
  await press(cdp, "KeyZ", "z");
  ok(await moves(cdp) === 0, "Z also undoes");

  // --- deadlock: shove the crate into a corner; it is flagged; R rescues ---
  for (const c of ["ArrowUp", "ArrowRight", "ArrowDown", "ArrowRight", "ArrowDown", "ArrowLeft", "ArrowLeft"]) {
    await press(cdp, c);
  }
  ok(await evaluate(cdp, `(() => {
    const g = ${G}; const c = g.L.crates[0];
    return c.x === 1 && c.y === 3 && g.logic.inCorner(g.L, c) && g.L.corners.has("1,3");
  })()`), "a crate pushed into a non-target corner is detected as dead");
  ok(await moves(cdp) === 7, "the deadlock trip cost 7 moves");
  await press(cdp, "KeyR", "r");
  const afterR = { m: await moves(cdp), p: await playerAt(cdp), c: await crate0At(cdp) };
  ok(afterR.m === 0 && afterR.p.x === 2 && afterR.p.y === 2 && afterR.c.x === 3 && afterR.c.y === 2,
    "R restarts the shift to its layout");

  // --- sloppy finish: 3 moves on par 1 = 1 star ---
  for (const c of ["ArrowUp", "ArrowDown", "ArrowRight"]) await press(cdp, c);
  ok(await evaluate(cdp, `${G}.L.solved === true`), "pushing the crate onto the pad solves the shift");
  await sleep(450); // WIN_DELAY is 260ms
  ok(await evaluate(cdp, `!document.getElementById("overlay").classList.contains("hidden")
    && document.getElementById("overlay-title").textContent === "SHIFT CLEAR"`),
    "the SHIFT CLEAR overlay appears after the win delay");
  ok(await evaluate(cdp, `document.querySelector("#overlay-stars .off").textContent.length === 2`),
    "3 moves on par 1 scores a single star (2 grayed)");
  ok(await evaluate(cdp, `document.getElementById("overlay-stats").textContent.includes("3 moves · 1 pushes · par 1")`),
    "overlay reports moves, pushes, and par");
  ok(JSON.parse(await stored(cdp, "best.0"))?.m === 3,
    "the finish is persisted as arcade.crateshift.best.0");

  // --- input freezes once solved ---
  await press(cdp, "ArrowLeft");
  await press(cdp, "KeyU", "u");
  ok(await moves(cdp) === 3, "movement and undo are ignored after the win");

  // --- replay beats par: best drops, 3 stars ---
  await press(cdp, "KeyR", "r");
  ok(await evaluate(cdp, `document.getElementById("overlay").classList.contains("hidden")`) && await moves(cdp) === 0,
    "R on the win screen replays the shift");
  await press(cdp, "ArrowRight");
  await sleep(450);
  const best0 = JSON.parse(await stored(cdp, "best.0"));
  ok(best0?.m === 1 && best0?.s === 3, "a 1-move finish beats the old best and scores 3 stars");
  ok(await evaluate(cdp, `document.querySelector("#overlay-stars .off") === null
    || document.querySelector("#overlay-stars .off").textContent.length === 0`),
    "the overlay shows all 3 stars lit");
  ok((await hudText(cdp, "hud-best")).includes("1"), "HUD best updates to 1 move");

  // --- Enter on the win screen advances to the freshly unlocked shift 2 ---
  await press(cdp, "Enter");
  ok((await hudText(cdp, "hud-level")) === "2 · Corner Caution",
    "Enter on the win screen starts shift 2 (finishing unlocked it)");
  ok(await evaluate(cdp, `document.getElementById("overlay").classList.contains("hidden")`),
    "the overlay is gone on the next shift");

  // --- hold-to-repeat: one keydown, held ~600ms, walks multiple steps ---
  await keyDown(cdp, "ArrowRight");
  await sleep(600);
  await keyUp(cdp, "ArrowRight");
  await sleep(50);
  const heldMoves = await moves(cdp);
  const heldPos = await playerAt(cdp);
  ok(heldMoves === 2 && heldPos.x === 6,
    `holding a direction repeats after the delay and stops at the wall (${heldMoves} moves)`);
  await press(cdp, "KeyU", "u");
  await press(cdp, "KeyU", "u");
  ok(await moves(cdp) === 0, "undo walks the whole held run back");

  // --- window blur drops held keys ---
  await keyDown(cdp, "ArrowDown");
  await sleep(30);
  const heldBefore = await evaluate(cdp, `${G}.held.length`);
  await evaluate(cdp, `window.dispatchEvent(new Event("blur")); true`);
  const heldAfter = await evaluate(cdp, `${G}.held.length`);
  await keyUp(cdp, "ArrowDown");
  ok(heldBefore === 1 && heldAfter === 0, "held directions are dropped when the window blurs");
  await press(cdp, "KeyU", "u");

  // --- solve shift 2 at par: multi-crate win, 3 stars ---
  await press(cdp, "ArrowLeft"); // push crate A onto its pad
  ok(await evaluate(cdp, `${G}.logic.onTarget(${G}.L, ${G}.L.crates[0])`),
    "the first crate glows on its pad (onTarget)");
  await press(cdp, "ArrowDown");
  await press(cdp, "ArrowDown"); // push crate B onto its pad
  await sleep(450);
  ok(await evaluate(cdp, `${G}.L.solved && document.getElementById("overlay-stats").textContent.includes("3 moves · 2 pushes · par 3")`),
    "shift 2 solved at par: 3 moves, 2 pushes");
  ok(await evaluate(cdp, `document.querySelector("#overlay-stars .off") === null
    || document.querySelector("#overlay-stars .off").textContent.length === 0`),
    "a par finish scores 3 stars");

  // --- N/P navigation across unlocked shifts (seed two finishes to reach Two Lanes) ---
  await evaluate(cdp, `
    localStorage.setItem("arcade.crateshift.best.2", JSON.stringify({ m: 99, p: 9, s: 1 }));
    localStorage.setItem("arcade.crateshift.best.3", JSON.stringify({ m: 99, p: 9, s: 1 }));
    true`);
  await press(cdp, "KeyN", "n");
  await press(cdp, "KeyN", "n");
  await press(cdp, "KeyN", "n");
  ok((await hudText(cdp, "hud-level")) === "5 · Two Lanes", "N advances through unlocked shifts");
  await press(cdp, "KeyN", "n");
  ok((await hudText(cdp, "hud-level")) === "5 · Two Lanes", "N refuses to enter a locked shift");
  await press(cdp, "KeyP", "p");
  ok((await hudText(cdp, "hud-level")) === "4 · Swap Meet", "P steps back a shift");
  await press(cdp, "KeyN", "n");

  // --- two crates in a row never budge ---
  await press(cdp, "ArrowUp");
  await press(cdp, "ArrowRight");
  await press(cdp, "ArrowDown"); // crate at 3,2 backed by crate at 3,3
  ok(await evaluate(cdp, `(() => {
    const L = ${G}.L;
    return ${G}.logic.movesCount(L) === 2 &&
      L.crates.some(c => c.x === 3 && c.y === 2) && L.crates.some(c => c.x === 3 && c.y === 3);
  })()`), "pushing a crate backed by another crate is blocked");

  // --- Esc returns to select; progress is reflected there ---
  await press(cdp, "Escape");
  ok(await evaluate(cdp, `${G}.view === "select"`), "Esc returns to the shift board");
  ok((await hudText(cdp, "total-stars")).trim() === "★ 8/63",
    "star total sums real + seeded finishes (3+3+1+1)");
  ok(await evaluate(cdp, `(() => {
    const c = document.querySelectorAll(".level-card")[0];
    return c.querySelector(".stars").textContent.startsWith("★★★") &&
      c.querySelector(".best-val").textContent === "1";
  })()`), "shift 1's card shows its stars and best moves");
  ok(await evaluate(cdp, `(() => {
    const cards = document.querySelectorAll(".level-card");
    return !cards[4].classList.contains("locked") && cards[5].classList.contains("locked");
  })()`), "unlocks propagate: shift 5 open, shift 6 still locked");

  // --- clicking a card starts that shift ---
  await clickSelector(cdp, "#level-grid .level-card:nth-child(2)");
  ok(await evaluate(cdp, `${G}.view === "play"`) && (await hudText(cdp, "hud-level")) === "2 · Corner Caution",
    "clicking an unlocked card starts that shift");
  await press(cdp, "Escape");

  // --- sound toggle: M key + button, persisted ---
  await press(cdp, "KeyM", "m");
  ok(await evaluate(cdp, `document.getElementById("audio-toggle").textContent === "sound: off" && ${G}.audioOn === false`),
    "M mutes: button reads sound: off");
  ok(await stored(cdp, "audio") === "false", "the mute is persisted (arcade.crateshift.audio)");
  await clickSelector(cdp, "#audio-toggle");
  ok(await evaluate(cdp, `document.getElementById("audio-toggle").textContent === "sound: on" && ${G}.audioOn === true`),
    "clicking the sound button unmutes");

  // --- persistence survives a reload ---
  await navigate(cdp, url);
  ok((await hudText(cdp, "total-stars")).trim() === "★ 8/63", "star total survives a reload");
  ok(await evaluate(cdp, `document.getElementById("audio-toggle").textContent === "sound: on"`),
    "the audio preference survives a reload");
  ok(await evaluate(cdp, `${G}.cursor === 1`),
    "the select cursor resumes at the last-played shift");
  ok(await evaluate(cdp, `!document.querySelectorAll(".level-card")[4].classList.contains("locked")`),
    "unlocks survive a reload");

  // --- zero non-favicon console errors / exceptions ---
  await sleep(300);
  ok(errors.length === 0, `zero non-favicon console errors/exceptions (${errors.length} found)`);
  for (const e of errors) console.error("    " + e);
}

// ---------------------------------------------------------------- main

async function main() {
  const server = await startServer();
  const port = server.address().port;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "crateshift-chrome-"));
  const { proc, port: debugPort } = await launchChrome(userDataDir);

  try {
    const httpUrl = `http://127.0.0.1:${port}/games/crateshift/index.html`;
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
    console.error(`\ncrateshift browser tests: ${failures} FAILURE(S)`);
    process.exit(1);
  }
  console.log("\ncrateshift browser tests: all passed (http + file://)");
}

main().catch((err) => {
  console.error("browser test crashed:", err);
  process.exit(1);
});
