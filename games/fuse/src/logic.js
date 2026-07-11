// Fuse — pure game logic. No DOM, no timers.
// The renderer consumes the result objects returned by move().
// Classic script (file:// safe): attaches to window.FuseGame in the browser,
// and to module.exports under Node so the logic tests can require() it.
(function (global) {
  'use strict';

  const SIZE = 4;
  const WIN_VALUE = 2048;

  // Precomputed traversal lines per direction. Each line lists cells starting
  // at the DESTINATION edge and walking away from it, so slides land — and the
  // pair nearest that edge merges — before anything further out is considered.
  function buildLines(dir) {
    const lines = [];
    for (let i = 0; i < SIZE; i++) {
      const line = [];
      for (let j = 0; j < SIZE; j++) {
        if (dir === 'left') line.push({ r: i, c: j });
        else if (dir === 'right') line.push({ r: i, c: SIZE - 1 - j });
        else if (dir === 'up') line.push({ r: j, c: i });
        else line.push({ r: SIZE - 1 - j, c: i }); // down
      }
      lines.push(line);
    }
    return lines;
  }

  const LINES = {
    left: buildLines('left'),
    right: buildLines('right'),
    up: buildLines('up'),
    down: buildLines('down'),
  };

  class Game {
    constructor(rng = Math.random) {
      this.rng = rng;
      this.nextId = 1;
      this.newGame();
    }

    newGame() {
      this.tiles = [];
      this.score = 0;
      this.over = false;
      this.won = false;
      this.keepPlaying = false;
      this.prev = null; // single undo snapshot
      this.spawn();
      this.spawn();
    }

    grid() {
      const g = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
      for (const t of this.tiles) g[t.r][t.c] = t;
      return g;
    }

    emptyCells() {
      const g = this.grid();
      const out = [];
      for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++)
          if (!g[r][c]) out.push({ r, c });
      return out;
    }

    // Spawn one tile in a random empty cell: 2 (90%) / 4 (10%).
    spawn() {
      const empty = this.emptyCells();
      if (!empty.length) return null;
      const { r, c } = empty[Math.floor(this.rng() * empty.length)];
      const t = { id: this.nextId++, value: this.rng() < 0.9 ? 2 : 4, r, c };
      this.tiles.push(t);
      return t;
    }

    // True while at least one slide or merge is still possible.
    canMove() {
      const g = this.grid();
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          const t = g[r][c];
          if (!t) return true;
          if (c + 1 < SIZE && g[r][c + 1] && g[r][c + 1].value === t.value) return true;
          if (r + 1 < SIZE && g[r + 1][c] && g[r + 1][c].value === t.value) return true;
        }
      }
      return false;
    }

    /**
     * Attempt a move. Returns { moved:false } for illegal moves (nothing slid
     * or merged → nothing spawns). On a legal move returns:
     *   { moved:true, gained, absorbed, merged, spawned, justWon, over }
     * where `absorbed` are tiles that slid into a merge partner (final r/c set
     * to the survivor's cell, to animate then remove) and `merged` are the
     * surviving tiles whose value doubled.
     */
    move(dir) {
      if (this.over) return { moved: false };
      const snapshot = this.serialize();

      for (const t of this.tiles) t.locked = false;
      const g = this.grid();
      let moved = false;
      let gained = 0;
      const absorbed = [];
      const merged = [];

      for (const line of LINES[dir]) {
        // Occupied tiles of this line, ordered from the destination edge out.
        const ts = [];
        for (const p of line) if (g[p.r][p.c]) ts.push(g[p.r][p.c]);

        let write = 0;   // next free slot index along the line
        let last = null; // most recently placed tile (nearest the edge)
        for (const t of ts) {
          if (last && last.value === t.value && !last.locked) {
            // Merge into the tile nearer the destination edge.
            last.value *= 2;
            last.locked = true; // MERGE-LOCKED for the rest of this move
            gained += last.value;
            t.r = last.r;
            t.c = last.c;
            absorbed.push(t);
            merged.push(last);
            moved = true;
          } else {
            const p = line[write++];
            if (t.r !== p.r || t.c !== p.c) moved = true;
            t.r = p.r;
            t.c = p.c;
            last = t;
          }
        }
      }

      if (!moved) return { moved: false };

      this.prev = snapshot;
      this.score += gained;
      const dead = new Set(absorbed.map((t) => t.id));
      this.tiles = this.tiles.filter((t) => !dead.has(t.id));

      const spawned = this.spawn();

      let justWon = false;
      if (!this.won && merged.some((t) => t.value >= WIN_VALUE)) {
        this.won = true;
        justWon = true;
      }
      if (!this.canMove()) this.over = true;

      return { moved: true, gained, absorbed, merged, spawned, justWon, over: this.over };
    }

    // One-step undo: restore the snapshot taken before the last legal move.
    undo() {
      if (!this.prev) return false;
      this.restore(this.prev);
      this.prev = null;
      return true;
    }

    serialize() {
      return {
        tiles: this.tiles.map((t) => ({ id: t.id, value: t.value, r: t.r, c: t.c })),
        score: this.score,
        won: this.won,
        keepPlaying: this.keepPlaying,
        over: this.over,
      };
    }

    restore(s) {
      this.tiles = s.tiles.map((t) => ({ ...t }));
      this.score = s.score | 0;
      this.won = !!s.won;
      this.keepPlaying = !!s.keepPlaying;
      this.over = !!s.over;
      for (const t of this.tiles) this.nextId = Math.max(this.nextId, t.id + 1);
    }

    // Restore a persisted { cur, prev } bundle. Returns false if it looks bogus.
    load(data) {
      const ok = (s) =>
        s && Array.isArray(s.tiles) && s.tiles.length > 0 && s.tiles.length <= SIZE * SIZE &&
        s.tiles.every(
          (t) =>
            Number.isInteger(t.r) && t.r >= 0 && t.r < SIZE &&
            Number.isInteger(t.c) && t.c >= 0 && t.c < SIZE &&
            Number.isInteger(t.value) && t.value >= 2
        ) &&
        new Set(s.tiles.map((t) => t.r * SIZE + t.c)).size === s.tiles.length;
      if (!ok(data && data.cur)) return false;
      this.restore(data.cur);
      this.prev = ok(data.prev) ? data.prev : null;
      return true;
    }
  }

  const api = { SIZE, WIN_VALUE, Game };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.FuseGame = global.FuseGame || {};
    Object.assign(global.FuseGame, api);
  }
})(typeof window !== 'undefined' ? window : globalThis);
