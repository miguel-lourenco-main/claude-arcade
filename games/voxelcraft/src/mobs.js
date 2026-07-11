// The creatures of the Upturn (see LORE.md) — a data-driven roster spanning
// the whole difficulty space: easy-to-see passive grazers, night stalkers you
// can barely make out, motionless cave ambushers, retaliating desert tanks,
// and a rare shoreline bruiser. One shared physics/AI core.

import * as THREE from "three";
import {
  BLOCKS, GRASS, SAND, MUD, WATER, LAVA, isFluid, COAL_ORE, TORCH,
  SNUFFET_LOIN, MOSS_CLUMP, KELP_GLAND, DUSK_PEARL, STARSTONE, AIR,
  LEAVES, LEAVES_COLD, isSolid, PEARLSAND, NACRE,
} from "./blocks.js";
import { mulberry32 } from "./noise.js";

const SPAWN_INTERVAL = 4;   // seconds between spawn attempts
const SPAWN_MIN = 18, SPAWN_MAX = 40;
const DESPAWN_DIST = 72;
const GRAVITY = 32;
const HOP_SPEED = 9.2;      // clears a 1-block step at any framerate
const MAX_STEP = 0.4;
const TORCH_SAFE_DIST = 12; // hostiles won't spawn near torchlight

// the Prowl (prowl.js): siege spawns come in closer than the ambient band,
// under an elevated-but-hard cap and a total-population perf bound
const PROWL_MIN = 12, PROWL_MAX = 30;
const PROWL_CAP = 10;       // tagged prowlers alive at once (baseline
                            // hostile caps: 4 murklings + 3 stalkids)
const MOB_BOUND = 40;       // total mobs — the whole-roster safety valve

// the bondling (a berry-bonded Snuffet — see LORE.md): companion tuning
const BOND_CAP = 3;         // a Wanderling keeps at most three
const BOND_MAX_HP = 8;      // the bond toughens the little grazer
const FOLLOW_MAX = 10;      // outside this it trots back toward its person
const TELEPORT_DIST = 24;   // beyond this it folds space to their side
const STRAND_SECONDS = 5;   // stuck-while-following this long also teleports
const FOLLOW_SPEED = 4.6;   // a shade over the player's walk — it keeps up
const GUARD_SPEED = 5.2;    // the charge
const FEUD_RANGE = 24;      // mob-vs-mob grudges lapse beyond this

// behavior: passive (flees when hurt) | hostile (chases in aggro range)
//           ambush (motionless until close, then hostile) | neutral
//           (retaliates when punched; contactDamage hurts on touch)
export const SPECIES = {
  snuffet: {
    name: "Snuffet", hp: 3, speed: 1.4, behavior: "passive", habitat: "meadow",
    cap: 4, halfW: 0.35, height: 0.85, sound: "snuffle", gleam: 1,
    drops: [[SNUFFET_LOIN, 1], [MOSS_CLUMP, 1]], // loin + the moss off its back
  },
  murkling: {
    name: "Murkling", hp: 6, speed: 2.6, behavior: "hostile", habitat: "night",
    cap: 4, halfW: 0.25, height: 1.35, damage: 2, aggro: 14, attackRange: 1.3,
    drops: [[COAL_ORE, 1]], sound: "rasp", gleam: 3,
  },
  stalkid: {
    name: "Stalkid", hp: 8, speed: 3.1, behavior: "ambush", habitat: "cave",
    cap: 3, halfW: 0.38, height: 0.6, damage: 4, aggro: 4.5, attackRange: 1.3,
    drops: [[COAL_ORE, 1]], sound: "clicks", gleam: 4,
  },
  prickleback: {
    name: "Prickleback", hp: 10, speed: 0.9, behavior: "neutral", habitat: "desert",
    cap: 2, halfW: 0.45, height: 0.75, damage: 3, contactDamage: 1,
    attackRange: 1.5, knockResist: 0.5, sound: "rustle", gleam: 4,
  },
  mirewalker: {
    name: "Mirewalker", hp: 20, speed: 1.0, behavior: "hostile", habitat: "shore",
    cap: 1, halfW: 0.35, height: 1.9, damage: 5, aggro: 10, attackRange: 1.7,
    knockResist: 0.85, drops: [[COAL_ORE, 3], [TORCH, 4], [KELP_GLAND, 1]],
    rareChance: 0.15, sound: "bellow", gleam: 8,
    inflicts: ["mirerot", 8], // its hit leaves the rot; its gland is the cure
  },
  // the Tuftling: a small tufty burrower of the meadows, mad for Silverfin.
  // Offer it one and it MIGHT decide you are its person (mobs.tame) — a
  // tamed one follows, teleports after you across any distance, and harries
  // whatever you strike. Passive, rare, and the only creature that stays.
  tuftling: {
    name: "Tuftling", hp: 8, speed: 3.4, behavior: "passive", habitat: "meadow",
    cap: 1, halfW: 0.28, height: 0.5, damage: 3, attackRange: 1.2,
    rareChance: 0.25, sound: "chirp", gleam: 2, drops: null,
  },
  // The Unshaken: the one shadow the flip couldn't shake off, grown fat in
  // the dark. Summon-only (the Murk Lantern, at night — habitat "boss"
  // matches neither cleanup rule and never enters _trySpawn), sunrise-proof,
  // and the only fight in the Upturn that fights back properly. Under half
  // health it splits off two murklings and starts LUNGING.
  unshaken: {
    name: "The Unshaken", hp: 60, speed: 2.0, behavior: "hostile", habitat: "boss",
    cap: 1, halfW: 0.6, height: 2.6, damage: 6, aggro: 48, attackRange: 2.2,
    knockResist: 0.9, gleam: 40, boss: true, sound: "bellow",
    drops: [[DUSK_PEARL, 1], [STARSTONE, 2]],
    inflicts: ["dimmed", 5], // its hits hang the dark on you
    // flavor lines main.js reads — a second boss brings its own words
    deathLine: "The Unshaken comes apart into ordinary night.",
    splitLine: "The shadow splits!",
    goneLine: "The shadow settles back into the ground.",
  },
  // the Shellback: the keeper of the pearl-beds (see LORE.md). To a passing
  // Wanderling it reads as one more nacre-crusted boulder on the bed floor —
  // until the treasure moves. Ambush like the Stalkid (motionless until
  // something steps close, then all shoulders), heavy on its feet, near-
  // unmoved by knockback, and the only thing in either sky that sheds NACRE.
  // Habitat "undersky" matches neither day- nor night-cleanup rule, and the
  // spawn director only deals it where the far country's floor shows.
  shellback: {
    name: "Shellback", hp: 24, speed: 1.7, behavior: "ambush", habitat: "undersky",
    cap: 2, halfW: 0.55, height: 0.9, damage: 5, aggro: 3.2, attackRange: 1.6,
    knockResist: 0.9, drops: [[NACRE, 2]], sound: "clicks", gleam: 12,
  },
  // the Peddler: a wandering trader Wanderling, hunched under an enormous
  // patchwork backpack. Day-only (gone by dusk, the way the Murkling is gone
  // by dawn), rare, passive — and it keeps a 60-second grudge if kicked
  // (trades: right-click routing in interact.js; grudgeT gates the window).
  peddler: {
    name: "Peddler", hp: 8, speed: 1.0, behavior: "passive", habitat: "day",
    cap: 1, halfW: 0.4, height: 1.55, rareChance: 0.12, sound: "bell",
    trades: true, grudge: 60, drops: null,
  },
  // the Steadfolk: the residents of a Living Stead (steads.js). Never spawned
  // wild — the stead manager instantiates them from its seeded records and
  // folds them back when the player leaves — so habitat "stead" (like the
  // boss's "boss") matches neither the day- nor night-cleanup rule. Passive,
  // leashed to their well, indoors at dusk; trade from a job table and keep a
  // 60-second grudge if kicked, exactly like the Peddler.
  steadfolk: {
    name: "Steadfolk", hp: 10, speed: 1.5, behavior: "passive", habitat: "stead",
    cap: 0, halfW: 0.32, height: 1.5, sound: "hum",
    trades: true, grudge: 60, drops: null,
  },
};

// --- procedural skins ---------------------------------------------------------

function paint(seed, base, variance, decorate) {
  const canvas = document.createElement("canvas");
  canvas.width = 16; canvas.height = 16;
  const ctx = canvas.getContext("2d");
  const rand = mulberry32(seed);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = (rand() * 2 - 1) * variance;
    ctx.fillStyle = `rgb(${base[0] + d},${base[1] + d},${base[2] + d})`;
    ctx.fillRect(x, y, 1, 1);
  }
  if (decorate) decorate(ctx, rand);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// --- model builders (per species) ---------------------------------------------

export class Mobs {
  constructor(scene) {
    this.scene = scene;
    this.mobs = [];
    this._petTarget = null; // the mob a tamed Tuftling is harrying
    this._spawnTimer = 0;
    this.onMobHurt = null;
    this.onDrop = null;      // (x, y, z, id, n)
    this.onSound = null;     // (soundKind)
    this.onBondlingDeath = null; // (mob) => the mourning chime + text
    // the per-feed bond roll (1-in-3, MC-style repeat feeding). A mutable
    // property so the test handle can pin it to 1 (or 0) deterministically.
    this.bondChance = 1 / 3;

    this._materials = [];    // every mob material, for the day/night tint
    this._builders = this._makeBuilders();
  }

  _mat(tex) {
    const m = new THREE.MeshBasicMaterial({ map: tex });
    this._materials.push(m);
    return m;
  }

  _makeBuilders() {
    const box = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);

    // Snuffet: round moss-backed grazer, banner ears, trunk snout
    const snBody = this._mat(paint(0xa11, [166, 122, 84], 10));
    const snMoss = this._mat(paint(0xa12, [96, 142, 70], 12));
    const snFace = this._mat(paint(0xa13, [166, 122, 84], 10, (ctx) => {
      ctx.fillStyle = "#26221c";
      ctx.fillRect(3, 5, 2, 2); ctx.fillRect(11, 5, 2, 2);
    }));
    // Murkling: charcoal-indigo, near-invisible at night, pale pinprick eyes
    const muBody = this._mat(paint(0xb21, [25, 28, 48], 5));
    const muFace = this._mat(paint(0xb22, [25, 28, 48], 5, (ctx) => {
      ctx.fillStyle = "#cdd4ee";
      ctx.fillRect(4, 6, 1, 1); ctx.fillRect(11, 6, 1, 1);
    }));
    // Stalkid: stone mottle — sits against cave walls like a rock with knees
    const stBody = this._mat(paint(0xc31, [124, 124, 124], 11, (ctx, rand) => {
      for (let i = 0; i < 14; i++) {
        const g = 96 + rand() * 20;
        ctx.fillStyle = `rgb(${g},${g},${g})`;
        ctx.fillRect((rand() * 16) | 0, (rand() * 16) | 0, 2, 1);
      }
    }));
    // Prickleback: cactus-green slab with sand belly
    const prBody = this._mat(paint(0xd41, [74, 128, 58], 10));
    const prSpine = this._mat(paint(0xd42, [206, 196, 150], 8));
    // Shellback: slate hide under a nacre-crusted shell — the crust catches
    // pink and green, exactly the pearl-bed floor it pretends to be part of
    const shBody = this._mat(paint(0x5b01, [88, 92, 104], 9));
    const shShell = this._mat(paint(0x5b02, [176, 180, 194], 11, (ctx, rand) => {
      for (let i = 0; i < 10; i++) {
        ctx.fillStyle = rand() < 0.5 ? "rgb(214,190,200)" : "rgb(188,210,198)";
        ctx.fillRect((rand() * 16) | 0, (rand() * 16) | 0, 1, 1);
      }
    }));
    // Mirewalker: kelp-dark dredger of the flooded ruins
    const miBody = this._mat(paint(0xe51, [44, 62, 48], 8, (ctx, rand) => {
      for (let x = 0; x < 16; x += 3) {
        ctx.fillStyle = "rgba(24,36,28,0.7)";
        ctx.fillRect(x, (rand() * 4) | 0, 1, 14);
      }
    }));
    const miFace = this._mat(paint(0xe52, [44, 62, 48], 8, (ctx) => {
      ctx.fillStyle = "#b8c9a0";
      ctx.fillRect(4, 7, 2, 1); ctx.fillRect(10, 7, 2, 1);
    }));
    // Peddler: bog-mint skin like any Wanderling, but a road-dun coat instead
    // of the rust tunic, and a backpack sewn from every cloth he's ever owned
    const peSkin = this._mat(paint(0xf61, [126, 200, 178], 9));
    const peFace = this._mat(paint(0xf62, [126, 200, 178], 9, (ctx) => {
      ctx.fillStyle = "#22262e";
      ctx.fillRect(4, 7, 2, 2); ctx.fillRect(10, 7, 2, 2); // road-squinted eyes
      ctx.fillStyle = "#3f6f60";
      ctx.fillRect(6, 12, 4, 1); // a mouth for haggling
    }));
    const peCoat = this._mat(paint(0xf63, [116, 100, 72], 9));
    const pePack = this._mat(paint(0xf64, [122, 84, 58], 8, (ctx, rand) => {
      // the patchwork: mismatched squares in old tunic colors, rough-stitched
      const cloth = ["#bc5c30", "#d6b04a", "#4a7a80", "#6a5080", "#5d7a3c"];
      for (let i = 0; i < 9; i++) {
        const w = 3 + ((rand() * 4) | 0), h = 3 + ((rand() * 4) | 0);
        const x = (rand() * (16 - w)) | 0, y = (rand() * (16 - h)) | 0;
        ctx.fillStyle = cloth[(rand() * cloth.length) | 0];
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = "rgba(40,30,20,0.55)"; // the stitching
        ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y, 1, h);
      }
    }));
    const peStick = this._mat(paint(0xf65, [148, 126, 90], 10));
    // the dangling trinkets: little bright oddments on strings
    const peTrinket = this._mat(paint(0xf66, [200, 168, 84], 20));
    // The Unshaken: charcoal-indigo bulk, pale unblinking eyes
    const unBody = this._mat(paint(0xb81, [30, 28, 44], 7, (ctx, rand) => {
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = "rgba(12,10,22,0.7)";
        ctx.fillRect((rand() * 14) | 0, (rand() * 14) | 0, 2, 3);
      }
    }));
    const unFace = this._mat(paint(0xb82, [30, 28, 44], 7, (ctx) => {
      ctx.fillStyle = "#cfd4ea";
      ctx.fillRect(3, 6, 3, 2); ctx.fillRect(10, 6, 3, 2); // the pale stare
    }));
    // Tuftling: warm sand-rust coat, cream belly, and the famous tail tuft
    const tuBody = this._mat(paint(0xa71, [188, 138, 86], 10));
    const tuFace = this._mat(paint(0xa72, [188, 138, 86], 10, (ctx) => {
      ctx.fillStyle = "#26221c";
      ctx.fillRect(4, 6, 3, 3); ctx.fillRect(9, 6, 3, 3); // big dark eyes
      ctx.fillStyle = "#141210";
      ctx.fillRect(7, 10, 2, 1); // the nose
    }));
    const tuTuft = this._mat(paint(0xa73, [232, 214, 178], 12));

    // Steadfolk: an upright Wanderling — bog-mint skin like the Peddler's, but
    // homestead cloth instead of a road coat, and no pack. Four seeded tunic
    // palettes and a matching cap give the residents distinct silhouettes; a
    // job sash across the chest tells grower from wright from keeper at a
    // glance. (Shared materials, picked by variant/job — no per-mob leak.)
    const sfSkin = this._mat(paint(0x5a01, [126, 200, 178], 9));
    const sfFace = this._mat(paint(0x5a02, [126, 200, 178], 9, (ctx) => {
      ctx.fillStyle = "#22262e";
      ctx.fillRect(4, 6, 2, 2); ctx.fillRect(10, 6, 2, 2); // steady eyes
      ctx.fillStyle = "#3f6f60";
      ctx.fillRect(6, 11, 4, 1); // a settled mouth
    }));
    const sfTunicPal = [[74, 108, 120], [120, 78, 104], [96, 122, 70], [178, 140, 70]];
    const sfTunic = sfTunicPal.map((c, i) => this._mat(paint(0x5a10 + i, c, 10)));
    const sfCap = sfTunicPal.map((c, i) =>
      this._mat(paint(0x5a20 + i, [c[0] * 0.7, c[1] * 0.7, c[2] * 0.7], 8)));
    const sfSash = {
      grower: this._mat(paint(0x5a31, [88, 150, 78], 8)),
      wright: this._mat(paint(0x5a32, [150, 108, 66], 8)),
      keeper: this._mat(paint(0x5a33, [200, 110, 70], 8)),
    };

    return {
      // an upright homesteader: tunic torso, capped head, a job sash, swinging
      // arms and legs. opts.variant picks the cloth palette; opts.job the sash.
      steadfolk: (opts = {}) => {
        const v = (opts.variant | 0) % 4;
        const tunic = sfTunic[v], cap = sfCap[v];
        const sash = sfSash[opts.job] || sfSash.grower;
        const g = new THREE.Group();
        const torso = box(0.44, 0.62, 0.26, tunic);
        torso.position.y = 0.92;
        g.add(torso);
        // the job sash: a thin diagonal band across the chest
        const band = box(0.48, 0.12, 0.28, sash);
        band.position.set(0, 1.0, 0.02);
        band.rotation.z = 0.5;
        g.add(band);
        const headMats = [sfSkin, sfSkin, sfSkin, sfSkin, sfFace, sfSkin];
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.38, 0.38), headMats);
        head.position.y = 1.42;
        g.add(head);
        const capMesh = box(0.44, 0.14, 0.44, cap);
        capMesh.position.y = 1.64;
        g.add(capMesh);
        const legs = [];
        for (const side of [-1, 1]) {
          const arm = box(0.13, 0.5, 0.13, tunic);
          arm.position.set(side * 0.29, 0.9, 0.02);
          g.add(arm); legs.push(arm);
        }
        for (const side of [-1, 1]) {
          const leg = box(0.16, 0.44, 0.16, sfSkin);
          leg.position.set(side * 0.12, 0.22, 0.02);
          g.add(leg); legs.push(leg);
        }
        return { group: g, legs };
      },
      snuffet: () => {
        const g = new THREE.Group();
        const body = box(0.7, 0.55, 0.85, snBody);
        body.position.y = 0.48;
        g.add(body);
        const moss = box(0.5, 0.09, 0.62, snMoss);
        moss.position.set(0, 0.79, -0.05);
        g.add(moss);
        const headMats = [snBody, snBody, snBody, snBody, snFace, snBody];
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.42, 0.32), headMats);
        head.position.set(0, 0.62, 0.55);
        g.add(head);
        const snout = box(0.15, 0.14, 0.2, snBody);
        snout.position.set(0, 0.52, 0.78);
        g.add(snout);
        const legs = [];
        for (const [lx, lz] of [[-0.22, 0.3], [0.22, 0.3], [-0.22, -0.3], [0.22, -0.3]]) {
          const leg = box(0.16, 0.3, 0.16, snBody);
          leg.position.set(lx, 0.15, lz);
          g.add(leg); legs.push(leg);
        }
        for (const side of [-1, 1]) {
          const ear = box(0.05, 0.34, 0.2, snBody);
          ear.position.set(side * 0.26, 0.52, 0.5);
          ear.rotation.z = side * 0.35;
          g.add(ear);
        }
        return { group: g, legs };
      },
      unshaken: () => {
        // a murkling silhouette at twice the scale, arms grown too long
        const g = new THREE.Group();
        const body = box(0.72, 1.7, 0.56, unBody);
        body.position.y = 1.5;
        g.add(body);
        const headMats = [unBody, unBody, unBody, unBody, unFace, unBody];
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.56), headMats);
        head.position.y = 2.66;
        g.add(head);
        const legs = [];
        for (const side of [-1, 1]) {
          const leg = box(0.26, 0.7, 0.26, unBody);
          leg.position.set(side * 0.22, 0.35, 0);
          g.add(leg); legs.push(leg);
          const arm = box(0.18, 1.5, 0.18, unBody);
          arm.position.set(side * 0.5, 1.5, 0.12);
          arm.rotation.x = 0.25;
          g.add(arm); legs.push(arm); // arms swing with the stride too
        }
        return { group: g, legs };
      },
      tuftling: () => {
        const g = new THREE.Group();
        const body = box(0.44, 0.3, 0.5, tuBody);
        body.position.y = 0.22;
        g.add(body);
        const headMats = [tuBody, tuBody, tuBody, tuBody, tuFace, tuBody];
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.28, 0.24), headMats);
        head.position.set(0, 0.34, 0.32);
        g.add(head);
        for (const side of [-1, 1]) {
          const ear = box(0.06, 0.16, 0.06, tuBody);
          ear.position.set(side * 0.1, 0.52, 0.3);
          g.add(ear);
        }
        // the tuft: an oversized plume curling up over the back
        const tuft1 = box(0.14, 0.16, 0.22, tuTuft);
        tuft1.position.set(0, 0.34, -0.32);
        tuft1.rotation.x = 0.5;
        g.add(tuft1);
        const tuft2 = box(0.18, 0.2, 0.16, tuTuft);
        tuft2.position.set(0, 0.5, -0.42);
        g.add(tuft2);
        const legs = [];
        for (const [lx, lz] of [[-0.14, 0.16], [0.14, 0.16], [-0.14, -0.16], [0.14, -0.16]]) {
          const leg = box(0.1, 0.14, 0.1, tuBody);
          leg.position.set(lx, 0.07, lz);
          g.add(leg); legs.push(leg);
        }
        return { group: g, legs };
      },
      murkling: () => {
        const g = new THREE.Group();
        const body = box(0.36, 0.85, 0.28, muBody);
        body.position.y = 0.75;
        g.add(body);
        const headMats = [muBody, muBody, muBody, muBody, muFace, muBody];
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.28), headMats);
        head.position.y = 1.33;
        g.add(head);
        const legs = [];
        for (const side of [-1, 1]) {
          const leg = box(0.1, 0.36, 0.1, muBody);
          leg.position.set(side * 0.1, 0.18, 0);
          g.add(leg); legs.push(leg);
          const arm = box(0.08, 0.6, 0.08, muBody);
          arm.position.set(side * 0.24, 0.9, 0);
          g.add(arm); legs.push(arm); // arms sway with the same cycle
        }
        return { group: g, legs };
      },
      stalkid: () => {
        const g = new THREE.Group();
        const body = box(0.72, 0.42, 0.6, stBody);
        body.position.y = 0.36;
        g.add(body);
        const brow = box(0.5, 0.14, 0.2, stBody);
        brow.position.set(0, 0.6, 0.18);
        g.add(brow);
        const legs = [];
        for (const [lx, lz] of [[-0.26, 0.2], [0.26, 0.2], [-0.26, -0.2], [0.26, -0.2]]) {
          const leg = box(0.13, 0.18, 0.13, stBody);
          leg.position.set(lx, 0.09, lz);
          g.add(leg); legs.push(leg);
        }
        return { group: g, legs };
      },
      prickleback: () => {
        const g = new THREE.Group();
        const body = box(0.88, 0.45, 1.05, prBody);
        body.position.y = 0.4;
        g.add(body);
        for (let i = 0; i < 6; i++) {
          const spine = box(0.08, 0.26, 0.08, prSpine);
          spine.position.set((i % 2) * 0.3 - 0.15, 0.72, -0.35 + Math.floor(i / 2) * 0.35);
          g.add(spine);
        }
        const legs = [];
        for (const [lx, lz] of [[-0.3, 0.35], [0.3, 0.35], [-0.3, -0.35], [0.3, -0.35]]) {
          const leg = box(0.16, 0.18, 0.16, prBody);
          leg.position.set(lx, 0.09, lz);
          g.add(leg); legs.push(leg);
        }
        return { group: g, legs };
      },
      // the Shellback: a low broad dome over stubby feet — parked, it reads
      // as a boulder (the ambush AI keeps it motionless until the pounce)
      shellback: () => {
        const g = new THREE.Group();
        const body = box(1.0, 0.5, 1.1, shBody);
        body.position.y = 0.35;
        g.add(body);
        // the shell: two stepped nacre tiers doming the back
        const shellLow = box(1.1, 0.3, 1.2, shShell);
        shellLow.position.y = 0.62;
        g.add(shellLow);
        const shellHigh = box(0.8, 0.24, 0.9, shShell);
        shellHigh.position.y = 0.86;
        g.add(shellHigh);
        // a heavy brow peeking out the front of the dome
        const brow = box(0.5, 0.18, 0.22, shBody);
        brow.position.set(0, 0.5, 0.6);
        g.add(brow);
        const legs = [];
        for (const [lx, lz] of [[-0.4, 0.4], [0.4, 0.4], [-0.4, -0.4], [0.4, -0.4]]) {
          const leg = box(0.18, 0.2, 0.18, shBody);
          leg.position.set(lx, 0.1, lz);
          g.add(leg); legs.push(leg);
        }
        return { group: g, legs };
      },
      mirewalker: () => {
        const g = new THREE.Group();
        const body = box(0.6, 1.05, 0.42, miBody);
        body.position.y = 1.1;
        g.add(body);
        const headMats = [miBody, miBody, miBody, miBody, miFace, miBody];
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.35, 0.38), headMats);
        head.position.y = 1.8;
        g.add(head);
        const legs = [];
        for (const side of [-1, 1]) {
          const leg = box(0.18, 0.62, 0.18, miBody);
          leg.position.set(side * 0.16, 0.31, 0);
          g.add(leg); legs.push(leg);
          const arm = box(0.15, 0.85, 0.15, miBody);
          arm.position.set(side * 0.42, 1.15, 0);
          g.add(arm); legs.push(arm);
        }
        return { group: g, legs };
      },
      // the Peddler: Wanderling proportions, but hunched forward under the
      // pack, one arm out on a walking stick, trinkets swinging behind
      peddler: () => {
        const g = new THREE.Group();
        // torso pitched forward — the hunch is the whole silhouette
        const torso = box(0.46, 0.62, 0.26, peCoat);
        torso.position.set(0, 0.98, 0.06);
        torso.rotation.x = 0.42;
        g.add(torso);
        // head carried low and ahead of the shoulders
        const headMats = [peSkin, peSkin, peSkin, peSkin, peFace, peSkin];
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), headMats);
        head.position.set(0, 1.22, 0.3);
        g.add(head);
        // a wide-brimmed road hat over it
        const brim = box(0.56, 0.05, 0.56, peCoat);
        brim.position.set(0, 1.44, 0.3);
        g.add(brim);
        const crown = box(0.3, 0.16, 0.3, peCoat);
        crown.position.set(0, 1.53, 0.3);
        g.add(crown);
        // the enormous patchwork backpack, taller than its owner
        const pack = box(0.6, 0.78, 0.42, pePack);
        pack.position.set(0, 1.16, -0.28);
        pack.rotation.x = 0.18;
        g.add(pack);
        const bedroll = box(0.5, 0.18, 0.3, pePack);
        bedroll.position.set(0, 1.62, -0.36);
        bedroll.rotation.x = 0.18;
        g.add(bedroll);
        // dangling trinkets on strings off the pack's flanks
        for (const [tx, ty, tz] of [[-0.34, 0.72, -0.3], [0.34, 0.62, -0.24], [0.3, 0.86, -0.42]]) {
          const string = box(0.02, 0.14, 0.02, peStick);
          string.position.set(tx, ty + 0.1, tz);
          g.add(string);
          const trinket = box(0.09, 0.09, 0.09, peTrinket);
          trinket.position.set(tx, ty, tz);
          g.add(trinket);
        }
        // walking-stick arm: held stiffly forward, planted on a tall staff
        const stickArm = box(0.14, 0.44, 0.14, peCoat);
        stickArm.position.set(0.3, 1.02, 0.24);
        stickArm.rotation.x = -0.7;
        g.add(stickArm);
        const staff = box(0.06, 1.15, 0.06, peStick);
        staff.position.set(0.3, 0.58, 0.42);
        g.add(staff);
        // the off arm swings with the walk; so do the legs
        const legs = [];
        const arm = box(0.14, 0.5, 0.14, peCoat);
        arm.position.set(-0.3, 0.92, 0.06);
        g.add(arm); legs.push(arm);
        for (const side of [-1, 1]) {
          const leg = box(0.16, 0.44, 0.16, peCoat);
          leg.position.set(side * 0.12, 0.22, 0.06);
          g.add(leg); legs.push(leg);
        }
        return { group: g, legs };
      },
    };
  }

  setLight(level, tint) {
    for (const m of this._materials) {
      m.color.copy(tint).multiplyScalar(Math.min(1, level + 0.15));
    }
  }

  // feeding a snuffet its favorite pips (courting — see the pass in update):
  // an adult with no courting cooldown starts looking fondly around.
  // Returns whether the bite took. (The BERRY path — bonding — is feed().)
  court(m) {
    if (m.species !== "snuffet" || m.baby || m.breedCd > 0 || m.loveT > 0) return false;
    m.loveT = 30;
    if (this.onSound) this.onSound(m.spec.sound);
    return true;
  }

  // offering a Tuftling a Silverfin: one-in-three it decides you are its
  // person. Returns "tamed" | "shy" | null (not tameable).
  tame(m) {
    if (m.species !== "tuftling" || m.tamed) return null;
    if (Math.random() < 1 / 3) {
      m.tamed = true;
      m.mode = "follow";
      if (this.onSound) this.onSound(m.spec.sound);
      return "tamed";
    }
    if (this.onSound) this.onSound(m.spec.sound);
    return "shy";
  }

  // follow <-> stay, toggled by an empty-hand right-click
  togglePet(m) {
    m.mode = m.mode === "stay" ? "follow" : "stay";
    if (this.onSound) this.onSound(m.spec.sound);
    return m.mode;
  }

  // the nearest other mob within range matching pred — the one proximity
  // scan courting, pup-shadowing, and whatever comes next all share.
  // Returns {mob, d} or null (d is reused by callers, never recomputed).
  _nearest(m, range, pred) {
    let best = null, bestD = range;
    for (const o of this.mobs) {
      if (o === m || !pred(o)) continue;
      const d = Math.hypot(o.x - m.x, o.z - m.z);
      if (d < bestD) { bestD = d; best = o; }
    }
    return best ? { mob: best, d: bestD } : null;
  }

  // wild-population count for the spawn director: bondlings and tamed
  // creatures are kept, not spawned, so they never crowd the wild cap
  count(speciesKey) {
    let n = 0;
    for (const m of this.mobs) {
      if (m.species === speciesKey && !m.bonded && !m.tamed) n++;
    }
    return n;
  }

  bondedCount() {
    let n = 0;
    for (const m of this.mobs) if (m.bonded) n++;
    return n;
  }

  spawnAt(x, y, z, speciesKey = "snuffet", opts = {}) {
    const spec = SPECIES[speciesKey];
    if (!spec) return null;
    const { group, legs } = this._builders[speciesKey](opts);
    group.position.set(x, y, z);
    this.scene.add(group);
    const mob = {
      species: speciesKey, spec,
      group, legs,
      x, y, z, vx: 0, vy: 0, vz: 0,
      yaw: Math.random() * Math.PI * 2,
      state: spec.behavior === "ambush" ? "wait" : "idle",
      stateT: 1 + Math.random() * 2,
      walkPhase: 0,
      // the Prowl's tags (prowl.js): a tagged hunter is faster and homes on
      // the player from any range; harmless defaults for everything else
      prowler: false,
      speedMul: 1,
      hp: spec.hp,
      hurtT: 0,
      critT: 0,            // falling-crit pop timer (drives the scale burst)
      attackCd: 0,
      contactCd: 0,
      angryT: 0,           // neutral retaliation window
      grudgeT: 0,          // peddler: seconds left refusing to trade
      callT: 4 + Math.random() * 10,
      onGround: false,
      hitWall: false,
      // the bondling state (snuffets only, but harmless defaults for all)
      bonded: false,
      sitting: false,
      scarfSeed: 0,
      guardTarget: null,   // bondling: the mob it's charging
      targetMob: null,     // hostile/neutral: the bondling that hit it
      strandT: 0,          // seconds stuck while trying to follow
      // courting (snuffets): fed adults seek each other; pups grow up
      loveT: 0,          // seconds left seeking a mate
      breedCd: 0,        // seconds before this adult will court again
      baby: false,
      growT: 0,          // seconds until a pup is grown
      sizeMul: 1,        // presentation + collision scale (pups 0.45)
      tamed: false,      // a tamed Tuftling stays, follows, and fights
      mode: "follow",    // tamed: "follow" | "stay"
      split: false,      // boss: the half-health shadow-split fired
      lungeCd: 0,        // boss phase 2: seconds to the next lunge
      farT: 0,           // boss: seconds spent >60 blocks from the player
      dimT: 0,           // a Dusk Thread's mark: halved pace while it holds
      // the Steadfolk (steads.js): a resident manager fills these in — null
      // here keeps every other creature's update paths untouched
      stead: null,       // { wx, wy, wz, leash } — the well it's leashed to
      record: null,      // its persistent resident record (warmth, hp)
      wp: null,          // current wander waypoint
      steadWait: 0,      // day-wander pause timer
      knockCd: 0,        // door-chime throttle
    };
    this.mobs.push(mob);
    return mob;
  }

  // --- the bondling: a berry-bonded companion (see LORE.md) --------------------

  // one berry down the trunk. Returns { bonded, healed } so the caller can
  // cue the moment (the heart-puff always shows; the bond gets its own line).
  feed(m) {
    let bonded = false, healed = false;
    if (m.bonded) {
      if (m.hp < BOND_MAX_HP) {
        m.hp = Math.min(BOND_MAX_HP, m.hp + 2);
        healed = true;
      }
    } else if (this.bondedCount() < BOND_CAP && Math.random() < this.bondChance) {
      this.bond(m);
      bonded = true;
    }
    return { bonded, healed };
  }

  // make it official: the scarf goes on, the frame toughens, and the meadow's
  // despawn rules stop applying. scarfSeed is passed on load so a reloaded
  // bondling keeps its exact colors.
  bond(m, scarfSeed = (Math.random() * 0xffffffff) >>> 0) {
    if (m.bonded) return;
    m.bonded = true;
    m.sitting = false;
    m.scarfSeed = scarfSeed;
    m.hp = BOND_MAX_HP;
    m.scarfMesh = this._buildScarf(scarfSeed);
    m.group.add(m.scarfMesh);
  }

  toggleSit(m) {
    m.sitting = !m.sitting;
    if (m.sitting) { m.guardTarget = null; m.strandT = 0; }
    return m.sitting;
  }

  // the little original neck-scarf: a band knotted where the round body meets
  // the head, dyed in old-tunic cloth picked by the owner seed
  _buildScarf(seed) {
    const rand = mulberry32(seed);
    const cloth = [
      [188, 92, 48], [214, 176, 74], [74, 122, 128],
      [106, 80, 128], [93, 122, 60], [172, 70, 82],
    ];
    const base = cloth[(rand() * cloth.length) | 0];
    let trim = cloth[(rand() * cloth.length) | 0];
    if (trim === base) trim = cloth[(cloth.indexOf(base) + 1) % cloth.length];
    const mat = this._mat(paint((seed >>> 8) || 1, base, 10, (ctx) => {
      ctx.fillStyle = `rgb(${trim[0]},${trim[1]},${trim[2]})`;
      for (let y = 2; y < 16; y += 5) ctx.fillRect(0, y, 16, 2); // the stripes
    }));
    const g = new THREE.Group();
    const box = (w, h, d) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    const band = box(0.5, 0.14, 0.4);
    band.position.set(0, 0.52, 0.45);
    g.add(band);
    const knot = box(0.14, 0.14, 0.12);
    knot.position.set(0.2, 0.44, 0.55);
    g.add(knot);
    const tail = box(0.12, 0.26, 0.05);
    tail.position.set(0.2, 0.28, 0.58);
    tail.rotation.x = 0.25;
    g.add(tail);
    return g;
  }

  // any player-landed hit sends the unseated bondlings after the victim; any
  // bondling-landed hit (opts.attacker) makes the victim feud back. Neither
  // ever points at the Peddler or at another bondling.
  _setGuard(target) {
    if (!target || target.spec.trades || target.bonded) return;
    for (const b of this.mobs) {
      if (!b.bonded || b.sitting || b === target) continue;
      if (Math.hypot(b.x - target.x, b.z - target.z) > FEUD_RANGE) continue;
      b.guardTarget = target;
    }
  }

  // fold space back to the player's side: the first clear 2-cell column with
  // solid footing near them (scanned top-down, so it lands ON things, not in)
  _teleportToPlayer(world, m, player) {
    for (const [dx, dz] of [[1.6, 0], [-1.6, 0], [0, 1.6], [0, -1.6],
                            [1.6, 1.6], [-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6]]) {
      const tx = player.pos.x + dx, tz = player.pos.z + dz;
      const bx = Math.floor(tx), bz = Math.floor(tz);
      if (!world.isGenerated(bx >> 4, bz >> 4)) continue;
      const py = Math.floor(player.pos.y);
      for (let by = Math.min(93, py + 2); by >= Math.max(1, py - 3); by--) {
        if (world.getBlock(bx, by, bz) !== AIR ||
            world.getBlock(bx, by + 1, bz) !== AIR ||
            !isSolid(world.getBlock(bx, by - 1, bz))) continue;
        m.x = tx; m.y = by + 0.01; m.z = tz;
        m.vx = m.vy = m.vz = 0;
        m.strandT = 0;
        m.group.position.set(m.x, m.y, m.z);
        return true;
      }
    }
    return false;
  }

  // persistence: the bonded companions ride the save as an additive field
  // (species, pos, hp, sitting, scarf seed) — everything else regrows wild
  serializeBondlings() {
    const out = [];
    const r = (v) => Math.round(v * 10) / 10;
    for (const m of this.mobs) {
      if (!m.bonded) continue;
      out.push([m.species, r(m.x), r(m.y), r(m.z), m.hp, m.sitting ? 1 : 0, m.scarfSeed]);
    }
    return out;
  }

  loadBondlings(entries) {
    for (const e of entries) {
      if (this.bondedCount() >= BOND_CAP) break;
      if (!Array.isArray(e) || e.length < 7) continue;
      const [sp, x, y, z, hp, sit, seed] = e;
      if (!SPECIES[sp] || ![x, y, z].every(Number.isFinite)) continue;
      const m = this.spawnAt(x, y, z, sp);
      if (!m) continue;
      this.bond(m, Number.isInteger(seed) && seed >= 0 ? seed : 1);
      m.hp = Number.isFinite(hp) ? Math.max(1, Math.min(BOND_MAX_HP, hp)) : BOND_MAX_HP;
      m.sitting = sit === 1 || sit === true;
    }
  }

  // the Murk Lantern's answer: raise The Unshaken from the ground at the
  // CLICKED cell — a cave summon rises in the cave, not on the surface
  // sixty blocks up. Returns the boss, or null if one already stalks the
  // world (callers announce; consume-last discipline lives in main.js).
  summonBoss(world, x, y, z) {
    for (const m of this.mobs) if (m.spec.boss) return null;
    // first open pair of cells above the clicked block (it needs headroom)
    const bx = Math.floor(x), bz = Math.floor(z);
    let sy = -1;
    for (let cy = Math.floor(y); cy < Math.min(Math.floor(y) + 6, 93); cy++) {
      if (world.getBlock(bx, cy + 1, bz) === AIR &&
          world.getBlock(bx, cy + 2, bz) === AIR &&
          world.getBlock(bx, cy + 3, bz) === AIR) { sy = cy; break; }
    }
    if (sy < 0) return null;
    const boss = this.spawnAt(x, sy + 1.01, z, "unshaken");
    if (boss) {
      boss.critT = 0.3; // rises with a pop
      if (this.onSound) this.onSound(boss.spec.sound);
    }
    return boss;
  }

  // tamed companions persist (the ONLY mobs that do): [[x,y,z,hp,stay]...]
  serializePets() {
    const r = (v) => Math.round(v * 10) / 10;
    return this.mobs.filter((m) => m.tamed)
      .map((m) => [r(m.x), r(m.y), r(m.z), m.hp, m.mode === "stay" ? 1 : 0]);
  }

  loadPets(arr) {
    if (!Array.isArray(arr)) return;
    for (const e of arr) {
      if (!Array.isArray(e) || e.length < 4) continue;
      const [x, y, z, hp, stay] = e;
      if (![x, y, z].every(Number.isFinite) || !Number.isFinite(hp)) continue;
      const m = this.spawnAt(x, y, z, "tuftling");
      if (!m) continue;
      m.tamed = true;
      m.hp = Math.max(1, Math.min(m.spec.hp, hp));
      m.mode = stay ? "stay" : "follow";
    }
  }

  // --- spawn director ---------------------------------------------------------

  // proper lights suppress hostile spawns: torches (14), starstone (13),
  // the Emberwash (13), starglass (11). The threshold keeps DIM growth —
  // scattered cave flora like Wispcaps (8) — from sterilizing the deep:
  // a mushroom is not a campfire.
  _nearTorch(world, x, y, z) {
    const cx = Math.floor(x) >> 4, cz = Math.floor(z) >> 4;
    const r2 = TORCH_SAFE_DIST * TORCH_SAFE_DIST;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const c = world.getChunk(cx + dx, cz + dz);
      if (!c || c.emitters.size === 0) continue;
      for (const [idx, level] of c.emitters) {
        // the safety radius scales with the emitter's strength: proper
        // lights (torch 14, starstone/Emberwash 13, starglass 11) keep the
        // full watch; DIM growth — a gleam moss tuft (7), a Wispcap (8) —
        // only guards its own small pool of light, so the deep stays
        // dangerous between the tufts (a mushroom is not a campfire)
        const safe = level >= 11 ? TORCH_SAFE_DIST : TORCH_SAFE_DIST * (level / 14);
        const s2 = safe * safe;
        // y first: one compare rejects a surface spawn 30 blocks above the
        // Emberwash without paying the full distance math per pool cell
        const ly = (idx / 256) | 0;
        const dy2 = (ly - y) * (ly - y);
        if (dy2 >= s2) continue;
        const lx = idx % 16, lz = ((idx / 16) | 0) % 16;
        const ex = c.cx * 16 + lx, ez = c.cz * 16 + lz;
        const d2 = (ex - x) ** 2 + dy2 + (ez - z) ** 2;
        if (d2 < Math.min(r2, s2)) return true;
      }
    }
    return false;
  }

  // is this cell roofed over from the sky? (mirrors the mesher's skylight
  // column rule: leaves never block the sky, so a forest floor is still day)
  _skyCovered(world, x, y, z) {
    for (let yy = y + 1; yy < 96; yy++) {
      const id = world.getBlock(x, yy, z);
      if (id !== AIR && BLOCKS[id].opaque && id !== LEAVES && id !== LEAVES_COLD) return true;
    }
    return false;
  }

  // the spawn-light gate for the creatures of the old sky (murkling,
  // stalkid): they need darkness — night anywhere, or, at any hour, a cell
  // the sky can't see (a cave). A nearby emitter (torch, starstone, gleam
  // moss) vetoes the cell either way. Exposed on the test handle via `mobs`.
  canHostileSpawnAt(world, x, y, z, night) {
    if (this._nearTorch(world, x + 0.5, y, z + 0.5)) return false;
    return !!night || this._skyCovered(world, Math.floor(x), Math.floor(y), Math.floor(z));
  }

  _surfaceY(world, x, z) {
    for (let y = 90; y > 2; y--) {
      if (world.getBlock(x, y, z) !== AIR) return y;
    }
    return -1;
  }

  _trySpawn(world, player, terrain, night) {
    const a = Math.random() * Math.PI * 2;
    const r = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
    const x = Math.floor(player.pos.x + Math.cos(a) * r);
    const z = Math.floor(player.pos.z + Math.sin(a) * r);
    if (!world.isGenerated(x >> 4, z >> 4)) return;

    // pick an eligible species for this location/time
    const surfaceY = this._surfaceY(world, x, z);
    if (surfaceY < 0) return;
    const topId = world.getBlock(x, surfaceY, z);
    const biome = terrain.biomeAt(x, z, surfaceY);
    const candidates = [];

    if (!night && topId === GRASS) {
      candidates.push("snuffet");
      candidates.push("peddler");  // rare: rareChance thins this out below
      candidates.push("tuftling"); // rare too, and only one wild at a time
    }
    if (night && isSolid(topId)) candidates.push("murkling");
    if (biome === "desert" && topId === SAND) candidates.push("prickleback");
    // the pearl-beds' keeper: only where the far country's floor shows, and
    // only toward a bed's heart (pearlBedAt exists only on that terrain)
    if (topId === PEARLSAND && terrain.pearlBedAt &&
        terrain.pearlBedAt(x, z) > 0.35) {
      candidates.push("shellback");
    }
    if (topId === SAND || topId === GRASS || topId === MUD) {
      // shoreline: standing water within 3 blocks (the Mirelands' Mire Sod
      // counts as shore ground — the bog is Mirewalker country)
      let shore = false;
      for (let dz = -3; dz <= 3 && !shore; dz++) for (let dx = -3; dx <= 3; dx++) {
        if (world.getBlock(x + dx, surfaceY, z + dz) === WATER) { shore = true; break; }
      }
      if (shore) candidates.push("mirewalker");
    }
    // cave pocket below the surface: the Stalkid at any hour — and by day
    // the Murkling too (a dark cave is night enough for the old sky's
    // leftovers; the light gate below has the final word)
    let caveY = -1;
    for (let tries = 0; tries < 6; tries++) {
      const y = 8 + ((Math.random() * Math.max(4, surfaceY - 16)) | 0);
      if (world.getBlock(x, y, z) === AIR && world.getBlock(x, y + 1, z) === AIR &&
          isSolid(world.getBlock(x, y - 1, z))) { caveY = y; break; }
    }
    if (caveY > 0) {
      candidates.push("stalkid");
      if (!night) candidates.push("murkling");
    }

    // filter at candidate time: a capped or rare-roll-failed species must not
    // soak the whole 4-second attempt and starve the others
    const eligible = candidates.filter((k) => {
      const s = SPECIES[k];
      if (this.count(k) >= s.cap) return false;
      if (s.rareChance && Math.random() > s.rareChance) return false;
      return true;
    });
    if (eligible.length === 0) return;
    const pick = eligible[(Math.random() * eligible.length) | 0];
    const spec = SPECIES[pick];

    const hostile = spec.behavior === "hostile" || spec.behavior === "ambush";
    const inCave = pick === "stalkid" || (pick === "murkling" && !night);
    const spawnY = inCave ? caveY : surfaceY + 1;
    // creatures of the old sky (murkling/stalkid) pass the full darkness
    // gate — light at the CELL, not just the hour; other hostiles (the
    // Mirewalker walks in daylight) only respect torch pools, as before
    // the Shellback is exempt from the light veto: it LIVES in the light —
    // the pearl-beds it keeps are studded with lit starstone, and a keeper
    // the glow chased off would keep nothing
    if (pick === "murkling" || pick === "stalkid") {
      if (!this.canHostileSpawnAt(world, x, spawnY, z, night)) return;
    } else if (hostile && pick !== "shellback" &&
               this._nearTorch(world, x + 0.5, spawnY, z + 0.5)) {
      return;
    }

    this.spawnAt(x + 0.5, spawnY + 0.01, z + 0.5, pick);
  }

  // --- the Prowl's spawn attempts (prowl.js drives the ~1.33s cadence) --------

  prowlerCount() {
    let n = 0;
    for (const m of this.mobs) if (m.prowler) n++;
    return n;
  }

  // one siege spawn attempt: a murkling or stalkid (the stalkids leave their
  // posts on a Prowl night) seated on a dark surface cell near the player,
  // tagged, +20% fast, and player-seeking. Safety valves live HERE so no
  // caller can flood the world: a hard prowler cap, a total-mob bound, and
  // the same dark-cell gate (torch/starstone/gleam-moss denial) every
  // creature of the old sky obeys — a lit, walled stead stays defensible.
  trySpawnProwler(world, player, terrain) {
    if (this.prowlerCount() >= PROWL_CAP || this.mobs.length >= MOB_BOUND) return null;
    const a = Math.random() * Math.PI * 2;
    const r = PROWL_MIN + Math.random() * (PROWL_MAX - PROWL_MIN);
    const x = Math.floor(player.pos.x + Math.cos(a) * r);
    const z = Math.floor(player.pos.z + Math.sin(a) * r);
    if (!world.isGenerated(x >> 4, z >> 4)) return null;
    const surfaceY = this._surfaceY(world, x, z);
    if (surfaceY < 0) return null;
    if (!isSolid(world.getBlock(x, surfaceY, z))) return null; // no water seats
    if (terrain.biomeAt(x, z, surfaceY) === "ocean") return null;
    const spawnY = surfaceY + 1;
    // the full darkness gate: the Prowl is a night event, but the CELL must
    // be dark too — heavy torchlight refuses prowlers outright
    if (!this.canHostileSpawnAt(world, x, spawnY, z, true)) return null;
    // weighted to whichever the biome allows: murklings walk everywhere at
    // night; the stony lurkers make up more of the press in open country
    const pick = Math.random() < 0.7 ? "murkling" : "stalkid";
    const m = this.spawnAt(x + 0.5, spawnY + 0.01, z + 0.5, pick);
    if (m) {
      m.prowler = true;
      m.speedMul = 1.2;
      if (m.spec.behavior === "ambush") m.state = "hunt"; // no waiting tonight
    }
    return m;
  }

  // --- per-frame update ---------------------------------------------------------

  update(dt, { world, player, sfx, terrain, night, tod = 0.25 }) {
    this._spawnTimer -= dt;
    if (this._spawnTimer <= 0) {
      this._spawnTimer = SPAWN_INTERVAL;
      this._trySpawn(world, player, terrain, night);
    }

    const canFight = player.mode === "survival" && !player.dead;

    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const m = this.mobs[i];
      const spec = m.spec;
      const distToPlayer = Math.hypot(m.x - player.pos.x, m.z - player.pos.z);
      // 3D distance for behavior: a stalkid 25 blocks below the surface must
      // NOT wake up because someone walked overhead
      const dist3 = Math.hypot(m.x - player.pos.x, m.y - player.pos.y, m.z - player.pos.z);

      // bondlings and tamed companions never despawn — distance is handled
      // by their own teleports; a boss has its own leash below
      if (distToPlayer > DESPAWN_DIST && !m.bonded && !m.tamed && !spec.boss && !m.stead) {
        this._remove(i); continue;
      }
      // a kited boss doesn't vanish at a distance line — but if the player
      // dies, or keeps 60+ blocks away for 90 seconds, the shadow settles
      // back into the ground (and the lantern is owed nothing)
      if (spec.boss) {
        m.farT = distToPlayer > 60 ? m.farT + dt : 0;
        if (player.dead || m.farT > 90) {
          if (this.onBossGone) this.onBossGone(spec);
          this._remove(i);
          continue;
        }
      }
      // death pays out BEFORE the dawn cleanup — a kill landed on the
      // dawn-crossing frame still drops its loot
      if (m.hp <= 0) {
        // a fallen bondling drops nothing; it gets the mourning chime instead
        if (m.bonded) {
          this.onBondlingDeath?.(m);
          this._remove(i);
          continue;
        }
        // a fallen steadfolk: no drops — the manager marks its record dead so
        // it stays gone across saves, and mourns it like a bondling
        if (m.stead) {
          this.onSteadfolkDeath?.(m);
          this._remove(i);
          continue;
        }
        if (spec.drops && !m.baby && this.onDrop) {
          // a prowler carries double — the night pays for the trouble
          const lootMul = m.prowler ? 2 : 1;
          for (const [id, n] of spec.drops) this.onDrop(m.x, m.y + 0.4, m.z, id, n * lootMul);
        }
        // gleam clings to a felled WILD beast — never a pup (breeding would
        // become a cull-farm) and never your own tamed companion
        if (this.onKill && !m.baby && !m.tamed) this.onKill(m);
        this._remove(i);
        continue;
      }
      // the Prowl's hunters are the night's own: ALL of them go at dawn,
      // cave roof or no (prowl.js sounds the relieved sting as it ends)
      if (!night && m.prowler) { this._remove(i); continue; }
      // creatures of the old sky are gone by dawn, as if embarrassed — but
      // only where dawn can SEE them: one deep in a cave keeps its post.
      // The Peddler is gone by dusk, as if he knows something.
      if (!night && spec.habitat === "night" &&
          !this._skyCovered(world, Math.floor(m.x), Math.floor(m.y + 0.5), Math.floor(m.z))) {
        this._remove(i); continue;
      }
      if (night && spec.habitat === "day") { this._remove(i); continue; }
      // a far-flung bondling folds space back to its person's side — checked
      // BEFORE the generated-chunk gate, since it's the mob's own chunk that
      // may be unloaded while the player's is fine
      if (m.bonded && !m.sitting && dist3 > TELEPORT_DIST) {
        this._teleportToPlayer(world, m, player);
      }
      if (!world.isGenerated(Math.floor(m.x) >> 4, Math.floor(m.z) >> 4)) continue;
      m.hurtT = Math.max(0, m.hurtT - dt);
      m.critT = Math.max(0, m.critT - dt);
      m.attackCd = Math.max(0, m.attackCd - dt);
      m.contactCd = Math.max(0, m.contactCd - dt);
      m.angryT = Math.max(0, m.angryT - dt);
      m.grudgeT = Math.max(0, m.grudgeT - dt);
      m.breedCd = Math.max(0, m.breedCd - dt);
      m.dimT = Math.max(0, m.dimT - dt);
      m.lungeCd = Math.max(0, m.lungeCd - dt);
      if (m.baby) {
        m.growT -= dt;
        if (m.growT <= 0) { m.baby = false; m.sizeMul = 1; }
      }

      // --- behavior selection ---
      // the mob-vs-mob feud: a hostile hit by a bondling turns on it for as
      // long as the anger holds (and the feud stays in range)
      let tgtMob = null;
      if (m.targetMob) {
        const t = m.targetMob;
        const alive = t.hp > 0 && this.mobs.includes(t);
        if (!alive || m.angryT <= 0 ||
            Math.hypot(t.x - m.x, t.z - m.z) > FEUD_RANGE) {
          m.targetMob = null;
        } else {
          tgtMob = t;
        }
      }

      const aggro = spec.aggro || 0;
      let chasing = false;
      if (canFight) {
        // hostiles chase in range — or while angry about a hit from outside it
        if (spec.behavior === "hostile" && (dist3 < aggro || m.angryT > 0)) chasing = true;
        if (spec.behavior === "ambush") {
          if (m.state === "wait" && dist3 < aggro) m.state = "hunt";
          if (m.state === "hunt") {
            chasing = dist3 < aggro * 3 || !!tgtMob;
            if (!chasing) m.state = "wait";
          }
        }
        if (spec.behavior === "neutral" && m.angryT > 0) chasing = true;
        // a prowler never idles: it homes on the player from ANY range —
        // the seeking bias that makes a Prowl night a siege, not weather
        if (m.prowler) { chasing = true; if (m.state === "wait") m.state = "hunt"; }
      }
      if (tgtMob) chasing = true; // the feud stands even at the player's back

      let targetSpeed = 0;
      if (m.tamed) {
        targetSpeed = this._petBehavior(m, player);
      } else if (chasing) {
        // the feud target outranks the player while it holds
        const fx = tgtMob ? tgtMob.x : player.pos.x;
        const fy = tgtMob ? tgtMob.y : player.pos.y;
        const fz = tgtMob ? tgtMob.z : player.pos.z;
        m.yaw = Math.atan2(fx - m.x, fz - m.z);
        targetSpeed = spec.speed;
        // The Unshaken's phases: crossing half health it SPLITS — two
        // murklings peel off its flanks — then it moves half again as
        // fast and starts lunging in bursts the substepped mover handles
        if (spec.boss) {
          if (!m.split && m.hp <= spec.hp / 2) {
            m.split = true;
            m.critT = 0.3;
            for (const side of [-1, 1]) {
              this.spawnAt(m.x + Math.cos(m.yaw) * side * 1.4, m.y + 0.2,
                m.z - Math.sin(m.yaw) * side * 1.4, "murkling");
            }
            if (this.onSound) this.onSound(spec.sound);
            if (this.onBossSplit) this.onBossSplit(spec);
          }
          if (m.split) {
            targetSpeed = spec.speed * 1.5;
            // the lunge is aimed at the PLAYER — a bondling feud never
            // baits the shadow into leaping somewhere else
            if (!tgtMob && m.lungeCd <= 0 && distToPlayer > 3 && distToPlayer < 14 && m.onGround) {
              m.lungeCd = 6;
              const lx = player.pos.x - m.x, lz = player.pos.z - m.z;
              const ll = Math.max(0.2, Math.hypot(lx, lz));
              m.vx = (lx / ll) * spec.speed * 4.5;
              m.vz = (lz / ll) * spec.speed * 4.5;
              m.vy = 4;
              if (this.onSound) this.onSound(spec.sound);
            }
          }
        }
        if (tgtMob) {
          // mob-vs-mob melee: no line-of-sight ritual, just reach + cooldown
          if (Math.hypot(fx - m.x, fz - m.z) < spec.attackRange + tgtMob.spec.halfW &&
              Math.abs(fy - m.y) < 2 && m.attackCd <= 0) {
            m.attackCd = 1;
            this.strike(tgtMob, spec.damage || 1, { x: m.x, z: m.z }, { attacker: m });
          }
        } else if (distToPlayer < spec.attackRange && m.attackCd <= 0 &&
            Math.abs(player.pos.y - m.y) < 2 &&
            this._lineOfSight(world, m, player)) {
          // melee — only with clear line of sight (no biting through walls)
          m.attackCd = 1;
          player.damage(spec.damage, `a ${spec.name}`);
          // some hits leave a whim behind (the Mirewalker's rot)
          if (spec.inflicts) player.addEffect(spec.inflicts[0], spec.inflicts[1]);
          this._setGuard(m); // the bondlings take exception
          const kx = player.pos.x - m.x, kz = player.pos.z - m.z;
          const kl = Math.max(0.2, Math.hypot(kx, kz));
          player.vel.x += (kx / kl) * 5;
          player.vel.z += (kz / kl) * 5;
          player.vel.y = Math.max(player.vel.y, 4);
        }
      } else if (m.state === "flee") {
        m.stateT -= dt;
        targetSpeed = spec.speed * 1.9;
        if (m.stateT <= 0) { m.state = "idle"; m.stateT = 1 + Math.random() * 2; }
      } else if (m.state === "wait") {
        targetSpeed = 0; // the rock with knees waits
      } else {
        m.stateT -= dt;
        if (m.stateT <= 0) {
          if (m.state === "idle") {
            m.state = "walk";
            m.stateT = 1 + Math.random() * 2;
            m.yaw = Math.random() * Math.PI * 2;
          } else {
            m.state = "idle";
            m.stateT = 1.5 + Math.random() * 2.5;
          }
        }
        if (m.state === "walk") targetSpeed = spec.speed * 0.7;
      }

      // snuffet courting: a fed adult seeks the nearest other fed adult;
      // touching noses makes a Snufflet (a loaf in training). Pups loosely
      // shadow the nearest adult so the meadow keeps its little families.
      if (m.species === "snuffet" && !chasing && m.state !== "flee") {
        if (m.loveT > 0 && !m.baby) {
          m.loveT -= dt;
          const mate = this._nearest(m, 8, (o) =>
            o.species === "snuffet" && !o.baby && o.loveT > 0);
          if (mate) {
            m.yaw = Math.atan2(mate.mob.x - m.x, mate.mob.z - m.z);
            targetSpeed = spec.speed;
            if (mate.d < 1.2) {
              m.loveT = 0; mate.mob.loveT = 0;
              m.breedCd = 120; mate.mob.breedCd = 120;
              const pup = this.spawnAt((m.x + mate.mob.x) / 2, m.y + 0.1,
                (m.z + mate.mob.z) / 2, "snuffet");
              if (pup) { pup.baby = true; pup.growT = 180; pup.sizeMul = 0.45; }
              if (this.onSound) this.onSound(spec.sound);
              if (this.onBreed) this.onBreed(m);
            }
          }
        } else if (m.baby) {
          const adult = this._nearest(m, 12, (o) =>
            o.species === "snuffet" && !o.baby);
          if (adult && adult.d > 4) {
            m.yaw = Math.atan2(adult.mob.x - m.x, adult.mob.z - m.z);
            targetSpeed = spec.speed * 0.9;
          }
        }
      }

      // --- the bondling companion states: SIT / GUARD / FOLLOW ---
      // Overrides whatever the ambient idle/walk (or a courting stroll)
      // picked above. Inside the 3-10 follow band the ambient wander
      // stands — that's the living feel.
      if (m.bonded) {
        if (m.sitting) {
          targetSpeed = 0; // planted, until told otherwise
        } else {
          // GUARD: validate, then charge — headbutts land on the 1s attackCd
          if (m.guardTarget && (m.guardTarget.hp <= 0 ||
              !this.mobs.includes(m.guardTarget) ||
              Math.hypot(m.guardTarget.x - m.x, m.guardTarget.z - m.z) > FEUD_RANGE)) {
            m.guardTarget = null;
          }
          if (m.guardTarget) {
            const g = m.guardTarget;
            m.yaw = Math.atan2(g.x - m.x, g.z - m.z);
            targetSpeed = GUARD_SPEED;
            if (Math.hypot(g.x - m.x, g.z - m.z) < 1.1 + g.spec.halfW &&
                Math.abs(g.y - m.y) < 2 && m.attackCd <= 0) {
              m.attackCd = 1;
              this.strike(g, 1, { x: m.x, z: m.z }, { attacker: m });
            }
          } else if (distToPlayer > FOLLOW_MAX) {
            // FOLLOW: trot back into the 3-10 band; a bondling stuck against
            // something for 5s gives up on pathing and folds space instead
            m.yaw = Math.atan2(player.pos.x - m.x, player.pos.z - m.z);
            targetSpeed = FOLLOW_SPEED;
            m.strandT = Math.hypot(m.vx, m.vz) > 0.6 ? 0 : m.strandT + dt;
            if (m.strandT >= STRAND_SECONDS) this._teleportToPlayer(world, m, player);
          } else {
            m.strandT = 0;
          }
        }
      }

      // --- the steadfolk: leashed wander by day, indoors at dusk/night ---
      // Overrides the ambient idle/walk while it's neither fleeing a kick nor
      // (impossibly) chasing. The one branch that reads the time of day.
      if (m.stead && !chasing && m.state !== "flee") {
        targetSpeed = this._steadBehavior(m, dt, tod);
      }

      // neutral contact damage (leaning on a Prickleback is a mistake)
      if (canFight && spec.contactDamage && m.contactCd <= 0) {
        const pad = 0.15;
        if (Math.abs(player.pos.x - m.x) < spec.halfW + 0.3 + pad &&
            Math.abs(player.pos.z - m.z) < spec.halfW + 0.3 + pad &&
            player.pos.y < m.y + spec.height && player.pos.y + 1.8 > m.y) {
          m.contactCd = 0.6;
          player.damage(spec.contactDamage, `a ${spec.name}'s spines`);
          this._setGuard(m); // spines count as damaging the player too
        }
      }

      // --- movement --- (speedMul: the Prowl's +20%; 1 for everything else)
      if (m.dimT > 0) targetSpeed *= 0.5; // a Dusk-marked stride drags
      const tx = Math.sin(m.yaw) * targetSpeed * m.speedMul;
      const tz = Math.cos(m.yaw) * targetSpeed * m.speedMul;
      m.vx += (tx - m.vx) * Math.min(1, 10 * dt);
      m.vz += (tz - m.vz) * Math.min(1, 10 * dt);

      // creatures get the same fluid contract as the player: buoyancy in
      // any fluid, and the Emberwash BURNS — kiting a hostile into a pool
      // is supposed to work
      const cellId = world.getBlock(Math.floor(m.x), Math.floor(m.y + 0.3), Math.floor(m.z));
      const inWater = isFluid(cellId);
      if (inWater) m.vy = Math.min(2.5, m.vy + 10 * dt);
      else m.vy = Math.max(-30, m.vy - GRAVITY * dt);
      if (cellId === LAVA) {
        m.lavaCd = (m.lavaCd || 0) - dt;
        if (m.lavaCd <= 0) {
          m.lavaCd = 0.5;
          m.hp -= 3; // the top-of-loop death check pays out drops next frame
          m.hurtT = 0.25;
          if (distToPlayer < 24 && this.onMobHurt) this.onMobHurt(false);
        }
      }

      this._move(world, m, dt);

      if (m.hitWall && (m.onGround || inWater) && targetSpeed > 0) {
        if (Math.random() < 0.8) m.vy = inWater ? 6 : HOP_SPEED;
        else if (!chasing) { m.yaw += Math.PI * (0.5 + Math.random()); m.stateT = Math.min(m.stateT, 0.6); }
      }

      // ambient call
      m.callT -= dt;
      if (m.callT <= 0) {
        m.callT = 6 + Math.random() * 10;
        if (distToPlayer < 24 && this.onSound) this.onSound(spec.sound);
      }

      // --- presentation ---
      m.walkPhase += Math.hypot(m.vx, m.vz) * dt * 5;
      // a sitting bondling plants down: legs folded forward, belly lowered
      const sit = m.bonded && m.sitting;
      const swing = sit ? 0 : Math.sin(m.walkPhase) * 0.65;
      for (let li = 0; li < m.legs.length; li++) {
        m.legs[li].rotation.x = sit ? 1.35 : (li % 2 === 0 ? swing : -swing);
      }
      m.group.position.set(m.x, m.y - (sit ? 0.12 : 0), m.z);
      m.group.rotation.y = m.yaw;
      // hurt flinch is a subtle swell; a falling crit lands with a real pop
      // that collapses over ~0.2s
      const lovePulse = m.loveT > 0 ? 0.04 + Math.sin(m.loveT * 7) * 0.04 : 0;
      m.group.scale.setScalar(m.sizeMul * (1 + (m.hurtT > 0 ? 0.06 : 0) + m.critT * 1.1 + lovePulse));
    }
  }

  // a tamed Tuftling's turn: harry the player's marked target if one is
  // close and alive, else keep to heel (or stay put). Beyond 24 blocks it
  // simply pops to the player's side — hand-feet don't pathfind.
  _petBehavior(m, player) {
    const t = this._petTarget;
    if (t && t.hp > 0 && this.mobs.includes(t)) {
      const d = Math.hypot(t.x - m.x, t.z - m.z);
      if (d > 24) {
        this._petTarget = null;
      } else {
        m.yaw = Math.atan2(t.x - m.x, t.z - m.z);
        if (d < m.spec.attackRange && m.attackCd <= 0 && Math.abs(t.y - m.y) < 2) {
          m.attackCd = 0.9;
          // strike() fires onMobHurt itself — no extra call here
          this.strike(t, m.spec.damage, { x: m.x, z: m.z }, { byPet: true });
        }
        return m.spec.speed;
      }
    } else if (t) {
      this._petTarget = null;
    }
    if (m.mode === "stay") return 0;
    const d = Math.hypot(player.pos.x - m.x, player.pos.z - m.z);
    if (d > 24) {
      m.x = player.pos.x + (Math.random() - 0.5) * 1.6;
      m.z = player.pos.z + (Math.random() - 0.5) * 1.6;
      m.y = player.pos.y + 0.5;
      m.vx = m.vy = m.vz = 0;
      return 0;
    }
    if (d > 3) {
      m.yaw = Math.atan2(player.pos.x - m.x, player.pos.z - m.z);
      return d > 8 ? m.spec.speed : m.spec.speed * 0.7;
    }
    return 0;
  }

  // a steadfolk's turn: stroll between the buildings and the well by day,
  // funnel indoors to the hearth torch at dusk and settle there through the
  // night, and always keep within a leash of the well. Sets m.yaw; returns
  // the desired speed. The time of day is the phase switch.
  _steadBehavior(m, dt, tod) {
    const spec = m.spec;
    const S = m.stead;
    const home = m.buildings[m.homeIdx] || m.buildings[0];
    m.knockCd = Math.max(0, m.knockCd - dt);
    const distWell = Math.hypot(m.x - S.wx, m.z - S.wz);
    // leash: strayed past the tether, everything else waits — head for home
    if (distWell > S.leash) {
      m.yaw = Math.atan2(S.wx - m.x, S.wz - m.z);
      return spec.speed * 0.8;
    }
    const t = ((tod % 1) + 1) % 1;
    const phase = (t >= 0.44 && t < 0.52) ? "dusk"
      : (t >= 0.52 || t < 0.03) ? "night" : "day";

    // door-chime: a soft knock when it passes near its own doorway
    const dDoor = Math.hypot(m.x - (home.door.x + 0.5), m.z - (home.door.z + 0.5));
    if (dDoor < 1.1 && m.knockCd <= 0) {
      m.knockCd = 6;
      this.onSteadKnock?.(m);
    }

    if (phase === "day") {
      // stroll between stops, pausing at each — the living feel
      m.steadWait -= dt;
      const wp = m.wp;
      const atWp = wp && Math.hypot(m.x - wp.x, m.z - wp.z) < 1.2;
      if (!wp || (atWp && m.steadWait <= 0)) {
        m.wp = this._steadWaypoint(m);
        m.steadWait = 1.5 + Math.random() * 3;
      }
      if (atWp) return 0; // a pause at the stop
      m.yaw = Math.atan2(m.wp.x - m.x, m.wp.z - m.z);
      return spec.speed * 0.55;
    }

    // dusk / night: funnel through the door to the hearth torch and settle.
    // Once inside the walls, home in on the torch and stop. Outside, ALIGN to
    // the door's axis first, then walk straight through the one-wide opening —
    // approaching head-on (never at a diagonal) keeps a resident from hopping
    // up onto its own wall instead of stepping through the door.
    const torch = home.torch;
    const inside = m.x > home.x0 && m.x < home.x1 && m.z > home.z0 && m.z < home.z1;
    if (inside) {
      const dT = Math.hypot(m.x - (torch.x + 0.5), m.z - (torch.z + 0.5));
      if (dT < 1.2) { m.wp = null; return 0; } // settled by the hearth
      m.yaw = Math.atan2(torch.x + 0.5 - m.x, torch.z + 0.5 - m.z);
      return spec.speed * 0.5;
    }
    // ALIGN tightly to the door column before advancing: the resident's AABB
    // (halfW 0.32) only clears a one-wide door within ~0.18 of the cell
    // centre, so a looser tolerance clips the wall beside the door and stalls
    const { nx, nz } = home.door;
    const dcx = home.door.x + 0.5, dcz = home.door.z + 0.5;
    const tcx = torch.x + 0.5, tcz = torch.z + 0.5; // the hearth, deep inside
    if (nz !== 0) {
      // z-facing door: slide onto x = door column, then walk in toward the
      // hearth (aiming the interior torch, not the door cell, so a resident
      // sitting on the threshold still steps THROUGH rather than back out)
      if (Math.abs(m.x - dcx) > 0.15) { m.yaw = Math.atan2(dcx - m.x, 0); return spec.speed * 0.6; }
      m.yaw = Math.atan2(0, tcz - m.z);
    } else {
      if (Math.abs(m.z - dcz) > 0.15) { m.yaw = Math.atan2(0, tcz - m.z); return spec.speed * 0.6; }
      m.yaw = Math.atan2(tcx - m.x, 0);
    }
    return spec.speed * 0.6;
  }

  // a day-wander stop: pottering about the courtyard just OUTSIDE the home's
  // door (the central well's curb blocks a straight path between buildings, so
  // each resident mills near its own cottage — collectively the stead lives).
  // Points stay on the courtyard side of the door and inside the leash.
  _steadWaypoint(m) {
    const home = m.buildings[m.homeIdx] || m.buildings[0];
    const { nx, nz } = home.door;
    const fx = home.door.x + nx + 0.5, fz = home.door.z + nz + 0.5;
    const side = 0.8 + Math.random() * 2.6;  // how far into the courtyard
    const lat = (Math.random() - 0.5) * 4;   // spread along the wall
    return {
      x: fx + nx * side + (nx === 0 ? lat : 0),
      z: fz + nz * side + (nz === 0 ? lat : 0),
    };
  }

  // remove a specific mob (the stead manager folds a resident back into its
  // saved record this way)
  removeMob(m) {
    const i = this.mobs.indexOf(m);
    if (i >= 0) this._remove(i);
  }

  // sampled visibility check between the mob's chest and the player's torso
  _lineOfSight(world, m, player) {
    const x0 = m.x, y0 = m.y + m.spec.height * 0.6, z0 = m.z;
    const x1 = player.pos.x, y1 = player.pos.y + 0.9, z1 = player.pos.z;
    const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 0.3));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      if (isSolid(world.getBlock(
        Math.floor(x0 + (x1 - x0) * t),
        Math.floor(y0 + (y1 - y0) * t),
        Math.floor(z0 + (z1 - z0) * t)))) return false;
    }
    return true;
  }

  // substepped per-axis AABB collision, sized per species
  _move(world, m, dt) {
    const maxDisp = Math.max(Math.abs(m.vx), Math.abs(m.vy), Math.abs(m.vz)) * dt;
    const steps = Math.max(1, Math.ceil(maxDisp / MAX_STEP));
    const sdt = dt / steps;
    m.onGround = false;
    m.hitWall = false;
    for (let s = 0; s < steps; s++) {
      this._axis(world, m, "x", m.vx * sdt);
      this._axis(world, m, "z", m.vz * sdt);
      this._axis(world, m, "y", m.vy * sdt);
    }
  }

  _axis(world, m, axis, disp) {
    if (disp === 0) return;
    m[axis] += disp;
    const eps = 0.001;
    const hw = m.spec.halfW * m.sizeMul, hh = m.spec.height * m.sizeMul;
    const x0 = Math.floor(m.x - hw), x1 = Math.floor(m.x + hw - eps);
    // one row below the feet too: tall blocks (fence/gate, colHeight 1.5)
    // reach into the cell above, so a hopping mob at +1.3 still hits them
    const y0 = Math.floor(m.y) - 1, y1 = Math.floor(m.y + hh - eps);
    const z0 = Math.floor(m.z - hw), z1 = Math.floor(m.z + hw - eps);
    // downward Y sweeps clamp to the HIGHEST overlapped block top (a fast
    // fall can cross a Snowdrift's 0.12 shell and its support in one substep;
    // the bottom-up scan would otherwise embed the mob in the drift)
    let landTop = -Infinity;
    for (let by = y0; by <= y1; by++) for (let bz = z0; bz <= z1; bz++) for (let bx = x0; bx <= x1; bx++) {
      const bDef = BLOCKS[world.getBlock(bx, by, bz)];
      if (!bDef.solid) continue;
      // partial-height blocks (slabs): no overlap when feet are above the top
      const top = by + bDef.colHeight;
      if (m.y >= top - eps) continue;
      if (axis === "x") {
        m.x = disp > 0 ? bx - hw - eps : bx + 1 + hw + eps;
        m.vx = 0; m.hitWall = true;
      } else if (axis === "z") {
        m.z = disp > 0 ? bz - hw - eps : bz + 1 + hw + eps;
        m.vz = 0; m.hitWall = true;
      } else {
        if (disp > 0) { m.y = by - hh - eps; m.vy = 0; }
        else { landTop = Math.max(landTop, top); continue; }
      }
      return;
    }
    if (landTop > -Infinity) {
      m.y = landTop + eps;
      m.onGround = true;
      m.vy = 0;
    }
  }

  rayHit(origin, dir, maxDist) {
    let best = null, bestT = maxDist;
    for (const m of this.mobs) {
      const hw = m.spec.halfW * m.sizeMul, hh = m.spec.height * m.sizeMul;
      const min = [m.x - hw, m.y, m.z - hw];
      const max = [m.x + hw, m.y + hh, m.z + hw];
      const o = [origin.x, origin.y, origin.z];
      const d = [dir.x, dir.y, dir.z];
      let t0 = 0, t1 = bestT, ok = true;
      for (let a = 0; a < 3 && ok; a++) {
        if (Math.abs(d[a]) < 1e-9) {
          if (o[a] < min[a] || o[a] > max[a]) ok = false;
        } else {
          let near = (min[a] - o[a]) / d[a];
          let far = (max[a] - o[a]) / d[a];
          if (near > far) { const t = near; near = far; far = t; }
          t0 = Math.max(t0, near);
          t1 = Math.min(t1, far);
          if (t0 > t1) ok = false;
        }
      }
      if (ok && t0 < bestT) { best = m; bestT = t0; }
    }
    return best;
  }

  // dmg defaults to the bare-foot kick (1); a held Shiv passes its tier's
  // damage through from interact.js. opts: { crit, knock } — a falling crit
  // pops the mob and sharpens the hurt sound; knock scales the shove
  // (sprint hits pass ~1.8).
  punch(origin, dir, maxDist, fromPos, dmg = 1, opts) {
    const m = this.rayHit(origin, dir, maxDist);
    if (!m) return false;
    this.strike(m, dmg, fromPos, opts);
    return true;
  }

  // land a hit on a mob: damage, knockback away from fromPos, and the full
  // reaction suite. Shared by punches and thrown sling-stones.
  strike(m, dmg, fromPos, opts = {}) {
    // any hit the PLAYER lands marks the target for a following Tuftling.
    // Mob-landed strikes (byPet, or a bondling/hostile feud's attacker)
    // never mark — a hostile striking back at a bondling must not point
    // the Tuftling at the player's own companion.
    if (!opts.byPet && !opts.attacker && !m.tamed && !m.bonded && !m.spec.trades) {
      this._petTarget = m;
    }
    if (opts.dim) m.dimT = 4; // the Dusk Thread hangs the dark on THEM
    m.hp -= dmg;
    m.hurtT = 0.3;
    if (opts.crit) m.critT = 0.22; // the burst cue: a quick scale-pop
    const resist = 1 - (m.spec.knockResist || 0);
    const knock = 6 * (opts.knock || 1);
    const dx = m.x - fromPos.x, dz = m.z - fromPos.z;
    const len = Math.max(0.2, Math.hypot(dx, dz));
    m.vx += (dx / len) * knock * resist;
    m.vz += (dz / len) * knock * resist;
    m.vy = 5 * resist;
    // reactions: passives flee, neutrals get angry, ambushers wake up,
    // hostiles hold a grudge (a stone from beyond aggro range still counts).
    // A bondling doesn't flee — it takes the hit and (unseated) hits back.
    if (m.spec.behavior === "passive" && !m.bonded) { m.state = "flee"; m.stateT = 3.5; m.yaw = Math.atan2(m.x - fromPos.x, m.z - fromPos.z); }
    // the Peddler adds insult to the injury ledger: no trade for a while
    if (m.spec.grudge) m.grudgeT = m.spec.grudge;
    if (m.spec.behavior === "neutral" || m.spec.behavior === "hostile" || m.spec.behavior === "ambush") m.angryT = 8;
    if (m.spec.behavior === "ambush") m.state = "hunt";
    if (opts.attacker) {
      // hit by a bondling: the victim switches its aggro onto it
      if (m.spec.behavior !== "passive") m.targetMob = opts.attacker;
      // a hit bondling answers whoever landed it (never sitting, never a
      // fellow bondling, never the Peddler)
      if (m.bonded && !m.sitting && !opts.attacker.bonded && !opts.attacker.spec.trades) {
        m.guardTarget = opts.attacker;
      }
    } else if (!m.bonded && !m.spec.trades) {
      // a player-landed hit (punch or sling stone): the bondlings pile in
      this._setGuard(m);
    }
    this.onMobHurt?.(!!opts.crit);
  }

  // a Festival Rocket's burst overhead: nearby PASSIVE mobs bolt for a moment,
  // fleeing the noise (hostiles are unmoved — a bang doesn't scare the dark).
  // Bonded/tamed companions keep their heads; nothing takes damage. Returns
  // the count spooked (a test hook).
  spook(x, y, z, radius = 8) {
    const r2 = radius * radius;
    let n = 0;
    for (const m of this.mobs) {
      if (m.spec.behavior !== "passive" || m.bonded || m.tamed || m.spec.trades) continue;
      const dx = m.x - x, dy = m.y - y, dz = m.z - z;
      if (dx * dx + dy * dy + dz * dz > r2) continue;
      m.state = "flee";
      m.stateT = 2.2;
      m.yaw = Math.atan2(m.x - x, m.z - z); // face away from the bang
      n++;
    }
    return n;
  }

  _remove(i) {
    this.scene.remove(this.mobs[i].group);
    this.mobs.splice(i, 1);
  }
}
