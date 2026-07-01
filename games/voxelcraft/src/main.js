// Voxelcraft bootstrap + game loop: chunk streaming, input wiring, fixed-step
// physics, HUD/debug, persistence.

import * as THREE from "three";
import { buildAtlas, buildWaterTexture } from "./textures.js";
import { BLOCKS, AIR } from "./blocks.js";
import { World, CHUNK, HEIGHT } from "./world.js";
import { makeGenerator, findSpawn, findBiomeLocation } from "./terrain.js";
import { buildMaterials, meshChunk, disposeChunkMeshes } from "./mesher.js";
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
player.moveMode = save && save.movement === "camera" ? "camera" : "static";
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
  return { ok: true, message: `→ ${kind} at ${Math.round(dest.x)}, ${Math.round(dest.z)} — click to play.` };
}

const hud = new Hud(atlas.canvas, {
  onResume: () => requestLock(),
  onReset: () => { stopAutosave(); clearSave(); location.reload(); },
  onTeleport: teleportTo,
  onToggleMovement: () => {
    player.moveMode = player.moveMode === "static" ? "camera" : "static";
    return player.moveMode;
  },
});
hud.setMovementLabel(player.moveMode);
const validSlot = (id) => Number.isInteger(id) && id !== AIR && !!BLOCKS[id];
if (save && Array.isArray(save.hotbar) && save.hotbar.length === 9 && save.hotbar.every(validSlot)) {
  hud.slots = save.hotbar;
  hud.select(0);
}

const interaction = new Interaction(world, player, scene, hud, {
  onEdit: (chunks) => { for (const c of chunks) remeshNow(c); },
  onSound: (kind, id) => sfx.block(kind, id),
  onPick: (id) => hud.setSlot(id),
  avgColor: atlas.avgColor,
});

const stopAutosave = startAutosave(() => writeSave(world, player, sky, hud));

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

const inputActive = () => NO_LOCK || document.pointerLockElement === canvas;

document.addEventListener("pointerlockchange", () => {
  const locked = document.pointerLockElement === canvas;
  if (locked) {
    hud.hidePause();
    started = true;
  } else if (!NO_LOCK) {
    player.clearInput();
    interaction.clearInput();
    if (!hud.pickerOpen) hud.showPause(!started);
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
    if (hud.pickerOpen) { hud.closePicker(); requestLock(); }
    else if (inputActive()) hud.openPicker();
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
  }

  // void safety net: below the world, respawn instead of falling forever
  if (player.pos.y < -16) {
    Object.assign(player.pos, spawnPoint);
    player.vel.x = player.vel.y = player.vel.z = 0;
    player.flying = false;
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

  // scrolling water
  const waterMap = materials.water.map;
  waterMap.offset.x = (now * 0.000021) % 1;
  waterMap.offset.y = (now * 0.000013) % 1;

  // sprint FOV kick
  const targetFov = player.sprinting && !player.flying ? 77 : 70;
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, frameDt * 10);
    camera.updateProjectionMatrix();
  }

  interaction.update(frameDt);
  sky.update(frameDt, camera, player.eyeInWater);
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
      `time: ${clock()}  ${player.flying ? "[flying]" : player.onGround ? "[ground]" : "[air]"}${player.inWater ? " [water]" : ""}`,
      `target: ${interaction.target ? BLOCKS[interaction.target.id].name : "none"}`,
    ], true);
  } else {
    hud.updateDebug([], false);
  }

  renderer.render(scene, camera);
}

requestAnimationFrame(tick);
