// Local gallery: up to 20 paintings in this browser's localStorage. Each entry holds the tab, style, recipe (look),
// seed, marks or grid settings, pick mode, version and a small thumbnail (under 30 KB). Never any model output: a saved
// painting opens with the rules, like a shared link. Nothing leaves the browser. Every access is inside
// try/catch, so the page works when storage is blocked, full or cleared.
import { HARNESS_VERSION } from "./director.js";
import { cleanLook } from "./recipes.js";
import { GRID_DEFAULT, GRID_MAX, GRID_MIN } from "./field.js";
import { TAB_STYLES, clampCoarse, clampInt } from "./share.js";

const KEY = "art-director-gallery-v1";
export const GALLERY_MAX = 20;
export const THUMB_MAX_BYTES = 30000;

function readAll() {
  try {
    const raw = window.localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((e) => e && typeof e.id === "string") : [];
  } catch {
    return [];
  }
}

function writeAll(list) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function storageAvailable() {
  try {
    const k = `${KEY}-probe`;
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

/** Tab and style of an entry; entries saved before v2 have only `skin` (paint, pixel or sketch: the Gesture tab). */
function tabStyle(e) {
  if (e.tab === "map") return { tab: "map", style: TAB_STYLES.map.includes(e.style) ? e.style : "impasto" };
  const st = e.tab === "gesture" ? e.style : e.skin;
  return { tab: "gesture", style: [...TAB_STYLES.gesture, "paint"].includes(st) ? st : "paint" };
}

/** Entries, cleaned (a tampered entry cannot inject anything: fields are whitelisted, the thumbnail must be data:image). */
export function listPaintings() {
  return readAll().map((e) => ({
    id: String(e.id).slice(0, 40),
    look: cleanLook(e.look),
    seed: clampInt(e.seed, 0, 999999, 0),
    budget: clampInt(e.budget, 10, 50, 30),
    ...tabStyle(e),
    mode: e.mode === "top" ? "top" : "weighted",
    grid: clampInt(e.grid, GRID_MIN, GRID_MAX, GRID_DEFAULT),
    sample: e.sample === "sampled" ? "sampled" : "likely",
    coarse: clampCoarse(e.coarse),
    version: clampInt(e.version, 0, 99, 0),
    thumb: typeof e.thumb === "string" && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(e.thumb) ? e.thumb : "",
    saved: clampInt(e.saved, 0, 9e15, 0),
  }));
}

/** -> true when saved, false when storage is blocked or full. Oldest entries go first beyond 20. */
export function savePainting({ tab, style, look, seed, budget, mode, grid, sample, coarse, thumb }) {
  if (!thumb || thumb.length > THUMB_MAX_BYTES) thumb = "";
  const list = readAll();
  const r = new Uint32Array(1);
  crypto.getRandomValues(r);
  const entry = { id: `p${Date.now().toString(36)}${r[0].toString(36)}`, tab, style, look, seed, budget, mode, grid, sample, coarse,
    version: HARNESS_VERSION, thumb, saved: Date.now() };
  list.unshift(entry);
  return writeAll(list.slice(0, GALLERY_MAX));
}

export function deletePainting(id) {
  return writeAll(readAll().filter((e) => e.id !== id));
}
