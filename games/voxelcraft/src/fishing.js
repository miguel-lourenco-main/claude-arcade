// Fishing: the Dib-Pole and its dib-float. Casting arcs the little float
// off the rod tip (the sling-stone idiom: substepped point physics); if it
// comes down on WATER it rides the surface line and waits. After a random
// 5-18 seconds something dibs the line — the float pulls under, a plip
// sounds, a quiet caption cues (no screen shake; danger here is polite) —
// and a right-click inside the 1.5s window hauls the catch out, flying at
// the player. Landed anywhere else it just sits there; nothing bites dirt.
// A thin line runs from a camera-space rod-tip anchor (bottom-right of the
// view, projected to world every frame) down to the float.
//
// One float at a time; switching hotbar slots off the pole or wandering
// more than 24 blocks from the float reels it in automatically.
//
// PERSISTENCE: an in-flight float is deliberately NOT saved. Reeling in is
// free (the cast consumes nothing), so a reload simply forgets the cast —
// no save field, nothing to validate, v2 saves untouched.

import * as THREE from "three";
import { BLOCKS, SILVERFIN, BERRIES, SLING_STONE, WATER } from "./blocks.js";
import { HEIGHT } from "./world.js";

const CAST_SPEED = 13;     // blocks/second off the rod tip
const CAST_LOFT = 2;       // extra upward kick so a level cast still arcs
const GRAVITY = 22;        // same pull as the sling stones
const FLOAT_DRAFT = 0.12;  // how deep the float sits below the surface line
const BITE_MIN = 5;        // seconds of waiting before a bite, at least...
const BITE_MAX = 18;       // ...and at most
const BITE_WINDOW = 1.5;   // seconds to answer the dip
const MAX_LINE = 24;       // blocks of line before it auto-reels
const MAX_FLIGHT = 8;      // seconds a cast may fly before giving up
const FISH_CHANCE = 0.85;  // the rest comes from the junk table

export class Fishing {
  constructor(scene, opts) {
    this.scene = scene;
    this.onSpawnDrop = opts.onSpawnDrop;   // (x, y, z, id, qty, vel)
    this.onSound = opts.onSound;           // ("cast" | "splash" | "plip")
    this.onCue = opts.onCue;               // (text) => quiet screen caption
    this.poleSelected = opts.poleSelected; // () => bool (auto-reel on switch)
    this.bobber = null; // the one float, or null

    // the dib-float mesh: a rust-orange cap over a pale cork belly on a
    // little stem (Wanderling colors — see LORE.md); built once, reused
    this._materials = []; // [{ m, base }] for the day/night tint
    this.float = this._buildFloat();
    this.float.visible = false;
    scene.add(this.float);

    // the line: two world-space points, rewritten every frame
    this._linePos = new Float32Array(6);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.BufferAttribute(this._linePos, 3));
    this.line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({
      color: 0x2b2b30, transparent: true, opacity: 0.85,
    }));
    this.line.frustumCulled = false;
    this.line.visible = false;
    scene.add(this.line);

    this._tip = new THREE.Vector3(); // scratch for the rod-tip projection
  }

  get active() { return this.bobber !== null; }

  _buildFloat() {
    const g = new THREE.Group();
    const box = (w, h, color) => {
      const base = new THREE.Color(color);
      const m = new THREE.MeshBasicMaterial({ color: base.clone() });
      this._materials.push({ m, base });
      return new THREE.Mesh(new THREE.BoxGeometry(w, h, w), m);
    };
    const belly = box(0.16, 0.11, 0xe2d6ba); // pale cork
    const cap = box(0.14, 0.09, 0xc45426);   // rust-orange cap
    cap.position.y = 0.1;
    const stem = box(0.04, 0.1, 0x8a6a3a);   // the line seat
    stem.position.y = 0.19;
    g.add(belly, cap, stem);
    g.traverse((o) => { o.frustumCulled = false; });
    return g;
  }

  // day/night tint, the boats/mobs idiom — base color times sky tint
  setLight(level, tint) {
    for (const { m, base } of this._materials) {
      m.color.copy(base).multiply(tint).multiplyScalar(Math.min(1, level + 0.15));
    }
  }

  // launch the float from the rod along dir (a unit vector)
  cast(x, y, z, dir) {
    if (this.bobber) return false;
    this.bobber = {
      x, y, z,
      vx: dir.x * CAST_SPEED,
      vy: dir.y * CAST_SPEED + CAST_LOFT,
      vz: dir.z * CAST_SPEED,
      phase: "flying", // "flying" | "floating" | "biting" | "grounded"
      age: 0,
      restY: 0,          // the surface line a floating float eases onto
      biteAt: Infinity,  // age when the next bite lands (floating only)
      biteLeft: 0,       // seconds left in the answer window (biting only)
    };
    this.float.visible = true;
    this.line.visible = true;
    this.float.position.set(x, y, z);
    if (this.onSound) this.onSound("cast");
    return true;
  }

  // right-click with a float out: the catch if something is dibbing,
  // otherwise just wind the line back in
  reel(player) {
    const b = this.bobber;
    if (!b) return;
    if (b.phase === "biting") {
      // mostly a Silverfin; sometimes the marsh's junk drawer
      let id = SILVERFIN, qty = 1;
      if (Math.random() >= FISH_CHANCE) {
        if (Math.random() < 0.5) { id = BERRIES; qty = Math.random() < 0.5 ? 2 : 1; }
        else { id = SLING_STONE; }
      }
      // the catch flies at the player: aimed at the chest, lofted to arc,
      // faster the longer the line (hunger is untouched — fishing is free)
      const dx = player.pos.x - b.x, dy = player.pos.y + 1 - b.y, dz = player.pos.z - b.z;
      const dist = Math.max(1, Math.hypot(dx, dy, dz));
      const v = 4.5 + dist * 0.55;
      this.onSpawnDrop(b.x, b.y + 0.2, b.z, id, qty,
        { x: (dx / dist) * v, y: (dy / dist) * v + 3, z: (dz / dist) * v });
      if (this.onSound) this.onSound("splash");
    }
    this._remove();
  }

  // test hook: land the pending bite on the next update tick
  forceBite() {
    if (this.bobber && this.bobber.phase === "floating") this.bobber.biteAt = this.bobber.age;
  }

  update(dt, world, player) {
    const b = this.bobber;
    if (!b) return;
    // auto-reel: the pole left the foot-hand, the line ran out, or death
    const lineLen = Math.hypot(player.pos.x - b.x, player.pos.y - b.y, player.pos.z - b.z);
    if (player.dead || lineLen > MAX_LINE ||
        (this.poleSelected && !this.poleSelected())) {
      this._remove();
      return;
    }
    // frozen while its chunk is missing — same contract as the item drops
    if (!world.isGenerated(Math.floor(b.x) >> 4, Math.floor(b.z) >> 4)) return;
    b.age += dt;

    if (b.phase === "flying") {
      if (b.age > MAX_FLIGHT || b.y < -40) { this._remove(); return; }
      b.vy = Math.max(-40, b.vy - GRAVITY * dt);
      // substepped flight so a full-speed cast never tunnels a wall
      const maxDisp = Math.max(Math.abs(b.vx), Math.abs(b.vy), Math.abs(b.vz)) * dt;
      const steps = Math.max(1, Math.ceil(maxDisp / 0.25));
      const sdt = dt / steps;
      for (let s = 0; s < steps; s++) {
        const px = b.x, py = b.y, pz = b.z;
        b.x += b.vx * sdt; b.y += b.vy * sdt; b.z += b.vz * sdt;
        if (world.getBlock(Math.floor(b.x), Math.floor(b.y), Math.floor(b.z)) === WATER) {
          this._touchdown(world, b);
          break;
        }
        if (this._solidAt(world, b.x, b.y, b.z)) {
          const def = BLOCKS[world.getBlock(Math.floor(b.x), Math.floor(b.y), Math.floor(b.z))];
          const top = Math.floor(b.y) + def.colHeight;
          if (b.vy <= 0 && py >= top - 0.001) {
            // fell in from above: a floor strike — settle on the block's real
            // top and just sit there (nothing bites dirt)
            b.x = px; b.z = pz; b.y = top + 0.02;
            b.phase = "grounded";
            b.vx = b.vy = b.vz = 0;
          } else {
            // a wall (or ceiling) strike: back out to the last clear spot,
            // kill the horizontal flight, and drop straight down
            b.x = px; b.y = py; b.z = pz;
            b.vx = 0; b.vz = 0;
          }
          break;
        }
      }
    } else if (b.phase === "floating") {
      // ease onto the surface line and wait for the water to take interest
      b.y += (b.restY - b.y) * Math.min(1, 8 * dt);
      if (b.age >= b.biteAt) {
        b.phase = "biting";
        b.biteLeft = BITE_WINDOW;
        if (this.onSound) this.onSound("plip");
        if (this.onCue) this.onCue("Something dibs the line!");
      }
    } else if (b.phase === "biting") {
      // the dip: the float pulls under while the answer window runs
      b.y += (b.restY - 0.3 - b.y) * Math.min(1, 10 * dt);
      b.biteLeft -= dt;
      if (b.biteLeft <= 0) {
        // missed — the float resettles and something below loses interest
        b.phase = "floating";
        b.biteAt = b.age + BITE_MIN + Math.random() * (BITE_MAX - BITE_MIN);
      }
    }
    // "grounded" does nothing: it just sits there, being politely ignored

    // presentation: a tumble in flight, a gentle bob afloat
    const bob = b.phase === "floating" ? Math.sin(b.age * 2.2) * 0.03 : 0;
    this.float.position.set(b.x, b.y + bob, b.z);
    this.float.rotation.y = b.phase === "flying" ? b.age * 6 : Math.sin(b.age * 0.8) * 0.3;
  }

  // the float has come down on water: ride the TOP of this water column
  _touchdown(world, b) {
    const bx = Math.floor(b.x), bz = Math.floor(b.z);
    let cy = Math.floor(b.y);
    while (cy + 1 < HEIGHT && world.getBlock(bx, cy + 1, bz) === WATER) cy++;
    b.restY = cy + 1 - FLOAT_DRAFT;
    b.phase = "floating";
    b.vx = b.vy = b.vz = 0;
    b.biteAt = b.age + BITE_MIN + Math.random() * (BITE_MAX - BITE_MIN);
    if (this.onSound) this.onSound("splash");
  }

  // point-in-solid, honoring partial heights (the sling-stone test)
  _solidAt(world, x, y, z) {
    const def = BLOCKS[world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))];
    return def.solid && y < Math.floor(y) + def.colHeight;
  }

  // rewrite the line every frame: rod tip (a camera-space anchor at the
  // bottom-right of the view, projected to world) down to the float's stem
  updateLine(camera) {
    if (!this.bobber) return;
    camera.updateMatrixWorld();
    this._tip.set(0.42, -0.34, -0.7).applyMatrix4(camera.matrixWorld);
    this._linePos[0] = this._tip.x;
    this._linePos[1] = this._tip.y;
    this._linePos[2] = this._tip.z;
    this._linePos[3] = this.float.position.x;
    this._linePos[4] = this.float.position.y + 0.22;
    this._linePos[5] = this.float.position.z;
    this.line.geometry.attributes.position.needsUpdate = true;
  }

  _remove() {
    this.bobber = null;
    this.float.visible = false;
    this.line.visible = false;
  }
}
