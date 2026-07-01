// Sky: day/night cycle driving sun/moon lights, sky+fog color, stars, clouds.

import * as THREE from "three";
import { mulberry32 } from "./noise.js";

export const DAY_LENGTH = 600; // seconds per full cycle

const DAY_SKY = new THREE.Color(0x87ceeb);
const NIGHT_SKY = new THREE.Color(0x0a0e1c);
const DUSK = new THREE.Color(0xff9a4a);
const WATER_FOG = new THREE.Color(0x1a4b8c);

function smoothstep(a, b, t) {
  t = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export class Sky {
  constructor(scene, seed) {
    this.scene = scene;
    this.time = 0.3; // fraction of a day; 0.25 = noon-ish start

    this.ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(0xfff4e0, 0.9);
    scene.add(this.sun);
    this.moon = new THREE.DirectionalLight(0xbdd0ff, 0.12);
    scene.add(this.moon);

    // celestial rig follows the camera so bodies stay on the horizon
    this.rig = new THREE.Group();
    scene.add(this.rig);

    const sunGeo = new THREE.PlaneGeometry(26, 26);
    this.sunMesh = new THREE.Mesh(sunGeo, new THREE.MeshBasicMaterial({
      color: 0xffe680, fog: false, side: THREE.DoubleSide,
    }));
    this.rig.add(this.sunMesh);

    this.moonMesh = new THREE.Mesh(new THREE.PlaneGeometry(18, 18), new THREE.MeshBasicMaterial({
      color: 0xdde4f0, fog: false, side: THREE.DoubleSide,
    }));
    this.rig.add(this.moonMesh);

    this.stars = this._makeStars(seed);
    this.rig.add(this.stars);

    this.clouds = this._makeClouds(seed);
    scene.add(this.clouds);

    this.skyColor = new THREE.Color();
    // fog must swallow the meshed world edge (5 chunks = 80 blocks)
    scene.fog = new THREE.Fog(0x87ceeb, 45, 82);
    this.ambientDay = new THREE.Color(0xffffff);
    this.ambientNight = new THREE.Color(0x7683b8); // moonlit blue
  }

  _makeStars(seed) {
    const rand = mulberry32(seed ^ 0x57a5);
    const count = 420;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // random points on a sphere shell
      const u = rand() * 2 - 1, phi = rand() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      positions[i * 3] = s * Math.cos(phi) * 380;
      positions[i * 3 + 1] = u * 380;
      positions[i * 3 + 2] = s * Math.sin(phi) * 380;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false,
      transparent: true, opacity: 0,
    });
    const stars = new THREE.Points(geo, mat);
    stars.frustumCulled = false;
    return stars;
  }

  _makeClouds(seed) {
    const rand = mulberry32(seed ^ 0xc10d);
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "rgba(255,255,255,1)";
    // blobby clouds: stamped rectangles, thresholded look
    for (let i = 0; i < 26; i++) {
      const x = rand() * size, y = rand() * size;
      const w = 4 + rand() * 10, h = 2 + rand() * 5;
      for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
        if (rand() < 0.82) ctx.fillRect((x + dx) % size, (y + dy) % size, 1, 1);
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 3);

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1400, 1400),
      new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide,
      })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 110;
    mesh.renderOrder = 2;
    return mesh;
  }

  update(dt, camera, eyeInWater) {
    this.time = (this.time + dt / DAY_LENGTH) % 1;
    const angle = this.time * Math.PI * 2; // 0.25 => noon
    const elev = Math.sin(angle);
    const sunDir = new THREE.Vector3(Math.cos(angle) * 0.9, elev, 0.35).normalize();

    const day = smoothstep(-0.08, 0.18, elev);
    const duskiness = (1 - smoothstep(0.12, 0.32, Math.abs(elev))) * day;

    this.skyColor.copy(NIGHT_SKY).lerp(DAY_SKY, day).lerp(DUSK, duskiness * 0.45);

    this.sun.intensity = 0.95 * day;
    this.sun.position.copy(sunDir).multiplyScalar(100);
    this.moon.intensity = 0.18 * (1 - day);
    this.moon.position.copy(sunDir).multiplyScalar(-100);
    // genuinely dark, slightly blue nights
    this.ambient.intensity = 0.12 + 0.55 * day;
    this.ambient.color.copy(this.ambientNight).lerp(this.ambientDay, day);

    this.rig.position.copy(camera.position);
    this.sunMesh.position.copy(sunDir).multiplyScalar(350);
    this.sunMesh.lookAt(camera.position);
    this.moonMesh.position.copy(sunDir).multiplyScalar(-350);
    this.moonMesh.lookAt(camera.position);
    this.stars.material.opacity = 1 - smoothstep(-0.18, 0.0, elev);

    this.clouds.position.x = camera.position.x;
    this.clouds.position.z = camera.position.z;
    // keep offsets in [0,1): the uv transform uniform is float32 and loses
    // per-frame precision once the raw value grows large
    const ox = (camera.position.x + performance.now() * 0.0012) / 466;
    const oy = -camera.position.z / 466;
    this.clouds.material.map.offset.x = ox - Math.floor(ox);
    this.clouds.material.map.offset.y = oy - Math.floor(oy);
    this.clouds.material.color.setScalar(0.4 + 0.6 * day);

    const fog = this.scene.fog;
    if (eyeInWater) {
      fog.color.copy(WATER_FOG);
      fog.near = 2; fog.far = 24;
      this.scene.background = fog.color;
    } else {
      fog.color.copy(this.skyColor);
      fog.near = 45; fog.far = 82;
      this.scene.background = this.skyColor;
    }
  }
}
