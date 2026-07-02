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
      // additive: whole days lived (the Peddler's offer rotation) — absent
      // in older saves, which simply restart the calendar at day 0
      day: sky.day,
      chests: world.serializeChests(),
      kilns: world.serializeKilns(), // additive: absent in older saves
      // additive: Notice Post text [["x,y,z", text]...] — absent in older
      // saves, which simply have no writing anywhere
      signs: world.serializeSigns(),
      saplings: extra.saplings || [],
      // additive: growing meal-root crops [[x,y,z,stage,remain]...] — the
      // stage blocks themselves live in the edit overlay; this is the timers
      crops: extra.crops || [],
      // additive: [phase, secondsLeftInPhase, intensity] — absent in older
      // saves, which simply boot clear with a fresh timer
      weather: extra.weather || undefined,
      // additive: deployed Reed Skiffs [[x, y, z, yaw]...] — absent in older
      // saves, which simply have no boats afloat
      boats: extra.boats || [],
      // additive: the Field Chart's inked leaf {ax, az, png} — absent in
      // older saves (and worlds that never unrolled one): a fresh chart
      chart: extra.chart || undefined,
      // additive: the Murmur's settings [on, volume] — absent in older
      // saves, which simply get the defaults (on, modest volume)
      music: extra.music || undefined,
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
      // additive: the Moss Cot respawn anchor (absent/null = world spawn)
      spawnPoint: player.spawnPoint || undefined,
      inventory: inventory ? inventory.serialize() : [],
      // additive: the stack held on the drag cursor mid-window — it lives in
      // no slot, so without this field a save written mid-drag deletes it
      cursor: hud.slotUI && hud.slotUI.cursor
        ? (hud.slotUI.cursor.dur !== undefined
          ? [hud.slotUI.cursor.id, hud.slotUI.cursor.count, hud.slotUI.cursor.dur]
          : [hud.slotUI.cursor.id, hud.slotUI.cursor.count])
        : undefined,
      // additive: stacks awaiting satchel room (v1 migration overflow) —
      // persisted until drained so a reload can never destroy them
      overflowStacks: extra.overflowStacks || [],
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
