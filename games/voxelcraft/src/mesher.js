// Chunk meshing: culled cube faces with baked vertex AO + directional shade,
// split into three buckets (opaque / cutout / water) that map to three materials.

import * as THREE from "three";
import { BLOCKS, AIR, LEAVES, LEAVES_COLD } from "./blocks.js";
import { CHUNK, HEIGHT } from "./world.js";
import { tileUV } from "./textures.js";
import { hash2 } from "./noise.js";

// Corner order per face: bl, br, tr, tl (uv 00,10,11,01), CCW from outside.
const FACES = [
  { dir: [1, 0, 0],  shade: 0.62, corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { dir: [-1, 0, 0], shade: 0.62, corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { dir: [0, 1, 0],  shade: 1.0,  corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { dir: [0, -1, 0], shade: 0.52, corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { dir: [0, 0, 1],  shade: 0.8,  corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { dir: [0, 0, -1], shade: 0.8,  corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];
const AO_MULT = [1.0, 0.78, 0.6, 0.46];
const WATER_SURFACE = 0.85;
const WATER_UV = { u0: 0, v0: 0, u1: 1, v1: 1 }; // own repeating texture
// cheap sky light: brightness falloff per block of depth below the topmost
// sky-blocking block of the column (caves and interiors get dark)
const LIGHT_FALLOFF = 0.14;
const LIGHT_FLOOR = 0.3;

export function buildMaterials(atlasTexture, waterTexture) {
  const opaque = new THREE.MeshLambertMaterial({ map: atlasTexture, vertexColors: true });
  const cutout = new THREE.MeshLambertMaterial({
    map: atlasTexture, vertexColors: true, alphaTest: 0.4, side: THREE.DoubleSide,
  });
  const water = new THREE.MeshLambertMaterial({
    map: waterTexture, vertexColors: true, transparent: true, opacity: 0.72,
    depthWrite: false, side: THREE.DoubleSide,
  });
  return { opaque, cutout, water };
}

class BucketBuffer {
  constructor() {
    this.positions = [];
    this.uvs = [];
    this.colors = [];
    this.indices = [];
    this.vertCount = 0;
  }
  // corners: 4x [x,y,z]; brightness: 4 scalars; flip: split quad along 1-3
  quad(corners, tile, brightness, flip = false, uvRect = null) {
    const { u0, u1, v0, v1 } = uvRect || tileUV(tile);
    const us = [u0, u1, u1, u0], vs = [v0, v0, v1, v1];
    for (let i = 0; i < 4; i++) {
      this.positions.push(corners[i][0], corners[i][1], corners[i][2]);
      this.uvs.push(us[i], vs[i]);
      const b = brightness[i];
      this.colors.push(b, b, b);
    }
    const n = this.vertCount;
    if (flip) this.indices.push(n, n + 1, n + 3, n + 1, n + 2, n + 3);
    else this.indices.push(n, n + 1, n + 2, n, n + 2, n + 3);
    this.vertCount += 4;
  }
  build() {
    if (this.vertCount === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
    g.setIndex(this.indices);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

function faceVisible(id, def, neighborId) {
  const n = BLOCKS[neighborId];
  // water only shows faces against air and plants — any cube (glass included)
  // would otherwise produce a coplanar duplicate quad
  if (def.bucket === "water") return neighborId === AIR || n.kind === "cross";
  if (def.cullSame) return neighborId !== id && !n.opaque;
  return !n.opaque;
}

// Rebuild a chunk's meshes in place. Adds to / removes from the scene.
export function meshChunk(world, chunk, materials, scene) {
  disposeChunkMeshes(chunk, scene);

  const buckets = { opaque: new BucketBuffer(), cutout: new BucketBuffer(), water: new BucketBuffer() };
  const x0 = chunk.cx * CHUNK, z0 = chunk.cz * CHUNK;
  const get = (wx, wy, wz) => world.getBlock(wx, wy, wz);

  // sky-light column map (chunk + 1-cell border): topmost sky-blocking block.
  // Leaves don't block sky so forests stay lit underneath.
  const top = new Int16Array((CHUNK + 2) * (CHUNK + 2)).fill(-1);
  for (let lz = -1; lz <= CHUNK; lz++) {
    for (let lx = -1; lx <= CHUNK; lx++) {
      for (let y = HEIGHT - 1; y >= 0; y--) {
        const id = get(x0 + lx, y, z0 + lz);
        if (BLOCKS[id].opaque && id !== LEAVES && id !== LEAVES_COLD) {
          top[(lx + 1) + (CHUNK + 2) * (lz + 1)] = y;
          break;
        }
      }
    }
  }
  // light of the cell a face is exposed to (depth below its column top)
  const lightAt = (lx, y, lz) => {
    const t = top[(lx + 1) + (CHUNK + 2) * (lz + 1)];
    const depth = t - y;
    return depth <= 0 ? 1 : Math.max(LIGHT_FLOOR, 1 - depth * LIGHT_FALLOFF);
  };

  for (let y = 0; y < HEIGHT; y++) {
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const id = chunk.data[lx + CHUNK * (lz + CHUNK * y)];
        if (id === AIR) continue;
        const def = BLOCKS[id];
        const wx = x0 + lx, wz = z0 + lz;

        if (def.kind === "cross") {
          addCross(buckets.cutout, def, lx, y, lz, wx, wz, lightAt(lx, y, lz));
          continue;
        }

        const isWater = def.bucket === "water";
        // only lower the surface when the water is actually open to the air —
        // under an opaque block the top face is culled, so lowering the sides
        // would open a visible gap
        const above = get(wx, y + 1, wz);
        const waterTop = isWater && above !== id && !BLOCKS[above].opaque;

        for (const face of FACES) {
          const [dx, dy, dz] = face.dir;
          const nb = get(wx + dx, y + dy, wz + dz);
          if (!faceVisible(id, def, nb)) continue;

          const tile = dy > 0 ? def.tiles.top : dy < 0 ? def.tiles.bottom : def.tiles.side;
          const light = lightAt(lx + dx, Math.max(0, y + dy), lz + dz);
          const corners = [];
          const brightness = [];
          let flip = false;

          if (def.bucket === "opaque") {
            const ao = [];
            for (let ci = 0; ci < 4; ci++) {
              const p = face.corners[ci];
              corners.push([lx + p[0], y + p[1], lz + p[2]]);
              ao.push(cornerAO(get, wx, y, wz, face.dir, p));
            }
            flip = ao[0] + ao[2] > ao[1] + ao[3];
            for (let ci = 0; ci < 4; ci++) brightness.push(face.shade * AO_MULT[ao[ci]] * light);
          } else {
            for (let ci = 0; ci < 4; ci++) {
              const p = face.corners[ci];
              let py = y + p[1];
              // lower exposed water surfaces below the block top
              if (isWater && waterTop && p[1] === 1) py = y + WATER_SURFACE;
              corners.push([lx + p[0], py, lz + p[2]]);
              brightness.push(face.shade * light);
            }
          }
          buckets[def.bucket].quad(corners, tile, brightness, flip, isWater ? WATER_UV : null);
        }
      }
    }
  }

  const meshes = {};
  for (const name of ["opaque", "cutout", "water"]) {
    const geo = buckets[name].build();
    if (!geo) { meshes[name] = null; continue; }
    const mesh = new THREE.Mesh(geo, materials[name]);
    mesh.position.set(x0, 0, z0);
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    if (name === "water") mesh.renderOrder = 1;
    scene.add(mesh);
    meshes[name] = mesh;
  }
  chunk.meshes = meshes;
  chunk.dirty = false;
}

function addCross(bucket, def, lx, y, lz, wx, wz, light = 1) {
  // deterministic little offset so plants don't sit on a perfect grid
  const ox = (hash2(wx, wz, 0x9e37) - 0.5) * 0.3;
  const oz = (hash2(wz, wx, 0x79b9) - 0.5) * 0.3;
  const l = 0.15 + ox, h = 0.85 + ox;
  const l2 = 0.15 + oz, h2 = 0.85 + oz;
  const s = 0.95 * light;
  const b = [s, s, s, s];
  bucket.quad(
    [[lx + l, y, lz + l2], [lx + h, y, lz + h2], [lx + h, y + 1, lz + h2], [lx + l, y + 1, lz + l2]],
    def.tiles.side, b);
  bucket.quad(
    [[lx + l, y, lz + h2], [lx + h, y, lz + l2], [lx + h, y + 1, lz + l2], [lx + l, y + 1, lz + h2]],
    def.tiles.side, b);
}

// Classic 3-sample corner AO. p is the corner's 0/1 offsets within the cell.
function cornerAO(get, x, y, z, dir, p) {
  const axis = dir[0] !== 0 ? 0 : dir[1] !== 0 ? 1 : 2;
  const base = [x + dir[0], y + dir[1], z + dir[2]];
  const t1 = axis === 0 ? 1 : 0;           // first tangent axis
  const t2 = axis === 2 ? 1 : 2;           // second tangent axis
  const o1 = p[t1] === 1 ? 1 : -1;
  const o2 = p[t2] === 1 ? 1 : -1;

  const s1c = [...base]; s1c[t1] += o1;
  const s2c = [...base]; s2c[t2] += o2;
  const cc = [...base]; cc[t1] += o1; cc[t2] += o2;

  const s1 = BLOCKS[get(s1c[0], s1c[1], s1c[2])].opaque ? 1 : 0;
  const s2 = BLOCKS[get(s2c[0], s2c[1], s2c[2])].opaque ? 1 : 0;
  if (s1 && s2) return 3;
  const c = BLOCKS[get(cc[0], cc[1], cc[2])].opaque ? 1 : 0;
  return s1 + s2 + c;
}

export function disposeChunkMeshes(chunk, scene) {
  if (!chunk.meshes) return;
  for (const mesh of Object.values(chunk.meshes)) {
    if (!mesh) continue;
    scene.remove(mesh);
    mesh.geometry.dispose();
  }
  chunk.meshes = null;
}
