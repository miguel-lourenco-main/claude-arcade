// The Wanderling player model (see LORE.md): a box-model humanoid whose arms
// end in FOOT-shaped hands and whose legs end in HAND-shaped feet. All skin
// textures are procedural. Materials are unlit (MeshBasicMaterial) and tinted
// by the day/night cycle via setHeldSkinLight, like mobs.

import * as THREE from "three";
import { mulberry32 } from "./noise.js";

// palette (from the lore bible): bog-mint skin, rust tunic, mustard trim,
// charcoal trousers
const SKIN = [126, 200, 178];
const TUNIC = [188, 92, 48];
const TRIM = [214, 176, 74];
const TROUSER = [52, 56, 66];

function paintTexture(seed, base, decorate) {
  const canvas = document.createElement("canvas");
  canvas.width = 16; canvas.height = 16;
  const ctx = canvas.getContext("2d");
  const rand = mulberry32(seed);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = (rand() * 2 - 1) * 9;
    ctx.fillStyle = `rgb(${base[0] + d},${base[1] + d},${base[2] + d})`;
    ctx.fillRect(x, y, 1, 1);
  }
  if (decorate) decorate(ctx, rand);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeSkinTextures(seed = 0x5eed) {
  return {
    skin: paintTexture(seed ^ 1, SKIN),
    face: paintTexture(seed ^ 2, SKIN, (ctx) => {
      ctx.fillStyle = "#22262e";
      ctx.fillRect(4, 6, 2, 3); ctx.fillRect(10, 6, 2, 3); // earnest eyes
      ctx.fillStyle = "#3f6f60";
      ctx.fillRect(6, 11, 4, 1); // a small, determined mouth
    }),
    tunic: paintTexture(seed ^ 3, TUNIC, (ctx) => {
      ctx.fillStyle = `rgb(${TRIM[0]},${TRIM[1]},${TRIM[2]})`;
      ctx.fillRect(0, 13, 16, 1); // mustard hem
    }),
    trousers: paintTexture(seed ^ 4, TROUSER),
  };
}

// registry of every skin material we hand out, so the day/night tint reaches
// them all (the voxel-shader setDayLight path never sees these)
const skinMaterials = new Set();

function mat(tex) {
  const m = new THREE.MeshBasicMaterial({ map: tex, fog: false });
  skinMaterials.add(m);
  return m;
}

export function setHeldSkinLight(level, tint) {
  for (const m of skinMaterials) {
    m.color.copy(tint).multiplyScalar(Math.min(1, level + 0.15));
  }
}

function box(w, h, d, material) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
}

// a foot-shaped hand: ankle stub, flat sole, heel bump, toe caps
function footHand(skinMat) {
  const g = new THREE.Group();
  const sole = box(0.24, 0.1, 0.36, skinMat);
  sole.position.set(0, -0.05, -0.08);
  g.add(sole);
  const heel = box(0.16, 0.09, 0.1, skinMat);
  heel.position.set(0, -0.02, 0.13);
  g.add(heel);
  for (let i = 0; i < 3; i++) {
    const toe = box(0.062, 0.08, 0.09, skinMat);
    toe.position.set(-0.075 + i * 0.075, -0.05, -0.29);
    g.add(toe);
  }
  const bigToe = box(0.085, 0.09, 0.1, skinMat);
  bigToe.position.set(0.09, -0.045, -0.28);
  g.add(bigToe);
  return g;
}

// a hand-shaped foot: palm slab, four splayed fingers, sideways thumb
function handFoot(skinMat) {
  const g = new THREE.Group();
  const palm = box(0.26, 0.09, 0.24, skinMat);
  palm.position.set(0, -0.045, -0.04);
  g.add(palm);
  for (let i = 0; i < 4; i++) {
    const finger = box(0.05, 0.08, 0.15, skinMat);
    finger.position.set(-0.09 + i * 0.06, -0.045, -0.22);
    finger.rotation.y = (i - 1.5) * 0.12; // splay
    g.add(finger);
  }
  const thumb = box(0.05, 0.08, 0.12, skinMat);
  thumb.position.set(0.16, -0.045, 0.02);
  thumb.rotation.y = -0.9;
  g.add(thumb);
  return g;
}

export class PlayerModel {
  constructor(seed = 0x5eed) {
    const tex = makeSkinTextures(seed);
    const skinMat = mat(tex.skin);
    const tunicMat = mat(tex.tunic);
    const trouserMat = mat(tex.trousers);
    const faceMat = mat(tex.face);

    this.group = new THREE.Group();

    this.torso = box(0.5, 0.72, 0.26, tunicMat);
    this.torso.position.y = 1.02;
    this.group.add(this.torso);

    // head pivots at the neck; face on +z
    this.headPivot = new THREE.Group();
    this.headPivot.position.y = 1.38;
    const headMats = [mat(tex.skin), mat(tex.skin), mat(tex.skin), mat(tex.skin), faceMat, mat(tex.skin)];
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.46), headMats);
    head.position.y = 0.25;
    this.headPivot.add(head);
    this.group.add(this.headPivot);

    // arms pivot at the shoulders and end in foot-hands
    this.arms = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.34, 1.32, 0);
      const arm = box(0.18, 0.55, 0.18, tunicMat);
      arm.position.y = -0.28;
      pivot.add(arm);
      const foot = footHand(skinMat);
      foot.position.y = -0.58;
      pivot.add(foot);
      this.group.add(pivot);
      this.arms.push(pivot);
    }

    // legs pivot at the hips and end in hand-feet
    this.legs = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.13, 0.66, 0);
      const leg = box(0.2, 0.58, 0.2, trouserMat);
      leg.position.y = -0.3;
      pivot.add(leg);
      const hand = handFoot(skinMat);
      hand.position.y = -0.62;
      pivot.add(hand);
      this.group.add(pivot);
      this.legs.push(pivot);
    }

    this.phase = 0;
    this.swimLean = 0;
    this._swing = 1;
  }

  // punch/mine: kick the right arm forward
  swing() { this._swing = 0; }

  update(dt, { speed = 0, swimming = false } = {}) {
    this.phase += Math.max(speed, 0.6) * dt * 3.2;
    const walk = Math.min(1, speed / 2);
    const a = Math.sin(this.phase) * 0.7 * walk;

    this.arms[0].rotation.x = a;
    this.arms[1].rotation.x = -a;
    this.legs[0].rotation.x = -a;
    this.legs[1].rotation.x = a;

    // idle breathing
    if (walk < 0.1) {
      const b = Math.sin(this.phase * 0.5) * 0.04;
      this.arms[0].rotation.z = 0.06 + b;
      this.arms[1].rotation.z = -0.06 - b;
    } else {
      this.arms[0].rotation.z = 0;
      this.arms[1].rotation.z = 0;
    }

    // swing overrides the right arm
    this._swing = Math.min(1, this._swing + dt / 0.25);
    const s = Math.sin(Math.PI * this._swing);
    if (s > 0.01) this.arms[1].rotation.x = -s * 1.8;

    // swimming: lean the whole body toward horizontal while moving
    const targetLean = swimming && speed > 0.5 ? 1 : 0;
    this.swimLean += (targetLean - this.swimLean) * Math.min(1, dt * 6);
    this.group.rotation.x = this.swimLean * -1.25;
  }

  setPose(pose) {
    if (pose === "display") {
      this.phase = 0;
      this.swimLean = 0;
      this.group.rotation.x = 0;
      for (const p of [...this.arms, ...this.legs]) { p.rotation.x = 0; p.rotation.z = 0; }
      this.arms[0].rotation.z = 0.1;
      this.arms[1].rotation.z = -0.1;
      this.headPivot.rotation.x = -0.05; // chin slightly up, proud of the feet
    }
  }
}

// the bare "hand" held item — which, per the lore, is a foot. You kick blocks.
export function buildHeldFoot(seed = 0x5eed) {
  const tex = makeSkinTextures(seed);
  const g = footHand(mat(tex.skin));
  const wrist = box(0.15, 0.22, 0.15, mat(tex.tunic));
  wrist.position.set(0, 0.13, 0.06);
  g.add(wrist);
  return g;
}
