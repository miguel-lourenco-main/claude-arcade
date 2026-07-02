// Voxelcraft bootstrap + game loop: chunk streaming, input wiring, fixed-step
// physics, HUD/debug, persistence.

import * as THREE from "three";
import { buildAtlas, buildWaterTexture, buildCrackTextures } from "./textures.js";
import { BLOCKS, AIR } from "./blocks.js";
import { World, CHUNK, HEIGHT } from "./world.js";
import { Inventory } from "./inventory.js";
import { ItemDrops } from "./entities.js";
import { PrimedKegs } from "./explosives.js";
import { SlingStones } from "./projectiles.js";
import { Mobs } from "./mobs.js";
import { Boats } from "./boats.js";
import { Fishing } from "./fishing.js";
import { SignBoards } from "./signs.js";
import { craft } from "./craft.js";
import { dailyOffers, executeTrade } from "./trade.js";
import { makeKiln, tickKilns } from "./kiln.js";
import { PlayerModel, buildHeldFoot, buildHeldTool, setHeldSkinLight } from "./player-model.js";
import { PlayerViewer } from "./player-viewer.js";
import {
  SAPLING, LOG, LEAVES, LEAVES_COLD, BED, WATER as WATER_ID, dropFor,
  CROP_SPROUT, CROP_RIPE, CROP_STAGES, isCrop, SLING_STONE, BOAT, FISHING_POLE,
  isSign,
} from "./blocks.js";
import { makeGenerator, findSpawn, findBiomeLocation } from "./terrain.js";
import {
  buildMaterials, meshChunk, disposeChunkMeshes, setDayLight, buildBlockGeometry,
} from "./mesher.js";
import { raycast } from "./interact.js";
import { Player } from "./player.js";
import { Interaction } from "./interact.js";
import { Hud } from "./hud.js";
import { Sky } from "./sky.js";
import { Rain } from "./rain.js";
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
// two-pass rendering: world, then the first-person hand over a cleared depth
// buffer (self-occludes correctly, never hidden by water or walls)
renderer.autoClear = false;
renderer.info.autoReset = false;
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
// hunger is an additive v2 field: saves from before it default to well-fed
if (save && Number.isFinite(save.hunger)) {
  player.hunger = Math.min(20, Math.max(0, save.hunger));
}
// the Moss Cot respawn anchor (additive field): validated like the player pos;
// whether the cot still stands is checked at respawn time, not here
if (save && validPos(save.spawnPoint)) {
  player.spawnPoint = {
    x: save.spawnPoint.x, y: save.spawnPoint.y, z: save.spawnPoint.z,
  };
}

const inventory = new Inventory();
// stacks that couldn't fit in the satchel (v1 migration overflow, a restored
// cursor stack with no room). Persisted in every save and drained back into
// the inventory as room appears — never spilled as unsaved ground drops.
let pendingOverflow = [];
const validSaveStack = (e) => Array.isArray(e) &&
  Number.isInteger(e[0]) && e[0] !== AIR && !!BLOCKS[e[0]] &&
  Number.isInteger(e[1]) && e[1] > 0;
if (save) {
  if (save.v === 2) {
    inventory.load(save.inventory);
    // additive field: pending overflow stacks from an earlier session
    if (Array.isArray(save.overflowStacks)) {
      for (const e of save.overflowStacks) {
        // e[2]: additive tool wear (validated on the way into a slot)
        if (validSaveStack(e)) pendingOverflow.push({ id: e[0], count: e[1], dur: e[2] });
      }
    }
    // additive field: the stack that was held on the drag cursor when the
    // save was written — return it to the satchel, or queue it if full
    if (validSaveStack(save.cursor)) {
      const count = Math.min(64, save.cursor[1]);
      const left = inventory.add(save.cursor[0], count, save.cursor[2]);
      if (left > 0) {
        pendingOverflow.push({ id: save.cursor[0], count: left, dur: save.cursor[2] });
      }
    }
  } else {
    // v1 save: pool counts + a 9-id hotbar -> 64-stacks in slots, layout kept
    const migrated = Inventory.migrateV1(
      save.inventory, save.hotbar,
      save.gameMode === "survival" ? "survival" : "creative");
    inventory.slots = migrated.inv.slots;
    pendingOverflow = migrated.overflow;
  }
}
const drops = new ItemDrops(scene, materials);

// retry pendingOverflow against the satchel; called on a slow timer from the
// game loop, so freed slots gradually recover everything that once overflowed
function drainOverflow() {
  if (pendingOverflow.length === 0) return;
  let changed = false;
  pendingOverflow = pendingOverflow.filter((stack) => {
    const left = inventory.add(stack.id, stack.count, stack.dur);
    if (left !== stack.count) changed = true;
    stack.count = left;
    return left > 0;
  });
  if (changed) {
    hud.refreshHotbarRow();
    if (hud.anyWindowOpen()) hud.slotUI.renderAll();
  }
}
const mobs = new Mobs(scene);
// the Reed Skiffs afloat (and beached) in this world — created before the
// Interaction so its boarding/launch routing can hold the instance directly
const boats = new Boats(scene, {
  onDrop: (x, y, z, id) => drops.spawn(x, y, z, id),
  onHit: () => sfx.block("hit", BOAT),
  onBreak: () => sfx.block("break", BOAT),
});
if (save && save.chests) world.loadChests(save.chests);
if (save && save.kilns) world.loadKilns(save.kilns); // additive v2 field
if (save && Array.isArray(save.boats)) boats.load(save.boats); // additive v2 field
if (save && save.signs) world.loadSigns(save.signs); // additive v2 field
// the Notice Posts' text boards — synced against world.signs every frame
const signBoards = new SignBoards(scene, world);

// --- saplings: planted ones grow into real (edit-persisted) trees ----------

let worldSeconds = 0;
// the saplings' own clock: it runs alongside worldSeconds but up to 2x while
// raining (a watered sapling halves its remaining wait, LORE-appropriately)
let growthSeconds = 0;
const saplings = new Map(); // "x,y,z" -> growthSeconds when it grows

function registerSapling(x, y, z, delay = 30 + Math.random() * 30) {
  saplings.set(`${x},${y},${z}`, growthSeconds + delay);
}

function growTree(x, y, z) {
  const biome = terrain.biomeAt(x, z, y);
  const leaves = biome === "snow" ? LEAVES_COLD : LEAVES;
  const trunk = 4 + Math.floor(Math.random() * 3);
  const affected = new Set();
  let lightTouched = false;
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
  // trunk: only ever grows through air, the sapling itself, plants, and its
  // own leaves — a player-built block (chest!) stops the trunk instead of
  // being silently destroyed
  for (let dy = 0; dy < trunk; dy++) {
    const existing = world.getBlock(x, y + dy, z);
    const exDef = BLOCKS[existing];
    const passable = existing === AIR || existing === SAPLING ||
      existing === LEAVES || existing === LEAVES_COLD || exDef.kind === "cross";
    if (!passable) break;
    if (exDef.kind === "cross" && existing !== SAPLING) {
      if (exDef.lightEmit > 0) lightTouched = true; // replaced a torch
      const d = dropFor(existing);
      if (d !== null) drops.spawn(x + 0.5, y + dy + 0.3, z + 0.5, d);
    }
    for (const c of world.setBlock(x, y + dy, z, LOG)) affected.add(c);
  }
  lightAwareRemesh([...affected], lightTouched);
}

// remesh after a world edit: widen to the full 3x3 ring when the edit adds/
// removes an emitter or happens near one (occluders change the light BFS).
// Handles multi-chunk edit lists (explosions) with each chunk meshed once.
function lightAwareRemesh(chunks, lightTouched) {
  if (chunks.length === 0) return;
  const toMesh = new Set();
  for (const chunk of chunks) {
    const { cx, cz } = chunk;
    let wide = lightTouched;
    if (!wide) {
      outer: for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const c = world.getChunk(cx + dx, cz + dz);
        if (c && c.emitters.size > 0) { wide = true; break outer; }
      }
    }
    if (wide) {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const c = world.getChunk(cx + dx, cz + dz);
        if (c) toMesh.add(c);
      }
    } else {
      toMesh.add(chunk);
    }
  }
  for (const c of toMesh) remeshNow(c);
}

function updateSaplings() {
  for (const [key, due] of saplings) {
    if (growthSeconds < due) continue;
    const [x, y, z] = key.split(",").map(Number);
    // the canopy spans 2 blocks into neighbor chunks: growing while any of
    // them is ungenerated would silently drop those leaves forever (setBlock
    // refuses ungenerated chunks BEFORE recording the edit). Wait instead.
    if (!world.isGenerated(x >> 4, z >> 4) || !neighborsGenerated(x >> 4, z >> 4)) continue;
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

// --- meal-root crops: planted pips grow sprout -> greens -> ripe -------------
// Same clock as the saplings (growthSeconds), so rain halves the wait for a
// growing meal root too. The map holds only the stages still growing — a ripe
// root just stands there, patiently, until harvested.

const crops = new Map(); // "x,y,z" -> growthSeconds when the next stage lands

function registerCrop(x, y, z, delay = 45 + Math.random() * 30) {
  crops.set(`${x},${y},${z}`, growthSeconds + delay);
}

function updateCrops() {
  for (const [key, due] of crops) {
    if (growthSeconds < due) continue;
    const [x, y, z] = key.split(",").map(Number);
    // a crop in an ungenerated chunk waits (setBlock refuses those cells)
    if (!world.isGenerated(x >> 4, z >> 4)) continue;
    crops.delete(key);
    // the world block is the truth about the stage — a stale entry (the crop
    // was broken/overwritten while the timer ran) simply falls out here
    const stage = CROP_STAGES.indexOf(world.getBlock(x, y, z));
    if (stage === -1 || stage === CROP_STAGES.length - 1) continue;
    const next = CROP_STAGES[stage + 1];
    lightAwareRemesh(world.setBlock(x, y, z, next), false);
    if (next !== CROP_RIPE) registerCrop(x, y, z);
  }
}
// additive v2 field: [[x,y,z,stage,remain]...] — stage is written for
// forward-compat/validation, but the persisted world edit is what proves it
if (save && Array.isArray(save.crops)) {
  for (const c of save.crops) {
    if (!Array.isArray(c) || c.length !== 5) continue;
    const [x, y, z, stage, remain] = c;
    if ([x, y, z, stage].every(Number.isInteger) && Number.isFinite(remain)) {
      registerCrop(x, y, z, Math.max(1, Math.min(90, remain)));
    }
  }
}
if (save && save.edits) world.loadEdits(save.edits);

const sky = new Sky(scene, seed);
if (save && Number.isFinite(save.time)) sky.time = ((save.time % 1) + 1) % 1;
// additive v2 field: whole days lived (the Peddler's offer rotation) — older
// saves restart the calendar, which only re-deals the offer board
if (save && Number.isInteger(save.day) && save.day >= 0) sky.day = save.day;
// additive v2 field: [phase, secondsLeftInPhase, intensity] — validated, so a
// hand-edited save can't wedge the weather machine
if (save && Array.isArray(save.weather)) {
  const [phase, timer, rain] = save.weather;
  if ((phase === "clear" || phase === "rainy") && Number.isFinite(timer)) {
    sky.weatherPhase = phase;
    sky.weatherTimer = Math.max(1, Math.min(900, timer));
    if (Number.isFinite(rain)) sky.rain = Math.max(0, Math.min(1, rain));
  }
}
const rainFx = new Rain(scene, world);

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

// where death sends you back: the slept-in Moss Cot while it still stands,
// otherwise the world spawn. The cot may sit in an unloaded chunk, so
// ensureChunk first — generation re-applies the edit overlay, letting
// getBlock actually see (or miss) the bed.
function resolveRespawn() {
  const sp = player.spawnPoint;
  if (sp) {
    const bx = Math.floor(sp.x), by = Math.round(sp.y) - 1, bz = Math.floor(sp.z);
    world.ensureChunk(bx >> 4, bz >> 4);
    if (world.getBlock(bx, by, bz) === BED) return sp;
    player.spawnPoint = null; // the cot is gone — the Upturn forgets the nap
  }
  return spawnPoint;
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
    hud.closeAllWindows(); // defensively spill/close before switching rules
    player.mode = player.mode === "survival" ? "creative" : "survival";
    if (player.mode === "survival") {
      player.flying = false;
      player.resetFall(); // creative altitude must not become a survival fall
    }
    hud.refreshHotbarRow();
    return player.mode;
  },
  onRespawn: () => {
    player.respawn(resolveRespawn());
    adjustToClearGround(player.pos);
    player.resetFall();
    hud.hideDeath();
    requestLock();
  },
  onCraft: (recipe, max = false) => {
    let crafted = false;
    do {
      const leftover = craft(recipe, inventory); // -1 = missing inputs
      if (leftover < 0) break;
      crafted = true;
      if (leftover > 0) spillStack({ id: recipe.out[0], count: leftover });
    } while (max);
    if (crafted) sfx.craft();
  },
  onSpillCursor: (stack) => spillStack(stack),
  onSlotsChanged: () => { sfx.click(); drainOverflow(); },
  inventory,
  playerViewer: new PlayerViewer(document.getElementById("player-view"), 1337),
});
hud.setMovementLabel(player.moveMode);
hud.setSensitivity(player.sensitivity);
hud.setMode(player.mode);
if (save && Number.isInteger(save.selected) && save.selected >= 0 && save.selected < 9) {
  hud.select(save.selected);
}

// toss a stack out in front of the player (cursor spills, craft overflow)
function spillStack(stack) {
  const dir = player.lookDir();
  drops.spawn(
    player.pos.x + dir.x * 0.6, player.eyeY - 0.2, player.pos.z + dir.z * 0.6,
    stack.id, stack.count,
    { vel: { x: dir.x * 4, y: 2, z: dir.z * 4 }, pickupDelay: 1.2, dur: stack.dur });
}

player.onDamage = () => { hud.flashDamage(); sfx.hurt(); };
player.onDeath = (cause) => {
  hud.showDeath(cause);
  if (document.pointerLockElement) document.exitPointerLock();
};

// --- the Moss Cot: sleep through the night, wake anchored to the bed --------

const NIGHT_LIGHT = 0.35; // below this, the cot accepts guests
const DAWN_TIME = 0.02;   // sky.time just after the light starts rising
let sleeping = false;
const sleepFadeEl = document.getElementById("sleep-fade");

function sleepInCot(x, y, z) {
  if (sleeping || player.dead) return;
  if (sky.lightLevel >= NIGHT_LIGHT) {
    hud.announce("The cot disapproves of daytime napping.", 2600);
    return;
  }
  sleeping = true;
  // the cot remembers you from the first tuck-in, even if you die mid-fade
  player.spawnPoint = { x: x + 0.5, y: y + 1, z: z + 0.5 };
  sleepFadeEl.style.opacity = "1";
  setTimeout(() => {
    sky.time = DAWN_TIME; // no healing — just the morning
    sky.day++; // the nap always jumps the calendar past midnight
    sleepFadeEl.style.opacity = "0";
    hud.announce("You wake, well-tucked.", 2600);
    setTimeout(() => { sleeping = false; }, 1000); // let the fade-in finish
  }, 1050);
}

// the Dib-Pole's dib-float: one at a time, never persisted (see fishing.js
// for the documented no-save contract — reeling in is free, so a reload
// simply forgets an in-flight cast)
const fishing = new Fishing(scene, {
  onSpawnDrop: (x, y, z, id, qty, vel) =>
    drops.spawn(x, y, z, id, qty, { vel, pickupDelay: 0 }),
  onSound: (kind) => {
    if (kind === "cast") sfx.whip();
    else if (kind === "plip") sfx.plip();
    else sfx.splash();
  },
  onCue: (text) => hud.announce(text, 1500),
  poleSelected: () => hud.selectedId() === FISHING_POLE,
});

const interaction = new Interaction(world, player, scene, hud, {
  onEdit: (chunks, info) => {
    if (chunks.length === 0) return;
    const lightTouched = !!(info && info.ids &&
      info.ids.some((id) => id != null && BLOCKS[id].lightEmit > 0));
    lightAwareRemesh(chunks, lightTouched);
    // sapling lifecycle
    if (info) {
      if (info.placed === SAPLING) registerSapling(info.x, info.y, info.z);
      if (info.broken === SAPLING) saplings.delete(`${info.x},${info.y},${info.z}`);
      if (info.popped === SAPLING) saplings.delete(`${info.x},${info.y + 1},${info.z}`);
      // crop lifecycle: planting pips writes a sprout; breaking or popping
      // (soil dug out underneath) any growing stage cancels its timer
      if (info.placed === CROP_SPROUT) registerCrop(info.x, info.y, info.z);
      if (isCrop(info.broken)) crops.delete(`${info.x},${info.y},${info.z}`);
      if (isCrop(info.popped)) crops.delete(`${info.x},${info.y + 1},${info.z}`);
      // breaking a Notice Post takes its writing with it (the board mesh
      // follows on the next signBoards.sync)
      if (isSign(info.broken)) world.signs.delete(`${info.x},${info.y},${info.z}`);
      // breaking the slept-in Moss Cot unhooks the respawn anchor
      const sp = player.spawnPoint;
      if (info.broken === BED && sp &&
          info.x === Math.floor(sp.x) && info.y === Math.round(sp.y) - 1 &&
          info.z === Math.floor(sp.z)) {
        player.spawnPoint = null;
      }
    }
  },
  onSound: (kind, id) => sfx.block(kind, id),
  onEat: (kind) => sfx.eat(kind),
  onDoor: (opened) => sfx.door(opened),
  onPick: (id) => hud.pickBlock(id),
  onSwing: () => { swingT = 0; playerModel.swing(); },
  // placement consumes from the SELECTED HOTBAR SLOT only
  canConsume: (id) => {
    const s = inventory.get(hud.selected);
    if (!s || s.id !== id) return false;
    const ok = inventory.takeFromSlot(hud.selected, 1);
    if (ok) hud.refreshHotbarRow();
    return ok;
  },
  onSpawnDrop: (x, y, z, id) => drops.spawn(x, y, z, id),
  // one use off the held tool (a broken block, a landed hit). At 0 the tool
  // shatters: crack sound, a chip burst at the hands, and the slot empties.
  onToolUse: () => {
    if (player.mode !== "survival") return;
    const s = inventory.get(hud.selected);
    const def = s && BLOCKS[s.id];
    if (!def || !def.tool) return;
    const left = (Number.isInteger(s.dur) ? s.dur : def.tool.maxDur) - 1;
    if (left <= 0) {
      inventory.set(hud.selected, null);
      sfx.stoneCrack();
      const dir = player.lookDir();
      interaction.particles.burst(
        player.pos.x + dir.x * 0.8 - 0.5, player.eyeY - 0.9, player.pos.z + dir.z * 0.8 - 0.5,
        atlas.avgColor[def.tiles.side] || [0.6, 0.6, 0.6], 18);
      hud.announce(`The ${def.name} gives out.`, 2200);
    } else {
      s.dur = left;
    }
    hud.refreshHotbarRow();
  },
  onOpenChest: (x, y, z) => {
    const key = `${x},${y},${z}`;
    let store = world.chests.get(key);
    if (!store) { store = new Array(27).fill(null); world.chests.set(key, store); }
    hud.openChest(store, () => {});
  },
  onOpenBench: () => hud.openBench(),
  onSleep: (x, y, z) => sleepInCot(x, y, z),
  // right-click a Notice Post: the write window, primed with what's already
  // on the board. Commit stores the clamped text (empty = a wiped board);
  // signBoards.sync repaints on the next frame.
  onOpenSign: (x, y, z) => {
    const key = `${x},${y},${z}`;
    hud.openSign(world.signs.get(key) || "", (text) => {
      if (text) world.signs.set(key, text);
      else world.signs.delete(key);
    });
  },
  // a sling stone leaves the eye along the look ray (`stones` is a later
  // const, like `kegs` — these callbacks only fire at runtime)
  canThrow: () => stones.canThrow(),
  onThrow: () => {
    const dir = player.lookDir();
    stones.throw(
      player.pos.x + dir.x * 0.2, player.eyeY + dir.y * 0.2, player.pos.z + dir.z * 0.2,
      dir);
    sfx.whip();
  },
  // priming swaps the keg BLOCK for a primed keg ENTITY (see explosives.js);
  // `kegs` is a later const, but this callback only fires at runtime
  onPrimeKeg: (x, y, z) => {
    if (!kegs.canPrime()) return; // sixteen already hissing — the keg declines
    const affected = world.setBlock(x, y, z, AIR);
    if (affected.length === 0) return;
    lightAwareRemesh(affected, false);
    kegs.prime(x, y, z);
    sfx.kegTick();
  },
  onOpenKiln: (x, y, z) => {
    const key = `${x},${y},${z}`;
    let kiln = world.kilns.get(key);
    if (!kiln) { kiln = makeKiln(); world.kilns.set(key, kiln); }
    hud.openKiln(kiln);
  },
  onKilnBreak: (x, y, z) => {
    const key = `${x},${y},${z}`;
    const kiln = world.kilns.get(key);
    if (kiln) {
      for (const s of kiln.slots) {
        if (s) drops.spawn(x + 0.5, y + 0.6, z + 0.5, s.id, s.count, { dur: s.dur });
      }
      world.kilns.delete(key);
    }
    if (hud.kilnOpen) { hud.closeKiln(); requestLock(); }
  },
  onChestBreak: (x, y, z) => {
    const key = `${x},${y},${z}`;
    const store = world.chests.get(key);
    if (store) {
      for (const s of store) {
        if (s) drops.spawn(x + 0.5, y + 0.6, z + 0.5, s.id, s.count, { dur: s.dur });
      }
      world.chests.delete(key);
    }
    if (hud.chestOpen) { hud.closeChest(); requestLock(); }
  },
  mobs,
  boats,
  fishing,
  // right-click the Peddler: the trade window with the day's three offers —
  // unless he's still nursing the grudge from the last kick
  onTradeMob: (m) => {
    if (m.grudgeT > 0) {
      hud.announce("The Peddler pointedly rearranges his pack.", 2600);
      return;
    }
    hud.openTrade(dailyOffers(world.seed, sky.day), (offer) => {
      const leftover = executeTrade(offer, inventory); // -1 = can't pay
      if (leftover < 0) return false;
      if (leftover > 0) spillStack({ id: offer.get[0], count: leftover });
      sfx.peddlerHm(); // satisfied
      return true;
    });
  },
  // seat the Wanderling: player physics suspends itself while riding (see
  // player.update) and boats.update carries the seat from here on
  onBoardBoat: (b) => {
    player.riding = b;
    player.vel.x = player.vel.y = player.vel.z = 0;
    player.resetFall();
    player.sprinting = false;
  },
  // interact.js has already found the water column, checked headroom and the
  // cap, and consumed the item — just splash the hull down on the surface
  onDeployBoat: (x, topWaterY, z) => {
    // bow pointing away from the launcher; buoyancy settles the exact line
    boats.deploy(x + 0.5, topWaterY + 1 - 0.3, z + 0.5, player.yaw + Math.PI);
  },
  crackTextures: buildCrackTextures(1337),
  avgColor: atlas.avgColor,
});
const kegs = new PrimedKegs(scene, materials, {
  mobs,
  onRemesh: lightAwareRemesh, // the torch-aware path — a blast may eat one
  onSpawnDrop: (x, y, z, id, qty) => drops.spawn(x, y, z, id, qty),
  onTick: () => sfx.kegTick(),
  onBoom: (x, y, z) => {
    sfx.kegBoom();
    // a big two-tone burst: flying embers under a gray dust plume
    interaction.particles.burst(x - 0.5, y - 0.5, z - 0.5, [1.0, 0.62, 0.22], 70);
    interaction.particles.burst(x - 0.5, y - 0.5, z - 0.5, [0.34, 0.32, 0.3], 70);
  },
});

const stones = new SlingStones(scene, materials, {
  mobs,
  onSpawnDrop: (x, y, z, id) => drops.spawn(x, y, z, id),
  onImpact: (x, y, z, shattered) => {
    if (!shattered) return; // survivors just drop; only shatters crack + dust
    sfx.stoneCrack();
    interaction.particles.burst(x - 0.5, y - 0.5, z - 0.5,
      atlas.avgColor[BLOCKS[SLING_STONE].tiles.side] || [0.5, 0.5, 0.5], 6);
  },
});

// a falling crit lands with a sharper crack than the ordinary thud
mobs.onMobHurt = (crit) => (crit ? sfx.critHit() : sfx.mobHurt());
// sprint suppresses while chewing: the player asks interact for its state
player.isEating = () => interaction.eating;
mobs.onSound = (kind) => sfx.creature(kind);
mobs.onDrop = (x, y, z, id, n) => drops.spawn(x, y, z, id, n);

const stopAutosave = startAutosave(() => writeSave(world, player, sky, hud, inventory, {
  saplings: [...saplings].map(([key, due]) => {
    const [x, y, z] = key.split(",").map(Number);
    return [x, y, z, Math.max(1, due - growthSeconds)];
  }),
  crops: [...crops].map(([key, due]) => {
    const [x, y, z] = key.split(",").map(Number);
    const stage = Math.max(0, CROP_STAGES.indexOf(world.getBlock(x, y, z)));
    return [x, y, z, stage, Math.max(1, due - growthSeconds)];
  }),
  overflowStacks: pendingOverflow.map((s) =>
    (s.dur !== undefined ? [s.id, s.count, s.dur] : [s.id, s.count])),
  boats: boats.serialize(), // additive: deployed skiffs [[x,y,z,yaw]...]
  weather: [
    sky.weatherPhase,
    Math.round(sky.weatherTimer * 10) / 10,
    Math.round(sky.rain * 100) / 100,
  ],
}));

// --- held item (first-person hand) — its own scene + depth-cleared pass ------

const handScene = new THREE.Scene(); // fog/background stay null, always
const handCamera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 10);

const heldGroup = new THREE.Group();
heldGroup.frustumCulled = false;
handScene.add(heldGroup);

const heldBlock = new THREE.Mesh(undefined, materials.held);
heldBlock.frustumCulled = false;
heldBlock.scale.setScalar(0.32);
heldGroup.add(heldBlock);

// the bare foot-hand, shown when the selected survival slot is empty
const heldFoot = buildHeldFoot(1337);
heldFoot.visible = false;
heldFoot.scale.setScalar(0.75);
heldFoot.rotation.set(0.5, 0.35, 0.1); // toes forward, sole toward the world
heldFoot.traverse((o) => { o.frustumCulled = false; });
heldGroup.add(heldFoot);

// third-person body (visible only in third person)
const playerModel = new PlayerModel(1337);
playerModel.group.visible = false;
playerModel.group.rotation.order = "YXZ"; // yaw first, then the swim lean
scene.add(playerModel.group);
let thirdPerson = false;

function toggleThirdPerson() {
  thirdPerson = !thirdPerson;
  playerModel.group.visible = thirdPerson;
}

let heldKey = null;
let swingT = 1; // 0..1 swing animation progress (1 = at rest)

// box-built held tool models, one per tool id (12 at most), built on demand
const heldToolCache = new Map();
let heldToolGroup = null;

function refreshHeldMesh() {
  // slots are the truth: empty selected slot = bare foot, in both modes
  const st = inventory.get(hud.selected);
  const key = st ? st.id : "foot";
  if (key === heldKey) return;
  heldKey = key;
  const empty = key === "foot";
  const toolDef = empty ? null : BLOCKS[st.id].tool;
  if (heldToolGroup) { heldGroup.remove(heldToolGroup); heldToolGroup = null; }
  heldFoot.visible = empty;
  heldBlock.visible = !empty && !toolDef;
  if (toolDef) {
    // a tool in hand: its haft-and-head box model instead of the flat sprite
    let g = heldToolCache.get(st.id);
    if (!g) {
      g = buildHeldTool(toolDef.kind, toolDef.tier, 1337);
      g.scale.setScalar(0.85);
      // haft raked up-left with the head high, arms angled across the view
      g.rotation.order = "XZY";
      g.rotation.set(0.35, 1.2, 0.85);
      g.position.set(-0.02, 0.02, 0);
      g.traverse((o) => { o.frustumCulled = false; });
      heldToolCache.set(st.id, g);
    }
    heldToolGroup = g;
    heldGroup.add(g);
  } else if (!empty) {
    if (heldBlock.geometry) heldBlock.geometry.dispose();
    const geo = buildBlockGeometry(st.id);
    geo.translate(-0.5, -0.5, -0.5); // rotate around the block center
    heldBlock.geometry = geo;
  }
}

function animateHeld(frameDt, bobY) {
  refreshHeldMesh();
  swingT = Math.min(1, swingT + frameDt / 0.22);
  const s = Math.sin(Math.PI * swingT); // 0 -> 1 -> 0 dip
  heldGroup.position.set(0.42, -0.38 + bobY * 0.6 - s * 0.25, -0.65 - s * 0.1);
  heldGroup.rotation.set(0.18 - s * 1.4, -0.4 + s * 0.3, s * 0.12);
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
  hud.closeAllWindows(); // spills any held cursor stack
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
  ? !hud.paused && !hud.anyWindowOpen()
  : document.pointerLockElement === canvas;

document.addEventListener("pointerlockchange", () => {
  const locked = document.pointerLockElement === canvas;
  if (locked) {
    hud.hidePause();
    started = true;
  } else if (!NO_LOCK) {
    player.clearInput();
    interaction.clearInput();
    if (!hud.anyWindowOpen() && !hud.deathOpen) hud.showPause(!started);
  }
});

document.addEventListener("mousemove", (e) => {
  if (inputActive()) player.onMouseMove(e.movementX, e.movementY);
});

document.addEventListener("mousedown", (e) => {
  if (!inputActive() || hud.anyWindowOpen()) return;
  if (e.button === 1) e.preventDefault();
  interaction.onMouseDown(e.button);
});
document.addEventListener("mouseup", (e) => interaction.onMouseUp(e.button));
document.addEventListener("contextmenu", (e) => e.preventDefault());

let debugVisible = false;

document.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.code === "F3") { e.preventDefault(); debugVisible = !debugVisible; return; }
  if (e.code === "F5") { e.preventDefault(); toggleThirdPerson(); return; }
  if (e.code === "KeyE") {
    if (hud.signOpen) return; // the letter e belongs to the writing
    if (hud.anyWindowOpen()) { hud.closeAllWindows(); requestLock(); }
    else if (inputActive()) hud.openPicker();
    return;
  }
  if (e.code === "Escape" && hud.anyWindowOpen()) {
    hud.closeAllWindows();
    hud.showPause();
    return;
  }
  // Q tosses one item from the selected slot
  if (e.code === "KeyQ" && inputActive() && !hud.anyWindowOpen()) {
    const s = inventory.get(hud.selected);
    if (s && inventory.takeFromSlot(hud.selected, 1)) {
      spillStack({ id: s.id, count: 1 });
      hud.refreshHotbarRow();
    }
    return;
  }
  if (inputActive() && !hud.anyWindowOpen()) {
    if (e.code.startsWith("Digit")) {
      const n = Number(e.code.slice(5));
      if (n >= 1 && n <= 9) { hud.select(n - 1); sfx.click(); return; }
    }
    player.onKeyDown(e.code);
  }
});
document.addEventListener("keyup", (e) => player.onKeyUp(e.code));

document.addEventListener("wheel", (e) => {
  if (e.deltaY !== 0 && inputActive() && !hud.anyWindowOpen()) { hud.scroll(e.deltaY); sfx.click(); }
}, { passive: true });

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  handCamera.aspect = innerWidth / innerHeight;
  handCamera.updateProjectionMatrix();
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
  // clamped at 0: the first rAF timestamp can PRECEDE the boot-time clock
  // read that seeded `last`, and a negative dt must never run time backwards
  const frameDt = Math.max(0, Math.min(0.1, (now - last) / 1000));
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
    drops.update(frameDt, world, player, (id, qty, dur) => {
      const leftover = inventory.add(id, qty, dur);
      const accepted = qty - leftover;
      if (accepted > 0) {
        sfx.pickup();
        hud.refreshHotbarRow();
        if (hud.anyWindowOpen()) hud.slotUI.renderAll();
      }
      return accepted; // a full inventory keeps the rest on the ground
    });
    mobs.update(frameDt, { world, player, terrain, night: sky.lightLevel < 0.45 });
    boats.update(frameDt, world, player);
    kegs.update(frameDt, world, player);
    stones.update(frameDt, world);
    fishing.update(frameDt, world, player);
    worldSeconds += frameDt;
    growthSeconds += frameDt * (1 + sky.rain); // rain doubles sapling growth
    if (worldSeconds >= nextSaplingCheck) {
      nextSaplingCheck = worldSeconds + 1;
      updateSaplings();
      updateCrops();
      drainOverflow();
    }
  }
  mobs.setLight(sky.lightLevel, sky.lightTint);
  boats.setLight(sky.lightLevel, sky.lightTint);
  fishing.setLight(sky.lightLevel, sky.lightTint);
  signBoards.setLight(sky.lightLevel, sky.lightTint);
  signBoards.sync(); // boards follow chunk load/unload and sign edits

  // kilns burn whenever the game is up — including while a window is open
  // (the whole point: watch the smelt arrow fill). Paused = time stops.
  if (!hud.paused) {
    if (tickKilns(world.kilns, frameDt) && hud.kilnOpen) hud.slotUI.renderAll();
    hud.updateKilnView();
  }

  if (player.mode === "survival") {
    hud.setHealth(player.health);
    hud.setHunger(player.hunger);
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

  // third person: boom the camera back along the look ray, clamped by terrain
  if (thirdPerson) {
    const look = player.lookDir();
    const eye = { x: player.pos.x, y: player.eyeY, z: player.pos.z };
    const back = { x: -look.x, y: -look.y, z: -look.z };
    const hit = raycast(world, eye, back, 4);
    // never boom past the hit — a floor above hit.dist would put the camera
    // INSIDE the wall the raycast just found (x-ray view)
    const boom = hit ? Math.min(4, Math.max(0.05, hit.dist - 0.15)) : 4;
    camera.position.set(eye.x + back.x * boom, eye.y + back.y * boom, eye.z + back.z * boom);
  }
  // riding: a simple crouch offset sinks the model to the bench, and the
  // seated pose kicks the legs forward (chosen over a real sit rig — cheap)
  const seated = !!player.riding;
  playerModel.group.position.set(
    player.pos.x, player.pos.y - (seated ? 0.5 : 0), player.pos.z);
  playerModel.group.rotation.y = player.yaw + Math.PI;
  playerModel.update(frameDt, {
    speed: horizSpeed,
    swimming: player.inWater && !seated,
    seated,
  });

  // moving water: visible surface drift + a gentle vertex swell
  materials.water.uniforms.uUvOffset.value.set((now * 0.0003) % 1, (now * 0.00019) % 1);
  materials.water.uniforms.uTime.value = (now / 1000) % 4188.790204786391; // 2π/1.5 × 1000

  animateHeld(frameDt, bobY);

  // sprint FOV kick (+8°, applies to sprint-flight too): eased both ways
  // with a ~0.15s time constant, so it swells in and settles out
  const targetFov = player.sprintActive ? 78 : 70;
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, frameDt * 6.7);
    camera.updateProjectionMatrix();
  }

  interaction.update(frameDt);
  // the fishing line hangs from a camera-space rod-tip anchor — rewrite it
  // after the camera has settled for this frame (bob, third-person boom)
  fishing.updateLine(camera);
  // underwater fog/tint follow the RENDERING viewpoint: the boomed camera in
  // third person, the player's eye otherwise
  const viewInWater = thirdPerson
    ? world.getBlock(Math.floor(camera.position.x), Math.floor(camera.position.y),
        Math.floor(camera.position.z)) === WATER_ID
    : player.eyeInWater;
  sky.update(frameDt, camera, viewInWater);
  rainFx.update(frameDt, camera, sky.rain);
  // the rain bed is silent under cover, underground, and underwater — gated
  // on the same open-column test the streaks use, at the player's eye
  sfx.setRain(
    sky.rain > 0.001 && !player.eyeInWater &&
      rainFx.isOpen(player.pos.x, player.eyeY, player.pos.z)
      ? sky.rain : 0);
  setDayLight(materials, sky.lightLevel, sky.lightTint);
  setHeldSkinLight(sky.lightLevel, sky.lightTint);
  hud.setUnderwater(viewInWater);

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
      `time: ${clock()}${sky.rain > 0.01 ? ` [rain ${sky.rain.toFixed(2)}]` : ""}  ${player.flying ? "[flying]" : player.onGround ? "[ground]" : "[air]"}${player.inWater ? " [water]" : ""}  mode: ${player.mode}${player.mode === "survival" ? ` hp:${player.health.toFixed(0)} food:${player.hunger.toFixed(1)}` : ""}`,
      `target: ${interaction.target ? BLOCKS[interaction.target.id].name : "none"}`,
    ], true);
  } else {
    hud.updateDebug([], false);
  }

  renderer.info.reset();
  renderer.clear();
  renderer.render(scene, camera);
  if (!thirdPerson) {
    renderer.clearDepth();
    renderer.render(handScene, handCamera);
  }
}

requestAnimationFrame(tick);

// automated-test handle (only in ?nolock mode, which headless tests use)
if (NO_LOCK) {
  window.voxelcraft = {
    player, world, hud, sky, terrain, interaction, mobs, drops, saplings, crops,
    inventory, kegs, stones, boats, fishing, signBoards,
    rain: rainFx, sfx, camera,
    growAllSaplings: () => { for (const k of saplings.keys()) saplings.set(k, 0); },
    growAllCrops: () => { for (const k of crops.keys()) crops.set(k, 0); },
    getGrowthSeconds: () => growthSeconds,
    dailyOffers, // (seed, day) — lets tests diff the Peddler's rotation
  };
}
