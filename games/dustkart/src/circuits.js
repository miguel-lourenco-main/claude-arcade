// Dustkart — circuit construction.
// Pure (node-safe): builds the three closed-loop circuits as segment
// arrays that WRAP (position is taken modulo circuit length), plus the
// per-segment racing line the AI follows, item-pad placements, roadside
// decoration and the minimap polyline.
// Classic script: attaches to the Dustkart namespace so the game works
// when index.html is opened directly via file://.

(function () {
'use strict';
const NS = typeof globalThis !== 'undefined' ? globalThis : window;
const DK = NS.Dustkart = NS.Dustkart || {};

const SEG_LEN = 200;     // world units per segment
const ROAD_W = 1000;     // road HALF-width in world units
const RUMBLE = 3;        // segments per rumble-stripe band
const DRAW_DIST = 230;   // segments walked per rendered frame
const LAPS = 3;

const ease = {
  in: (a, b, p) => a + (b - a) * p * p,
  out: (a, b, p) => a + (b - a) * (1 - (1 - p) * (1 - p)),
  inOut: (a, b, p) => a + (b - a) * (-Math.cos(p * Math.PI) / 2 + 0.5),
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Deterministic PRNG so every circuit is a fixed, designed track.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeShape() {
  const segs = [];
  const lastY = () => (segs.length ? segs[segs.length - 1].y2 : 0);

  function addSeg(curve, y) {
    const n = segs.length;
    segs.push({
      i: n, curve,
      y1: lastY(), y2: y,
      stripe: Math.floor(n / RUMBLE) % 2 === 0,
      sprites: [], padOffs: null, line: 0,
    });
  }

  function road(enter, hold, leave, curve, dy = 0) {
    const startY = lastY();
    const endY = startY + dy * SEG_LEN;
    const total = enter + hold + leave;
    for (let n = 0; n < enter; n++) {
      addSeg(ease.in(0, curve, n / enter), ease.inOut(startY, endY, (n + 1) / total));
    }
    for (let n = 0; n < hold; n++) {
      addSeg(curve, ease.inOut(startY, endY, (enter + n + 1) / total));
    }
    for (let n = 0; n < leave; n++) {
      addSeg(ease.out(curve, 0, n / leave), ease.inOut(startY, endY, (enter + hold + n + 1) / total));
    }
  }

  return {
    segs,
    road,
    straight: (n) => road(n, n, n, 0, 0),
    bend: (n, c, h = 0) => road(n, n, n, c, h),
    hill: (n, h) => road(n, n, n, 0, h),
  };
}

// ---- the three circuits (shapes, themes, decor kinds are all original) ----
const DEFS = [
  {
    key: 'sunspur',
    name: 'SUNSPUR FLATS',
    blurb: 'sun-baked dust flats — long sweepers and one snap chicane',
    theme: 0,
    seed: 11,
    flora: ['boulder', 'shrub', 'spire', 'boulder', 'shrub'],
    density: 0.1,
    shape(b) {
      b.straight(64);
      b.bend(52, 3);
      b.straight(28);
      b.bend(38, -2, 12);
      b.straight(22);
      b.bend(15, 4);          // chicane in…
      b.bend(15, -4);         // …chicane out
      b.straight(36);
      b.bend(56, 4, -12);
      b.straight(28);
      b.bend(44, -3);
      b.straight(18);
      b.bend(62, 4);
      b.straight(34);
    },
  },
  {
    key: 'bramble',
    name: 'BRAMBLE HOLLOW',
    blurb: 'a sunken woodland warren — two hairpins back to back',
    theme: 1,
    seed: 22,
    flora: ['bramble', 'fern', 'stump', 'bramble', 'fern'],
    density: 0.16,
    shape(b) {
      b.straight(44);
      b.bend(34, 6);          // hairpin one
      b.straight(24);
      b.bend(28, -4);
      b.bend(20, 3, 14);
      b.straight(28);
      b.bend(36, -6.5, -14);  // hairpin two
      b.straight(20);
      b.bend(14, 5);          // chicane
      b.bend(14, -5);
      b.straight(24);
      b.bend(38, 5);
      b.straight(16);
      b.bend(30, 6);
      b.straight(28);
    },
  },
  {
    key: 'emberdown',
    name: 'EMBERDOWN RIDGE',
    blurb: 'a dusk ridge over the cinder valley — climbs, drops, a killer hairpin',
    theme: 2,
    seed: 33,
    flora: ['charspire', 'cinderrock', 'lantern', 'charspire', 'cinderrock'],
    density: 0.11,
    shape(b) {
      b.straight(52);
      b.bend(64, 3, 18);
      b.bend(22, -5);
      b.straight(18);
      b.bend(36, 6.5, -18);   // the killer hairpin
      b.straight(30);
      b.bend(14, -5);         // chicane
      b.bend(14, 5);
      b.straight(22);
      b.bend(52, -3, 10);
      b.straight(18);
      b.bend(40, 4, -10);
      b.straight(36);
      b.bend(34, 5);
    },
  },
];

// Weighted average of the upcoming curve — the AI cuts toward the apex.
function computeRacingLine(segs) {
  const N = segs.length;
  const raw = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let acc = 0, wsum = 0;
    for (let j = 3; j < 32; j++) {
      const w = 1 - j / 34;
      acc += segs[(i + j) % N].curve * w;
      wsum += w;
    }
    raw[i] = clamp((acc / wsum) * 0.3, -0.6, 0.6);
  }
  // two wrap-aware box-smooth passes so the line has no kinks
  for (let pass = 0; pass < 2; pass++) {
    const out = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      let acc = 0;
      for (let j = -5; j <= 5; j++) acc += raw[(i + j + N) % N];
      out[i] = acc / 11;
    }
    raw.set(out);
  }
  for (let i = 0; i < N; i++) segs[i].line = raw[i];
}

// Item pad clusters on calmer road, roughly evenly spaced around the loop.
function placePads(segs) {
  const N = segs.length;
  const pads = [];
  const clusters = 8;
  for (let c = 0; c < clusters; c++) {
    const base = Math.floor(90 + (c * (N - 130)) / clusters);
    let pick = -1;
    for (let d = 0; d < 45 && pick < 0; d++) {
      for (const i of [base + d, base - d]) {
        const idx = ((i % N) + N) % N;
        if (idx > 8 && Math.abs(segs[idx].curve) < 1.2 && !segs[idx].padOffs) { pick = idx; break; }
      }
    }
    if (pick < 0) continue;
    const offs = [-0.55, 0, 0.55];
    segs[pick].padOffs = offs;
    for (const off of offs) pads.push({ seg: pick, z: pick * SEG_LEN, x: off });
  }
  return pads;
}

// Minimap polyline: integrate heading per segment, scaled so the loop's
// total turn is exactly one revolution, then spread the closing error
// over the whole polyline so it joins up.
function layoutMap(segs) {
  const N = segs.length;
  let total = 0;
  for (const s of segs) total += s.curve;
  const k = (Math.PI * 2) / (total || 1);
  let h = -Math.PI / 2;
  let x = 0, y = 0;
  const pts = new Array(N);
  for (let i = 0; i < N; i++) {
    pts[i] = { x, y };
    h += segs[i].curve * k;
    x += Math.cos(h);
    y += Math.sin(h);
  }
  const gx = pts[0].x - x, gy = pts[0].y - y;
  for (let i = 0; i < N; i++) {
    pts[i].x += (gx * i) / N;
    pts[i].y += (gy * i) / N;
  }
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  for (const p of pts) {
    p.x = 0.5 + (p.x - cx) / span;
    p.y = 0.5 + (p.y - cy) / span;
  }
  return pts;
}

function buildCircuit(idx) {
  const def = DEFS[idx];
  const b = makeShape();
  def.shape(b);
  const segs = b.segs;
  const N = segs.length;

  // Close the loop vertically: spread any residual height evenly so the
  // last segment's y2 meets the first segment's y1 (= 0) exactly.
  const res = segs[N - 1].y2;
  for (let i = 0; i < N; i++) {
    segs[i].y1 -= (res * i) / N;
    segs[i].y2 -= (res * (i + 1)) / N;
  }

  computeRacingLine(segs);
  const pads = placePads(segs);

  // roadside decoration
  const rng = mulberry32(def.seed);
  for (let i = 6; i < N; i++) {
    if (rng() < def.density) {
      const side = rng() < 0.5 ? -1 : 1;
      const off = side * (1.7 + rng() * 3.2);
      segs[i].sprites.push({ kind: def.flora[(rng() * def.flora.length) | 0], off });
    }
  }
  // chevron boards on the outside of hard bend entries
  let i = 8;
  while (i < N - 20) {
    const c = segs[i].curve;
    if (Math.abs(c) >= 3.6 && Math.abs(segs[i - 1].curve) < 3.6) {
      const side = c > 0 ? -1 : 1;
      const kind = c > 0 ? 'signR' : 'signL';
      for (let kk = 0; kk < 3; kk++) {
        const seg = segs[i - 14 + kk * 6];
        if (seg && seg.i > 4) seg.sprites.push({ kind, off: side * 1.3 });
      }
      i += 40;
    } else i++;
  }
  // start gate just past the line
  segs[4].sprites.push({ kind: 'gate', off: 0 });

  return {
    idx,
    key: def.key,
    name: def.name,
    blurb: def.blurb,
    theme: def.theme,
    segments: segs,
    N,
    length: N * SEG_LEN,
    pads,
    map: layoutMap(segs),
    finishSeg: 0, // laps count when position wraps past segment 0
  };
}

// Segment under world-z on a WRAPPING circuit.
function segAt(circuit, z) {
  const N = circuit.N;
  let i = Math.floor(z / SEG_LEN) % N;
  if (i < 0) i += N;
  return circuit.segments[i];
}

DK.CIRCUIT_INFO = DEFS.map((d) => ({ key: d.key, name: d.name, blurb: d.blurb, theme: d.theme }));
Object.assign(DK, { SEG_LEN, ROAD_W, RUMBLE, DRAW_DIST, LAPS, buildCircuit, segAt, mulberry32 });

if (typeof module !== 'undefined' && module.exports) module.exports = DK;
})();
