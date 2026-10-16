// Player physics + survival (player.js) against a tiny fake world.
// Run with: node test/player.test.mjs
import "./_hooks.cjs";
import { check, section, done, near } from "./_assert.cjs";

const B = await import("../src/blocks.js");
const P = await import("../src/player.js");
const { Player, EYE_HEIGHT, CROUCH_HEIGHT, CROUCH_EYE_DROP } = P;

// a flat stone floor at y=0 plus whatever a test sets
function fakeWorld(cells = {}) {
  return {
    cells,
    getBlock(x, y, z) {
      const k = `${x},${y},${z}`;
      if (k in cells) return cells[k];
      return y <= 0 ? B.STONE : B.AIR;
    },
  };
}

function run(p, seconds, dt = 1 / 60) {
  for (let t = 0; t < seconds; t += dt) p.update(dt);
}

function standing(world) {
  const p = new Player(world);
  p.pos.x = 0.5; p.pos.y = 1.001; p.pos.z = 0.5;
  run(p, 0.3); // settle onto the floor
  return p;
}

section("crouch: the eye drops and the hitbox shortens while sneaking");
{
  const p = standing(fakeWorld());
  near(p.eyeY - p.pos.y, EYE_HEIGHT, 1e-9, "standing eye at 1.62");
  check(p.height === 1.8, "standing hitbox is 1.8 tall");
  p.keys.add("ShiftLeft");
  run(p, 0.05);
  check(p.eyeY - p.pos.y > EYE_HEIGHT - CROUCH_EYE_DROP + 0.01 && p.eyeY - p.pos.y < EYE_HEIGHT,
    "the eye eases down rather than snapping");
  run(p, 1);
  near(p.eyeY - p.pos.y, EYE_HEIGHT - CROUCH_EYE_DROP, 1e-6, "a full crouch puts the eye at 1.27");
  check(p.height === CROUCH_HEIGHT && Math.abs(p.aabb().maxY - p.aabb().minY - CROUCH_HEIGHT) < 1e-9,
    "the crouched hitbox (and the placement AABB) is the crouch height");
  p.keys.delete("ShiftLeft");
  run(p, 1);
  check(!p.crouched && Math.abs(p.eyeY - p.pos.y - EYE_HEIGHT) < 1e-6, "releasing sneak in the open stands back up");
}

section("crouch: a slab-high gap is walkable crouched, and holds you down");
{
  // a stone slab floor at x>=2 (feet at 1.5) under a ceiling block at y=3:
  // 1.5 of headroom — a crouch fits, a standing Wanderling doesn't
  const cells = {};
  for (let x = 2; x <= 6; x++) for (let z = -1; z <= 1; z++) {
    cells[`${x},1,${z}`] = B.STONE_SLAB;
    cells[`${x},3,${z}`] = B.STONE;
  }
  const w = fakeWorld(cells);
  const upright = standing(w);
  upright.keys.add("KeyD"); upright.yaw = 0; // camera mode: D strafes +x
  run(upright, 2);
  check(upright.pos.x < 2, `standing, the low gap blocks you (x=${upright.pos.x.toFixed(2)})`);

  const p = standing(w);
  p.keys.add("ShiftLeft"); run(p, 0.5);
  p.keys.add("KeyD");
  run(p, 4);
  check(p.pos.x > 3, `crouched, you shuffle in under it (x=${p.pos.x.toFixed(2)})`);
  p.keys.delete("KeyD"); p.keys.delete("ShiftLeft");
  run(p, 1);
  check(p.crouched, "letting go of sneak under the ceiling keeps you crouched");
  check(p.pos.y + p.height <= 3 + 1e-6, "...and the box still fits under the ceiling");
}

section("ladder grip-hold: sneak holds the rung, idle slides, back descends");
{
  const cells = {};
  for (let y = 1; y <= 8; y++) { cells[`0,${y},0`] = B.LADDER; cells[`0,${y},-1`] = B.STONE; }
  const p = new Player(fakeWorld(cells));
  p.pos.x = 0.5; p.pos.y = 5; p.pos.z = 0.5;
  p.keys.add("ShiftLeft");
  run(p, 1.5);
  near(p.pos.y, 5, 1e-6, "sneaking on a ladder holds position (no slide)");
  p.keys.delete("ShiftLeft");
  const y0 = p.pos.y; run(p, 1);
  check(p.pos.y < y0 - 0.5, "letting go, the idle slide resumes");
  p.keys.add("KeyW"); const y1 = p.pos.y; run(p, 0.5);
  check(p.pos.y > y1 + 0.8, "forward climbs");
  p.keys.delete("KeyW"); p.keys.add("KeyS"); const y2 = p.pos.y; run(p, 0.5);
  check(p.pos.y < y2 - 0.8, "back descends at climbing speed");
}

done();
