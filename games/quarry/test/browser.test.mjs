#!/usr/bin/env node
/* Headless-Chrome feature test for Quarry.
   Loads the game BOTH over a local http server AND via file://, asserts zero
   non-favicon console errors/exceptions on both, and exercises every
   user-facing feature from the README with real key/mouse input via CDP.
   No npm deps: node's built-in fetch + WebSocket drive Chrome's devtools
   protocol directly. Usage: node games/quarry/test/browser.test.mjs */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = '/usr/bin/google-chrome';
const GAME_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const sleep = ms => new Promise(r => setTimeout(r, ms));

let assertCount = 0;
function assert(cond, msg) {
  assertCount++;
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

/* ---------------- tiny CDP client ---------------- */

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`CDP ${msg.error.message}`));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.handlers.get(msg.method) || []) fn(msg.params);
      }
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error(`ws connect failed: ${url}`)), { once: true });
    });
    return new CDP(ws);
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

/* ---------------- chrome + http server ---------------- */

async function launchChrome(profileDir) {
  const proc = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--remote-debugging-port=0', `--user-data-dir=${profileDir}`,
    '--window-size=900,860', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', d => { stderr += d; });

  const portFile = path.join(profileDir, 'DevToolsActivePort');
  for (let i = 0; i < 200; i++) {
    if (existsSync(portFile)) {
      const [port, wsPath] = readFileSync(portFile, 'utf8').trim().split('\n');
      if (port && wsPath) return { proc, port: Number(port), browserWs: `ws://127.0.0.1:${port}${wsPath}` };
    }
    if (proc.exitCode !== null) throw new Error(`chrome exited early:\n${stderr}`);
    await sleep(50);
  }
  throw new Error(`chrome DevToolsActivePort never appeared\n${stderr}`);
}

function startHttpServer(rootDir) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.md': 'text/markdown' };
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const fp = path.join(rootDir, urlPath === '/' ? 'index.html' : urlPath);
      if (!fp.startsWith(rootDir)) throw new Error('nope');
      const body = await readFile(fp);
      res.writeHead(200, { 'content-type': types[path.extname(fp)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404); res.end('not found');
    }
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/* ---------------- page helpers ---------------- */

const KEYS = {
  Enter: { code: 'Enter', vk: 13, text: '\r' },
  Escape: { code: 'Escape', vk: 27 },
  ArrowLeft: { code: 'ArrowLeft', vk: 37 },
  ArrowUp: { code: 'ArrowUp', vk: 38 },
  ArrowRight: { code: 'ArrowRight', vk: 39 },
  ArrowDown: { code: 'ArrowDown', vk: 40 },
  ' ': { code: 'Space', vk: 32, text: ' ' },
  r: { code: 'KeyR', vk: 82, text: 'r' },
  c: { code: 'KeyC', vk: 67, text: 'c' },
  m: { code: 'KeyM', vk: 77, text: 'm' },
  p: { code: 'KeyP', vk: 80, text: 'p' },
  x: { code: 'KeyX', vk: 88, text: 'x' },
};

function makePage(cdp) {
  const errors = [];
  cdp.on('Runtime.exceptionThrown', p => {
    errors.push(`exception: ${p.exceptionDetails?.exception?.description || p.exceptionDetails?.text}`);
  });
  cdp.on('Runtime.consoleAPICalled', p => {
    if (p.type === 'error') errors.push(`console.error: ${p.args.map(a => a.value ?? a.description).join(' ')}`);
  });
  cdp.on('Log.entryAdded', p => {
    if (p.entry.level === 'error') errors.push(`log: ${p.entry.text} ${p.entry.url || ''}`);
  });

  const evaluate = async expr => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error(`evaluate failed: ${expr}\n${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    }
    return r.result.value;
  };

  const keyEvent = async (type, key) => {
    const d = KEYS[key] || {};
    const params = { type, key, code: d.code, windowsVirtualKeyCode: d.vk, nativeVirtualKeyCode: d.vk };
    if (type === 'keyDown' && d.text) params.text = d.text;
    await cdp.send('Input.dispatchKeyEvent', params);
  };
  const press = async key => { await keyEvent('keyDown', key); await keyEvent('keyUp', key); };

  const click = async sel => {
    const c = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      const b = el.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    })()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1 });
  };

  const waitFor = async (expr, desc, timeout = 5000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await evaluate(expr)) return;
      await sleep(60);
    }
    throw new Error(`timeout waiting for: ${desc} (${expr})`);
  };

  return { cdp, errors, evaluate, keyEvent, press, click, waitFor };
}

/* ---------------- the feature suite (runs on http AND file) ---------------- */

async function runSuite(pg, envName) {
  const { evaluate, keyEvent, press, click, waitFor } = pg;
  const step = name => console.log(`    [${envName}] ${name}`);
  const cells = `G.board.flat().filter(Boolean).length`;

  await waitFor(`document.readyState === 'complete' && typeof G === 'object'`, 'game booted');
  await evaluate(`localStorage.removeItem('arcade.quarry.high'); localStorage.removeItem('arcade.quarry.audio');`);

  step('boots to the title screen');
  assert(await evaluate(`G.state`) === 'menu', `${envName}: initial state is menu`);
  assert(!await evaluate(`document.getElementById('overlay').classList.contains('hidden')`),
    `${envName}: title overlay visible`);

  step('any key starts a game');
  await press('Enter');
  await waitFor(`G.state === 'playing'`, 'game started');
  assert(await evaluate(`document.getElementById('overlay').classList.contains('hidden')`),
    `${envName}: overlay hidden once playing`);
  assert(await evaluate(`!!G.piece`), `${envName}: a stone spawned`);

  step('piece falls under gravity');
  const y0 = await evaluate(`G.piece.y`);
  await waitFor(`!G.piece || G.piece.y > ${y0}`, 'gravity moved the stone', 4000);
  assert(true, `${envName}: stone fell`);

  step('rotation (with kicks available)');
  await evaluate(`startGame(); G.piece = { idx: 5, rot: 0, x: 3, y: 6, seed: 1 };`);
  await press('ArrowUp');
  await waitFor(`G.piece.rot === 1`, 'clockwise rotation');
  assert(await evaluate(`G.piece.rot`) === 1, `${envName}: ArrowUp rotated the stone`);
  // wall kick: vertical I hugging the left wall must kick right to rotate
  await evaluate(`G.piece = { idx: 1, rot: 1, x: -2, y: 10, seed: 1 };`);
  await press('x');
  await waitFor(`G.piece.rot === 2 && G.piece.x === 0`, 'kick applied');
  assert(true, `${envName}: blocked rotation kicked off the wall`);

  step('soft drop scores +1 per cell');
  await evaluate(`startGame();`);
  const soft0 = await evaluate(`G.score`);
  await keyEvent('keyDown', 'ArrowDown');
  await waitFor(`G.score > ${soft0}`, 'soft-drop points', 3000);
  await keyEvent('keyUp', 'ArrowDown');
  assert(true, `${envName}: soft drop scored`);

  step('hard drop locks instantly and scores +2 per cell');
  await evaluate(`startGame();`);
  const hard0 = await evaluate(`({ s: G.score, c: ${cells} })`);
  await press(' ');
  await waitFor(`${cells} > ${hard0.c}`, 'stone locked by hard drop');
  assert(await evaluate(`G.score`) >= hard0.s + 2, `${envName}: hard drop scored +2/cell`);

  step('ghost piece marks the landing row');
  await evaluate(`startGame();`);
  assert(await evaluate(
    `(() => { const gy = ghostY(); return gy > G.piece.y
        && fits(G.piece.idx, G.piece.rot, G.piece.x, gy)
        && !fits(G.piece.idx, G.piece.rot, G.piece.x, gy + 1); })()`),
    `${envName}: ghost sits exactly where the stone would land`);

  step('stash (hold) slot, once per drop');
  await evaluate(`startGame();`);
  const held = await evaluate(`G.piece.idx`);
  await press('c');
  await waitFor(`G.hold !== null`, 'stone stashed');
  assert(await evaluate(`G.hold`) === held, `${envName}: stash stored the falling stone`);
  const afterStash = await evaluate(`G.piece.idx`);
  await press('c'); // second stash before locking must be refused
  await sleep(80);
  assert(await evaluate(`G.hold`) === held && await evaluate(`G.piece.idx`) === afterStash,
    `${envName}: stash is once per drop`);

  step('bag randomizer covers all 12 pentominoes');
  assert(await evaluate(`(() => { refillBag(); return new Set(G.bag).size; })()`) === 12,
    `${envName}: a full bag holds each of the 12 stones once`);

  step('line clear + scoring');
  const clr = await evaluate(`(() => {
    startGame();
    for (let x = 5; x < COLS; x++) G.board[ROWS - 1][x] = { p: 0, s: 1 };
    G.piece = { idx: 1, rot: 0, x: 0, y: 6, seed: 1 };
    const before = { score: G.score, lines: G.lines };
    hardDrop();
    return { before, score: G.score, lines: G.lines, state: G.state };
  })()`);
  assert(clr.state === 'clearing', `${envName}: full seam enters the clearing state`);
  assert(clr.lines === clr.before.lines + 1, `${envName}: seam counted`);
  assert(clr.score >= clr.before.score + 100, `${envName}: CHIP paid 100 x depth`);
  await waitFor(`G.state === 'playing'`, 'seam collapsed');
  assert(await evaluate(`G.board[ROWS - 1].filter(Boolean).length`) === 0,
    `${envName}: cleared seam collapsed away`);

  step('DAS auto-repeat while a direction is held');
  await evaluate(`startGame(); G.piece = { idx: 9, rot: 0, x: 6, y: 8, seed: 1 };`);
  const dasX = await evaluate(`G.piece.x`);
  await keyEvent('keyDown', 'ArrowLeft');
  await sleep(340); // 1 immediate + DAS(170ms) + ~3 ARR(40ms) repeats
  await keyEvent('keyUp', 'ArrowLeft');
  const dasMoved = dasX - await evaluate(`G.piece.x`);
  assert(dasMoved >= 3, `${envName}: held Left auto-repeated (moved ${dasMoved} cols)`);

  step('level speedup curve');
  assert(await evaluate(`gravityMs(1) === 800 && gravityMs(3) < 800 && gravityMs(99) === 80`),
    `${envName}: deeper levels fall faster down to the 80ms floor`);

  step('pause with P');
  await evaluate(`startGame();`);
  await press('p');
  await waitFor(`G.state === 'paused'`, 'paused');
  const pausedY = await evaluate(`G.piece.y`);
  await sleep(500);
  assert(await evaluate(`G.piece.y`) === pausedY, `${envName}: gravity frozen while paused`);
  await press('p');
  await waitFor(`G.state === 'playing'`, 'resumed');

  step('restart confirmation: R opens a dialog, does not restart');
  await evaluate(`startGame(); G.score = 555;`);
  await press('r');
  await waitFor(`G.state === 'confirm'`, 'confirm dialog opened');
  assert(await evaluate(`G.score`) === 555, `${envName}: run untouched when dialog opens`);
  assert(!await evaluate(`document.getElementById('overlay').classList.contains('hidden')`),
    `${envName}: dialog overlay visible`);
  assert(!await evaluate(`document.getElementById('confirm-buttons').classList.contains('hidden')`),
    `${envName}: confirm/cancel buttons visible`);
  assert(await evaluate(`/restart this run\\?/i.test(document.getElementById('overlay-sub').textContent)`),
    `${envName}: dialog asks "Restart this run?"`);

  step('restart confirmation: game is paused while the dialog is open');
  const cfY = await evaluate(`G.piece.y`);
  await sleep(900);
  assert(await evaluate(`G.piece.y`) === cfY && await evaluate(`G.state`) === 'confirm',
    `${envName}: game frozen under the dialog`);

  step('restart confirmation: Esc cancels and the run continues');
  await press('Escape');
  await waitFor(`G.state === 'playing'`, 'cancelled with Esc');
  assert(await evaluate(`G.score`) === 555, `${envName}: score survived the cancel`);

  step('restart confirmation: KEEP DIGGING button cancels');
  await press('r');
  await waitFor(`G.state === 'confirm'`, 'dialog re-opened');
  await click('#confirm-no');
  await waitFor(`G.state === 'playing'`, 'cancelled with the button');
  assert(await evaluate(`G.score`) === 555, `${envName}: score survived the button cancel`);

  step('restart confirmation: Enter confirms and restarts');
  await press('r');
  await waitFor(`G.state === 'confirm'`, 'dialog opened');
  await press('Enter');
  await waitFor(`G.state === 'playing' && G.score === 0`, 'confirmed with Enter');
  assert(true, `${envName}: Enter restarted the run`);

  step('restart confirmation: RESTART button confirms');
  await evaluate(`G.score = 123;`);
  await press('r');
  await waitFor(`G.state === 'confirm'`, 'dialog opened');
  await click('#confirm-yes');
  await waitFor(`G.state === 'playing' && G.score === 0`, 'confirmed with the button');
  assert(true, `${envName}: RESTART button restarted the run`);

  step('game-over restart stays instant');
  await evaluate(`G.score = 50; gameOver();`);
  assert(await evaluate(`G.state`) === 'over', `${envName}: game over reached`);
  await press('r');
  await waitFor(`G.state === 'playing'`, 'instant restart from game over');
  assert(await evaluate(`G.score`) === 0, `${envName}: no dialog after game over — nothing to lose`);

  step('audio toggle (button + M key) persists arcade.quarry.audio');
  assert(await evaluate(`document.getElementById('audio-toggle').textContent`) === 'SND ON',
    `${envName}: audio starts on`);
  await click('#audio-toggle');
  await waitFor(`document.getElementById('audio-toggle').textContent === 'SND OFF'`, 'sound off');
  assert(await evaluate(`localStorage.getItem('arcade.quarry.audio')`) === 'off',
    `${envName}: audio pref persisted off`);
  await press('m');
  await waitFor(`document.getElementById('audio-toggle').textContent === 'SND ON'`, 'sound back on');
  assert(await evaluate(`localStorage.getItem('arcade.quarry.audio')`) === 'on',
    `${envName}: M key persisted audio back on`);

  step('high score persists across a reload');
  await evaluate(`G.score = 7777; gameOver();`);
  assert(await evaluate(`localStorage.getItem('arcade.quarry.high')`) === '7777',
    `${envName}: high score written to arcade.quarry.high`);
  await pg.cdp.send('Page.reload');
  await sleep(300);
  await waitFor(`document.readyState === 'complete' && typeof G === 'object'`, 'reloaded');
  assert(await evaluate(`G.high`) === 7777, `${envName}: high score loaded after reload`);
  assert(await evaluate(`document.getElementById('hud-high').textContent`) === '7777',
    `${envName}: HUD shows the persisted high score`);
}

/* ---------------- orchestration ---------------- */

async function testUrl(browser, port, url, envName) {
  console.log(`  -- ${envName}: ${url}`);
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const info = list.find(t => t.id === targetId);
  if (!info) throw new Error(`target ${targetId} not found in /json/list`);
  const cdp = await CDP.connect(info.webSocketDebuggerUrl);
  try {
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Log.enable');
    const pg = makePage(cdp);
    await cdp.send('Page.navigate', { url });
    await runSuite(pg, envName);
    const bad = pg.errors.filter(e => !/favicon/i.test(e));
    if (bad.length) throw new Error(`${envName}: console errors/exceptions:\n  ${bad.join('\n  ')}`);
    console.log(`  -- ${envName}: zero non-favicon console errors`);
  } finally {
    cdp.close();
    await browser.send('Target.closeTarget', { targetId }).catch(() => {});
  }
}

async function main() {
  if (!existsSync(CHROME)) throw new Error(`chrome not found at ${CHROME}`);
  const profileDir = await mkdtemp(path.join(tmpdir(), 'quarry-test-'));
  const { server, port: httpPort } = await startHttpServer(GAME_DIR);
  let chrome;
  try {
    chrome = await launchChrome(profileDir);
    const browser = await CDP.connect(chrome.browserWs);
    await testUrl(browser, chrome.port, `http://127.0.0.1:${httpPort}/index.html`, 'http');
    await testUrl(browser, chrome.port, `file://${path.join(GAME_DIR, 'index.html')}`, 'file');
    browser.close();
    console.log(`\nPASS — ${assertCount} browser assertions across http + file://`);
  } finally {
    server.close();
    if (chrome) chrome.proc.kill('SIGKILL');
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().then(() => process.exit(0), err => {
  console.error(`\nFAIL: ${err.message}`);
  process.exit(1);
});
