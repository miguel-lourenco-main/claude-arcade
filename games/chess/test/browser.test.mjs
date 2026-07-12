#!/usr/bin/env node
/*
 * browser.test.mjs — headless-Chrome end-to-end test for the Chess game.
 *
 * Loads the game BOTH over a local http server (worker AI path) AND via
 * file:// (where Chrome blocks the worker, so the main-thread fallback must
 * engage), asserts zero non-favicon console errors/exceptions on both, and
 * exercises every user-facing feature in the game README:
 *   new game vs AI + AI reply, click moves, drag moves, legal-move dots,
 *   promotion picker, undo pair (U), board flip (F), FEN export/import,
 *   check flow, hotseat mode, checkmate flow, Enter rematch,
 *   sound toggle + settings persistence across reload.
 *
 * No npm deps: node's built-in fetch/WebSocket drive Chrome over CDP.
 * Run: node games/chess/test/browser.test.mjs   (exit 0 on pass)
 */
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHROME = "/usr/bin/google-chrome";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gameDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(gameDir, "..", "..");
const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

let testCount = 0;
function ok(cond, label) {
  testCount++;
  if (!cond) throw new Error(`ASSERT FAILED: ${label}`);
  console.log(`  PASS  ${label}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- static file server ------------------------------------------------------
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".svg": "image/svg+xml", ".md": "text/plain"
};
function startServer(root) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
      let fp = path.normalize(path.join(root, urlPath));
      if (!fp.startsWith(root)) { res.writeHead(403); res.end(); return; }
      try {
        if (fs.statSync(fp).isDirectory()) fp = path.join(fp, "index.html");
      } catch (e) { /* handled by readFile */ }
      fs.readFile(fp, (err, data) => {
        if (err) { res.writeHead(404); res.end("not found"); return; }
        res.writeHead(200, { "Content-Type": MIME[path.extname(fp)] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

// ---- minimal CDP client --------------------------------------------------------
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.eventHandlers = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`CDP ${msg.error.message}`));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const h of this.eventHandlers) h(msg);
      }
    });
  }
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener("open", () => resolve(new CDP(ws)));
      ws.addEventListener("error", () => reject(new Error("CDP websocket failed")));
    });
  }
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  onEvent(fn) { this.eventHandlers.push(fn); }
}

function launchChrome(userDataDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn(CHROME, [
      "--headless", "--remote-debugging-port=0",
      `--user-data-dir=${userDataDir}`,
      "--no-first-run", "--no-default-browser-check", "--disable-gpu",
      "--mute-audio", "--window-size=1280,900", "about:blank"
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let buf = "";
    const timer = setTimeout(() => reject(new Error("Chrome did not report DevTools endpoint")), 20000);
    proc.stderr.on("data", (d) => {
      buf += d.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve({ proc, wsUrl: m[1] }); }
    });
    proc.on("exit", (code) => reject(new Error(`Chrome exited early (${code})`)));
  });
}

// ---- per-page test driver ---------------------------------------------------------
async function makePage(cdp, url, errors, label) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Log.enable", {}, sessionId);
  cdp.onEvent((msg) => {
    if (msg.sessionId !== sessionId) return;
    let text = null;
    if (msg.method === "Runtime.exceptionThrown") {
      text = msg.params.exceptionDetails.text + " " +
        (msg.params.exceptionDetails.exception?.description || "");
    } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      text = msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
    } else if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
      text = msg.params.entry.text + " " + (msg.params.entry.url || "");
    }
    if (text && !/favicon/i.test(text)) errors.push(`[${label}] ${text.trim()}`);
  });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Page.navigate", { url }, sessionId);

  const evalJS = async (expression) => {
    const r = await cdp.send("Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (r.exceptionDetails) {
      throw new Error(`page eval threw: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description || ""}`);
    }
    return r.result.value;
  };
  const waitFor = async (expression, timeoutMs = 20000, desc = expression) => {
    const t0 = Date.now();
    for (;;) {
      if (await evalJS(`!!(${expression})`)) return;
      if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for: ${desc}`);
      await sleep(100);
    }
  };
  const state = () => evalJS("window.ChessUI.state()");
  const mouse = async (type, x, y, extra = {}) => {
    await cdp.send("Input.dispatchMouseEvent", {
      type, x: Math.round(x), y: Math.round(y),
      button: "left", clickCount: 1, pointerType: "mouse", ...extra
    }, sessionId);
  };
  const clickXY = async (x, y) => {
    await mouse("mousePressed", x, y, { buttons: 1 });
    await mouse("mouseReleased", x, y, { buttons: 0 });
    await sleep(60);
  };
  const clickSel = async (sel) => {
    const r = await evalJS(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    })()`);
    if (!r) throw new Error(`selector not found: ${sel}`);
    await clickXY(r.x, r.y);
  };
  const clickSquare = async (name) => {
    const c = await evalJS(`window.ChessUI.squareCenter(${JSON.stringify(name)})`);
    await clickXY(c.x, c.y);
  };
  const dragSquare = async (from, to) => {
    const a = await evalJS(`window.ChessUI.squareCenter(${JSON.stringify(from)})`);
    const b = await evalJS(`window.ChessUI.squareCenter(${JSON.stringify(to)})`);
    await mouse("mousePressed", a.x, a.y, { buttons: 1 });
    for (let i = 1; i <= 5; i++) {
      await mouse("mouseMoved", a.x + (b.x - a.x) * i / 5, a.y + (b.y - a.y) * i / 5, { buttons: 1 });
      await sleep(20);
    }
    await mouse("mouseReleased", b.x, b.y, { buttons: 0 });
    await sleep(60);
  };
  const pressKey = async (key, code, text) => {
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, text }, sessionId);
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code }, sessionId);
    await sleep(60);
  };

  await (async () => {
    const t0 = Date.now();
    for (;;) {
      const ready = await evalJS(
        "document.readyState === 'complete' && !!window.ChessUI").catch(() => false);
      if (ready) return;
      if (Date.now() - t0 > 20000) throw new Error("page never became ready");
      await sleep(100);
    }
  })();

  return { evalJS, waitFor, state, clickXY, clickSel, clickSquare, dragSquare, pressKey };
}

// ---- the feature suite (runs identically on http:// and file://) -------------------
async function runSuite(page, proto) {
  const { evalJS, waitFor, state, clickSel, clickSquare, dragSquare, pressKey } = page;
  const P = proto; // label prefix

  // --- new game vs AI ---
  ok(await evalJS("!document.getElementById('setup').classList.contains('hidden')"),
    `${P} setup overlay shown on load`);
  await clickSel('#seg-mode button[data-v="ai"]');
  await clickSel('#seg-side button[data-v="w"]');
  await clickSel('#seg-level button[data-v="1"]');
  await clickSel("#btn-start");
  let s = await state();
  ok(s.mode === "ai" && s.moves === 0 && s.fen === START_FEN,
    `${P} new game vs AI starts from the initial position`);
  ok(await evalJS("document.getElementById('setup').classList.contains('hidden')"),
    `${P} setup overlay closes on Start`);

  // --- click move + legal-move dots ---
  await clickSquare("e2");
  s = await state();
  ok(s.selected >= 0, `${P} clicking a pawn selects it`);
  ok(s.legalTargets.length === 2, `${P} legal-move dots: e2 shows exactly 2 targets (e3, e4)`);
  await clickSquare("e4");
  s = await state();
  // the AI may reply within milliseconds, so assert on the recorded SAN
  ok(s.moves >= 1 && s.sans[0] === "e4", `${P} click move plays 1.e4`);

  // --- AI replies (worker on http, main-thread fallback on file) ---
  await waitFor("window.ChessUI.state().moves >= 2 && !window.ChessUI.state().thinking",
    30000, "AI reply to 1.e4");
  s = await state();
  ok(s.moves === 2, `${P} AI replies to 1.e4`);
  const expectBackend = proto === "file" ? "main-thread" : "worker";
  ok(s.backend === expectBackend, `${P} AI backend is ${expectBackend} (got ${s.backend})`);

  // --- drag move ---
  await dragSquare("d2", "d4");
  s = await state();
  ok(s.moves >= 3 && s.sans[2] === "d4", `${P} drag move plays 2.d4`);

  // UI responsiveness probe while the AI thinks (must stay well under a second)
  if (await evalJS("window.ChessUI.state().thinking")) {
    const t0 = Date.now();
    await evalJS("1+1");
    const dt = Date.now() - t0;
    ok(dt < 2000, `${P} UI responsive while AI thinks (eval round-trip ${dt}ms)`);
  }
  await waitFor("window.ChessUI.state().moves >= 4 && !window.ChessUI.state().thinking",
    30000, "AI reply to 2.d4");

  // --- undo pair (U undoes AI reply + your move together) ---
  await pressKey("u", "KeyU", "u");
  s = await state();
  ok(s.moves === 2 && s.sideToMove === s.humanColor,
    `${P} undo (U) removes the AI reply + your move together`);

  // --- board flip ---
  const flipped0 = s.flipped;
  await pressKey("f", "KeyF", "f");
  ok((await state()).flipped === !flipped0, `${P} F flips the board`);
  await pressKey("f", "KeyF", "f");
  ok((await state()).flipped === flipped0, `${P} F flips the board back`);

  // --- FEN export ---
  await clickSel("#btn-fen");
  ok(await evalJS("!document.getElementById('fen-panel').classList.contains('hidden')"),
    `${P} FEN button opens the FEN panel`);
  const exported = await evalJS("document.getElementById('fen-input').value");
  ok(exported === s.fen && exported.length > 20, `${P} FEN export shows the current position`);
  await clickSel("#fen-copy");
  ok(await evalJS("document.getElementById('fen-input').value") === s.fen,
    `${P} FEN copy keeps the exported string (no crash without clipboard)`);

  // --- FEN import + promotion picker ---
  const promoFen = "8/P6k/8/8/8/8/8/K7 w - - 0 1";
  await evalJS(`document.getElementById('fen-input').value = ${JSON.stringify(promoFen)}`);
  await clickSel("#fen-load");
  s = await state();
  ok(s.fen === promoFen && s.moves === 0, `${P} FEN import loads a pasted position`);
  await clickSquare("a7");
  await clickSquare("a8");
  ok(await evalJS("!document.getElementById('promo').classList.contains('hidden')"),
    `${P} promotion picker opens on a7-a8`);
  await clickSel("#promo-choices button"); // first choice = queen
  s = await state();
  ok(s.moves >= 1 && s.sans[0].indexOf("=Q") > 0,
    `${P} promotion picker promotes to a queen (${s.sans[0]})`);
  await waitFor("window.ChessUI.state().moves >= 2 && !window.ChessUI.state().thinking",
    30000, "AI reply after promotion");
  ok(true, `${P} AI replies after the promotion`);

  // --- hotseat (two players) + checkmate + Enter rematch ---
  await clickSel("#btn-new");
  await clickSel('#seg-mode button[data-v="2p"]');
  await clickSel("#btn-start");
  s = await state();
  ok(s.mode === "2p" && s.moves === 0, `${P} hotseat game starts`);
  for (const [from, to] of [["f2", "f3"], ["e7", "e5"], ["g2", "g4"], ["d8", "h4"]]) {
    await clickSquare(from);
    await clickSquare(to);
  }
  s = await state();
  ok(s.moves === 4, `${P} hotseat: both players' moves accepted`);
  ok(s.gameOver === "checkmate", `${P} fool's mate is detected as checkmate`);
  ok(await evalJS("!document.getElementById('gameover').classList.contains('hidden')"),
    `${P} game-over overlay appears on checkmate`);
  ok(await evalJS("document.getElementById('go-title').textContent") === "Black wins",
    `${P} checkmate names the winner`);
  await pressKey("Enter", "Enter", "\r");
  s = await state();
  ok(s.moves === 0 && s.gameOver === null &&
    await evalJS("document.getElementById('gameover').classList.contains('hidden')"),
    `${P} Enter starts an instant rematch`);

  // --- check flow (hotseat, so no AI races the asserts) ---
  const checkFen = "4k3/8/8/8/8/8/8/4KR2 w - - 0 1";
  await evalJS(`document.getElementById('fen-input').value = ${JSON.stringify(checkFen)}`);
  await clickSel("#fen-load");
  await clickSquare("f1");
  await clickSquare("f8");
  s = await state();
  ok(s.check === true && s.sans[0] === "Rf8+", `${P} giving check sets the check state (Rf8+)`);
  ok(await evalJS("document.getElementById('status').textContent.includes('check')"),
    `${P} status bar announces the check`);
  await clickSquare("e8");
  await clickSquare("f8"); // Kxf8 escapes the check, leaving K vs K
  s = await state();
  ok(s.check === false && s.sans[1] === "Kxf8", `${P} capturing the rook clears the check`);
  ok(s.gameOver === "insufficient material" &&
    await evalJS("!document.getElementById('gameover').classList.contains('hidden')"),
    `${P} K vs K ends as an insufficient-material draw`);
  await clickSel("#go-setup");
  await clickSel("#btn-start"); // back to a fresh 2p game for the settings check
  await clickSel("#btn-fen");   // close the FEN panel again

  // --- sound toggle + settings persistence across reload ---
  const soundBefore = (await state()).sound;
  await clickSel("#btn-sound");
  s = await state();
  ok(s.sound === !soundBefore, `${P} sound toggle flips the setting`);
  const soundLabel = await evalJS("document.getElementById('btn-sound').textContent");
  ok(soundLabel === `Sound: ${s.sound ? "on" : "off"}`, `${P} sound button label matches`);
  const stored = await evalJS("localStorage.getItem('arcade.chess.settings')");
  ok(!!stored && JSON.parse(stored).sound === s.sound && JSON.parse(stored).mode === "2p",
    `${P} settings are saved under arcade.chess.settings`);
  await evalJS("location.reload()").catch(() => {});
  await sleep(300);
  await waitFor("document.readyState === 'complete' && !!window.ChessUI", 20000, "reload");
  const s2 = await state();
  ok(s2.sound === s.sound && s2.mode === "2p",
    `${P} settings persist across a reload (sound=${s2.sound}, mode=${s2.mode})`);
}

// ---- main -------------------------------------------------------------------------
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "chess-btest-"));
let chrome = null, server = null, failed = false;
try {
  server = await startServer(repoRoot);
  const port = server.address().port;
  const httpUrl = `http://127.0.0.1:${port}/games/chess/index.html`;
  const fileUrl = "file://" + path.join(gameDir, "index.html");

  ({ proc: chrome, wsUrl: globalThis.__wsUrl } = await launchChrome(path.join(scratch, "profile")));
  const cdp = await CDP.connect(globalThis.__wsUrl);

  for (const [proto, url] of [["http", httpUrl], ["file", fileUrl]]) {
    console.log(`\n=== ${proto}:// — ${url} ===`);
    const errors = [];
    const page = await makePage(cdp, url, errors, proto);
    await runSuite(page, proto);
    await sleep(500); // let any late console errors arrive
    if (errors.length) {
      throw new Error(`console errors on ${proto}://\n  ` + errors.join("\n  "));
    }
    ok(true, `${proto} zero non-favicon console errors/exceptions`);
  }
  console.log(`\nALL ${testCount} BROWSER ASSERTS PASSED (http + file)`);
} catch (err) {
  failed = true;
  console.error(`\nBROWSER TEST FAILED: ${err.message}`);
} finally {
  if (chrome) chrome.kill("SIGKILL");
  if (server) server.close();
  try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}
process.exit(failed ? 1 : 0);
