// Impasto (Probability Map tab): thick oil paint drawn from a per-cell probability field. Pure JavaScript on typed
// arrays; every random number comes from the seeded RNG or a seeded hash (no Math.random). At output size N (k = N / 600):
//  a) underpainting: each cell's probability-weighted mean colour in linear light, upsampled smoothly (bilinear between
//     cell centres, then a light box blur);
//  b) contour field: luminance, Sobel gradient, smoothed structure tensor; strokes run perpendicular to the gradient
//     (along the luminance contours); where the tensor is weak a smooth seeded noise direction takes over;
//  c) strokes: seeded short polylines (3-8 steps of 3-6 px, 4-10 px wide, N^2 / 90 of them, at most 5000); each
//     stroke's pigment is a SAMPLE from the distribution of the cell under its start. The uniform number behind each
//     draw is spatially correlated (smooth seeded noise, then ranked so it stays uniform), so neighbouring strokes
//     tend to pick the same role and colour masses form instead of confetti;
//  d) relief: a bristle-ridge height profile per stroke, its amplitude scaled by the cell's normalised entropy
//     (uncertain cells get thicker, more broken paint);
//  e) lighting: normals from the height map (plus a fine canvas weave), directional diffuse plus a small specular term.
// The page shows preview() (the underpainting at a quarter size) at once and then runs composite() in slices between
// animation frames. composite() depends only on the field, palette, seed and size, never on previews or slicing.
import { W } from "./render.js";
import { Rng, fnv1a, seedString, valueNoise } from "./rng.js";
import { R, entropy } from "./field.js";

const hexLin = (h) => [1, 3, 5].map((i) => {
  const c = parseInt(h.slice(i, i + 2), 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
const linToSrgb = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const PIGMENT = 0.62; // a stroke's colour: this much of its sampled role, the rest the local mean (keeps masses readable)

// ------------------------------------------------------------------------------------------------ separable box blur
function boxPass(src, dst, N, ch, r, horizontal) {
  const inv = 1 / (2 * r + 1);
  for (let line = 0; line < N; line++) {
    for (let c = 0; c < ch; c++) {
      const at = horizontal ? (i) => src[(line * N + (i < 0 ? 0 : i >= N ? N - 1 : i)) * ch + c]
        : (i) => src[((i < 0 ? 0 : i >= N ? N - 1 : i) * N + line) * ch + c];
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += at(i);
      for (let i = 0; i < N; i++) {
        dst[(horizontal ? line * N + i : i * N + line) * ch + c] = acc * inv;
        acc += at(i + r + 1) - at(i - r);
      }
    }
  }
}

/** Two horizontal + two vertical box passes (close to a Gaussian); yields between passes. Returns a new array. */
function* boxBlur(src, N, ch, r) {
  let a = Float32Array.from(src);
  let b = new Float32Array(src.length);
  for (const horizontal of [true, true, false, false]) {
    boxPass(a, b, N, ch, r, horizontal);
    [a, b] = [b, a];
    yield;
  }
  return a;
}

/** Per-cell mean colour (linear light) and normalised entropy of a field. */
export function cellMeans(field, palette) {
  const lin = palette.roles.map(([, h]) => hexLin(h));
  const { g, p } = field;
  const mean = new Float32Array(g * g * 3);
  const ent = new Float32Array(g * g);
  for (let i = 0; i < g * g; i++) {
    for (let r = 0; r < R; r++) {
      const w = p[i * R + r];
      mean[i * 3] += w * lin[r][0];
      mean[i * 3 + 1] += w * lin[r][1];
      mean[i * 3 + 2] += w * lin[r][2];
    }
    ent[i] = entropy(p, i * R);
  }
  return { mean, ent, lin };
}

/** Bilinear upsampling of a g x g grid of `ch` channels (sampled at cell centres) to N x N. */
function upsample(src, g, N, ch) {
  const out = new Float32Array(N * N * ch);
  const s = g / N;
  for (let y = 0; y < N; y++) {
    const fy = Math.min(g - 1, Math.max(0, (y + 0.5) * s - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(g - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < N; x++) {
      const fx = Math.min(g - 1, Math.max(0, (x + 0.5) * s - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(g - 1, x0 + 1), tx = fx - x0;
      for (let c = 0; c < ch; c++) {
        const a = src[(y0 * g + x0) * ch + c], b = src[(y0 * g + x1) * ch + c];
        const e = src[(y1 * g + x0) * ch + c], f = src[(y1 * g + x1) * ch + c];
        out[(y * N + x) * ch + c] = (a + (b - a) * tx) * (1 - ty) + (e + (f - e) * tx) * ty;
      }
    }
  }
  return out;
}

function toView(lin, N, extra = {}) {
  const rgba = new Uint8ClampedArray(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    for (let c = 0; c < 3; c++) rgba[i * 4 + c] = Math.round(clamp01(linToSrgb(clamp01(lin[i * 3 + c]))) * 255);
    rgba[i * 4 + 3] = 255;
  }
  return { n: N, rgba: () => rgba, ...extra };
}

export class MapImpasto {
  constructor(field, palette, id, size = W) {
    this.field = field;
    this.palette = palette;
    this.id = id;
    this.N = size;
    this.cache = null;
  }

  /** The cheap preview: the smooth mean-colour underpainting at a quarter of the size. */
  preview() {
    const n = Math.max(32, Math.round(this.N / 4));
    const { mean } = cellMeans(this.field, this.palette);
    return toView(upsample(mean, this.field.g, n, 3), n);
  }

  /** The flat underpainting at full size (the T7 texture test compares against it). */
  underpainting() {
    const { mean } = cellMeans(this.field, this.palette);
    return toView(upsample(mean, this.field.g, this.N, 3), this.N);
  }

  /** The full composite (generator; yields often; returns the view, with the height map for tests). */
  *composite() {
    const N = this.N, k = N / W, g = this.field.g;
    const { mean: cellMean, ent, lin } = cellMeans(this.field, this.palette);
    // a) underpainting
    const up = upsample(cellMean, g, N, 3);
    yield;
    const mean = yield* boxBlur(up, N, 3, Math.max(1, Math.round((N / g) * 0.35)));
    // b) luminance, Sobel gradient, structure tensor
    const lum = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) lum[i] = 0.2126 * mean[i * 3] + 0.7152 * mean[i * 3 + 1] + 0.0722 * mean[i * 3 + 2];
    yield;
    const J = new Float32Array(N * N * 3);
    const L = (x, y) => lum[(y < 0 ? 0 : y >= N ? N - 1 : y) * N + (x < 0 ? 0 : x >= N ? N - 1 : x)];
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const gx = L(x + 1, y - 1) + 2 * L(x + 1, y) + L(x + 1, y + 1) - L(x - 1, y - 1) - 2 * L(x - 1, y) - L(x - 1, y + 1);
        const gy = L(x - 1, y + 1) + 2 * L(x, y + 1) + L(x + 1, y + 1) - L(x - 1, y - 1) - 2 * L(x, y - 1) - L(x + 1, y - 1);
        const i = (y * N + x) * 3;
        J[i] = gx * gx;
        J[i + 1] = gx * gy;
        J[i + 2] = gy * gy;
      }
      if ((y & 63) === 63) yield;
    }
    const T = yield* boxBlur(J, N, 3, Math.max(1, Math.round(7 * k)));
    // c) stroke plan: positions first, so the pigment draws can be ranked into uniform, spatially correlated numbers
    const rng = new Rng(seedString(this.id, "impasto", "strokes"));
    const seedDir = fnv1a(seedString(this.id, "impasto", "direction"));
    const seedPig = fnv1a(seedString(this.id, "impasto", "pigment"));
    const seedTint = fnv1a(seedString(this.id, "impasto", "tint"));
    const count = Math.min(5000, Math.max(150, Math.round((N * N) / 90)));
    const gq = Math.ceil(Math.sqrt(count));
    const slots = Array.from({ length: gq * gq }, (_, i) => i);
    for (let i = slots.length - 1; i > 0; i--) { // seeded Fisher-Yates: no visible order of overlaps
      const j = Math.floor(rng.random() * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    const cw = N / gq;
    const plan = [];
    for (let q = 0; q < count; q++) {
      const s = slots[q];
      const x = ((s % gq) + rng.random()) * cw, y = (Math.floor(s / gq) + rng.random()) * cw;
      const raw = 0.7 * valueNoise(seedPig, x / (70 * k), y / (70 * k)) + 0.2 * valueNoise(seedPig + 1, x / (24 * k), y / (24 * k)) + 0.1 * rng.random();
      plan.push({ x, y, raw, steps: rng.integers(3, 9), stepLen: Math.max(1, rng.uniform(3, 6) * k),
        width: Math.max(1.5, rng.uniform(4, 10) * k), sign: rng.random() < 0.5 ? -1 : 1, phase: rng.uniform(0, 6.283) });
    }
    const order = plan.map((_, i) => i).sort((a, b) => plan[a].raw - plan[b].raw || a - b);
    order.forEach((i, rank) => { plan[i].u = (rank + 0.5) / count; });
    yield;
    const tau = 0.002;
    const dirAt = (x, y) => {
      const xi = Math.min(N - 1, Math.max(0, Math.round(x))), yi = Math.min(N - 1, Math.max(0, Math.round(y)));
      const i = (yi * N + xi) * 3;
      const a = T[i], b = T[i + 1], c = T[i + 2];
      const mag = a + c;
      const w = mag / (mag + tau);
      const g2 = Math.atan2(2 * b, a - c) + Math.PI; // doubled angle of the contour (gradient + 90 degrees)
      const nz = 4 * Math.PI * (0.65 * valueNoise(seedDir, x / (70 * k), y / (70 * k)) + 0.35 * valueNoise(seedDir + 1, x / (25 * k), y / (25 * k)));
      const cx = w * Math.cos(g2) + (1 - w) * Math.cos(nz);
      const sy = w * Math.sin(g2) + (1 - w) * Math.sin(nz);
      const th = 0.5 * Math.atan2(sy, cx);
      return [Math.cos(th), Math.sin(th)];
    };
    const out = Float32Array.from(mean);
    const H = new Float32Array(N * N);
    const pts = [];
    const { p } = this.field;
    for (let q = 0; q < count; q++) {
      const s = plan[q];
      let { x, y } = s;
      const cx = Math.min(g - 1, Math.floor((x / N) * g)), cy = Math.min(g - 1, Math.floor((y / N) * g));
      const ci = cy * g + cx;
      // d) the pigment: inverse CDF of the cell's distribution at the correlated uniform number u
      let role = R - 1, acc = 0;
      for (let r = 0; r < R; r++) {
        acc += p[ci * R + r];
        if (s.u < acc) { role = r; break; }
      }
      const tint = 0.95 + 0.1 * valueNoise(seedTint, x / (45 * k), y / (45 * k));
      const xi = Math.min(N - 1, Math.max(0, Math.floor(x))), yi = Math.min(N - 1, Math.max(0, Math.floor(y)));
      const col = [0, 1, 2].map((c) => clamp01((PIGMENT * lin[role][c] + (1 - PIGMENT) * mean[(yi * N + xi) * 3 + c]) * tint));
      const amp = 0.25 + 1.1 * ent[ci];
      pts.length = 0;
      pts.push([x, y]);
      let [vx, vy] = dirAt(x, y);
      vx *= s.sign; vy *= s.sign;
      for (let st = 0; st < s.steps; st++) {
        let [dx, dy] = dirAt(x, y);
        if (dx * vx + dy * vy < 0) { dx = -dx; dy = -dy; }
        vx = dx; vy = dy;
        x += dx * s.stepLen;
        y += dy * s.stepLen;
        pts.push([x, y]);
      }
      paintStroke(out, H, N, pts, s.width, col, amp, s.phase);
      if ((q & 255) === 255) yield;
    }
    // e) lighting from the height map
    const px = new Float32Array(N * N * 3);
    const B = 2.4 * Math.max(0.35, k);
    const lv = [-0.5, -0.7, 0.9];
    const ll = Math.hypot(...lv);
    const Lx = lv[0] / ll, Ly = lv[1] / ll, Lz = lv[2] / ll;
    const hl = Math.hypot(Lx, Ly, Lz + 1);
    const Hx = Lx / hl, Hy = Ly / hl, Hz = (Lz + 1) / hl;
    const specFlat = Math.pow(Hz, 30);
    const weave = 0.05 / Math.max(0.35, k);
    const h = (x, y) => H[(y < 0 ? 0 : y >= N ? N - 1 : y) * N + (x < 0 ? 0 : x >= N ? N - 1 : x)];
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const nx = -((h(x + 1, y) - h(x - 1, y)) * 0.5 * B + weave * Math.cos(x * 2.1) * Math.sin(y * 2.1));
        const ny = -((h(x, y + 1) - h(x, y - 1)) * 0.5 * B + weave * Math.sin(x * 2.1) * Math.cos(y * 2.1));
        const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
        const nd = (nx * Lx + ny * Ly + Lz) * inv;
        const shade = Math.min(1.35, Math.max(0.5, 0.35 + (0.65 * nd) / Lz));
        const ns = Math.max(0, (nx * Hx + ny * Hy + Hz) * inv);
        const spec = Math.max(0, 0.18 * (Math.pow(ns, 30) - specFlat));
        const i = (y * N + x) * 3;
        for (let c = 0; c < 3; c++) px[i + c] = out[i + c] * shade + spec;
      }
      if ((y & 63) === 63) yield;
    }
    return toView(px, N, { height: H });
  }

  /** The composite, computed synchronously (node, tests, downloads), cached. */
  final() {
    if (this.cache) return this.cache;
    const g = this.composite();
    let r = g.next();
    while (!r.done) r = g.next();
    this.cache = r.value;
    return r.value;
  }

  /** The composite in slices of about `sliceMs`, awaiting nextFrame() between slices; null if stopped() turns true. */
  async finalAsync({ nextFrame, stopped = () => false, sliceMs = 30 }) {
    if (this.cache) return this.cache;
    const g = this.composite();
    let t0 = performance.now();
    let r = g.next();
    while (!r.done) {
      if (performance.now() - t0 > sliceMs) {
        await nextFrame();
        if (stopped()) return null;
        t0 = performance.now();
      }
      r = g.next();
    }
    this.cache = r.value;
    return r.value;
  }
}

/** One stroke: capsules along the polyline; colour over the buffer, and a bristled height profile. */
function paintStroke(out, H, N, pts, width, col, amp, phase) {
  const hw = width / 2;
  let total = 0;
  for (let s = 0; s + 1 < pts.length; s++) total += Math.hypot(pts[s + 1][0] - pts[s][0], pts[s + 1][1] - pts[s][1]);
  if (!(total > 0)) return;
  const bristles = Math.PI * Math.max(2, width / 1.8);
  let along = 0;
  for (let s = 0; s + 1 < pts.length; s++) {
    const ax = pts[s][0], ay = pts[s][1], bx = pts[s + 1][0], by = pts[s + 1][1];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const ux = dx / len, uy = dy / len;
    const xa = Math.max(0, Math.ceil(Math.min(ax, bx) - hw)), xb = Math.min(N - 1, Math.floor(Math.max(ax, bx) + hw));
    const ya = Math.max(0, Math.ceil(Math.min(ay, by) - hw)), yb = Math.min(N - 1, Math.floor(Math.max(ay, by) + hw));
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const rx = x - ax, ry = y - ay;
        let t = rx * ux + ry * uy;
        t = t < 0 ? 0 : t > len ? len : t;
        const across = rx * uy - ry * ux; // signed distance from the centre line
        const ex = rx - t * ux, ey = ry - t * uy;
        const dist = Math.sqrt(ex * ex + ey * ey);
        if (dist >= hw) continue;
        const pos = (along + t) / total;
        const a = Math.min(1, hw - dist) * 0.92 * (1 - 0.35 * pos * pos);
        const i = y * N + x;
        for (let c = 0; c < 3; c++) out[i * 3 + c] += (col[c] - out[i * 3 + c]) * a;
        const u = Math.max(-1, Math.min(1, across / hw));
        const body = Math.sqrt(Math.max(0, 1 - u * u));
        const ridge = 0.6 + 0.4 * Math.sin(u * bristles + phase);
        const hh = amp * body * ridge * (1.15 - 0.6 * pos);
        H[i] = H[i] * (1 - 0.8 * a) + hh * a;
      }
    }
    along += len;
  }
}

