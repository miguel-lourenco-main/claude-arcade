// Voxelcraft bootstrap + game loop: chunk streaming, input wiring, fixed-step
// physics, HUD/debug, persistence.

import * as THREE from "three";
import { buildAtlas, buildWaterTexture, buildCrackTextures } from "./textures.js";
import { BLOCKS, AIR } from "./blocks.js";
import { World, CHUNK, HEIGHT } from "./world.js";
import { Inventory } from "./inventory.js";
import { ItemDrops } from "./entities.js";
import { Mobs } from "./mobs.js";
import { craft } from "./craft.js";
import { SAPLING, LOG, LEAVES, LEAVES_COLD } from "./blocks.js";
import { makeGenerator, findSpawn, findBiomeLocation } from "./terrain.js";
import {
  buildMaterials, meshChunk, disposeChunkMeshes, setDayLight, buildBlockGeometry,
} from "./mesher.js";
import { Player } from "./player.js";
import { Interaction } from "./interact.js";
import { Hud } from "./hud.js";
import { Sky } from "./sky.js";
import { Sfx } from "./audio.js";
import { loadSave, writeSave, clearSave, startAutosave } from "./save.js";

const MESH_RADIUS = 5;
const GEN_RADIUS = MESH_RADIUS + 1;
const UNLOAD_RADIUS = GEN_RADIUS + 2;
const FIXED_DT = 1 / 60;
// test hook: ?nolock runs input+physics without pointer lock (headless browsers
// can't grant pointer lock, so automated tests use this)
const NO_LOCK = new URLSearchParams(location.search).has("nolock");

// --- boot -------------------------------------------------------------------

const save = loadSave();
const seed = save ? save.seed : (Math.random() * 0xffffffff) >>> 0;

const atlas = buildAtlas(1337); // fixed texture seed: consistent look across worlds
const materials = buildMaterials(atlas.texture, buildWaterTexture(1337));

const world = new World(seed);
const generator = makeGenerator(seed);
world.generator = generator;
const terrain = generator.terrain;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 600);
camera.rotation.order = "YXZ";

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
document.getElementById("app").appendChild(renderer.domElement);

const spawnPoint = findSpawn(terrain);
const player = new Player(world);
const validPos = (p) => p && [p.x, p.y, p.z].every(Number.isFinite) && p.y > 0 && p.y < HEIGHT + 60;
if (save && validPos(save.player)) {
  Object.assign(player.pos, { x: save.player.x, y: save.player.y, z: save.player.z });
  player.yaw = Number.isFinite(save.player.yaw) ? save.player.yaw : 0;
  player.pitch = Number.isFinite(save.player.pitch)
    ? Math.max(-1.5, Math.min(1.5, save.player.pitch)) : 0;
  player.flying = !!save.player.flying;
} else {
  Object.assign(player.pos, spawnPoint);
}
player.moveMode = save && (save.movement2 === "static" || save.movement2 === "camera")
  ? save.movement2 : "camera";
player.sensitivity = save && Number.isFinite(save.sensitivity)
  ? Math.min(2.5, Math.max(0.3, save.sensitivity)) : 1;

// game mode: new worlds start in survival ("normal"); saves from before the
// mode existed stay creative — that's what those worlds were
player.mode = save
  ? (save.gameMode === "survival" ? "survival" : "creative")
  : "survival";
if (player.mode === "survival") player.flying = false;
// health/air persist regardless of the mode the save was written in — a
// creative-saved world toggled back to survival keeps its wounds
if (save && Number.isFinite(save.health)) {
  player.health = Math.min(20, Math.max(1, save.health)); // never load in dead
}
if (save && Number.isFinite(save.air)) {
  player.air = Math.min(player.maxAir, Math.max(0, save.air));
}

const inventory = new Inventory();
if (save && save.inventory) inventory.load(save.inventory);
const drops = new ItemDrops(scene, materials);
const mobs = new Mobs(scene);
if (save && save.chests) world.loadChests(save.chests);

// --- saplings: planted ones grow into real (edit-persisted) trees ----------

let worldSeconds = 0;
const saplings = new Map(); // "x,y,z" -> worldSeconds when it grows

function registerSapling(x, y, z, delay = 30 + Math.random() * 30) {
  saplings.set(`${x},${y},${z}`, worldSeconds + delay);
}

function growTree(x, y, z) {
  const biome = terrain.biomeAt(x, z, y);
  const leaves = biome === "snow" ? LEAVES_COLD : LEAVES;
  const trunk = 4 + Math.floor(Math.random() * 3);
  const affected = new Set();
  const put = (dx, dy, dz, id, onlyAir = true) => {
    const bx = x + dx, by = y + dy, bz = z + dz;
    if (by <= 0 || by >= HEIGHT) return;
    if (onlyAir && world.getBlock(bx, by, bz) !== AIR) return;
    for (const c of world.setBlock(bx, by, bz, id)) affected.add(c);
  };
  for (let dy = trunk - 2; dy <= trunk - 1; dy++) {
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      if (Math.abs(dx) === 2 && Math.abs(dz) === 2 && Math.random() < 0.5) continue;
      put(dx, dy, dz, leaves);
    }
  }
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    if (Math.abs(dx) === 1 && Math.abs(dz) === 1) continue;
    put(dx, trunk, dz, leaves);
  }
  put(0, trunk + 1, 0, leaves);
  for (let dy = 0; dy < trunk; dy++) put(0, dy, 0, LOG, false); // overwrites the sapling
  for (const c of affected) remeshNow(c);
}

function updateSaplings() {
  for (const [key, due] of saplings) {
    if (worldSeconds < due) continue;
    const [x, y, z] = key.split(",").map(Number);
    if (!world.isGenerated(x >> 4, z >> 4)) continue; // wait for the chunk
    saplings.delete(key);
    if (world.getBlock(x, y, z) === SAPLING) growTree(x, y, z);
  }
}
if (save && Array.isArray(save.saplings)) {
  for (const s of save.saplings) {
    if (!Array.isArray(s) || s.length !== 4) continue;
    const [x, y, z, remain] = s;
    if ([x, y, z].every(Number.isInteger) && Number.isFinite(remain)) {
      registerSapling(x, y, z, Math.max(1, Math.min(90, remain)));
    }
  }
}
if (save && save.edits) world.loadEdits(save.edits);

const sky = new Sky(scene, seed);
if (save && Number.isFinite(save.time)) sky.time = ((save.time % 1) + 1) % 1;

const sfx = new Sfx();
player.onStep = (blockId) => { if (blockId !== AIR) sfx.step(blockId); };

function teleportTo(kind) {
  const dest = kind === "spawn"
    ? spawnPoint
    : findBiomeLocation(terrain, kind, player.pos.x, player.pos.z);
  if (!dest) return { ok: false, message: `No ${kind} found within 3000 blocks of here.` };
  Object.assign(player.pos, dest);
  player.vel.x = player.vel.y = player.vel.z = 0;
  player.resetFall(); // or the landing charges fall damage from the old spot
  return { ok: true, message: `→ ${kind} at ${Math.round(dest.x)}, ${Math.round(dest.z)} — click to play.` };
}

// respawn/void landings must respect player edits: if the spawn column was
// built over (or dug out), climb to the first clear spot above it
function adjustToClearGround(pos) {
  const bx = Math.floor(pos.x), bz = Math.floor(pos.z);
  if (!world.isGenerated(bx >> 4, bz >> 4)) return;
  let y = Math.max(1, Math.floor(pos.y));
  while (y < HEIGHT - 2 &&
    (BLOCKS[world.getBlock(bx, y, bz)].solid || BLOCKS[world.getBlock(bx, y + 1, bz)].solid)) {
    y++;
  }
  pos.y = Math.max(pos.y, y + 0.05);
}

const hud = new Hud(atlas.canvas, {
  onResume: () => requestLock(),
  onReset: () => { stopAutosave(); clearSave(); location.reload(); },
  onTeleport: teleportTo,
  onToggleMovement: () => {
    player.moveMode = player.moveMode === "static" ? "camera" : "static";
    return player.moveMode;
  },
  onSensitivity: (v) => { player.sensitivity = v; },
  onToggleMode: () => {
    player.mode = player.mode === "survival" ? "creative" : "survival";
    if (player.mode === "survival") {
      player.flying = false;
      player.resetFall(); // creative altitude must not become a survival fall
    }
    return player.mode;
  },
  onRespawn: () => {
    player.respawn(spawnPoint);
    adjustToClearGround(player.pos);
    player.resetFall();
    hud.hideDeath();
    requestLock();
  },
  onCraft: (recipe) => { if (craft(recipe, inventory)) sfx.craft(); },
  inventory,
});
hud.setMovementLabel(player.moveMode);
hud.setSensitivity(player.sensitivity);
hud.setMode(player.mode);

player.onDamage = () => { hud.flashDamage(); sfx.hurt(); };
player.onDeath = (cause) => {
  hud.showDeath(cause);
  if (document.pointerLockElement) document.exitPointerLock();
};
const validSlot = (id) => Number.isInteger(id) && id !== AIR && !!BLOCKS[id];
if (save && Array.isArray(save.hotbar) && save.hotbar.length === 9 && save.hotbar.every(validSlot)) {
  hud.slots = save.hotbar;
  hud.select(0);
  hud.refreshCounts(); // badges must track the LOADED slots, not the defaults
}

const interaction = new Interaction(world, player, scene, hud, {
  onEdit: (chunks, info) => {
    if (chunks.length === 0) return;
    // torch light reaches up to 14 blocks into neighboring chunks, so any
    // edit that adds/removes an emitter OR happens near one (occluders
    // change the BFS result) must remesh the full 3x3 ring, not just the
    // border-adjacent chunks
    const { cx, cz } = chunks[0];
    let lightTouched = info && info.ids &&
      info.ids.some((id) => id != null && BLOCKS[id].lightEmit > 0);
    if (!lightTouched) {
      outer: for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const c = world.getChunk(cx + dx, cz + dz);
        if (c && c.emitters.size > 0) { lightTouched = true; break outer; }
      }
    }
    if (lightTouched) {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const c = world.getChunk(cx + dx, cz + dz);
        if (c) remeshNow(c);
      }
    } else {
      for (const c of chunks) remeshNow(c);
    }
    // sapling lifecycle
    if (info) {
      if (info.placed === SAPLING) registerSapling(info.x, info.y, info.z);
      if (info.broken === SAPLING) saplings.delete(`${info.x},${info.y},${info.z}`);
      if (info.popped === SAPLING) saplings.delete(`${info.x},${info.y + 1},${info.z}`);
    }
  },
  onSound: (kind, id) => sfx.block(kind, id),
  onPick: (id) => hud.setSlot(id),
  onSwing: () => { swingT = 0; },
  canConsume: (id) => {
    const ok = inventory.take(id);
    if (ok) hud.refreshCounts();
    return ok;
  },
  onSpawnDrop: (x, y, z, id) => drops.spawn(x, y, z, id),
  onOpenChest: (x, y, z) => {
    const key = `${x},${y},${z}`;
    let store = world.chests.get(key);
    if (!store) { store = new Map(); world.chests.set(key, store); }
    hud.openChest(store, () => sfx.click());
  },
  onChestBreak: (x, y, z) => {
    const key = `${x},${y},${z}`;
    const store = world.chests.get(key);
    if (store) {
      for (const [id, n] of store) drops.spawn(x + 0.5, y + 0.6, z + 0.5, id, n);
      world.chests.delete(key);
    }
    if (hud.chestOpen) { hud.closeChest(); requestLock(); }
  },
  mobs,
  crackTextures: buildCrackTextures(1337),
  avgColor: atlas.avgColor,
});
mobs.onMobHurt = () => sfx.mobHurt();

const stopAutosave = startAutosave(() => writeSave(world, player, sky, hud, inventory, {
  saplings: [...saplings].map(([key, due]) => {
    const [x, y, z] = key.split(",").map(Number);
    return [x, y, z, Math.max(1, due - worldSeconds)];
  }),
}));

// --- held block (first-person hand) ------------------------------------------

scene.add(camera); // children of the camera render only if it's in the scene
const heldMesh = new THREE.Mesh(undefined, materials.held);
heldMesh.frustumCulled = false;
heldMesh.renderOrder = 20;
heldMesh.scale.setScalar(0.32);
camera.add(heldMesh);
let heldBlockId = null;
let swingT = 1; // 0..1 swing animation progress (1 = at rest)

function refreshHeldMesh() {
  const id = hud.selectedId();
  if (id === heldBlockId) return;
  heldBlockId = id;
  if (heldMesh.geometry) heldMesh.geometry.dispose();
  const geo = buildBlockGeometry(id);
  geo.translate(-0.5, -0.5, -0.5); // rotate around the block center
  heldMesh.geometry = geo;
}

function animateHeld(frameDt, bobY) {
  refreshHeldMesh();
  swingT = Math.min(1, swingT + frameDt / 0.22);
  const s = Math.sin(Math.PI * swingT); // 0 -> 1 -> 0 dip
  heldMesh.position.set(0.42, -0.38 + bobY * 0.6 - s * 0.16, -0.65 - s * 0.08);
  heldMesh.rotation.set(0.18 - s * 1.1, -0.4 + s * 0.25, 0);
}

// --- chunk streaming --------------------------------------------------------

function neighborsGenerated(cx, cz) {
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    if ((dx !== 0 || dz !== 0) && !world.isGenerated(cx + dx, cz + dz)) return false;
  }
  return true;
}

function remeshNow(chunk) {
  if (chunk.generated && neighborsGenerated(chunk.cx, chunk.cz)) {
    meshChunk(world, chunk, materials, scene);
  }
}

let genQueue = [];
let lastPlayerChunk = null;

function refreshQueues() {
  const pcx = Math.floor(player.pos.x / CHUNK), pcz = Math.floor(player.pos.z / CHUNK);
  genQueue = [];
  for (let dz = -GEN_RADIUS; dz <= GEN_RADIUS; dz++) {
    for (let dx = -GEN_RADIUS; dx <= GEN_RADIUS; dx++) {
      const cx = pcx + dx, cz = pcz + dz;
      if (!world.isGenerated(cx, cz)) genQueue.push([cx, cz, dx * dx + dz * dz]);
    }
  }
  genQueue.sort((a, b) => a[2] - b[2]);

  // unload far chunks
  for (const chunk of [...world.chunks.values()]) {
    const d = Math.max(Math.abs(chunk.cx - pcx), Math.abs(chunk.cz - pcz));
    if (d > UNLOAD_RADIUS) {
      disposeChunkMeshes(chunk, scene);
      world.unloadChunk(chunk.cx, chunk.cz);
    }
  }
}

function streamChunks(bootBudget) {
  const pcx = Math.floor(player.pos.x / CHUNK), pcz = Math.floor(player.pos.z / CHUNK);
  const key = pcx + "," + pcz;
  if (key !== lastPlayerChunk) { lastPlayerChunk = key; refreshQueues(); }

  let genBudget = bootBudget ? 8 : 2;
  while (genBudget > 0 && genQueue.length > 0) {
    const [cx, cz] = genQueue.shift();
    if (world.isGenerated(cx, cz)) continue;
    world.ensureChunk(cx, cz);
    genBudget--;
  }

  // mesh nearest dirty chunks within radius whose neighbors are all generated
  let candidates = [];
  for (const chunk of world.chunks.values()) {
    if (!chunk.generated || !chunk.dirty) continue;
    const d = Math.max(Math.abs(chunk.cx - pcx), Math.abs(chunk.cz - pcz));
    if (d > MESH_RADIUS) continue;
    if (!neighborsGenerated(chunk.cx, chunk.cz)) continue;
    candidates.push([chunk, d]);
  }
  candidates.sort((a, b) => a[1] - b[1]);
  let meshBudget = bootBudget ? 6 : 2;
  for (const [chunk] of candidates) {
    if (meshBudget-- <= 0) break;
    meshChunk(world, chunk, materials, scene);
  }
}

// --- input ------------------------------------------------------------------

const canvas = renderer.domElement;
let started = false;

function requestLock() {
  hud.closePicker();
  if (NO_LOCK) { hud.hidePause(); started = true; return; }
  // the promise rejects during the browser's post-Escape cooldown — swallow
  // it (the pause overlay is still up; the next click retries)
  const p = canvas.requestPointerLock();
  if (p && typeof p.catch === "function") p.catch(() => {});
}

document.addEventListener("pointerlockerror", () => {});

canvas.addEventListener("click", () => {
  if (!document.pointerLockElement) requestLock();
});

// in nolock mode the pointer-lock state can't encode "playing", so follow the
// overlay state machine instead — otherwise UI clicks would break blocks
const inputActive = () => NO_LOCK
  ? !hud.paused && !hud.pickerOpen && !hud.chestOpen
  : document.pointerLockElement === canvas;

document.addEventListener("pointerlockchange", () => {
  const locked = document.pointerLockElement === canvas;
  if (locked) {
    hud.hidePause();
    started = true;
  } else if (!NO_LOCK) {
    player.clearInput();
    interaction.clearInput();
    if (!hud.pickerOpen && !hud.deathOpen && !hud.chestOpen) hud.showPause(!started);
  }
});

document.addEventListener("mousemove", (e) => {
  if (inputActive()) player.onMouseMove(e.movementX, e.movementY);
});

document.addEventListener("mousedown", (e) => {
  if (!inputActive() || hud.pickerOpen) return;
  if (e.button === 1) e.preventDefault();
  interaction.onMouseDown(e.button);
});
document.addEventListener("mouseup", (e) => interaction.onMouseUp(e.button));
document.addEventListener("contextmenu", (e) => e.preventDefault());

let debugVisible = false;

document.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.code === "F3") { e.preventDefault(); debugVisible = !debugVisible; return; }
  if (e.code === "KeyE") {
    if (hud.chestOpen) { hud.closeChest(); requestLock(); }
    else if (hud.pickerOpen) { hud.closePicker(); requestLock(); }
    else if (inputActive()) hud.openPicker();
    return;
  }
  if (e.code === "Escape" && hud.chestOpen) {
    hud.closeChest();
    hud.showPause();
    return;
  }
  if (e.code === "Escape" && hud.pickerOpen) {
    hud.closePicker();
    hud.showPause();
    return;
  }
  if (inputActive() && !hud.pickerOpen) {
    if (e.code.startsWith("Digit")) {
      const n = Number(e.code.slice(5));
      if (n >= 1 && n <= 9) { hud.select(n - 1); sfx.click(); return; }
    }
    player.onKeyDown(e.code);
  }
});
document.addEventListener("keyup", (e) => player.onKeyUp(e.code));

document.addEventListener("wheel", (e) => {
  if (e.deltaY !== 0 && inputActive() && !hud.pickerOpen) { hud.scroll(e.deltaY); sfx.click(); }
}, { passive: true });

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// --- loop -------------------------------------------------------------------

let last = performance.now();
let accumulator = 0;
let fps = 60;
let frames = 0;
let bobPhase = 0;
let bobAmp = 0;
let nextSaplingCheck = 0;

const CARDINALS = ["north (-z)", "east (+x)", "south (+z)", "west (-x)"];

function facing() {
  const a = ((-player.yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return CARDINALS[Math.round(a / (Math.PI / 2)) % 4];
}

function clock() {
  const h = (sky.time * 24 + 6) % 24;
  const m = Math.floor((h % 1) * 60);
  return `${String(Math.floor(h)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function tick(now) {
  requestAnimationFrame(tick);
  const frameDt = Math.min(0.1, (now - last) / 1000);
  last = now;
  fps = fps * 0.95 + (1 / Math.max(frameDt, 1e-4)) * 0.05;
  frames++;

  streamChunks(frames < 90);

  // physics only once the ground around the whole AABB exists — the player's
  // own chunk AND its neighbors (collision near a border reads into them)
  const pcx = Math.floor(player.pos.x / CHUNK), pcz = Math.floor(player.pos.z / CHUNK);
  const playerChunkReady = world.isGenerated(pcx, pcz) && neighborsGenerated(pcx, pcz);

  if (playerChunkReady && inputActive()) {
    accumulator = Math.min(accumulator + frameDt, 0.25);
    while (accumulator >= FIXED_DT) {
      player.update(FIXED_DT);
      accumulator -= FIXED_DT;
    }
    drops.update(frameDt, world, player, (id, qty) => {
      inventory.add(id, qty);
      sfx.pickup();
      hud.refreshCounts();
    });
    mobs.update(frameDt, world, player, sfx);
    worldSeconds += frameDt;
    if (worldSeconds >= nextSaplingCheck) {
      nextSaplingCheck = worldSeconds + 1;
      updateSaplings();
    }
  }
  mobs.setLight(sky.lightLevel, sky.lightTint);

  if (player.mode === "survival") {
    hud.setHealth(player.health);
    hud.setAir(player.air, player.maxAir, player.eyeInWater);
  }

  // void safety net (creative only — in survival the void deals damage and
  // the death screen handles it)
  if (player.pos.y < -16 && player.mode !== "survival") {
    Object.assign(player.pos, spawnPoint);
    player.vel.x = player.vel.y = player.vel.z = 0;
    player.flying = false;
    adjustToClearGround(player.pos);
    player.resetFall();
  }

  // view bobbing while walking on the ground
  const horizSpeed = Math.hypot(player.vel.x, player.vel.z);
  bobAmp += ((player.onGround && horizSpeed > 0.5 ? 1 : 0) - bobAmp) * Math.min(1, frameDt * 8);
  bobPhase += horizSpeed * frameDt * 1.7;
  const bobY = Math.sin(bobPhase * 2) * 0.05 * bobAmp;
  const bobX = Math.cos(bobPhase) * 0.03 * bobAmp;

  camera.position.set(
    player.pos.x + Math.cos(player.yaw) * bobX,
    player.eyeY + bobY,
    player.pos.z - Math.sin(player.yaw) * bobX);
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;
  camera.rotation.z = Math.sin(bobPhase) * 0.004 * bobAmp;

  // scrolling water (uv-offset uniform — ShaderMaterial ignores texture.offset)
  materials.water.uniforms.uUvOffset.value.set((now * 0.000021) % 1, (now * 0.000013) % 1);

  animateHeld(frameDt, bobY);

  // sprint FOV kick (applies to sprint-flight too, like MC)
  const targetFov = player.sprintActive ? 77 : 70;
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, frameDt * 10);
    camera.updateProjectionMatrix();
  }

  interaction.update(frameDt);
  sky.update(frameDt, camera, player.eyeInWater);
  setDayLight(materials, sky.lightLevel, sky.lightTint);
  hud.setUnderwater(player.eyeInWater);

  if (debugVisible) {
    const p = player.pos;
    const bx = Math.floor(p.x), bz = Math.floor(p.z);
    const h = terrain.heightAt(bx, bz);
    hud.updateDebug([
      `Voxelcraft (seed ${world.seed})`,
      `${fps.toFixed(0)} fps / ${renderer.info.render.calls} draws / ${renderer.info.render.triangles} tris`,
      `xyz: ${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)}`,
      `chunk: ${Math.floor(p.x / CHUNK)} ${Math.floor(p.z / CHUNK)}  loaded: ${world.chunks.size}`,
      `biome: ${terrain.biomeAt(bx, bz, h)}  facing: ${facing()}  move: ${player.moveMode}`,
      `time: ${clock()}  ${player.flying ? "[flying]" : player.onGround ? "[ground]" : "[air]"}${player.inWater ? " [water]" : ""}  mode: ${player.mode}${player.mode === "survival" ? ` hp:${player.health.toFixed(0)}` : ""}`,
      `target: ${interaction.target ? BLOCKS[interaction.target.id].name : "none"}`,
    ], true);
  } else {
    hud.updateDebug([], false);
  }

  renderer.render(scene, camera);
}

requestAnimationFrame(tick);

// automated-test handle (only in ?nolock mode, which headless tests use)
if (NO_LOCK) {
  window.voxelcraft = {
    player, world, hud, sky, terrain, interaction, mobs, drops, saplings,
    growAllSaplings: () => { for (const k of saplings.keys()) saplings.set(k, 0); },
  };
}
