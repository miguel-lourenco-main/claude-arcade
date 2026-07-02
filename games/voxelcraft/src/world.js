// Chunked voxel world: storage, block get/set, edit overlay for persistence.

import { AIR, BLOCKS } from "./blocks.js";
import { validDur } from "./inventory.js";

// container slot -> save entry: tools with wear keep a third element
// [id, count, dur] (additive — older loaders ignore it)
const saveSlot = (s) => (s ? (s.dur !== undefined ? [s.id, s.count, s.dur] : [s.id, s.count]) : 0);
// save entry -> container slot, validating the optional dur
function loadSlot(e) {
  if (!Array.isArray(e)) return null;
  const [id, n, dur] = e;
  if (!Number.isInteger(id) || !BLOCKS[id] || !Number.isInteger(n) || n <= 0) return null;
  const slot = { id, count: Math.min(64, n) };
  const d = validDur(id, dur);
  if (d !== undefined) slot.dur = d;
  return slot;
}

export const CHUNK = 16;
export const HEIGHT = 96;
export const SEA_LEVEL = 30;

// Map key for a chunk. cx/cz stay well within ±16384 in practice.
export function chunkKey(cx, cz) { return (cx + 16384) * 32768 + (cz + 16384); }

export function blockIndex(lx, y, lz) { return lx + CHUNK * (lz + CHUNK * y); }

// a Notice Post board holds 4 lines of 16 characters — the one clamp shared
// by the write window (hud.js) and the save loader, so no oversized text ever
// reaches world.signs
export const SIGN_LINES = 4;
export const SIGN_COLS = 16;
export function clampSignText(text) {
  return String(text)
    .split("\n").slice(0, SIGN_LINES)
    .map((line) => line.slice(0, SIGN_COLS))
    .join("\n")
    .replace(/\s+$/, ""); // an all-blank board is no notice at all
}

export class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.data = new Uint8Array(CHUNK * CHUNK * HEIGHT);
    this.generated = false;
    this.dirty = false;       // needs (re)meshing
    this.meshes = null;       // {opaque, cutout, water} THREE.Mesh or null
    this.emitters = new Map(); // blockIndex -> lightEmit level (torches etc.)
  }
  get(lx, y, lz) {
    if (y < 0 || y >= HEIGHT) return AIR;
    return this.data[blockIndex(lx, y, lz)];
  }
  set(lx, y, lz, id) {
    if (y < 0 || y >= HEIGHT) return;
    this.data[blockIndex(lx, y, lz)] = id;
  }
}

export class World {
  constructor(seed) {
    this.seed = seed;
    this.chunks = new Map();          // chunkKey -> Chunk
    this.edits = new Map();           // chunkKey -> Map(blockIndex -> id)
    this.chests = new Map();          // "x,y,z" -> Array(>=27) of null|{id,count}
    this.kilns = new Map();           // "x,y,z" -> {slots:[in,fuel,out], burnLeft, progress}
    this.signs = new Map();           // "x,y,z" -> Notice Post text (see signs.js)
    this.generator = null;            // set by terrain.js
    this._lastChunk = null;           // 1-entry lookup cache (meshing/physics locality)
  }

  // v2: chest values are slot arrays (null | {id,count}, stacks capped at 64,
  // length >= 27; migrated oversize chests keep extra slots so nothing is
  // destroyed, and trailing empties beyond 27 are trimmed on save)
  serializeChests() {
    return [...this.chests].map(([key, slots]) => {
      const out = slots.map(saveSlot);
      while (out.length > 27 && out[out.length - 1] === 0) out.pop();
      return [key, { slots: out }];
    });
  }

  loadChests(arr) {
    if (!Array.isArray(arr)) return;
    for (const pair of arr) {
      if (!Array.isArray(pair) || typeof pair[0] !== "string") continue;
      const payload = pair[1];
      let slots = null;
      if (payload && Array.isArray(payload.slots)) {
        // v2 shape (with the additive per-slot dur for stored tools)
        slots = payload.slots.map(loadSlot);
      } else if (Array.isArray(payload)) {
        // v1 shape: [id, count] pairs with unbounded counts — pack losslessly
        slots = [];
        for (const entry of payload) {
          if (!Array.isArray(entry)) continue;
          const [id, n] = entry;
          if (!Number.isInteger(id) || !BLOCKS[id] || !Number.isInteger(n) || n <= 0) continue;
          let left = n;
          while (left > 0) {
            const take = Math.min(64, left);
            slots.push({ id, count: take });
            left -= take;
          }
        }
      }
      if (!slots) continue;
      while (slots.length < 27) slots.push(null);
      if (slots.some((s) => s)) this.chests.set(pair[0], slots);
    }
  }

  // kilns (additive save field): {slots: [in, fuel, out] as [id,count]|0,
  // burn: seconds of heat left, prog: smelt progress seconds}
  serializeKilns() {
    return [...this.kilns].map(([key, k]) => [key, {
      slots: k.slots.map(saveSlot),
      burn: Math.max(0, k.burnLeft),
      prog: Math.max(0, k.progress),
    }]);
  }

  loadKilns(arr) {
    if (!Array.isArray(arr)) return;
    for (const pair of arr) {
      if (!Array.isArray(pair) || typeof pair[0] !== "string") continue;
      const payload = pair[1];
      if (!payload || !Array.isArray(payload.slots)) continue;
      const slots = payload.slots.slice(0, 3).map(loadSlot);
      while (slots.length < 3) slots.push(null);
      const burnLeft = Number.isFinite(payload.burn) ? Math.max(0, payload.burn) : 0;
      const progress = Number.isFinite(payload.prog) ? Math.max(0, payload.prog) : 0;
      // an empty, cold kiln carries no state worth keeping
      if (!slots.some((s) => s) && burnLeft <= 0) continue;
      this.kilns.set(pair[0], { slots, burnLeft, progress });
    }
  }

  // signs (additive save field): [["x,y,z", text]...] — the sign BLOCKS live
  // in the edit overlay; this is only the writing on their boards
  serializeSigns() {
    return [...this.signs];
  }

  loadSigns(arr) {
    if (!Array.isArray(arr)) return;
    for (const pair of arr) {
      if (!Array.isArray(pair) || typeof pair[0] !== "string" ||
          typeof pair[1] !== "string") continue;
      if (!/^-?\d+,-?\d+,-?\d+$/.test(pair[0])) continue;
      const text = clampSignText(pair[1]);
      if (text) this.signs.set(pair[0], text);
    }
  }

  getChunk(cx, cz) {
    const c = this._lastChunk;
    if (c && c.cx === cx && c.cz === cz) return c;
    const found = this.chunks.get(chunkKey(cx, cz)) || null;
    if (found) this._lastChunk = found;
    return found;
  }

  isGenerated(cx, cz) {
    const c = this.getChunk(cx, cz);
    return c !== null && c.generated;
  }

  getBlock(x, y, z) {
    if (y < 0 || y >= HEIGHT) return AIR;
    const cx = x >> 4, cz = z >> 4;
    const chunk = this.getChunk(cx, cz);
    if (!chunk || !chunk.generated) return AIR;
    return chunk.data[blockIndex(x - (cx << 4), y, z - (cz << 4))];
  }

  // Player edit: writes the block, records it in the persistent edit overlay,
  // and marks the chunk (and border neighbors) dirty. Returns affected chunks.
  setBlock(x, y, z, id) {
    if (y < 0 || y >= HEIGHT) return [];
    const cx = x >> 4, cz = z >> 4;
    const chunk = this.getChunk(cx, cz);
    if (!chunk || !chunk.generated) return [];
    const lx = x - (cx << 4), lz = z - (cz << 4);
    const idx = blockIndex(lx, y, lz);
    const prev = chunk.data[idx];
    chunk.set(lx, y, lz, id);

    // keep the chunk's light-emitter registry current
    if (BLOCKS[prev].lightEmit > 0) chunk.emitters.delete(idx);
    if (BLOCKS[id].lightEmit > 0) chunk.emitters.set(idx, BLOCKS[id].lightEmit);

    const key = chunkKey(cx, cz);
    let overlay = this.edits.get(key);
    if (!overlay) { overlay = new Map(); this.edits.set(key, overlay); }
    overlay.set(idx, id);

    const affected = [chunk];
    chunk.dirty = true;
    const markDirty = (ncx, ncz) => {
      const n = this.getChunk(ncx, ncz);
      if (n && n.generated) { n.dirty = true; affected.push(n); }
    };
    if (lx === 0) markDirty(cx - 1, cz);
    if (lx === CHUNK - 1) markDirty(cx + 1, cz);
    if (lz === 0) markDirty(cx, cz - 1);
    if (lz === CHUNK - 1) markDirty(cx, cz + 1);
    if (lx === 0 && lz === 0) markDirty(cx - 1, cz - 1);
    if (lx === 0 && lz === CHUNK - 1) markDirty(cx - 1, cz + 1);
    if (lx === CHUNK - 1 && lz === 0) markDirty(cx + 1, cz - 1);
    if (lx === CHUNK - 1 && lz === CHUNK - 1) markDirty(cx + 1, cz + 1);
    return affected;
  }

  // Create + generate a chunk (or return the existing one).
  ensureChunk(cx, cz) {
    const key = chunkKey(cx, cz);
    let chunk = this.chunks.get(key);
    if (chunk && chunk.generated) return chunk;
    if (!chunk) {
      chunk = new Chunk(cx, cz);
      this.chunks.set(key, chunk);
    }
    this.generator(this, chunk);
    // apply persisted player edits on top of the generated terrain
    chunk.emitters.clear();
    const overlay = this.edits.get(key);
    if (overlay) {
      for (const [idx, id] of overlay) {
        chunk.data[idx] = id;
        if (BLOCKS[id].lightEmit > 0) chunk.emitters.set(idx, BLOCKS[id].lightEmit);
      }
    }
    chunk.generated = true;
    chunk.dirty = true;
    // neighbors that were already meshed may show stale border faces
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (dx === 0 && dz === 0) continue;
      const n = this.getChunk(cx + dx, cz + dz);
      if (n && n.generated && n.meshes) n.dirty = true;
    }
    return chunk;
  }

  unloadChunk(cx, cz) {
    const key = chunkKey(cx, cz);
    const chunk = this.chunks.get(key);
    if (!chunk) return null;
    this.chunks.delete(key);
    if (this._lastChunk === chunk) this._lastChunk = null;
    return chunk; // caller disposes meshes
  }

  // Serialize player edits as a flat [x, y, z, id, ...] array.
  serializeEdits() {
    const out = [];
    for (const [key, overlay] of this.edits) {
      const cx = Math.floor(key / 32768) - 16384;
      const cz = (key % 32768) - 16384;
      for (const [idx, id] of overlay) {
        const lx = idx % CHUNK;
        const lz = Math.floor(idx / CHUNK) % CHUNK;
        const y = Math.floor(idx / (CHUNK * CHUNK));
        out.push((cx << 4) + lx, y, (cz << 4) + lz, id);
      }
    }
    return out;
  }

  loadEdits(flat) {
    if (!Array.isArray(flat)) return;
    for (let i = 0; i + 3 < flat.length; i += 4) {
      const x = flat[i], y = flat[i + 1], z = flat[i + 2], id = flat[i + 3];
      // a corrupted save must not crash boot or feed the mesher unknown ids
      if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) continue;
      if (y < 0 || y >= HEIGHT || !Number.isInteger(id) || !BLOCKS[id]) continue;
      const cx = x >> 4, cz = z >> 4;
      const key = chunkKey(cx, cz);
      let overlay = this.edits.get(key);
      if (!overlay) { overlay = new Map(); this.edits.set(key, overlay); }
      overlay.set(blockIndex(x - (cx << 4), y, z - (cz << 4)), id);
    }
  }
}
