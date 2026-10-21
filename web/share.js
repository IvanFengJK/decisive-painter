// Share links: a URL hash with a version number, the look (as option indices), seed, budget, skin and pick mode.
// No image and no free text. Example (75 characters): #v=1&mo=0&ha=2&hu=4&ke=1&sa=1&co=0&sy=9&sr=0&su=3&s=482130&b=30&k=paint&p=w
// (s = seed, b = marks, k = skin, p = pick: w weighted / t top)
// Every value is checked against a whitelist; numbers are clamped; unknown keys are ignored.
import { SKINS } from "./render.js";
import { LOOK_FIELDS } from "./recipes.js";

export const SHARE_VERSION = 1;
export const SEED_MAX = 999999;
export const BUDGET_MIN = 10, BUDGET_MAX = 50, BUDGET_DEFAULT = 30;
const KEYS = { mood: "mo", harmony: "ha", hue: "hu", key: "ke", saturation: "sa", composition: "co", style: "sy", stroke: "sr", subject: "su" };
const PICKS = { w: "weighted", t: "top" };

export class ShareError extends Error {}

export function clampInt(v, lo, hi, dflt) {
  const n = Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

export function encodeShare({ look, seed, budget, skin, mode }) {
  const p = [`v=${SHARE_VERSION}`];
  for (const [f, k] of Object.entries(KEYS)) p.push(`${k}=${LOOK_FIELDS[f].indexOf(look[f])}`);
  p.push(`s=${clampInt(seed, 0, SEED_MAX, 0)}`, `b=${clampInt(budget, BUDGET_MIN, BUDGET_MAX, BUDGET_DEFAULT)}`,
    `k=${SKINS.includes(skin) ? skin : "paint"}`, `p=${mode === "top" ? "t" : "w"}`);
  return `#${p.join("&")}`;
}

/** hash -> {look, seed, budget, skin, mode} or throws ShareError with a friendly message. Empty hash -> null. */
export function decodeShare(hash) {
  const h = String(hash || "").replace(/^#/, "");
  if (!h) return null;
  if (h.length > 300) throw new ShareError("This link is too long to be a painting link.");
  const q = new URLSearchParams(h);
  const v = q.get("v");
  if (v === null) throw new ShareError("This link has no version, so it is not a painting link.");
  if (v !== String(SHARE_VERSION)) throw new ShareError("This painting link comes from a different version of the page, so it cannot be redrawn here.");
  const look = {};
  for (const [f, k] of Object.entries(KEYS)) {
    const raw = q.get(k);
    if (raw === null || !/^\d{1,2}$/.test(raw)) throw new ShareError("This painting link is incomplete or damaged.");
    const i = Number(raw);
    if (i >= LOOK_FIELDS[f].length) throw new ShareError("This painting link is incomplete or damaged.");
    look[f] = LOOK_FIELDS[f][i];
  }
  const seed = clampInt(q.get("s"), 0, SEED_MAX, 0);
  const budget = clampInt(q.get("b"), BUDGET_MIN, BUDGET_MAX, BUDGET_DEFAULT);
  const skin = SKINS.includes(q.get("k")) ? q.get("k") : "paint";
  const mode = PICKS[q.get("p")] || "weighted";
  return { look, seed, budget, skin, mode };
}
