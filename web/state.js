// State text and typed questions, from the Round 12-15 harness spec (experiments/r15/out/package/harness-spec.md):
// upfront questions (mood, harmony, hue, key, saturation, style, composition, stroke; plus our broad subject type),
// the per-mark questions (gesture, place, size, medium, colour role, fill, weight) restricted by the phase menus (L1),
// and the short state (L4): request, style, palette in colour words, composition, progress, the 5x5 canvas words and
// the last marks. The visitor's prompt appears in exactly one delimited, length-limited field (guardrail L4).
import { COMPOSITIONS, GRID, HARMONIES, HUES, KEYS, MOODS, ROLES, SATS, enginePalette, gridBox, phaseOf } from "./render.js";
import { STROKES, STYLES, SUBJECTS } from "./recipes.js";

export const PROMPT_MAX = 80;

export const GESTURES = {
  "horizontal band": "a wide flat strip across the place",
  "upright column": "a tall narrow block",
  "round disc": "a filled circle",
  "tall oval": "an upright ellipse",
  "wide oval": "a flat ellipse",
  "low mound": "a rounded hump rising from the bottom of the place",
  "pointed triangle": "a triangle pointing up",
  "block": "a rectangle",
  "wedge": "a slanted triangular slice",
  "broad wash": "a soft covering of the whole place",
  "vertical hatching": "several upright strokes",
  "horizontal dashes": "several level strokes",
  "slanted strokes": "several diagonal strokes",
  "cross-hatching": "two crossing sets of lines",
  "dotted speckle": "many small dots",
  "flowing ribbon": "one long wavy stroke",
  "stacked arcs": "a few curved arcs, like waves or hills",
  "zigzag": "a sharp back-and-forth line",
  "outline loop": "a closed outline around the place",
  "tangled scribble": "a loose knot of lines",
};
export const MEDIA = {
  "pencil": "thin grey-graphite grain",
  "ink pen": "fine crisp line",
  "felt marker": "flat streaky stripes",
  "charcoal": "dark, grainy, smudged",
  "watercolour": "transparent soft wash with dark edges",
  "oil pastel": "thick waxy colour",
};
export const FILLS = {
  "solid fill": "cover the shape densely",
  "thin wash": "a transparent veil of colour",
  "outline only": "only draw the edge",
  "hatched fill": "fill with parallel lines",
};
export const SIZES = { small: "about a third of the place", medium: "about half of the place", large: "most of the place" };
export const WEIGHTS = { light: "faint, delicate marks", medium: "normal pressure", heavy: "strong, dense marks" };

// L1 phase menus (Round 14 levers.py), in Round 12 list order
export const GESTURE_MENU = {
  backdrop: ["horizontal band", "round disc", "broad wash", "slanted strokes", "dotted speckle", "stacked arcs"],
  ground: ["horizontal band", "low mound", "broad wash", "vertical hatching", "horizontal dashes", "slanted strokes",
    "dotted speckle", "stacked arcs"],
  distance: ["horizontal band", "upright column", "low mound", "pointed triangle", "block", "horizontal dashes",
    "dotted speckle", "stacked arcs"],
  subject: ["upright column", "round disc", "tall oval", "wide oval", "low mound", "pointed triangle", "block", "wedge",
    "outline loop"],
  accents: ["round disc", "vertical hatching", "horizontal dashes", "slanted strokes", "cross-hatching", "dotted speckle",
    "flowing ribbon", "outline loop"],
};
export const SIZE_MENU = { backdrop: ["medium", "large"], ground: ["medium", "large"], distance: ["small", "medium"],
  subject: ["medium", "large"], accents: ["small", "medium"] };

/** Grid cells at least half covered by the boxes, on a 100x100 raster with rounded edges (levers._cells_over). */
function cellsOver(boxes, frac = 0.5, res = 100) {
  const m = new Uint8Array(res * res);
  for (const [x0, y0, x1, y1] of boxes) {
    for (let y = Math.round(y0 * res); y < Math.round(y1 * res); y++) {
      for (let x = Math.round(x0 * res); x < Math.round(x1 * res); x++) m[y * res + x] = 1;
    }
  }
  return GRID.filter((cell) => {
    const [x0, y0, x1, y1] = gridBox(cell).map((v) => Math.trunc(v * res));
    let s = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) s += m[y * res + x];
    return s / ((y1 - y0) * (x1 - x0)) >= frac;
  });
}

export function placeMenu(composition, phase) {
  const comp = COMPOSITIONS[composition];
  const named = comp.order[phase];
  const cells = phase === "subject" || phase === "accents"
    ? cellsOver(comp.order.subject.filter((p) => p !== "whole frame").map((p) => comp.places[p])) : [];
  const allowed = new Set([...named, ...cells]);
  return [...Object.keys(comp.places), ...GRID].filter((o) => allowed.has(o));
}

function span([x0, y0, x1, y1]) {
  const p = (v) => Math.round(v * 100);
  return `left ${p(x0)}% to ${p(x1)}%, top ${p(y0)}% to ${p(y1)}%`;
}

// ------------------------------------------------------------------------------------------------ prompt field (L4)
/** The one place the visitor's text enters the state: delimited, length-limited, delimiters removed from the text. */
export function promptField(prompt) {
  const clean = String(prompt ?? "").replace(/[«»\n\r]/g, " ").slice(0, PROMPT_MAX);
  return `Request (visitor text, at most ${PROMPT_MAX} characters, between « »): «${clean}»`;
}

// ------------------------------------------------------------------------------------------------ upfront
const choice = (id, text, about) => ({ id, type: "choice", text, options: Object.keys(about), about });

export function upfrontQuestions() {
  return [
    choice("mood", "Which mood should the picture have?", MOODS),
    choice("harmony", "Which colour harmony should the palette use?", HARMONIES),
    choice("hue", "Which hue family should dominate the picture?", Object.fromEntries(Object.keys(HUES).map((h) => [h, ""]))),
    choice("key", "How light or dark should the picture be overall?", KEYS),
    choice("saturation", "How strong should the colours be?", SATS),
    choice("style", "Which painting style should the picture have?", STYLES),
    choice("composition", "Which composition fits the request best?",
      Object.fromEntries(Object.entries(COMPOSITIONS).map(([k, v]) => [k, v.about]))),
    choice("stroke", "What character should the marks have?", STROKES),
    choice("subject", "What broad kind of main subject does the request have?", SUBJECTS),
  ];
}

export function upfrontState(prompt, budget) {
  return {
    kind: "upfront",
    text: `${promptField(prompt)}\nWe will paint this request as a small abstract picture built from ${budget} simple marks, `
      + "laid down one at a time by code. First choose the overall look.",
  };
}

// ------------------------------------------------------------------------------------------------ per mark
export function paletteLine(look) {
  const w = enginePalette(look).words;
  return `Palette: ${look.mood} mood, ${look.harmony} harmony, ${look.hue} family, ${look.key} key, ${look.saturation}; `
    + ROLES.map((r) => `${r} = ${w[r]}`).join("; ") + ".";
}

export function gestureQuestions(look, step, budget) {
  const ph = phaseOf(step, budget).name;
  const comp = COMPOSITIONS[look.composition];
  const pick = (about, keep) => Object.fromEntries(keep.map((k) => [k, about[k]]));
  const places = Object.fromEntries(placeMenu(look.composition, ph).map((p) =>
    [p, GRID.includes(p) ? `grid cell: ${span(gridBox(p))}` : `named place: ${span(comp.places[p])}`]));
  const words = enginePalette(look).words;
  return [
    choice("gesture", "Which mark should the next gesture make?", pick(GESTURES, GESTURE_MENU[ph])),
    choice("place", "Where should the mark go: a named place of the composition, or one cell of the 5x5 grid?", places),
    choice("size", "How big should the mark be, compared with that place?", pick(SIZES, SIZE_MENU[ph])),
    choice("medium", "Which drawing medium should make the mark?", MEDIA),
    choice("colour", "Which palette role should the mark use?", Object.fromEntries(ROLES.map((r) => [r, words[r]]))),
    choice("fill", "If the mark is a solid shape, how should it be painted?", FILLS),
    choice("weight", "How heavy should the marks be?", WEIGHTS),
  ];
}

/** The 5x5 read-back, one line per row, equal neighbouring cells merged ('2-4 mostly ...'). */
export function rowRuns(r, grid) {
  const out = [];
  let c = 1;
  while (c <= 5) {
    let e = c;
    while (e < 5 && grid[`${r}${e + 1}`] === grid[`${r}${c}`]) e++;
    out.push(`${c}${e > c ? `-${e}` : ""} ${grid[`${r}${c}`]}`);
    c = e + 1;
  }
  return out.join("; ");
}

export function gestureState({ prompt, look, step, budget, grid, history }) {
  const comp = COMPOSITIONS[look.composition];
  const ph = phaseOf(step, budget);
  const lines = [
    promptField(prompt),
    `Style: ${look.style} (${STYLES[look.style]}), ${look.stroke} marks. Subject type: ${look.subject}.`,
    paletteLine(look),
    `Composition ${look.composition}: ${comp.about}.`,
    `Progress: step ${step} of ${budget}, now painting ${ph.name} (${ph.what}; marks ${ph.first}-${ph.last}); suggested places: `
      + `${comp.order[ph.name].join(", ")}.`,
    "Canvas, rows A-E top to bottom, columns 1-5 left to right:",
    ..."ABCDE".split("").map((r) => `${r}: ${rowRuns(r, grid)}`),
  ];
  const recent = history.slice(-4);
  lines.push("Last marks: " + (recent.length
    ? recent.map((h) => `${h.step}. ${h.d.gesture} at ${h.d.place}, ${h.d.colour}`).join("; ") + "."
    : "none yet."));
  return { kind: "gesture", text: lines.join("\n"), step, budget, phase: ph.name, look, grid };
}
