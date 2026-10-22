// The styles of each tab and the Gesture tab's painter. Gesture: Brush (the old Paint marks with the five media drawn
// differently), Sketch and Pixel (unchanged), plus the hidden Paint style that old v=1 Paint links use (the unchanged old
// Paint code, so those links keep their exact pixels). Map: Pixel and Impasto (field.js, impasto.js).
// Same decisions in, pixels out: the rules never read the canvas, so their decisions do not depend on the style.
import { BrushCanvas } from "./brush.js";
import { SkinPainter as LegacyPainter, W } from "./render.js";

export const STYLE_INFO = {
  gesture: {
    brush: { label: "Brush", about: "Brush: each mark in its medium; pencil, pen, marker, charcoal and wash look different." },
    sketch: { label: "Sketch", about: "Sketch: line only; shapes become outlines in ink." },
    pixel: { label: "Pixel", about: "Pixel: the marks snapped to a 64 by 64 grid in the painting's seven colours." },
    paint: { label: "Paint (old link)", about: "Paint: the retired look, kept so old links look the same." },
  },
  map: {
    pixel: { label: "Pixel", about: "Pixel: one block per cell, in its most likely colour or a seeded draw from its odds; the plainest view of the probabilities." },
    impasto: { label: "Impasto", about: "Impasto: thick oil paint; each stroke's colour is drawn from its cell's odds, and uncertain cells get thicker paint." },
  },
};
export const GESTURE_STYLES = ["brush", "sketch", "pixel", "paint"];

/** A painter for one Gesture painting in one style. size: Brush only (thumbnails); the old code is always 600 or 64. */
export class GesturePainter {
  constructor(style, palette, paintingId, { size = W } = {}) {
    this.style = GESTURE_STYLES.includes(style) ? style : "brush";
    this.hexes = Object.fromEntries(palette.roles);
    if (this.style === "brush") this.canvas = new BrushCanvas(palette.paper, paintingId, size);
    else this.legacy = new LegacyPainter(this.style, palette, paintingId); // paint, pixel, sketch: unchanged code
  }

  mark(step, d, composition, stroke) {
    if (this.legacy) return this.legacy.mark(step, d, composition, stroke);
    return this.canvas.gesture(step, d, composition, this.hexes[d.colour], stroke);
  }

  /** The mark as a generator (Brush yields inside large marks; the old code draws it in one go). */
  *markSteps(step, d, composition, stroke) {
    if (this.legacy) return this.legacy.mark(step, d, composition, stroke);
    return yield* this.canvas.gestureSteps(step, d, composition, this.hexes[d.colour], stroke);
  }

  /** What the canvas shows and the read-back reads. */
  view() {
    return this.legacy ? this.legacy.view() : this.canvas;
  }

  rgba() {
    return this.view().rgba();
  }
}

/** Replays recorded decisions in another style, for the style thumbnails (no director, no network). */
export async function* replayStyle(style, palette, paintingId, history, composition, stroke, size) {
  const p = new GesturePainter(style, palette, paintingId, { size });
  for (const h of history) {
    p.mark(h.step, h.d, composition, stroke);
    yield p;
  }
  return p;
}
