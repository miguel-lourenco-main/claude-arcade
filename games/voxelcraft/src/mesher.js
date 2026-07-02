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

// --- voxel shader -----------------------------------------------------------
// Classic voxel two-channel lighting: the `color` attribute carries
// sky light (shade × AO × column depth) and is scaled by the day/night
// uniform; `blocklight` carries torch light, which ignores the sun.
// final = texture × max(sky × uDayLight × uSkyTint, blocklight × warmTint)

const VOXEL_VERT = /* glsl */ `
attribute float blocklight;
uniform vec2 uUvOffset;
uniform float uTime;
varying vec2 vUv;
varying vec3 vColor;
varying float vBlock;
#include <common>
#include <fog_pars_vertex>
void main() {
  vUv = uv + uUvOffset;
  vColor = color;
  vBlock = blocklight;
  vec4 mvPosition;
  #ifdef VOX_WAVE
  // gentle water swell, phased by world position — only the lowered surface
  // corners (fract y ≈ 0.85) move; integer-y edges stay pinned so no slits
  // open where water meets static geometry
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float waveMask = step(0.5, fract(position.y));
  wp.y += sin(uTime * 1.5 + wp.x * 0.9 + wp.z * 0.7) * 0.05 * waveMask;
  mvPosition = viewMatrix * wp;
  #else
  mvPosition = modelViewMatrix * vec4(position, 1.0);
  #endif
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const VOXEL_FRAG = /* glsl */ `
uniform sampler2D map;
uniform float uDayLight;
uniform vec3 uSkyTint;
uniform float uOpacity;
varying vec2 vUv;
varying vec3 vColor;
varying float vBlock;
#include <common>
#include <fog_pars_fragment>
void main() {
  vec4 tex = texture2D(map, vUv);
  #ifdef VOX_ALPHATEST
  if (tex.a < VOX_ALPHATEST) discard;
  #endif
  vec3 sky = vColor * uDayLight * uSkyTint;
  vec3 torch = vec3(vBlock) * vec3(1.0, 0.86, 0.62);
  gl_FragColor = vec4(tex.rgb * max(sky, torch), tex.a * uOpacity);
  // three.js order: colorspace BEFORE fog — the renderer supplies fogColor in
  // output sRGB space so fully-fogged pixels converge to the sky background
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

function voxelMaterial(map, opts = {}) {
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        map: { value: null },
        uUvOffset: { value: new THREE.Vector2(0, 0) },
        uTime: { value: 0 },
        uDayLight: { value: 1 },
        uSkyTint: { value: new THREE.Color(1, 1, 1) },
        uOpacity: { value: opts.opacity ?? 1 },
      },
    ]),
    vertexShader: VOXEL_VERT,
    fragmentShader: VOXEL_FRAG,
    fog: true,
    vertexColors: true,
    transparent: !!opts.transparent,
    depthWrite: opts.depthWrite ?? true,
    side: opts.side ?? THREE.FrontSide,
  });
  mat.defines = {};
  if (opts.alphaTest) mat.defines.VOX_ALPHATEST = opts.alphaTest.toFixed(2);
  if (opts.wave) mat.defines.VOX_WAVE = 1;
  mat.uniforms.map.value = map;
  return mat;
}

export function buildMaterials(atlasTexture, waterTexture) {
  // cutout so sprite items (torch, plants) keep their transparent pixels.
  // The hand renders in its own depth-cleared pass, so no depth hacks here.
  const held = voxelMaterial(atlasTexture, { alphaTest: 0.4, side: THREE.DoubleSide });
  return {
    opaque: voxelMaterial(atlasTexture),
    cutout: voxelMaterial(atlasTexture, { alphaTest: 0.4, side: THREE.DoubleSide }),
    water: voxelMaterial(waterTexture, {
      transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide,
      wave: true,
    }),
    held,
  };
}

export function setDayLight(materials, level, tint) {
  for (const mat of Object.values(materials)) {
    mat.uniforms.uDayLight.value = level;
    mat.uniforms.uSkyTint.value.copy(tint);
  }
}

class BucketBuffer {
  constructor() {
    this.positions = [];
    this.uvs = [];
    this.colors = [];
    this.blocklights = [];
    this.indices = [];
    this.vertCount = 0;
  }
  // corners: 4x [x,y,z]; brightness/blockLights: 4 scalars each;
  // flip: split quad along the 1-3 diagonal
  quad(corners, tile, brightness, blockLights, flip = false, uvRect = null) {
    const { u0, u1, v0, v1 } = uvRect || tileUV(tile);
    const us = [u0, u1, u1, u0], vs = [v0, v0, v1, v1];
    for (let i = 0; i < 4; i++) {
      this.positions.push(corners[i][0], corners[i][1], corners[i][2]);
      this.uvs.push(us[i], vs[i]);
      const b = brightness[i];
      this.colors.push(b, b, b);
      this.blocklights.push(blockLights[i]);
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
    g.setAttribute("blocklight", new THREE.Float32BufferAttribute(this.blocklights, 1));
    g.setIndex(this.indices);
    g.computeBoundingSphere();
    return g;
  }
}

// --- torch light (block light) ----------------------------------------------
// BFS flood fill over a padded volume around the chunk, seeded from every
// light emitter in the 3x3 chunk neighborhood (emitter range 14 < PAD+1).

const LIGHT_PAD = 15;
const LDIM = CHUNK + 2 * LIGHT_PAD; // 46
let lightScratch = null;            // Uint8Array(LDIM * LDIM * HEIGHT), reused

function computeBlockLight(world, chunk) {
  const emitters = [];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const c = world.getChunk(chunk.cx + dx, chunk.cz + dz);
      if (!c || !c.generated || c.emitters.size === 0) continue;
      for (const [idx, level] of c.emitters) {
        const lx = idx % CHUNK;
        const lz = ((idx / CHUNK) | 0) % CHUNK;
        const y = (idx / (CHUNK * CHUNK)) | 0;
        emitters.push([c.cx * CHUNK + lx, y, c.cz * CHUNK + lz, level]);
      }
    }
  }
  if (emitters.length === 0) return null;

  if (!lightScratch) lightScratch = new Uint8Array(LDIM * LDIM * HEIGHT);
  const light = lightScratch;
  light.fill(0);
  const ox = chunk.cx * CHUNK - LIGHT_PAD;
  const oz = chunk.cz * CHUNK - LIGHT_PAD;

  const queue = [];
  for (const [wx, wy, wz, level] of emitters) {
    const vx = wx - ox, vz = wz - oz;
    if (vx < 0 || vx >= LDIM || vz < 0 || vz >= LDIM || wy < 0 || wy >= HEIGHT) continue;
    const vi = vx + LDIM * (vz + LDIM * wy);
    if (light[vi] < level) { light[vi] = level; queue.push(vi); }
  }

  let head = 0;
  while (head < queue.length) {
    const vi = queue[head++];
    const level = light[vi] - 1;
    if (level <= 0) continue;
    const vy = (vi / (LDIM * LDIM)) | 0;
    const rem = vi - vy * LDIM * LDIM;
    const vz = (rem / LDIM) | 0;
    const vx = rem - vz * LDIM;
    spread(vx + 1, vy, vz); spread(vx - 1, vy, vz);
    spread(vx, vy + 1, vz); spread(vx, vy - 1, vz);
    spread(vx, vy, vz + 1); spread(vx, vy, vz - 1);

    function spread(nx, ny, nz) {
      if (nx < 0 || nx >= LDIM || nz < 0 || nz >= LDIM || ny < 0 || ny >= HEIGHT) return;
      const ni = nx + LDIM * (nz + LDIM * ny);
      if (light[ni] >= level) return;
      if (BLOCKS[world.getBlock(ox + nx, ny, oz + nz)].opaque) return;
      light[ni] = level;
      queue.push(ni);
    }
  }
  return light;
}

// test/debug helper: the torch-light level the mesher would bake at a cell —
// runs the same BFS a chunk mesh uses and samples one voxel. NOT for the hot
// path (it floods the whole padded volume); tests use it to assert that a
// placed emitter (a torch, a landed starstone) actually propagates.
export function sampleBlockLight(world, x, y, z) {
  if (y < 0 || y >= HEIGHT) return 0;
  const chunk = world.getChunk(x >> 4, z >> 4);
  if (!chunk || !chunk.generated) return 0;
  const light = computeBlockLight(world, chunk);
  if (!light) return 0;
  const vx = x - chunk.cx * CHUNK + LIGHT_PAD;
  const vz = z - chunk.cz * CHUNK + LIGHT_PAD;
  return light[vx + LDIM * (vz + LDIM * y)];
}

// --- shaped blocks (slabs, stairs, later fences) ------------------------------
// A shape is a list of axis-aligned boxes in unit-cell coordinates. Faces that
// lie exactly on the cell boundary cull against opaque full-cube neighbors;
// interior faces (a slab's top, a stair's riser) are never culled. Shaped
// blocks keep AO simple: flat face shade × the cell's column skylight.

// stairs: a bottom slab plus a full-height back box on the `facing` side.
// The back box rests on the slab, so its bottom face is never visible.
const STAIR_BACK = [
  { x0: 0, z0: 0, x1: 1, z1: 0.5 },   // 0 north (-z)
  { x0: 0.5, z0: 0, x1: 1, z1: 1 },   // 1 east (+x)
  { x0: 0, z0: 0.5, x1: 1, z1: 1 },   // 2 south (+z)
  { x0: 0, z0: 0, x1: 0.5, z1: 1 },   // 3 west (-x)
];

const SLAB_BOX = { x0: 0, y0: 0, z0: 0, x1: 1, y1: 0.5, z1: 1 };

// --- fences + gates -----------------------------------------------------------
// Wattle-work is neighbor-aware: a center post grows connecting arms toward
// each horizontal neighbor that is a fence, a gate, or a solid full cube.
// Connections are recomputed on every remesh — setBlock already dirties the
// chunk (and border neighbors), so arms follow the world as it changes.

const FENCE_POST = { x0: 0.375, y0: 0, z0: 0.375, x1: 0.625, y1: 1, z1: 0.625 };
const RAILS = [[0.375, 0.5625], [0.75, 0.9375]]; // two courses of woven withies
const ARM = 0.4375; // rail cross-section: ARM..1-ARM

// does a fence/gate arm reach toward this neighbor?
function fenceConnects(id) {
  const n = BLOCKS[id];
  return n.shape === "fence" || n.shape === "gate" ||
    (n.solid && n.kind === "cube" && !n.shape && n.colHeight >= 1);
}

// c: [north(-z), east(+x), south(+z), west(-x)] connection flags.
// Boxes are ordered back-to-front (N/W arms, post, S/E arms) so the HUD's
// painter's-order iso projector layers them correctly.
function fenceBoxes(c) {
  const boxes = [];
  for (const [y0, y1] of RAILS) {
    if (c[0]) boxes.push({ x0: ARM, x1: 1 - ARM, y0, y1, z0: 0, z1: 0.375 });
    if (c[3]) boxes.push({ x0: 0, x1: 0.375, y0, y1, z0: ARM, z1: 1 - ARM });
  }
  boxes.push(FENCE_POST);
  for (const [y0, y1] of RAILS) {
    if (c[2]) boxes.push({ x0: ARM, x1: 1 - ARM, y0, y1, z0: 0.625, z1: 1 });
    if (c[1]) boxes.push({ x0: 0.625, x1: 1, y0, y1, z0: ARM, z1: 1 - ARM });
  }
  return boxes;
}

// The gate spans the axis its neighbors suggest: hinge posts at the two cell
// edges, a woven leaf between them. Open, the leaf splits and both halves
// fold aside (toward +z / +x), leaving the middle clear to walk through.
function gateBoxes(open, c) {
  const spanX = (c[1] || c[3]) || !(c[0] || c[2]); // default: spans x
  const post = (x0, x1) => ({ x0, x1, y0: 0.25, y1: 1, z0: ARM, z1: 1 - ARM });
  const boxes = [post(0, 0.125)]; // far hinge post first (icon painter order)
  if (open) {
    // the leaf splits and both halves fold back against the posts (toward
    // +z), leaving the middle of the cell clear to walk through
    for (const [y0, y1] of RAILS) {
      boxes.push({ x0: 0, x1: 0.125, y0, y1, z0: 1 - ARM, z1: 0.9375 });
      boxes.push({ x0: 0.875, x1: 1, y0, y1, z0: 1 - ARM, z1: 0.9375 });
    }
  } else {
    for (const [y0, y1] of RAILS) {
      boxes.push({ x0: 0.125, x1: 0.875, y0, y1, z0: ARM, z1: 1 - ARM });
    }
    // center brace joining the two courses — reads as the leaf's frame
    boxes.push({ x0: ARM, x1: 1 - ARM, y0: 0.375, y1: 0.9375, z0: ARM, z1: 1 - ARM });
  }
  boxes.push(post(0.875, 1)); // near hinge post
  if (spanX) return boxes;
  // spanning z: mirror every box across the x/z diagonal
  return boxes.map((b) => ({ x0: b.z0, x1: b.z1, y0: b.y0, y1: b.y1, z0: b.x0, z1: b.x1 }));
}

// --- the Notice Post ----------------------------------------------------------
// A slim ground post carrying a wide framed board. The board's thin axis
// follows the facing (0/2 = board spans x, faces ±z; 1/3 = spans z, faces ±x);
// the facing itself matters to signs.js, which mounts the text plane on the
// board's front face. Post top ends INSIDE the board so no coplanar faces
// fight. Ordered post-then-board for the HUD's painter's-order iso projector.
const SIGN_POST = { x0: 0.4375, y0: 0, z0: 0.4375, x1: 0.5625, y1: 0.55, z1: 0.5625 };
function signBoxes(facing) {
  const board = facing % 2 === 0
    ? { x0: 0.0625, x1: 0.9375, y0: 0.5, y1: 0.95, z0: 0.45, z1: 0.55 }
    : { x0: 0.45, x1: 0.55, y0: 0.5, y1: 0.95, z0: 0.0625, z1: 0.9375 };
  return [SIGN_POST, board];
}

// neighbor-aware boxes for a shaped block standing in the world
function shapeBoxesAt(def, get, wx, y, wz) {
  if (def.shape !== "fence" && def.shape !== "gate") return shapeBoxes(def);
  const c = [
    fenceConnects(get(wx, y, wz - 1)),
    fenceConnects(get(wx + 1, y, wz)),
    fenceConnects(get(wx, y, wz + 1)),
    fenceConnects(get(wx - 1, y, wz)),
  ];
  return def.shape === "fence" ? fenceBoxes(c) : gateBoxes(def.open, c);
}

// def -> [{x0,y0,z0,x1,y1,z1,skipBottom?}], cached per block def. For fences
// and gates this is the CONTEXT-FREE shape (arms east+west) used by icons,
// item drops, and the held mesh; world meshing goes through shapeBoxesAt.
const shapeBoxCache = new Map();
export function shapeBoxes(def) {
  let boxes = shapeBoxCache.get(def);
  if (boxes) return boxes;
  if (def.shape === "slab") {
    boxes = [SLAB_BOX];
  } else if (def.shape === "stairs") {
    const b = STAIR_BACK[def.facing];
    boxes = [SLAB_BOX, { ...b, y0: 0.5, y1: 1, skipBottom: true }];
  } else if (def.shape === "fence") {
    boxes = fenceBoxes([false, true, false, true]);
  } else if (def.shape === "gate") {
    boxes = gateBoxes(def.open, [false, true, false, true]);
  } else if (def.shape === "sign") {
    boxes = signBoxes(def.facing);
  } else {
    boxes = [];
  }
  shapeBoxCache.set(def, boxes);
  return boxes;
}

// is this box face flush with the cell boundary in the face direction?
function boxFaceOnBoundary(box, dir) {
  const [dx, dy, dz] = dir;
  if (dx !== 0) return dx > 0 ? box.x1 === 1 : box.x0 === 0;
  if (dy !== 0) return dy > 0 ? box.y1 === 1 : box.y0 === 0;
  return dz > 0 ? box.z1 === 1 : box.z0 === 0;
}

// sub-rect of the tile matching the box extents on this face, so half-height
// sides sample only the bottom half of the texture (no squashing)
function boxFaceUV(tile, box, dir) {
  const { u0, u1, v0, v1 } = tileUV(tile);
  const u = (a, b) => [u0 + (u1 - u0) * a, u0 + (u1 - u0) * b];
  const v = (a, b) => [v0 + (v1 - v0) * a, v0 + (v1 - v0) * b];
  let ur, vr;
  const [dx, dy, dz] = dir;
  if (dy > 0) { ur = u(box.x0, box.x1); vr = v(1 - box.z1, 1 - box.z0); }
  else if (dy < 0) { ur = u(box.x0, box.x1); vr = v(box.z0, box.z1); }
  else if (dx > 0) { ur = u(1 - box.z1, 1 - box.z0); vr = v(box.y0, box.y1); }
  else if (dx < 0) { ur = u(box.z0, box.z1); vr = v(box.y0, box.y1); }
  else if (dz > 0) { ur = u(box.x0, box.x1); vr = v(box.y0, box.y1); }
  else { ur = u(1 - box.x1, 1 - box.x0); vr = v(box.y0, box.y1); }
  return { u0: ur[0], u1: ur[1], v0: vr[0], v1: vr[1] };
}

// corner of a face scaled to the box extents (FACES corners are 0/1 flags)
function boxCorner(box, p) {
  return [
    p[0] ? box.x1 : box.x0,
    p[1] ? box.y1 : box.y0,
    p[2] ? box.z1 : box.z0,
  ];
}

function addShapedBlock(bucket, def, lx, y, lz, get, wx, wz, lightAt, blockLightAt) {
  for (const box of shapeBoxesAt(def, get, wx, y, wz)) {
    for (const face of FACES) {
      const [dx, dy, dz] = face.dir;
      if (dy < 0 && box.skipBottom) continue;
      const boundary = boxFaceOnBoundary(box, face.dir);
      if (boundary && BLOCKS[get(wx + dx, y + dy, wz + dz)].opaque) continue;
      // boundary faces are lit by the neighbor cell; interior faces by the
      // block's own (light-passable) cell
      const sx = boundary ? dx : 0, sy = boundary ? dy : 0, sz = boundary ? dz : 0;
      const light = lightAt(lx + sx, Math.max(0, y + sy), lz + sz);
      const torch = blockLightAt(lx + sx, y + sy, lz + sz);
      const tile = dy > 0 ? def.tiles.top : dy < 0 ? def.tiles.bottom : def.tiles.side;
      const corners = face.corners.map((p) => {
        const c = boxCorner(box, p);
        return [lx + c[0], y + c[1], lz + c[2]];
      });
      const b = face.shade * light;
      const t = face.shade * torch;
      bucket.quad(corners, tile, [b, b, b, b], [t, t, t, t], false,
        boxFaceUV(tile, box, face.dir));
    }
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

  // torch light of the cell a face is exposed to (0..1)
  const blockLightMap = computeBlockLight(world, chunk);
  const blockLightAt = (lx, y, lz) => {
    if (!blockLightMap) return 0;
    if (y < 0) y = 0; else if (y >= HEIGHT) y = HEIGHT - 1;
    return blockLightMap[(lx + LIGHT_PAD) + LDIM * ((lz + LIGHT_PAD) + LDIM * y)] / 14;
  };

  for (let y = 0; y < HEIGHT; y++) {
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const id = chunk.data[lx + CHUNK * (lz + CHUNK * y)];
        if (id === AIR) continue;
        const def = BLOCKS[id];
        const wx = x0 + lx, wz = z0 + lz;

        if (def.kind === "cross") {
          // a torch renders at full brightness; other plants take cell light
          const glow = def.lightEmit > 0;
          addCross(buckets.cutout, def, lx, y, lz, wx, wz,
            glow ? 1 : lightAt(lx, y, lz),
            glow ? 1 : blockLightAt(lx, y, lz));
          continue;
        }

        if (def.shape) {
          addShapedBlock(buckets[def.bucket], def, lx, y, lz, get, wx, wz,
            lightAt, blockLightAt);
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
          const torch = blockLightAt(lx + dx, y + dy, lz + dz);
          const corners = [];
          const brightness = [];
          const blockLights = [];
          let flip = false;

          if (def.bucket === "opaque") {
            const ao = [];
            for (let ci = 0; ci < 4; ci++) {
              const p = face.corners[ci];
              corners.push([lx + p[0], y + p[1], lz + p[2]]);
              ao.push(cornerAO(get, wx, y, wz, face.dir, p));
            }
            flip = ao[0] + ao[2] > ao[1] + ao[3];
            for (let ci = 0; ci < 4; ci++) {
              brightness.push(face.shade * AO_MULT[ao[ci]] * light);
              blockLights.push(face.shade * AO_MULT[ao[ci]] * torch);
            }
          } else {
            for (let ci = 0; ci < 4; ci++) {
              const p = face.corners[ci];
              let py = y + p[1];
              // lower exposed water surfaces below the block top
              if (isWater && waterTop && p[1] === 1) py = y + WATER_SURFACE;
              corners.push([lx + p[0], py, lz + p[2]]);
              brightness.push(face.shade * light);
              blockLights.push(face.shade * torch);
            }
          }
          buckets[def.bucket].quad(corners, tile, brightness, blockLights, flip, isWater ? WATER_UV : null);
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

function addCross(bucket, def, lx, y, lz, wx, wz, light = 1, blockLight = 0) {
  // deterministic little offset so plants don't sit on a perfect grid
  // (torches stay centered so they read as attached to the block below, and
  // sturdy fixtures — ladders, open door leaves — stay squarely in their cell)
  const jitter = def.lightEmit > 0 || def.sturdy ? 0 : 1;
  const ox = (hash2(wx, wz, 0x9e37) - 0.5) * 0.3 * jitter;
  const oz = (hash2(wz, wx, 0x79b9) - 0.5) * 0.3 * jitter;
  const l = 0.15 + ox, h = 0.85 + ox;
  const l2 = 0.15 + oz, h2 = 0.85 + oz;
  const s = 0.95 * light;
  const b = [s, s, s, s];
  const t = [blockLight, blockLight, blockLight, blockLight];
  bucket.quad(
    [[lx + l, y, lz + l2], [lx + h, y, lz + h2], [lx + h, y + 1, lz + h2], [lx + l, y + 1, lz + l2]],
    def.tiles.side, b, t);
  bucket.quad(
    [[lx + l, y, lz + h2], [lx + h, y, lz + l2], [lx + h, y + 1, lz + l2], [lx + l, y + 1, lz + h2]],
    def.tiles.side, b, t);
}

// Small standalone block mesh (used for the held item). Bakes face shading;
// blockLight keeps it visible at night.
export function buildBlockGeometry(blockId, blockLight = 0.25) {
  const def = BLOCKS[blockId];
  const b = new BucketBuffer();
  const bl = [blockLight, blockLight, blockLight, blockLight];
  if (def.kind === "cross") {
    b.quad([[0, 0, 0.5], [1, 0, 0.5], [1, 1, 0.5], [0, 1, 0.5]],
      def.tiles.side, [1, 1, 1, 1], def.lightEmit > 0 ? [1, 1, 1, 1] : bl);
  } else if (def.shape) {
    for (const box of shapeBoxes(def)) {
      for (const face of FACES) {
        if (face.dir[1] < 0 && box.skipBottom) continue;
        const tile = face.dir[1] > 0 ? def.tiles.top : face.dir[1] < 0 ? def.tiles.bottom : def.tiles.side;
        const s = face.shade;
        b.quad(face.corners.map((p) => boxCorner(box, p)), tile, [s, s, s, s], bl,
          false, boxFaceUV(tile, box, face.dir));
      }
    }
  } else {
    for (const face of FACES) {
      const tile = face.dir[1] > 0 ? def.tiles.top : face.dir[1] < 0 ? def.tiles.bottom : def.tiles.side;
      const s = face.shade;
      b.quad(face.corners.map((p) => [p[0], p[1], p[2]]), tile, [s, s, s, s], bl);
    }
  }
  return b.build();
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
