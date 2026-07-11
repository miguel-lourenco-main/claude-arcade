// Slipstream — track construction.
// Pure module (node-safe): builds the segment list, stages, roadside
// sprite placements and traffic seeds for the point-to-point course.

export const SEG_LEN = 200;     // world units per road segment
export const ROAD_WIDTH = 1000; // road HALF-width in world units
export const RUMBLE = 3;        // segments per rumble-stripe band
export const DRAW_DIST = 300;   // segments walked per rendered frame
export const RUNOUT = 420;      // straight segments after the finish gate

const ease = {
  in: (a, b, p) => a + (b - a) * p * p,
  out: (a, b, p) => a + (b - a) * (1 - (1 - p) * (1 - p)),
  inOut: (a, b, p) => a + (b - a) * (-Math.cos(p * Math.PI) / 2 + 0.5),
};

// Deterministic PRNG so the course is a fixed, designed track.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Sprite kinds each stage theme decorates with.
const STAGE_FLORA = [
  ['palm', 'bush', 'rock', 'palm', 'bush'],          // 0 Seabreak
  ['pine', 'pine', 'tree', 'bush', 'pine'],          // 1 Pinegate
  ['rock', 'pine', 'rock', 'bush', 'rock'],          // 2 Highridge
  ['cactus', 'rock', 'cactus', 'bush', 'cactus'],    // 3 Sandreach
  ['tree', 'tower', 'pine', 'bush', 'tree'],         // 4 Duskway
];

export function buildTrack(seed = 20260711) {
  const rng = mulberry32(seed);
  const segments = [];
  const stages = [];
  let stageFrom = 0;

  const lastY = () => (segments.length ? segments[segments.length - 1].y2 : 0);

  function addSegment(curve, y) {
    const n = segments.length;
    segments.push({
      i: n,
      curve,
      y1: lastY(),
      y2: y,
      stripe: Math.floor(n / RUMBLE) % 2 === 0,
      stage: stages.length,
      sprites: [],
    });
  }

  // enter/hold/leave segment counts; curve bends; dy = total climb in
  // "segment lengths" spread with easing over the whole section.
  function addRoad(enter, hold, leave, curve, dy = 0) {
    const startY = lastY();
    const endY = startY + dy * SEG_LEN;
    const total = enter + hold + leave;
    for (let n = 0; n < enter; n++) {
      addSegment(ease.in(0, curve, n / enter), ease.inOut(startY, endY, (n + 1) / total));
    }
    for (let n = 0; n < hold; n++) {
      addSegment(curve, ease.inOut(startY, endY, (enter + n + 1) / total));
    }
    for (let n = 0; n < leave; n++) {
      addSegment(ease.out(curve, 0, n / leave), ease.inOut(startY, endY, (enter + hold + n + 1) / total));
    }
  }

  const straight = (n = 25) => addRoad(n, n, n, 0, 0);
  const curve = (n, c, h = 0) => addRoad(n, n, n, c, h);
  const hill = (n, h) => addRoad(n, n, n, 0, h);

  function beginStage() { stageFrom = segments.length; }
  function endStage(name, theme, time) {
    stages.push({ name, theme, time, from: stageFrom, to: segments.length, fromZ: stageFrom * SEG_LEN });
  }

  // ---- Stage 1: SEABREAK RUN — coastal warm-up, gentle sweepers ----
  beginStage();
  straight(55);
  curve(45, 2);
  straight(28);
  curve(50, -2);
  curve(55, 3);
  straight(35);
  curve(48, -3, 8);
  straight(45);
  endStage('SEABREAK RUN', 0, 45);

  // ---- Stage 2: PINEGATE FOREST — tight S-curves under the trees ----
  beginStage();
  straight(25);
  curve(38, 4);
  curve(38, -4);
  curve(32, 3);
  curve(34, -5);
  straight(22);
  curve(42, 4, 14);
  curve(42, -4, -14);
  straight(30);
  endStage('PINEGATE FOREST', 1, 26);

  // ---- Stage 3: HIGHRIDGE PASS — climbs, crests and drops ----
  beginStage();
  hill(45, 38);
  curve(42, -4, 26);
  hill(38, -48);
  curve(48, 5, 18);
  addRoad(42, 42, 42, 2, -36);
  straight(24);
  curve(38, -6);
  straight(26);
  endStage('HIGHRIDGE PASS', 2, 28);

  // ---- Stage 4: SANDREACH FLATS — long fast sweepers ----
  beginStage();
  curve(72, 3);
  straight(45);
  curve(72, -4);
  straight(35);
  curve(62, 5);
  straight(52);
  endStage('SANDREACH FLATS', 3, 26);

  // ---- Stage 5: DUSKWAY GATE — everything at once, at dusk ----
  beginStage();
  curve(36, -5, 16);
  curve(36, 5, -16);
  straight(24);
  curve(32, 6);
  straight(20);
  curve(32, -6);
  hill(36, -22);
  straight(48);
  endStage('DUSKWAY GATE', 4, 26);

  const finishSeg = segments.length - 1;

  // Run-out road past the finish so the draw distance never walks off the end.
  beginStage();
  straight(Math.ceil(RUNOUT / 3));
  // (no stage record — run-out keeps stage index stages.length, clamp below)
  for (let i = finishSeg + 1; i < segments.length; i++) segments[i].stage = stages.length - 1;

  // ---- Decoration: per-stage flora at lateral offsets off the road ----
  for (let s = 0; s < stages.length; s++) {
    const st = stages[s];
    const kinds = STAGE_FLORA[st.theme];
    const density = [0.13, 0.2, 0.12, 0.1, 0.14][st.theme];
    for (let i = st.from; i < st.to; i++) {
      if (rng() < density) {
        const side = rng() < 0.5 ? -1 : 1;
        const off = side * (1.6 + rng() * 3.4);
        segments[i].sprites.push({ kind: kinds[(rng() * kinds.length) | 0], off });
      }
      // street-light rows on the coastal and dusk stages
      if ((st.theme === 0 || st.theme === 4) && i % 24 === 0) {
        segments[i].sprites.push({ kind: 'pole', off: -1.28 });
        segments[i].sprites.push({ kind: 'pole', off: 1.28 });
      }
    }
  }

  // ---- Chevron warning signs on the outside of hard bend entries ----
  {
    let i = 1;
    while (i < finishSeg) {
      const c = segments[i].curve;
      if (Math.abs(c) >= 3.5 && Math.abs(segments[i - 1].curve) < 3.5) {
        const side = c > 0 ? -1 : 1;              // outside of the bend
        const kind = c > 0 ? 'signR' : 'signL';   // chevrons point into the turn
        for (let k = 0; k < 3; k++) {
          const seg = segments[i - 16 + k * 7];
          if (seg) seg.sprites.push({ kind, off: side * 1.32 });
        }
        i += 50;
      } else {
        i++;
      }
    }
  }

  // Start + finish gates spanning the road.
  segments[12].sprites.push({ kind: 'gateStart', off: 0 });
  segments[finishSeg].sprites.push({ kind: 'gateFinish', off: 0 });

  // ---- Traffic seeds: (z, lateral offset, cruise speed fraction, livery) ----
  const raceLength = finishSeg * SEG_LEN;
  const cars = [];
  const N_CARS = 38;
  const LANE = [-0.66, -0.33, 0, 0.33, 0.66];
  for (let k = 0; k < N_CARS; k++) {
    cars.push({
      z: (0.05 + 0.9 * (k / N_CARS) + rng() * 0.014) * raceLength,
      offset: LANE[(rng() * LANE.length) | 0] + (rng() - 0.5) * 0.1,
      speedFrac: 0.26 + rng() * 0.32,
      kind: (rng() * 5) | 0,
    });
  }

  return {
    seed,
    segments,
    stages,
    finishSeg,
    raceLength,
    length: segments.length * SEG_LEN,
    cars,
  };
}

// Segment under world-z, clamped to the track (point-to-point, no wrap).
export function segAt(track, z) {
  const i = Math.floor(z / SEG_LEN);
  const segs = track.segments;
  return segs[Math.max(0, Math.min(segs.length - 1, i))];
}
