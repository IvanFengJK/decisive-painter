// Share links: a URL hash with a version number and whitelisted parameters. No image, no free text, no model output.
// Version 2 (this page):
//   Gesture:  #v=2&t=g&st=brush&mo=0&ha=2&hu=4&ke=1&sa=1&co=0&sy=9&sr=0&su=3&s=482130&b=30&p=w
//   Map:      #v=2&t=m&st=impasto&mo=0&ha=2&hu=4&ke=1&sa=1&co=0&sy=9&sr=0&su=3&s=482130&g=32&sm=l&c=6
//   (t = tab g|m, st = style, look fields as option indices, s = seed, b = marks, p = pick w|t, g = grid size,
//    sm = Pixel cell colour l most likely | s sampled, c = coarse grid for Model mode)
// Version 1 (links made before v2): #v=1&<look>&s=..&b=..&k=paint|pixel|sketch&p=w|t opens the Gesture tab; Paint is
// drawn by the unchanged old Paint code so its pixels are identical; Pixel and Sketch are unchanged styles.
// Every value is checked against a whitelist; numbers are clamped; unknown keys are ignored; other versions are refused.
// A link never says which decision-maker made the painting: every shared link opens with the rules.
import { COARSE_DEFAULT, COARSE_MAX, COARSE_MIN, GRID_DEFAULT, GRID_MAX, GRID_MIN } from "./field.js";
import { LOOK_FIELDS } from "./recipes.js";

export const SHARE_VERSION = 2;
export const SEED_MAX = 999999;
export const BUDGET_MIN = 10, BUDGET_MAX = 50, BUDGET_DEFAULT = 30;
export const TABS = { g: "gesture", m: "map" };
export const TAB_STYLES = { gesture: ["brush", "sketch", "pixel"], map: ["pixel", "impasto"] };
export const DEFAULT_STYLE = { gesture: "brush", map: "impasto" };
export const V1_SKINS = ["paint", "pixel", "sketch"];
const KEYS = { mood: "mo", harmony: "ha", hue: "hu", key: "ke", saturation: "sa", composition: "co", style: "sy", stroke: "sr", subject: "su" };
const PICKS = { w: "weighted", t: "top" };
const SAMPLES = { l: "likely", s: "sampled" };

export class ShareError extends Error {}

export function clampInt(v, lo, hi, dflt) {
  const n = Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

/** The coarse grid for Model mode: 4 to 8, rounded to the nearest offered size (4, 6 or 8). */
export function clampCoarse(v) {
  const c = clampInt(v, COARSE_MIN, COARSE_MAX, COARSE_DEFAULT);
  return c <= 4 ? 4 : c <= 6 ? 6 : 8;
}

/**
 * r = { tab, style, look, seed, budget, mode, grid, sample, coarse }. Gesture links carry the budget and pick; Map links
 * carry the grid size, sampling mode and coarse grid. An old Paint painting keeps its v=1 link (the same pixels).
 */
export function encodeShare(r) {
  const seed = `s=${clampInt(r.seed, 0, SEED_MAX, 0)}`;
  const look = Object.entries(KEYS).map(([f, k]) => `${k}=${LOOK_FIELDS[f].indexOf(r.look[f])}`);
  const pick = `p=${r.mode === "top" ? "t" : "w"}`;
  const budget = `b=${clampInt(r.budget, BUDGET_MIN, BUDGET_MAX, BUDGET_DEFAULT)}`;
  if (r.tab !== "map" && r.style === "paint") return `#${["v=1", ...look, seed, budget, "k=paint", pick].join("&")}`;
  if (r.tab === "map") {
    const st = TAB_STYLES.map.includes(r.style) ? r.style : DEFAULT_STYLE.map;
    return `#${["v=2", "t=m", `st=${st}`, ...look, seed, `g=${clampInt(r.grid, GRID_MIN, GRID_MAX, GRID_DEFAULT)}`,
      `sm=${r.sample === "sampled" ? "s" : "l"}`, `c=${clampCoarse(r.coarse)}`].join("&")}`;
  }
  const st = TAB_STYLES.gesture.includes(r.style) ? r.style : DEFAULT_STYLE.gesture;
  return `#${["v=2", "t=g", `st=${st}`, ...look, seed, budget, pick].join("&")}`;
}

export function decodeShare(hash) {
  const h = String(hash || "").replace(/^#/, "");
  if (!h) return null;
  if (h.length > 400) throw new ShareError("This link is too long to be a painting link.");
  const q = new URLSearchParams(h);
  const v = q.get("v");
  if (v === null) throw new ShareError("This link has no version, so it is not a painting link.");
  if (v !== "1" && v !== "2") throw new ShareError("This painting link comes from a different version of the page, so it cannot be redrawn here.");
  const look = {};
  for (const [f, k] of Object.entries(KEYS)) {
    const raw = q.get(k);
    const opts = LOOK_FIELDS[f];
    const i = clampInt(raw, 0, opts.length - 1, -1);
    if (i < 0) throw new ShareError("This painting link is missing part of the look, so it cannot be redrawn.");
    look[f] = opts[i];
  }
  const out = {
    look,
    seed: clampInt(q.get("s"), 0, SEED_MAX, 0),
    budget: clampInt(q.get("b"), BUDGET_MIN, BUDGET_MAX, BUDGET_DEFAULT),
    mode: PICKS[q.get("p")] || "weighted",
    grid: clampInt(q.get("g"), GRID_MIN, GRID_MAX, GRID_DEFAULT),
    sample: SAMPLES[q.get("sm")] || "likely",
    coarse: clampCoarse(q.get("c")),
  };
  if (v === "1") {
    const k = q.get("k");
    return { ...out, tab: "gesture", style: V1_SKINS.includes(k) ? k : "paint" };
  }
  const tab = TABS[q.get("t")] || "gesture";
  const st = q.get("st");
  return { ...out, tab, style: TAB_STYLES[tab].includes(st) ? st : DEFAULT_STYLE[tab] };
}
