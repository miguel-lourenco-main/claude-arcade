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

section("saturation: a hidden buffer that drains before hunger");
{
  const { saturationOf, FOOD_SATURATION_RATIO, MAX_HUNGER } = P;
  const p = new Player(fakeWorld());
  p.hunger = 10; p.saturation = 0;
  check(p.eat(8, 30) && p.hunger === 18 && p.saturation === 18, "eating caps saturation at the new hunger");
  p.exhaust(5);
  check(p.hunger === 18 && p.saturation === 13, "exertion spends saturation first");
  p.exhaust(15);
  check(p.saturation === 0 && p.hunger === 16, "...and only the remainder moves hunger");
  p.hunger = MAX_HUNGER;
  check(p.eat(4, 4) === false, "a full belly still refuses plain food");
  near(saturationOf({ restore: 2 }), 2 * FOOD_SATURATION_RATIO, 1e-12, "a food with no stated saturation gets the light default");
  check(saturationOf(B.BLOCKS[B.POTTAGE].food) === 16, "Wanderer's Pottage states its own saturation");
}

section("saturation: hearty food keeps you full longer in play");
{
  const { saturationOf } = P;
  // walk in a straight line (survival) after eating, until hunger first moves
  const secondsFull = (foodId) => {
    const p = standing(fakeWorld());
    p.mode = "survival";
    p.hunger = 10; p.saturation = 0;
    const f = B.BLOCKS[foodId].food;
    p.eat(f.restore, saturationOf(f));
    const h0 = p.hunger;
    p.keys.add("KeyW");
    let t = 0;
    while (p.hunger >= h0 - 1e-9 && t < 4000) { p.update(1 / 20); t += 1 / 20; p.pos.z = 0.5; p.pos.x = 0.5; }
    return t;
  };
  const berries = secondsFull(B.BERRIES), pottage = secondsFull(B.POTTAGE), roast = secondsFull(B.ROAST_LOIN);
  check(pottage > berries * 10, `pottage holds hunger ${pottage.toFixed(0)}s vs berries ${berries.toFixed(0)}s`);
  check(roast > 300, `a roast loin holds a walking Wanderling for minutes (${roast.toFixed(0)}s)`);
  for (const id of [B.POTTAGE, B.ROAST_LOIN]) {
    check(/full/i.test(B.BLOCKS[id].desc || ""), `${B.BLOCKS[id].name} says so in its description (no HUD)`);
  }
}

section("hunger costs: jumping is cheaper than it was");
{
  const p = standing(fakeWorld());
  p.mode = "survival"; p.hunger = 20; p.saturation = 0;
  p.keys.add("Space");
  // one jump, then hold still in the air (drain only applies while moving,
  // and the jump itself is charged once on take-off)
  p.update(1 / 60);
  p.keys.delete("Space");
  const spent = 20 - p.hunger;
  check(spent > 0.05 && spent < 0.07, `a standing jump costs ~0.06 hunger (got ${spent.toFixed(4)})`);
}

done();
