// Gloamkeep — map data + parser. Pure module (no DOM), drivable from node.
//
// Legend:
//   '#' stone wall      '%' mossy wall      '&' banner wall
//   'D' wooden door     'R' crimson door    'G' viridian door   'Y' gold door
//   'X' exit sigil (use E on it to leave the floor)
//   'S' secret push-wall (looks like stone; use E to shove it back)
//   '.' floor           '@' player start
//   enemies: 'g' gloam  'z' stalker  'h' husk  'W' warden
//   items:   '+' health '(' is unused; 'a' ammo  '1'/'2'/'3' keys  '*' ember shard
//   't' torch (decor sprite, floor cell near a wall)

export const TILE = {
  EMPTY: 0,
  STONE: 1,
  MOSS: 2,
  BANNER: 3,
  DOOR: 5,
  DOOR_R: 6,
  DOOR_G: 7,
  DOOR_Y: 8,
  EXIT: 9,
  PUSH: 10,
};

const WALL_CHARS = {
  '#': TILE.STONE,
  '%': TILE.MOSS,
  '&': TILE.BANNER,
  'D': TILE.DOOR,
  'R': TILE.DOOR_R,
  'G': TILE.DOOR_G,
  'Y': TILE.DOOR_Y,
  'X': TILE.EXIT,
  'S': TILE.PUSH,
};

const ENEMY_CHARS = { g: 'gloam', z: 'stalker', h: 'husk', W: 'warden' };
const ITEM_CHARS = {
  '+': 'health',
  'a': 'ammo',
  '1': 'key1',
  '2': 'key2',
  '3': 'key3',
  '*': 'shard',
};

export const MAPS = [
  {
    name: 'The Undercroft',
    spawnAngle: 0, // facing +x (east)
    rows: [
      '##############################',
      '#.t......#..........#..t.....#',
      '#.@......#....g...*.#........#',
      '#........D..........D....h...#',
      '#........#..........#....1...#',
      '##########....+.....#........#',
      '#..t.....#........g.##########',
      '#........#..........#........#',
      '#........#...a......#..a.....#',
      '#........####D######...t.....#',
      '#........#...........#......g#',
      '#g.......#...........#.......#',
      '#........#..g........#.......#',
      '#....%%..#.....t.....#....&..#',
      '#....%...#...........#.......#',
      '#........D...........########&',
      '#........#...........#.t..X..#',
      '#..z.....#......z....#.......#',
      '##S##....#...........R.......#',
      '#*.+#....#.a.........#..g..a.#',
      '##.##.t..#...........#.......#',
      '##############################',
    ],
  },
  {
    name: 'The Gallery of Whispers',
    spawnAngle: Math.PI / 2, // facing +y (south on the grid)
    rows: [
      '################################',
      '#..@...#.......t..........#..1.#',
      '#......D..................G....#',
      '#......#...g........z.....#.t..#',
      '#.t....#..................######',
      '########....&&....&&......#.a..#',
      '#......#..................D..+.#',
      '#..a...D..h...............#....#',
      '#......#..................#....#',
      '############D#######..##########',
      '#............#.................#',
      '#..g.........#......%%%..z.....#',
      '#............#......%..........#',
      '#...*....t...#......%...2......#',
      '#.....g......#.............%%%%#',
      '#........z...#.............S..%#',
      '#....h.......#.............%+*%#',
      '#............#.............%%%%#',
      '##########R#####################',
      '#.....#.....................t..#',
      '#..+..D.....g........h.........#',
      '#.....#...a................#####',
      '#..t..#.z..............3...Y.X##',
      '################################',
    ],
  },
  {
    name: 'The Gloamheart',
    spawnAngle: 0, // facing +x (east)
    rows: [
      '#################################',
      '#..t....#............#..h..#..*.#',
      '#.......#..z.....z...#.....S...+#',
      '#...@...D............#..a..#....#',
      '#.......#............#.....#....#',
      '#..t....#............###D########',
      '#########............#....t.....#',
      '#.......#..............g........#',
      '#..a....#.....gg................#',
      '#..+....D............#.......z..#',
      '#.......#............#....1.....#',
      '#.......######R############D#####',
      '#.......%............#..h.......#',
      '#..g....%..t......t..#...z....g.#',
      '#.......%............#....%%....#',
      '#...z...D....&..&....#..a....*..#',
      '#.......%....2.......#....%%....#',
      '#.t...+.%..g......z..#.....+....#',
      '#.......%............#..........#',
      '#%%%%%%%%###G####################',
      '#.....h.........h..........&&...#',
      '#..t.........................a..#',
      '#########Y########D##############',
      '########...#.............########',
      '########.X.#..W......3...########',
      '########...#..gg.........########',
      '#################################',
    ],
  },
];

// Parse a raw map definition into a level structure.
export function parseMap(def) {
  const rows = def.rows;
  const h = rows.length;
  const w = rows[0].length;
  for (let y = 0; y < h; y++) {
    if (rows[y].length !== w) {
      throw new Error(
        `map "${def.name}" row ${y} has width ${rows[y].length}, expected ${w}`
      );
    }
  }
  const grid = new Int16Array(w * h);
  const doors = [];
  const doorIdx = new Int32Array(w * h).fill(-1);
  const pushwalls = [];
  const enemies = [];
  const items = [];
  const torches = [];
  let spawn = null;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = rows[y][x];
      const i = y * w + x;
      if (c in WALL_CHARS) {
        const t = WALL_CHARS[c];
        grid[i] = t;
        if (t >= TILE.DOOR && t <= TILE.DOOR_Y) {
          doorIdx[i] = doors.length;
          doors.push({
            x, y,
            type: t,
            locked: t === TILE.DOOR_R ? 1 : t === TILE.DOOR_G ? 2 : t === TILE.DOOR_Y ? 3 : 0,
            open: 0,       // 0 closed .. 1 fully open
            state: 0,      // 0 closed, 1 opening, 2 open, 3 closing
            timer: 0,
          });
        } else if (t === TILE.PUSH) {
          pushwalls.push({
            x, y,
            active: false,
            done: false,
            dirX: 0, dirY: 0,
            progress: 0,
            cells: 2,
          });
        }
        continue;
      }
      // floor-ish cells
      grid[i] = TILE.EMPTY;
      if (c === '@') {
        spawn = { x: x + 0.5, y: y + 0.5, angle: def.spawnAngle };
      } else if (c in ENEMY_CHARS) {
        enemies.push({ type: ENEMY_CHARS[c], x: x + 0.5, y: y + 0.5 });
      } else if (c in ITEM_CHARS) {
        items.push({ kind: ITEM_CHARS[c], x: x + 0.5, y: y + 0.5 });
      } else if (c === 't') {
        torches.push({ x: x + 0.5, y: y + 0.5 });
      } else if (c !== '.') {
        throw new Error(`map "${def.name}" unknown char '${c}' at ${x},${y}`);
      }
    }
  }
  if (!spawn) throw new Error(`map "${def.name}" has no '@' spawn`);
  return {
    name: def.name,
    w, h, grid, doors, doorIdx, pushwalls,
    spawn, enemies, items, torches,
  };
}

// --- validation helpers (used by the headless test) -------------------------

// Progressive reachability: BFS from spawn; locked doors open once the
// matching key item has been reached. Secret push-walls count as solid.
export function validateReachability(level) {
  const { w, h, grid, doorIdx, doors } = level;
  const keys = [false, false, false];
  const problems = [];

  // border must be solid
  for (let x = 0; x < w; x++) {
    if (grid[x] === TILE.EMPTY || grid[(h - 1) * w + x] === TILE.EMPTY) {
      problems.push(`open border at x=${x}`);
    }
  }
  for (let y = 0; y < h; y++) {
    if (grid[y * w] === TILE.EMPTY || grid[y * w + w - 1] === TILE.EMPTY) {
      problems.push(`open border at y=${y}`);
    }
  }

  const passable = (i, throughSecrets) => {
    const t = grid[i];
    if (t === TILE.EMPTY) return true;
    if (t === TILE.PUSH) return throughSecrets;
    if (t >= TILE.DOOR && t <= TILE.DOOR_Y) {
      const d = doors[doorIdx[i]];
      return d.locked === 0 || keys[d.locked - 1];
    }
    return false;
  };

  const flood = (seen, throughSecrets) => {
    seen.fill(0);
    const queue = [Math.floor(level.spawn.y) * w + Math.floor(level.spawn.x)];
    seen[queue[0]] = 1;
    while (queue.length) {
      const i = queue.pop();
      const x = i % w, y = (i / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (seen[ni]) continue;
        seen[ni] = 1;
        if (passable(ni, throughSecrets)) queue.push(ni);
      }
    }
  };

  // progression pass: secrets stay shut; keys unlock doors iteratively
  const seen = new Uint8Array(w * h);
  let changed = true;
  while (changed) {
    changed = false;
    flood(seen, false);
    for (const it of level.items) {
      if (it.kind.startsWith('key')) {
        const n = +it.kind[3];
        const i = Math.floor(it.y) * w + Math.floor(it.x);
        if (seen[i] && !keys[n - 1]) { keys[n - 1] = true; changed = true; }
      }
    }
  }

  // exit reachable? (exit is a solid wall; check it was *seen*, i.e. adjacent floor reached)
  let exitSeen = false, exitCount = 0;
  for (let i = 0; i < w * h; i++) {
    if (grid[i] === TILE.EXIT) {
      exitCount++;
      if (seen[i]) exitSeen = true;
    }
  }
  if (exitCount === 0) problems.push('no exit tile');
  if (!exitSeen) problems.push('exit not reachable');

  // every locked door type has a key somewhere reachable
  for (const d of doors) {
    if (d.locked && !keys[d.locked - 1]) {
      problems.push(`door at ${d.x},${d.y} needs key${d.locked} which is unreachable`);
    }
  }

  // loot pass: secrets pushed open — every item and enemy must be reachable
  const seenLoot = new Uint8Array(w * h);
  flood(seenLoot, true);
  for (const it of level.items) {
    const i = Math.floor(it.y) * w + Math.floor(it.x);
    if (!seenLoot[i]) problems.push(`item ${it.kind} at ${Math.floor(it.x)},${Math.floor(it.y)} unreachable`);
  }
  for (const e of level.enemies) {
    const i = Math.floor(e.y) * w + Math.floor(e.x);
    if (!seenLoot[i]) problems.push(`enemy ${e.type} at ${Math.floor(e.x)},${Math.floor(e.y)} unreachable`);
  }

  // each push-wall must have 2 free cells in at least one cardinal direction
  for (const p of level.pushwalls) {
    let ok = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = (p.y + dy) * w + (p.x + dx);
      const b = (p.y + 2 * dy) * w + (p.x + 2 * dx);
      const ax = p.x + dx, ay = p.y + dy, bx = p.x + 2 * dx, by = p.y + 2 * dy;
      if (ax <= 0 || ay <= 0 || ax >= w - 1 || ay >= h - 1) continue;
      if (bx <= 0 || by <= 0 || bx >= w - 1 || by >= h - 1) continue;
      if (grid[a] === TILE.EMPTY && grid[b] === TILE.EMPTY) ok = true;
    }
    if (!ok) problems.push(`push-wall at ${p.x},${p.y} has no room to slide`);
  }

  return problems;
}

export function dumpMap(def) {
  // debugging aid: print with a column ruler
  const w = Math.max(...def.rows.map((r) => r.length));
  let out = '    ' + Array.from({ length: w }, (_, i) => i % 10).join('') + '\n';
  def.rows.forEach((r, y) => {
    out += String(y).padStart(3) + ' ' + r + (r.length !== def.rows[0].length ? `   <-- width ${r.length}` : '') + '\n';
  });
  return out;
}
