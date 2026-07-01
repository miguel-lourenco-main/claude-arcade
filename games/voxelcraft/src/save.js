// World persistence: seed, player state, time of day, and the block-edit
// overlay, saved to localStorage.

const KEY = "voxelcraft.save.v1";

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (typeof data.seed !== "number") return null;
    return data;
  } catch {
    return null;
  }
}

export function writeSave(world, player, sky, hud) {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      v: 1,
      seed: world.seed,
      time: sky.time,
      player: {
        x: player.pos.x, y: player.pos.y, z: player.pos.z,
        yaw: player.yaw, pitch: player.pitch, flying: player.flying,
      },
      hotbar: hud.slots,
      edits: world.serializeEdits(),
    }));
  } catch (e) {
    console.warn("save failed", e);
  }
}

export function clearSave() {
  localStorage.removeItem(KEY);
}

export function startAutosave(fn, intervalMs = 5000) {
  setInterval(fn, intervalMs);
  window.addEventListener("beforeunload", fn);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") fn();
  });
}
