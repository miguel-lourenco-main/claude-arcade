// Headless-Chrome feature tests for Delve. Run with: node test/browser.test.mjs
//
// Self-contained: spawns its own static http server AND also loads the game
// via file://, drives Chrome (/usr/bin/google-chrome) over raw CDP websockets
// (no npm deps), asserts zero non-favicon console errors / page exceptions on
// both origins, and exercises every user-facing feature in the README:
// new run, movement (arrows + wasd), bump attack, wait, pickup, satchel
// open/use/equip/drop/esc, the three FOV states, log scroll-hold + "new" pip,
// the level-up boon overlay, pebble aim mode (t / Esc / direction), HUD agi +
// salve/veil badges, trinket equip, descend/ascend + auto-save,
// reload-and-continue, death (save deleted, death screen), message log,
// audio toggle (button + m), and R restart.

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
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
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

class Page {
  constructor(cdp, sessionId, errors) {
    this.cdp = cdp;
    this.sessionId = sessionId;
    this.errors = errors; // shared array of console errors / exceptions
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
    await sleep(150); // let scripts settle
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

  async click(id) {
    await this.eval(`document.getElementById(${JSON.stringify(id)}).click()`);
    await sleep(30);
  }

  async key(key, code) {
    const text = key.length === 1 ? key : undefined;
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: code || key, text });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: code || key });
    await sleep(15);
  }
}

async function openPage(cdp, errors, label) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const page = new Page(cdp, sessionId, errors);
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

const KEY_CODES = {
  ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
  w: 'KeyW', a: 'KeyA', s: 'KeyS', d: 'KeyD',
};

async function runSuite(page, url, label) {
  console.log(`\n== ${label}: ${url}`);
  await page.navigate(url);
  // clean slate: this origin may hold state from an earlier manual run
  await page.eval('localStorage.clear()');
  await page.navigate(url);

  // --- boot / title screen ---
  assert(await page.eval(`typeof Delve === 'object' && typeof Delve.Game === 'function'`),
    `${label}: scripts loaded (Delve namespace present)`);
  assert(await page.eval(`document.getElementById('title-overlay').classList.contains('show')`),
    `${label}: title overlay shown on boot`);
  assert(await page.eval(`document.getElementById('btn-continue').classList.contains('hidden')`),
    `${label}: continue button hidden with no save`);

  // --- new run boot ---
  await page.click('btn-new');
  assert(await page.eval(`Delve.debug.game !== null && Delve.debug.mode === 'play'`),
    `${label}: new run boots into play mode`);
  assert(!(await page.eval(`document.getElementById('title-overlay').classList.contains('show')`)),
    `${label}: title overlay hidden after new run`);
  assert(await page.eval(`document.getElementById('v-depth').textContent`) === '1 / 9',
    `${label}: sidebar shows depth 1 / 9`);

  // --- message log updates ---
  assert(await page.eval(`document.getElementById('log').textContent.includes('cave-mouth')`),
    `${label}: message log shows the opening messages`);

  // keep the player safe from wandering monsters during the scripted scenario
  await page.eval(`(() => { const g = Delve.debug.game; g.player.maxhp = 500; g.player.hp = 500; })()`);

  // --- movement: arrow key ---
  let mv = await page.eval(`(() => {
    const g = Delve.debug.game, p = g.player;
    const dirs = [['ArrowRight',1,0],['ArrowLeft',-1,0],['ArrowDown',0,1],['ArrowUp',0,-1]];
    for (const [key,dx,dy] of dirs) {
      if (g.walkable(p.x+dx,p.y+dy) && !g.monsterAt(p.x+dx,p.y+dy)) return { key, x:p.x+dx, y:p.y+dy, turn:g.turn };
    }
    return null;
  })()`);
  assert(mv !== null, `${label}: player has a walkable neighbor`);
  await page.key(mv.key, KEY_CODES[mv.key]);
  let after = await page.eval(`(() => { const g = Delve.debug.game; return { x:g.player.x, y:g.player.y, turn:g.turn }; })()`);
  assert(after.x === mv.x && after.y === mv.y, `${label}: arrow key moves the player`);
  assert(after.turn === mv.turn + 1, `${label}: moving consumes a turn`);

  // --- movement: wasd key ---
  mv = await page.eval(`(() => {
    const g = Delve.debug.game, p = g.player;
    const dirs = [['d',1,0],['a',-1,0],['s',0,1],['w',0,-1]];
    for (const [key,dx,dy] of dirs) {
      if (g.walkable(p.x+dx,p.y+dy) && !g.monsterAt(p.x+dx,p.y+dy)) return { key, x:p.x+dx, y:p.y+dy };
    }
    return null;
  })()`);
  await page.key(mv.key, KEY_CODES[mv.key]);
  after = await page.eval(`(() => { const g = Delve.debug.game; return { x:g.player.x, y:g.player.y }; })()`);
  assert(after.x === mv.x && after.y === mv.y, `${label}: wasd key moves the player`);

  // --- wait ---
  const turnBeforeWait = await page.eval(`Delve.debug.game.turn`);
  await page.key('.', 'Period');
  assert(await page.eval(`Delve.debug.game.turn`) === turnBeforeWait + 1,
    `${label}: '.' waits a turn`);

  // --- bump attack ---
  const bump = await page.eval(`(() => {
    const g = Delve.debug.game, p = g.player;
    const dirs = [['ArrowRight',1,0],['ArrowLeft',-1,0],['ArrowDown',0,1],['ArrowUp',0,-1]];
    for (const [key,dx,dy] of dirs) {
      const x = p.x+dx, y = p.y+dy;
      if (g.walkable(x,y) && !g.monsterAt(x,y)) {
        const m = g.spawnMonster('murkling', 1, x, y);
        m.hp = 1; m.maxhp = 1; m.eva = -50; // hit chance clamps at 95%
        g.curFloor.monsters.push(m);
        g.refreshFOV();
        return { key, kills: g.kills, px: p.x, py: p.y };
      }
    }
    return null;
  })()`);
  assert(bump !== null, `${label}: spawned an adjacent monster for the bump test`);
  let killed = false;
  for (let i = 0; i < 25 && !killed; i++) {
    await page.key(bump.key, KEY_CODES[bump.key]);
    killed = (await page.eval(`Delve.debug.game.kills`)) > bump.kills;
  }
  assert(killed, `${label}: bump-attacking an adjacent monster kills it`);
  assert(await page.eval(`document.getElementById('log').textContent.includes('dies')`),
    `${label}: kill is reported in the message log`);

  // --- pickup ---
  await page.eval(`(() => {
    const g = Delve.debug.game, f = g.curFloor;
    f.items = f.items.filter((it) => it.x !== g.player.x || it.y !== g.player.y); // a clean tile
    f.items.push({ x: g.player.x, y: g.player.y, id: 'potion_heal' });
  })()`);
  const invBefore = await page.eval(`Delve.debug.game.player.inventory.length`);
  await page.key('g', 'KeyG');
  assert(await page.eval(`Delve.debug.game.player.inventory.length`) === invBefore + 1,
    `${label}: 'g' picks up the item underfoot`);
  assert(await page.eval(`document.getElementById('log').textContent.includes('You take the glowmoss draught')`),
    `${label}: pickup is reported in the message log`);

  // --- satchel: open, use a potion ---
  await page.eval(`Delve.debug.game.player.hp = 400`); // make the heal observable
  await page.key('i', 'KeyI');
  assert(await page.eval(`document.getElementById('inv-overlay').classList.contains('show')`),
    `${label}: 'i' opens the satchel`);
  assert(await page.eval(`document.getElementById('inv-list').textContent.includes('glowmoss draught')`),
    `${label}: satchel lists the picked-up potion`);
  const potionSlot = await page.eval(
    `Delve.debug.game.player.inventory.findIndex((id) => id === 'potion_heal')`);
  const usedBefore = await page.eval(`Delve.debug.game.itemsUsed`);
  const slotKey = '1234567890'[potionSlot];
  await page.key(slotKey, `Digit${slotKey === '0' ? '0' : slotKey}`);
  assert(!(await page.eval(`document.getElementById('inv-overlay').classList.contains('show')`)),
    `${label}: using an item closes the satchel`);
  assert(await page.eval(`Delve.debug.game.itemsUsed`) === usedBefore + 1,
    `${label}: potion was consumed`);
  assert(await page.eval(`Delve.debug.game.player.hp`) > 400,
    `${label}: healing potion restores HP`);

  // --- satchel: equip a weapon ---
  await page.eval(`Delve.debug.game.player.inventory.push('w_blade')`);
  await page.key('i', 'KeyI');
  const bladeSlot = await page.eval(`Delve.debug.game.player.inventory.indexOf('w_blade')`);
  await page.key('1234567890'[bladeSlot], `Digit${'1234567890'[bladeSlot]}`);
  assert(await page.eval(`Delve.debug.game.player.weapon`) === 'w_blade',
    `${label}: equipping from the satchel wields the weapon`);
  assert(await page.eval(`document.getElementById('v-weapon').textContent`) === 'iron shortblade',
    `${label}: sidebar shows the new weapon`);

  // --- satchel: drop (d + number), then esc close ---
  await page.eval(`Delve.debug.game.player.inventory.push('a_tunic')`);
  await page.key('i', 'KeyI');
  await page.key('d', 'KeyD'); // toggle drop mode (in inv mode 'd' is not movement)
  assert(await page.eval(`document.getElementById('inv-title').textContent`) === 'Drop which item?',
    `${label}: 'd' switches the satchel to drop mode`);
  const tunicSlot = await page.eval(`Delve.debug.game.player.inventory.indexOf('a_tunic')`);
  await page.key('1234567890'[tunicSlot], `Digit${'1234567890'[tunicSlot]}`);
  assert(await page.eval(`(() => { const g = Delve.debug.game; return g.curFloor.items.some((it) => it.id === 'a_tunic' && it.x === g.player.x && it.y === g.player.y); })()`),
    `${label}: dropped item lands on the player's tile`);
  await page.key('i', 'KeyI');
  await page.key('Escape', 'Escape');
  assert(!(await page.eval(`document.getElementById('inv-overlay').classList.contains('show')`)),
    `${label}: Escape closes the satchel`);

  // --- FOV reveal states (via the surveyor scroll, read from the satchel) ---
  await page.eval(`Delve.debug.game.player.inventory.push('scroll_map')`);
  await page.key('i', 'KeyI');
  const scrollSlot = await page.eval(`Delve.debug.game.player.inventory.indexOf('scroll_map')`);
  await page.key('1234567890'[scrollSlot], `Digit${'1234567890'[scrollSlot]}`);
  const fov = await page.eval(`(() => {
    const g = Delve.debug.game, f = g.curFloor;
    let unseen = 0, remembered = 0, visible = 0, outOfRadius = 0;
    for (let y = 0; y < Delve.MAP_H; y++) for (let x = 0; x < Delve.MAP_W; x++) {
      const i = Delve.idx(x, y);
      if (f.visible[i]) {
        visible++;
        if (Math.hypot(x - g.player.x, y - g.player.y) > Delve.FOV_RADIUS + 0.01) outOfRadius++;
      } else if (f.seen[i]) remembered++;
      else unseen++;
    }
    return { unseen, remembered, visible, outOfRadius };
  })()`);
  assert(fov.visible > 0, `${label}: FOV has visible tiles`);
  assert(fov.remembered > 0, `${label}: FOV has remembered (seen, not visible) tiles`);
  assert(fov.unseen > 0, `${label}: FOV has unseen tiles`);
  assert(fov.outOfRadius === 0, `${label}: visible tiles bounded by FOV radius`);

  // --- message log: auto-scroll at bottom, scroll-hold + pip when reading back ---
  await page.eval(`(() => { const g = Delve.debug.game; for (let i = 0; i < 60; i++) g.msg('echo of the delving ' + i); })()`);
  await page.key('.', 'Period'); // a turn renders the backlog
  let logState = await page.eval(`(() => { const el = document.getElementById('log');
    return { atBottom: el.scrollTop + el.clientHeight >= el.scrollHeight - 24,
             pip: !document.getElementById('log-pip').classList.contains('hidden') }; })()`);
  assert(logState.atBottom && !logState.pip,
    `${label}: log auto-scrolls (no pip) while the reader is at the bottom`);
  await page.eval(`document.getElementById('log').scrollTop = 0`);
  await page.eval(`(() => { const g = Delve.debug.game; for (let i = 0; i < 10; i++) g.msg('newer echo ' + i); })()`);
  await page.key('.', 'Period');
  logState = await page.eval(`(() => { const el = document.getElementById('log');
    return { scrollTop: el.scrollTop,
             pip: !document.getElementById('log-pip').classList.contains('hidden') }; })()`);
  assert(logState.scrollTop <= 4, `${label}: log holds its place when scrolled up (scrollTop ${logState.scrollTop})`);
  assert(logState.pip, `${label}: "new" pip appears for unseen messages`);
  await page.click('log-pip');
  logState = await page.eval(`(() => { const el = document.getElementById('log');
    return { atBottom: el.scrollTop + el.clientHeight >= el.scrollHeight - 24,
             pip: !document.getElementById('log-pip').classList.contains('hidden') }; })()`);
  assert(logState.atBottom && !logState.pip, `${label}: clicking the pip jumps to the bottom and clears it`);

  // Regression: a large backlog must scroll INSIDE the log, not balloon the box (and
  // with it the sidebar/page). This only manifests at a real desktop viewport where the
  // canvas reaches its natural size and drives a tall sidebar — the default headless
  // window scales the canvas down and hides the bug — so force a realistic viewport.
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 880, deviceScaleFactor: 1, mobile: false });
  await page.eval(`(() => { const g = Delve.debug.game; for (let i = 0; i < 200; i++) g.msg('deep backlog line ' + i); })()`);
  await page.key('.', 'Period');
  const bound = await page.eval(`(() => {
    const el = document.getElementById('log'), side = document.getElementById('side');
    return { logH: el.clientHeight, logScrollH: el.scrollHeight, sideH: side.clientHeight,
             internalScroll: el.scrollHeight > el.clientHeight + 2,
             logFitsViewport: el.clientHeight <= window.innerHeight,
             pageNotBallooned: document.body.scrollHeight <= window.innerHeight + 4 }; })()`);
  assert(bound.internalScroll,
    `${label}: a long log scrolls internally, not by growing the box (logH ${bound.logH}, scrollH ${bound.logScrollH})`);
  assert(bound.logFitsViewport && bound.pageNotBallooned,
    `${label}: the log box stays within the viewport (logH ${bound.logH}, sideH ${bound.sideH}, bodyScrollH vs winH)`);
  await page.send('Emulation.clearDeviceMetricsOverride');

  // --- level-up stat choice overlay ---
  await page.eval(`Delve.debug.game.player.pendingStat = 1`);
  await page.key('.', 'Period'); // postTurn spots the pending point
  assert(await page.eval(`Delve.debug.mode === 'stat' && document.getElementById('stat-overlay').classList.contains('show')`),
    `${label}: pending stat point opens the boon overlay`);
  const turnInStat = await page.eval(`Delve.debug.game.turn`);
  await page.key('ArrowRight', 'ArrowRight');
  assert(await page.eval(`Delve.debug.game.turn`) === turnInStat,
    `${label}: game input is blocked while choosing a boon`);
  const dmgBefore = await page.eval(`Delve.debug.game.player.dmgBonus`);
  await page.key('2', 'Digit2'); // might
  assert(await page.eval(`Delve.debug.game.player.dmgBonus`) === dmgBefore + 1,
    `${label}: picking might grants +1 damage`);
  assert(await page.eval(`Delve.debug.game.player.pendingStat === 0 && Delve.debug.mode === 'play' && !document.getElementById('stat-overlay').classList.contains('show')`),
    `${label}: spending the point closes the boon overlay`);

  // --- pebble aim mode: esc cancels, direction throws ---
  await page.eval(`Delve.debug.game.player.inventory.push('pebble')`);
  await page.key('t', 'KeyT');
  assert(await page.eval(`Delve.debug.mode === 'aim' && !document.getElementById('aim-banner').classList.contains('hidden')`),
    `${label}: 't' with a pebble enters aim mode with a prompt`);
  await page.key('Escape', 'Escape');
  assert(await page.eval(`Delve.debug.mode === 'play' && document.getElementById('aim-banner').classList.contains('hidden') && Delve.debug.game.player.inventory.includes('pebble')`),
    `${label}: Escape cancels aim mode and keeps the pebble`);
  const turnBeforeThrow = await page.eval(`Delve.debug.game.turn`);
  await page.key('t', 'KeyT');
  await page.key('ArrowRight', 'ArrowRight');
  assert(await page.eval(`!Delve.debug.game.player.inventory.includes('pebble')`),
    `${label}: aiming a direction throws (and consumes) the pebble`);
  assert(await page.eval(`Delve.debug.game.turn`) === turnBeforeThrow + 1,
    `${label}: the throw costs a turn and returns to play mode`);

  // --- HUD: agi row + salve/veil badges ---
  assert(await page.eval(`document.getElementById('v-agi').textContent`) ===
    String(await page.eval(`Delve.debug.game.playerAgi()`)),
    `${label}: sidebar shows the agility stat`);
  // nobody nearby: a hit would spoil the salve and hide its badge
  await page.eval(`(() => { const g = Delve.debug.game; g.curFloor.monsters.length = 0; g.player.salve = 4; g.player.veil = 6; })()`);
  await page.key('.', 'Period'); // tick + sidebar refresh
  const fx = await page.eval(`document.getElementById('v-effects').textContent`);
  assert(fx.includes('✚') && fx.includes('◐'), `${label}: active salve and veil show as HUD badges (${fx})`);
  await page.eval(`(() => { const g = Delve.debug.game; g.player.salve = 0; g.player.veil = 0; })()`);
  await page.key('.', 'Period');

  // --- trinket equip from the satchel ---
  await page.eval(`Delve.debug.game.player.inventory.push('t_keeneye')`);
  await page.key('i', 'KeyI');
  const charmSlot = await page.eval(`Delve.debug.game.player.inventory.indexOf('t_keeneye')`);
  await page.key('1234567890'[charmSlot], `Digit${'1234567890'[charmSlot]}`);
  assert(await page.eval(`Delve.debug.game.player.trinket`) === 't_keeneye',
    `${label}: selecting a trinket in the satchel equips it`);
  assert(await page.eval(`document.getElementById('v-trinket').textContent`) === 'keen-eye charm',
    `${label}: sidebar shows the worn charm`);

  // --- descend stairs + auto-save ---
  await page.eval(`(() => { const g = Delve.debug.game; const d = g.curFloor.down; g.player.x = d.x; g.player.y = d.y; g.refreshFOV(); })()`);
  await page.key('>', 'Period');
  assert(await page.eval(`Delve.debug.game.depth`) === 2, `${label}: '>' descends to floor 2`);
  assert(await page.eval(`document.getElementById('v-depth').textContent`) === '2 / 9',
    `${label}: sidebar shows depth 2 / 9`);
  assert(await page.eval(`localStorage.getItem('arcade.delve.save') !== null`),
    `${label}: descending auto-saves to arcade.delve.save`);

  // --- ascend, floor persistence, re-descend ---
  await page.key('<', 'Comma'); // player arrives on floor 2's up-stairs
  assert(await page.eval(`Delve.debug.game.depth`) === 1, `${label}: '<' climbs back to floor 1`);
  await page.key('>', 'Period'); // arrival tile on floor 1 is its down stairs
  assert(await page.eval(`Delve.debug.game.depth`) === 2, `${label}: '>' descends again to floor 2`);

  // --- reload resumes the run ---
  const beforeReload = await page.eval(`(() => { const g = Delve.debug.game; return { turn: g.turn, depth: g.depth, seed: g.seed }; })()`);
  await page.navigate(url);
  assert(!(await page.eval(`document.getElementById('btn-continue').classList.contains('hidden')`)),
    `${label}: continue button visible after reload with a save`);
  await page.click('btn-continue');
  const resumed = await page.eval(`(() => { const g = Delve.debug.game; return { turn: g.turn, depth: g.depth, seed: g.seed, mode: Delve.debug.mode }; })()`);
  assert(resumed.mode === 'play' && resumed.depth === beforeReload.depth && resumed.turn === beforeReload.turn && resumed.seed === beforeReload.seed,
    `${label}: reload + continue resumes the same run (depth/turn/seed match)`);
  assert(await page.eval(`document.getElementById('log').textContent.includes('You shake off the dark')`),
    `${label}: resume message appears in the log`);

  // --- death: save deleted + death screen ---
  await page.eval(`(() => {
    const g = Delve.debug.game, p = g.player;
    p.hp = 1; p.maxhp = 1; p.eva = -100;
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    for (const [dx,dy] of dirs) {
      const x = p.x+dx, y = p.y+dy;
      if (g.walkable(x,y) && !g.monsterAt(x,y)) {
        const m = g.spawnMonster('oldskyhorror', 9, x, y);
        m.acc = 99; m.state = 'hunt'; m.tx = p.x; m.ty = p.y; m.energy = 99;
        g.curFloor.monsters.push(m);
        return true;
      }
    }
    return false;
  })()`);
  let dead = false;
  for (let i = 0; i < 25 && !dead; i++) {
    await page.key('.', 'Period');
    dead = await page.eval(`Delve.debug.game.over`);
  }
  assert(dead, `${label}: adjacent horror kills the 1-HP player`);
  assert(await page.eval(`document.getElementById('end-overlay').classList.contains('show')`),
    `${label}: death screen shown`);
  assert(await page.eval(`document.getElementById('end-title').textContent`) === 'You died',
    `${label}: death screen says "You died"`);
  assert(await page.eval(`localStorage.getItem('arcade.delve.save') === null`),
    `${label}: death deletes the save`);
  assert(await page.eval(`(JSON.parse(localStorage.getItem('arcade.delve.best')) || {}).runs >= 1`),
    `${label}: lifetime records updated on death`);

  // --- R restart ---
  await page.key('r', 'KeyR');
  const fresh = await page.eval(`(() => { const g = Delve.debug.game; return { turn: g.turn, depth: g.depth, over: g.over, mode: Delve.debug.mode }; })()`);
  assert(fresh.mode === 'play' && fresh.turn === 0 && fresh.depth === 1 && !fresh.over,
    `${label}: 'R' restarts with a fresh run`);
  assert(!(await page.eval(`document.getElementById('end-overlay').classList.contains('show')`)),
    `${label}: death screen hidden after restart`);

  // --- audio toggle: button + 'm' key ---
  const audioBefore = await page.eval(`document.getElementById('audio-toggle').textContent`);
  await page.click('audio-toggle');
  const audioAfter = await page.eval(`document.getElementById('audio-toggle').textContent`);
  assert(audioAfter !== audioBefore && /sound: (on|off)/.test(audioAfter),
    `${label}: audio button toggles the sound label`);
  assert(await page.eval(`['on','off'].includes(localStorage.getItem('arcade.delve.audio'))`),
    `${label}: audio preference persisted to arcade.delve.audio`);
  await page.key('m', 'KeyM');
  assert(await page.eval(`document.getElementById('audio-toggle').textContent`) === audioBefore,
    `${label}: 'm' toggles the sound back`);
}

// ------------------------------------------------------------------------ main

const hardTimeout = setTimeout(() => {
  console.error('FATAL: browser test timed out after 180s');
  process.exit(1);
}, 180000);
hardTimeout.unref();

let chrome = null;
let server = null;
let userDataDir = null;
const consoleErrors = [];

try {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'delve-cdp-'));
  server = await startServer();
  const httpUrl = `http://127.0.0.1:${server.address().port}/index.html`;
  const fileUrl = pathToFileURL(path.join(GAME_DIR, 'index.html')).href;

  ({ proc: chrome, wsUrl: globalThis.__wsUrl } = await launchChrome(userDataDir));
  const cdp = await CDP.connect(globalThis.__wsUrl);

  const httpPage = await openPage(cdp, consoleErrors, 'http');
  await runSuite(httpPage, httpUrl, 'http');

  const filePage = await openPage(cdp, consoleErrors, 'file');
  await runSuite(filePage, fileUrl, 'file');

  console.log('\n== console errors / exceptions');
  assert(consoleErrors.length === 0,
    `zero non-favicon console errors/exceptions on both origins${consoleErrors.length ? `:\n    ${consoleErrors.join('\n    ')}` : ''}`);
} catch (err) {
  failures.push(`suite crashed: ${err.message}`);
  console.error('SUITE ERROR:', err);
} finally {
  if (chrome) chrome.kill('SIGKILL');
  if (server) server.close();
  if (userDataDir) { try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ } }
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('FAILURES:');
  for (const f of failures) console.error(' -', f);
  process.exit(1);
}
process.exit(0);
