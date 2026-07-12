// Slipstream — headless-Chrome feature test (no npm deps; node >= 22).
// Run: node games/slipstream/test/browser.test.mjs
//
// Spawns its own static http server AND loads the game via file://,
// asserting on BOTH that the page boots with zero non-favicon console
// errors/exceptions and that every user-facing README feature works:
// attract boot, countdown + drive, steering, off-road slowdown, traffic,
// checkpoint banner + time credit, pause on blur (+P resume), time-up
// game over + instant restart, high score persistence, audio toggle
// (button + M key), Esc back to title.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = process.env.CHROME_BIN || '/usr/bin/google-chrome';
const GAME_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(GAME_DIR, '..', '..');

let failures = 0;
function ok(cond, name, extra = '') {
  if (cond) console.log(`  ok   ${name}${extra ? `  (${extra})` : ''}`);
  else { console.error(`  FAIL ${name}${extra ? `  (${extra})` : ''}`); failures++; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- static server
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript' };
function startServer() {
  return new Promise((resolve) => {
    const srv = createServer(async (req, res) => {
      try {
        const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        const file = path.join(REPO_ROOT, rel === '/' ? 'index.html' : rel);
        if (!file.startsWith(REPO_ROOT)) throw new Error('traversal');
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(body);
      } catch {
        res.writeHead(404); res.end('not found');
      }
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

// ---------------------------------------------------------------- CDP plumbing
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.data || ''})`));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  on(fn) { this.listeners.push(fn); }
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => resolve(new CDP(ws)));
    ws.addEventListener('error', (e) => reject(new Error(`ws error: ${e.message || e}`)));
  });
}

function launchChrome(userDataDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn(CHROME, [
      '--headless=new', '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--mute-audio',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--window-size=900,700', 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    const onData = (d) => {
      err += d;
      const m = err.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { proc.stderr.off('data', onData); resolve({ proc, wsUrl: m[1] }); }
    };
    proc.stderr.on('data', onData);
    proc.on('exit', (code) => reject(new Error(`chrome exited early (${code}): ${err}`)));
    setTimeout(() => reject(new Error(`chrome did not start: ${err}`)), 15000);
  });
}

// ---------------------------------------------------------------- page harness
const VK = { Enter: 13, Space: 32, Escape: 27, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, KeyM: 77, KeyP: 80, KeyX: 88 };
const KEYNAME = { Enter: 'Enter', Space: ' ', Escape: 'Escape', ArrowLeft: 'ArrowLeft', ArrowUp: 'ArrowUp', ArrowRight: 'ArrowRight', ArrowDown: 'ArrowDown', KeyM: 'm', KeyP: 'p', KeyX: 'x' };

class Page {
  constructor(cdp, sessionId) {
    this.cdp = cdp;
    this.sessionId = sessionId;
    this.errors = [];
  }
  async eval(expression) {
    const r = await this.cdp.send('Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true }, this.sessionId);
    if (r.exceptionDetails) {
      throw new Error(`eval failed: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description || ''}\n${expression}`);
    }
    return r.result.value;
  }
  async keyDown(code) {
    await this.cdp.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown', code, key: KEYNAME[code] || code,
      windowsVirtualKeyCode: VK[code] || 0, nativeVirtualKeyCode: VK[code] || 0,
    }, this.sessionId);
  }
  async keyUp(code) {
    await this.cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp', code, key: KEYNAME[code] || code,
      windowsVirtualKeyCode: VK[code] || 0, nativeVirtualKeyCode: VK[code] || 0,
    }, this.sessionId);
  }
  async press(code) { await this.keyDown(code); await this.keyUp(code); }
  async poll(expression, { timeout = 8000, interval = 100, desc = expression } = {}) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await this.eval(expression)) return true;
      await sleep(interval);
    }
    throw new Error(`timed out waiting for: ${desc}`);
  }
}

async function openPage(cdp, url) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const page = new Page(cdp, sessionId);
  page.targetId = targetId;

  cdp.on((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      page.errors.push(`exception: ${d.text} ${d.exception?.description || d.url || ''}`);
    } else if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry;
      if (e.level === 'error') page.errors.push(`log: ${e.text} ${e.url || ''}`);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      page.errors.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    }
  });

  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Log.enable', {}, sessionId);

  const loaded = new Promise((resolve) => {
    cdp.on((msg) => {
      if (msg.sessionId === sessionId && msg.method === 'Page.loadEventFired') resolve();
    });
  });
  await cdp.send('Page.navigate', { url }, sessionId);
  await loaded;
  return page;
}

function nonFaviconErrors(page) {
  return page.errors.filter((e) => !/favicon/i.test(e));
}

// ---------------------------------------------------------------- feature suite
async function runSuite(cdp, url, label) {
  console.log(`\n=== ${label}: ${url}`);
  const p = await openPage(cdp, url);

  // --- boot: title / attract mode ---
  await p.poll(`window.Slipstream && Slipstream.debug && Slipstream.debug.mode === 'attract'`,
    { desc: 'attract mode boot' });
  ok(true, 'boots into attract mode');
  const title = await p.eval(`document.getElementById('overlay-title').textContent`);
  const overlayShown = await p.eval(`document.getElementById('overlay').classList.contains('show')`);
  ok(title === 'SLIPSTREAM' && overlayShown, 'title overlay visible', `title="${title}"`);
  await sleep(400);
  ok(await p.eval(`Slipstream.debug.sim.position > 0`), 'attract demo is driving (rAF loop alive)');

  // --- traffic present ---
  const nCars = await p.eval(`Slipstream.debug.sim.cars.length`);
  ok(nCars >= 20, 'traffic present on the course', `${nCars} cars`);

  // --- audio toggle: button click, then M key ---
  const t0 = await p.eval(`document.getElementById('audio-toggle').textContent`);
  await p.eval(`document.getElementById('audio-toggle').click()`);
  const t1 = await p.eval(`document.getElementById('audio-toggle').textContent`);
  const stored = await p.eval(`localStorage.getItem('arcade.slipstream.sound')`);
  ok(t0 === 'sound: on' && t1 === 'sound: off' && stored === 'off',
    'audio toggle button mutes + persists', `${t0} -> ${t1}, ls=${stored}`);
  await p.press('KeyM');
  const t2 = await p.eval(`document.getElementById('audio-toggle').textContent`);
  ok(t2 === 'sound: on', 'M key toggles sound back on', t2);

  // --- countdown + drive ---
  await p.press('Enter');
  ok(await p.eval(`Slipstream.debug.mode === 'countdown'`), 'Enter starts the countdown');
  ok(await p.eval(`!document.getElementById('overlay').classList.contains('show')`),
    'overlay hides for the race');
  // clear traffic so the drive/steer/off-road measurements are deterministic
  await p.eval(`Slipstream.debug.sim.cars.length = 0`);
  await p.poll(`Slipstream.debug.mode === 'race'`, { desc: 'countdown reaches GO' });
  ok(true, 'countdown ends and the race starts');

  const v0 = await p.eval(`Slipstream.debug.sim.speed`);
  await p.keyDown('ArrowUp');
  await sleep(1500);
  const v1 = await p.eval(`Slipstream.debug.sim.speed`);
  ok(v1 > v0 + 1000, 'holding accelerate raises speed', `${Math.round(v0)} -> ${Math.round(v1)}`);

  // --- steering moves player x ---
  const x0 = await p.eval(`Slipstream.debug.sim.playerX`);
  await p.keyDown('ArrowRight');
  await sleep(500);
  const x1 = await p.eval(`Slipstream.debug.sim.playerX`);
  ok(x1 > x0 + 0.1, 'steering right moves the car right', `${x0.toFixed(2)} -> ${x1.toFixed(2)}`);

  // --- off-road slowdown: keep steering right onto the shoulder ---
  await p.poll(`Slipstream.debug.sim.offRoad`, { desc: 'car leaves the road', timeout: 8000 });
  await p.keyUp('ArrowRight');
  await sleep(1200); // throttle still held: off-road drag must beat it
  const vOff = await p.eval(`Slipstream.debug.sim.speed`);
  const lim = await p.eval(`Slipstream.OFFROAD_LIMIT`);
  ok(vOff <= lim * 1.05, 'off-road drags speed down to the limit',
    `${Math.round(vOff)} <= ${Math.round(lim)}`);
  // steer back onto the road
  await p.keyDown('ArrowLeft');
  await p.poll(`Math.abs(Slipstream.debug.sim.playerX) < 0.4`, { desc: 'back on the road', timeout: 8000 });
  await p.keyUp('ArrowLeft');

  // --- checkpoint banner + time credit ---
  await p.eval(`
    (() => {
      const d = Slipstream.debug;
      window.__flashes = [];
      const orig = d.renderer.flash.bind(d.renderer);
      d.renderer.flash = (text, color, dur) => { window.__flashes.push(text); return orig(text, color, dur); };
      const st = d.sim.track.stages[1];
      d.sim.position = st.fromZ - Slipstream.PLAYER_Z - 1600;
    })()
  `);
  const tBefore = await p.eval(`Slipstream.debug.sim.timeLeft`);
  await p.poll(`Slipstream.debug.sim.stageIdx === 1`, { desc: 'checkpoint crossed', timeout: 10000 });
  const tAfter = await p.eval(`Slipstream.debug.sim.timeLeft`);
  const stTime = await p.eval(`Slipstream.debug.sim.track.stages[1].time`);
  ok(tAfter > tBefore && tAfter > tBefore + stTime - 6, 'checkpoint credits time',
    `${tBefore.toFixed(1)}s -> ${tAfter.toFixed(1)}s (+${stTime}s stage credit)`);
  const flashes = await p.eval(`window.__flashes.join('|')`);
  ok(/CHECKPOINT/.test(flashes) && /PINEGATE/.test(flashes),
    'checkpoint banner flashed on the canvas', flashes);

  // --- pause on blur + P resume ---
  await p.eval(`window.dispatchEvent(new Event('blur'))`);
  const paused = await p.eval(`Slipstream.debug.mode`);
  const pauseTitle = await p.eval(`document.getElementById('overlay-title').textContent`);
  ok(paused === 'paused' && pauseTitle === 'PAUSED', 'window blur pauses the race',
    `mode=${paused} overlay=${pauseTitle}`);
  await p.press('KeyP');
  ok(await p.eval(`Slipstream.debug.mode === 'race'`), 'P resumes from pause');

  // --- time-up game over + instant restart ---
  await p.eval(`Slipstream.debug.sim.timeLeft = 0.3`);
  await p.poll(`Slipstream.debug.mode === 'over'`, { desc: 'time-up game over', timeout: 5000 });
  ok(true, 'clock at zero ends the race');
  await p.poll(`document.getElementById('overlay-title').textContent === 'TIME UP'`,
    { desc: 'TIME UP overlay', timeout: 6000 });
  ok(true, 'TIME UP overlay appears');
  const bestLs = await p.eval(`Number(localStorage.getItem('arcade.slipstream.best'))`);
  ok(bestLs > 0, 'best score persisted to arcade.slipstream.best', `${bestLs}`);
  await p.press('KeyX');
  ok(await p.eval(`Slipstream.debug.mode === 'countdown'`), 'any key restarts instantly after game over');

  // --- Esc back to title ---
  await p.press('Escape');
  ok(await p.eval(`Slipstream.debug.mode === 'attract'`), 'Esc returns to the title');

  // --- high score persistence across a reload ---
  const reloaded = new Promise((resolve) => {
    cdp.on((msg) => {
      if (msg.sessionId === p.sessionId && msg.method === 'Page.loadEventFired') resolve();
    });
  });
  await cdp.send('Page.reload', {}, p.sessionId);
  await reloaded;
  await p.poll(`window.Slipstream && Slipstream.debug && Slipstream.debug.mode === 'attract'`,
    { desc: 'reload boots' });
  const bestShown = await p.eval(`document.getElementById('overlay-detail').textContent`);
  const padded = String(Math.floor(bestLs)).padStart(6, '0');
  ok(bestShown.includes(`best score ${padded}`), 'high score survives a reload and shows on the title',
    `"best score ${padded}" in overlay`);

  // --- zero non-favicon console errors ---
  const errs = nonFaviconErrors(p);
  ok(errs.length === 0, 'zero non-favicon console errors/exceptions',
    errs.length ? errs.join(' | ') : 'clean');

  await cdp.send('Target.closeTarget', { targetId: p.targetId });
}

// ---------------------------------------------------------------- main
const server = await startServer();
const port = server.address().port;
const httpUrl = `http://127.0.0.1:${port}/games/slipstream/index.html`;
const fileUrl = `file://${path.join(GAME_DIR, 'index.html')}`;

const userDataDir = await mkdtemp(path.join(tmpdir(), 'slipstream-chrome-'));
let chrome;
try {
  chrome = await launchChrome(userDataDir);
  const cdp = await connect(chrome.wsUrl);
  await runSuite(cdp, httpUrl, 'http');
  await runSuite(cdp, fileUrl, 'file');
} finally {
  chrome?.proc.kill('SIGKILL');
  server.close();
  await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
}

console.log(failures === 0 ? '\nall browser checks passed' : `\n${failures} BROWSER FAILURES`);
process.exit(failures === 0 ? 0 : 1);
