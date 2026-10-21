// Renderer: a port of the Round 12 Python renderer (experiments/r12/harness/render.py) plus the Round 15 palette engine
// (experiments/r15/engine.py). All our own code and tables. Differences from the Python original (DECISIONS.md):
//  - random numbers come from rng.js (mulberry32), not numpy's PCG64; experiments/r17/render_portable.py is the Python
//    twin with the same RNG, and the geometry of both matches to 1e-6 (tests/render-check.mjs);
//  - rasterisation is our own software rasteriser (no Canvas2D paths), so every browser and node give identical pixels;
//    it follows Pillow's conventions (pixel centres on integers, no antialiasing, opaque overwrite) but is not Pillow;
//  - Gaussian blur is a 3-pass extended box blur like Pillow's, in float with rounding per blur, not per pass;
//  - every pixel-sized constant is multiplied by k = size / 600, so k = 1 at the Python size (used by the Pixel skin).
import { Rng, seedString } from "./rng.js";

export const W = 600;

// ------------------------------------------------------------------------------------------------ harness lists (Round 12)
export const PHASES = [ // name, share of the budget (end), purpose
  ["backdrop", 8 / 50, "lay in the sky, wall or overall ground colour"],
  ["ground", 16 / 50, "the land, water, floor or table"],
  ["distance", 24 / 50, "the horizon, far shapes and middle distance"],
  ["subject", 40 / 50, "the main subject at the focal place"],
  ["accents", 1, "details, highlights, dark accents and texture"],
];

/** Phase plan for a budget: the Round 12 order and shares (8/16/24/40/50 of 50), scaled, at least one mark per phase. */
export function phasePlan(budget) {
  const out = [];
  let prev = 0;
  PHASES.forEach(([name, frac, what], i) => {
    const left = PHASES.length - 1 - i;
    let end = i === PHASES.length - 1 ? budget : Math.round(budget * frac);
    end = Math.min(Math.max(end, prev + 1), budget - left);
    out.push({ name, first: prev + 1, last: end, what });
    prev = end;
  });
  return out;
}

export function phaseOf(step, budget) {
  return phasePlan(budget).find((p) => step >= p.first && step <= p.last);
}

export const COMPOSITIONS = {
  "open horizon": {
    about: "a level horizon across the middle, sky above and land or sea below, subject near the centre",
    places: { "upper air": [0, 0, 1, 0.52], "far band": [0, 0.44, 1, 0.6], "low ground": [0, 0.56, 1, 1],
      "centre stage": [0.3, 0.28, 0.7, 0.8], "near edge": [0, 0.84, 1, 1], "whole frame": [0, 0, 1, 1] },
    order: { backdrop: ["upper air", "whole frame"], ground: ["low ground", "near edge"], distance: ["far band"],
      subject: ["centre stage"], accents: ["centre stage", "near edge", "upper air"] },
  },
  "tall centre": {
    about: "one tall subject standing in the middle, flanked by space on both sides",
    places: { "upper air": [0, 0, 1, 0.5], "low ground": [0, 0.72, 1, 1], "centre stage": [0.34, 0.08, 0.66, 0.92],
      "left wing": [0, 0.2, 0.32, 0.92], "right wing": [0.68, 0.2, 1, 0.92], "whole frame": [0, 0, 1, 1] },
    order: { backdrop: ["upper air", "whole frame"], ground: ["low ground"], distance: ["left wing", "right wing"],
      subject: ["centre stage"], accents: ["centre stage", "low ground"] },
  },
  "big sky": {
    about: "a low horizon with a large sky; a high light or moon; small land at the bottom",
    places: { "upper air": [0, 0, 1, 0.74], "far band": [0, 0.66, 1, 0.8], "low ground": [0, 0.76, 1, 1],
      "high point": [0.55, 0.07, 0.86, 0.36], "centre stage": [0.25, 0.42, 0.75, 0.86], "whole frame": [0, 0, 1, 1] },
    order: { backdrop: ["upper air", "whole frame"], ground: ["low ground"], distance: ["far band", "high point"],
      subject: ["centre stage", "high point"], accents: ["high point", "centre stage", "low ground"] },
  },
  "deep ground": {
    about: "a high horizon; most of the picture is ground or water receding into the distance",
    places: { "upper air": [0, 0, 1, 0.26], "far band": [0, 0.2, 1, 0.36], "low ground": [0, 0.3, 1, 1],
      "centre stage": [0.25, 0.36, 0.75, 0.84], "near edge": [0, 0.8, 1, 1], "whole frame": [0, 0, 1, 1] },
    order: { backdrop: ["upper air", "whole frame"], ground: ["low ground"], distance: ["far band"],
      subject: ["centre stage"], accents: ["near edge", "centre stage"] },
  },
  "side weight": {
    about: "the main mass on the left, an answering smaller shape on the right, open space between",
    places: { "upper air": [0, 0, 1, 0.5], "low ground": [0, 0.7, 1, 1], "left wing": [0.04, 0.14, 0.52, 0.92],
      "right wing": [0.6, 0.34, 0.96, 0.82], "far band": [0, 0.44, 1, 0.6], "whole frame": [0, 0, 1, 1] },
    order: { backdrop: ["upper air", "whole frame"], ground: ["low ground"], distance: ["far band", "right wing"],
      subject: ["left wing"], accents: ["left wing", "right wing"] },
  },
  "still life": {
    about: "a close view of an object on a table, a plain wall behind",
    places: { "back wall": [0, 0, 1, 0.64], "table top": [0, 0.58, 1, 1], "centre stage": [0.24, 0.18, 0.76, 0.86],
      "near edge": [0, 0.86, 1, 1], "left wing": [0, 0.2, 0.3, 0.8], "whole frame": [0, 0, 1, 1] },
    order: { backdrop: ["back wall", "whole frame"], ground: ["table top"], distance: ["left wing"],
      subject: ["centre stage"], accents: ["centre stage", "near edge"] },
  },
  "mirror water": {
    about: "a scene above a still water surface that repeats it below",
    places: { "upper air": [0, 0, 1, 0.44], "far band": [0, 0.36, 1, 0.52], "water plane": [0, 0.5, 1, 1],
      "centre stage": [0.28, 0.14, 0.72, 0.52], "near edge": [0, 0.86, 1, 1], "whole frame": [0, 0, 1, 1] },
    order: { backdrop: ["upper air", "whole frame"], ground: ["water plane"], distance: ["far band"],
      subject: ["centre stage", "water plane"], accents: ["water plane", "near edge"] },
  },
  "diagonal sweep": {
    about: "a strong diagonal from lower left to upper right, with movement along it",
    places: { "upper air": [0, 0, 1, 0.48], "low ground": [0, 0.54, 1, 1], "left wing": [0, 0.4, 0.52, 1],
      "right wing": [0.48, 0, 1, 0.62], "centre stage": [0.28, 0.28, 0.72, 0.72], "whole frame": [0, 0, 1, 1] },
    order: { backdrop: ["upper air", "whole frame"], ground: ["low ground", "left wing"], distance: ["right wing"],
      subject: ["centre stage"], accents: ["centre stage", "left wing"] },
  },
};

export const GRID = [];
for (const r of "ABCDE") for (let c = 1; c <= 5; c++) GRID.push(`${r}${c}`);

export function gridBox(cell) {
  const r = "ABCDE".indexOf(cell[0]);
  const c = Number(cell[1]) - 1;
  return [c / 5, r / 5, (c + 1) / 5, (r + 1) / 5];
}

export function placeBox(composition, place) {
  return GRID.includes(place) ? gridBox(place) : COMPOSITIONS[composition].places[place];
}

export const SOLID = ["horizontal band", "upright column", "round disc", "tall oval", "wide oval", "low mound",
  "pointed triangle", "block", "wedge", "broad wash"];
export const LINEAR = ["vertical hatching", "horizontal dashes", "slanted strokes", "cross-hatching", "dotted speckle",
  "flowing ribbon", "stacked arcs", "zigzag", "outline loop", "tangled scribble"];

export const MEDIUM = { // base width px, base alpha, grain power, blur px, blend
  "pencil": [2.0, 0.6, 1.6, 0.0, "over"],
  "ink pen": [2.2, 0.95, 0.0, 0.0, "over"],
  "felt marker": [9.0, 0.55, 0.2, 0.4, "glaze"],
  "charcoal": [7.0, 0.8, 1.4, 1.2, "over"],
  "watercolour": [15.0, 0.62, 0.5, 3.5, "glaze"],
  "oil pastel": [8.0, 0.92, 0.8, 0.3, "over"],
};
export const WEIGHT = { light: [0.55, 0.75], medium: [0.85, 1.0], heavy: [1.0, 1.35] }; // alpha mult, width mult
export const STROKE = { // jitter px, extra blur, broken dashes, overshoot
  "calm and even": [1.5, 0.0, false, 0.0],
  "energetic and loose": [4.5, 0.0, false, 0.12],
  "precise and controlled": [0.6, 0.0, false, 0.0],
  "rough and broken": [3.0, 0.0, true, 0.04],
  "soft and blended": [2.5, 1.6, false, 0.02],
};
export const SIZE = { small: 0.38, medium: 0.62, large: 0.92 };

// ------------------------------------------------------------------------------------------------ small numeric helpers
const f32 = Math.fround;

/** Python's round(): halves go to the even neighbour. */
export function roundHalfEven(x) {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** numpy.linspace (same formula: i * step + start, last value set to stop when endpoint). */
function linspace(a, b, num, endpoint = true) {
  const div = endpoint ? num - 1 : num;
  const step = (b - a) / div;
  const y = [];
  for (let i = 0; i < num; i++) y.push(i * step + a);
  if (endpoint && num > 1) y[num - 1] = b;
  return y;
}

function hypot2(dx, dy) {
  return Math.sqrt(dx * dx + dy * dy);
}

export function hexRgb(h) {
  const s = h.replace("#", "");
  return [0, 2, 4].map((i) => f32(parseInt(s.slice(i, i + 2), 16) / 255));
}

// ------------------------------------------------------------------------------------------------ strokes (geometry)
function jitterLine(pts0, rng, amp, broken, k) {
  const pts = pts0.map(([x, y]) => [f32(x), f32(y)]);
  const out = [pts[0]];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = f32(b[0] - a[0]);
    const dy = f32(b[1] - a[1]);
    const norm = f32(Math.sqrt(f32(f32(dx * dx) + f32(dy * dy))));
    const n = Math.max(2, Math.trunc(f32(norm / (6 * k))));
    const ts = linspace(0, 1, n + 1).slice(1);
    for (const t of ts) out.push([a[0] + dx * t, a[1] + dy * t]);
  }
  let res = out;
  if (amp > 0 && out.length > 2) {
    const L = out.length;
    const noise = [];
    for (let i = 0; i < L; i++) noise.push([f32(rng.normal(0, amp)), f32(rng.normal(0, amp))]);
    const m = Math.min(5, L);
    const off = Math.floor((m - 1) / 2);
    const inv = 1 / m;
    res = out.map((p, i) => {
      const j = i + off;
      const s = [0, 0];
      for (let q = 0; q < m; q++) {
        const idx = j - q;
        if (idx >= 0 && idx < L) {
          s[0] += noise[idx][0] * inv;
          s[1] += noise[idx][1] * inv;
        }
      }
      return [p[0] + s[0] * 1.8, p[1] + s[1] * 1.8];
    });
  }
  let segs = [res];
  if (broken && res.length > 8) {
    segs = [];
    let i = 0;
    while (i < res.length - 1) {
      const L = rng.integers(4, 14);
      segs.push(res.slice(i, i + L + 1));
      i += L + rng.integers(1, 4);
    }
  }
  return segs.filter((s) => s.length >= 2);
}

function drawLines(ops, lines, rng, width, amp, broken, k, value = 255) {
  for (const ln of lines) {
    for (const seg of jitterLine(ln, rng, amp, broken, k)) {
      const w = Math.max(1, roundHalfEven(width * rng.uniform(0.75, 1.25)));
      const fill = Math.trunc(value * rng.uniform(0.75, 1.0));
      ops.push({ op: "line", pts: seg, fill, width: w });
    }
  }
}

function shapePolygon(kind, bx, rng, amp, k) {
  const [x0, y0, x1, y1] = bx;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const w = x1 - x0;
  const h = y1 - y0;
  const t = linspace(0, 2 * Math.PI, 72, false);
  const ell = (rx, ry) => t.map((a) => [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  let P;
  if (kind === "round disc") {
    const r = Math.min(w, h) / 2;
    P = ell(r, r);
  } else if (kind === "tall oval") P = ell(Math.min(w, 0.62 * h) / 2, h / 2);
  else if (kind === "wide oval") P = ell(w / 2, Math.min(h, 0.62 * w) / 2);
  else if (kind === "low mound") {
    const tt = linspace(Math.PI, 2 * Math.PI, 48);
    P = tt.map((a) => [cx + (w / 2) * Math.cos(a), y1 + h * Math.sin(a)]).concat([[x1, y1], [x0, y1]]);
  } else if (kind === "pointed triangle") P = [[cx, y0], [x1, y1], [x0, y1]];
  else if (kind === "wedge") P = rng.random() < 0.5 ? [[x0, y1], [x1, y1], [x1, y0]] : [[x0, y0], [x0, y1], [x1, y1]];
  else if (kind === "upright column") {
    const cw = 0.42 * w;
    P = [[cx - cw / 2, y0], [cx + cw / 2, y0], [cx + cw / 2, y1], [cx - cw / 2, y1]];
  } else if (kind === "horizontal band") {
    const bh = Math.min(h, Math.max(0.35 * h, 0.18 * w));
    P = [[x0, cy - bh / 2], [x1, cy - bh / 2], [x1, cy + bh / 2], [x0, cy + bh / 2]];
  } else P = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; // block, broad wash
  const Q = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[i];
    const b = P[(i + 1) % P.length];
    const n = Math.max(2, Math.trunc(hypot2(b[0] - a[0], b[1] - a[1]) / (8 * k)));
    for (const s of linspace(0, 1, n, false)) Q.push([a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s]);
  }
  const sd = amp * 1.4 + (kind === "broad wash" ? 6 : 1.0) * k;
  const wob = Q.map(() => [rng.normal(0, sd), rng.normal(0, sd)]);
  const L = Q.length;
  return Q.map((p, i) => {
    const s = [0, 0];
    for (let q = 6; q >= 0; q--) { // convolve(pad(wrap, 3), ones(7)/7, 'valid'): circular mean of 7 centred on i
      const idx = (((i + q - 3) % L) + L) % L;
      s[0] += wob[idx][0] * (1 / 7);
      s[1] += wob[idx][1] * (1 / 7);
    }
    return [p[0] + s[0], p[1] + s[1]];
  });
}

const FILL_ANGLE = { "horizontal band": 0.0, "upright column": 90.0, "low mound": 8.0, "broad wash": 0.0 };

function fillStrokes(kind, bx, rng, width, spacingMult, k, angle = null) {
  const [x0, y0, x1, y1] = bx;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  if (angle === null) {
    const dflt = rng.uniform(-35, 35); // Python's dict.get(kind, rng.uniform(...)) always draws the default
    angle = kind in FILL_ANGLE ? FILL_ANGLE[kind] : dflt;
  }
  const th = (angle + rng.normal(0, 4)) * (Math.PI / 180); // math.radians
  const d = [Math.cos(th), Math.sin(th)];
  const nrm = [-d[1], d[0]];
  const R = hypot2(x1 - x0, y1 - y0) / 2 + 4 * k;
  const gap = Math.max(2.0 * k, width * spacingMult);
  const lines = [];
  const count = Math.ceil((R - -R) / gap);
  for (let i = 0; i < count; i++) {
    const off = -R + i * gap;
    const o = off + rng.normal(0, gap * 0.15);
    const c = [cx + nrm[0] * o, cy + nrm[1] * o];
    const L = R * rng.uniform(0.85, 1.05);
    lines.push([[c[0] - d[0] * L, c[1] - d[1] * L], [c[0] + d[0] * L, c[1] + d[1] * L]]);
  }
  return lines;
}

function linearStrokes(kind, bx, rng) {
  const [x0, y0, x1, y1] = bx;
  const w = x1 - x0;
  const h = y1 - y0;
  const U = (a, b) => rng.uniform(a, b);
  const L = [];
  if (kind === "vertical hatching") {
    for (let i = 0, n = rng.integers(6, 15); i < n; i++) {
      const x = U(x0, x1);
      const a = U(y0, y0 + 0.3 * h);
      L.push([[x, a], [x + U(-3, 3), a + U(0.5, 1.0) * (y1 - a)]]);
    }
  } else if (kind === "horizontal dashes") {
    for (let i = 0, n = rng.integers(6, 15); i < n; i++) {
      const y = U(y0, y1);
      const a = U(x0, x0 + 0.4 * w);
      L.push([[a, y], [a + U(0.3, 0.9) * (x1 - a), y + U(-3, 3)]]);
    }
  } else if (kind === "slanted strokes") {
    for (let i = 0, n = rng.integers(7, 16); i < n; i++) {
      const x = U(x0, x1);
      const y = U(y0, y1);
      const s = U(0.15, 0.35) * Math.max(w, h);
      L.push([[x - s * 0.5, y + s], [x + s * 0.5, y - s]]);
    }
  } else if (kind === "cross-hatching") {
    for (const sgn of [1, -1]) {
      for (let i = 0, n = rng.integers(6, 12); i < n; i++) {
        const x = U(x0, x1);
        const y = U(y0, y1);
        const s = U(0.15, 0.3) * Math.max(w, h);
        L.push([[x - s, y - sgn * s], [x + s, y + sgn * s]]);
      }
    }
  } else if (kind === "flowing ribbon") {
    const xs = linspace(x0, x1, 40);
    const ph = U(0, 6.28);
    const amp = U(0.15, 0.4) * h;
    const cy = U(y0 + 0.3 * h, y1 - 0.3 * h);
    const fr = U(4, 9);
    L.push(xs.map((x) => [x, cy + amp * Math.sin(ph + ((x - x0) / Math.max(w, 1)) * fr)]));
  } else if (kind === "stacked arcs") {
    const n = rng.integers(3, 7);
    for (let i = 0; i < n; i++) {
      const cy = y0 + ((i + 1) * h) / (n + 1);
      const cx = U(x0 + 0.3 * w, x1 - 0.3 * w);
      const rx = U(0.2, 0.5) * w;
      const ry = U(0.1, 0.3) * h;
      L.push(linspace(Math.PI, 2 * Math.PI, 24).map((t) => [cx + rx * Math.cos(t), cy + ry * Math.sin(t)]));
    }
  } else if (kind === "zigzag") {
    const n = rng.integers(6, 13);
    const xs = linspace(x0, x1, n);
    const ys = xs.map((_, i) => y0 + h * (i % 2 ? 0.2 : 0.8) + U(-0.1, 0.1) * h);
    L.push(xs.map((x, i) => [x, ys[i]]));
  } else if (kind === "outline loop") {
    const t = linspace(0, 2 * Math.PI, 60);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    for (let j = 0; j < 2; j++) {
      const fx = U(0.92, 1.0);
      const fy = U(0.92, 1.0);
      L.push(t.map((a) => [cx + (w / 2) * fx * Math.cos(a), cy + (h / 2) * fy * Math.sin(a)]));
    }
  } else if (kind === "tangled scribble") {
    let p = [U(x0, x1), U(y0, y1)];
    let v = [rng.normal(0, 1), rng.normal(0, 1)];
    const pts = [];
    for (let i = 0, n = rng.integers(90, 200); i < n; i++) {
      v = [0.8 * v[0] + rng.normal(0, 1.2), 0.8 * v[1] + rng.normal(0, 1.2)];
      const mx = Math.max(w, h);
      p = [Math.min(Math.max(p[0] + v[0] * mx * 0.03, x0), x1), Math.min(Math.max(p[1] + v[1] * mx * 0.03, y0), y1)];
      pts.push(p.slice());
    }
    L.push(pts);
  }
  return L;
}

/**
 * All random choices of one gesture -> a plan of raster operations (pure; runs in node). Mirrors Canvas.gesture of
 * the Python renderer line by line. d = {gesture, place, size, medium, fill, weight}.
 */
export function planGesture(paintingId, step, d, composition, strokeChar, n = W, media = MEDIUM) {
  const k = n / W;
  const rng = new Rng(seedString(paintingId, step));
  const box = placeBox(composition, d.place);
  const x0 = box[0] * n, x1 = box[2] * n, y0 = box[1] * n, y1 = box[3] * n;
  const f = d.gesture !== "broad wash" ? SIZE[d.size] : Math.max(SIZE[d.size], 0.75);
  const w = (x1 - x0) * f;
  const h = (y1 - y0) * f;
  const cx = x1 - x0 > w ? rng.uniform(x0 + w / 2, x1 - w / 2) : (x0 + x1) / 2;
  const cy = y1 - y0 > h ? rng.uniform(y0 + h / 2, y1 - h / 2) : (y0 + y1) / 2;
  const bx = [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
  const [baseW, alpha, grainP, blur, blend, sp = 1] = media[d.medium]; // sp: fill-line spacing (Gesture skin only)
  const [aMult, wMult] = WEIGHT[d.weight];
  const [amp0, sblur, broken, over] = STROKE[strokeChar];
  const amp = amp0 * k;
  const width = baseW * wMult * (n / 600);
  let bxs = bx;
  if (over) {
    const ex = (bx[2] - bx[0]) * over;
    const ey = (bx[3] - bx[1]) * over;
    bxs = [bx[0] - ex, bx[1] - ey, bx[2] + ex, bx[3] + ey];
  }
  const ops = [];
  const g = d.gesture;
  if (LINEAR.includes(g)) {
    const lines = linearStrokes(g, bxs, rng);
    drawLines(ops, lines, rng, width * (g === "flowing ribbon" ? 2.4 : 1.0), amp, broken, k);
  }
  if (g === "dotted speckle") {
    const [a0, b0, a1, b1] = bxs;
    for (let i = 0, cnt = rng.integers(60, 200); i < cnt; i++) {
      const x = rng.uniform(a0, a1);
      const y = rng.uniform(b0, b1);
      const r = Math.max(1.0 * k, width * rng.uniform(0.4, 0.9));
      ops.push({ op: "ellipse", box: [x - r, y - r, x + r, y + r], fill: Math.trunc(255 * rng.uniform(0.7, 1)) });
    }
  }
  if (!LINEAR.includes(g)) {
    const poly = shapePolygon(g, bxs, rng, amp, k);
    ops.push({ op: "polygon", pts: poly });
    let fill = d.fill;
    if (g === "broad wash") fill = fill === "thin wash" || fill === "solid fill" ? "thin wash" : fill;
    if (fill === "outline only") {
      drawLines(ops, [poly.concat([poly[0]])], rng, width * 1.1, amp, broken, k);
    } else {
      if (fill === "thin wash") {
        ops.push({ op: "wash", sigma: Math.max(2.0 * k, 0.03 * Math.max(w, h)) });
        drawLines(ops, fillStrokes(g, bxs, rng, width * 2.5, 1.6 * sp, k), rng, width * 2.5, amp, broken, k, 170);
      } else if (fill === "hatched fill") {
        drawLines(ops, fillStrokes(g, bxs, rng, width, 3.2 * sp, k, 45.0), rng, width, amp, broken, k);
      } else {
        drawLines(ops, fillStrokes(g, bxs, rng, width, 0.55 * sp, k), rng, width * 1.15, amp, broken, k);
      }
      ops.push({ op: "clip", sigma: 1.0 * k });
    }
  }
  return { bx, ops, blur: (blur + sblur) * k, grainP, alpha: alpha * aMult, blend, watercolour: d.medium === "watercolour", k };
}

// ------------------------------------------------------------------------------------------------ software rasteriser
export function fillPolygon(mask, n, pts, value) {
  let ymin = Infinity, ymax = -Infinity;
  for (const p of pts) {
    if (p[1] < ymin) ymin = p[1];
    if (p[1] > ymax) ymax = p[1];
  }
  const ya = Math.max(0, Math.ceil(ymin));
  const yb = Math.min(n - 1, Math.floor(ymax));
  const xs = [];
  for (let y = ya; y <= yb; y++) {
    xs.length = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if ((yi <= y && yj > y) || (yj <= y && yi > y)) xs.push(xi + ((y - yi) * (xj - xi)) / (yj - yi));
    }
    xs.sort((a, b) => a - b);
    const row = y * n;
    for (let q = 0; q + 1 < xs.length; q += 2) {
      const xa = Math.max(0, Math.ceil(xs[q]));
      const xb = Math.min(n - 1, Math.floor(xs[q + 1]));
      for (let x = xa; x <= xb; x++) mask[row + x] = value;
    }
  }
}

export function fillDisc(mask, n, cx, cy, rx, ry, value) {
  if (rx <= 0 || ry <= 0) return;
  const ya = Math.max(0, Math.ceil(cy - ry));
  const yb = Math.min(n - 1, Math.floor(cy + ry));
  for (let y = ya; y <= yb; y++) {
    const t = (y - cy) / ry;
    const half = rx * Math.sqrt(Math.max(0, 1 - t * t));
    const xa = Math.max(0, Math.ceil(cx - half));
    const xb = Math.min(n - 1, Math.floor(cx + half));
    const row = y * n;
    for (let x = xa; x <= xb; x++) mask[row + x] = value;
  }
}

function drawPolyline(mask, n, pts, value, width) {
  if (width <= 1) { // one-pixel line (DDA), like Pillow's width-1 lines
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay))));
      for (let s = 0; s <= steps; s++) {
        const x = Math.round(ax + ((bx - ax) * s) / steps);
        const y = Math.round(ay + ((by - ay) * s) / steps);
        if (x >= 0 && y >= 0 && x < n && y < n) mask[y * n + x] = value;
      }
    }
    return;
  }
  const hw = width / 2;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const len = hypot2(bx - ax, by - ay);
    if (len < 1e-9) continue;
    const nx = (-(by - ay) / len) * hw;
    const ny = ((bx - ax) / len) * hw;
    fillPolygon(mask, n, [[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]], value);
    if (i > 0) fillDisc(mask, n, ax, ay, hw, hw, value); // joint="curve"
  }
}

function rasterOp(mask, n, op) {
  if (op.op === "line") drawPolyline(mask, n, op.pts, op.fill, op.width);
  else if (op.op === "ellipse") {
    const [a, b, c, e] = op.box;
    fillDisc(mask, n, (a + c) / 2, (b + e) / 2, (c - a) / 2, (e - b) / 2, op.fill);
  }
}

// Pillow's Gaussian blur: 3 passes of an extended (fractional) box per axis, edges clamped.
function boxRadius(sigma, passes = 3) {
  const s2 = (sigma * sigma) / passes;
  const L = Math.sqrt(12 * s2 + 1);
  const l = Math.floor((L - 1) / 2);
  let a = (2 * l + 1) * (l * (l + 1) - 3 * s2);
  a /= 6 * (s2 - (l + 1) * (l + 1));
  return l + a;
}

function boxLine(src, dst, off, stride, len, r) {
  const l = Math.floor(r);
  const fr = r - l;
  const ww = 1 / (2 * r + 1);
  const at = (i) => src[off + Math.min(len - 1, Math.max(0, i)) * stride];
  let acc = 0;
  for (let i = -l; i <= l; i++) acc += at(i);
  for (let i = 0; i < len; i++) {
    dst[off + i * stride] = (acc + fr * (at(i - l - 1) + at(i + l + 1))) * ww;
    acc += at(i + l + 1) - at(i - l);
  }
}

/** Gaussian blur of a float mask (0..255) inside a bounding box [xa, ya, xb, yb] (inclusive); returns a new array. */
export function gaussianBlur(src, n, sigma, bbox = null) {
  const out = Float32Array.from(src);
  if (!(sigma > 0)) return out;
  const r = boxRadius(sigma);
  let [xa, ya, xb, yb] = bbox || [0, 0, n - 1, n - 1];
  const pad = Math.ceil(3 * (r + 1)) + 2;
  xa = Math.max(0, xa - pad); ya = Math.max(0, ya - pad); xb = Math.min(n - 1, xb + pad); yb = Math.min(n - 1, yb + pad);
  const bw = xb - xa + 1;
  const bh = yb - ya + 1;
  let a = new Float32Array(bw * bh);
  let b = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) a[y * bw + x] = src[(y + ya) * n + x + xa];
  for (let p = 0; p < 3; p++) {
    for (let y = 0; y < bh; y++) boxLine(a, b, y * bw, 1, bw, r);
    [a, b] = [b, a];
  }
  for (let p = 0; p < 3; p++) {
    for (let x = 0; x < bw; x++) boxLine(a, b, x, bw, bh, r);
    [a, b] = [b, a];
  }
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) out[(y + ya) * n + x + xa] = Math.round(a[y * bw + x]);
  return out;
}

export function bboxOf(mask, n) {
  let xa = n, ya = n, xb = -1, yb = -1;
  for (let y = 0; y < n; y++) {
    const row = y * n;
    for (let x = 0; x < n; x++) {
      if (mask[row + x] > 0) {
        if (x < xa) xa = x;
        if (x > xb) xb = x;
        if (y < ya) ya = y;
        yb = y;
      }
    }
  }
  return xb < 0 ? null : [xa, ya, xb, yb];
}

// Pillow-style separable resampling with the bicubic filter (a = -0.5), used once for the paper's low-frequency noise.
function bicubic(x) {
  const a = -0.5;
  x = Math.abs(x);
  if (x < 1) return ((a + 2) * x - (a + 3)) * x * x + 1;
  if (x < 2) return (((x - 5) * x + 8) * x - 4) * a;
  return 0;
}

function resampleAxis(src, inN, outN, other, horizontal) {
  const out = new Float32Array(outN * other);
  const scale = inN / outN;
  const fs = Math.max(scale, 1);
  const support = 2 * fs;
  for (let o = 0; o < outN; o++) {
    const center = (o + 0.5) * scale;
    const xmin = Math.max(Math.trunc(center - support + 0.5), 0);
    const xmax = Math.min(Math.trunc(center + support + 0.5), inN);
    const ws = [];
    let tot = 0;
    for (let x = xmin; x < xmax; x++) {
      const v = bicubic((x - center + 0.5) / fs);
      ws.push(v);
      tot += v;
    }
    for (let q = 0; q < other; q++) {
      let s = 0;
      for (let x = xmin; x < xmax; x++) s += ws[x - xmin] * (horizontal ? src[q * inN + x] : src[x * other + q]);
      const v = Math.min(255, Math.max(0, Math.round(s / tot)));
      if (horizontal) out[q * outN + o] = v;
      else out[o * other + q] = v;
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ canvas
export class PaintCanvas {
  constructor(paperHex, paintingId, size = W) {
    const n = (this.n = size);
    this.paintingId = paintingId;
    const rng = new Rng(seedString(paintingId, "paper"));
    const base = hexRgb(paperHex);
    const m = Math.floor(n / 8);
    const low0 = new Float32Array(m * m);
    for (let i = 0; i < m * m; i++) low0[i] = Math.trunc(rng.random() * 255);
    const lowH = resampleAxis(low0, m, n, m, true); // m rows x n cols
    const low = (this.low = resampleAxis(lowH, m, n, n, false)); // n rows x n cols (kept for the Gesture wash)
    const g0 = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) g0[i] = Math.trunc(rng.random() * 255);
    const gb = gaussianBlur(g0, n, 0.8);
    let gmin = Infinity, gmax = -Infinity;
    for (let i = 0; i < n * n; i++) {
      gb[i] /= 255;
      if (gb[i] < gmin) gmin = gb[i];
      if (gb[i] > gmax) gmax = gb[i];
    }
    this.grain = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) this.grain[i] = (gb[i] - gmin) / (gmax - gmin + 1e-6);
    this.px = new Float32Array(n * n * 3);
    for (let i = 0; i < n * n; i++) {
      const lf = (low[i] / 255 - 0.5) * 0.035;
      for (let c = 0; c < 3; c++) this.px[i * 3 + c] = Math.min(1, Math.max(0, base[c] + lf + (this.grain[i] - 0.5) * 0.02));
    }
  }

  /** Plan + rasterise + composite one gesture; returns the plan (for traces and tests). */
  gesture(step, d, composition, colourHex, strokeChar, media = MEDIUM) {
    const n = this.n;
    const plan = planGesture(this.paintingId, step, d, composition, strokeChar, n, media);
    let mask = new Float32Array(n * n);
    let shape = null;
    for (const op of plan.ops) {
      if (op.op === "polygon") {
        shape = new Float32Array(n * n);
        fillPolygon(shape, n, op.pts, 255);
      } else if (op.op === "wash") {
        const sm = gaussianBlur(shape, n, op.sigma, bboxOf(shape, n));
        mask = new Float32Array(n * n);
        for (let i = 0; i < n * n; i++) mask[i] = Math.trunc(sm[i] * 0.9);
      } else if (op.op === "clip") {
        const sb = gaussianBlur(shape, n, op.sigma, bboxOf(shape, n));
        for (let i = 0; i < n * n; i++) mask[i] = Math.trunc((mask[i] * sb[i]) / 255);
      } else rasterOp(mask, n, op);
    }
    const bb = bboxOf(mask, n);
    if (!bb) return plan;
    if (plan.blur > 0) mask = gaussianBlur(mask, n, plan.blur, bb);
    const M = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) M[i] = mask[i] / 255;
    if (plan.grainP > 0) for (let i = 0; i < n * n; i++) M[i] *= 0.35 + 0.65 * Math.pow(this.grain[i], plan.grainP);
    if (plan.watercolour) {
      const q = new Float32Array(n * n);
      for (let i = 0; i < n * n; i++) q[i] = Math.trunc(M[i] * 255);
      const qb = gaussianBlur(q, n, 4 * plan.k, bboxOf(q, n) || bb);
      for (let i = 0; i < n * n; i++) {
        const edge = Math.min(1, Math.max(0, M[i] - qb[i] / 255));
        M[i] = Math.min(1, Math.max(0, M[i] * 0.85 + edge * 1.4));
      }
    }
    const col = hexRgb(colourHex);
    const px = this.px;
    const glaze = plan.blend === "glaze";
    for (let i = 0; i < n * n; i++) {
      const A = Math.min(1, Math.max(0, M[i] * plan.alpha));
      if (A === 0) continue;
      for (let c = 0; c < 3; c++) {
        const p = px[i * 3 + c];
        const top = glaze ? 0.55 * p * col[c] + 0.45 * col[c] : col[c];
        px[i * 3 + c] = p * (1 - A) + top * A;
      }
    }
    return plan;
  }

  /** RGBA bytes (astype(uint8) truncation, as the Python image()). */
  rgba() {
    const n = this.n;
    const out = new Uint8ClampedArray(n * n * 4);
    for (let i = 0; i < n * n; i++) {
      for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.trunc(Math.min(1, Math.max(0, this.px[i * 3 + c])) * 255);
      out[i * 4 + 3] = 255;
    }
    return out;
  }
}

// ------------------------------------------------------------------------------------------------ palette engine (Round 15 A1)
export const MOODS = { calm: "quiet and peaceful", stormy: "dark, wild weather", warm: "sunny, cosy heat",
  eerie: "strange, uneasy, ghostly", joyful: "bright and happy", austere: "plain, sparse, severe" };
export const HARMONIES = { analogous: "neighbouring hues", complementary: "a hue and its opposite",
  "split-complementary": "a hue and the two hues beside its opposite", triadic: "three evenly spaced hues",
  monochrome: "one hue in light and dark" };
export const HUES = { red: 27.0, orange: 55.0, yellow: 100.0, green: 142.0, teal: 192.0, blue: 255.0, violet: 300.0, pink: 350.0 };
export const KEYS = { light: "mostly pale values", mid: "middle values", dark: "mostly deep values" };
export const SATS = { muted: "soft, greyish colour", moderate: "natural colour", vivid: "intense, pure colour" };
export const ROLES = ["dominant", "secondary", "accent", "neutral", "shadow", "highlight"];
const KEY_L = { light: 0.8, mid: 0.62, dark: 0.4 };
const SAT_C = { muted: 0.055, moderate: 0.095, vivid: 0.15 };
const MOOD_MOD = { calm: [0.03, 0.8, -8.0], stormy: [-0.08, 0.6, -15.0], warm: [0.0, 1.1, 15.0],
  eerie: [-0.1, 0.85, -12.0], joyful: [0.06, 1.25, 8.0], austere: [0.0, 0.45, 0.0] };
const HARMONY_OFF = { analogous: [30.0, -35.0], complementary: [180.0, 165.0], "split-complementary": [150.0, 210.0],
  triadic: [120.0, 240.0], monochrome: [0.0, 0.0] };
const L_MIN = 0.18, L_MAX = 0.92, C_MAX = 0.22;
const PAPER = [0.965, 0.012, 85.0];
const rad = (d) => d * (Math.PI / 180); // math.radians
const mod360 = (x) => ((x % 360) + 360) % 360;
const pyMod = (a, b) => ((a % b) + b) % b;

export function oklchToSrgb(L, C, H) {
  const a = C * Math.cos(rad(H));
  const b = C * Math.sin(rad(H));
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return lin.map((c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.sign(c) * Math.abs(c) ** (1 / 2.4) - 0.055));
}

function inGamut(L, C, H, eps = 1e-4) {
  return oklchToSrgb(L, C, H).every((c) => c >= -eps && c <= 1 + eps);
}

export function srgbToOklab(rgb) {
  const lin = rgb.map((c) => (c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92));
  const M1 = [[0.4122214708, 0.5363325363, 0.0514459929], [0.2119034982, 0.6806995451, 0.1073969566],
    [0.0883024619, 0.2817188376, 0.6299787005]];
  const lms = M1.map((r) => Math.cbrt(r[0] * lin[0] + r[1] * lin[1] + r[2] * lin[2]));
  const M2 = [[0.2104542553, 0.793617785, -0.0040720468], [1.9779984951, -2.428592205, 0.4505937099],
    [0.0259040371, 0.7827717662, -0.808675766]];
  return M2.map((r) => r[0] * lms[0] + r[1] * lms[1] + r[2] * lms[2]);
}

function lchOfRgb(rgb) {
  const [L, a, b] = srgbToOklab(rgb);
  return [L, Math.hypot(a, b), mod360((Math.atan2(b, a) * 180) / Math.PI)];
}

function hexToOklch(h) { // float64 channels, as engine.hex_to_oklch
  const s = h.replace("#", "");
  return lchOfRgb([0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255));
}

function toHex(L, C, H) {
  while (C > 0 && !inGamut(L, C, H)) C = Math.max(0, C - 0.004);
  return "#" + oklchToSrgb(L, C, H).map((c) => roundHalfEven(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0")).join("");
}

function pull(H, deg) {
  if (deg === 0) return mod360(H);
  const target = deg > 0 ? 60.0 : 250.0;
  const d = pyMod(target - H + 180, 360) - 180;
  return mod360(H + Math.sign(d || 1) * Math.min(Math.abs(deg), Math.abs(d)));
}

function hueName(H) {
  let best = null, bd = Infinity;
  for (const [n, v] of Object.entries(HUES)) {
    const d = Math.abs(pyMod(v - H + 180, 360) - 180);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

/** 'dark, cool blue': value word, temperature word, hue word, from OKLCH. */
export function describe(L, C, H) {
  const value = L < 0.3 ? "deep" : L < 0.45 ? "dark" : L < 0.7 ? "mid" : L < 0.86 ? "light" : "very light";
  if (C < 0.03) {
    const name = L < 0.35 ? "charcoal" : L > 0.88 ? "white" : "grey";
    return `${value}, neutral ${name}`;
  }
  const warm = H < 115 || H >= 330;
  let name = hueName(H);
  if (C < 0.07 && warm && L > 0.7) name = "sand";
  return `${value}, ${warm ? "warm" : "cool"} ${name}`;
}

const _engineCache = new Map();

/** look = {mood, harmony, hue, key, saturation} -> {roles: [[role, hex]], paper, words: {role: descriptor}} */
export function enginePalette(look) {
  const ck = [look.mood, look.harmony, look.hue, look.key, look.saturation].join("|");
  if (_engineCache.has(ck)) return _engineCache.get(ck);
  const [dL, cf, pl] = MOOD_MOD[look.mood];
  const H = pull(HUES[look.hue], pl);
  const L0 = Math.min(L_MAX, Math.max(L_MIN, KEY_L[look.key] + dL));
  const C0 = Math.min(C_MAX, Math.max(0.035 / 0.8, SAT_C[look.saturation] * cf));
  const [o2, o3] = HARMONY_OFF[look.harmony];
  const clampL = (v) => Math.min(L_MAX, Math.max(L_MIN, v));
  const lch = {
    dominant: [L0, C0, H],
    secondary: [clampL(L0 > 0.55 ? L0 - 0.14 : L0 + 0.16), C0 * 0.8, mod360(H + o2)],
    accent: [L0 >= 0.6 ? 0.52 : 0.72, Math.min(C_MAX, Math.max(C0 * 1.6, 0.08 * cf)), mod360(H + o3)],
    neutral: [{ light: 0.82, mid: 0.7, dark: 0.55 }[look.key], 0.022, H],
    shadow: [look.key === "dark" ? 0.18 : 0.24, Math.min(0.06, C0), pull(H, -30.0)],
    highlight: [0.86, look.saturation === "vivid" ? 0.06 : 0.045, pull(H, 40.0)],
  };
  const roles = ROLES.map((r) => [r, toHex(...lch[r])]);
  const words = Object.fromEntries(roles.map(([r, h]) => [r, describe(...hexToOklch(h))]));
  const res = { roles, paper: toHex(...PAPER), words };
  _engineCache.set(ck, res);
  return res;
}

// ------------------------------------------------------------------------------------------------ read-back (5x5 words)
function lab(r, g, b) {
  const lin = (c) => (c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92);
  const R = lin(r), G = lin(g), B = lin(b);
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.9505;
  const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.089;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/**
 * Round 12's read-back rule over the six role colours (Round 15 wording): every 3rd pixel -> nearest of paper, the
 * colours and their pale tints (CIELAB); per cell the coverage words, then the main colour's value/temperature words.
 * Reads the canvas's real pixels. Returns {cell: phrase} for A1..E5.
 */
export function readback(canvas, palette) {
  const pp = hexRgb(palette.paper);
  const roles = palette.roles.map(([r]) => r);
  const cols = palette.roles.map(([, h]) => hexRgb(h));
  const tints = cols.map((c) => c.map((v, i) => f32((v + pp[i]) / 2)));
  const names = ["paper", ...roles, ...roles.map((r) => `pale ${r}`)];
  const words = [null, ...roles.map((r) => palette.words[r]), ...tints.map((t) => describe(...lchOfRgb(t)))];
  const ref = [pp, ...cols, ...tints].map((c) => lab(c[0], c[1], c[2]));
  const n0 = canvas.n;
  const step = n0 >= 300 ? 3 : 1;
  const ns = Math.ceil(n0 / step);
  const idx = new Uint8Array(ns * ns);
  const px = canvas.px;
  let pr = NaN, pg = NaN, pb = NaN, prev = 0; // flat paint repeats: the same colour gives the same nearest reference
  for (let y = 0; y < ns; y++) {
    for (let x = 0; x < ns; x++) {
      const i = (y * step * n0 + x * step) * 3;
      if (px[i] === pr && px[i + 1] === pg && px[i + 2] === pb) {
        idx[y * ns + x] = prev;
        continue;
      }
      const L = lab(px[i], px[i + 1], px[i + 2]);
      let best = 0, bd = Infinity;
      for (let q = 0; q < ref.length; q++) {
        const d = (L[0] - ref[q][0]) ** 2 + (L[1] - ref[q][1]) ** 2 + (L[2] - ref[q][2]) ** 2;
        if (d < bd) { bd = d; best = q; }
      }
      idx[y * ns + x] = best;
      pr = px[i]; pg = px[i + 1]; pb = px[i + 2]; prev = best;
    }
  }
  const out = {};
  "ABCDE".split("").forEach((R, r) => {
    for (let c = 0; c < 5; c++) {
      const counts = new Array(names.length).fill(0);
      let tot = 0;
      for (let y = Math.floor((r * ns) / 5); y < Math.floor(((r + 1) * ns) / 5); y++) {
        for (let x = Math.floor((c * ns) / 5); x < Math.floor(((c + 1) * ns) / 5); x++) {
          counts[idx[y * ns + x]]++;
          tot++;
        }
      }
      const frac = counts.map((v) => v / tot);
      const cov = 1 - frac[0];
      const cell = `${R}${c + 1}`;
      if (cov < 0.05) {
        out[cell] = "empty paper";
        continue;
      }
      const paint = frac.slice(1);
      const order = paint.map((v, i) => i).sort((a, b) => paint[b] - paint[a] || a - b);
      const X = names[order[0] + 1];
      const Y = names[order[1] + 1];
      const w = words[order[0] + 1];
      const mix = paint[order[1]] / Math.max(cov, 1e-6) >= 0.2 ? `${X}, some ${Y}` : X;
      const ph = cov < 0.35 ? `a little ${X} on paper` : cov < 0.75 ? `${mix}, paper showing` : `mostly ${mix}`;
      out[cell] = `${ph} (${w})`;
    }
  });
  return out;
}

// ------------------------------------------------------------------------------------------------ skins
export const SKINS = ["paint", "pixel", "sketch"];
export const PIXEL_N = 64;
const PIXEL_WORK = 192; // marks are drawn at 192 px (k = 0.32), averaged 3x3 down to 64, then snapped to the palette

/** Sketch: line gestures stay; solid shapes become outlines; broad washes become light level hatching; ink on paper. */
export function sketchDecision(d) {
  const g = d.gesture === "broad wash" ? "horizontal dashes" : d.gesture;
  return { ...d, gesture: g, medium: "ink pen", fill: "outline only" };
}

export function sketchColour(role, palette) {
  const hexes = Object.fromEntries(palette.roles);
  return role === "accent" ? hexes.accent : hexes.shadow;
}

/** A painter for one painting in one skin: same decisions in, pixels out. */
export class SkinPainter {
  constructor(skin, palette, paintingId) {
    this.skin = skin;
    this.palette = palette;
    this.hexes = Object.fromEntries(palette.roles);
    this.canvas = new PaintCanvas(palette.paper, paintingId, skin === "pixel" ? PIXEL_WORK : W);
    this.outN = skin === "pixel" ? PIXEL_N : W;
  }

  mark(step, d, composition, stroke) {
    if (this.skin === "sketch") {
      return this.canvas.gesture(step, sketchDecision(d), composition, sketchColour(d.colour, this.palette), "precise and controlled");
    }
    return this.canvas.gesture(step, d, composition, this.hexes[d.colour], stroke);
  }

  /** The canvas the read-back sees: the paint canvas, or the snapped pixel grid. */
  view() {
    if (this.skin !== "pixel") return this.canvas;
    return pixelSnap(this.canvas, this.palette);
  }

  rgba() {
    return this.view().rgba ? this.view().rgba() : null;
  }
}

/** 192 px canvas -> 64 px, every pixel snapped to the nearest of paper + the six role colours (CIELAB). */
export function pixelSnap(canvas, palette) {
  const f = canvas.n / PIXEL_N;
  const cols = [hexRgb(palette.paper), ...palette.roles.map(([, h]) => hexRgb(h))];
  const labs = cols.map((c) => lab(...c));
  const px = new Float32Array(PIXEL_N * PIXEL_N * 3);
  for (let y = 0; y < PIXEL_N; y++) {
    for (let x = 0; x < PIXEL_N; x++) {
      const s = [0, 0, 0];
      for (let dy = 0; dy < f; dy++) {
        for (let dx = 0; dx < f; dx++) {
          const i = ((y * f + dy) * canvas.n + x * f + dx) * 3;
          s[0] += canvas.px[i]; s[1] += canvas.px[i + 1]; s[2] += canvas.px[i + 2];
        }
      }
      const L = lab(s[0] / (f * f), s[1] / (f * f), s[2] / (f * f));
      let best = 0, bd = Infinity;
      labs.forEach((r, q) => {
        const d = (L[0] - r[0]) ** 2 + (L[1] - r[1]) ** 2 + (L[2] - r[2]) ** 2;
        if (d < bd) { bd = d; best = q; }
      });
      const o = (y * PIXEL_N + x) * 3;
      px[o] = cols[best][0]; px[o + 1] = cols[best][1]; px[o + 2] = cols[best][2];
    }
  }
  return {
    n: PIXEL_N,
    px,
    rgba() {
      const out = new Uint8ClampedArray(PIXEL_N * PIXEL_N * 4);
      for (let i = 0; i < PIXEL_N * PIXEL_N; i++) {
        for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round(px[i * 3 + c] * 255);
        out[i * 4 + 3] = 255;
      }
      return out;
    },
  };
}

/** Distinct colours in RGBA bytes, ignoring colours under `minShare` of the pixels (counts what the eye sees). */
export function colourCount(rgba, minShare = 0.002, quant = 24) {
  const counts = new Map();
  const N = rgba.length / 4;
  for (let i = 0; i < N; i++) {
    const key = `${Math.round(rgba[i * 4] / quant)},${Math.round(rgba[i * 4 + 1] / quant)},${Math.round(rgba[i * 4 + 2] / quant)}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let k = 0;
  for (const v of counts.values()) if (v / N >= minShare) k++;
  return k;
}
