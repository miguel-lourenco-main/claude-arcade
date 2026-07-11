// Reversi headless-Chrome feature test.
// Run: node games/reversi/test/browser.test.mjs
//
// Loads the game BOTH over a locally-spawned http server AND via file://,
// asserts zero non-favicon console errors / uncaught exceptions on both, and
// exercises every user-facing feature in the game README:
//   setup panel, hotseat 2-player, legal-move dots, disc placement + flip
//   animation, undo (single in 2p / whole pair vs AI), hints toggle, sound
//   toggle, Esc menu, vs-AI at all three difficulties (AI replies arrive;
//   deep level uses the worker over http and the main-thread fallback over
//   file://, including the async worker-error path), forced-pass toast,
//   game end + summary, rematch button, Enter instant rematch, stats and
//   settings persistence across a reload.
//
// No npm deps: drives Chrome via raw CDP websockets (node >= 22).
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const CHROME = "/usr/bin/google-chrome";
const GAME_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ------------------------------------------------------------ tiny assert --
let checks = 0;
function ok(cond, msg) {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
  checks++;
  console.log("  ok - " + msg);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// -------------------------------------------------------------- http server --
function startServer() {
  const types = {
    ".html": "text/html", ".css": "text/css",
    ".js": "text/javascript", ".mjs": "text/javascript",
    ".md": "text/plain",
  };
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = path.join(GAME_DIR, urlPath === "/" ? "index.html" : urlPath);
    if (!file.startsWith(GAME_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end("not found"); return;
    }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

// ----------------------------------------------------------------- CDP glue --
class CDP {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.id = 0; this.pending = new Map(); this.listeners = []; }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg.method, msg.params, msg.sessionId);
      }
    };
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }
  on(fn) { this.listeners.push(fn); }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

function launchChrome(userDataDir) {
  const proc = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
    "--no-first-run", "--no-default-browser-check", "--window-size=900,1100",
    `--user-data-dir=${userDataDir}`, "--remote-debugging-port=0",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("Chrome did not start:\n" + buf)), 20000);
    proc.stderr.on("data", (d) => {
      buf += d.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve({ proc, wsUrl: m[1] }); }
    });
    proc.on("exit", (code) => reject(new Error("Chrome exited early (" + code + "):\n" + buf)));
  });
}

// -------------------------------------------------------------- page driver --
class Page {
  constructor(cdp, sessionId, errors) { this.cdp = cdp; this.sid = sessionId; this.errors = errors; }

  async eval(expression) {
    const r = await this.cdp.send("Runtime.evaluate", {
      expression, returnByValue: true, awaitPromise: true,
    }, this.sid);
    if (r.exceptionDetails) {
      throw new Error("page eval threw: " + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text) + "\nexpr: " + expression);
    }
    return r.result.value;
  }

  async waitFor(expression, desc, timeoutMs = 20000) {
    const t0 = Date.now();
    for (;;) {
      const v = await this.eval(expression);
      if (v) return v;
      if (Date.now() - t0 > timeoutMs) {
        throw new Error("TIMEOUT waiting for: " + desc + "\nexpr: " + expression);
      }
      await sleep(60);
    }
  }

  async navigate(url) {
    await this.cdp.send("Page.navigate", { url }, this.sid);
    await this.waitFor("document.readyState === 'complete' && !!window.__reversi", "page loaded (" + url + ")");
  }

  // Real DOM button click.
  click(selector) {
    return this.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('no element ${selector}'); el.click(); return true; })()`);
  }

  // Real pointerdown on a board cell, going through the canvas listener.
  clickCell(idx) {
    return this.eval(`(() => {
      const c = document.getElementById('board');
      const r = c.getBoundingClientRect();
      const SIZE = 588, CELL = 66, PAD = 30;
      const col = ${idx} & 7, row = ${idx} >> 3;
      const x = r.left + (PAD + col * CELL + CELL / 2) * (r.width / SIZE);
      const y = r.top + (PAD + row * CELL + CELL / 2) * (r.height / SIZE);
      c.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true }));
      return true;
    })()`);
  }

  // Real key press through the CDP input pipeline.
  async key(key) {
    const codes = { u: ["KeyU", 85], n: ["KeyN", 78], h: ["KeyH", 72], m: ["KeyM", 77], Escape: ["Escape", 27], Enter: ["Enter", 13] };
    const [code, vk] = codes[key];
    for (const type of ["keyDown", "keyUp"]) {
      await this.cdp.send("Input.dispatchKeyEvent", {
        type, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
      }, this.sid);
    }
  }
}

// --------------------------------------------------------------- the suite --
const R = "window.__reversi";
const ST = R + ".state";

// Board that forces a White pass after Black plays idx 2, then ends the game
// after Black plays idx 4 (verified in logic.test.js).
const PASS_BOARD = `(() => { const a = new Array(64).fill(0); a[0]=1; a[1]=2; a[5]=2; a[6]=1; a[7]=1; return a; })()`;
// Board where Black's single move at idx 2 immediately ends the game 3-0.
const END_BOARD = `(() => { const a = new Array(64).fill(0); a[0]=1; a[1]=2; return a; })()`;

async function startAiGame(page, level) {
  await page.key("n");
  await page.waitFor(`!document.getElementById('setup').classList.contains('hidden')`, "setup opens (N key)");
  await page.click(`#seg-mode button[data-v="ai"]`);
  await page.click(`#seg-side button[data-v="1"]`);
  await page.click(`#seg-level button[data-v="${level}"]`);
  await page.click("#setup-start");
  await page.waitFor(`document.getElementById('setup').classList.contains('hidden') && ${ST}.started`, "AI game started");
}

async function humanMoveAndAwaitAiReply(page, timeoutMs = 30000) {
  const before = await page.eval(`${ST}.history.length`);
  const idx = await page.eval(`[...${ST}.legalSet][0]`);
  await page.clickCell(idx);
  await page.waitFor(
    `${ST}.history.length >= ${before + 2} && !${ST}.thinking && !${ST}.busy && ${ST}.current === 1`,
    "AI reply arrived and turn returned to human", timeoutMs);
  return page.eval(`${ST}.history[${ST}.history.length - 1].player`);
}

async function runSuite(page, protocol) {
  console.log(`\n=== ${protocol} feature suite ===`);

  // Clean slate for stats determinism.
  await page.eval(`localStorage.removeItem('arcade.reversi.stats'); localStorage.removeItem('arcade.reversi.settings')`);
  await page.eval("location.reload()");
  await page.waitFor("document.readyState === 'complete' && !!window.__reversi", "reloaded with clean storage");

  // -- initial state ---------------------------------------------------------
  ok(await page.eval(`!document.getElementById('setup').classList.contains('hidden')`),
    "setup panel is shown on load");
  ok((await page.eval(`document.getElementById('status').textContent`)) === "Set up a game",
    "status prompts for setup");

  // -- hotseat two players ---------------------------------------------------
  await page.click(`#seg-mode button[data-v="2p"]`);
  await page.click("#setup-start");
  ok(await page.eval(`${R}.settings.mode === '2p'`), "hotseat: two-player mode selected via setup");
  ok(await page.eval(`document.getElementById('setup').classList.contains('hidden')`),
    "hotseat: setup closes when the game starts");
  ok((await page.eval(`document.getElementById('status').textContent`)) === "Black to move",
    "hotseat: Black moves first");

  // -- legal-move dots -------------------------------------------------------
  ok(await page.eval(`JSON.stringify([...${ST}.legalSet].sort((a,b)=>a-b)) === '[19,26,37,44]'`),
    "legal-move set is the four standard openings");
  ok(await page.eval(`${R}.settings.hints === true && ${ST}.started === true`),
    "hints are on, so legal-move dots are drawn");
  // Actually look at the canvas: a dot ring pixel at cell 19 must be greener
  // than the plain background of a non-legal cell. Sample across frames since
  // the dots pulse.
  const dotSeen = await page.eval(`(async () => {
    const c = document.getElementById('board');
    const g = c.getContext('2d');
    const scale = c.width / 588;
    const px = (ix) => {
      const x = (30 + (ix & 7) * 66 + 33 + 7) * scale;  // on the ring (radius 7)
      const y = (30 + (ix >> 3) * 66 + 33) * scale;
      return g.getImageData(Math.round(x), Math.round(y), 1, 1).data[1]; // green channel
    };
    let dotMax = 0, bgMax = 0;
    for (let i = 0; i < 14; i++) {
      dotMax = Math.max(dotMax, px(19)); // legal cell
      bgMax = Math.max(bgMax, px(9));    // empty non-legal cell
      await new Promise(requestAnimationFrame);
    }
    return dotMax > bgMax + 10;
  })()`);
  ok(dotSeen, "legal-move dot is visibly rendered on the canvas");

  // -- disc placement + flip animation ---------------------------------------
  await page.clickCell(19);
  await page.waitFor(`${ST}.board[19] === 1 && !${ST}.busy`, "black move at d3 resolves");
  ok(await page.eval(`${ST}.board[27] === 1`), "bracketed white disc flipped to black");
  ok(await page.eval(`document.getElementById('count-black').textContent === '4' && document.getElementById('count-white').textContent === '1'`),
    "flip animation completed and the live counts settled at 4-1");
  ok(await page.eval(`${ST}.lastMove === 19`), "last-move marker tracks the placed disc");

  // -- hotseat: second player really gets the turn ----------------------------
  ok((await page.eval(`document.getElementById('status').textContent`)) === "White to move",
    "hotseat: turn passes to White");
  const wIdx = await page.eval(`[...${ST}.legalSet][0]`);
  await page.clickCell(wIdx);
  await page.waitFor(`${ST}.history.length === 2 && !${ST}.busy`, "white reply resolves");
  ok(true, "hotseat: White placed a disc");

  // -- undo (single step in 2p) -----------------------------------------------
  await page.key("u");
  await page.waitFor(`${ST}.history.length === 1`, "undo removes White's move");
  ok(await page.eval(`${ST}.current === 2`), "undo: it is White's turn again");
  await page.key("u");
  await page.waitFor(`${ST}.history.length === 0`, "second undo removes Black's move");
  ok(await page.eval(`${R}.engine.counts(${ST}.board).black === 2 && ${R}.engine.counts(${ST}.board).white === 2 && ${ST}.current === 1`),
    "undo restores the initial position");
  ok(await page.eval(`document.getElementById('btn-undo').disabled === true`),
    "undo button disables when there is nothing to undo");

  // -- hints toggle ------------------------------------------------------------
  await page.key("h");
  ok(await page.eval(`${R}.settings.hints === false && document.getElementById('btn-hints').textContent === 'Hints: off'`),
    "H key turns hints off");
  ok(await page.eval(`JSON.parse(localStorage.getItem('arcade.reversi.settings')).hints === false`),
    "hints setting persists to localStorage");
  await page.click("#btn-hints");
  ok(await page.eval(`${R}.settings.hints === true && document.getElementById('btn-hints').textContent === 'Hints: on'`),
    "hints button turns hints back on");

  // -- sound toggle -------------------------------------------------------------
  await page.click("#btn-sound");
  ok(await page.eval(`${R}.settings.sound === false && document.getElementById('btn-sound').textContent === 'Sound: off'`),
    "sound button turns sound off");
  ok(await page.eval(`JSON.parse(localStorage.getItem('arcade.reversi.settings')).sound === false`),
    "sound setting persists to localStorage");
  await page.key("m");
  ok(await page.eval(`${R}.settings.sound === true && document.getElementById('btn-sound').textContent === 'Sound: on'`),
    "M key turns sound back on");

  // -- Esc opens/closes the menu --------------------------------------------------
  await page.key("Escape");
  ok(await page.eval(`!document.getElementById('setup').classList.contains('hidden')`), "Esc opens the menu");
  ok(await page.eval(`!document.getElementById('setup-cancel').classList.contains('hidden')`),
    "cancel is available mid-game");
  await page.key("Escape");
  ok(await page.eval(`document.getElementById('setup').classList.contains('hidden')`), "Esc closes the menu again");

  // -- vs AI at each difficulty ------------------------------------------------
  const LEVEL_NAMES = { 1: "Greedy", 2: "Positional", 3: "Deep" };
  for (const level of [1, 2, 3]) {
    await startAiGame(page, level);
    ok(await page.eval(`document.getElementById('label-white').textContent === 'White · ${LEVEL_NAMES[level]}'`),
      `level ${level}: AI plays White as ${LEVEL_NAMES[level]}`);
    if (level === 3) {
      await page.eval(`window.__thinkSeen = false; window.__thinkT = setInterval(() => {
        if (document.getElementById('status').classList.contains('thinking')) { window.__thinkSeen = true; clearInterval(window.__thinkT); }
      }, 25)`);
    }
    const aiPlayer = await humanMoveAndAwaitAiReply(page);
    ok(aiPlayer === 2, `level ${level}: AI (White) move arrived`);
    if (level === 1) {
      // undo vs AI rewinds the whole pair
      await page.key("u");
      await page.waitFor(`${ST}.history.length === 0`, "undo pair rewinds both moves");
      ok(await page.eval(`${ST}.current === 1 && ${R}.engine.counts(${ST}.board).empty === 60`),
        "undo pair: board back to the start, human to move");
    }
    if (level === 3) {
      ok(await page.eval(`clearInterval(window.__thinkT); window.__thinkSeen === true`),
        "deep level shows the thinking indicator");
      const ws = await page.eval(`${R}.workerStatus()`);
      if (protocol === "file") {
        ok(ws.broken === true && ws.active === false,
          "file://: worker is unavailable and the main-thread fallback engaged");
      } else {
        ok(ws.active === true && ws.broken === false,
          "http: deep search ran in the Web Worker");
      }
    }
  }

  // -- async worker-failure path (http only: needs a live worker to break) ------
  if (protocol === "http") {
    await startAiGame(page, 3);
    await page.eval(`${R}.getWorker().dispatchEvent(new Event('error'))`);
    ok(await page.eval(`${R}.workerStatus().broken === true && ${R}.workerStatus().active === false`),
      "worker onerror marks the worker broken");
    const aiPlayer = await humanMoveAndAwaitAiReply(page);
    ok(aiPlayer === 2, "deep AI move still arrives via the main-thread fallback after worker death");

    // -- sync worker-construction failure path (fresh page, throwing ctor) ----
    await page.eval("location.reload()");
    await page.waitFor("document.readyState === 'complete' && !!window.__reversi", "page reloaded for sync-failure test");
    await page.eval(`window.Worker = function () { throw new Error('worker blocked (test)'); };`);
    await startAiGame(page, 3);
    const aiPlayer2 = await humanMoveAndAwaitAiReply(page);
    ok(aiPlayer2 === 2, "deep AI move arrives via fallback when the Worker constructor throws");
    ok(await page.eval(`${R}.workerStatus().broken === true && ${R}.workerStatus().active === false`),
      "constructor throw marks the worker broken");
  }

  // -- forced pass toast + game end + summary (hotseat for determinism) ---------
  await page.key("n");
  await page.click(`#seg-mode button[data-v="2p"]`);
  await page.click("#setup-start");
  await page.eval(`${R}.setPosition(${PASS_BOARD}, 1)`);
  await page.clickCell(2);
  await page.waitFor(`document.getElementById('toast').classList.contains('show') && document.getElementById('toast').textContent.includes('pass')`,
    "forced-pass toast appears");
  ok(await page.eval(`document.getElementById('toast').textContent.includes('White has no legal move')`),
    "forced pass announces the passing side");
  await page.waitFor(`!${ST}.busy && ${ST}.current === 1 && ${ST}.legalSet.has(4)`, "turn returns to Black after the pass");
  ok(true, "pass hands the turn back to the same player");
  await page.clickCell(4);
  await page.waitFor(`${ST}.over === true`, "double pass ends the game");
  await page.waitFor(`!document.getElementById('gameover').classList.contains('hidden')`, "game-over overlay appears");
  ok(await page.eval(`document.getElementById('go-title').textContent === 'Black wins'`),
    "game-over summary names the winner");
  ok(await page.eval(`document.getElementById('go-score').textContent.includes('7') && document.getElementById('go-score').textContent.includes('0')`),
    "game-over summary shows the 7-0 score");
  await page.click("#go-setup");
  ok(await page.eval(`document.getElementById('gameover').classList.contains('hidden') && !document.getElementById('setup').classList.contains('hidden')`),
    "Change setup returns to the setup panel");

  // -- stats persistence + rematch button + Enter rematch (vs AI) ----------------
  await page.click(`#seg-mode button[data-v="ai"]`);
  await page.click(`#seg-side button[data-v="1"]`);
  await page.click(`#seg-level button[data-v="1"]`);
  await page.click("#setup-start");
  await page.eval(`${R}.setPosition(${END_BOARD}, 1)`);
  await page.clickCell(2);
  await page.waitFor(`${ST}.over === true && !document.getElementById('gameover').classList.contains('hidden')`,
    "vs-AI game ends");
  ok(await page.eval(`JSON.parse(localStorage.getItem('arcade.reversi.stats'))['1'].w === 1`),
    "win is tallied into arcade.reversi.stats");
  ok(await page.eval(`document.getElementById('go-stats').textContent.includes('1W')`),
    "game-over summary shows the per-difficulty record");
  await page.click("#go-rematch");
  ok(await page.eval(`document.getElementById('gameover').classList.contains('hidden') && !${ST}.over && ${R}.engine.counts(${ST}.board).empty === 60`),
    "Rematch button starts a fresh game");
  await page.eval(`${R}.setPosition(${END_BOARD}, 1)`);
  await page.clickCell(2);
  await page.waitFor(`!document.getElementById('gameover').classList.contains('hidden')`, "second vs-AI game ends");
  ok(await page.eval(`JSON.parse(localStorage.getItem('arcade.reversi.stats'))['1'].w === 2`),
    "stats accumulate across games");
  await page.key("Enter");
  ok(await page.eval(`document.getElementById('gameover').classList.contains('hidden') && !${ST}.over && ${R}.engine.counts(${ST}.board).empty === 60`),
    "Enter on the game-over screen is an instant rematch");

  // -- settings persistence across reload -----------------------------------------
  await page.click("#btn-hints"); // off
  await page.click("#btn-sound"); // off
  await page.eval("location.reload()");
  await page.waitFor("document.readyState === 'complete' && !!window.__reversi", "page reloaded");
  ok(await page.eval(`${R}.settings.hints === false && document.getElementById('btn-hints').textContent === 'Hints: off'`),
    "hints setting survives a reload");
  ok(await page.eval(`${R}.settings.sound === false && document.getElementById('btn-sound').textContent === 'Sound: off'`),
    "sound setting survives a reload");
  ok(await page.eval(`${R}.settings.mode === 'ai' && ${R}.settings.level === 1`),
    "mode and difficulty survive a reload");
}

// ------------------------------------------------------------------- runner --
async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "reversi-test-"));
  const server = await startServer();
  const httpUrl = `http://127.0.0.1:${server.address().port}/index.html`;
  const fileUrl = "file://" + path.join(GAME_DIR, "index.html");

  const { proc, wsUrl } = await launchChrome(tmp);
  const cdp = new CDP(wsUrl);
  await cdp.connect();

  try {
    for (const [protocol, url] of [["http", httpUrl], ["file", fileUrl]]) {
      const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });

      const errors = [];
      const isFavicon = (s) => typeof s === "string" && s.includes("favicon");
      cdp.on((method, params, sid) => {
        if (sid !== sessionId) return;
        if (method === "Runtime.exceptionThrown") {
          const d = params.exceptionDetails;
          const text = (d.exception?.description || d.text || "") + " @ " + (d.url || "");
          if (!isFavicon(text)) errors.push("exception: " + text);
        } else if (method === "Log.entryAdded" && params.entry.level === "error") {
          if (!isFavicon(params.entry.url) && !isFavicon(params.entry.text)) {
            errors.push("log: " + params.entry.text + " @ " + (params.entry.url || ""));
          }
        } else if (method === "Runtime.consoleAPICalled" && params.type === "error") {
          const text = params.args.map((a) => a.value ?? a.description ?? "").join(" ");
          if (!isFavicon(text)) errors.push("console.error: " + text);
        }
      });
      await cdp.send("Page.enable", {}, sessionId);
      await cdp.send("Runtime.enable", {}, sessionId);
      await cdp.send("Log.enable", {}, sessionId);

      const page = new Page(cdp, sessionId, errors);
      await page.navigate(protocol === "http" ? httpUrl : fileUrl);
      await runSuite(page, protocol);

      await sleep(300); // let any straggler console messages land
      if (errors.length) {
        throw new Error(`${protocol}: ${errors.length} console error(s):\n` + errors.join("\n"));
      }
      ok(true, `${protocol}: zero non-favicon console errors or exceptions`);
      await cdp.send("Target.closeTarget", { targetId });
    }
    console.log(`\nPASS — ${checks} browser assertions across http:// and file://`);
  } finally {
    cdp.close();
    proc.kill("SIGKILL");
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().then(
  () => process.exit(0),
  (err) => { console.error("\nFAIL:", err.message); process.exit(1); }
);
