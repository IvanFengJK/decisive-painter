// Contact sheet in RULES mode (node, no browser; the same pixels the page draws): rows = scenes, columns = Gesture
// Brush, Gesture Sketch, Gesture Pixel, Map Pixel, Map Impasto. Each tile is 200 px with a 6 px gutter.
//   node tests/sheet.mjs [rows] [out.png]      (default: the first 8 scenes, out/shots/contact-sheet.png)
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { RuleDirector, paintSteps } from "../web/director.js";
import { mapId, pixelMap, rulesField } from "../web/field.js";
import { MapImpasto } from "../web/impasto.js";
import { readPrompt } from "../web/recipes.js";
import { colourCount, enginePalette } from "../web/render.js";
import { SCENES } from "./scenes.mjs";
import { writePng } from "./lib/png.mjs";

const rows = Number(process.argv[2] || 8);
const out = process.argv[3] || new URL("../out/shots/contact-sheet.png", import.meta.url).pathname;
const T = 200, G = 6, COLS = ["brush", "sketch", "gpixel", "mpixel", "impasto"];
const Wd = COLS.length * (T + G) + G, Hd = rows * (T + G) + G;
const sheet = new Uint8ClampedArray(Wd * Hd * 4).fill(255);
const rules = new RuleDirector();

/** Nearest-neighbour (small sources) or box-averaged (large sources) copy of an n x n RGBA view into a tile. */
function put(rgba, n, row, col) {
  const ox = G + col * (T + G), oy = G + row * (T + G);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const o = ((oy + y) * Wd + ox + x) * 4;
      if (n < T) {
        const i = (Math.floor((y * n) / T) * n + Math.floor((x * n) / T)) * 4;
        for (let c = 0; c < 4; c++) sheet[o + c] = rgba[i + c];
      } else {
        const f = n / T, acc = [0, 0, 0];
        for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) {
          const i = ((Math.floor(y * f) + dy) * n + Math.floor(x * f) + dx) * 4;
          for (let c = 0; c < 3; c++) acc[c] += rgba[i + c];
        }
        for (let c = 0; c < 3; c++) sheet[o + c] = acc[c] / (f * f);
        sheet[o + 3] = 255;
      }
    }
  }
}

const report = [];
for (let r = 0; r < rows; r++) {
  const prompt = SCENES[r];
  const look = readPrompt(prompt).look;
  const seed = r + 1;
  const line = { prompt };
  for (const [c, st] of COLS.entries()) {
    const t0 = performance.now();
    let v;
    if (st === "mpixel" || st === "impasto") {
      const field = rulesField(look, seed, 32);
      const id = mapId(look, seed, 32);
      v = st === "mpixel" ? pixelMap(field, enginePalette(look), id) : new MapImpasto(field, enginePalette(look), id).final();
    } else {
      let last = null;
      for await (const s of paintSteps({ prompt, look, seed, budget: 30, skin: st === "gpixel" ? "pixel" : st, director: rules })) last = s;
      v = last.painter.view();
    }
    const rgba = v.rgba();
    line[st] = { ms: Math.round(performance.now() - t0), colours: colourCount(rgba) };
    put(rgba, v.n, r, c);
  }
  report.push(line);
}
mkdirSync(dirname(out), { recursive: true });
writePng(out, sheet, Wd, Hd, 4);
console.log(JSON.stringify(report));
