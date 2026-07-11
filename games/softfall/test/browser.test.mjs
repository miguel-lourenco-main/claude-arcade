// Headless-Chrome feature tests for Softfall. Run with: node test/browser.test.mjs
//
// Self-contained: spawns its own static http server AND also loads the game via
// file://, drives Chrome (/usr/bin/google-chrome) over raw CDP websockets (no
// npm deps), asserts zero non-favicon console errors / page exceptions on both
// origins, and exercises every user-facing feature in the README: menu +
// Start button (and keyboard start on file://), rotation (arrows + A/D),
// thrust (Space/W/ArrowUp) with fuel burn, pause (P + Esc + window blur),
// sound toggle (M + button, persisted), a real safe landing with scoring and
// decaying refuel, fresh terrain on the next round, a crash -> game over with
// cause, R restart, and high-score persistence across a reload.

import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAME_DIR = path.resolve(__dirname, '..');
const CHROME_BIN = '/usr/bin/google-chrome';

let passed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; console.log(`  ok - ${name}`); }
  else { failures.push(name); console.error(`  FAIL - ${name}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------- static http server

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let file = path.normalize(path.join(GAME_DIR, urlPath));
      if (!file.startsWith(GAME_DIR)) { res.writeHead(403); res.end(); return; }
      if (urlPath === '/' || urlPath === '') file = path.join(GAME_DIR, 'index.html');
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// ------------------------------------------------------------------ CDP client

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.data || ''})`));
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
      ws.addEventListener('error', (e) => reject(new Error(`websocket error: ${e.message || e}`)));
    });
  }

  send(method, params = {}, sessionId = undefined) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 20000);
    });
  }

  on(fn) { this.listeners.push(fn); }
}

// -------------------------------------------------------------- chrome control

function launchChrome(userDataDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn(CHROME_BIN, [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--hide-scrollbars',
      '--mute-audio',
      '--autoplay-policy=no-user-gesture-required',
      'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let buf = '';
    const onData = (d) => {
      buf += d.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) {
        proc.stderr.off('data', onData);
        resolve({ proc, wsUrl: m[1] });
      }
    };
    proc.stderr.on('data', onData);
    proc.on('exit', (code) => reject(new Error(`chrome exited early (code ${code})`)));
    setTimeout(() => reject(new Error('chrome did not report DevTools endpoint')), 15000);
  });
}

// ------------------------------------------------------------------ page driver

const KEYS = {
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  Space: { key: ' ', code: 'Space', keyCode: 32 },
  KeyW: { key: 'w', code: 'KeyW', keyCode: 87 },
  KeyA: { key: 'a', code: 'KeyA', keyCode: 65 },
  KeyD: { key: 'd', code: 'KeyD', keyCode: 68 },
  KeyP: { key: 'p', code: 'KeyP', keyCode: 80 },
  KeyM: { key: 'm', code: 'KeyM', keyCode: 77 },
  KeyR: { key: 'r', code: 'KeyR', keyCode: 82 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
};

class Page {
  constructor(cdp, sessionId) {
    this.cdp = cdp;
    this.sessionId = sessionId;
  }

  send(method, params) { return this.cdp.send(method, params, this.sessionId); }

  async navigate(url) {
    const loaded = new Promise((resolve) => {
      const fn = (msg) => {
        if (msg.sessionId === this.sessionId && msg.method === 'Page.loadEventFired') {
          this.cdp.listeners.splice(this.cdp.listeners.indexOf(fn), 1);
          resolve();
        }
      };
      this.cdp.on(fn);
    });
    await this.send('Page.navigate', { url });
    await loaded;
    await this.waitFor(`typeof window.__softfall === 'object'`, 'game booted');
  }

  /** Evaluate an expression; returns its JSON value. Throws on page exception. */
  async eval(expression) {
    const res = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) {
      const d = res.exceptionDetails;
      throw new Error(`page eval failed: ${d.exception?.description || d.text}`);
    }
    return res.result.value;
  }

  async waitFor(expression, what, timeoutMs = 6000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (await this.eval(expression)) return true;
      await sleep(40);
    }
    throw new Error(`timeout waiting for ${what}: ${expression}`);
  }

  async keyDown(name) {
    const k = KEYS[name];
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown', key: k.key, code: k.code,
      windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode,
      text: k.key.length === 1 ? k.key : undefined,
    });
  }

  async keyUp(name) {
    const k = KEYS[name];
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp', key: k.key, code: k.code,
      windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode,
    });
  }

  async tap(name) { await this.keyDown(name); await sleep(30); await this.keyUp(name); await sleep(30); }

  async hold(name, ms) { await this.keyDown(name); await sleep(ms); await this.keyUp(name); await sleep(30); }

  /** Real mouse click on an element's center. */
  async click(id) {
    const box = await this.eval(`(() => {
      const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', {
        type, x: box.x, y: box.y, button: 'left', clickCount: 1,
      });
    }
    await sleep(50);
  }
}

async function openPage(cdp, errors, label) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const page = new Page(cdp, sessionId);
  cdp.on((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push(`[${label}] exception: ${d.exception?.description || d.text}`);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
      if (!/favicon/i.test(text)) errors.push(`[${label}] console.error: ${text}`);
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      const text = `${msg.params.entry.text} ${msg.params.entry.url || ''}`;
      if (!/favicon/i.test(text)) errors.push(`[${label}] log: ${text}`);
    }
  });
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Log.enable');
  return page;
}

// ------------------------------------------------------------------- the suite

const SF = 'window.__softfall';

/** Park the ship high above the terrain so input tests can't accidentally
    end the run; the sim keeps ticking with real physics underneath. */
async function park(page) {
  await page.eval(`(() => {
    const s = ${SF}.ship;
    s.x = 600; s.y = -100; s.vx = 0; s.vy = 0; s.angle = 0;
    s.px = s.x; s.py = s.y; s.pangle = 0;
  })()`);
}

async function runSuite(page, url, label, { startViaKeyboard }) {
  console.log(`\n== ${label}: ${url}`);
  await page.navigate(url);
  // clean slate: this origin may hold state from an earlier manual run
  await page.eval('localStorage.clear()');
  await page.navigate(url);

  // --- boot / menu ---
  assert(await page.eval(`typeof window.SoftfallLogic === 'object'`),
    `${label}: logic script loaded (SoftfallLogic present)`);
  assert(await page.eval(`${SF}.state`) === 'menu',
    `${label}: boots into the menu`);
  assert(!(await page.eval(`document.getElementById('overlay').classList.contains('hidden')`)),
    `${label}: start overlay visible on boot`);
  assert(await page.eval(`document.getElementById('audio-toggle').textContent`) === 'Sound: on',
    `${label}: sound defaults to on`);
  assert(await page.eval(`document.getElementById('best').textContent`) === '',
    `${label}: no best-score label before any run`);

  // --- terrain invariants (via the debug handle) ---
  const terrain = await page.eval(`(() => {
    const g = ${SF};
    return g.pads.map(p => ({
      x0: p.x0, x1: p.x1, y: p.y, mult: p.mult,
      flat: Math.abs(g.terrainY((p.x0 + p.x1) / 2) - p.y) < 1e-9 &&
            Math.abs(g.terrainY(p.x0) - p.y) < 1e-9,
    }));
  })()`);
  assert(terrain.length === 4, `${label}: terrain carves four pads`);
  assert(terrain.every(p => p.flat), `${label}: every pad is flat at its labeled height`);
  assert(terrain.every(p => p.mult >= 1 && p.mult <= 5), `${label}: pad multipliers in x1..x5`);
  assert(terrain.some(p => p.mult <= 2), `${label}: at least one easy wide pad`);

  // --- start the run (mouse on http, thrust-key start on file) ---
  if (startViaKeyboard) {
    await page.tap('ArrowUp');
  } else {
    await page.click('start');
  }
  await page.waitFor(`${SF}.state === 'playing'`, 'run started');
  assert(true, `${label}: ${startViaKeyboard ? 'thrust key' : 'Start button click'} begins the run`);
  assert(await page.eval(`document.getElementById('overlay').classList.contains('hidden')`),
    `${label}: overlay hides when the run starts`);

  // --- rotation: arrows and A/D ---
  await park(page);
  let a0 = await page.eval(`${SF}.ship.angle`);
  await page.hold('ArrowLeft', 200);
  let a1 = await page.eval(`${SF}.ship.angle`);
  assert(a1 < a0, `${label}: ArrowLeft rotates counter-clockwise`);
  await page.hold('ArrowRight', 200);
  let a2 = await page.eval(`${SF}.ship.angle`);
  assert(a2 > a1, `${label}: ArrowRight rotates clockwise`);
  await page.hold('KeyA', 150);
  let a3 = await page.eval(`${SF}.ship.angle`);
  assert(a3 < a2, `${label}: A rotates counter-clockwise`);
  await page.hold('KeyD', 150);
  assert(await page.eval(`${SF}.ship.angle`) > a3, `${label}: D rotates clockwise`);

  // --- thrust: Space / W / ArrowUp burn fuel and push along the nose ---
  await park(page);
  let fuel = await page.eval(`${SF}.ship.fuel`);
  let vy = await page.eval(`${SF}.ship.vy`);
  await page.keyDown('Space');
  await sleep(80);
  assert(await page.eval(`${SF}.keys.thrust`) === true, `${label}: Space engages thrust`);
  await sleep(220);
  await page.keyUp('Space');
  await sleep(30);
  const afterThrust = await page.eval(`({ fuel: ${SF}.ship.fuel, vy: ${SF}.ship.vy })`);
  assert(afterThrust.fuel < fuel, `${label}: thrusting burns fuel`);
  assert(afterThrust.vy < vy, `${label}: upright thrust pushes the ship upward (vy drops)`);
  fuel = afterThrust.fuel;
  await page.hold('KeyW', 120);
  const fuelW = await page.eval(`${SF}.ship.fuel`);
  assert(fuelW < fuel, `${label}: W also thrusts`);
  await park(page);
  await page.hold('ArrowUp', 120);
  assert(await page.eval(`${SF}.ship.fuel`) < fuelW, `${label}: ArrowUp also thrusts`);

  // --- pause: P, Esc, and window blur ---
  await park(page);
  await page.tap('KeyP');
  assert(await page.eval(`${SF}.state`) === 'paused', `${label}: P pauses`);
  const frozen = await page.eval(`({ x: ${SF}.ship.x, y: ${SF}.ship.y, vy: ${SF}.ship.vy })`);
  await sleep(250);
  const still = await page.eval(`({ x: ${SF}.ship.x, y: ${SF}.ship.y, vy: ${SF}.ship.vy })`);
  assert(frozen.x === still.x && frozen.y === still.y && frozen.vy === still.vy,
    `${label}: simulation is frozen while paused`);
  await page.tap('KeyP');
  assert(await page.eval(`${SF}.state`) === 'playing', `${label}: P resumes`);
  await page.tap('Escape');
  assert(await page.eval(`${SF}.state`) === 'paused', `${label}: Esc pauses too`);
  await page.tap('KeyP');
  await page.eval(`window.dispatchEvent(new Event('blur'))`);
  assert(await page.eval(`${SF}.state`) === 'paused', `${label}: window blur auto-pauses`);
  await page.tap('KeyP');
  assert(await page.eval(`${SF}.state`) === 'playing', `${label}: resumed after blur pause`);

  // --- sound toggle: M key persists, button label follows ---
  await page.tap('KeyM');
  assert(await page.eval(`localStorage.getItem('arcade.softfall.audio')`) === '0',
    `${label}: M turns sound off and persists it`);
  assert(await page.eval(`document.getElementById('audio-toggle').textContent`) === 'Sound: off',
    `${label}: audio button label tracks the toggle`);
  await page.tap('KeyM');
  assert(await page.eval(`localStorage.getItem('arcade.softfall.audio')`) === '1',
    `${label}: M turns sound back on`);

  // --- a real safe landing: gentle drop onto the widest pad ---
  const padsBefore = await page.eval(`JSON.stringify(${SF}.pads)`);
  const drop = await page.eval(`(() => {
    const g = ${SF};
    const pad = g.pads.reduce((a, b) => (b.x1 - b.x0 > a.x1 - a.x0 ? b : a));
    const s = g.ship;
    s.x = (pad.x0 + pad.x1) / 2;
    s.y = pad.y - 12 - 8;           // FOOT_Y=12, 8u of free fall keeps vy safe
    s.vx = 0; s.vy = 0; s.angle = 0; s.fuel = 40;
    s.px = s.x; s.py = s.y; s.pangle = 0;
    return { mult: pad.mult };
  })()`);
  await page.waitFor(`${SF}.state === 'landed'`, 'touchdown');
  assert(true, `${label}: gentle upright drop on a pad is a safe landing`);
  const landed = await page.eval(
    `({ score: ${SF}.score, landings: ${SF}.landings, fuel: ${SF}.ship.fuel })`);
  assert(landed.landings === 1, `${label}: landing counter increments`);
  assert(landed.score === drop.mult * (100 + 40),
    `${label}: score = mult x (100 + fuel remaining) (got ${landed.score})`);
  assert(landed.fuel === 100, `${label}: first touchdown refuels +65 (40 -> 100, capped)`);

  // --- touchdown continues the run on fresh terrain ---
  await page.waitFor(`${SF}.state === 'playing'`, 'next round', 4000);
  assert(true, `${label}: run continues after the touchdown pause`);
  assert(await page.eval(`JSON.stringify(${SF}.pads)`) !== padsBefore,
    `${label}: next round generates fresh terrain`);
  assert(await page.eval(`${SF}.score`) === landed.score,
    `${label}: score carries across rounds`);

  // --- crash: slam into the ground, then game over with a cause ---
  await page.eval(`(() => {
    const g = ${SF}, s = g.ship;
    s.x = 600; s.y = g.terrainY(600) - 40; s.vx = 0; s.vy = 200; s.angle = 0;
    s.px = s.x; s.py = s.y; s.pangle = 0;
  })()`);
  await page.waitFor(`${SF}.state === 'crashed'`, 'crash');
  assert(true, `${label}: coming in too hard is a crash`);
  assert((await page.eval(`${SF}.cause`)).length > 0, `${label}: crash reports a cause`);
  await page.waitFor(`${SF}.state === 'gameover'`, 'game over', 4000);
  assert(true, `${label}: crash ends in the game-over screen`);
  const finalScore = landed.score;
  assert(await page.eval(`localStorage.getItem('arcade.softfall.high')`) === String(finalScore),
    `${label}: high score persisted to localStorage on the run's end`);

  // --- R restarts instantly ---
  await page.tap('KeyR');
  assert(await page.eval(`${SF}.state`) === 'playing', `${label}: R restarts from game over`);
  assert(await page.eval(`${SF}.score`) === 0, `${label}: restart zeroes the score`);
  assert(await page.eval(`${SF}.landings`) === 0, `${label}: restart zeroes the landings`);
  await park(page);
  await page.tap('KeyR');
  assert(await page.eval(`${SF}.state`) === 'playing' && await page.eval(`${SF}.score`) === 0,
    `${label}: R also restarts mid-run`);

  // --- high score survives a reload ---
  await page.navigate(url);
  assert(await page.eval(`${SF}.state`) === 'menu', `${label}: reload returns to the menu`);
  assert(await page.eval(`${SF}.high`) === finalScore,
    `${label}: high score restored from localStorage after reload`);
  const bestText = await page.eval(`document.getElementById('best').textContent`);
  assert(bestText === 'best ' + String(finalScore).padStart(5, '0'),
    `${label}: menu shows the persisted best (got "${bestText}")`);
  assert(await page.eval(`localStorage.getItem('arcade.softfall.audio')`) === '1',
    `${label}: audio preference persisted across reload`);
}

// ------------------------------------------------------------------------ main

const server = await startServer();
const port = server.address().port;
const httpUrl = `http://127.0.0.1:${port}/index.html`;
const fileUrl = pathToFileURL(path.join(GAME_DIR, 'index.html')).href;

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'softfall-cdp-'));
const { proc, wsUrl } = await launchChrome(userDataDir);

const errors = [];
try {
  const cdp = await CDP.connect(wsUrl);

  const pageHttp = await openPage(cdp, errors, 'http');
  await runSuite(pageHttp, httpUrl, 'http', { startViaKeyboard: false });

  const pageFile = await openPage(cdp, errors, 'file');
  await runSuite(pageFile, fileUrl, 'file', { startViaKeyboard: true });

  assert(errors.length === 0,
    `zero non-favicon console errors / exceptions on both origins${errors.length ? `:\n    ${errors.join('\n    ')}` : ''}`);
} finally {
  proc.kill('SIGKILL');
  server.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}

console.log(`\nbrowser.test.mjs: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('failures:\n  ' + failures.join('\n  '));
  process.exit(1);
}
process.exit(0);
