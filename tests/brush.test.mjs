// Brush (Gesture tab): the five media look different on the same marks; marks can run in slices with identical pixels.
import assert from "node:assert/strict";
import { test } from "node:test";
import { BrushCanvas } from "../web/brush.js";
import { readPrompt } from "../web/recipes.js";
import { RuleDirector, paintSteps } from "../web/director.js";
import { enginePalette } from "../web/render.js";

const MEDIA = ["pencil", "ink pen", "felt marker", "charcoal", "watercolour"];
const look = readPrompt("a lighthouse in a storm").look;

test("T7 the five Brush media differ pairwise on the same marks (mean absolute pixel difference > 15 of 255)", async () => {
  const marks = [];
  for await (const s of paintSteps({ prompt: "x", look, seed: 3, budget: 12, skin: "brush", director: new RuleDirector() })) marks.push(s.d);
  const pal = Object.fromEntries(enginePalette(look).roles);
  const out = {};
  for (const m of MEDIA) {
    const c = new BrushCanvas(enginePalette(look).paper, "media-test", 300);
    marks.forEach((d, i) => c.gesture(i + 1, { ...d, medium: m }, look.composition, pal[d.colour], look.stroke));
    out[m] = c.rgba();
  }
  const diffs = [];
  for (let i = 0; i < MEDIA.length; i++) for (let j = i + 1; j < MEDIA.length; j++) {
    let s = 0;
    const a = out[MEDIA[i]], b = out[MEDIA[j]];
    for (let k = 0; k < a.length; k += 4) s += Math.abs(a[k] - b[k]) + Math.abs(a[k + 1] - b[k + 1]) + Math.abs(a[k + 2] - b[k + 2]);
    diffs.push([`${MEDIA[i]} / ${MEDIA[j]}`, s / ((a.length / 4) * 3)]);
  }
  console.log(`info Brush media pairwise mean abs diff: ${diffs.map(([n, d]) => `${n} ${d.toFixed(1)}`).join("; ")}`);
  const low = diffs.filter(([, d]) => !(d > 15));
  assert.equal(low.length, 0, JSON.stringify(diffs.map(([n, d]) => `${n} ${d.toFixed(1)}`)));
});

test("Brush marks in slices give the same pixels as in one go", async () => {
  const run = async (tick) => {
    let last;
    for await (const s of paintSteps({ prompt: "x", look, seed: 5, budget: 20, skin: "brush", director: new RuleDirector(), tick })) last = s;
    return Buffer.from(last.painter.rgba()).toString("base64");
  };
  assert.equal(await run(null), await run(() => new Promise((r) => setTimeout(r, 0))));
});
