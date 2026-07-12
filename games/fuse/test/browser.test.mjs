#!/usr/bin/env node
// Fuse — headless-Chrome feature test. No npm deps (node >= 22: fetch + WebSocket).
// Run: node games/fuse/test/browser.test.mjs
// Loads the game over BOTH a local http server AND file://, asserts zero
// non-favicon console errors/exceptions on both, and exercises every
// user-facing feature in the game's README with real key/mouse/touch input.
'use strict';

import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GAME_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(GAME_DIR, '..', '..');
const CHROME = '/usr/bin/google-chrome';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let checks = 0;
function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAIL: ' + msg);
  checks++;
  console.log('  ok - ' + msg);
}

// ---------------------------------------------------------- static server

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml',
};
function startServer(root) {
  return new Promise((resolve) => {
    const srv = http.createServer(async (req, res) => {
      try {
        const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        const p = path.normalize(path.join(root, rel));
        if (!p.startsWith(root)) throw new Error('traversal');
        const data = await fs.readFile(p);
        res.setHeader('content-type', MIME[path.extname(p)] || 'application/octet-stream');
        res.end(data);
      } catch {
        res.statusCode = 404;
        res.end('not found');
      }
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

// ------------------------------------------------------------------ chrome

function launchChrome(userDataDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn(CHROME, [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--window-size=900,1400',
      '--autoplay-policy=no-user-gesture-required',
      'about:blank',
    ]);
    let buf = '';
    let done = false;
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (m && !done) {
        done = true;
        resolve({ proc, port: Number(m[1]) });
      }
    });
    proc.on('exit', (code) => {
      if (!done) reject(new Error(`chrome exited early (code ${code}): ${buf}`));
    });
    setTimeout(() => {
      if (!done) reject(new Error('chrome did not start within 20s: ' + buf));
    }, 20000);
  });
}

// --------------------------------------------------------------- CDP page

class Page {
  static async open(port, url = 'about:blank') {
    const r = await fetch(
      `http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`,
      { method: 'PUT' }
    );
    const info = await r.json();
    const ws = new WebSocket(info.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('ws connect failed')), { once: true });
    });
    const p = new Page(ws);
    await p.send('Page.enable');
    await p.send('Runtime.enable');
    await p.send('Log.enable');
    return p;
  }

  constructor(ws) {
    this.ws = ws;
    this.msgId = 0;
    this.pending = new Map();
    this.errors = [];
    this._loadWaiter = null;
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) rej(new Error(`${m.error.message} (${m.error.data || ''})`));
        else res(m.result);
      } else if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        this.errors.push((d.exception && d.exception.description) || d.text || 'exception');
      } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        this.errors.push(
          m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')
        );
      } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
        this.errors.push(`${m.params.entry.text} ${m.params.entry.url || ''}`);
      } else if (m.method === 'Page.loadEventFired' && this._loadWaiter) {
        const w = this._loadWaiter;
        this._loadWaiter = null;
        w();
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.msgId;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  waitLoad(timeout = 15000) {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('page load timeout')), timeout);
      this._loadWaiter = () => {
        clearTimeout(t);
        res();
      };
    });
  }

  async navigate(url) {
    const loaded = this.waitLoad();
    await this.send('Page.navigate', { url });
    await loaded;
    await sleep(150);
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('eval failed: ' + ((d.exception && d.exception.description) || d.text));
    }
    return r.result.value;
  }

  // Real key events through the CDP Input domain (the game reads e.code).
  async key(code, key) {
    const VK = {
      ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
      KeyW: 87, KeyA: 65, KeyS: 83, KeyD: 68,
      KeyZ: 90, KeyU: 85, KeyR: 82, KeyN: 78, KeyM: 77,
      Space: 32, Enter: 13,
    };
    const k = key || (code.startsWith('Key') ? code.slice(3).toLowerCase() : code);
    const base = { code, key: k, windowsVirtualKeyCode: VK[code] || 0, nativeVirtualKeyCode: VK[code] || 0 };
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }

  // Real mouse click through the CDP Input domain at the element's center.
  async click(selector) {
    const pt = await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('no element ' + ${JSON.stringify(selector)});
      el.scrollIntoView({ block: 'center' });
      const b = el.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    })()`);
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1,
    });
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1,
    });
    await sleep(50);
  }

  close() {
    try { this.ws.close(); } catch { /* already closed */ }
  }
}

// ------------------------------------------------------------ game helpers

const T = (id, value, r, c) => ({ id, value, r, c });

async function seed(page, tiles, extra = {}) {
  const state = { tiles, score: 0, won: false, keepPlaying: false, over: false, ...extra };
  await page.eval(`(() => {
    const t = window.FuseGame._test;
    t.hideOverlay();
    t.game.restore(${JSON.stringify(state)});
    t.game.prev = null;
    t.render();
    t.save();
    return true;
  })()`);
}

function state(page) {
  return page.eval(`(() => {
    const g = window.FuseGame._test.game;
    return {
      tiles: g.tiles.map(t => ({ value: t.value, r: t.r, c: t.c }))
        .sort((a, b) => a.r - b.r || a.c - b.c),
      score: g.score, over: g.over, won: g.won,
      keepPlaying: g.keepPlaying, hasPrev: !!g.prev,
    };
  })()`);
}

function overlay(page) {
  return page.eval(`({
    hidden: document.querySelector('#overlay').classList.contains('hidden'),
    msg: document.querySelector('#overlay-msg').textContent,
    keepHidden: document.querySelector('#keep-going').classList.contains('hidden'),
    tryLabel: document.querySelector('#try-again').textContent,
  })`);
}

const tileAt = (s, r, c) => s.tiles.find((t) => t.r === r && t.c === c) || null;

// A full 15-tile board with no adjacent equal pairs; (3,3) empty. Sliding
// right fills the hole with a spawn that cannot pair with anything → over.
const NEAR_DEATH = [
  T(1, 2, 0, 0), T(2, 4, 0, 1), T(3, 8, 0, 2), T(4, 16, 0, 3),
  T(5, 32, 1, 0), T(6, 64, 1, 1), T(7, 128, 1, 2), T(8, 256, 1, 3),
  T(9, 512, 2, 0), T(10, 1024, 2, 1), T(11, 4, 2, 2), T(12, 8, 2, 3),
  T(13, 16, 3, 0), T(14, 32, 3, 1), T(15, 64, 3, 2),
];

const MOVE_WAIT = 350; // slide (100ms) + finish step + slack

// ---------------------------------------------------------------- the suite

async function runSuite(page, url, label) {
  console.log(`\n=== ${label}: ${url}`);
  page.errors.length = 0;

  // Clean origin: load once, wipe storage, load fresh.
  await page.navigate(url);
  await page.eval('localStorage.clear(); true');
  await page.navigate(url);
  await sleep(200);

  assert(
    await page.eval('!!(window.FuseGame && window.FuseGame._test)'),
    `${label}: game booted (scripts ran — no dead page)`
  );

  // --- fresh game: two tiles, score 0, rendered DOM matches
  let s = await state(page);
  assert(s.tiles.length === 2 && s.score === 0, `${label}: new game has 2 tiles, score 0`);
  assert(
    (await page.eval(`document.querySelectorAll('#tiles .tile').length`)) === 2,
    `${label}: 2 tile elements rendered on the board`
  );

  // --- slides + merges with merge-locking: 4 2 2 →left must give 4 4, never 8
  await seed(page, [T(1, 4, 0, 0), T(2, 2, 0, 1), T(3, 2, 0, 2)]);
  await page.key('ArrowLeft');
  await sleep(MOVE_WAIT);
  s = await state(page);
  assert(!s.tiles.some((t) => t.value === 8), `${label}: merge-locking — 4 2 2 →left never makes 8`);
  assert(
    tileAt(s, 0, 0)?.value === 4 && tileAt(s, 0, 1)?.value === 4,
    `${label}: tiles slid and equal pair fused to 4 4`
  );
  assert(s.score === 4, `${label}: merge scored +4`);

  // --- 90/10 spawn: legal move spawned exactly one tile, value 2 or 4
  assert(s.tiles.length === 3, `${label}: legal move spawned exactly one tile`);
  const spawned = s.tiles.find((t) => !(t.r === 0 && t.c <= 1));
  assert(
    spawned && (spawned.value === 2 || spawned.value === 4),
    `${label}: spawned tile is a 2 or a 4 (90/10 rule domain)`
  );
  assert(
    (await page.eval(`document.querySelectorAll('#tiles .tile').length`)) === 3,
    `${label}: spawned tile rendered in the DOM`
  );

  // --- WASD works like arrows
  await seed(page, [T(1, 2, 3, 2)]);
  await page.key('KeyW'); // up
  await sleep(MOVE_WAIT);
  s = await state(page);
  assert(tileAt(s, 0, 2)?.value === 2, `${label}: WASD (W) slides the grid up`);

  // --- illegal move: nothing slides → no spawn, no score, deny only
  await seed(page, [T(1, 2, 0, 0)]);
  await page.key('ArrowLeft'); // already flush left
  await sleep(MOVE_WAIT);
  s = await state(page);
  assert(
    s.tiles.length === 1 && s.score === 0 && !s.hasPrev,
    `${label}: illegal move spawns nothing and takes no undo snapshot`
  );

  // --- one-step undo via the undo button
  await page.key('ArrowRight'); // legal: slides to (0,3) + spawn
  await sleep(MOVE_WAIT);
  s = await state(page);
  assert(s.tiles.length === 2 && s.hasPrev, `${label}: legal move armed the undo snapshot`);
  assert(
    (await page.eval(`document.querySelector('#undo').disabled`)) === false,
    `${label}: undo button enabled after a legal move`
  );
  await page.click('#undo');
  await sleep(150);
  s = await state(page);
  assert(
    s.tiles.length === 1 && tileAt(s, 0, 0)?.value === 2 && !s.hasPrev,
    `${label}: undo button restored the pre-move board (single step)`
  );
  assert(
    (await page.eval(`document.querySelector('#undo').disabled`)) === true,
    `${label}: undo button disabled once the single snapshot is spent`
  );

  // --- win banner at 2048 + keep going
  await seed(page, [T(1, 1024, 0, 0), T(2, 1024, 0, 1)]);
  await page.key('ArrowLeft');
  await sleep(MOVE_WAIT);
  s = await state(page);
  let ov = await overlay(page);
  assert(s.won && tileAt(s, 0, 0)?.value === 2048, `${label}: two 1024s fused into 2048`);
  assert(!ov.hidden && ov.msg.includes('2048'), `${label}: win banner shown at 2048`);
  assert(!ov.keepHidden, `${label}: win banner offers Keep going`);
  await page.click('#keep-going');
  await sleep(150);
  ov = await overlay(page);
  s = await state(page);
  assert(ov.hidden && s.keepPlaying, `${label}: Keep going dismisses the banner and flags keepPlaying`);
  await page.key('ArrowDown');
  await sleep(MOVE_WAIT);
  s = await state(page);
  assert(tileAt(s, 3, 0)?.value === 2048, `${label}: play continues after Keep going`);

  // --- best score follows the 2048 fuse
  const bestShown = await page.eval(`parseInt(document.querySelector('#best').textContent, 10)`);
  const bestStored = await page.eval(`parseInt(localStorage.getItem('arcade.fuse.best'), 10)`);
  assert(bestShown >= 2048 && bestStored >= 2048, `${label}: best score updated and persisted (>= 2048)`);

  // --- game over detection
  await seed(page, NEAR_DEATH);
  await page.key('ArrowRight');
  await sleep(MOVE_WAIT);
  s = await state(page);
  ov = await overlay(page);
  assert(s.over, `${label}: filling the last cell with no pairs sets game over`);
  assert(!ov.hidden && ov.msg.includes('No moves left'), `${label}: game-over banner shown`);
  assert(ov.keepHidden, `${label}: no Keep going on the lose banner`);

  // --- undo works out of a game over (Z key)
  await page.key('KeyZ');
  await sleep(150);
  s = await state(page);
  ov = await overlay(page);
  assert(
    !s.over && ov.hidden && s.tiles.length === 15,
    `${label}: Z undoes out of a game over`
  );

  // --- Try again button restarts from the lose banner
  await seed(page, NEAR_DEATH);
  await page.key('ArrowRight');
  await sleep(MOVE_WAIT);
  await page.click('#try-again');
  await sleep(150);
  s = await state(page);
  ov = await overlay(page);
  assert(
    ov.hidden && s.tiles.length === 2 && s.score === 0 && !s.over,
    `${label}: Try again starts a fresh game`
  );

  // --- restart via the new button and via R
  await page.key('ArrowLeft'); // some move so state isn't already fresh
  await sleep(MOVE_WAIT);
  await page.click('#new');
  await sleep(150);
  s = await state(page);
  assert(s.tiles.length === 2 && s.score === 0 && !s.hasPrev, `${label}: new button restarts`);
  await page.key('KeyR');
  await sleep(150);
  s = await state(page);
  assert(s.tiles.length === 2 && s.score === 0, `${label}: R key restarts`);

  // --- state persistence across reload
  await seed(page, [T(1, 2, 0, 0), T(2, 2, 0, 1)]);
  await page.key('ArrowLeft'); // fuse to 4, spawn, save
  await sleep(MOVE_WAIT);
  const beforeReload = await state(page);
  await page.navigate(url);
  await sleep(200);
  const afterReload = await state(page);
  assert(
    JSON.stringify(afterReload.tiles) === JSON.stringify(beforeReload.tiles) &&
      afterReload.score === beforeReload.score,
    `${label}: board + score survive a reload`
  );
  assert(afterReload.hasPrev, `${label}: the undo snapshot survives a reload too`);
  assert(
    (await page.eval(`parseInt(document.querySelector('#best').textContent, 10)`)) >= 2048,
    `${label}: best score survives a reload`
  );

  // --- audio toggle (button + M key + persistence)
  assert(
    (await page.eval(`document.querySelector('#sound').textContent`)).includes('on'),
    `${label}: sound starts on`
  );
  await page.click('#sound');
  await sleep(100);
  assert(
    (await page.eval(`document.querySelector('#sound').textContent`)).includes('off') &&
      (await page.eval(`localStorage.getItem('arcade.fuse.audio')`)) === 'off',
    `${label}: sound button mutes and persists 'off'`
  );
  await page.key('KeyM');
  await sleep(100);
  assert(
    (await page.eval(`document.querySelector('#sound').textContent`)).includes('on') &&
      (await page.eval(`localStorage.getItem('arcade.fuse.audio')`)) === 'on',
    `${label}: M key unmutes and persists 'on'`
  );

  // --- swipe input (simulated touch events on the board)
  const swipe = (x1, y1, x2, y2) => page.eval(`(() => {
    const board = document.querySelector('#board');
    const mk = (x, y) => new Touch({ identifier: 1, target: board, clientX: x, clientY: y });
    board.dispatchEvent(new TouchEvent('touchstart', {
      touches: [mk(${x1}, ${y1})], changedTouches: [mk(${x1}, ${y1})],
      bubbles: true, cancelable: true,
    }));
    board.dispatchEvent(new TouchEvent('touchend', {
      touches: [], changedTouches: [mk(${x2}, ${y2})],
      bubbles: true, cancelable: true,
    }));
    return true;
  })()`);

  await seed(page, [T(1, 2, 0, 0)]);
  await swipe(100, 300, 220, 300); // 120px right
  await sleep(MOVE_WAIT);
  s = await state(page);
  assert(
    tileAt(s, 0, 3)?.value === 2 && s.tiles.length === 2,
    `${label}: swipe right slides the grid (and spawns)`
  );
  const beforeSmall = JSON.stringify(s.tiles);
  await swipe(100, 300, 110, 300); // 10px — under the 24px threshold
  await sleep(MOVE_WAIT);
  s = await state(page);
  assert(
    JSON.stringify(s.tiles) === beforeSmall,
    `${label}: sub-threshold swipe (<24px) is ignored`
  );
  await seed(page, [T(1, 2, 3, 0)]);
  await swipe(100, 300, 100, 180); // 120px up
  await sleep(MOVE_WAIT);
  s = await state(page);
  assert(tileAt(s, 0, 0)?.value === 2, `${label}: swipe up slides the grid up`);

  // --- zero non-favicon console errors / exceptions
  const errs = page.errors.filter((e) => !/favicon/i.test(e));
  assert(errs.length === 0, `${label}: zero non-favicon console errors (got: ${errs.join(' | ') || 'none'})`);
}

// ------------------------------------------------------------------- main

const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'fuse-browser-test-'));
let chrome = null;
let server = null;
let failed = false;

try {
  server = await startServer(REPO_ROOT);
  const httpUrl = `http://127.0.0.1:${server.address().port}/games/fuse/index.html`;
  const fileUrl = 'file://' + encodeURI(path.join(GAME_DIR, 'index.html'));

  chrome = await launchChrome(path.join(scratch, 'profile'));
  const page = await Page.open(chrome.port);

  await runSuite(page, httpUrl, 'http');
  await runSuite(page, fileUrl, 'file');

  page.close();
  console.log(`\nPASS — ${checks} checks across http:// and file://`);
} catch (err) {
  failed = true;
  console.error('\nFAIL — ' + err.message);
} finally {
  if (chrome) chrome.proc.kill('SIGKILL');
  if (server) server.close();
  await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
}
process.exit(failed ? 1 : 0);
