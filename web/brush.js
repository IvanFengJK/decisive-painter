// The Brush style (Gesture tab): the old Paint renderer's marks (same plans, same seeded geometry) with the six media drawn so that
// they look different from each other:
//   pencil       thin, spaced strokes broken up by a strong fine grain, slightly greyed colour
//   ink pen      crisp, fully opaque thin lines (hard mask, no grain, no blur)
//   felt marker  flat translucent stripes that multiply, so they darken where they overlap
//   charcoal     dark grainy strokes with a soft smudged halo
//   watercolour  a soft, wide, transparent wash with dark edges and blotchy blooms
//   oil pastel   as in the old Paint skin (thick waxy colour)
// The old Paint skin is kept unchanged in render.js (PaintCanvas) so v=1 links keep their pixels.
// All loops run inside the bounding box of the mark, and lines use a capsule rasteriser, so a mark is cheaper than in
// the old Paint skin.
import { MEDIUM, PaintCanvas, fillDisc, fillPolygon, gaussianBlur, hexRgb, planGesture } from "./render.js";

// base width px, base alpha, grain power, blur px, blend, fill-line spacing multiplier
export const BRUSH_MEDIUM = {
  "pencil": [1.5, 0.8, 2.4, 0.0, "graphite", 2.2],
  "ink pen": [1.4, 1.0, 0.0, 0.0, "ink", 4.0],
  "felt marker": [10.0, 0.42, 0.0, 0.6, "marker", 0.9],
  "charcoal": [7.5, 0.9, 2.0, 1.6, "charcoal", 0.85],
  "watercolour": [16.0, 0.6, 0.3, 4.0, "wash", 1.0],
  "oil pastel": MEDIUM["oil pastel"],
};

/** A growing pixel rectangle (inclusive), clamped to the canvas. */
class Region {
  constructor(n) {
    this.n = n;
    this.x0 = n; this.y0 = n; this.x1 = -1; this.y1 = -1;
  }
  add(xa, ya, xb, yb) {
    const n = this.n;
    this.x0 = Math.max(0, Math.min(this.x0, Math.floor(xa)));
    this.y0 = Math.max(0, Math.min(this.y0, Math.floor(ya)));
    this.x1 = Math.min(n - 1, Math.max(this.x1, Math.ceil(xb)));
    this.y1 = Math.min(n - 1, Math.max(this.y1, Math.ceil(yb)));
  }
  grow(p) {
    if (this.empty()) return;
    this.add(this.x0 - p, this.y0 - p, this.x1 + p, this.y1 + p);
  }
  empty() {
    return this.x1 < this.x0 || this.y1 < this.y0;
  }
  box() {
    return [this.x0, this.y0, this.x1, this.y1];
  }
}

const blurPad = (sigma) => Math.ceil(3 * (sigma + 1)) + 2;

/**
 * Thick polyline as capsules (distance to each segment <= width / 2), pixel centres on integers like the old rasteriser.
 * mode "max" keeps the strongest value; mode "count" adds each line once per pixel (line ids), so overlaps add up.
 */
function stampLine(mask, n, pts, value, width, region, ids, id) {
  const hw = Math.max(0.5, width / 2);
  const hw2 = hw * hw;
  for (let s = 0; s + 1 < pts.length; s++) {
    const ax = pts[s][0], ay = pts[s][1], bx = pts[s + 1][0], by = pts[s + 1][1];
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    const xa = Math.max(0, Math.ceil(Math.min(ax, bx) - hw)), xb = Math.min(n - 1, Math.floor(Math.max(ax, bx) + hw));
    const ya = Math.max(0, Math.ceil(Math.min(ay, by) - hw)), yb = Math.min(n - 1, Math.floor(Math.max(ay, by) + hw));
    if (xa > xb || ya > yb) continue;
    region.add(xa, ya, xb, yb);
    for (let y = ya; y <= yb; y++) {
      const row = y * n;
      for (let x = xa; x <= xb; x++) {
        let t = L2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / L2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = ax + t * dx - x, ey = ay + t * dy - y;
        if (ex * ex + ey * ey > hw2) continue;
        const i = row + x;
        if (ids) {
          if (ids[i] !== id) { ids[i] = id; mask[i] += value; }
        } else if (mask[i] < value) mask[i] = value;
      }
    }
  }
}

function polyBox(pts) {
  let xa = Infinity, ya = Infinity, xb = -Infinity, yb = -Infinity;
  for (const [x, y] of pts) {
    if (x < xa) xa = x; if (x > xb) xb = x;
    if (y < ya) ya = y; if (y > yb) yb = y;
  }
  return [xa, ya, xb, yb];
}

export class BrushCanvas extends PaintCanvas {
  constructor(paperHex, paintingId, size) {
    super(paperHex, paintingId, size);
    this.ids = new Int32Array(this.n * this.n);
    this.lineId = 0;
    this.grainPow = new Map(); // grain^p per medium, computed once per painting (Math.pow per pixel is the slow part)
  }

  /** The grain factor of one medium as an array (same formula for every mark of the painting). */
  grainFactor(blend, p) {
    const key = `${blend}|${p}`;
    if (this.grainPow.has(key)) return this.grainPow.get(key);
    const [lo, hi] = blend === "graphite" ? [0.1, 0.9] : blend === "charcoal" ? [0.2, 0.8] : [0.35, 0.65];
    const g = this.grain;
    const out = new Float32Array(g.length);
    for (let i = 0; i < g.length; i++) out[i] = lo + hi * Math.pow(g[i], p);
    this.grainPow.set(key, out);
    return out;
  }

  /** Plan (shared with the old Paint skin) + rasterise + composite one gesture in its medium (all at once). */
  gesture(step, d, composition, colourHex, strokeChar) {
    const g = this.gestureSteps(step, d, composition, colourHex, strokeChar);
    let r = g.next();
    while (!r.done) r = g.next();
    return r.value;
  }

  /**
   * The same work as a generator that yields between its heavy steps (blurs, line sets, the composite), so the page can
   * give the browser a turn inside a large mark. The pixels do not depend on where it pauses.
   */
  *gestureSteps(step, d, composition, colourHex, strokeChar) {
    const n = this.n;
    const plan = planGesture(this.paintingId, step, d, composition, strokeChar, n, BRUSH_MEDIUM);
    const counting = plan.blend === "marker";
    let mask = new Float32Array(n * n);
    let shape = null;
    let shapeBox = null;
    const reg = new Region(n);
    let lines = 0;
    for (const op of plan.ops) {
      if (op.op === "polygon") {
        shape = new Float32Array(n * n);
        fillPolygon(shape, n, op.pts, 255);
        const b = polyBox(op.pts);
        shapeBox = [Math.max(0, Math.floor(b[0])), Math.max(0, Math.floor(b[1])), Math.min(n - 1, Math.ceil(b[2])), Math.min(n - 1, Math.ceil(b[3]))];
      } else if (op.op === "wash") {
        const sm = gaussianBlur(shape, n, op.sigma, shapeBox);
        mask = new Float32Array(n * n);
        const r = new Region(n);
        r.add(...shapeBox);
        r.grow(blurPad(op.sigma));
        for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) mask[y * n + x] = Math.trunc(sm[y * n + x] * 0.9);
        reg.add(...r.box());
        yield;
      } else if (op.op === "clip") {
        if (reg.empty()) continue;
        const sb = gaussianBlur(shape, n, op.sigma, shapeBox);
        for (let y = reg.y0; y <= reg.y1; y++) for (let x = reg.x0; x <= reg.x1; x++) {
          const i = y * n + x;
          mask[i] = Math.trunc((mask[i] * sb[i]) / 255);
        }
        yield;
      } else if (op.op === "line") {
        stampLine(mask, n, op.pts, op.fill, op.width, reg, counting ? this.ids : null, ++this.lineId);
        if (++lines % 8 === 0) yield;
      } else if (op.op === "ellipse") {
        const [a, b, c, e] = op.box;
        fillDisc(mask, n, (a + c) / 2, (b + e) / 2, (c - a) / 2, (e - b) / 2, op.fill);
        reg.add(a, b, c, e);
      }
    }
    if (reg.empty()) return plan;
    yield;
    if (plan.blur > 0) {
      mask = gaussianBlur(mask, n, plan.blur, reg.box());
      reg.grow(blurPad(plan.blur));
      yield;
    }
    let halo = null;
    if (plan.blend === "charcoal") {
      halo = gaussianBlur(mask, n, 5 * plan.k, reg.box());
      reg.grow(blurPad(5 * plan.k));
    }
    let edgeBlur = null;
    const M = new Float32Array(n * n);
    const gf = plan.grainP > 0 ? this.grainFactor(plan.blend, plan.grainP) : null;
    for (let y = reg.y0; y <= reg.y1; y++) for (let x = reg.x0; x <= reg.x1; x++) {
      const i = y * n + x;
      M[i] = gf ? (mask[i] / 255) * gf[i] : mask[i] / 255;
    }
    if (plan.blend === "wash") {
      const q = new Float32Array(n * n);
      for (let y = reg.y0; y <= reg.y1; y++) for (let x = reg.x0; x <= reg.x1; x++) q[y * n + x] = Math.trunc(Math.min(1, M[y * n + x]) * 255);
      edgeBlur = gaussianBlur(q, n, 5 * plan.k, reg.box());
    }
    yield;
    const col = hexRgb(colourHex);
    const luma = 0.3 * col[0] + 0.59 * col[1] + 0.11 * col[2];
    const tone = plan.blend === "graphite" ? col.map((c) => (0.7 * c + 0.3 * luma) * 0.9)
      : plan.blend === "ink" ? col.map((c) => c * 0.8)
        : plan.blend === "charcoal" ? col.map((c) => c * 0.55 + 0.02) : col;
    const tint = col.map((c) => 1 - plan.alpha * (1 - c)); // marker: the colour a single stripe multiplies by
    const px = this.px;
    const low = this.low;
    for (let y = reg.y0; y <= reg.y1; y++) {
      if ((y & 127) === 127) yield;
      for (let x = reg.x0; x <= reg.x1; x++) {
        const i = y * n + x;
        let m = M[i];
        if (halo) {
          const ah = Math.min(1, (halo[i] / 255) * 0.3 * (0.5 + 0.5 * this.grain[i]));
          if (ah > 0) for (let c = 0; c < 3; c++) px[i * 3 + c] = px[i * 3 + c] * (1 - ah) + tone[c] * ah;
        }
        if (!(m > 0)) continue;
        if (plan.blend === "marker") {
          for (let c = 0; c < 3; c++) px[i * 3 + c] *= Math.pow(tint[c], Math.min(m, 4));
          continue;
        }
        if (plan.blend === "wash") {
          const edge = Math.min(1, Math.max(0, m - edgeBlur[i] / 255));
          m = Math.min(1, Math.max(0, m * 0.75 + edge * 2.2));
          m *= 0.55 + 0.45 * (low[i] / 255); // blooms: a slow blotchy variation of the pigment
        }
        let A = Math.min(1, Math.max(0, m * plan.alpha));
        if (plan.blend === "ink") A = m > 0.3 ? plan.alpha : 0;
        if (A === 0) continue;
        const glaze = plan.blend === "glaze" || plan.blend === "wash";
        for (let c = 0; c < 3; c++) {
          const p = px[i * 3 + c];
          const top = glaze ? 0.55 * p * tone[c] + 0.45 * tone[c] : tone[c];
          px[i * 3 + c] = p * (1 - A) + top * A;
        }
      }
    }
    return plan;
  }
}
