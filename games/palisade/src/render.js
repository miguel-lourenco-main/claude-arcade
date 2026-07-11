// Palisade — canvas renderer. All art is drawn procedurally; nothing is loaded.
// Owns transient visual FX (particles, float text, beams, rings) fed from engine events.

import { CELL, COLS, ROWS, W, H, posAt, cellKey } from './engine/maps.js';
import { TOWERS } from './engine/data.js';
import { towerStats } from './engine/game.js';

const CREEP_COLORS = {
  normal: '#c9a86a',
  fast: '#e3d873',
  tank: '#b56d5e',
  regen: '#c987cf',
  swarm: '#d8cdb4',
};

const TOWER_ACCENTS = {
  arrow: '#e0b568',
  splash: '#d97e50',
  frost: '#74c7e8',
  poison: '#8ccb5e',
};

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.terrain = document.createElement('canvas');
    this.terrain.width = W;
    this.terrain.height = H;
    this.particles = [];
    this.floats = [];
    this.beams = [];
    this.rings = [];
    this.shots = []; // muzzle flashes
    this.t = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    this.dpr = dpr;
  }

  // ------------------------------------------------------------ terrain

  setMap(map) {
    this.map = map;
    const g = this.terrain.getContext('2d');
    // Grass
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        const n = hash(c, r);
        const l = 7 + n * 3.5;
        g.fillStyle = `hsl(${112 + n * 14}, 16%, ${l}%)`;
        g.fillRect(c * CELL, r * CELL, CELL, CELL);
        // speckles
        for (let i = 0; i < 3; i++) {
          const sx = c * CELL + hash(c * 7 + i, r * 3) * CELL;
          const sy = r * CELL + hash(c * 3, r * 7 + i) * CELL;
          g.fillStyle = `rgba(120,150,90,${0.05 + hash(c + i, r - i) * 0.07})`;
          g.fillRect(sx, sy, 2, 2);
        }
      }
    }
    // Path cells (dirt)
    for (const k of map.pathCells) {
      const [c, r] = k.split(',').map(Number);
      const n = hash(c * 5, r * 5);
      g.fillStyle = `hsl(${30 + n * 8}, ${22 + n * 6}%, ${15 + n * 4}%)`;
      g.fillRect(c * CELL, r * CELL, CELL, CELL);
      for (let i = 0; i < 4; i++) {
        const sx = c * CELL + hash(c * 11 + i, r) * (CELL - 4);
        const sy = r * CELL + hash(c, r * 11 + i) * (CELL - 4);
        g.fillStyle = `rgba(190,160,110,${0.06 + hash(c - i, r + i) * 0.08})`;
        g.fillRect(sx, sy, 3, 2);
      }
    }
    // Path edge glow
    g.strokeStyle = 'rgba(220,180,110,0.12)';
    g.lineWidth = 1;
    for (const k of map.pathCells) {
      const [c, r] = k.split(',').map(Number);
      const edges = [[c, r - 1, 0], [c, r + 1, 1], [c - 1, r, 2], [c + 1, r, 3]];
      for (const [nc, nr, side] of edges) {
        if (map.pathCells.has(cellKey(nc, nr))) continue;
        g.beginPath();
        if (side === 0) { g.moveTo(c * CELL, r * CELL + 0.5); g.lineTo(c * CELL + CELL, r * CELL + 0.5); }
        if (side === 1) { g.moveTo(c * CELL, r * CELL + CELL - 0.5); g.lineTo(c * CELL + CELL, r * CELL + CELL - 0.5); }
        if (side === 2) { g.moveTo(c * CELL + 0.5, r * CELL); g.lineTo(c * CELL + 0.5, r * CELL + CELL); }
        if (side === 3) { g.moveTo(c * CELL + CELL - 0.5, r * CELL); g.lineTo(c * CELL + CELL - 0.5, r * CELL + CELL); }
        g.stroke();
      }
    }
    // Direction chevrons along each path
    g.strokeStyle = 'rgba(230,200,140,0.16)';
    g.lineWidth = 2;
    for (const path of map.paths) {
      for (let s = 40; s < path.total - 20; s += 96) {
        const p = posAt(path, s);
        const a = Math.atan2(p.dy, p.dx);
        g.save();
        g.translate(p.x, p.y);
        g.rotate(a);
        g.beginPath();
        g.moveTo(-3, -5); g.lineTo(3, 0); g.lineTo(-3, 5);
        g.stroke();
        g.restore();
      }
    }
    // Water
    for (const k of map.waterCells) {
      const [c, r] = k.split(',').map(Number);
      g.fillStyle = '#0d2130';
      g.fillRect(c * CELL, r * CELL, CELL, CELL);
    }
    g.strokeStyle = 'rgba(110,190,230,0.15)';
    for (const k of map.waterCells) {
      const [c, r] = k.split(',').map(Number);
      g.strokeRect(c * CELL + 0.5, r * CELL + 0.5, CELL - 1, CELL - 1);
    }
    // Exit gate (a little palisade door) at the end of each path + entry marker
    for (const path of map.paths) {
      const end = posAt(path, path.total);
      this.drawGate(g, end);
      const start = posAt(path, 0);
      g.fillStyle = 'rgba(230,120,90,0.5)';
      g.save();
      g.translate(start.x, start.y);
      g.rotate(Math.atan2(start.dy, start.dx));
      g.beginPath();
      g.moveTo(2, -9); g.lineTo(12, 0); g.lineTo(2, 9);
      g.closePath();
      g.fill();
      g.restore();
    }
    this.particles = [];
    this.floats = [];
    this.beams = [];
    this.rings = [];
    this.shots = [];
  }

  drawGate(g, end) {
    g.save();
    g.translate(end.x, end.y);
    g.rotate(Math.atan2(end.dy, end.dx));
    // stakes
    g.fillStyle = '#4c3d27';
    for (let i = -2; i <= 2; i++) {
      if (i === 0) continue;
      g.fillRect(6, i * 6 - 2, 8, 4);
    }
    g.fillStyle = '#6b5433';
    g.fillRect(8, -14, 4, 28);
    g.restore();
  }

  // ------------------------------------------------------------ FX from events

  spawnFromEvents(events) {
    for (const e of events) {
      switch (e.t) {
        case 'death': {
          const col = CREEP_COLORS[e.ctype] || '#ccc';
          for (let i = 0; i < 10; i++) {
            const a = Math.random() * Math.PI * 2, sp = 30 + Math.random() * 80;
            this.particles.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20, ttl: 0.5, life: 0.5, color: col, size: 2 + Math.random() * 2, grav: 140 });
          }
          this.floats.push({ x: e.x, y: e.y - 10, text: '+' + e.bounty, ttl: 0.9, life: 0.9, color: '#ffd96b' });
          break;
        }
        case 'leak': {
          for (let i = 0; i < 8; i++) {
            const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 60;
            this.particles.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, ttl: 0.6, life: 0.6, color: '#ff5a5a', size: 3, grav: 0 });
          }
          this.floats.push({ x: e.x, y: e.y - 12, text: '-' + e.lives + (e.lives > 1 ? ' lives' : ' life'), ttl: 1.2, life: 1.2, color: '#ff6b6b' });
          break;
        }
        case 'explosion': {
          this.rings.push({ x: e.x, y: e.y, r: e.r, ttl: 0.3, life: 0.3, color: '#ffb066' });
          for (let i = 0; i < 14; i++) {
            const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 110;
            this.particles.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, ttl: 0.35, life: 0.35, color: i % 3 ? '#ffb066' : '#ffe2a8', size: 2 + Math.random() * 2.5, grav: 40 });
          }
          break;
        }
        case 'frostHit':
          this.beams.push({ x1: e.x1, y1: e.y1 - 8, x2: e.x2, y2: e.y2, ttl: 0.12, life: 0.12, color: '#a8e2ff' });
          this.rings.push({ x: e.x2, y: e.y2, r: 12, ttl: 0.25, life: 0.25, color: '#74c7e8' });
          break;
        case 'hit':
          for (let i = 0; i < 4; i++) {
            const a = Math.random() * Math.PI * 2, sp = 30 + Math.random() * 50;
            this.particles.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, ttl: 0.2, life: 0.2, color: e.kind === 'poison' ? '#8ccb5e' : '#ffe2a8', size: 1.5, grav: 0 });
          }
          break;
        case 'shot':
          this.shots.push({ x: e.x, y: e.y - 8, ttl: 0.07, life: 0.07 });
          break;
        case 'place':
          this.rings.push({ x: e.x, y: e.y, r: 20, ttl: 0.3, life: 0.3, color: '#c9d8a0' });
          break;
        case 'upgrade':
          this.rings.push({ x: e.x, y: e.y, r: 24, ttl: 0.4, life: 0.4, color: '#ffd96b' });
          this.floats.push({ x: e.x, y: e.y - 18, text: '★'.repeat(e.level), ttl: 0.9, life: 0.9, color: '#ffd96b' });
          break;
        case 'sell':
          this.floats.push({ x: e.x, y: e.y - 12, text: '+' + e.refund, ttl: 0.9, life: 0.9, color: '#ffd96b' });
          break;
        case 'earlyBonus':
          this.floats.push({ x: W / 2, y: 40, text: 'early call +' + e.gold, ttl: 1.4, life: 1.4, color: '#9be89b' });
          break;
        case 'waveClear':
          this.floats.push({ x: W / 2, y: H / 2 - 40, text: 'wave ' + (e.wave + 1) + ' clear  +' + e.bonus, ttl: 1.6, life: 1.6, color: '#c9d8a0' });
          break;
      }
    }
  }

  updateFx(dt) {
    this.t += dt;
    for (const p of this.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += (p.grav || 0) * dt;
      p.ttl -= dt;
    }
    this.particles = this.particles.filter(p => p.ttl > 0);
    for (const f of this.floats) { f.y -= 22 * dt; f.ttl -= dt; }
    this.floats = this.floats.filter(f => f.ttl > 0);
    for (const b of this.beams) b.ttl -= dt;
    this.beams = this.beams.filter(b => b.ttl > 0);
    for (const r of this.rings) r.ttl -= dt;
    this.rings = this.rings.filter(r => r.ttl > 0);
    for (const s of this.shots) s.ttl -= dt;
    this.shots = this.shots.filter(s => s.ttl > 0);
  }

  // ------------------------------------------------------------ frame

  draw(state, alpha, ui) {
    const g = this.ctx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.drawImage(this.terrain, 0, 0);

    // Water shimmer
    g.save();
    g.strokeStyle = 'rgba(120,200,240,0.10)';
    g.lineWidth = 1.5;
    for (const k of state.map.waterCells) {
      const [c, r] = k.split(',').map(Number);
      const ph = this.t * 1.6 + hash(c, r) * 6.28;
      const y = r * CELL + CELL / 2 + Math.sin(ph) * 5;
      g.beginPath();
      g.moveTo(c * CELL + 5, y);
      g.quadraticCurveTo(c * CELL + CELL / 2, y - 3, c * CELL + CELL - 5, y);
      g.stroke();
    }
    g.restore();

    // Placement grid hint
    if (ui.placingType) {
      g.strokeStyle = 'rgba(255,255,255,0.045)';
      g.lineWidth = 1;
      g.beginPath();
      for (let c = 1; c < COLS; c++) { g.moveTo(c * CELL + 0.5, 0); g.lineTo(c * CELL + 0.5, H); }
      for (let r = 1; r < ROWS; r++) { g.moveTo(0, r * CELL + 0.5); g.lineTo(W, r * CELL + 0.5); }
      g.stroke();
    }

    this.drawTowers(state, ui);
    this.drawCreeps(state, alpha);
    this.drawProjectiles(state, alpha);
    this.drawFx(g);
    this.drawPreview(state, ui);
  }

  // ------------------------------------------------------------ towers

  drawTowers(state, ui) {
    const g = this.ctx;
    for (const tw of state.towers) {
      const sel = tw.id === ui.selectedId;
      const hov = ui.hover && ui.hover.c === tw.c && ui.hover.r === tw.r && !ui.placingType;
      if (sel || hov) this.drawRange(tw.x, tw.y, towerStats(tw).range, true, sel ? 0.5 : 0.3);
    }
    for (const tw of state.towers) this.drawTower(g, tw);
  }

  drawTower(g, tw) {
    const { x, y, type, level } = tw;
    const acc = TOWER_ACCENTS[type];
    // plinth
    g.fillStyle = '#20262e';
    g.strokeStyle = '#39424e';
    g.lineWidth = 1;
    const s = 12 + level;
    g.beginPath();
    g.roundRect(x - s, y - s, s * 2, s * 2, 4);
    g.fill(); g.stroke();
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath();
    g.roundRect(x - s + 3, y - s + 3, s * 2 - 6, s * 2 - 6, 3);
    g.fill();

    g.save();
    g.translate(x, y - 2);
    if (type === 'arrow') {
      g.rotate(tw.aim);
      g.fillStyle = acc;
      g.strokeStyle = acc;
      g.lineWidth = 2;
      // bolt-thrower: a chevron with a rail; more prongs per level
      g.beginPath();
      g.moveTo(10 + level * 2, 0); g.lineTo(-4, -6 - level); g.lineTo(-1, 0); g.lineTo(-4, 6 + level);
      g.closePath();
      g.fill();
      if (level >= 1) { g.beginPath(); g.moveTo(-6, -8); g.lineTo(2, 0); g.lineTo(-6, 8); g.stroke(); }
      if (level >= 2) { g.strokeStyle = '#fff3d6'; g.beginPath(); g.moveTo(-9, -9); g.lineTo(0, 0); g.lineTo(-9, 9); g.stroke(); }
    } else if (type === 'splash') {
      // mortar: fat barrel aimed at target
      g.rotate(tw.aim);
      g.fillStyle = '#2c333c';
      g.beginPath(); g.arc(0, 0, 8 + level, 0, Math.PI * 2); g.fill();
      g.fillStyle = acc;
      g.fillRect(0, -3 - level, 12 + level * 2, 6 + level * 2);
      g.beginPath(); g.arc(0, 0, 5 + level, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#1a1e24';
      g.beginPath(); g.arc(0, 0, 2.5 + level * 0.5, 0, Math.PI * 2); g.fill();
      if (level >= 2) { g.strokeStyle = '#ffd9b0'; g.lineWidth = 1.5; g.beginPath(); g.arc(0, 0, 9.5, 0, Math.PI * 2); g.stroke(); }
    } else if (type === 'frost') {
      // crystal spire
      const pulse = 0.75 + 0.25 * Math.sin(this.t * 3 + tw.id);
      g.fillStyle = acc;
      g.globalAlpha = pulse;
      const h = 11 + level * 2;
      g.beginPath();
      g.moveTo(0, -h); g.lineTo(6 + level, 0); g.lineTo(0, h * 0.6); g.lineTo(-6 - level, 0);
      g.closePath(); g.fill();
      g.globalAlpha = 1;
      g.strokeStyle = '#d8f2ff';
      g.lineWidth = 1;
      g.stroke();
      if (level >= 1) {
        g.fillStyle = 'rgba(168,226,255,0.7)';
        g.beginPath(); g.moveTo(-8 - level, 2); g.lineTo(-5, -4 - level); g.lineTo(-3, 2); g.closePath(); g.fill();
        g.beginPath(); g.moveTo(8 + level, 2); g.lineTo(5, -4 - level); g.lineTo(3, 2); g.closePath(); g.fill();
      }
      if (level >= 2) { g.strokeStyle = 'rgba(168,226,255,0.5)'; g.beginPath(); g.arc(0, 0, 12, 0, Math.PI * 2); g.stroke(); }
    } else if (type === 'poison') {
      // thorny bulb
      g.fillStyle = '#3a5231';
      g.beginPath(); g.arc(0, 2, 7 + level, 0, Math.PI * 2); g.fill();
      g.fillStyle = acc;
      const b = 5 + level;
      g.beginPath(); g.arc(0, -2, b, 0, Math.PI * 2); g.fill();
      g.strokeStyle = acc;
      g.lineWidth = 1.5;
      const spikes = 5 + level * 2;
      for (let i = 0; i < spikes; i++) {
        const a = (i / spikes) * Math.PI * 2 + this.t * 0.4;
        g.beginPath();
        g.moveTo(Math.cos(a) * b, -2 + Math.sin(a) * b);
        g.lineTo(Math.cos(a) * (b + 4), -2 + Math.sin(a) * (b + 4));
        g.stroke();
      }
      g.fillStyle = '#e4ffc9';
      g.beginPath(); g.arc(-1.5, -3.5, 1.5 + level * 0.5, 0, Math.PI * 2); g.fill();
    }
    g.restore();

    // level pips
    g.fillStyle = '#ffd96b';
    for (let i = 0; i < tw.level; i++) {
      g.fillRect(x - 5 + i * 5, y + s - 3, 3, 3);
    }
  }

  drawRange(x, y, r, valid, a = 0.4) {
    const g = this.ctx;
    g.save();
    g.strokeStyle = valid ? `rgba(200,220,160,${a})` : `rgba(255,90,90,${a + 0.2})`;
    g.fillStyle = valid ? `rgba(200,220,160,${a * 0.12})` : `rgba(255,90,90,0.1)`;
    g.lineWidth = 1.5;
    g.setLineDash([5, 4]);
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.restore();
  }

  // ------------------------------------------------------------ creeps

  drawCreeps(state, alpha) {
    const g = this.ctx;
    for (const c of state.creeps) {
      if (c.dead) continue;
      const s = c.prevS + (c.s - c.prevS) * alpha;
      const p = posAt(state.map.paths[c.pathIdx], s);
      const ang = Math.atan2(p.dy, p.dx);
      const col = CREEP_COLORS[c.type];
      const slowed = c.slowUntil > state.time;
      const poisoned = c.poisonUntil > state.time;

      g.save();
      g.translate(p.x, p.y);
      // shadow
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath();
      g.ellipse(0, c.radius * 0.7, c.radius * 0.9, c.radius * 0.4, 0, 0, Math.PI * 2);
      g.fill();

      g.rotate(ang);
      const wob = Math.sin(this.t * 10 + c.id * 2.1) * 1.2;

      if (c.type === 'fast') {
        g.fillStyle = col;
        g.beginPath();
        g.moveTo(c.radius + 3, 0); g.lineTo(-c.radius, -c.radius * 0.8 + wob * 0.4); g.lineTo(-c.radius * 0.4, 0); g.lineTo(-c.radius, c.radius * 0.8 - wob * 0.4);
        g.closePath(); g.fill();
        g.fillStyle = '#3a3620';
        g.beginPath(); g.arc(c.radius * 0.3, 0, 1.6, 0, Math.PI * 2); g.fill();
      } else if (c.type === 'tank') {
        g.fillStyle = '#6e4038';
        g.beginPath(); g.roundRect(-c.radius, -c.radius * 0.85, c.radius * 2, c.radius * 1.7, 3); g.fill();
        g.fillStyle = col;
        g.beginPath(); g.roundRect(-c.radius + 2, -c.radius * 0.85 + 2, c.radius * 2 - 4, c.radius * 1.7 - 4, 2); g.fill();
        // plates
        g.strokeStyle = '#6e4038';
        g.lineWidth = 1.5;
        for (let i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(i * 6 + wob * 0.2, -c.radius * 0.85 + 2); g.lineTo(i * 6, c.radius * 0.85 - 2); g.stroke(); }
        g.fillStyle = '#2c1a16';
        g.beginPath(); g.arc(c.radius * 0.5, 0, 2, 0, Math.PI * 2); g.fill();
      } else if (c.type === 'swarm') {
        g.fillStyle = col;
        g.beginPath(); g.arc(wob * 0.5, 0, c.radius, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(0,0,0,0.4)';
        g.beginPath(); g.arc(c.radius * 0.35, 0, 1.1, 0, Math.PI * 2); g.fill();
      } else {
        // normal + regen: blob with feet
        g.fillStyle = col;
        g.beginPath();
        g.ellipse(0, 0, c.radius, c.radius * 0.85, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.beginPath(); g.arc(-c.radius * 0.3, -wob - c.radius * 0.5, 2, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.arc(-c.radius * 0.3, wob + c.radius * 0.5, 2, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#2e2416';
        g.beginPath(); g.arc(c.radius * 0.45, 0, 1.8, 0, Math.PI * 2); g.fill();
        if (c.type === 'regen') {
          const pulse = (this.t * 1.4 + c.id * 0.7) % 1;
          g.strokeStyle = `rgba(220,150,225,${0.7 * (1 - pulse)})`;
          g.lineWidth = 1.5;
          g.beginPath(); g.arc(0, 0, c.radius * (0.6 + pulse * 0.9), 0, Math.PI * 2); g.stroke();
        }
      }
      g.restore();

      // status tints (drawn unrotated on top)
      if (slowed) {
        g.fillStyle = 'rgba(116,199,232,0.30)';
        g.beginPath(); g.arc(p.x, p.y, c.radius + 1.5, 0, Math.PI * 2); g.fill();
        g.strokeStyle = 'rgba(190,235,255,0.55)';
        g.lineWidth = 1;
        g.beginPath(); g.arc(p.x, p.y, c.radius + 1.5, 0, Math.PI * 2); g.stroke();
      }
      if (poisoned) {
        g.strokeStyle = 'rgba(140,203,94,0.75)';
        g.lineWidth = 1.5;
        g.beginPath(); g.arc(p.x, p.y, c.radius + 3.2, 0, Math.PI * 2); g.stroke();
        if (Math.sin(this.t * 8 + c.id) > 0.4) {
          g.fillStyle = 'rgba(140,203,94,0.8)';
          g.fillRect(p.x - 1 + Math.sin(c.id) * 4, p.y - c.radius - 6, 2, 2);
        }
      }

      // HP bar only when damaged
      if (c.hp < c.maxHp - 0.5) {
        const w = Math.max(14, c.radius * 2.2);
        const frac = Math.max(0, c.hp / c.maxHp);
        const bx = p.x - w / 2, by = p.y - c.radius - 7;
        g.fillStyle = 'rgba(0,0,0,0.6)';
        g.fillRect(bx - 1, by - 1, w + 2, 4);
        g.fillStyle = frac > 0.5 ? '#8fd06a' : frac > 0.25 ? '#e3c853' : '#e05c4a';
        g.fillRect(bx, by, w * frac, 2);
      }
    }
  }

  // ------------------------------------------------------------ projectiles

  drawProjectiles(state, alpha) {
    const g = this.ctx;
    for (const pr of state.projectiles) {
      if (pr.dead) continue;
      const x = pr.prevX + (pr.x - pr.prevX) * alpha;
      const y = pr.prevY + (pr.y - pr.prevY) * alpha;
      if (pr.kind === 'arrow') {
        const a = Math.atan2(pr.ty - y, pr.tx - x);
        g.save();
        g.translate(x, y);
        g.rotate(a);
        g.strokeStyle = '#ffe8b8';
        g.lineWidth = 2;
        g.beginPath(); g.moveTo(-5, 0); g.lineTo(4, 0); g.stroke();
        g.fillStyle = '#ffd96b';
        g.beginPath(); g.moveTo(6, 0); g.lineTo(2, -2); g.lineTo(2, 2); g.closePath(); g.fill();
        g.restore();
      } else if (pr.kind === 'splash') {
        // lobbed: fake height along the arc
        const dTravel = Math.hypot(x - pr.x0, y - pr.y0);
        const dLeft = Math.hypot(pr.tx - x, pr.ty - y);
        const prog = dTravel / Math.max(1, dTravel + dLeft);
        const h = Math.sin(prog * Math.PI) * 26;
        g.fillStyle = 'rgba(0,0,0,0.3)';
        g.beginPath(); g.ellipse(x, y + 3, 4, 2, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#3d434c';
        g.beginPath(); g.arc(x, y - h, 4.5, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#ffb066';
        g.beginPath(); g.arc(x - 1, y - h - 1, 1.6, 0, Math.PI * 2); g.fill();
      } else if (pr.kind === 'poison') {
        g.fillStyle = '#8ccb5e';
        g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(140,203,94,0.35)';
        g.beginPath(); g.arc(x - (pr.x - pr.prevX) * 1.5, y - (pr.y - pr.prevY) * 1.5, 2.2, 0, Math.PI * 2); g.fill();
      }
    }
  }

  // ------------------------------------------------------------ FX + preview

  drawFx(g) {
    for (const b of this.beams) {
      const a = b.ttl / b.life;
      g.strokeStyle = b.color;
      g.globalAlpha = a;
      g.lineWidth = 2.5 * a + 0.5;
      g.beginPath(); g.moveTo(b.x1, b.y1); g.lineTo(b.x2, b.y2); g.stroke();
      g.globalAlpha = 1;
    }
    for (const s of this.shots) {
      const a = s.ttl / s.life;
      g.fillStyle = `rgba(255,240,200,${a * 0.9})`;
      g.beginPath(); g.arc(s.x, s.y, 3.5 * a + 1, 0, Math.PI * 2); g.fill();
    }
    for (const r of this.rings) {
      const a = r.ttl / r.life;
      g.strokeStyle = r.color;
      g.globalAlpha = a * 0.9;
      g.lineWidth = 2;
      g.beginPath(); g.arc(r.x, r.y, r.r * (1.25 - a * 0.25), 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 1;
    }
    for (const p of this.particles) {
      const a = p.ttl / p.life;
      g.fillStyle = p.color;
      g.globalAlpha = a;
      g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      g.globalAlpha = 1;
    }
    g.font = 'bold 11px ui-monospace, monospace';
    g.textAlign = 'center';
    for (const f of this.floats) {
      const a = Math.min(1, f.ttl / (f.life * 0.5));
      g.globalAlpha = a;
      g.fillStyle = 'rgba(0,0,0,0.7)';
      g.fillText(f.text, f.x + 1, f.y + 1);
      g.fillStyle = f.color;
      g.fillText(f.text, f.x, f.y);
      g.globalAlpha = 1;
    }
  }

  drawPreview(state, ui) {
    if (!ui.placingType || !ui.hover) return;
    const { c, r } = ui.hover;
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return;
    const g = this.ctx;
    const x = c * CELL + CELL / 2, y = r * CELL + CELL / 2;
    const valid = ui.canPlace && ui.affordable;
    const def = TOWERS[ui.placingType];
    this.drawRange(x, y, def.levels[0].range, valid);
    g.fillStyle = valid ? 'rgba(200,220,160,0.18)' : 'rgba(255,90,90,0.22)';
    g.fillRect(c * CELL, r * CELL, CELL, CELL);
    g.strokeStyle = valid ? 'rgba(200,220,160,0.8)' : 'rgba(255,90,90,0.9)';
    g.lineWidth = 1.5;
    g.strokeRect(c * CELL + 1, r * CELL + 1, CELL - 2, CELL - 2);
    // ghost tower
    g.globalAlpha = 0.55;
    this.drawTower(g, { x, y, type: ui.placingType, level: 0, aim: 0, id: 0 });
    g.globalAlpha = 1;
  }
}

// Small helper for map-select thumbnails.
export function drawMapThumb(canvas, map) {
  const g = canvas.getContext('2d');
  const sx = canvas.width / W, sy = canvas.height / H;
  g.fillStyle = '#11160f';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#3d3122';
  for (const k of map.pathCells) {
    const [c, r] = k.split(',').map(Number);
    g.fillRect(c * CELL * sx, r * CELL * sy, CELL * sx + 0.5, CELL * sy + 0.5);
  }
  g.fillStyle = '#17394f';
  for (const k of map.waterCells) {
    const [c, r] = k.split(',').map(Number);
    g.fillRect(c * CELL * sx, r * CELL * sy, CELL * sx + 0.5, CELL * sy + 0.5);
  }
  for (const path of map.paths) {
    const s0 = posAt(path, 0), s1 = posAt(path, path.total);
    g.fillStyle = '#e07a5a';
    g.beginPath(); g.arc(s0.x * sx, s0.y * sy, 3, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#c9d8a0';
    g.beginPath(); g.arc(s1.x * sx, s1.y * sy, 3, 0, Math.PI * 2); g.fill();
  }
}
