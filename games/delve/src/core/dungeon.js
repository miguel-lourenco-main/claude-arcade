// Procedural floor generation: non-overlapping rectangular rooms joined by
// L-shaped corridors, verified fully connected with a flood fill, with the
// down-stairs guaranteed far (in walk distance) from the entry point.
// Classic script: attaches to the page-global Delve namespace.
(function (global) {
  'use strict';
  const Delve = global.Delve = global.Delve || {};

  const MAP_W = 60;
  const MAP_H = 30;

  const T = { WALL: 0, FLOOR: 1, DOWN: 2, UP: 3 };

  const idx = (x, y) => y * MAP_W + x;
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;

  /**
   * Generate one floor. Retries until a candidate passes the connectivity and
   * stair-distance checks.
   * @param {*} rng a Delve.RNG
   * @param {{hasUp: boolean, hasDown: boolean}} opts
   */
  function generateFloor(rng, { hasUp, hasDown }) {
    for (let attempt = 0; attempt < 80; attempt++) {
      const f = tryGenerate(rng, hasUp, hasDown);
      if (f) return f;
    }
    throw new Error('dungeon generation failed after 80 attempts');
  }

  function tryGenerate(rng, hasUp, hasDown) {
    const tiles = new Uint8Array(MAP_W * MAP_H); // all WALL
    const rooms = [];
    const target = 9 + rng.int(4);

    for (let a = 0; a < 170 && rooms.length < target; a++) {
      const w = rng.range(4, 10);
      const h = rng.range(3, 6);
      const x = rng.range(1, MAP_W - w - 2);
      const y = rng.range(1, MAP_H - h - 2);
      // reject overlap (with a 1-tile margin so rooms never share walls)
      let ok = true;
      for (const o of rooms) {
        if (x < o.x + o.w + 1 && o.x < x + w + 1 && y < o.y + o.h + 1 && o.y < y + h + 1) { ok = false; break; }
      }
      if (!ok) continue;
      rooms.push({ x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1) });
    }
    if (rooms.length < 6) return null;

    for (const r of rooms) {
      for (let yy = r.y; yy < r.y + r.h; yy++) {
        for (let xx = r.x; xx < r.x + r.w; xx++) tiles[idx(xx, yy)] = T.FLOOR;
      }
    }
    // chain rooms with L-corridors, plus a couple of extra loops for interest
    for (let i = 1; i < rooms.length; i++) carveCorridor(tiles, rng, rooms[i - 1], rooms[i]);
    for (let i = 0; i < 2; i++) {
      const a = rng.pick(rooms), b = rng.pick(rooms);
      if (a !== b) carveCorridor(tiles, rng, a, b);
    }

    const entry = { x: rooms[0].cx, y: rooms[0].cy };

    // flood-fill connectivity check + farthest-point search
    const dist = bfs(tiles, entry);
    let floorCount = 0, reached = 0, farD = 0;
    let far = { x: entry.x, y: entry.y };
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] === T.WALL) continue;
      floorCount++;
      if (dist[i] >= 0) {
        reached++;
        if (dist[i] > farD) { farD = dist[i]; far = { x: i % MAP_W, y: (i / MAP_W) | 0 }; }
      }
    }
    if (reached !== floorCount) return null;                     // must be one connected component
    if (farD < Math.floor((MAP_W + MAP_H) / 4)) return null;     // stairs must be genuinely far

    const farPoint = far;
    let down = null;
    if (hasDown) { down = { ...farPoint }; tiles[idx(down.x, down.y)] = T.DOWN; }
    let up = null;
    if (hasUp) { up = { ...entry }; tiles[idx(entry.x, entry.y)] = T.UP; }

    return { tiles, rooms, entry, up, down, farPoint };
  }

  function carveCorridor(tiles, rng, a, b) {
    if (rng.chance(0.5)) {
      hline(tiles, a.cx, b.cx, a.cy);
      vline(tiles, a.cy, b.cy, b.cx);
    } else {
      vline(tiles, a.cy, b.cy, a.cx);
      hline(tiles, a.cx, b.cx, b.cy);
    }
  }

  function hline(tiles, x0, x1, y) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      if (tiles[idx(x, y)] === T.WALL) tiles[idx(x, y)] = T.FLOOR;
    }
  }

  function vline(tiles, y0, y1, x) {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
      if (tiles[idx(x, y)] === T.WALL) tiles[idx(x, y)] = T.FLOOR;
    }
  }

  /**
   * 4-directional BFS over walkable tiles. Returns an Int32Array of distances
   * from `start` (-1 for unreached). Exported for tests.
   */
  function bfs(tiles, start) {
    const dist = new Int32Array(MAP_W * MAP_H).fill(-1);
    const q = [idx(start.x, start.y)];
    dist[q[0]] = 0;
    for (let qi = 0; qi < q.length; qi++) {
      const i = q[qi];
      const x = i % MAP_W, y = (i / MAP_W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!inBounds(nx, ny)) continue;
        const ni = idx(nx, ny);
        if (tiles[ni] === T.WALL || dist[ni] >= 0) continue;
        dist[ni] = dist[i] + 1;
        q.push(ni);
      }
    }
    return dist;
  }

  Delve.MAP_W = MAP_W;
  Delve.MAP_H = MAP_H;
  Delve.T = T;
  Delve.idx = idx;
  Delve.inBounds = inBounds;
  Delve.generateFloor = generateFloor;
  Delve.bfs = bfs;
})(globalThis);
