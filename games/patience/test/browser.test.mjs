// browser.test.mjs — headless-Chrome feature test for Patience.
// Run: node games/patience/test/browser.test.mjs
//
// Loads the game BOTH over a self-spawned local http server AND via file://,
// asserts zero non-favicon console errors / uncaught exceptions on both, and
// exercises every user-facing feature in the game README with real mouse and
// keyboard input over the Chrome DevTools Protocol. No npm dependencies.
// Exits 0 on pass, 1 with a message on fail.

import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = '/usr/bin/google-chrome';
const GAME_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

let passed = 0;
function ok(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  passed++;
  console.log(`  ok - ${msg}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- tiny static server ----------

function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const file = path.join(GAME_DIR, rel === '/' ? 'index.html' : rel);
      if (!file.startsWith(GAME_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

// ---------- minimal CDP client ----------

class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = [];
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(new Error('websocket error: ' + e.message));
      this.ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id && this.pending.has(m.id)) {
          const { resolve, reject } = this.pending.get(m.id);
          this.pending.delete(m.id);
          if (m.error) reject(new Error(`${m.error.message} ${m.error.data || ''}`));
          else resolve(m.result);
        } else if (m.method) {
          for (const h of this.handlers) h(m);
        }
      };
    });
  }
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  on(fn) { this.handlers.push(fn); }
  close() { try { this.ws.close(); } catch (e) { /* already closed */ } }
}

// ---------- chrome bootstrap ----------

async function launchChrome(profileDir) {
  const proc = spawn(CHROME, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    '--mute-audio',
    '--window-size=1280,900',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d; });

  const portFile = path.join(profileDir, 'DevToolsActivePort');
  for (let i = 0; i < 200; i++) {
    if (fs.existsSync(portFile)) {
      const port = parseInt(fs.readFileSync(portFile, 'utf8').split('\n')[0], 10);
      if (port > 0) {
        const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
        return { proc, wsUrl: info.webSocketDebuggerUrl };
      }
    }
    if (proc.exitCode !== null) throw new Error(`chrome exited early: ${stderr.slice(0, 500)}`);
    await sleep(100);
  }
  throw new Error('chrome did not expose a DevTools port; stderr: ' + stderr.slice(0, 500));
}

// ---------- page driver ----------

class Driver {
  constructor(cdp, sessionId) {
    this.cdp = cdp;
    this.sid = sessionId;
    this.errors = [];
  }

  async init() {
    await this.cdp.send('Page.enable', {}, this.sid);
    await this.cdp.send('Runtime.enable', {}, this.sid);
    await this.cdp.send('Log.enable', {}, this.sid);
    this.cdp.on((m) => {
      if (m.sessionId !== this.sid) return;
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        this.errors.push(`exception: ${d.text} ${d.exception?.description || ''}`);
      } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        this.errors.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
      } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
        const e = m.params.entry;
        if (`${e.url || ''} ${e.text || ''}`.includes('favicon')) return; // only favicon 404s are tolerated
        this.errors.push(`log: ${e.text} ${e.url || ''}`);
      }
    });
  }

  async eval(expr) {
    const r = await this.cdp.send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: true,
    }, this.sid);
    if (r.exceptionDetails) {
      throw new Error(`page eval threw: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description || ''}\nexpr: ${expr.slice(0, 200)}`);
    }
    return r.result.value;
  }

  async until(expr, msg, timeout = 8000) {
    const t0 = Date.now();
    for (;;) {
      if (await this.eval(expr)) return;
      if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for: ${msg}`);
      await sleep(80);
    }
  }

  async goto(url) {
    await this.cdp.send('Page.bringToFront', {}, this.sid);
    await this.cdp.send('Page.navigate', { url }, this.sid);
    await this.until(
      `document.readyState === 'complete' && !!(window.Patience && window.__patience && window.__patience.game)`,
      `game booted at ${url}`);
  }

  async mouse(type, x, y, extra = {}) {
    await this.cdp.send('Input.dispatchMouseEvent', {
      type, x: Math.round(x), y: Math.round(y), button: 'left', pointerType: 'mouse', ...extra,
    }, this.sid);
  }

  async click(x, y) {
    await this.mouse('mousePressed', x, y, { buttons: 1, clickCount: 1 });
    await this.mouse('mouseReleased', x, y, { buttons: 0, clickCount: 1 });
  }

  async clickSel(sel) {
    const p = await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    await this.click(p.x, p.y);
  }

  async drag(x0, y0, x1, y1) {
    await this.mouse('mouseMoved', x0, y0);
    await this.mouse('mousePressed', x0, y0, { buttons: 1, clickCount: 1 });
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      await this.mouse('mouseMoved', x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, { buttons: 1 });
    }
    await this.mouse('mouseReleased', x1, y1, { buttons: 0, clickCount: 1 });
  }

  async key(k, code) {
    const vk = k === ' ' ? 32 : k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0;
    const base = { key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', text: k.length === 1 ? k : '', ...base }, this.sid);
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, this.sid);
  }

  // viewport point for tableau card j of pile i (a spot hitTest resolves to that card)
  async tabPoint(i, j) {
    return this.eval(`(() => {
      const P = window.__patience;
      const r = document.getElementById('board').getBoundingClientRect();
      const ys = P.pilePositions(${i});
      const pile = P.game.tab[${i}];
      const x = P.colX(${i}) + P.L.CW / 2;
      const y = ${j} >= pile.length - 1
        ? ys[${j}] + P.L.CH / 2
        : (ys[${j}] + ys[${j} + 1]) / 2;
      return { x: r.left + x, y: r.top + y };
    })()`);
  }

  async tabDropPoint(i) {
    return this.eval(`(() => {
      const P = window.__patience;
      const r = document.getElementById('board').getBoundingClientRect();
      const ys = P.pilePositions(${i});
      const y = ys.length ? ys[ys.length - 1] + P.L.CH / 2 : P.L.tabY + P.L.CH / 2;
      return { x: r.left + P.colX(${i}) + P.L.CW / 2, y: r.top + y };
    })()`);
  }

  async stockPoint() {
    return this.eval(`(() => {
      const P = window.__patience;
      const r = document.getElementById('board').getBoundingClientRect();
      const s = P.stockRect();
      return { x: r.left + s.x + s.w / 2, y: r.top + s.y + s.h / 2 };
    })()`);
  }

  async dealSeed(seed) {
    await this.clickSel('#seed-input');
    await this.eval(`document.getElementById('seed-input').value = ''`);
    await this.cdp.send('Input.insertText', { text: String(seed) }, this.sid);
    await this.clickSel('#btn-deal');
    await this.until(`window.__patience.game.seed === ${seed} && window.__patience.game.moves === 0`,
      `deal #${seed} dealt`);
  }

  layout() {
    return this.eval(`(() => {
      const g = window.__patience.game;
      const c = (x) => x.r + '.' + x.s + '.' + (x.up ? 1 : 0);
      return JSON.stringify({ tab: g.tab.map(p => p.map(c)), stock: g.stock.map(c) });
    })()`);
  }
}

// ---------- the feature suite (runs identically over http and file://) ----------

async function runSuite(d, url, label) {
  console.log(`\n== ${label}: ${url}`);
  d.errors.length = 0;
  await d.goto(url);
  ok(await d.eval(`typeof window.Patience.Game === 'function'`), `${label}: classic scripts populated window.Patience`);

  // --- seeded deal via the seed box + deal shape ---
  await d.dealSeed(1);
  const shape = await d.eval(`(() => {
    const g = window.__patience.game;
    return {
      lens: g.tab.map(p => p.length),
      ups: g.tab.map(p => p.map(c => c.up)),
      stock: g.stock.length, waste: g.waste.length,
      found: g.found.map(f => f.length),
    };
  })()`);
  ok(JSON.stringify(shape.lens) === '[1,2,3,4,5,6,7]', `${label}: deal shape — tableau piles of 1..7`);
  ok(shape.ups.every((p) => p.every((up, j) => up === (j === p.length - 1))), `${label}: deal shape — only pile tops are face-up`);
  ok(shape.stock === 24 && shape.waste === 0 && shape.found.every((n) => n === 0), `${label}: deal shape — 24 in stock, empty waste/foundations`);

  // --- seeded reproducibility: same number in the box, same shuffle ---
  const deal1 = await d.layout();
  await d.key('n', 'KeyN'); // new random deal in between
  await d.until(`window.__patience.game.seed !== 1`, 'N dealt a new random game');
  ok(true, `${label}: N deals a new random game (seed changed)`);
  await d.dealSeed(1);
  ok(await d.layout() === deal1, `${label}: seeded deal reproducibility — deal #1 re-dealt identically`);
  ok(await d.eval(`document.getElementById('seed-input').value`) === '1', `${label}: header shows the deal number`);

  // --- drag & drop, legal (seed 1: 4♣ on pile 3 -> 5♦ on pile 6), with auto-flip ---
  const src = await d.tabPoint(3, 3);
  const dst = await d.tabDropPoint(6);
  await d.drag(src.x, src.y, dst.x, dst.y);
  const afterMove = await d.eval(`(() => {
    const g = window.__patience.game;
    return { l3: g.tab[3].length, l6: g.tab[6].length, flipped: g.tab[3][2].up, moves: g.moves,
             top: g.tab[6][7] && g.tab[6][7].r };
  })()`);
  ok(afterMove.l3 === 3 && afterMove.l6 === 8 && afterMove.top === 4, `${label}: legal drag & drop moves the card`);
  ok(afterMove.flipped === true, `${label}: auto-flip — newly exposed card turns face-up`);
  ok(afterMove.moves === 1, `${label}: the move was counted`);
  await d.until(`document.getElementById('movecount').textContent === '1 move'`, 'HUD move counter updates');
  ok(true, `${label}: HUD shows the move count`);

  // --- undo button restores the move including the flip ---
  await d.clickSel('#btn-undo');
  const afterUndo = await d.eval(`(() => {
    const g = window.__patience.game;
    return { l3: g.tab[3].length, l6: g.tab[6].length, hidden: !g.tab[3][2].up, moves: g.moves };
  })()`);
  ok(afterUndo.l3 === 4 && afterUndo.l6 === 7 && afterUndo.hidden && afterUndo.moves === 0,
    `${label}: Undo button reverses the move and re-hides the flipped card`);

  // --- illegal drag snaps back (seed 1: 7♦ has no legal target) ---
  const badSrc = await d.tabPoint(0, 0);
  const badDst = await d.tabDropPoint(5);
  await d.drag(badSrc.x, badSrc.y, badDst.x, badDst.y);
  const afterBad = await d.eval(`(() => {
    const g = window.__patience.game;
    return { l0: g.tab[0].length, l5: g.tab[5].length, moves: g.moves, dragging: !!window.__patience.drag };
  })()`);
  ok(afterBad.l0 === 1 && afterBad.l5 === 6 && afterBad.moves === 0 && !afterBad.dragging,
    `${label}: illegal drop is rejected and the card snaps back home`);

  // --- run move (seed 3: 10♥ onto J♣, then the J♣+10♥ run onto Q♦) ---
  await d.dealSeed(3);
  const r1s = await d.tabPoint(1, 1);
  const r1d = await d.tabDropPoint(2);
  await d.drag(r1s.x, r1s.y, r1d.x, r1d.y);
  await d.until(`window.__patience.game.tab[2].length === 4`, 'setup move for the run');
  const r2s = await d.tabPoint(2, 2); // head of the face-up run
  const r2d = await d.tabDropPoint(0);
  await d.drag(r2s.x, r2s.y, r2d.x, r2d.y);
  const run = await d.eval(`(() => {
    const g = window.__patience.game;
    return { l0: g.tab[0].length, ranks: g.tab[0].map(c => c.r), flip: g.tab[2][1].up };
  })()`);
  ok(run.l0 === 3 && run.ranks[1] === 11 && run.ranks[2] === 10, `${label}: a face-up run moves as one unit, order intact`);
  ok(run.flip === true, `${label}: auto-flip after the run leaves its pile`);

  // --- double-click sends a card to its foundation (seed 1: A♦ on pile 1) ---
  await d.dealSeed(1);
  const acePt = await d.tabPoint(1, 1);
  await d.click(acePt.x, acePt.y);
  await d.click(acePt.x, acePt.y);
  await d.until(`window.__patience.game.found[2].length === 1`, 'double-click sent the ace up');
  ok(await d.eval(`window.__patience.game.tab[1].length === 1 && window.__patience.game.found[2][0].r === 1`),
    `${label}: double-click sends the ace to its foundation`);

  // --- draw-3 / draw-1, stock click, Space/D keys, recycle ---
  await d.dealSeed(1);
  ok(await d.eval(`document.getElementById('btn-mode').textContent`) === 'Draw 3', `${label}: draw mode defaults to Draw 3`);
  const sp = await d.stockPoint();
  await d.click(sp.x, sp.y);
  await d.until(`window.__patience.game.waste.length === 3`, 'stock click drew 3');
  ok(true, `${label}: clicking the stock draws three in draw-3 mode`);
  await d.key(' ', 'Space');
  await d.until(`window.__patience.game.waste.length === 6`, 'Space drew 3');
  ok(true, `${label}: Space draws`);
  await d.clickSel('#btn-mode');
  ok(await d.eval(`document.getElementById('btn-mode').textContent`) === 'Draw 1', `${label}: mode button toggles to Draw 1`);
  await d.key('d', 'KeyD');
  await d.until(`window.__patience.game.waste.length === 7`, 'D drew exactly 1 in draw-1 mode');
  ok(true, `${label}: draw-1 mode draws a single card (D key)`);
  // drain the stock, then one more draw recycles the waste
  for (let i = 0; i < 30; i++) {
    if (await d.eval(`window.__patience.game.stock.length === 0`)) break;
    await d.key('d', 'KeyD');
  }
  ok(await d.eval(`window.__patience.game.stock.length === 0 && window.__patience.game.waste.length === 24`),
    `${label}: stock drains fully onto the waste`);
  await d.key('d', 'KeyD');
  await d.until(`window.__patience.game.stock.length === 24 && window.__patience.game.waste.length === 0`, 'recycle');
  ok(true, `${label}: drawing on an empty stock recycles the waste`);

  // --- full undo, including draws and the recycle ---
  for (let i = 0; i < 40; i++) {
    if (await d.eval(`window.__patience.game.hist.length === 0`)) break;
    await d.key('z', 'KeyZ');
  }
  ok(await d.eval(`(() => {
    const g = window.__patience.game;
    return g.hist.length === 0 && g.moves === 0 && g.stock.length === 24 && g.waste.length === 0;
  })()`), `${label}: full undo unwinds every draw and the recycle back to the deal`);
  ok(await d.eval(`document.getElementById('btn-undo').disabled`) === true, `${label}: Undo disables with empty history`);

  // --- sound toggle (button + M key), persisted setting ---
  await d.clickSel('#btn-sound');
  ok(await d.eval(`document.getElementById('btn-sound').textContent`) === '♪ off', `${label}: sound button toggles off`);
  ok(await d.eval(`JSON.parse(localStorage.getItem('arcade.patience.settings')).sound`) === false,
    `${label}: sound setting persists to arcade.patience.settings`);
  await d.key('m', 'KeyM');
  ok(await d.eval(`document.getElementById('btn-sound').textContent`) === '♪ on', `${label}: M key toggles sound back on`);

  // --- pause on blur ---
  await d.eval(`window.dispatchEvent(new Event('blur'))`);
  ok(await d.eval(`!document.getElementById('paused-tag').classList.contains('hidden')`), `${label}: timer pauses on window blur`);
  await d.eval(`window.dispatchEvent(new Event('focus'))`);
  ok(await d.eval(`document.getElementById('paused-tag').classList.contains('hidden')`), `${label}: focus resumes`);

  // --- regression: a synthetic PointerEvent (no active pointer) must not throw ---
  const errCountBefore = d.errors.length;
  const synth = await d.eval(`(() => {
    const P = window.__patience;
    const canvas = document.getElementById('board');
    const r = canvas.getBoundingClientRect();
    const s = P.stockRect();
    const before = P.game.waste.length;
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, pointerId: 987654,
      clientX: r.left + s.x + s.w / 2, clientY: r.top + s.y + s.h / 2,
    }));
    return { before, after: P.game.waste.length };
  })()`);
  ok(synth.after === synth.before + 1,
    `${label}: synthetic pointerdown still draws (setPointerCapture guarded)`);
  ok(d.errors.length === errCountBefore, `${label}: synthetic pointerdown raised no uncaught error`);

  // --- auto-complete to a win, win cascade, stats ---
  await d.dealSeed(1);
  ok(await d.eval(`(() => {
    const g = window.__patience.game;
    const all = [];
    for (const p of [...g.tab, g.stock, g.waste, ...g.found]) all.push(...p);
    if (all.length !== 52) return false;
    g.stock.length = 0; g.waste.length = 0;
    for (let i = 0; i < 4; i++) g.found[i].length = 0;
    for (let i = 0; i < 7; i++) g.tab[i].length = 0;
    for (const c of all) { c.up = true; if (c.r <= 12) g.found[c.s].push(c); }
    for (const f of g.found) f.sort((a, b) => a.r - b.r);
    for (let s = 0; s < 4; s++) g.tab[s].push(all.find(c => c.s === s && c.r === 13));
    g.hist.length = 0;
    return g.canAutoComplete();
  })()`), `${label}: endgame staged; auto-complete reports safe`);
  await d.key('m', 'KeyM'); // refreshChrome x2 so the auto button appears
  await d.key('m', 'KeyM');
  await d.until(`!document.getElementById('btn-auto').classList.contains('hidden')`, 'auto-complete button appears');
  ok(true, `${label}: Auto-complete button appears when it is safe`);
  await d.clickSel('#btn-auto');
  await d.until(`window.__patience.game.isWon() && !!window.__patience.winState`, 'auto-complete finished the game', 15000);
  ok(true, `${label}: auto-complete plays the endgame to the win`);
  await d.until(`window.__patience.winState && window.__patience.winState.parts.length > 0`, 'cascade cards launched');
  ok(true, `${label}: win cascade launches cards from the foundations`);
  await d.until(`!document.getElementById('winbox').classList.contains('hidden')`, 'win panel appears', 10000);
  ok((await d.eval(`document.getElementById('win-stats').textContent`)).includes('deal #1'),
    `${label}: win panel reports the deal number`);

  const stats = await d.eval(`JSON.parse(localStorage.getItem('arcade.patience.stats'))`);
  ok(stats && stats.wins === 1 && stats.streak === 1 && stats.bestMoves != null && stats.bestTime != null,
    `${label}: stats recorded the win (wins/streak/best time/fewest moves)`);

  // --- any key on the win screen starts a new deal ---
  await d.key('x', 'KeyX');
  await d.until(`!window.__patience.winState && window.__patience.game.moves === 0`, 'key on win screen dealt anew');
  ok(await d.eval(`document.getElementById('winbox').classList.contains('hidden')`),
    `${label}: any key on the win screen starts a new deal`);

  // --- R restarts the same deal ---
  const seedNow = await d.eval(`window.__patience.game.seed`);
  await d.key('d', 'KeyD'); // make a move so the restart is observable
  await d.until(`window.__patience.game.moves === 1`, 'draw before restart');
  await d.key('r', 'KeyR');
  await d.until(`window.__patience.game.moves === 0`, 'R restarted');
  ok(await d.eval(`window.__patience.game.seed`) === seedNow, `${label}: R restarts the SAME deal (seed kept)`);

  // --- stats persist across a reload ---
  await d.goto(url);
  const statsAfter = await d.eval(`JSON.parse(localStorage.getItem('arcade.patience.stats'))`);
  ok(statsAfter && statsAfter.wins === 1, `${label}: stats persist across a reload`);
  ok((await d.eval(`document.getElementById('stats-line').textContent`)).includes('wins 1/'),
    `${label}: footer stats line shows the persisted record`);

  // --- zero non-favicon console errors / exceptions across the whole session ---
  if (d.errors.length) {
    throw new Error(`${label}: console errors detected:\n  ${d.errors.join('\n  ')}`);
  }
  ok(true, `${label}: zero non-favicon console errors or uncaught exceptions`);
}

// ---------- main ----------

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patience-cdp-'));
let chrome = null;
let server = null;
let cdp = null;

const watchdog = setTimeout(() => {
  console.error('FAIL: global watchdog timeout (180s)');
  try { chrome?.proc.kill('SIGKILL'); } catch (e) { /* gone */ }
  process.exit(1);
}, 180000);

try {
  if (!fs.existsSync(CHROME)) throw new Error(`chrome not found at ${CHROME}`);
  server = await startServer();
  const httpUrl = `http://127.0.0.1:${server.address().port}/index.html`;
  const fileUrl = 'file://' + path.join(GAME_DIR, 'index.html');

  chrome = await launchChrome(profileDir);
  cdp = new CDP(chrome.wsUrl);
  await cdp.connect();

  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const d = new Driver(cdp, sessionId);
  await d.init();

  await runSuite(d, httpUrl, 'http');
  // wipe origin-scoped state won't carry over to file:// anyway (different origin),
  // so the file:// pass re-runs the identical suite from scratch.
  await runSuite(d, fileUrl, 'file');

  console.log(`\nbrowser.test.mjs: all ${passed} assertions passed (http + file://)`);
  process.exitCode = 0;
} catch (err) {
  console.error(`\nFAIL: ${err.message}`);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  try { cdp?.close(); } catch (e) { /* closed */ }
  try { chrome?.proc.kill('SIGTERM'); } catch (e) { /* gone */ }
  await sleep(300);
  try { chrome?.proc.kill('SIGKILL'); } catch (e) { /* gone */ }
  try { server?.close(); } catch (e) { /* closed */ }
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
}
