// DOM glue: input, overlays, sidebar, log, save slots, sounds. All game
// logic lives in core/game.js.
// Classic script: reads its dependencies from the page-global Delve
// namespace. Load last, after all core and ui scripts.
(function (global) {
  'use strict';
  const Delve = global.Delve = global.Delve || {};
  const { Game, INV_MAX, ITEMS, DEPTH_MAX, Renderer, Sound } = Delve;

  const SAVE_KEY = 'arcade.delve.save';
  const AUDIO_KEY = 'arcade.delve.audio';
  const BEST_KEY = 'arcade.delve.best';

  const $ = (id) => document.getElementById(id);

  const canvas = $('game');
  const renderer = new Renderer(canvas);
  const sound = new Sound(localStorage.getItem(AUDIO_KEY) !== 'off');

  let game = null;
  let mode = 'title'; // title | play | inv | aim | stat | end
  let invDrop = false;
  let logRendered = 0; // cursor into game.logCount (not game.log indices)

  // read-only handles for the headless browser tests
  Delve.debug = {
    get game() { return game; },
    get mode() { return mode; },
  };

  // ---- persistence -----------------------------------------------------------

  const hasSave = () => localStorage.getItem(SAVE_KEY) !== null;
  const clearSave = () => localStorage.removeItem(SAVE_KEY);
  function saveGame() {
    try { localStorage.setItem(SAVE_KEY, game.serialize()); } catch { /* storage full/blocked */ }
  }
  function loadBest() {
    try { return JSON.parse(localStorage.getItem(BEST_KEY)) || { runs: 0, wins: 0, deepest: 0 }; }
    catch { return { runs: 0, wins: 0, deepest: 0 }; }
  }
  function bumpBest(won) {
    const b = loadBest();
    b.runs++;
    if (won) b.wins++;
    b.deepest = Math.max(b.deepest, game.deepest);
    localStorage.setItem(BEST_KEY, JSON.stringify(b));
  }

  // ---- flow --------------------------------------------------------------------

  function newGame() {
    clearSave(); // one run at a time: starting fresh forfeits any old save
    game = new Game();
    enterPlay();
  }

  function continueGame() {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return newGame();
    const g = Game.fromJSON(raw);
    if (!g || g.over) return newGame();
    game = g;
    game.msg('You shake off the dark and press on.', 'note');
    enterPlay();
  }

  function enterPlay() {
    mode = 'play';
    invDrop = false;
    logRendered = 0;
    $('log').textContent = '';
    $('log-pip').classList.add('hidden');
    $('aim-banner').classList.add('hidden');
    $('title-overlay').classList.remove('show');
    $('end-overlay').classList.remove('show');
    $('inv-overlay').classList.remove('show');
    $('stat-overlay').classList.remove('show');
    updateSidebar();
    renderLog();
    // a loaded save can carry unspent level-up points
    if (game.player.pendingStat > 0) openStatChoice();
  }

  function showTitle() {
    mode = 'title';
    const b = loadBest();
    $('title-best').textContent = b.runs
      ? `runs ${b.runs} · wins ${b.wins} · deepest floor ${b.deepest}`
      : 'no delves yet';
    $('btn-continue').classList.toggle('hidden', !hasSave());
    $('title-overlay').classList.add('show');
  }

  function showEnd() {
    mode = 'end';
    const won = game.won;
    $('end-title').textContent = won ? 'The First Pearl is yours' : 'You died';
    $('end-title').classList.toggle('won', won);
    $('end-cause').textContent = won
      ? 'You carry a piece of the old sky back toward the light.'
      : `Slain by a ${game.cause} on floor ${game.depth}.`;
    const p = game.player;
    $('end-stats').innerHTML = '';
    for (const [k, v] of [
      ['turns', game.turn],
      ['deepest floor', `${game.deepest} / ${DEPTH_MAX}`],
      ['kills', game.kills],
      ['items found', game.itemsFound],
      ['items used', game.itemsUsed],
      ['level', `${p.level} (${p.xp} xp)`],
    ]) {
      const row = document.createElement('div');
      row.className = 'stat-row';
      const a = document.createElement('span');
      a.textContent = k;
      const b = document.createElement('b');
      b.textContent = v;
      row.append(a, b);
      $('end-stats').appendChild(row);
    }
    $('end-overlay').classList.add('show');
  }

  // ---- per-turn bookkeeping ------------------------------------------------------

  function postTurn() {
    for (const ev of game.events) {
      switch (ev.type) {
        case 'descend':
        case 'ascend':
          saveGame(); // permadeath checkpoint: auto-save on stairs
          sound.play('stairs');
          break;
        case 'hit':
          renderer.addEffect({ kind: 'flash', x: ev.x, y: ev.y, color: '#e8b45a' });
          sound.play('hit');
          break;
        case 'hurt':
          renderer.addEffect({ kind: 'flash', x: ev.x, y: ev.y, color: '#ff5040' });
          sound.play('hurt');
          break;
        case 'kill':
          renderer.addEffect({ kind: 'flash', x: ev.x, y: ev.y, color: '#ff7d6e' });
          sound.play('kill');
          break;
        case 'spit':
          renderer.addEffect({ kind: 'spit', fx: ev.fx, fy: ev.fy, tx: ev.tx, ty: ev.ty });
          sound.play('spit');
          break;
        case 'throw':
          renderer.addEffect({ kind: 'flash', x: ev.tx, y: ev.ty, color: '#9aa0a8' });
          sound.play('miss');
          break;
        case 'miss': sound.play('miss'); break;
        case 'pickup': sound.play('pickup'); break;
        case 'potion': sound.play('potion'); break;
        case 'scroll': sound.play('scroll'); break;
        case 'teleport': sound.play('teleport'); break;
        case 'equip': sound.play('equip'); break;
        case 'levelup': sound.play('levelup'); break;
        case 'death':
          clearSave(); // permadeath: death deletes the save
          bumpBest(false);
          sound.play('death');
          showEnd();
          break;
        case 'win':
          clearSave();
          bumpBest(true);
          sound.play('win');
          showEnd();
          break;
      }
    }
    game.events.length = 0;
    updateSidebar();
    renderLog();
    if (!game.over && mode === 'play' && game.player.pendingStat > 0) openStatChoice();
  }

  function updateSidebar() {
    const p = game.player;
    $('v-depth').textContent = `${game.depth} / ${DEPTH_MAX}`;
    $('v-turn').textContent = game.turn;
    const hpFrac = Math.max(0, p.hp / p.maxhp);
    $('hp-fill').style.width = `${hpFrac * 100}%`;
    $('hp-fill').className = hpFrac > 0.5 ? '' : hpFrac > 0.25 ? 'warn' : 'crit';
    $('hp-text').textContent = `HP ${p.hp} / ${p.maxhp}`;
    const need = game.xpNext(p.level);
    $('xp-fill').style.width = `${Math.min(100, (p.xp / need) * 100)}%`;
    $('xp-text').textContent = `LVL ${p.level} · ${p.xp}/${need} xp`;
    const [d0, d1] = game.playerDmg();
    $('v-atk').textContent = `${d0 + p.dmgBonus}–${d1 + p.dmgBonus} (acc ${game.playerAcc()})`;
    $('v-def').textContent = `${game.armorOf(p)} (eva ${game.playerEva()})`;
    $('v-agi').textContent = `${game.playerAgi()}`;
    $('v-weapon').textContent = p.weapon ? ITEMS[p.weapon].name : 'bare hands';
    $('v-armor').textContent = p.armor ? ITEMS[p.armor].name : 'nothing';
    $('v-trinket').textContent = p.trinket ? ITEMS[p.trinket].name : 'none';
    $('v-sack').textContent = `${p.inventory.length} / ${INV_MAX}`;
    const fx = [];
    if (p.haste > 0) fx.push(`hasted (${p.haste})`);
    if (p.salve > 0) fx.push(`✚${p.salve}`);
    if (p.veil > 0) fx.push(`◐${p.veil}`);
    if (p.hp < p.maxhp && !game.curFloor.monsters.some((m) => game.isVisible(m.x, m.y))) {
      fx.push('· regen');
    }
    $('v-effects').textContent = fx.join(' ');
  }

  // Auto-scrolls only while the reader is at the bottom; otherwise the scroll
  // position holds and a "new" pip appears. game.logCount keeps the cursor
  // valid even when the core trims old entries.
  function renderLog() {
    const el = $('log');
    const entries = game.log;
    const total = game.logCount;
    if (logRendered > total) { el.textContent = ''; logRendered = 0; }
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
    const dropped = total - entries.length;
    let appended = false;
    for (let i = Math.max(0, logRendered - dropped); i < entries.length; i++) {
      const { t, c } = entries[i];
      const div = document.createElement('div');
      div.className = `m-${c}`;
      div.textContent = t;
      el.appendChild(div);
      appended = true;
    }
    logRendered = total;
    while (el.childNodes.length > 400) el.removeChild(el.firstChild);
    if (atBottom) {
      el.scrollTop = el.scrollHeight;
      $('log-pip').classList.add('hidden');
    } else if (appended) {
      $('log-pip').classList.remove('hidden');
    }
  }

  $('log').addEventListener('scroll', () => {
    const el = $('log');
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) {
      $('log-pip').classList.add('hidden');
    }
  });
  $('log-pip').addEventListener('click', () => {
    const el = $('log');
    el.scrollTop = el.scrollHeight;
    $('log-pip').classList.add('hidden');
  });

  // ---- inventory overlay -----------------------------------------------------------

  const INV_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

  function openInventory() {
    mode = 'inv';
    invDrop = false;
    renderInventory();
    $('inv-overlay').classList.add('show');
  }

  function closeInventory() {
    mode = 'play';
    $('inv-overlay').classList.remove('show');
  }

  function renderInventory() {
    const p = game.player;
    $('inv-title').textContent = invDrop ? 'Drop which item?' : 'Satchel';
    $('inv-equipped').textContent =
      `wielding: ${p.weapon ? ITEMS[p.weapon].name : 'bare hands'} · wearing: ${p.armor ? ITEMS[p.armor].name : 'nothing'}` +
      ` · charm: ${p.trinket ? ITEMS[p.trinket].name : 'none'}`;
    const list = $('inv-list');
    list.innerHTML = '';
    if (!p.inventory.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'Your satchel is empty.';
      list.appendChild(li);
    }
    p.inventory.forEach((id, i) => {
      const d = ITEMS[id];
      const li = document.createElement('li');
      const key = document.createElement('b');
      key.textContent = INV_KEYS[i];
      const glyph = document.createElement('span');
      glyph.className = 'inv-glyph';
      glyph.textContent = d.glyph;
      glyph.style.color = d.color;
      const name = document.createElement('span');
      let note = '';
      if (d.kind === 'potion') note = d.effect === 'salve' ? ' — apply' : ' — quaff';
      else if (d.kind === 'scroll') note = ' — read';
      else if (d.kind === 'weapon') note = ` — wield (${d.dmg[0]}–${d.dmg[1]})`;
      else if (d.kind === 'armor') note = ` — wear (+${d.def} def)`;
      else if (d.kind === 'trinket') note = ` — wear (${d.note})`;
      else if (d.kind === 'thrown') note = ' — throw';
      name.textContent = ` ${d.name}${note}`;
      li.append(key, glyph, name);
      li.addEventListener('click', () => invPick(i));
      list.appendChild(li);
    });
    $('inv-hint').textContent = invDrop
      ? 'press a number to drop it · d cancel · i / esc close'
      : '1–0 use or equip · d then a number to drop · i / esc close';
  }

  function invPick(i) {
    if (i >= game.player.inventory.length) return;
    if (!invDrop && ITEMS[game.player.inventory[i]].kind === 'thrown') {
      closeInventory();
      enterAim();
      return;
    }
    const took = game.act({ type: invDrop ? 'drop' : 'use', index: i });
    closeInventory();
    if (took) postTurn();
  }

  // ---- pebble aim mode ---------------------------------------------------------

  function enterAim() {
    mode = 'aim';
    $('aim-banner').classList.remove('hidden');
  }

  function exitAim() {
    mode = 'play';
    $('aim-banner').classList.add('hidden');
  }

  // ---- level-up stat choice ------------------------------------------------------

  const STAT_KEYS = { 1: 'vigor', 2: 'might', 3: 'agility', 4: 'focus' };

  function openStatChoice() {
    mode = 'stat';
    $('stat-overlay').classList.add('show');
  }

  function pickStat(name) {
    if (!game.applyStat(name)) return;
    updateSidebar();
    renderLog();
    if (game.player.pendingStat <= 0) {
      mode = 'play';
      $('stat-overlay').classList.remove('show');
    }
  }

  for (const li of document.querySelectorAll('#stat-list li')) {
    li.addEventListener('click', () => { if (mode === 'stat') pickStat(li.dataset.stat); });
  }

  // ---- input ----------------------------------------------------------------------

  const MOVE_KEYS = {
    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    k: [0, -1], j: [0, 1], h: [-1, 0], l: [1, 0],
    y: [-1, -1], u: [1, -1], b: [-1, 1], n: [1, 1],
    w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
  };
  const NUMPAD = {
    Numpad8: [0, -1], Numpad2: [0, 1], Numpad4: [-1, 0], Numpad6: [1, 0],
    Numpad7: [-1, -1], Numpad9: [1, -1], Numpad1: [-1, 1], Numpad3: [1, 1],
  };

  function toggleSound() {
    sound.on = !sound.on;
    localStorage.setItem(AUDIO_KEY, sound.on ? 'on' : 'off');
    $('audio-toggle').textContent = `sound: ${sound.on ? 'on' : 'off'}`;
  }

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    sound.unlock();
    const k = e.key;

    if (k === 'm' || k === 'M') {
      if (mode !== 'inv') { toggleSound(); e.preventDefault(); return; }
    }

    if (mode === 'title') {
      if (k === 'Enter' || k === ' ') { newGame(); e.preventDefault(); }
      else if ((k === 'c' || k === 'C') && hasSave()) { continueGame(); e.preventDefault(); }
      return;
    }

    if (mode === 'end') {
      if (k === 'Enter' || k === 'r' || k === 'R' || k === ' ') { newGame(); e.preventDefault(); }
      return;
    }

    if (mode === 'inv') {
      if (k === 'Escape' || k === 'i' || k === 'I') { closeInventory(); e.preventDefault(); return; }
      if (k === 'd' || k === 'D') { invDrop = !invDrop; renderInventory(); e.preventDefault(); return; }
      const ki = INV_KEYS.indexOf(k);
      if (ki >= 0) { invPick(ki); e.preventDefault(); }
      return;
    }

    if (mode === 'stat') {
      if (k in STAT_KEYS) { pickStat(STAT_KEYS[k]); e.preventDefault(); }
      return; // everything else is blocked until the boon is chosen
    }

    if (mode === 'aim') {
      if (k === 'Escape' || k === 't' || k === 'T') { exitAim(); e.preventDefault(); return; }
      let dir = null;
      if (e.code in NUMPAD) dir = NUMPAD[e.code];
      else if (k in MOVE_KEYS) dir = MOVE_KEYS[k];
      if (dir) {
        e.preventDefault();
        exitAim();
        const took = game.act({ type: 'throw', dx: dir[0], dy: dir[1] });
        if (took) postTurn();
        else renderLog();
      }
      return;
    }

    // ---- play mode ----
    if (game.over) { showEnd(); return; }
    let action = null;
    if (e.code in NUMPAD) action = { type: 'move', dx: NUMPAD[e.code][0], dy: NUMPAD[e.code][1] };
    else if (e.code === 'Numpad5') action = { type: 'wait' };
    else if (k in MOVE_KEYS && !e.shiftKey) action = { type: 'move', dx: MOVE_KEYS[k][0], dy: MOVE_KEYS[k][1] };
    else if (k === '.') action = { type: 'wait' };
    else if (k === 'g' || k === 'G' || k === ',') action = { type: 'pickup' };
    else if (k === '>') action = { type: 'descend' };
    else if (k === '<') action = { type: 'ascend' };
    else if (k === 'i' || k === 'I') { openInventory(); e.preventDefault(); return; }
    else if (k === 't' || k === 'T') {
      e.preventDefault();
      if (game.player.inventory.includes('pebble')) enterAim();
      else { game.msg('You have no pebble to throw.', 'note'); renderLog(); }
      return;
    }
    if (!action) return;
    e.preventDefault();
    const took = game.act(action);
    if (took) postTurn();
    else renderLog(); // "there is nothing here", etc.
  });

  // pointer support for the title/end buttons
  $('btn-new').addEventListener('click', () => { sound.unlock(); newGame(); });
  $('btn-continue').addEventListener('click', () => { sound.unlock(); continueGame(); });
  $('btn-again').addEventListener('click', () => { sound.unlock(); newGame(); });
  $('audio-toggle').addEventListener('click', () => { sound.unlock(); toggleSound(); });

  // ---- render loop (visual flicker/effects only; logic is turn-based) --------------

  function frame(now) {
    if (game) renderer.draw(game, now);
    requestAnimationFrame(frame);
  }

  $('audio-toggle').textContent = `sound: ${sound.on ? 'on' : 'off'}`;
  showTitle();
  requestAnimationFrame(frame);
})(globalThis);
