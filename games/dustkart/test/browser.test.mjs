// Dustkart — headless-Chrome feature test (no npm deps; node >= 22).
// Run: node games/dustkart/test/browser.test.mjs
//
// Spawns its own static http server AND loads the game via file://,
// asserting on BOTH that the page boots with zero non-favicon console
// errors/exceptions and that every user-facing README feature works:
// menu boot + circuit select (keys and click targets), sound toggle
// (button + M key, persisted), countdown + start boost window, driving,
// steering, off-road slowdown, drift charge tiers + release boost, item
// pads, firing items, slick spin-out + invulnerability, live position
// ranking, lap counting, race finish + results table + circuit-best
// persistence, instant restart, pause on blur (+P resume), Esc to menu.

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
const VK = { Enter: 13, Space: 32, Escape: 27, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, KeyM: 77, KeyP: 80, ShiftLeft: 16, Digit2: 50 };
const KEYNAME = { Enter: 'Enter', Space: ' ', Escape: 'Escape', ArrowLeft: 'ArrowLeft', ArrowUp: 'ArrowUp', ArrowRight: 'ArrowRight', ArrowDown: 'ArrowDown', KeyM: 'm', KeyP: 'p', ShiftLeft: 'Shift', Digit2: '2' };

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
  async poll(expression, { timeout = 9000, interval = 90, desc = expression } = {}) {
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
  const D = 'window.Dustkart && Dustkart.debug';

  // --- boot: circuit-select menu over a live demo race ---
  await p.poll(`${D} && Dustkart.debug.mode === 'menu'`, { desc: 'menu boot' });
  ok(true, 'boots into the circuit-select menu');
  const title = await p.eval(`document.getElementById('overlay-title').textContent`);
  const shown = await p.eval(`document.getElementById('overlay').classList.contains('show')`);
  const nCirc = await p.eval(`document.querySelectorAll('#circuit-list .circuit').length`);
  ok(title === 'DUSTKART' && shown && nCirc === 3, 'menu overlay lists 3 circuits', `title=${title} circuits=${nCirc}`);
  const prog0 = await p.eval(`Dustkart.debug.demoSim.karts[2].progress`);
  await sleep(450);
  const prog1 = await p.eval(`Dustkart.debug.demoSim.karts[2].progress`);
  ok(prog1 > prog0, 'attract demo race is running (rAF loop alive)', `${Math.round(prog0)} -> ${Math.round(prog1)}`);

  // --- canvas actually renders pixels ---
  const painted = await p.eval(`(() => {
    const g = document.getElementById('game').getContext('2d');
    const d = g.getImageData(0, 0, 640, 400).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 397 * 4) if (d[i] + d[i+1] + d[i+2] > 24) lit++;
    return lit;
  })()`);
  ok(painted > 50, 'canvas has rendered content', `${painted} sampled lit pixels`);

  // --- audio toggle: button click, then M key, persisted ---
  const t0 = await p.eval(`document.getElementById('audio-toggle').textContent`);
  await p.eval(`document.getElementById('audio-toggle').click()`);
  const t1 = await p.eval(`document.getElementById('audio-toggle').textContent`);
  const storedSnd = await p.eval(`localStorage.getItem('arcade.dustkart.sound')`);
  ok(t0 === 'sound: on' && t1 === 'sound: off' && storedSnd === 'off',
    'audio toggle button mutes + persists', `${t0} -> ${t1}, ls=${storedSnd}`);
  await p.press('KeyM');
  const t2 = await p.eval(`document.getElementById('audio-toggle').textContent`);
  ok(t2 === 'sound: on', 'M key toggles sound back on', t2);

  // --- circuit selection with arrows ---
  await p.press('ArrowDown');
  const sel1 = await p.eval(`Dustkart.debug.selected`);
  await p.press('ArrowUp');
  const sel0 = await p.eval(`Dustkart.debug.selected`);
  ok(sel1 === 1 && sel0 === 0, 'arrow keys move the circuit selection', `${sel1} then ${sel0}`);

  // --- start the race: countdown, then the launch-boost window ---
  await p.press('Enter');
  ok(await p.eval(`Dustkart.debug.mode === 'countdown'`), 'Enter starts the countdown');
  ok(await p.eval(`!document.getElementById('overlay').classList.contains('show')`), 'overlay hides for the race');
  ok(await p.eval(`Dustkart.debug.sim.circuit.key === 'sunspur'`), 'selected circuit loaded');
  // press accelerate inside the launch window, right before GO
  await p.poll(`Dustkart.debug.sim.countT <= 0.36 && Dustkart.debug.sim.countT > 0`, { interval: 20, desc: 'launch window opens' });
  await p.keyDown('ArrowUp');
  await p.poll(`Dustkart.debug.mode === 'race'`, { desc: 'GO' });
  const launchBoost = await p.eval(`Dustkart.debug.sim.karts[0].boostT`);
  ok(launchBoost > 0.2, 'accelerating in the window grants the start boost', `boostT=${launchBoost.toFixed(2)}`);

  // --- driving: throttle raises speed (ArrowUp still held) ---
  await p.poll(`Dustkart.debug.sim.karts[0].speed > Dustkart.MAX_SPEED * 0.5`, { desc: 'kart gets up to speed' });
  ok(true, 'holding accelerate raises speed');

  // --- steering moves the kart laterally ---
  const x0 = await p.eval(`Dustkart.debug.sim.karts[0].x`);
  await p.keyDown('ArrowRight');
  await sleep(450);
  const x1 = await p.eval(`Dustkart.debug.sim.karts[0].x`);
  ok(x1 > x0 + 0.1, 'steering right moves the kart right', `${x0.toFixed(2)} -> ${x1.toFixed(2)}`);

  // --- off-road heavy slowdown ---
  await p.poll(`Dustkart.debug.sim.karts[0].offRoad`, { desc: 'kart leaves the road' });
  await p.keyUp('ArrowRight');
  // throttle still held: off-road drag must beat it anyway
  await p.poll(
    `(Dustkart.debug.sim.karts[0].x = 1.6,` +
    ` Dustkart.debug.sim.karts[0].boostT = 0,` +
    ` Dustkart.debug.sim.karts[0].speed <= Dustkart.OFFROAD_LIMIT * 1.05)`,
    { desc: 'off-road slowdown to the crawl limit', timeout: 6000 });
  const vOff = await p.eval(`Dustkart.debug.sim.karts[0].speed`);
  const lim = await p.eval(`Dustkart.OFFROAD_LIMIT`);
  ok(vOff <= lim * 1.05, 'off-road drags speed to the crawl limit', `${Math.round(vOff)} <= ${Math.round(lim)}`);
  await p.eval(`Dustkart.debug.sim.karts[0].x = 0`);   // back on the road

  // --- drift: hold SHIFT while turning, charge two tiers, release = boost ---
  await p.eval(`Dustkart.debug.sim.karts[0].speed = Dustkart.MAX_SPEED * 0.85`);
  await p.keyDown('ShiftLeft');
  await p.keyDown('ArrowRight');
  await p.poll(`Dustkart.debug.sim.karts[0].drift.on`, { desc: 'drift starts', timeout: 3000 });
  ok(true, 'holding SHIFT while turning starts a drift');
  // keep the kart fed with speed + centered so the drift holds to tier 2
  await p.poll(
    `(Dustkart.debug.sim.karts[0].speed = Dustkart.MAX_SPEED * 0.85,` +
    ` Dustkart.debug.sim.karts[0].x = 0,` +
    ` Dustkart.debug.sim.karts[0].drift.tier >= 2)`,
    { interval: 60, desc: 'drift charge reaches tier 2' });
  ok(true, 'drift charge builds to tier 2');
  await p.keyUp('ShiftLeft');
  await sleep(120);
  const driftBoost = await p.eval(`Dustkart.debug.sim.karts[0].boostT`);
  ok(driftBoost > 0.6, 'releasing a tier-2 drift grants the big mini-boost', `boostT=${driftBoost.toFixed(2)}`);
  await p.keyUp('ArrowRight');
  await p.eval(`Dustkart.debug.sim.karts[0].x = 0`);

  // --- item pad pickup ---
  const gotItem = await p.eval(`(() => {
    const s = Dustkart.debug.sim;
    const pad = s.pads[0];
    pad.cd = 0;
    const k = s.karts[0];
    k.item = null;
    k.z = (pad.z - 260 + s.circuit.length) % s.circuit.length;
    k.x = pad.x;
    k.speed = Dustkart.MAX_SPEED * 0.8;
    return true;
  })()`);
  ok(gotItem, 'teleported onto a pad approach');
  await p.poll(`!!Dustkart.debug.sim.karts[0].item`, { desc: 'item granted from the pad', timeout: 4000 });
  const itemKind = await p.eval(`Dustkart.debug.sim.karts[0].item`);
  ok(true, 'driving over an item pad grants an item', itemKind);
  const padCd = await p.eval(`Dustkart.debug.sim.pads[0].cd`);
  ok(padCd > 2.5, 'pad goes on ~4s cooldown', `cd=${padCd.toFixed(1)}`);

  // --- fire an item with SPACE (force a slick for a deterministic effect) ---
  await p.eval(`Dustkart.debug.sim.karts[0].item = 'slick'`);
  const slicks0 = await p.eval(`Dustkart.debug.sim.slicks.length`);
  await p.press('Space');
  await p.poll(`Dustkart.debug.sim.slicks.length === ${slicks0 + 1}`, { desc: 'slick dropped', timeout: 3000 });
  ok(await p.eval(`Dustkart.debug.sim.karts[0].item === null`), 'SPACE fires and empties the item box');

  // --- spin-out from a slick + post-spin invulnerability ---
  await p.eval(`(() => {
    const s = Dustkart.debug.sim;
    const k = s.karts[0];
    k.invulnT = 0; k.shield = false; k.spinT = 0;
    k.speed = Dustkart.MAX_SPEED * 0.8;
    s.slicks.push({ z: (k.z + 500) % s.circuit.length, x: k.x, life: 10, armT: 0 });
  })()`);
  await p.poll(`Dustkart.debug.sim.karts[0].spinT > 0`, { desc: 'kart spins out on the slick', timeout: 4000 });
  ok(true, 'slick spins the kart out');
  await p.poll(`Dustkart.debug.sim.karts[0].spinT === 0 && Dustkart.debug.sim.karts[0].invulnT > 0`,
    { desc: 'post-spin invulnerability', timeout: 4000 });
  ok(true, 'spin ends with brief invulnerability');

  // --- live position ranking ---
  await p.eval(`Dustkart.debug.sim.karts[0].laps = 4`);
  await p.poll(`Dustkart.debug.sim.karts[0].rank === 1`, { desc: 'rank recomputes', timeout: 3000 });
  ok(true, 'progress-based ranking puts the lap leader 1st');

  // --- lap counting at the start/finish wrap ---
  await p.eval(`(() => {
    const s = Dustkart.debug.sim;
    const k = s.karts[0];
    k.laps = 0;
    k.z = s.circuit.length - 600;
    k.x = 0;
    k.speed = Dustkart.MAX_SPEED * 0.9;
  })()`);
  await p.poll(`Dustkart.debug.sim.karts[0].laps === 1`, { desc: 'lap counted at the line', timeout: 4000 });
  ok(true, 'crossing the start/finish counts the lap');

  // --- finish the race: results + circuit best persisted ---
  await p.eval(`(() => {
    const s = Dustkart.debug.sim;
    const k = s.karts[0];
    k.laps = Dustkart.LAPS - 1;
    k.z = s.circuit.length - 800;
    k.x = 0;
    k.speed = Dustkart.MAX_SPEED * 0.9;
    k.bestLap = 33.3;
    k.lapStartT = Math.max(0, s.time - 20);
  })()`);
  await p.poll(`Dustkart.debug.mode === 'finished'`, { desc: 'race finishes', timeout: 6000 });
  ok(true, 'taking the flag on lap 3 ends the race');
  await p.keyUp('ArrowUp');
  await p.poll(`document.getElementById('overlay').classList.contains('show') && document.querySelectorAll('#results tr').length === 7`,
    { desc: 'results table', timeout: 6000 });
  const meRow = await p.eval(`document.querySelector('#results tr.me td:nth-child(2)').textContent`);
  ok(meRow.includes('Pip') && meRow.includes('you'), 'results table shows all 6 karts with the player marked', meRow);
  const best = await p.eval(`Number(localStorage.getItem('arcade.dustkart.best.sunspur'))`);
  ok(best > 0 && best <= 33.3, 'circuit-best lap persisted to arcade.dustkart.best.sunspur', `${best}`);

  // --- instant restart from the results screen ---
  await p.press('Enter');
  ok(await p.eval(`Dustkart.debug.mode === 'countdown'`), 'Enter on the results screen restarts instantly');

  // --- Esc back to the circuit select, which now shows the best lap ---
  await p.press('Escape');
  ok(await p.eval(`Dustkart.debug.mode === 'menu'`), 'Esc returns to the circuit select');
  const menuTxt = await p.eval(`document.getElementById('overlay-detail').textContent`);
  ok(/best lap \d/.test(menuTxt), 'menu shows the persisted circuit best', menuTxt.match(/best lap [\d:.]+/)?.[0]);

  // --- direct circuit pick with a number key ---
  await p.press('Digit2');
  await p.poll(`Dustkart.debug.mode === 'countdown' && Dustkart.debug.sim.circuit.key === 'bramble'`,
    { desc: 'circuit 2 race', timeout: 3000 });
  ok(true, 'number key picks a circuit and starts the race');

  // --- pause on blur + P resume ---
  await p.eval(`window.dispatchEvent(new Event('blur'))`);
  const paused = await p.eval(`Dustkart.debug.mode`);
  const pauseTitle = await p.eval(`document.getElementById('overlay-title').textContent`);
  ok(paused === 'paused' && pauseTitle === 'PAUSED', 'window blur pauses the race', `mode=${paused}`);
  await p.press('KeyP');
  const resumed = await p.eval(`Dustkart.debug.mode`);
  ok(resumed === 'countdown' || resumed === 'race', 'P resumes from pause', resumed);
  await p.press('Escape');

  // --- sound preference survives a reload ---
  await p.press('KeyM'); // off
  const reloaded = new Promise((resolve) => {
    cdp.on((msg) => {
      if (msg.sessionId === p.sessionId && msg.method === 'Page.loadEventFired') resolve();
    });
  });
  await cdp.send('Page.reload', {}, p.sessionId);
  await reloaded;
  await p.poll(`${D} && Dustkart.debug.mode === 'menu'`, { desc: 'reload boots' });
  const sndAfter = await p.eval(`document.getElementById('audio-toggle').textContent`);
  const bestAfter = await p.eval(`Number(localStorage.getItem('arcade.dustkart.best.sunspur'))`);
  ok(sndAfter === 'sound: off' && bestAfter > 0, 'sound + best lap survive a reload', `${sndAfter}, best=${bestAfter}`);
  await p.press('KeyM'); // back on for the next suite

  // --- zero non-favicon console errors ---
  const errs = nonFaviconErrors(p);
  ok(errs.length === 0, 'zero non-favicon console errors/exceptions',
    errs.length ? errs.join(' | ') : 'clean');

  await cdp.send('Target.closeTarget', { targetId: p.targetId });
}

// ---------------------------------------------------------------- main
const server = await startServer();
const port = server.address().port;
const httpUrl = `http://127.0.0.1:${port}/games/dustkart/index.html`;
const fileUrl = `file://${path.join(GAME_DIR, 'index.html')}`;

const userDataDir = await mkdtemp(path.join(tmpdir(), 'dustkart-chrome-'));
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
