// Headless-Chrome end-to-end test for Bulwark.
//   node games/bulwark/test/browser.test.mjs
//
// Spawns its own static http server, launches headless Chrome
// (/usr/bin/google-chrome by default, override with CHROME_BIN), talks raw
// CDP over websockets (no npm deps), and runs the full user-facing feature
// suite twice: once over http://, once over file:// (the arcade's real
// double-click path). Asserts zero non-favicon console errors on both.

import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAME_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(GAME_DIR, '..', '..');
const CHROME = process.env.CHROME_BIN || '/usr/bin/google-chrome';
const SAUCER_SCORES = [50, 100, 150, 300];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log('ok - ' + name);
  } else {
    failures++;
    console.error('FAIL - ' + name + (detail !== undefined ? ' :: ' + detail : ''));
  }
}

// ------------------------------------------------------------- http server

function startServer() {
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript' };
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const fp = path.normalize(path.join(REPO_ROOT, urlPath === '/' ? 'index.html' : urlPath));
    if (!fp.startsWith(REPO_ROOT) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(fp)] || 'application/octet-stream' });
    res.end(fs.readFileSync(fp));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// ----------------------------------------------------------- chrome + CDP

async function launchChrome() {
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'bulwark-cdp-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${udd}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--no-sandbox', '--disable-dev-shm-usage', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d; });

  const portFile = path.join(udd, 'DevToolsActivePort');
  for (let i = 0; i < 100; i++) {
    if (fs.existsSync(portFile)) {
      const port = parseInt(fs.readFileSync(portFile, 'utf8').split('\n')[0], 10);
      if (port) return { proc, udd, port };
    }
    if (proc.exitCode !== null) break;
    await sleep(100);
  }
  throw new Error('chrome did not expose a DevTools port. stderr:\n' + stderr.slice(0, 2000));
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg);
      }
    };
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws connect failed')); });
    return new CDP(ws);
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(fn) { this.listeners.push(fn); }
  close() { try { this.ws.close(); } catch { /* already closed */ } }
}

async function evalIn(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    throw new Error('eval threw: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  }
  return r.result.value;
}

async function waitFor(cdp, expression, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { if (await evalIn(cdp, expression)) return; } catch { /* page still loading */ }
    await sleep(100);
  }
  throw new Error('timeout waiting for: ' + expression);
}

async function keyDown(cdp, key, code, text) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, ...(text ? { text } : {}) });
}
async function keyUp(cdp, key, code) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code });
}
async function keyTap(cdp, key, code, text) {
  await keyDown(cdp, key, code, text);
  await keyUp(cdp, key, code);
}

// ------------------------------------------------------------ feature suite

async function runSuite(label, url, browserPort) {
  const t = '[' + label + '] ';

  const created = await (await fetch(
    `http://127.0.0.1:${browserPort}/json/new?${encodeURIComponent('about:blank')}`,
    { method: 'PUT' })).json();
  const cdp = await CDP.connect(created.webSocketDebuggerUrl);

  const errors = [];
  cdp.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push('exception: ' + (d.exception?.description || d.text));
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push('console.error: ' + msg.params.args.map((a) => a.description || a.value).join(' '));
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      const e = msg.params.entry;
      if (!/favicon/i.test((e.url || '') + ' ' + (e.text || ''))) errors.push('log: ' + e.text);
    }
  });

  try {
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.enable');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__BULWARK_TEST = true;' });
    await cdp.send('Page.navigate', { url });
    await waitFor(cdp, '!!window.__bulwark');

    const ev = (expr) => evalIn(cdp, expr);

    // --- load + attract ---------------------------------------------------
    check(t + 'game loads to the attract screen',
      await ev(`__bulwark.snap().state === 'attract' && document.getElementById('overlay').classList.contains('show')`));

    // halt real-time logic; every subsequent step is driven via tick()
    await ev('__bulwark.freeze(true), true');

    // --- start ------------------------------------------------------------
    await keyTap(cdp, ' ', 'Space', ' ');
    check(t + 'SPACE starts a fresh game (playing, 0 pts, 3 lives, wave 1, 55 invaders, overlay hidden)',
      await ev(`(() => { const s = __bulwark.snap();
        return s.state === 'playing' && s.score === 0 && s.lives === 3 && s.wave === 1 &&
               s.alive === 55 && !document.getElementById('overlay').classList.contains('show'); })()`));

    // safety: if a stray blur auto-paused us, resume
    if (await ev('__bulwark.snap().paused')) await keyTap(cdp, 'p', 'KeyP', 'p');

    // --- fleet march + drop/reverse ----------------------------------------
    const march = await ev(`(() => {
      const bw = __bulwark;
      const s = bw.snap();
      const inv = s.invaders.find(i => i.alive);
      const dir0 = s.fleetDir, x0 = inv.x, y0 = inv.y;
      bw.tick(s.alive); // one full pass: every invader steps once
      const stepped = inv.x === x0 + 8 * dir0;
      let guard = 0;
      while (inv.y === y0 && guard < 40) { bw.tick(bw.snap().alive); bw.snap().bombs.length = 0; guard++; }
      return { stepped, dropped: inv.y === y0 + 16, reversed: bw.snap().fleetDir === -dir0 };
    })()`);
    check(t + 'fleet marches as one block (one step per pass)', march.stepped, JSON.stringify(march));
    check(t + 'fleet drops one row at the margin', march.dropped, JSON.stringify(march));
    check(t + 'fleet reverses direction on the drop', march.reversed, JSON.stringify(march));

    // --- pause -------------------------------------------------------------
    await keyTap(cdp, 'p', 'KeyP', 'p');
    check(t + 'P pauses: overlay says PAUSED and the world freezes',
      await ev(`(() => { const s = __bulwark.snap(); const x0 = s.playerX; __bulwark.tick(5);
        return s.paused === true && document.getElementById('overlay-title').textContent === 'PAUSED' &&
               __bulwark.snap().playerX === x0; })()`));
    await keyTap(cdp, 'p', 'KeyP', 'p');
    check(t + 'P resumes', await ev(`__bulwark.snap().paused === false && !document.getElementById('overlay').classList.contains('show')`));

    // --- movement ----------------------------------------------------------
    const mx0 = await ev('__bulwark.snap().playerX');
    await keyDown(cdp, 'ArrowRight', 'ArrowRight');
    await ev('__bulwark.tick(10), true');
    await keyUp(cdp, 'ArrowRight', 'ArrowRight');
    const mx1 = await ev('__bulwark.snap().playerX');
    check(t + 'ArrowRight moves the cannon right', mx1 > mx0, mx0 + ' -> ' + mx1);
    await keyDown(cdp, 'a', 'KeyA', 'a');
    await ev('__bulwark.tick(10), true');
    await keyUp(cdp, 'a', 'KeyA');
    const mx2 = await ev('__bulwark.snap().playerX');
    check(t + 'A moves the cannon left', mx2 < mx1, mx1 + ' -> ' + mx2);

    // --- firing + one-bullet limit ------------------------------------------
    await keyTap(cdp, ' ', 'Space', ' ');
    check(t + 'SPACE fires a bolt', await ev('!!__bulwark.snap().bullet'));
    const by1 = await ev('__bulwark.tick(2), __bulwark.snap().bullet && __bulwark.snap().bullet.y');
    check(t + 'the bolt climbs', typeof by1 === 'number' && by1 < 448, String(by1));
    await keyTap(cdp, ' ', 'Space', ' ');
    const by2 = await ev('__bulwark.snap().bullet && __bulwark.snap().bullet.y');
    check(t + 'one bolt on screen: second SPACE is ignored', by2 === by1, by1 + ' vs ' + by2);
    await ev('__bulwark.tick(80), __bulwark.snap().bombs.length = 0, true'); // let the bolt resolve

    // --- invader shots -------------------------------------------------------
    const bomb = await ev(`(() => {
      const bw = __bulwark;
      bw.snap().bombs.length = 0;
      let g = 0;
      while (bw.snap().bombs.length === 0 && g < 300) { bw.tick(5); g += 5; }
      const bs = bw.snap().bombs;
      if (!bs.length) return { spawned: false };
      const y0 = bs[0].y;
      bw.tick(3);
      const fell = bs.length === 0 || bs[0].y > y0;
      bw.snap().bombs.length = 0;
      return { spawned: true, fell };
    })()`);
    check(t + 'invaders drop bombs on their own', bomb.spawned && bomb.fell, JSON.stringify(bomb));

    // --- saucer ---------------------------------------------------------------
    const saucer = await ev(`(() => {
      const bw = __bulwark;
      bw.rushSaucer();
      bw.tick(2);
      let s = bw.snap();
      if (!s.saucer) return { spawned: false };
      for (let i = 0; i < 8; i++) { bw.tick(5); bw.snap().bombs.length = 0; }
      s = bw.snap();
      if (!s.saucer) return { spawned: true, gone: true, bonus: -1 };
      const before = s.score;
      bw.setBullet({ x: s.saucer.x + 10, y: 44 });
      bw.tick(1);
      const s2 = bw.snap();
      return { spawned: true, gone: s2.saucer === null, bonus: s2.score - before };
    })()`);
    check(t + 'mystery saucer crosses the top', saucer.spawned, JSON.stringify(saucer));
    check(t + 'clipping the saucer pays a 50-300 bonus', saucer.gone && SAUCER_SCORES.includes(saucer.bonus), JSON.stringify(saucer));

    // --- speedup as ranks thin --------------------------------------------------
    const speed = await ev(`(() => {
      const bw = __bulwark;
      const gap = (inv) => {
        let x = inv.x, y = inv.y, moved = 0, first = -1;
        for (let t2 = 1; t2 <= 250; t2++) {
          bw.tick(1);
          bw.snap().bombs.length = 0;
          if (inv.x !== x || inv.y !== y) {
            x = inv.x; y = inv.y; moved++;
            if (moved === 1) first = t2; else return t2 - first;
          }
        }
        return -1;
      };
      const s = bw.snap();
      const n0 = s.alive;
      const g0 = gap(s.invaders.find(i => i.alive));
      const alive = s.invaders.filter(i => i.alive);
      alive.forEach((inv, i) => { if (i >= 6) inv.alive = false; });
      const g1 = gap(alive[0]);
      return { n0, g0, g1 };
    })()`);
    check(t + 'full fleet steps once per ' + speed.n0 + ' ticks', speed.g0 === speed.n0, JSON.stringify(speed));
    check(t + 'thinned fleet (6 left) sprints: one step per 6 ticks', speed.g1 === 6, JSON.stringify(speed));

    // --- shield erosion ------------------------------------------------------------
    const shield = await ev(`(() => {
      const bw = __bulwark;
      const sum = (sh) => { let n = 0; for (let i = 0; i < sh.mask.length; i++) n += sh.mask[i]; return n; };
      const shs = bw.snap().shields;
      const b0 = sum(shs[2]);
      bw.setBullet({ x: 268, y: 446 }); // column through shield 2 (x 258..302)
      bw.tick(12);
      bw.snap().bombs.length = 0;
      const bulletChip = sum(shs[2]) < b0 - 15;
      const b1 = sum(shs[3]);
      bw.snap().bombs.push({ x: 392, y: 392, type: 0, phase: 0, speed: 3 }); // onto shield 3
      bw.tick(3);
      bw.snap().bombs.length = 0;
      return { bulletChip, bombChip: sum(shs[3]) < b1 - 15 };
    })()`);
    check(t + 'player bolt erodes shield pixels', shield.bulletChip, JSON.stringify(shield));
    check(t + 'invader bomb erodes shield pixels', shield.bombChip, JSON.stringify(shield));

    // --- wave advance -----------------------------------------------------------------
    const waveAdv = await ev(`(() => {
      const bw = __bulwark;
      const s = bw.snap();
      const w0 = s.wave;
      const alive = s.invaders.filter(i => i.alive);
      alive.forEach((inv, i) => { if (i > 0) inv.alive = false; });
      const last = alive[0];
      bw.setBullet({ x: last.x + 15, y: last.y + 14 }); // centre shot: hits whether it steps or drops
      bw.tick(1);
      const mid = bw.snap().state;
      bw.tick(110);
      const s2 = bw.snap();
      return { w0, mid, w1: s2.wave, alive: s2.alive, state: s2.state };
    })()`);
    check(t + 'clearing the fleet advances the wave with a fresh 55',
      waveAdv.mid === 'wavepause' && waveAdv.w1 === waveAdv.w0 + 1 && waveAdv.alive === 55 && waveAdv.state === 'playing',
      JSON.stringify(waveAdv));

    // --- lives + game over --------------------------------------------------------------
    const over = await ev(`(() => {
      const bw = __bulwark;
      for (let i = 0; i < 3; i++) {
        const s = bw.snap();
        if (s.state !== 'playing') break;
        s.bombs.length = 0;
        s.bombs.push({ x: s.playerX + 13, y: 452, type: 0, phase: 0, speed: 3 });
        bw.tick(2);   // the bomb lands
        bw.tick(85);  // death flash / game-over transition
      }
      const s2 = bw.snap();
      return { state: s2.state, lives: s2.lives,
               dead: document.getElementById('overlay').classList.contains('dead'),
               title: document.getElementById('overlay-title').textContent };
    })()`);
    check(t + 'three hits end the game (GAME OVER overlay, 0 lives)',
      over.state === 'over' && over.lives <= 0 && over.dead && over.title === 'GAME OVER',
      JSON.stringify(over));

    // --- any-key restart ------------------------------------------------------------------
    await ev('__bulwark.tick(31), true'); // let the restart guard elapse
    await keyTap(cdp, 'x', 'KeyX', 'x');
    check(t + 'any key restarts after game over',
      await ev(`(() => { const s = __bulwark.snap(); return s.state === 'playing' && s.score === 0 && s.lives === 3 && s.wave === 1; })()`));

    // --- reset button ------------------------------------------------------------------------
    const hiBefore = await ev(`(() => {
      const bw = __bulwark;
      bw.addScore(250);
      const s = bw.snap();
      s.bombs.length = 0;
      s.bombs.push({ x: s.playerX + 13, y: 452, type: 0, phase: 0, speed: 3 });
      bw.tick(2); bw.tick(85); // burn a life so the reset is observable
      return bw.snap().hiscore;
    })()`);
    check(t + 'setup: mid-game with score 250 and a lost life',
      await ev(`(() => { const s = __bulwark.snap(); return s.score === 250 && s.lives === 2; })()`));
    await ev(`document.getElementById('reset-btn').click(), true`);
    check(t + 'reset button restarts instantly: score/lives/wave fresh, fleet full',
      await ev(`(() => { const s = __bulwark.snap();
        return s.state === 'playing' && s.score === 0 && s.lives === 3 && s.wave === 1 && s.alive === 55 &&
               document.getElementById('score').textContent === '0'; })()`));
    check(t + 'reset leaves the high score untouched',
      await ev('__bulwark.snap().hiscore') === hiBefore,
      'hiscore before/after: ' + hiBefore + '/' + await ev('__bulwark.snap().hiscore'));

    // --- R key reset ----------------------------------------------------------------------------
    await ev('__bulwark.addScore(99), true');
    await keyTap(cdp, 'r', 'KeyR', 'r');
    check(t + 'R key resets mid-game',
      await ev(`(() => { const s = __bulwark.snap(); return s.state === 'playing' && s.score === 0 && s.wave === 1 && s.lives === 3; })()`));

    // --- high score persistence ------------------------------------------------------------------
    const h0 = await ev('__bulwark.snap().hiscore');
    const target = h0 + 50;
    await ev(`__bulwark.addScore(${target}), true`);
    check(t + 'high score lands in localStorage (arcade.bulwark.hiscore)',
      await ev(`localStorage.getItem('arcade.bulwark.hiscore')`) === String(target));
    await cdp.send('Page.reload', {});
    await waitFor(cdp, '!!window.__bulwark');
    check(t + 'high score survives a reload (best HUD restored)',
      await ev(`document.getElementById('best').textContent === '${target}' && __bulwark.snap().hiscore === ${target}`));

    // --- audio toggle ------------------------------------------------------------------------------
    const label0 = await ev(`document.getElementById('audio-toggle').textContent`);
    await ev(`document.getElementById('audio-toggle').click(), true`);
    const label1 = await ev(`document.getElementById('audio-toggle').textContent`);
    check(t + 'audio button toggles and persists',
      label1 !== label0 && await ev(`localStorage.getItem('arcade.bulwark.audio')`) === (label1.endsWith('on') ? 'on' : 'off'),
      label0 + ' -> ' + label1);
    await keyTap(cdp, 'm', 'KeyM', 'm');
    check(t + 'M key toggles audio back', await ev(`document.getElementById('audio-toggle').textContent`) === label0);

    // --- console cleanliness -------------------------------------------------------------------------
    await sleep(300);
    check(t + 'zero non-favicon console errors/exceptions', errors.length === 0, errors.join(' | '));
  } finally {
    cdp.close();
    try { await fetch(`http://127.0.0.1:${browserPort}/json/close/${created.id}`); } catch { /* browser may be gone */ }
  }
}

// -------------------------------------------------------------------- main

const hardStop = setTimeout(() => {
  console.error('FAIL - global timeout (180s): test hung');
  process.exit(2);
}, 180000);

let server, chrome;
try {
  const srv = await startServer();
  server = srv.server;
  chrome = await launchChrome();

  const httpUrl = `http://127.0.0.1:${srv.port}/games/bulwark/index.html`;
  const fileUrl = 'file://' + path.join(GAME_DIR, 'index.html');

  await runSuite('http', httpUrl, chrome.port);
  await runSuite('file', fileUrl, chrome.port);
} catch (e) {
  failures++;
  console.error('FAIL - suite crashed: ' + (e && e.stack || e));
} finally {
  if (chrome) {
    chrome.proc.kill('SIGKILL');
    try { fs.rmSync(chrome.udd, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  if (server) server.close();
  clearTimeout(hardStop);
}

if (failures) {
  console.error('\n' + failures + ' browser check(s) FAILED');
  process.exit(1);
}
console.log('\nall browser checks passed (http + file://)');
