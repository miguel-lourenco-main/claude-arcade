// A small dedicated renderer that shows the Wanderling in the Satchel window.
// Drag to spin (with inertia); lazily creates its GL context on first open and
// only runs its render loop while the window is open.

import * as THREE from "three";
import { PlayerModel } from "./player-model.js";

export class PlayerViewer {
  constructor(canvas, seed = 1337) {
    this.canvas = canvas;
    this.seed = seed;
    this.renderer = null;
    this.running = false;
    this.yaw = 0.4;
    this.spinVel = 0;
    this._dragging = false;
    this._lastX = 0;
    this._armor = null; // remembered until the lazy model exists
  }

  // dress the viewer model (same state shape as PlayerModel.setArmor); the
  // model is created lazily on first open, so remember the state until then
  setArmor(state) {
    this._armor = state;
    if (this.model) this.model.setArmor(state || {});
  }

  _init() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, alpha: true, antialias: true,
    });
    const w = this.canvas.clientWidth || 220;
    const h = this.canvas.clientHeight || 300;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);

    this.scene = new THREE.Scene(); // transparent — the panel shows through
    this.camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 20);
    this.camera.position.set(0, 1.05, 3.1);
    this.camera.lookAt(0, 0.95, 0);

    // deliberately fully lit — this is a UI element, not part of the world
    this.model = new PlayerModel(this.seed, { unlit: true });
    this.model.setPose("display");
    if (this._armor) this.model.setArmor(this._armor);
    this.scene.add(this.model.group);

    this.canvas.addEventListener("pointerdown", (e) => {
      this._dragging = true;
      this._lastX = e.clientX;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (!this._dragging) return;
      const dx = e.clientX - this._lastX;
      this._lastX = e.clientX;
      this.yaw += dx * 0.014;
      this.spinVel = dx * 0.6;
    });
    const stop = () => { this._dragging = false; };
    this.canvas.addEventListener("pointerup", stop);
    this.canvas.addEventListener("pointercancel", stop);
  }

  start() {
    if (!this.renderer) this._init();
    if (this.running) return;
    this.running = true;
    let last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!this._dragging) {
        // inertia decays toward a lazy idle spin
        this.spinVel += (0.5 - this.spinVel) * Math.min(1, dt * 1.2);
        this.yaw += this.spinVel * dt;
      }
      this.model.group.rotation.y = this.yaw;
      this.renderer.render(this.scene, this.camera);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
  }
}
