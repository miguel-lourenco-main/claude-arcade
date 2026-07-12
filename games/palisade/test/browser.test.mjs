// Palisade browser test — run with: node games/palisade/test/browser.test.mjs
//
// Self-contained headless-Chrome test (no npm deps; node's built-in fetch +
// WebSocket drive the Chrome DevTools Protocol). It loads the game BOTH over a
// local http server it spawns itself AND directly via file://, asserts zero
// non-favicon console errors/exceptions on both, and exercises every
// user-facing feature in the README: map select, tower place/upgrade/sell,
// targeting cycle, wave start + early call, fast forward, pause + blur pause,
// loss and win flows, best-score persistence, and the audio toggle.
//
// Exits 0 on pass, non-zero with a clear message on failure.

import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CHROME = process.env.CHROME_BIN || '/usr/bin/google-chrome';
const GAME_DIR = path.dirname(fileURLToPath(new URL('.', import.meta.url))); // games/palisade
const REPO_ROOT = path.resolve(GAME_DIR, '..', '..');

let failures = 0;
function ok(cond, msg) {
  if (cond) { console.log(`  PASS  ${msg}`); }
  else { failures++; console.error(`  FAIL  ${msg}`); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- http server

function startServer(root) {
  const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  };
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.normalize(path.join(root, urlPath));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// ---------------------------------------------------------------- CDP client

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject, method } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg);
      }
    });
  }
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => resolve(new CDP(ws)));
      ws.addEventListener('error', () => reject(new Error('CDP websocket failed: ' + url)));
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  on(fn) { this.listeners.push(fn); }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

// ---------------------------------------------------------------- chrome

function launchChrome(userDataDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn(CHROME, [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--mute-audio',
      '--autoplay-policy=no-user-gesture-required',
      '--window-size=1280,1000',
      'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    const onData = (chunk) => {
      err += chunk.toString();
      const m = err.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { proc.stderr.off('data', onData); resolve({ proc, wsUrl: m[1] }); }
    };
    proc.stderr.on('data', onData);
    proc.on('exit', (code) => reject(new Error(`chrome exited early (${code}): ${err.slice(0, 400)}`)));
    setTimeout(() => reject(new Error('chrome did not expose DevTools in 20s')), 20000);
  });
}

// ---------------------------------------------------------------- page driver

class Page {
  constructor(cdp, sessionId, label) {
    this.cdp = cdp;
    this.sessionId = sessionId;
    this.label = label;
    this.errors = [];
    cdp.on((msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        this.errors.push(d.exception?.description || d.text || 'exception');
      } else if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'assert')) {
        this.errors.push(msg.params.args.map(a => a.value ?? a.description ?? '').join(' '));
      } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        this.errors.push(`${msg.params.entry.source}: ${msg.params.entry.text} ${msg.params.entry.url || ''}`);
      }
    });
  }
  send(method, params) { return this.cdp.send(method, params, this.sessionId); }
  async enable() {
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Log.enable');
  }
  nonFaviconErrors() { return this.errors.filter(e => !/favicon/i.test(e)); }

  async eval(expr) {
    const res = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) {
      throw new Error(`eval failed [${this.label}]: ${res.exceptionDetails.exception?.description || res.exceptionDetails.text}\n  expr: ${expr.slice(0, 200)}`);
    }
    return res.result.value;
  }

  async waitFor(expr, msg, timeoutMs = 20000) {
    const t0 = Date.now();
    let last;
    while (Date.now() - t0 < timeoutMs) {
      last = await this.eval(expr);
      if (last) return last;
      await sleep(100);
    }
    throw new Error(`timeout [${this.label}] waiting for: ${msg} (expr=${expr.slice(0, 160)}, last=${JSON.stringify(last)})`);
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
    await this.waitFor(`document.readyState === 'complete'`, 'page load');
  }

  async mouseClick(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, pointerType: 'mouse' });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
  }

  async clickSel(sel) {
    const pt = await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!pt) throw new Error(`no element for selector ${sel} [${this.label}]`);
    await this.mouseClick(Math.round(pt.x), Math.round(pt.y));
  }

  // Click the center of grid cell (c, r) on the game canvas (20x14 grid).
  async clickCanvasCell(c, r) {
    const pt = await this.eval(`(() => {
      const cv = document.getElementById('game');
      cv.scrollIntoView({ block: 'center' });
      const rect = cv.getBoundingClientRect();
      return { x: rect.left + (${c} + 0.5) * rect.width / 20, y: rect.top + (${r} + 0.5) * rect.height / 14 };
    })()`);
    await this.mouseClick(Math.round(pt.x), Math.round(pt.y));
  }

  async key(key, code, text) {
    const params = { key, code };
    if (text !== undefined) params.text = text;
    await this.send('Input.dispatchKeyEvent', { type: text !== undefined ? 'keyDown' : 'rawKeyDown', ...params });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
  }
}

// ---------------------------------------------------------------- the suite

async function runSuite(page, url) {
  const L = page.label;
  console.log(`\n=== ${L}: ${url}`);
  await page.navigate(url);

  // --- map select ---------------------------------------------------------
  await page.waitFor(`globalThis.Palisade && Palisade.ui && document.querySelectorAll('#map-cards .map-card').length === 3`, 'map select renders');
  ok(true, `[${L}] map select shows 3 map cards`);
  ok(await page.eval(`!document.getElementById('overlay').classList.contains('hidden')`), `[${L}] start overlay visible before a map is picked`);

  await page.clickSel('#map-cards .map-card');
  await page.waitFor(`Palisade.ui.getGame() !== null && document.getElementById('overlay').classList.contains('hidden')`, 'game started');
  ok(await page.eval(`document.getElementById('map-label').textContent`) === 'Riverbend', `[${L}] picking the first card starts Riverbend`);
  // Freeze the build-phase countdown so slow machines can't auto-start the wave mid-test.
  await page.eval(`Palisade.ui.getGame().intermission = 600`);
  ok(await page.eval(`Palisade.ui.getGame().gold`) === 150, `[${L}] fresh game starts with 150 gold`);

  // --- tower place --------------------------------------------------------
  await page.clickSel('.shop-btn[data-type="arrow"]');
  await page.waitFor(`Palisade.ui.getState().placingType === 'arrow'`, 'arrow placement armed');
  ok(true, `[${L}] shop click arms arrow placement`);
  await page.clickCanvasCell(5, 5);
  await page.waitFor(`Palisade.ui.getGame().towers.length === 1`, 'tower placed');
  ok(await page.eval(`Palisade.ui.getGame().gold`) === 100, `[${L}] placing an arrow (50g) leaves 100 gold`);

  // Esc cancels placement, then clicking the tower selects it.
  await page.key('Escape', 'Escape');
  await page.waitFor(`Palisade.ui.getState().placingType === null`, 'placement cancelled by Esc');
  ok(true, `[${L}] Esc cancels placement`);
  await page.clickCanvasCell(5, 5);
  await page.waitFor(`!document.getElementById('inspector').classList.contains('hidden')`, 'inspector opens');
  ok((await page.eval(`document.getElementById('insp-name').textContent`)).includes('Arrow'), `[${L}] clicking a placed tower selects it (inspector shows Arrow)`);

  // --- targeting cycle ----------------------------------------------------
  await page.clickSel('#insp-target');
  await page.waitFor(`Palisade.ui.getGame().towers[0].mode === 'last'`, 'targeting cycled to last');
  ok(true, `[${L}] targeting button cycles first -> last`);
  await page.key('t', 'KeyT', 't');
  await page.waitFor(`Palisade.ui.getGame().towers[0].mode === 'nearest'`, 'targeting cycled to nearest');
  ok(true, `[${L}] T key cycles last -> nearest`);

  // --- upgrade ------------------------------------------------------------
  await page.clickSel('#insp-upgrade');
  await page.waitFor(`Palisade.ui.getGame().towers[0].level === 1`, 'tower upgraded');
  ok(await page.eval(`Palisade.ui.getGame().gold`) === 30, `[${L}] upgrade (70g) leaves 30 gold`);

  // --- sell ---------------------------------------------------------------
  await page.clickSel('#insp-sell');
  await page.waitFor(`Palisade.ui.getGame().towers.length === 0`, 'tower sold');
  ok(await page.eval(`Palisade.ui.getGame().gold`) === 114, `[${L}] sell refunds 70% of 120g invested (30 + 84 = 114 gold)`);
  // The HUD re-renders on the next animation frame, so poll for it.
  await page.waitFor(`document.getElementById('inspector').classList.contains('hidden')`, 'inspector hides after sell');
  ok(true, `[${L}] inspector hides after selling`);

  // --- wave start + early call -------------------------------------------
  await page.eval(`Palisade.ui.getGame().intermission = 10`);
  const goldBefore = await page.eval(`Palisade.ui.getGame().gold`);
  await page.clickSel('#call-wave');
  await page.waitFor(`Palisade.ui.getGame().phase === 'wave'`, 'wave started');
  ok(true, `[${L}] call-wave button starts the wave early`);
  ok(await page.eval(`Palisade.ui.getGame().gold`) > goldBefore, `[${L}] early call pays a gold bonus`);
  await page.waitFor(`document.getElementById('call-wave').disabled`, 'call-wave disabled during wave');
  ok(true, `[${L}] call-wave disabled during a wave`);

  // --- fast forward -------------------------------------------------------
  await page.key('f', 'KeyF', 'f');
  await page.waitFor(`Palisade.ui.getState().speedMul === 2`, 'fast forward on');
  ok((await page.eval(`document.getElementById('btn-speed').textContent`)).includes('2×'), `[${L}] F toggles fast-forward (button shows 2x)`);

  // --- pause + blur pause -------------------------------------------------
  await page.key('p', 'KeyP', 'p');
  await page.waitFor(`Palisade.ui.getState().paused === true && !document.getElementById('ov-pause').classList.contains('hidden')`, 'paused');
  ok(true, `[${L}] P pauses and shows the pause overlay`);
  await page.clickSel('#resume');
  await page.waitFor(`Palisade.ui.getState().paused === false`, 'resumed');
  ok(true, `[${L}] resume button unpauses`);

  await page.eval(`window.dispatchEvent(new Event('blur'))`);
  await page.waitFor(`Palisade.ui.getState().paused === true && Palisade.ui.getState().pausedByBlur === true`, 'blur pause');
  ok(true, `[${L}] window blur auto-pauses`);
  await page.eval(`window.dispatchEvent(new Event('focus'))`);
  await page.waitFor(`Palisade.ui.getState().paused === false`, 'focus resume');
  ok(true, `[${L}] window focus resumes a blur-pause`);

  // --- loss flow ----------------------------------------------------------
  await page.waitFor(`Palisade.ui.getGame().creeps.length > 0`, 'creeps spawned', 30000);
  await page.eval(`(() => {
    const g = Palisade.ui.getGame();
    g.lives = 1;
    g.creeps[0].s = g.map.paths[0].total - 0.5; // about to leak
  })()`);
  await page.waitFor(`!document.getElementById('ov-end').classList.contains('hidden')`, 'end overlay after loss');
  ok(await page.eval(`document.getElementById('end-title').textContent`) === 'THE PALISADE FELL', `[${L}] losing all lives shows the loss screen`);

  // --- restart, then win flow --------------------------------------------
  await page.clickSel('#end-restart');
  await page.waitFor(`document.getElementById('overlay').classList.contains('hidden') && Palisade.ui.getGame().lives === 20`, 'restarted');
  ok(true, `[${L}] restart button starts the map fresh (20 lives)`);

  await page.eval(`(() => {
    const g = Palisade.ui.getGame();
    g.phase = 'wave';
    g.waveIdx = g.totalWaves - 1; // clearing this empty wave wins the game
    g.spawnQueue = [];
    g.creeps = [];
    g.projectiles = [];
  })()`);
  await page.waitFor(`!document.getElementById('ov-end').classList.contains('hidden') && document.getElementById('end-title').textContent === 'THE PALISADE HELD'`, 'win screen');
  ok(true, `[${L}] clearing the final wave shows the win screen`);
  ok((await page.eval(`document.getElementById('end-score').textContent`)).includes('new best'), `[${L}] a higher score is flagged as new best`);

  // --- best persistence ---------------------------------------------------
  ok(await page.eval(`parseInt(localStorage.getItem('arcade.palisade.best.0') || '0', 10)`) > 0, `[${L}] best score persisted to arcade.palisade.best.0`);
  await page.clickSel('#end-menu');
  await page.waitFor(`document.querySelectorAll('#map-cards .map-card').length === 3`, 'back on map select');
  ok((await page.eval(`document.querySelector('#map-cards .map-card em').textContent`)).startsWith('best'), `[${L}] map card shows the persisted best score`);

  // --- audio toggle -------------------------------------------------------
  await page.clickSel('#btn-audio');
  await page.waitFor(`document.getElementById('btn-audio').textContent === '♪ off'`, 'audio off');
  ok(await page.eval(`localStorage.getItem('arcade.palisade.audio')`) === 'off', `[${L}] audio toggle off persists to arcade.palisade.audio`);
  await page.clickSel('#btn-audio');
  await page.waitFor(`document.getElementById('btn-audio').textContent === '♪ on'`, 'audio on');
  ok(await page.eval(`localStorage.getItem('arcade.palisade.audio')`) === 'on', `[${L}] audio toggle back on persists`);

  // --- console cleanliness --------------------------------------------------
  const errs = page.nonFaviconErrors();
  ok(errs.length === 0, `[${L}] zero non-favicon console errors/exceptions${errs.length ? ' -- got: ' + errs.join(' | ') : ''}`);
}

// ---------------------------------------------------------------- main

async function main() {
  const watchdog = setTimeout(() => { console.error('FATAL: global 240s timeout'); process.exit(1); }, 240000);
  watchdog.unref?.();

  const { server, port } = await startServer(REPO_ROOT);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'palisade-chrome-'));
  let chrome, cdp;
  try {
    const launched = await launchChrome(userDataDir);
    chrome = launched.proc;
    cdp = await CDP.connect(launched.wsUrl);

    const httpUrl = `http://127.0.0.1:${port}/games/palisade/index.html`;
    const fileUrl = pathToFileURL(path.join(REPO_ROOT, 'games', 'palisade', 'index.html')).href;

    for (const [label, url] of [['http', httpUrl], ['file', fileUrl]]) {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      const page = new Page(cdp, sessionId, label);
      await page.enable();
      await runSuite(page, url);
      await cdp.send('Target.closeTarget', { targetId });
    }
  } finally {
    try { cdp?.close(); } catch { /* ignore */ }
    try { chrome?.kill('SIGKILL'); } catch { /* ignore */ }
    server.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  if (failures > 0) {
    console.error(`\nbrowser.test.mjs: ${failures} assertion(s) FAILED`);
    process.exit(1);
  }
  console.log('\nbrowser.test.mjs: all assertions passed (http + file)');
  process.exit(0);
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
