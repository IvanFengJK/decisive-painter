// The Probability Map tab: the painting is a grid of per-cell probability distributions over the six palette roles
// (dominant, secondary, accent, neutral, shadow, highlight). Pure (runs in node). Three sources of a field:
//   rulesField  authored region tables on the composition's named places, soft boundaries, a vertical lightness
//               gradient, seeded smooth value noise and a subject blob (no AI);
//   modelField  a Director answers one colour question per cell of a coarse grid (4x4 to 8x8); the answers are
//               interpolated bilinearly in probability space to the full grid, renormalised, optionally blended with the
//               rules field;
//   any Director through the cell question contract (cellQuestions + cellState; DIRECTOR.md).
// A field is { g, p } with p a Float64Array of g*g*6 probabilities, row-major (y, x, role); every cell sums to 1.
import { DirectorError, validateAnswers } from "./director.js";
import { COMPOSITIONS, ROLES, enginePalette } from "./render.js";
import { Rng, fnv1a, seedString, valueNoise } from "./rng.js";
import { paletteLine, promptField } from "./state.js";

export const GRID_MIN = 16, GRID_MAX = 48, GRID_DEFAULT = 32;
export const COARSE_SIZES = [4, 6, 8];
export const COARSE_MIN = 4, COARSE_MAX = 8, COARSE_DEFAULT = 6;
export const R = ROLES.length; // 6
export const MAP_VERSION = 1;

/** The painting id of a map: recipe + seed + grid size (the field and every seeded draw hang off it). */
export function mapId(look, seed, grid) {
  return [`map${MAP_VERSION}`, look.mood, look.harmony, look.hue, look.key, look.saturation, look.composition,
    look.style, look.stroke, look.subject, `s${seed}`, `g${grid}`].join("|");
}

/** The six probabilities of cell (x, y) as a plain array. */
export function cellProbs(field, x, y) {
  const o = (y * field.g + x) * R;
  return Array.from(field.p.subarray(o, o + R));
}

/** Normalised entropy of a distribution: 0 = certain (one role), 1 = uniform over the six roles. */
export function entropy(p, o = 0) {
  let h = 0;
  for (let r = 0; r < R; r++) {
    const v = p[o + r];
    if (v > 0) h -= v * Math.log(v);
  }
  return h / Math.log(R);
}

/** Throws a readable DirectorError unless every cell is finite, non-negative and sums to 1 (+-1e-9). */
export function checkField(field) {
  const { g, p } = field;
  if (!(Number.isInteger(g) && g > 0) || !(p instanceof Float64Array) || p.length !== g * g * R) {
    throw new DirectorError("the map does not have one distribution per cell");
  }
  for (let i = 0; i < g * g; i++) {
    let s = 0;
    for (let r = 0; r < R; r++) {
      const v = p[i * R + r];
      if (!Number.isFinite(v) || v < 0) throw new DirectorError(`the map has a bad probability at cell ${i % g},${Math.floor(i / g)}`);
      s += v;
    }
    if (Math.abs(s - 1) > 1e-9) throw new DirectorError(`the map's cell ${i % g},${Math.floor(i / g)} does not sum to 1`);
  }
  return field;
}

function normaliseCell(p, o) {
  let s = 0;
  for (let r = 0; r < R; r++) s += p[o + r];
  if (!(s > 0)) {
    for (let r = 0; r < R; r++) p[o + r] = 1 / R;
    return;
  }
  for (let r = 0; r < R; r++) p[o + r] /= s;
  // one more pass so the sum is 1 to the last bits (the error of one division pass can reach a few ulps)
  let t = 0;
  for (let r = 0; r < R; r++) t += p[o + r];
  p[o + R - 1] += 1 - t;
}

// ------------------------------------------------------------------------------------------------ the cell contract
const ROW_WORDS = ["top", "upper", "middle", "lower", "bottom"];
const COL_WORDS = ["left", "left of centre", "centre", "right of centre", "right"];

/** A cell's position in words and normalised coordinates (cell centre, 0..1 from the top left). */
export function cellWhere(x, y, g) {
  const nx = (x + 0.5) / g, ny = (y + 0.5) / g;
  const words = `${ROW_WORDS[Math.min(4, Math.floor(ny * 5))]} ${COL_WORDS[Math.min(4, Math.floor(nx * 5))]}`;
  return { x, y, nx: Math.round(nx * 1000) / 1000, ny: Math.round(ny * 1000) / 1000, words: words.replace("middle centre", "centre") };
}

/** One colour question per cell of a g x g grid. Answer = { id, probs } over the six role names. */
export function cellQuestions(g, look) {
  const words = enginePalette(look).words;
  const about = Object.fromEntries(ROLES.map((r) => [r, words[r]]));
  const qs = [];
  for (let y = 0; y < g; y++) {
    for (let x = 0; x < g; x++) {
      const w = cellWhere(x, y, g);
      qs.push({ id: `cell:${x},${y}`, type: "choice", options: ROLES.slice(), about, where: w,
        short: `Which colour fits the cell in the ${w.words} of the picture (x ${w.nx.toFixed(2)}, y ${w.ny.toFixed(2)} from top left)?`,
        text: `Which palette colour should the cell in the ${w.words} of the picture be (column ${x + 1} of ${g}, row ${y + 1} of ${g}; x = ${w.nx}, y = ${w.ny} from the top left)?` });
    }
  }
  return qs;
}

/**
 * The shared part of the state for cell questions: the request (delimited), the recipe in words, the palette in colour
 * words, the composition and the grid size. The cell's position is in each question (cellText joins the two). The
 * rules' region label for a cell is deliberately not given.
 */
export function cellState({ prompt, look, grid }) {
  const comp = COMPOSITIONS[look.composition];
  return {
    kind: "cells",
    prompt,
    look,
    grid,
    text: [
      promptField(prompt),
      `We will paint this request as a small abstract picture: a ${grid}x${grid} grid of cells, each filled with one of six palette colours.`,
      `Recipe: ${look.mood} mood, ${look.harmony} harmony, ${look.hue} family, ${look.key} key, ${look.saturation}, ${look.style}.`,
      paletteLine(look),
      `Composition: ${look.composition} (${comp.about}).`,
    ].join("\n"),
  };
}

/** The full state text for one cell question (what a remote director would read for that cell). */
export const cellText = (state, q) => `${state.text}\nCell: ${q.text}`;

// ------------------------------------------------------------------------------------------------ rules field
// Region base distributions over [dominant, secondary, accent, neutral, shadow, highlight] for the named places.
const REGION = {
  "upper air": [0.42, 0.1, 0.03, 0.12, 0.03, 0.3],
  "far band": [0.14, 0.34, 0.05, 0.3, 0.12, 0.05],
  "low ground": [0.2, 0.4, 0.04, 0.1, 0.22, 0.04],
  "near edge": [0.1, 0.24, 0.03, 0.1, 0.51, 0.02],
  "centre stage": [0.28, 0.1, 0.32, 0.06, 0.14, 0.1],
  "high point": [0.12, 0.05, 0.3, 0.03, 0.02, 0.48],
  "left wing": [0.24, 0.32, 0.06, 0.12, 0.22, 0.04],
  "right wing": [0.24, 0.32, 0.06, 0.12, 0.22, 0.04],
  "water plane": [0.4, 0.16, 0.04, 0.1, 0.12, 0.18],
  "back wall": [0.34, 0.12, 0.03, 0.38, 0.06, 0.07],
  "table top": [0.14, 0.4, 0.05, 0.16, 0.22, 0.03],
};
const BACKGROUND = [0.36, 0.2, 0.04, 0.2, 0.1, 0.1];
const SUBJECT = [0.22, 0.06, 0.42, 0.02, 0.2, 0.08]; // the focal blob: accent and dominant over a dark core
const IDX = Object.fromEntries(ROLES.map((r, i) => [r, i]));
const SOFT = 0.035; // edge softness of a place, in picture widths
const SHARP = 2.2; // the region tables are written gently; this power makes regions read clearly (lower entropy)

const sig = (v) => 1 / (1 + Math.exp(-v / SOFT));
function boxMembership(b, u, v) {
  return sig(u - b[0]) * sig(b[2] - u) * sig(v - b[1]) * sig(b[3] - v);
}

/** The rules field for a recipe, seed and grid size: deterministic, every cell sums to 1. */
export function rulesField(look, seed, g) {
  const comp = COMPOSITIONS[look.composition];
  const id = mapId(look, seed, g);
  const subjectPlace = comp.order.subject[0];
  const regions = Object.entries(comp.places).filter(([name]) => name !== "whole frame" && REGION[name]);
  const sb = comp.places[subjectPlace];
  const rng = new Rng(seedString(id, "subject"));
  // the subject blob: centred in its place with a small seeded offset, about a third of the place's size
  const bx = (sb[0] + sb[2]) / 2 + rng.uniform(-0.06, 0.06) * (sb[2] - sb[0]);
  const by = (sb[1] + sb[3]) / 2 + rng.uniform(-0.06, 0.06) * (sb[3] - sb[1]);
  const sx = Math.max(0.05, (sb[2] - sb[0]) * 0.3), sy = Math.max(0.05, (sb[3] - sb[1]) * 0.3);
  const seeds = ROLES.map((r) => fnv1a(seedString(id, "noise", r)));
  const water = comp.places["water plane"];
  const keyShift = { light: [0.45, -0.45], mid: [0, 0], dark: [-0.4, 0.5] }[look.key]; // [highlight, shadow] logits
  const satShift = { muted: [0, 0.35], moderate: [0, 0], vivid: [0.35, -0.2] }[look.saturation]; // [accent, neutral]
  const mood = { stormy: 0.3, eerie: 0.25 }[look.mood] || 0; // extra shadow for dark moods
  const p = new Float64Array(g * g * R);
  const base = (u, v) => {
    const mix = BACKGROUND.map((w) => w * 0.04);
    let wsum = 0.04;
    for (const [name, b] of regions) {
      if (name === subjectPlace) continue;
      const m = boxMembership(b, u, v);
      if (m < 1e-6) continue;
      for (let r = 0; r < R; r++) mix[r] += m * REGION[name][r];
      wsum += m;
    }
    for (let r = 0; r < R; r++) mix[r] /= wsum;
    return mix;
  };
  for (let y = 0; y < g; y++) {
    for (let x = 0; x < g; x++) {
      const u = (x + 0.5) / g, v = (y + 0.5) / g;
      let mix = base(u, v);
      if (water && v > water[1]) { // mirror water: the water repeats the scene above it, softened
        const above = base(u, Math.max(0, 2 * water[1] - v));
        const t = Math.min(1, (v - water[1]) / 0.04);
        mix = mix.map((w, r) => (1 - 0.5 * t) * w + 0.5 * t * above[r]);
      }
      const blob = Math.exp(-0.5 * (((u - bx) / sx) ** 2 + ((v - by) / sy) ** 2));
      const logit = new Float64Array(R);
      for (let r = 0; r < R; r++) logit[r] = SHARP * Math.log((1 - blob) * mix[r] + blob * SUBJECT[r] + 1e-6);
      logit[IDX.highlight] += 0.9 * (0.5 - v) + keyShift[0];
      logit[IDX.shadow] += 0.9 * (v - 0.5) + keyShift[1] + mood;
      logit[IDX.accent] += satShift[0];
      logit[IDX.neutral] += satShift[1];
      for (let r = 0; r < R; r++) {
        logit[r] += 1.6 * (valueNoise(seeds[r], u * 3.2, v * 3.2) - 0.5) + 0.7 * (valueNoise(seeds[r] + 7, u * 8, v * 8) - 0.5);
      }
      let m = -Infinity;
      for (let r = 0; r < R; r++) m = Math.max(m, logit[r]);
      const o = (y * g + x) * R;
      for (let r = 0; r < R; r++) p[o + r] = Math.exp(logit[r] - m);
      normaliseCell(p, o);
    }
  }
  return { g, p };
}

// ------------------------------------------------------------------------------------------------ model field
/** A coarse field (gc x gc) -> g x g by bilinear interpolation between cell centres in probability space, renormalised. */
export function interpolateField(coarse, g) {
  const gc = coarse.g;
  const p = new Float64Array(g * g * R);
  const at = (cx, cy, r) => coarse.p[(cy * gc + cx) * R + r];
  for (let y = 0; y < g; y++) {
    const fy = Math.min(gc - 1, Math.max(0, ((y + 0.5) / g) * gc - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(gc - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < g; x++) {
      const fx = Math.min(gc - 1, Math.max(0, ((x + 0.5) / g) * gc - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(gc - 1, x0 + 1), tx = fx - x0;
      const o = (y * g + x) * R;
      for (let r = 0; r < R; r++) {
        p[o + r] = (at(x0, y0, r) * (1 - tx) + at(x1, y0, r) * tx) * (1 - ty) + (at(x0, y1, r) * (1 - tx) + at(x1, y1, r) * tx) * ty;
      }
      normaliseCell(p, o);
    }
  }
  return { g, p };
}

/** Mix two fields of the same size: (1 - w) a + w b, renormalised. */
export function blendFields(a, b, w = 0.5) {
  if (a.g !== b.g) throw new DirectorError("the fields to blend have different sizes");
  const p = new Float64Array(a.p.length);
  for (let i = 0; i < p.length; i++) p[i] = (1 - w) * a.p[i] + w * b.p[i];
  for (let o = 0; o < p.length; o += R) normaliseCell(p, o);
  return { g: a.g, p };
}

/** Validated answers (by question id) for a gc x gc grid -> a coarse field. */
export function coarseFromAnswers(P, gc) {
  const p = new Float64Array(gc * gc * R);
  for (let y = 0; y < gc; y++) {
    for (let x = 0; x < gc; x++) {
      const a = P[`cell:${x},${y}`];
      if (!a || a.length !== R || a.some((v) => !Number.isFinite(v) || v < 0)) throw new DirectorError(`the map's cell ${x},${y} is not a set of six probabilities`);
      const o = (y * gc + x) * R;
      for (let r = 0; r < R; r++) p[o + r] = a[r];
      normaliseCell(p, o);
    }
  }
  return checkField({ g: gc, p });
}

/**
 * Ask a Director for the coarse grid (one batched decide() call with every cell question), check every answer against
 * the menu (validateAnswers: unknown options, wrong lengths, negatives, NaN all fail readably), interpolate to g x g,
 * optionally blend with the rules field, and check the result is a valid field. Returns { field, coarse, P }.
 */
export async function directorField({ director, prompt, look, seed, grid, coarse = COARSE_DEFAULT, blend = false }) {
  const qs = cellQuestions(coarse, look);
  const st = cellState({ prompt, look, grid: coarse });
  let raw;
  try {
    raw = await director.decide(st, qs);
  } catch (e) {
    throw e instanceof DirectorError ? e : new DirectorError("the decision-maker stopped with an error");
  }
  let P;
  try {
    P = validateAnswers(raw, qs);
  } catch (e) {
    throw new DirectorError(`the map's answers: ${e.message}`);
  }
  const c = coarseFromAnswers(P, coarse);
  return { field: fieldFromCoarse(c, { look, seed, grid, blend }), coarse: c, P };
}

/** A coarse field -> the full grid (interpolated), optionally half and half with the rules field; checked. */
export function fieldFromCoarse(coarse, { look, seed, grid, blend = false }) {
  let field = interpolateField(coarse, grid);
  if (blend) field = blendFields(field, rulesField(look, seed, grid), 0.5);
  return checkField(field);
}

/** A Director that gives every role the same probability (contract tests and the uniform-field check). */
export class MockDirector {
  constructor({ probs = null, name = "Mock director (test)" } = {}) {
    this.name = name;
    this.kind = "mock";
    this.probs = probs;
    this.calls = 0;
  }

  async init() {}

  async decide(state, questions) {
    this.calls++;
    return questions.map((q) => ({ id: q.id, probs: this.probs ? this.probs(q) : q.options.map(() => 1) }));
  }
}

// ------------------------------------------------------------------------------------------------ Pixel (map)
/** The role chosen for each cell: the most likely, or a seeded draw from the cell's distribution. Uint8Array of g*g. */
export function cellChoices(field, id, sample = "likely") {
  const { g, p } = field;
  const out = new Uint8Array(g * g);
  for (let i = 0; i < g * g; i++) {
    const o = i * R;
    if (sample === "sampled") {
      out[i] = new Rng(seedString(id, "cell", i % g, Math.floor(i / g))).choice(Array.from(p.subarray(o, o + R)));
    } else {
      let best = 0;
      for (let r = 1; r < R; r++) if (p[o + r] > p[o + best]) best = r;
      out[i] = best;
    }
  }
  return out;
}

const hexBytes = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** Pixel style: one block per cell in its role colour; n = g (the page scales it up with nearest-neighbour). */
export function pixelMap(field, palette, id, sample = "likely") {
  const { g } = field;
  const cols = palette.roles.map(([, h]) => hexBytes(h));
  const ch = cellChoices(field, id, sample);
  const rgba = new Uint8ClampedArray(g * g * 4);
  for (let i = 0; i < g * g; i++) {
    const c = cols[ch[i]];
    rgba[i * 4] = c[0]; rgba[i * 4 + 1] = c[1]; rgba[i * 4 + 2] = c[2]; rgba[i * 4 + 3] = 255;
  }
  return { n: g, choices: ch, rgba: () => rgba };
}

/** Certainty overlay: one grey block per cell, brightness = 1 - normalised entropy. */
export function certaintyMap(field) {
  const { g, p } = field;
  const rgba = new Uint8ClampedArray(g * g * 4);
  for (let i = 0; i < g * g; i++) {
    const v = Math.round((1 - entropy(p, i * R)) * 255);
    rgba[i * 4] = v; rgba[i * 4 + 1] = v; rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = 255;
  }
  return { n: g, rgba: () => rgba };
}
