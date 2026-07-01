// Chunked voxel world: storage, block get/set, edit overlay for persistence.

import { AIR, BLOCKS } from "./blocks.js";

export const CHUNK = 16;
export const HEIGHT = 96;
export const SEA_LEVEL = 30;

// Map key for a chunk. cx/cz stay well within ±16384 in practice.
export function chunkKey(cx, cz) { return (cx + 16384) * 32768 + (cz + 16384); }

export function blockIndex(lx, y, lz) { return lx + CHUNK * (lz + CHUNK * y); }

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
    this.chests = new Map();          // "x,y,z" -> Map(blockId -> count)
    this.generator = null;            // set by terrain.js
    this._lastChunk = null;           // 1-entry lookup cache (meshing/physics locality)
  }

  serializeChests() {
    return [...this.chests].map(([key, store]) => [key, [...store]]);
  }

  loadChests(arr) {
    if (!Array.isArray(arr)) return;
    for (const pair of arr) {
      if (!Array.isArray(pair) || typeof pair[0] !== "string" || !Array.isArray(pair[1])) continue;
      const store = new Map();
      for (const entry of pair[1]) {
        if (!Array.isArray(entry)) continue;
        const [id, n] = entry;
        if (!Number.isInteger(id) || !BLOCKS[id] || !Number.isInteger(n) || n <= 0) continue;
        store.set(id, Math.min(9999, n));
      }
      if (store.size > 0) this.chests.set(pair[0], store);
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
