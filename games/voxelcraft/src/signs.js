// The Notice Posts' writing: chunk meshes can't carry per-sign textures, so
// each written sign gets a standalone text-board mesh — a small plane hugging
// the board's front face, textured with a per-sign 64x48 canvas. The glyphs
// are the browser's own monospace, but the RENDERING is ours: hand-set
// per-character with a seeded jitter and uneven walnut ink, the way a
// Wanderling letters a field notice. Managed like a mini entity layer:
// synced every frame against world.signs, so boards appear when their chunk
// loads, follow edits, and vanish with the sign (or with a rude explosion —
// a stale entry whose block is gone self-heals here). Day/night-tinted like
// mob skins. The text itself persists in world.signs (see world.js/save.js).

import * as THREE from "three";
import { BLOCKS } from "./blocks.js";
import { mulberry32 } from "./noise.js";
import { SIGN_LINES, SIGN_COLS } from "./world.js";

const TEX_W = 64, TEX_H = 48;
const CELL_W = TEX_W / SIGN_COLS;   // 4px per character column
const CELL_H = TEX_H / SIGN_LINES;  // 12px per line
// board front faces per facing (mesher signBoxes): a hair proud of the wood
// so the writing never z-fights its own board
const LIFT = 0.006;
const MOUNTS = [
  { dx: 0.5, dz: 0.45 - LIFT, rot: Math.PI },      // 0 north (-z)
  { dx: 0.55 + LIFT, dz: 0.5, rot: Math.PI / 2 },  // 1 east (+x)
  { dx: 0.5, dz: 0.55 + LIFT, rot: 0 },            // 2 south (+z)
  { dx: 0.45 - LIFT, dz: 0.5, rot: -Math.PI / 2 }, // 3 west (-x)
];
const BOARD_Y = 0.725; // board box center: y 0.5..0.95

// cheap string hash — seeds the jitter so a board repaints identically
function textSeed(text) {
  let h = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    h = (h ^ text.charCodeAt(i)) * 0x01000193 >>> 0;
  }
  return h;
}

function paintText(text) {
  const canvas = document.createElement("canvas");
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, TEX_W, TEX_H);
  ctx.font = "6px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const rand = mulberry32(textSeed(text));
  const lines = text.split("\n").slice(0, SIGN_LINES);
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    // center the line in its 16 columns, then set each glyph by hand
    const start = (SIGN_COLS - line.length) / 2;
    for (let ci = 0; ci < line.length; ci++) {
      const ch = line[ci];
      if (ch === " ") { rand(); rand(); continue; } // spend the jitter anyway
      const jx = (rand() - 0.5) * 0.8;
      const jy = (rand() - 0.5) * 1.2;
      const shade = 30 + rand() * 22; // uneven dips of walnut ink
      ctx.fillStyle = `rgb(${shade | 0},${(shade * 0.78) | 0},${(shade * 0.55) | 0})`;
      ctx.fillText(ch,
        (start + ci + 0.5) * CELL_W + jx,
        (li + 0.5) * CELL_H + jy);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class SignBoards {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.boards = new Map(); // "x,y,z" -> {mesh, mat, tex, text, facing}
    // one shared plane, sized to sit inside the board's mustard frame
    // (board is 0.875 x 0.45)
    this._geo = new THREE.PlaneGeometry(0.8, 0.4);
    this._light = { level: 1, tint: new THREE.Color(1, 1, 1) };
  }

  setLight(level, tint) {
    this._light.level = level;
    this._light.tint.copy(tint);
    for (const rec of this.boards.values()) this._tint(rec.mat);
  }

  _tint(mat) {
    mat.color.copy(this._light.tint)
      .multiplyScalar(Math.min(1, this._light.level + 0.15));
  }

  // reconcile boards against world.signs — called every frame (signs are few
  // and the no-op path is a handful of map lookups per entry)
  sync() {
    for (const [key, text] of this.world.signs) {
      const [x, y, z] = key.split(",").map(Number);
      // an unloaded chunk keeps its entry but sleeps its board
      if (!this.world.isGenerated(x >> 4, z >> 4)) { this._drop(key); continue; }
      const def = BLOCKS[this.world.getBlock(x, y, z)];
      if (!def || def.shape !== "sign") {
        // the sign block is gone (explosion, odd edit) — the writing goes too
        this.world.signs.delete(key);
        this._drop(key);
        continue;
      }
      const rec = this.boards.get(key);
      if (rec && rec.text === text && rec.facing === def.facing) continue;
      this._drop(key);
      this._build(key, x, y, z, def.facing, text);
    }
    // boards whose entry vanished (broken sign, wiped text)
    for (const key of this.boards.keys()) {
      if (!this.world.signs.has(key)) this._drop(key);
    }
  }

  _build(key, x, y, z, facing, text) {
    const tex = paintText(text);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, alphaTest: 0.05,
    });
    this._tint(mat);
    const mesh = new THREE.Mesh(this._geo, mat);
    const m = MOUNTS[facing];
    mesh.position.set(x + m.dx, y + BOARD_Y, z + m.dz);
    mesh.rotation.y = m.rot;
    this.scene.add(mesh);
    this.boards.set(key, { mesh, mat, tex, text, facing });
  }

  _drop(key) {
    const rec = this.boards.get(key);
    if (!rec) return;
    this.scene.remove(rec.mesh);
    rec.tex.dispose();
    rec.mat.dispose(); // the plane geometry is shared and kept
    this.boards.delete(key);
  }
}
