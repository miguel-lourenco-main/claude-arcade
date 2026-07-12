// Gloamkeep — headless-Chrome feature test. No npm deps: drives Chrome
// (/usr/bin/google-chrome) over the DevTools protocol with node's built-in
// fetch + WebSocket. Loads the game BOTH over a local http server AND via
// file:// (the arcade is played by double-clicking index.html), asserts zero
// non-favicon console errors/exceptions on both, and exercises every
// user-facing feature in the game's README.
//
// Run: node games/gloamkeep/test/browser.test.mjs

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CHROME = '/usr/bin/google-chrome';
const GAME_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(GAME_DIR, '..', '..');

let passed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ok  ' + msg); }
  else throw new Error('assertion failed: ' + msg);
}

// --------------------------------------------------------------------------
// tiny static http server (serves the repo root so relative paths work)
// --------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

function startServer() {
  return new Promise((res) => {
    const srv = createServer(async (req, resp) => {
      try {
        const path = join(REPO_ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
        if (!path.startsWith(REPO_ROOT)) throw new Error('traversal');
        const body = await readFile(path);
        resp.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' });
        resp.end(body);
      } catch {
        resp.writeHead(404);
        resp.end('not found');
      }
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

// --------------------------------------------------------------------------
// minimal CDP client
// --------------------------------------------------------------------------

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners.get(msg.method) || []) fn(msg.params);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }
}

async function launchChrome(profileDir) {
  const proc = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--no-default-browser-check', '--disable-dev-shm-usage',
    '--window-size=1024,768',
    `--user-data-dir=${profileDir}`,
    '--remote-debugging-port=0',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d; });

  // chrome writes its chosen port to DevToolsActivePort in the profile dir
  const portFile = join(profileDir, 'DevToolsActivePort');
  for (let i = 0; i < 200; i++) {
    if (existsSync(portFile)) {
      const line = readFileSync(portFile, 'utf8').split('\n')[0].trim();
      if (line) return { proc, port: Number(line) };
    }
    await sleep(100);
  }
  proc.kill('SIGKILL');
  throw new Error('chrome did not expose a debugging port\n' + stderr);
}

async function openTab(port, url) {
  const resp = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  const info = await resp.json();
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws failed')); });
  return { cdp: new CDP(ws), targetId: info.id, ws };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --------------------------------------------------------------------------
// page-driving helpers
// --------------------------------------------------------------------------

function makePage(cdp) {
  const errors = [];
  cdp.on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error') {
      const text = p.args.map((a) => a.value ?? a.description ?? '').join(' ');
      if (!/favicon/i.test(text)) errors.push('console.error: ' + text);
    }
  });
  cdp.on('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails;
    const text = (d.exception && (d.exception.description || d.exception.value)) || d.text || 'exception';
    if (!/favicon/i.test(String(text))) errors.push('exception: ' + text);
  });
  cdp.on('Log.entryAdded', (p) => {
    if (p.entry.level === 'error' && !/favicon/i.test(p.entry.text) && !/favicon/i.test(p.entry.url || '')) {
      errors.push('log: ' + p.entry.text);
    }
  });

  async function evaluate(expr) {
    const r = await cdp.send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error('evaluate failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) + '\n' + expr);
    }
    return r.result.value;
  }

  async function waitFor(expr, label, timeout = 6000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await evaluate(expr)) return;
      await sleep(60);
    }
    throw new Error(`timeout waiting for ${label}: ${expr}`);
  }

  async function key(code, keyName, { hold = 0 } = {}) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: keyName });
    if (hold) await sleep(hold);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: keyName });
  }

  // real mouse click on the center of an element
  async function click(sel) {
    const box = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!box) throw new Error('no element for click: ' + sel);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await cdp.send('Input.dispatchMouseEvent', {
        type, x: box.x, y: box.y, button: 'left', clickCount: 1,
      });
    }
  }

  return { errors, evaluate, waitFor, key, click };
}

// --------------------------------------------------------------------------
// the feature scenario (identical over http and file://)
// --------------------------------------------------------------------------

async function runScenario(cdp, label, { denyPointerLock = false } = {}) {
  const page = makePage(cdp);
  const { evaluate, waitFor, key, click, errors } = page;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Log.enable');

  console.log(`\n== ${label} ==`);

  // -- load / start ---------------------------------------------------------
  await waitFor(`window.__gloamkeep && window.Gloamkeep && !document.getElementById('overlay-start').classList.contains('hidden')`, 'title screen');
  ok(await evaluate(`window.__gloamkeep.phase`) === 'title', 'game boots to the title screen');

  if (denyPointerLock) {
    // simulate the Chrome configs where pointer lock is refused on file://:
    // the game must still start and stay fully playable via the keyboard
    await evaluate(`Element.prototype.requestPointerLock = function () {
      throw new DOMException('pointer lock unavailable', 'SecurityError');
    }; true`);
  }

  await click('#btn-start');
  await waitFor(`window.__gloamkeep.phase === 'playing'`, 'start');
  ok(true, 'Enter the keep starts a run');
  ok(await evaluate(`!document.getElementById('hud').classList.contains('hidden')`), 'HUD appears in play');

  // keep the scripted walk-through deterministic: retire the level's enemies
  // (enemy behaviour itself is covered by the logic suites)
  await evaluate(`for (const e of window.__gloamkeep.game.enemies) { e.state = 'dead'; e.hp = 0; }`);

  // -- WASD movement --------------------------------------------------------
  const pos0 = await evaluate(`({ x: window.__gloamkeep.game.player.x, y: window.__gloamkeep.game.player.y })`);
  await key('KeyW', 'w', { hold: 400 });
  await sleep(80);
  const pos1 = await evaluate(`({ x: window.__gloamkeep.game.player.x, y: window.__gloamkeep.game.player.y })`);
  ok(Math.hypot(pos1.x - pos0.x, pos1.y - pos0.y) > 0.4,
     `W moves the player (${pos0.x.toFixed(2)},${pos0.y.toFixed(2)} -> ${pos1.x.toFixed(2)},${pos1.y.toFixed(2)})`);

  // -- collision slide ------------------------------------------------------
  await evaluate(`(() => { const p = window.__gloamkeep.game.player; p.x = 1.5; p.y = 11.5; p.angle = Math.PI * 0.75; })()`);
  await key('KeyW', 'w', { hold: 500 });
  await sleep(80);
  const slid = await evaluate(`(() => { const p = window.__gloamkeep.game.player; return { x: p.x, y: p.y, r: p.radius }; })()`);
  ok(slid.x >= 1 + slid.r - 1e-6, 'player does not clip into the wall');
  ok(Math.abs(slid.y - 11.5) > 0.2, `player slides along the wall (dy=${(slid.y - 11.5).toFixed(2)})`);

  // -- keyboard look fallback (pointer lock unavailable/denied) --------------
  const locked = await evaluate(`document.pointerLockElement === document.getElementById('screen')`);
  if (denyPointerLock) ok(!locked, 'pointer lock stayed denied (simulated file:// config)');
  const ang0 = await evaluate(`window.__gloamkeep.game.player.angle`);
  await key('ArrowLeft', 'ArrowLeft', { hold: 250 });
  await sleep(80);
  const ang1 = await evaluate(`window.__gloamkeep.game.player.angle`);
  ok(ang1 < ang0 - 0.1, `arrow keys turn the view without pointer lock (lock=${locked}, ${ang0.toFixed(2)} -> ${ang1.toFixed(2)})`);

  // -- fire + ammo ----------------------------------------------------------
  const ammo0 = await evaluate(`window.__gloamkeep.game.player.ammo`);
  await key('Space', ' ', { hold: 120 });
  await sleep(120);
  const ammo1 = await evaluate(`window.__gloamkeep.game.player.ammo`);
  ok(ammo1 < ammo0, `firing spends ammo (${ammo0} -> ${ammo1})`);
  ok(await evaluate(`document.getElementById('hud-ammo-num').textContent`) === String(ammo1), 'HUD shows the new ammo count');

  // helper injected once: stand before a grid cell, facing it
  await evaluate(`window.__standBefore = (x, y) => {
    const g = window.__gloamkeep.game, m = g.map, T = window.Gloamkeep.TILE;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
      if (m.grid[ny * m.w + nx] === T.EMPTY) {
        g.player.x = nx + 0.5; g.player.y = ny + 0.5;
        g.player.angle = Math.atan2(-dy, -dx);
        return true;
      }
    }
    return false;
  }; true`);

  // -- door open ------------------------------------------------------------
  const placedDoor = await evaluate(`(() => {
    const d = window.__gloamkeep.game.map.doors.find((dd) => dd.locked === 0);
    return window.__standBefore(d.x, d.y);
  })()`);
  ok(placedDoor, 'stood before an unlocked door');
  await key('KeyE', 'e');
  await waitFor(`window.__gloamkeep.game.map.doors.find((dd) => dd.locked === 0).state >= 1`, 'door opening');
  ok(true, 'E opens an unlocked door');

  // -- locked door refuses, key pickup, then it opens -------------------------
  await evaluate(`(() => {
    const d = window.__gloamkeep.game.map.doors.find((dd) => dd.locked === 1);
    return window.__standBefore(d.x, d.y);
  })()`);
  await key('KeyE', 'e');
  await sleep(150);
  const lockedState = await evaluate(`(() => {
    const g = window.__gloamkeep.game;
    const d = g.map.doors.find((dd) => dd.locked === 1);
    return { state: d.state, msg: document.getElementById('hud-message').textContent };
  })()`);
  ok(lockedState.state === 0, 'sealed door refuses without the sigil-key');
  ok(/crimson/i.test(lockedState.msg), `HUD explains the seal ("${lockedState.msg}")`);

  await evaluate(`(() => {
    const g = window.__gloamkeep.game;
    const k = g.items.find((i) => i.kind === 'key1');
    g.player.x = k.x; g.player.y = k.y;
  })()`);
  await waitFor(`window.__gloamkeep.game.player.keys[0]`, 'key pickup');
  ok(true, 'walking over the crimson sigil-key picks it up');
  ok(await evaluate(`document.getElementById('key-1').classList.contains('held')`), 'HUD sigil gem lights up');

  await evaluate(`(() => {
    const d = window.__gloamkeep.game.map.doors.find((dd) => dd.locked === 1);
    return window.__standBefore(d.x, d.y);
  })()`);
  await key('KeyE', 'e');
  await waitFor(`window.__gloamkeep.game.map.doors.find((dd) => dd.locked === 1).state >= 1`, 'locked door opening');
  ok(true, 'sealed door opens once the key is held');

  // -- minimap toggle ---------------------------------------------------------
  ok(await evaluate(`!document.getElementById('minimap').classList.contains('hidden')`), 'minimap starts visible');
  await key('KeyM', 'm');
  await waitFor(`document.getElementById('minimap').classList.contains('hidden')`, 'minimap hides');
  await key('KeyM', 'm');
  await waitFor(`!document.getElementById('minimap').classList.contains('hidden')`, 'minimap returns');
  ok(true, 'M toggles the minimap both ways');

  // -- automap fog of war + hidden vaults (engine state via the debug hook) ----
  const fog = await evaluate(`(() => {
    const g = window.__gloamkeep.game;
    let unexplored = 0;
    for (let i = 0; i < g.explored.length; i++) if (!g.explored[i]) unexplored++;
    return { regions: g.map.hiddenRegions.length, unexplored };
  })()`);
  ok(fog.regions === 0, 'floor 1 keeps no hidden region (vaults live deeper)');
  ok(fog.unexplored > 0, `automap stays fogged where the player has not seen (${fog.unexplored} cells dark)`);

  // -- audio toggle -----------------------------------------------------------
  const sound0 = await evaluate(`document.querySelector('.sound-toggle').textContent`);
  await key('KeyN', 'n');
  await sleep(100);
  const sound1 = await evaluate(`document.querySelector('.sound-toggle').textContent`);
  const soundLS = await evaluate(`localStorage.getItem('arcade.gloamkeep.sound')`);
  ok(sound1 !== sound0, `N toggles sound (${sound0} -> ${sound1})`);
  ok(soundLS === 'on' || soundLS === 'off', 'sound preference persisted to localStorage');
  await key('KeyN', 'n'); // restore
  await sleep(60);

  // -- pause on blur + resume --------------------------------------------------
  await evaluate(`window.dispatchEvent(new Event('blur')); true`);
  await waitFor(`window.__gloamkeep.phase === 'paused'`, 'pause on blur');
  ok(await evaluate(`!document.getElementById('overlay-pause').classList.contains('hidden')`), 'window blur pauses the game');
  await click('#btn-resume');
  await waitFor(`window.__gloamkeep.phase === 'playing'`, 'resume');
  ok(true, 'Resume returns to play');

  // -- damage flow --------------------------------------------------------------
  const hp0 = await evaluate(`window.__gloamkeep.game.player.hp`);
  await evaluate(`(() => {
    const g = window.__gloamkeep.game;
    window.Gloamkeep.damagePlayer(g, 30, g.player.x + 1, g.player.y);
  })()`);
  await waitFor(`document.getElementById('hud-hp-num').textContent === '${hp0 - 30}'`, 'hp hud update');
  ok(await evaluate(`window.__gloamkeep.game.player.hp`) === hp0 - 30, `damage lowers vigor (${hp0} -> ${hp0 - 30})`);

  // -- scoring (shard pickup, needed for the high-score checks) -----------------
  const score0 = await evaluate(`window.__gloamkeep.game.score`);
  await evaluate(`(() => {
    const g = window.__gloamkeep.game;
    const s = g.items.find((i) => i.kind === 'shard' && !i.taken);
    g.player.x = s.x; g.player.y = s.y;
  })()`);
  await waitFor(`window.__gloamkeep.game.score >= ${score0 + 100}`, 'shard score');
  ok(await evaluate(`document.getElementById('hud-score').textContent`) === String(await evaluate(`window.__gloamkeep.game.score`)), 'HUD score updates on shard pickup');

  // -- level exit -----------------------------------------------------------------
  await evaluate(`(() => {
    const g = window.__gloamkeep.game, m = g.map, T = window.Gloamkeep.TILE;
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      if (m.grid[y * m.w + x] === T.EXIT) return window.__standBefore(x, y);
    }
    return false;
  })()`);
  await key('KeyE', 'e');
  await waitFor(`window.__gloamkeep.phase === 'complete'`, 'level complete');
  ok(await evaluate(`!document.getElementById('overlay-complete').classList.contains('hidden')`), 'using the way-sigil clears the floor (tally shown)');
  const carriedScore = await evaluate(`window.__gloamkeep.game.score`);

  await click('#btn-next');
  await waitFor(`window.__gloamkeep.phase === 'playing' && document.getElementById('hud-level').textContent.includes('Gallery')`, 'next level');
  ok(true, 'Continue descends to the next floor');
  ok(await evaluate(`window.__gloamkeep.game.score`) === carriedScore, 'score carries between floors');
  ok(await evaluate(`window.__gloamkeep.game.map.hiddenRegions.length`) === 1, 'the Gallery hides a vault');

  // -- game over + instant restart --------------------------------------------------
  const hpAtFloorStart = await evaluate(`window.__gloamkeep.game.player.hp`);
  await evaluate(`(() => {
    const g = window.__gloamkeep.game;
    window.Gloamkeep.damagePlayer(g, 9999, g.player.x + 1, g.player.y);
  })()`);
  await waitFor(`window.__gloamkeep.phase === 'dead'`, 'death screen');
  ok(await evaluate(`!document.getElementById('overlay-dead').classList.contains('hidden')`), 'death shows the demise overlay');

  // high score was saved on death
  const high = await evaluate(`parseInt(localStorage.getItem('arcade.gloamkeep.high') || '0', 10)`);
  ok(high >= carriedScore, `best score persisted to localStorage (${high} >= ${carriedScore})`);

  await key('KeyR', 'r');
  await waitFor(`window.__gloamkeep.phase === 'playing'`, 'instant restart');
  ok(await evaluate(`window.__gloamkeep.game.player.hp`) === hpAtFloorStart, 'R restarts the floor with the loadout it began with');

  // -- high score shown on the title after a reload -----------------------------------
  await cdp.send('Page.reload');
  await sleep(300);
  await waitFor(`window.__gloamkeep && window.__gloamkeep.phase === 'title'`, 'reload to title');
  const highLine = await evaluate(`document.getElementById('start-high').textContent`);
  ok(/best score \d+/.test(highLine), `title shows the persisted best ("${highLine}")`);

  // -- console noise -------------------------------------------------------------------
  await sleep(200);
  if (errors.length) {
    throw new Error(`console errors on ${label}:\n  ` + errors.join('\n  '));
  }
  ok(true, 'zero non-favicon console errors / exceptions');
}

// --------------------------------------------------------------------------
// main
// --------------------------------------------------------------------------

async function main() {
  const srv = await startServer();
  const httpUrl = `http://127.0.0.1:${srv.address().port}/games/gloamkeep/index.html`;
  const fileUrl = pathToFileURL(join(GAME_DIR, 'index.html')).href;

  const profileDir = await mkdtemp(join(tmpdir(), 'gloamkeep-chrome-'));
  const { proc, port } = await launchChrome(profileDir);

  try {
    for (const [url, label, opts] of [
      [httpUrl, 'http://', {}],
      [fileUrl, 'file://', { denyPointerLock: true }],
    ]) {
      const { cdp, ws } = await openTab(port, url);
      await runScenario(cdp, `${label} (${url})`, opts);
      ws.close();
    }
    console.log(`\nall browser assertions passed (${passed})`);
  } finally {
    proc.kill('SIGKILL');
    srv.close();
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().then(
  () => process.exit(0),
  (err) => { console.error('\nBROWSER TEST FAILED: ' + (err && err.stack || err)); process.exit(1); }
);
