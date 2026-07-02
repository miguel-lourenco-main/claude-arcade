// Rain: the drained-ocean sky wrings itself out (LORE.md — what's up there
// used to be seabed, and sometimes it remembers). ~600 recycled line streaks
// falling in a cylinder around the camera.
//
// Indoors/underground test — the cheap column-top approach: per streak COLUMN
// we scan for the highest non-air block (world.getBlock, cached in a Map that
// is wiped every few seconds while raining). A streak only renders if its
// column is open at the camera's level, i.e. the column top sits at or below
// the camera. Under a roof the roofed columns hide their streaks while the
// doorway still shows rain outside; deep underground every nearby column tops
// out far above the camera, so nothing renders at all.

import * as THREE from "three";
import { HEIGHT } from "./world.js";
import { AIR } from "./blocks.js";

const COUNT = 600;
const RADIUS = 15;      // cylinder radius around the camera
const FALL_SPEED = 21;  // blocks/s straight down
const STREAK = 0.9;     // visible streak length
const HIDDEN_Y = -64;   // parking spot for streaks in roofed columns
// the snow variant (the Rimelands under the same shower): the streaks fall
// slow and short — flakes, not lances — pale, drifting a little as they go
const SNOW_FALL_SPEED = 5.5;
const SNOW_STREAK = 0.22;
const SNOW_DRIFT_X = 0.7;    // gentle sideways waft (blocks/s, sinusoidal)
const RAIN_COLOR = 0xaebfce;
const SNOW_COLOR = 0xeef4fb;

export class Rain {
  constructor(scene, world) {
    this.world = world;
    this.visibleCount = 0; // streaks actually drawn this frame (test hook)
    this.mode = "rain";    // "rain" | "snow" — which precip the layer renders
    this._t = 0;           // clock for the snow waft

    this._pos = new Float32Array(COUNT * 6);
    this._pos.fill(HIDDEN_Y); // park everything until the first shower
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this._pos, 3));
    this.mesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: RAIN_COLOR, transparent: true, opacity: 0, depthWrite: false,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);

    this._drops = [];
    for (let i = 0; i < COUNT; i++) {
      this._drops.push({ x: 0, y: HIDDEN_Y, z: 0, top: HEIGHT });
    }
    this._tops = new Map(); // "x,z" -> column-top y (0 = open to bedrock)
    this._topsAge = 0;
  }

  // highest non-air block top of the column, cached while raining.
  // Ungenerated columns read as fully open (AIR), which is fine: the rain
  // cylinder sits well inside the meshed radius.
  _columnTop(bx, bz) {
    const key = bx + "," + bz;
    let top = this._tops.get(key);
    if (top === undefined) {
      top = 0;
      for (let y = HEIGHT - 1; y >= 0; y--) {
        if (this.world.getBlock(bx, y, bz) !== AIR) { top = y + 1; break; }
      }
      this._tops.set(key, top);
    }
    return top;
  }

  // is the sky open above eye height y in this column? (audio gate reuses
  // the same cache the streaks do)
  isOpen(x, y, z) {
    return this._columnTop(Math.floor(x), Math.floor(z)) <= y + 1.6;
  }

  _recycle(d, camera) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * RADIUS;
    d.x = camera.position.x + Math.cos(a) * r;
    d.z = camera.position.z + Math.sin(a) * r;
    // random height in the band above the camera — staggered respawns keep
    // the sheet from falling in synchronized waves
    d.y = camera.position.y + 4 + Math.random() * 24;
    d.top = this._columnTop(Math.floor(d.x), Math.floor(d.z));
  }

  // mode: "rain" | "snow" — main.js passes "snow" while the player stands in
  // the cold biome, and the same precip layer switches sprite/speed/color
  update(dt, camera, intensity, mode = "rain") {
    if (mode !== this.mode) {
      this.mode = mode;
      this.mesh.material.color.setHex(mode === "snow" ? SNOW_COLOR : RAIN_COLOR);
    }
    const snow = this.mode === "snow";
    this._t += dt;
    const active = intensity > 0.01;
    this.mesh.visible = active;
    if (!active) {
      if (this.visibleCount > 0 || this._tops.size > 0) {
        this.visibleCount = 0;
        this._tops.clear();
        this._topsAge = 0;
      }
      return;
    }

    // edits and travel invalidate column tops — wipe the cache on a timer
    this._topsAge += dt;
    if (this._topsAge > 3 || this._tops.size > 6000) {
      this._tops.clear();
      this._topsAge = 0;
    }

    this.mesh.material.opacity = (snow ? 0.6 : 0.45) * intensity;
    const camY = camera.position.y;
    const pos = this._pos;
    const fall = snow ? SNOW_FALL_SPEED : FALL_SPEED;
    const streak = snow ? SNOW_STREAK : STREAK;
    let visible = 0;
    for (let i = 0; i < COUNT; i++) {
      const d = this._drops[i];
      d.y -= fall * dt;
      // flakes waft: a slow per-flake sway instead of a plumb-line drop
      if (snow) d.x += Math.sin(this._t * 1.3 + i * 1.7) * SNOW_DRIFT_X * dt;
      const dx = d.x - camera.position.x, dz = d.z - camera.position.z;
      if (d.y <= d.top || dx * dx + dz * dz > RADIUS * RADIUS * 1.8) {
        this._recycle(d, camera);
      }
      const o = i * 6;
      if (d.top > camY + 1.6) {
        // roofed at the camera's level: park the segment (degenerate line)
        pos[o] = pos[o + 3] = d.x;
        pos[o + 1] = pos[o + 4] = HIDDEN_Y;
        pos[o + 2] = pos[o + 5] = d.z;
        continue;
      }
      visible++;
      pos[o] = d.x; pos[o + 1] = d.y; pos[o + 2] = d.z;
      pos[o + 3] = d.x; pos[o + 4] = d.y + streak; pos[o + 5] = d.z;
    }
    this.visibleCount = visible;
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
}
