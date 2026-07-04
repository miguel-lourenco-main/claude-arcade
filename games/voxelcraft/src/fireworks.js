// Festival Rockets: the ascent and the burst (see LORE.md). A Wanderling
// looses one on Fairday to "give the old sky a pearl back" — it rises about a
// second on a spark of fuse, then blooms into an original procedural bloom of
// coloured points. Three bloom shapes (sphere puff / ring / willow droop) and
// the colour follows the winding agent. Every mote here is transient — nothing
// is a world block, so nothing saves; a fresh world simply has an empty sky.
//
// The burst is emissive: additive point sprites plus a brief flash sprite read
// as a light flash cleanly, without reaching into the chunk shader's block-
// light (a proper spatial light bump would want per-chunk uniform plumbing the
// bloom doesn't earn). onBurst hands the boom + the passive-mob spook back to
// main.js — the module keeps only the visuals.

import * as THREE from "three";
import { BLOCKS } from "./blocks.js";

const MAX_ROCKETS = 12;   // ascending at once (a launch cap)
const RISE_SPEED = 9.5;   // blocks/second up the fuse
const FUSE = 1.0;         // seconds of ascent before the burst
const TRAIL_EVERY = 0.045;// seconds between trail sparks on the ascent

export class Fireworks {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.rockets = [];  // ascending sprites
    this.bursts = [];   // exploded point clouds
    this.flashes = [];  // brief burst-flash sprites
    this.sparks = [];   // short-lived ascent trail sprites
    this.onBurst = opts.onBurst; // (x, y, z, color, shape) => sfx + mob spook
    this.lastBurst = null;       // {x, y, z, color, shape} — test hook

    this._sparkTex = this._makeSparkTexture();
    this._flashTex = this._makeFlashTexture();
    this._v = new THREE.Vector3();
  }

  // a soft round mote: white-hot core fading to nothing (tinted by the material)
  _makeSparkTexture() {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.75)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    const t = new THREE.CanvasTexture(c);
    t.minFilter = THREE.LinearFilter;
    return t;
  }

  _makeFlashTexture() {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.minFilter = THREE.LinearFilter;
    return t;
  }

  canLaunch() { return this.rockets.length < MAX_ROCKETS; }

  // send one up from (x, y, z). color is a hex tint, shape one of the three
  // bloom kinds. Returns false at the launch cap (caller keeps the rocket).
  launch(x, y, z, color, shape) {
    if (!this.canLaunch()) return false;
    const mat = new THREE.SpriteMaterial({
      map: this._sparkTex, color, blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false, fog: true,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.4, 0.7, 1); // a thin upright spark
    sprite.position.set(x, y, z);
    sprite.frustumCulled = false;
    this.scene.add(sprite);
    this.rockets.push({ sprite, mat, x, y, z, age: 0, trailT: 0, color, shape });
    return true;
  }

  // a short-lived ember shed on the ascent
  _trailSpark(x, y, z, color) {
    if (this.sparks.length > 120) return;
    const mat = new THREE.SpriteMaterial({
      map: this._sparkTex, color, blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false, fog: true, opacity: 0.9,
    });
    const s = new THREE.Sprite(mat);
    s.scale.setScalar(0.22);
    s.position.set(x + (Math.random() - 0.5) * 0.1, y, z + (Math.random() - 0.5) * 0.1);
    s.frustumCulled = false;
    this.scene.add(s);
    this.sparks.push({ sprite: s, mat, age: 0, life: 0.35 });
  }

  // the bloom: a cloud of coloured motes flung from (x, y, z) in the shape's
  // pattern, plus a brief flash. Fires onBurst for the boom + the mob spook.
  burst(x, y, z, color, shape) {
    const col = new THREE.Color(color);
    const willow = shape === "willow";
    const ring = shape === "ring";
    const N = ring ? 64 : willow ? 70 : 90;
    const pos = new Float32Array(N * 3);
    const vel = new Float32Array(N * 3);

    // a random plane basis, for the ring
    let t1x = 1, t1y = 0, t1z = 0, t2x = 0, t2y = 0, t2z = 1;
    if (ring) {
      const nx = Math.random() * 2 - 1, ny = Math.random() * 2 - 1, nz = Math.random() * 2 - 1;
      const nl = Math.hypot(nx, ny, nz) || 1;
      const ux = nx / nl, uy = ny / nl, uz = nz / nl;
      // t1 = normalize(n × worldUp); fall back if near-parallel
      let ax = uy * 0 - uz * 1, ay = uz * 0 - ux * 0, az = ux * 1 - uy * 0;
      if (Math.hypot(ax, ay, az) < 0.05) { ax = 1; ay = 0; az = 0; }
      const al = Math.hypot(ax, ay, az) || 1;
      t1x = ax / al; t1y = ay / al; t1z = az / al;
      // t2 = n × t1
      t2x = uy * t1z - uz * t1y;
      t2y = uz * t1x - ux * t1z;
      t2z = ux * t1y - uy * t1x;
    }

    for (let i = 0; i < N; i++) {
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      let vx, vy, vz;
      if (ring) {
        const a = (Math.PI * 2 * i) / N;
        const sp = 6.5 + Math.random() * 1.2;
        const ca = Math.cos(a) * sp, sa = Math.sin(a) * sp;
        vx = t1x * ca + t2x * sa;
        vy = t1y * ca + t2y * sa;
        vz = t1z * ca + t2z * sa;
      } else if (willow) {
        // an upward fountain that droops heavily — a slow, long-lived weep
        const a = Math.random() * Math.PI * 2;
        const el = 0.55 + Math.random() * 0.9; // biased upward
        const sp = 3.5 + Math.random() * 3;
        const horiz = Math.cos(el) * sp;
        vx = Math.cos(a) * horiz;
        vz = Math.sin(a) * horiz;
        vy = Math.sin(el) * sp + 2;
      } else {
        // an even sphere puff (uniform directions)
        const u = Math.random() * 2 - 1;
        const th = Math.random() * Math.PI * 2;
        const r = Math.sqrt(1 - u * u);
        const sp = 6 + Math.random() * 3.5;
        vx = r * Math.cos(th) * sp;
        vy = u * sp;
        vz = r * Math.sin(th) * sp;
      }
      vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      size: willow ? 0.3 : 0.34, map: this._sparkTex, color: col,
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
      sizeAttenuation: true, fog: true,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.scene.add(points);
    this.bursts.push({
      points, geo, mat, vel, pos, age: 0,
      life: willow ? 2.4 : ring ? 1.5 : 1.4,
      gravity: willow ? 7.5 : 4.5,
      drag: ring ? 2.6 : willow ? 1.4 : 2.2,
    });

    // the flash: a quick bright bloom, tinted toward white from the burst hue
    const flashCol = col.clone().lerp(new THREE.Color(0xffffff), 0.6);
    const fmat = new THREE.SpriteMaterial({
      map: this._flashTex, color: flashCol, blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false, fog: false, opacity: 0.9,
    });
    const flash = new THREE.Sprite(fmat);
    flash.scale.setScalar(2);
    flash.position.set(x, y, z);
    flash.frustumCulled = false;
    this.scene.add(flash);
    this.flashes.push({ sprite: flash, mat: fmat, age: 0, life: 0.32 });

    this.lastBurst = { x, y, z, color, shape };
    if (this.onBurst) this.onBurst(x, y, z, color, shape);
  }

  _solidAbove(world, x, y, z) {
    const id = world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
    return BLOCKS[id] !== undefined && BLOCKS[id].solid;
  }

  update(dt, world) {
    // ascending rockets
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.age += dt;
      r.y += RISE_SPEED * dt;
      r.sprite.position.set(r.x, r.y, r.z);
      // a faint flicker so the ascent reads as "sparking"
      r.mat.opacity = 0.75 + 0.25 * Math.random();
      r.trailT += dt;
      if (r.trailT >= TRAIL_EVERY) {
        r.trailT -= TRAIL_EVERY;
        this._trailSpark(r.x, r.y - 0.35, r.z, r.color);
      }
      // burst at fuse-out, or early if it noses into a ceiling
      if (r.age >= FUSE || (world && this._solidAbove(world, r.x, r.y + 0.4, r.z))) {
        this.scene.remove(r.sprite);
        r.mat.dispose();
        this.rockets.splice(i, 1);
        this.burst(r.x, r.y, r.z, r.color, r.shape);
      }
    }

    // burst clouds: integrate with drag + gravity, fade out over life
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.age += dt;
      if (b.age >= b.life) {
        this.scene.remove(b.points);
        b.geo.dispose(); b.mat.dispose();
        this.bursts.splice(i, 1);
        continue;
      }
      const dragF = Math.max(0, 1 - b.drag * dt);
      const n = b.pos.length / 3;
      for (let k = 0; k < n; k++) {
        b.vel[k * 3] *= dragF;
        b.vel[k * 3 + 1] = b.vel[k * 3 + 1] * dragF - b.gravity * dt;
        b.vel[k * 3 + 2] *= dragF;
        b.pos[k * 3] += b.vel[k * 3] * dt;
        b.pos[k * 3 + 1] += b.vel[k * 3 + 1] * dt;
        b.pos[k * 3 + 2] += b.vel[k * 3 + 2] * dt;
      }
      b.geo.attributes.position.needsUpdate = true;
      const f = b.age / b.life;
      b.mat.opacity = (1 - f) * (1 - f); // ease out
    }

    // the flashes: a quick fade
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.age += dt;
      if (f.age >= f.life) {
        this.scene.remove(f.sprite);
        f.mat.dispose();
        this.flashes.splice(i, 1);
        continue;
      }
      const t = f.age / f.life;
      f.sprite.scale.setScalar(2 + t * 4);
      f.mat.opacity = 0.9 * (1 - t);
    }

    // the ascent trail sparks
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.age += dt;
      if (s.age >= s.life) {
        this.scene.remove(s.sprite);
        s.mat.dispose();
        this.sparks.splice(i, 1);
        continue;
      }
      s.mat.opacity = 0.9 * (1 - s.age / s.life);
    }
  }

  clear() {
    for (const r of this.rockets) { this.scene.remove(r.sprite); r.mat.dispose(); }
    for (const b of this.bursts) { this.scene.remove(b.points); b.geo.dispose(); b.mat.dispose(); }
    for (const f of this.flashes) { this.scene.remove(f.sprite); f.mat.dispose(); }
    for (const s of this.sparks) { this.scene.remove(s.sprite); s.mat.dispose(); }
    this.rockets.length = 0; this.bursts.length = 0;
    this.flashes.length = 0; this.sparks.length = 0;
  }
}
