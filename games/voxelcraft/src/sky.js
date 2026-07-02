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

    // world lighting is driven through the voxel-shader uniforms, not scene
    // lights: main.js reads lightLevel/lightTint each frame
    this.lightLevel = 1;
    this.lightTint = new THREE.Color(1, 1, 1);
    this._tintNight = new THREE.Color(0.55, 0.63, 0.9); // moonlit blue
    this._tintDay = new THREE.Color(1, 1, 1);
    this._tintDusk = new THREE.Color(1.0, 0.82, 0.7);

    // weather: every so often the old sea overhead wrings itself out.
    // rain is the 0..1 intensity that everything else reads; the phase
    // machine drives it toward 0 or 1 with an ~8s fade at each edge.
    this.weatherPhase = "clear";
    this.weatherTimer = 300 + Math.random() * 420; // first shower 5-12 min out
    this.rain = 0;
    this._tintRain = new THREE.Color(0.62, 0.66, 0.72); // gray, desaturating
    this._skyRain = new THREE.Color(0x53616e);
    this._scratch = new THREE.Color();

    // celestial rig follows the camera so bodies stay on the horizon
    this.rig = new THREE.Group();
    scene.add(this.rig);

    const sunGeo = new THREE.PlaneGeometry(26, 26);
    this.sunMesh = new THREE.Mesh(sunGeo, new THREE.MeshBasicMaterial({
      color: 0xffe680, fog: false, side: THREE.DoubleSide, transparent: true,
    }));
    this.rig.add(this.sunMesh);

    this.moonMesh = new THREE.Mesh(new THREE.PlaneGeometry(18, 18), new THREE.MeshBasicMaterial({
      color: 0xdde4f0, fog: false, side: THREE.DoubleSide, transparent: true,
    }));
    this.rig.add(this.moonMesh);

    this.stars = this._makeStars(seed);
    this.rig.add(this.stars);

    this.clouds = this._makeClouds(seed);
    scene.add(this.clouds);

    this.skyColor = new THREE.Color();
    // fog must swallow the meshed world edge (5 chunks = 80 blocks)
    scene.fog = new THREE.Fog(0x87ceeb, 45, 82);
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

  // test/debug hook: jump the weather machine (this.rain still eases over)
  forceWeather(phase, seconds) {
    this.weatherPhase = phase === "rainy" ? "rainy" : "clear";
    this.weatherTimer = Number.isFinite(seconds) && seconds > 0
      ? seconds
      : this.weatherPhase === "rainy"
        ? 60 + Math.random() * 90
        : 300 + Math.random() * 420;
  }

  update(dt, camera, eyeInWater) {
    this.time = (this.time + dt / DAY_LENGTH) % 1;
    const angle = this.time * Math.PI * 2; // 0.25 => noon
    const elev = Math.sin(angle);
    const sunDir = new THREE.Vector3(Math.cos(angle) * 0.9, elev, 0.35).normalize();

    // weather machine: long clear stretches, minute-or-two showers
    this.weatherTimer -= dt;
    if (this.weatherTimer <= 0) {
      const toRain = this.weatherPhase === "clear";
      this.weatherPhase = toRain ? "rainy" : "clear";
      this.weatherTimer = toRain
        ? 60 + Math.random() * 90     // rain lasts 60-150s
        : 300 + Math.random() * 420;  // next arrives in 5-12 min
    }
    const rainStep = dt / 8; // ~8s fade in/out
    const rainTarget = this.weatherPhase === "rainy" ? 1 : 0;
    this.rain += Math.max(-rainStep, Math.min(rainStep, rainTarget - this.rain));
    const rain = this.rain;

    const day = smoothstep(-0.08, 0.18, elev);
    const duskiness = (1 - smoothstep(0.12, 0.32, Math.abs(elev))) * day;

    this.skyColor.copy(NIGHT_SKY).lerp(DAY_SKY, day).lerp(DUSK, duskiness * 0.45);

    // genuinely dark, slightly blue nights; warm cast at dusk/dawn
    this.lightLevel = 0.18 + 0.82 * day;
    this.lightTint.copy(this._tintNight).lerp(this._tintDay, day)
      .lerp(this._tintDusk, duskiness * 0.6);

    // a shower dims and grays everything: sky, world light, its tint
    if (rain > 0) {
      this._scratch.copy(this._skyRain).multiplyScalar(0.2 + 0.8 * day);
      this.skyColor.lerp(this._scratch, rain * 0.85);
      this.lightLevel *= 1 - 0.35 * rain;
      this.lightTint.lerp(this._tintRain, rain * 0.7);
    }

    this.rig.position.copy(camera.position);
    this.sunMesh.position.copy(sunDir).multiplyScalar(350);
    this.sunMesh.lookAt(camera.position);
    this.moonMesh.position.copy(sunDir).multiplyScalar(-350);
    this.moonMesh.lookAt(camera.position);
    // overcast hides the celestial bodies and the pearls alike
    this.sunMesh.material.opacity = 1 - rain;
    this.sunMesh.visible = rain < 0.98;
    this.moonMesh.material.opacity = 1 - rain;
    this.moonMesh.visible = rain < 0.98;
    this.stars.material.opacity = (1 - smoothstep(-0.18, 0.0, elev)) * (1 - rain);

    this.clouds.position.x = camera.position.x;
    this.clouds.position.z = camera.position.z;
    // keep offsets in [0,1): the uv transform uniform is float32 and loses
    // per-frame precision once the raw value grows large
    const ox = (camera.position.x + performance.now() * 0.0012) / 466;
    const oy = -camera.position.z / 466;
    this.clouds.material.map.offset.x = ox - Math.floor(ox);
    this.clouds.material.map.offset.y = oy - Math.floor(oy);
    this.clouds.material.color.setScalar((0.4 + 0.6 * day) * (1 - 0.45 * rain));
    this.clouds.material.opacity = 0.55 + 0.35 * rain;

    const fog = this.scene.fog;
    if (eyeInWater) {
      fog.color.copy(WATER_FOG);
      fog.near = 2; fog.far = 24;
      this.scene.background = fog.color;
    } else {
      fog.color.copy(this.skyColor);
      // rain pulls the fog in (still swallowing the meshed world edge)
      fog.near = 45 - 18 * rain; fog.far = 82 - 20 * rain;
      this.scene.background = this.skyColor;
    }
  }
}
