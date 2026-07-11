// Bestiary, item catalogue and depth-scaled spawn tables. All content is
// original, loosely set in the Upturn (see the arcade's Voxelcraft lore):
// the delvings are the caves of the old sky, and the prize at the bottom is
// the First Pearl — the star that fell deepest when the world turned over.

export const DEPTH_MAX = 9;

// ai: 'melee' chases and bumps; 'craven' chases but flees below 25% HP;
// 'ranged' keeps its distance and spits.  speed: energy gained per tick
// (the player gains 100, so 150 acts half again as often, 75 one-quarter less).
export const MONSTERS = {
  murkling: {
    name: 'murkling', glyph: 'm', color: '#8b95d6',
    hp: 6, dmg: [1, 3], acc: 2, eva: 2, speed: 100, xp: 4, sight: 7,
    depths: [1, 4], ai: 'melee',
  },
  skitterlimb: { // the fast, weak one
    name: 'skitterlimb', glyph: 's', color: '#d6c069',
    hp: 3, dmg: [1, 2], acc: 3, eva: 4, speed: 150, xp: 4, sight: 8,
    depths: [1, 5], ai: 'melee',
  },
  craven: { // flees below ~25% HP
    name: 'craven whelp', glyph: 'c', color: '#9fd0a0',
    hp: 9, dmg: [2, 4], acc: 2, eva: 2, speed: 100, xp: 7, sight: 8,
    depths: [2, 6], ai: 'craven',
  },
  stalkid: { // the slow tank
    name: 'stalkid', glyph: 'k', color: '#a09a8a',
    hp: 20, dmg: [3, 6], acc: 2, eva: 0, speed: 75, xp: 12, sight: 6,
    depths: [2, 7], ai: 'melee',
  },
  gallspitter: { // ranged, keeps its distance
    name: 'gallspitter', glyph: 'g', color: '#b4e050',
    hp: 8, dmg: [2, 4], acc: 3, eva: 2, speed: 100, xp: 10, sight: 9,
    depths: [3, 8], ai: 'ranged', range: 6,
  },
  barrowight: {
    name: 'barrow-wight', glyph: 'W', color: '#d8d2ea',
    hp: 18, dmg: [4, 7], acc: 4, eva: 2, speed: 100, xp: 18, sight: 8,
    depths: [5, 9], ai: 'melee',
  },
  oldskyhorror: {
    name: 'old-sky horror', glyph: 'H', color: '#e06a9a',
    hp: 34, dmg: [5, 9], acc: 5, eva: 1, speed: 100, xp: 45, sight: 9,
    depths: [7, 9], ai: 'melee',
  },
};

export const ITEMS = {
  potion_heal: {
    name: 'glowmoss draught', art: 'a', glyph: '!', color: '#ff7d9c',
    kind: 'potion', effect: 'heal', power: [9, 15],
  },
  potion_haste: {
    name: 'quicksilver philtre', art: 'a', glyph: '!', color: '#7de0ff',
    kind: 'potion', effect: 'haste', power: [16, 24],
  },
  scroll_teleport: {
    name: 'scroll of unplacing', art: 'a', glyph: '?', color: '#e8d27a',
    kind: 'scroll', effect: 'teleport',
  },
  scroll_map: {
    name: "scroll of the surveyor", art: 'a', glyph: '?', color: '#c0a8ff',
    kind: 'scroll', effect: 'map',
  },
  w_pick: { name: "delver's pick", art: 'a', glyph: ')', color: '#b0a795', kind: 'weapon', dmg: [1, 3], tier: 1 },
  w_blade: { name: 'iron shortblade', art: 'an', glyph: ')', color: '#c9d1d9', kind: 'weapon', dmg: [2, 5], tier: 2 },
  w_skyiron: { name: 'sky-iron edge', art: 'a', glyph: ')', color: '#8fd0e8', kind: 'weapon', dmg: [4, 8], tier: 3 },
  a_tunic: { name: 'padded tunic', art: 'a', glyph: '[', color: '#b0a795', kind: 'armor', def: 1, tier: 1 },
  a_hauberk: { name: 'chain hauberk', art: 'a', glyph: '[', color: '#c9d1d9', kind: 'armor', def: 3, tier: 2 },
  a_skyplate: { name: 'sky-iron plate', art: 'a', glyph: '[', color: '#8fd0e8', kind: 'armor', def: 5, tier: 3 },
  artifact: {
    name: 'the First Pearl', art: '', glyph: '*', color: '#ffffff', kind: 'artifact',
  },
};

/** Monster types eligible at a given depth. */
export function monsterPool(depth) {
  return Object.keys(MONSTERS).filter((k) => {
    const [lo, hi] = MONSTERS[k].depths;
    return depth >= lo && depth <= hi;
  });
}

/** Weighted item table for a given depth: array of [id, weight]. */
export function itemPool(depth) {
  const e = [['potion_heal', 6]];
  if (depth >= 2) e.push(['potion_haste', 3]);
  e.push(['scroll_teleport', 2], ['scroll_map', 2]);
  if (depth <= 3) e.push(['w_pick', 1], ['a_tunic', 2]);
  if (depth >= 2 && depth <= 6) e.push(['w_blade', 2], ['a_hauberk', 2]);
  if (depth >= 5) e.push(['w_skyiron', 2], ['a_skyplate', 2]);
  return e;
}

export function pickWeighted(rng, entries) {
  let total = 0;
  for (const [, w] of entries) total += w;
  let r = rng.next() * total;
  for (const [id, w] of entries) {
    r -= w;
    if (r <= 0) return id;
  }
  return entries[entries.length - 1][0];
}

/** Short flavor line shown the first time a depth is entered. */
export const DEPTH_FLAVOR = {
  2: 'The air tastes of pre-flip rain.',
  3: 'Old roots hang from the ceiling like drowned rigging.',
  4: 'The stone here remembers being sky. It creaks.',
  5: 'Half-buried pearls stud the walls, all of them dark.',
  6: 'Something far below is breathing very slowly.',
  7: 'The dark here is older than the flip.',
  8: 'Your torchlight seems smaller than it used to be.',
  9: 'A pale glimmer, far off. The First Pearl is on this floor.',
};
