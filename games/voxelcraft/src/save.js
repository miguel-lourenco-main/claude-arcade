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

let warnedQuota = false;

export function writeSave(world, player, sky, hud, inventory, extra = {}) {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      v: 2, // slot-based inventory + slot-array chests
      seed: world.seed,
      time: sky.time,
      chests: world.serializeChests(),
      saplings: extra.saplings || [],
      player: {
        x: player.pos.x, y: player.pos.y, z: player.pos.z,
        yaw: player.yaw, pitch: player.pitch, flying: player.flying,
      },
      // movement2: the old "movement" field carried the world-static default
      // that was rolled back — ignoring it migrates old saves to camera mode
      movement2: player.moveMode,
      sensitivity: player.sensitivity,
      gameMode: player.mode,
      health: player.health,
      hunger: player.hunger,
      air: player.air,
      inventory: inventory ? inventory.serialize() : [],
      selected: hud.selected,
      edits: world.serializeEdits(),
    }));
  } catch (e) {
    if (!warnedQuota) {
      warnedQuota = true;
      console.warn("Voxelcraft: saving failed (localStorage quota?) — progress will not persist.", e);
    }
  }
}

export function clearSave() {
  localStorage.removeItem(KEY);
}

// Returns a stop() that disables autosaving — required for "Reset world",
// otherwise the unload hooks re-write the save right after clearSave().
export function startAutosave(fn, intervalMs = 5000) {
  let enabled = true;
  const handler = () => { if (enabled) fn(); };
  const onVisibility = () => { if (document.visibilityState === "hidden") handler(); };
  const id = setInterval(handler, intervalMs);
  window.addEventListener("beforeunload", handler);
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    enabled = false;
    clearInterval(id);
    window.removeEventListener("beforeunload", handler);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
