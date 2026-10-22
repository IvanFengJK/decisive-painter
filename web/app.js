// The page: prompt -> guardrails -> recipe -> one of two ways to draw with a decision-maker:
//   Gesture          the decision-maker picks one mark at a time from menus (with odds); code draws the marks;
//   Probability map  the decision-maker gives odds over the six palette roles for every cell; the painting is those odds.
// The decision-maker is Rules (authored tables, the default) or Model (Qwen3-0.6B in a Worker, after the visitor loads
// it). The badge always names what decided the painting on screen. Visitor text is only ever written with textContent;
// in Rules mode the page makes no network request at all, and in Model mode only to the model and library hosts.
import { DirectorError, EndpointDirector, RuleDirector, chooseLook, decisionBadge, optionsOf, paintSteps } from "./director.js";
import { GRID_DEFAULT, GRID_MAX, GRID_MIN, cellProbs, cellQuestions, cellState, cellText, certaintyMap, directorField,
  fieldFromCoarse, mapId, pixelMap, rulesField } from "./field.js";
import { DisabledGuard, runGuard } from "./guard.js";
import { MapImpasto } from "./impasto.js";
import { MODEL_QUESTIONS, ModelSlot } from "./model-director.js";
import { BLOCK_MESSAGE, check } from "./policy.js";
import { LOOK_FIELDS, readPrompt } from "./recipes.js";
import { PIXEL_N, ROLES, enginePalette, hexRgb } from "./render.js";
import { fnv1a } from "./rng.js";
import { BUDGET_DEFAULT, BUDGET_MAX, BUDGET_MIN, SEED_MAX, ShareError, clampCoarse, clampInt, decodeShare,
  encodeShare } from "./share.js";
import { deletePainting, listPaintings, savePainting, storageAvailable } from "./store.js";
import { STYLE_INFO, replayStyle } from "./styles.js";

const $ = (id) => document.getElementById(id);
const canvas = $("canvas");
const ctx = canvas.getContext("2d");
const overlay = $("overlay");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const PACE_MS = 90; // pause between marks so the painting can be watched (0 with reduced motion)

const rules = new RuleDirector();
// Model mode: nothing of the model (not even its loader) is fetched until the visitor presses "Load model".
const slot = new ModelSlot((opts) => import("./model-loader.js").then((m) => m.loadModel(opts)));
const guard = new DisabledGuard();

const EXPLAINER = {
  gesture: "The decision-maker picks one mark at a time from menus, with odds for every choice. Code draws the marks.",
  map: "The decision-maker gives odds for every cell of the grid. The painting is those odds, drawn.",
};

const app = {
  tab: "gesture",
  style: { gesture: "brush", map: "impasto" },
  legacy: false, // an old v=1 Paint link: drawn by the unchanged old Paint code
  prompt: "",
  look: null,
  lookBy: "rules", // rules | model | link | you
  seed: null,
  seedFromText: true,
  budget: BUDGET_DEFAULT,
  pick: "weighted",
  grid: GRID_DEFAULT,
  sample: "likely",
  certainty: false,
  coarse: 6,
  blend: false,
  run: null,
  paused: false,
  stepOnce: false,
  lastStart: -Infinity,
  painted: null, // what is on screen: { tab, director, coarse, blend, fromLink }
  msPerMark: { paint: 40, brush: 30, pixel: 8, sketch: 12 },
  mapMs: { pixel: 10, impasto: 1500 },
  current: null, // the Gesture run's painter
  map: null, // the Map on screen: { field, id, palette, source }
  modelCells: null, // the model's coarse answers for the current words + recipe: { key, coarse, P }
  cell: null, // the selected map cell {x, y}
  lookTicket: 0,
  runs: 0,
};

// ------------------------------------------------------------------------------------------------ small helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Waits for the next animation frame (a timer when the tab is hidden, where frames stop). */
const nextFrame = () => new Promise((r) => (document.hidden ? setTimeout(r, 0) : requestAnimationFrame(() => r())));

function notice(text) {
  $("notice").textContent = text || "";
}

function setReading(text) {
  $("reading").textContent = text || "";
}

function seedFor(text) {
  return fnv1a(`seed|${text.trim().toLowerCase()}`) % (SEED_MAX + 1);
}

function radioValue(name) {
  const el = document.querySelector(`input[name="${name}"]:checked`);
  return el ? el.value : null;
}

function setRadio(name, value) {
  for (const el of document.querySelectorAll(`input[name="${name}"]`)) el.checked = el.value === value;
}

const gestureStyle = () => (app.legacy ? "paint" : app.style.gesture);
const useEndpoint = () => app.tab === "gesture" && radioValue("director") === "endpoint";
const fmtMin = (ms) => (ms < 90000 ? `${Math.max(1, Math.round(ms / 1000))} seconds` : `${Math.round(ms / 60000)} minutes`);

function updateEstimate() {
  const per = app.msPerMark[gestureStyle()] + (reduceMotion.matches ? 0 : PACE_MS);
  const s = Math.max(1, Math.round((app.budget * per) / 1000));
  $("estimate").textContent = slot.mode === "model" && !useEndpoint()
    ? `The model reads your words first (six questions, about ${fmtMin(6 * (slot.director?.msPerQuestion || 10000))}); then about ${s} second${s === 1 ? "" : "s"} for the marks.`
    : `About ${s} second${s === 1 ? "" : "s"} on this device (measured here).`;
  const n = app.coarse * app.coarse;
  $("model-map-options").hidden = slot.mode !== "model" || app.tab !== "map";
  $("model-map-note").hidden = slot.mode !== "model" || app.tab !== "map";
  $("map-estimate").textContent = slot.mode === "model"
    ? `Model mode: ${n} questions on a ${app.coarse}x${app.coarse} grid, about ${fmtMin(n * (slot.director?.msPerQuestion || 10000))} on this device.`
    : `The rules fill every cell at once (about ${Math.max(1, Math.round(app.mapMs[app.style.map] / 1000))} s with this style).`;
}

// ------------------------------------------------------------------------------------------------ accent colour
function lum([r, g, b]) {
  const f = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

function cssRgb(str) {
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(str);
  return m ? [m[1], m[2], m[3]].map((v) => Number(v) / 255) : [1, 1, 1];
}

/** The painting's accent role, pushed towards black or white until it has 3:1 against the page and 4.5:1 with its text. */
function applyAccent(look) {
  const bg = cssRgb(getComputedStyle(document.body).backgroundColor);
  const dark = lum(bg) < 0.2;
  const base = hexRgb(enginePalette(look).roles.find(([r]) => r === "accent")[1]).map(Number);
  const target = dark ? [1, 1, 1] : [0, 0, 0];
  let c = base;
  for (let t = 0; t <= 1.0001; t += 0.05) {
    c = base.map((v, i) => v * (1 - t) + target[i] * t);
    const text = contrast(c, [1, 1, 1]) >= contrast(c, [0, 0, 0]) ? [1, 1, 1] : [0, 0, 0];
    if (contrast(c, bg) >= 3 && contrast(c, text) >= 4.5) break;
  }
  const text = contrast(c, [1, 1, 1]) >= contrast(c, [0, 0, 0]) ? "#ffffff" : "#000000";
  const hex = "#" + c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
  document.documentElement.style.setProperty("--accent", hex);
  document.documentElement.style.setProperty("--on-accent", text);
}

// ------------------------------------------------------------------------------------------------ canvas
function draw(view, pixelated = view.n === PIXEL_N) {
  if (canvas.width !== view.n) {
    canvas.width = view.n;
    canvas.height = view.n;
  }
  canvas.classList.toggle("pixelated", pixelated);
  ctx.putImageData(new ImageData(view.rgba(), view.n, view.n), 0, 0);
}

const fadeSrc = document.createElement("canvas");
const fadeFrom = document.createElement("canvas");

/**
 * Shows a finished Impasto composite: it fades in over about 500 ms from the preview (none with reduced motion).
 * The last frame always puts the exact pixels, so what is on screen never depends on the fade.
 */
async function showFinal(view, token) {
  const img = new ImageData(view.rgba(), view.n, view.n);
  let frames = 0;
  if (!reduceMotion.matches) {
    fadeFrom.width = fadeFrom.height = view.n;
    const f = fadeFrom.getContext("2d");
    f.imageSmoothingEnabled = true;
    f.drawImage(canvas, 0, 0, view.n, view.n);
    fadeSrc.width = fadeSrc.height = view.n;
    fadeSrc.getContext("2d").putImageData(img, 0, 0);
    if (canvas.width !== view.n) {
      canvas.width = view.n;
      canvas.height = view.n;
    }
    canvas.classList.remove("pixelated");
    const t0 = performance.now();
    for (;;) {
      const t = Math.min(1, (performance.now() - t0) / 500);
      ctx.globalAlpha = 1;
      ctx.drawImage(fadeFrom, 0, 0);
      ctx.globalAlpha = t;
      ctx.drawImage(fadeSrc, 0, 0);
      ctx.globalAlpha = 1;
      frames++;
      if (t >= 1 || token.cancelled) break;
      await nextFrame();
    }
    if (token.cancelled) return;
  }
  draw({ n: view.n, rgba: () => img.data }, false);
  canvas.dataset.fadeFrames = String(frames); // 0 with reduced motion (checked by the tests)
}

function blankCanvas() {
  canvas.width = 600;
  canvas.height = 600;
  canvas.classList.remove("pixelated");
  ctx.fillStyle = "#f7f3eb";
  ctx.fillRect(0, 0, 600, 600);
  canvas.setAttribute("aria-label", "Blank paper, waiting for a scene");
  overlay.hidden = true;
  hideCell();
}

function describeCanvas(done, step) {
  const l = app.look;
  if (!done) {
    canvas.setAttribute("aria-label", app.tab === "map" ? "Probability map in progress" : `Painting in progress, mark ${step} of ${app.budget}`);
    return;
  }
  canvas.setAttribute("aria-label", app.tab === "map"
    ? `Abstract probability map, ${app.grid} by ${app.grid} cells: ${l.mood} mood, ${l.hue} family, ${l.key} key, ${l.composition} composition, ${STYLE_INFO.map[app.style.map].label} style`
    : `Abstract painting in ${app.budget} marks: ${l.mood} mood, ${l.hue} family, ${l.key} key, ${l.composition} composition, ${STYLE_INFO.gesture[gestureStyle()].label} style`);
}

// ------------------------------------------------------------------------------------------------ the gesture panels
function showState(s) {
  $("state-text").textContent = s.state.text;
  const ul = $("answers");
  ul.replaceChildren();
  for (const q of s.qs) {
    const opts = optionsOf(q);
    const i = opts.indexOf(s.d[q.id]);
    const li = document.createElement("li");
    li.textContent = `${q.id}: ${s.d[q.id]} (${Math.round(s.P[q.id][i] * 100)}% before sharpening)`;
    ul.appendChild(li);
  }
}

function setProgress(step, phase) {
  $("progress").max = app.budget;
  $("progress").value = step;
  $("progress-label").textContent = step === 0 ? "Ready" : step >= app.budget && !phase
    ? `Finished: ${app.budget} marks` : `Mark ${step} of ${app.budget}, now painting the ${phase}`;
}

function setMapProgress(value, max, label) {
  $("progress").max = max;
  $("progress").value = value;
  $("progress-label").textContent = label;
}

const Q_LABEL = { gesture: "Gesture", place: "Place", size: "Size", medium: "Medium", colour: "Colour role", fill: "Fill",
  weight: "Weight" };
const SHOWN = 4; // the top options per question; the rest are summed into "other"
const pct = (p) => (p > 0 && p < 0.005 ? "<1%" : `${Math.round(p * 100)}%`);

/** The rows of one card: the top options, the chosen one if it ranks lower, and "other" (the sum of the rest). */
function oddsRows(options, probs, chosen) {
  const order = options.map((o, i) => ({ o, p: probs[i], i })).sort((a, b) => b.p - a.p || a.i - b.i);
  const shown = order.slice(0, SHOWN);
  if (!shown.some((r) => r.o === chosen)) shown.push(order.find((r) => r.o === chosen));
  const rest = order.filter((r) => !shown.includes(r));
  const rows = shown.map((r) => ({ label: r.o, option: r.o, p: r.p, chosen: r.o === chosen }));
  if (rest.length) rows.push({ label: `other (${rest.length})`, option: "", p: rest.reduce((a, r) => a + r.p, 0), chosen: false, other: true });
  return rows;
}

function oddsItem(label, p, { chosen = false, option = "", other = false, swatch = "" } = {}) {
  const li = document.createElement("li");
  li.dataset.option = option;
  li.dataset.p = String(p);
  if (chosen) li.classList.add("chosen");
  if (other) li.classList.add("other");
  const name = document.createElement("span");
  name.className = "o-name";
  if (swatch) {
    const sw = document.createElement("span");
    sw.className = "swatch";
    sw.style.background = swatch;
    sw.setAttribute("aria-hidden", "true");
    name.appendChild(sw);
  }
  name.append(label);
  if (chosen) {
    const sr = document.createElement("span");
    sr.className = "sr-only";
    sr.textContent = " (picked)";
    name.appendChild(sr);
  }
  const val = document.createElement("span");
  val.className = "o-pct";
  val.textContent = pct(p);
  const bar = document.createElement("span");
  bar.className = "o-bar";
  bar.setAttribute("aria-hidden", "true");
  const fill = document.createElement("span");
  fill.className = "o-fill";
  fill.style.width = `${(p * 100).toFixed(1)}%`;
  bar.appendChild(fill);
  li.append(name, val, bar);
  return li;
}

/** One card per question; the numbers are the decision-maker's answers as validated by the harness (no other maths). */
function renderOdds({ step, budget, qs, P, chosen }) {
  const box = $("odds-cards");
  box.replaceChildren();
  for (const q of qs) {
    const card = document.createElement("div");
    card.className = "odds-card";
    card.dataset.q = q.id;
    card.setAttribute("role", "group");
    card.setAttribute("aria-labelledby", `odds-h-${q.id}`);
    const h = document.createElement("h3");
    h.id = `odds-h-${q.id}`;
    h.textContent = Q_LABEL[q.id] || q.id;
    const ol = document.createElement("ol");
    ol.className = "odds-list";
    for (const r of oddsRows(optionsOf(q), P[q.id], chosen[q.id])) ol.appendChild(oddsItem(r.label, r.p, r));
    card.append(h, ol);
    box.appendChild(card);
  }
  $("odds-mark").textContent = `for mark ${step} of ${budget}`;
  $("odds").dataset.step = String(step);
}

function clearOdds() {
  const p = document.createElement("p");
  p.className = "odds-empty";
  p.textContent = "Paint a scene and the odds for every mark appear here.";
  $("odds-cards").replaceChildren(p);
  $("odds-mark").textContent = "for each mark";
  $("odds").dataset.step = "0";
}

function showStateText() {
  $("sees").open = true;
  $("sees").scrollIntoView({ block: "start", behavior: reduceMotion.matches ? "auto" : "smooth" });
  $("state-text").focus({ preventScroll: true });
}

// ------------------------------------------------------------------------------------------------ look picker
const FIELD_LABEL = { mood: "Mood", harmony: "Harmony", hue: "Hue family", key: "Value key", saturation: "Saturation",
  composition: "Composition", style: "Style", stroke: "Strokes", subject: "Subject" };
let lookTimer = null;

function buildLookFields() {
  const box = $("look-fields");
  for (const [f, opts] of Object.entries(LOOK_FIELDS)) {
    const wrap = document.createElement("div");
    wrap.className = "field";
    const label = document.createElement("label");
    label.htmlFor = `look-${f}`;
    label.textContent = FIELD_LABEL[f];
    const sel = document.createElement("select");
    sel.id = `look-${f}`;
    for (const o of opts) {
      const op = document.createElement("option");
      op.value = o;
      op.textContent = o;
      sel.appendChild(op);
    }
    sel.addEventListener("change", () => {
      if (!app.look) return;
      app.look = { ...app.look, [f]: sel.value };
      app.lookBy = "you";
      applyAccent(app.look);
      clearTimeout(lookTimer);
      lookTimer = setTimeout(() => repaint(), 250);
    });
    wrap.append(label, sel);
    box.appendChild(wrap);
  }
}

function fillLookFields(look) {
  for (const f of Object.keys(LOOK_FIELDS)) $(`look-${f}`).value = look[f];
}

// ------------------------------------------------------------------------------------------------ the badge
/** The badge names what decided the painting on screen (or, with nothing painted, what will decide the next one). */
function showBadge(director, extra = {}) {
  const b = decisionBadge({ tab: app.tab, director, lookBy: app.lookBy, ...extra });
  $("badge-decider").textContent = b.decider;
  $("badge-note").textContent = b.note;
  $("badge-note").hidden = !b.note;
  const i = slot.director?.info;
  $("badge-model").textContent = slot.state === "ready" && i
    ? `Model: ${i.name} loaded (${i.dtype}, ${i.backend}, ${i.mb} MB)${director?.kind === "model" ? "" : ", not deciding this painting"}`
    : slot.state === "loading" ? "Model: loading" : "Model: none loaded";
}

function badgeForChoice() {
  if (app.painted) return;
  try {
    showBadge(currentDirector(), { coarse: app.coarse, blend: app.blend });
  } catch {
    showBadge({ name: "Your endpoint (no valid URL yet)", kind: "endpoint" });
  }
}

// ------------------------------------------------------------------------------------------------ painting: shared
function cancelRun() {
  if (app.run) app.run.cancelled = true;
  app.paused = false;
  $("pause").textContent = "Pause";
}

/** The Director for the next Gesture painting: an endpoint, the model (recipe; marks are the rules'), or the rules. */
function currentDirector() {
  if (useEndpoint()) return new EndpointDirector($("endpoint-url").value.trim());
  return slot.decider(rules);
}

function setRunning(running) {
  const g = app.tab === "gesture";
  $("pause").disabled = !running || !g;
  $("step").disabled = !running || !g;
  for (const id of ["replay", "copy-link"]) $(id).disabled = !app.look;
  for (const id of ["download", "save"]) $(id).disabled = !app.look || running; // only a finished picture
  $("again").disabled = !app.look;
}

function newRun() {
  cancelRun();
  const token = { cancelled: false, id: ++app.runs };
  app.run = token;
  return token;
}

function endRun(token) {
  if (app.run === token) {
    app.run = null;
    setRunning(false);
    $("cancel-run").hidden = true;
  }
}

function markDone(token) {
  document.body.dataset.done = String(token.id); // lets tests wait for this run
}

/** Repaint the current recipe in the current tab (style, grid or look changed). */
function repaint(trigger = "auto") {
  if (!app.look) return;
  if (app.tab === "map") startMap(trigger);
  else startGesture();
}

// ------------------------------------------------------------------------------------------------ painting: Gesture
async function waitTurn(token) {
  if (!reduceMotion.matches) await sleep(PACE_MS);
  else await sleep(0); // always give the page a turn between marks
  while (app.paused && !app.stepOnce && !token.cancelled) await sleep(40);
  app.stepOnce = false;
}

async function startGesture() {
  if (!app.look) return;
  const token = newRun();
  let director;
  try {
    director = currentDirector();
  } catch (e) {
    notice(e instanceof DirectorError ? `Director: ${e.message}.` : "That director could not start.");
    endRun(token);
    return;
  }
  // In Model mode the model only chooses the recipe. A recipe it did not choose (the rules', a link's, or one adjusted
  // by hand) is painted by the rules alone, and the badge says so.
  if (director.kind === "model" && app.lookBy !== "model") {
    director = rules;
    notice("This recipe was not chosen by the model, so the rules paint it. Press Paint to let the model choose the recipe.");
  }
  const opts = { prompt: app.prompt || "(a shared painting; no words)", look: app.look, seed: app.seed, budget: app.budget,
    skin: gestureStyle(), director, mode: app.pick, tick: () => sleep(0) };
  app.painted = { tab: "gesture", director };
  showBadge(director);
  setRunning(true);
  setProgress(0);
  overlay.hidden = true;
  hideCell();
  let compute = 0;
  let last = null;
  try {
    await director.init();
    let t0 = performance.now();
    for await (const s of paintSteps(opts)) {
      if (token.cancelled) return;
      app.current = s.painter;
      last = s;
      draw(s.painter.view());
      compute += performance.now() - t0;
      showState(s);
      renderOdds({ step: s.step, budget: app.budget, qs: s.qs, P: s.P, chosen: s.d });
      setProgress(s.step, s.phase);
      describeCanvas(false, s.step);
      await waitTurn(token);
      if (token.cancelled) return;
      t0 = performance.now();
    }
    if (director.kind !== "endpoint") app.msPerMark[gestureStyle()] = Math.round(0.5 * app.msPerMark[gestureStyle()] + (0.5 * compute) / app.budget);
    history.replaceState(null, "", shareOf());
    markDone(token);
    setProgress(app.budget);
    describeCanvas(true);
    updateEstimate();
    if (last) renderGestureThumbs(last, token).catch(() => {});
  } catch (e) {
    if (token.cancelled) return;
    notice(e instanceof DirectorError ? `The director stopped: ${e.message}.` : "Something went wrong while painting.");
  } finally {
    endRun(token);
  }
}

// ------------------------------------------------------------------------------------------------ painting: Map
const modelKey = () => JSON.stringify([app.prompt, app.look, app.coarse]);

/** The field for the map on screen. Model mode asks the model only when `ask` is true (Paint pressed), else reuses. */
async function mapField(token, ask) {
  const { look, seed, grid } = app;
  if (slot.mode !== "model") return { field: rulesField(look, seed, grid), source: "rules" };
  const key = modelKey();
  if (app.modelCells?.key === key) {
    return { field: fieldFromCoarse(app.modelCells.coarse, { look, seed, grid, blend: app.blend }), source: "model" };
  }
  if (!ask) {
    notice(`Showing the rules' map. Press Paint to let the model answer ${app.coarse * app.coarse} cell questions (about ${fmtMin(app.coarse * app.coarse * (slot.director.msPerQuestion || 10000))}).`);
    return { field: rulesField(look, seed, grid), source: "rules" };
  }
  const director = slot.director;
  const n = app.coarse * app.coarse;
  director.onQuestion = (k) => setMapProgress(k, n, k < n ? `The model is answering cell ${k + 1} of ${n} (${app.coarse}x${app.coarse} grid)...` : "All cells answered.");
  director.shouldStop = () => token.cancelled;
  $("cancel-run").hidden = false;
  setMapProgress(0, n, `The model is answering cell 1 of ${n} (${app.coarse}x${app.coarse} grid)...`);
  notice("");
  try {
    const t0 = performance.now();
    const r = await directorField({ director, prompt: app.prompt, look, seed, grid, coarse: app.coarse, blend: app.blend });
    app.modelCells = { key, coarse: r.coarse, P: r.P, seconds: Math.round((performance.now() - t0) / 1000) };
    return { field: r.field, source: "model" };
  } catch (e) {
    if (token.cancelled) return null;
    notice(`The model stopped (${e instanceof DirectorError ? e.message : "an error"}). The rules' map is shown instead.`);
    return { field: rulesField(look, seed, grid), source: "rules" };
  } finally {
    director.shouldStop = () => false;
    $("cancel-run").hidden = true;
  }
}

async function startMap(trigger = "auto") {
  if (!app.look) return;
  const token = newRun();
  setRunning(true);
  hideCell();
  $("cancel-run").hidden = true;
  const r = await mapField(token, trigger === "paint" || trigger === "model");
  if (!r || token.cancelled) {
    if (token.cancelled && app.run === null) notice("Cancelled. Press Paint to try again.");
    endRun(token);
    return;
  }
  const { look, seed, grid } = app;
  app.map = { field: r.field, id: mapId(look, seed, grid), palette: enginePalette(look), source: r.source };
  const director = r.source === "model" ? slot.director : rules;
  app.painted = { tab: "map", director, coarse: app.coarse, blend: app.blend };
  showBadge(director, { coarse: app.coarse, blend: app.blend });
  showMapState();
  const t0 = performance.now();
  const ok = await renderMap(token);
  if (!ok) return;
  app.mapMs[app.style.map] = Math.round(0.5 * app.mapMs[app.style.map] + 0.5 * (performance.now() - t0));
  history.replaceState(null, "", shareOf());
  setMapProgress(1, 1, `Finished: ${grid} x ${grid} cells`);
  describeCanvas(true);
  updateEstimate();
  markDone(token);
  endRun(token);
  renderMapThumbs().catch(() => {});
}

/** Draws app.map in the map style: Pixel at once; Impasto as a preview, then the composite in slices, faded in. */
async function renderMap(token) {
  const { field, id, palette } = app.map;
  if (app.style.map === "pixel") {
    draw(pixelMap(field, palette, id, app.sample), true);
  } else {
    const imp = new MapImpasto(field, palette, id);
    draw(imp.preview(), false);
    describeCanvas(false);
    setMapProgress(0, 1, "Painting the impasto...");
    const v = await imp.finalAsync({ nextFrame, stopped: () => token.cancelled });
    if (!v || token.cancelled) return false;
    await showFinal(v, token);
    if (token.cancelled) return false;
  }
  drawOverlay();
  return true;
}

function drawOverlay() {
  if (app.tab !== "map" || !app.map || !app.certainty) {
    overlay.hidden = true;
    return;
  }
  const v = certaintyMap(app.map.field);
  overlay.width = overlay.height = v.n;
  overlay.getContext("2d").putImageData(new ImageData(v.rgba(), v.n, v.n), 0, 0);
  overlay.hidden = false;
}

/** The sees panel on the Map tab: the state text a model reads for the selected cell, and that cell's odds. */
function showMapState() {
  if (!app.map) return;
  const coarse = app.map.source === "model" ? app.coarse : app.grid;
  const st = cellState({ prompt: app.prompt || "(a shared painting; no words)", look: app.look, grid: coarse });
  const c = app.cell || { x: 0, y: 0 };
  const cx = Math.min(coarse - 1, Math.floor(((c.x + 0.5) / app.grid) * coarse));
  const cy = Math.min(coarse - 1, Math.floor(((c.y + 0.5) / app.grid) * coarse));
  const q = cellQuestions(coarse, app.look)[cy * coarse + cx];
  $("state-text").textContent = cellText(st, q);
  const ul = $("answers");
  ul.replaceChildren();
  const p = cellProbs(app.map.field, c.x, c.y);
  ROLES.forEach((role, i) => {
    const li = document.createElement("li");
    li.textContent = `${role}: ${pct(p[i])}`;
    ul.appendChild(li);
  });
}

// ------------------------------------------------------------------------------------------------ the cell odds popup
function cellFromEvent(ev) {
  const r = canvas.getBoundingClientRect();
  const g = app.grid;
  const x = Math.floor(((ev.clientX - r.left) / r.width) * g), y = Math.floor(((ev.clientY - r.top) / r.height) * g);
  return x >= 0 && y >= 0 && x < g && y < g ? { x, y } : null;
}

function hideCell() {
  $("cell-pop").hidden = true;
}

/** The odds of one cell as bars over the six roles (swatch, name, percentage), with its coordinates. */
function showCell(c) {
  if (app.tab !== "map" || !app.map || !c) return;
  app.cell = c;
  const g = app.grid;
  const pop = $("cell-pop");
  const p = cellProbs(app.map.field, c.x, c.y);
  const hexes = Object.fromEntries(app.map.palette.roles);
  const h = document.createElement("p");
  h.className = "cp-title";
  h.textContent = `Cell column ${c.x + 1}, row ${c.y + 1} of ${g} x ${g}`;
  const ol = document.createElement("ol");
  ol.className = "odds-list";
  const best = p.indexOf(Math.max(...p));
  ROLES.forEach((role, i) => ol.appendChild(oddsItem(role, p[i], { option: role, chosen: i === best && app.style.map === "pixel" && app.sample === "likely", swatch: hexes[role] })));
  pop.replaceChildren(h, ol);
  pop.dataset.x = String(c.x);
  pop.dataset.y = String(c.y);
  // beside the cell, on the side with more room, and always inside the painting's frame
  pop.hidden = false;
  const fw = $("frame").clientWidth, fh = $("frame").clientHeight;
  const cw = fw / g, ch = fh / g;
  const left = c.x < g / 2 ? (c.x + 1) * cw + 4 : c.x * cw - pop.offsetWidth - 4;
  const top = c.y < g / 2 ? (c.y + 1) * ch + 4 : c.y * ch - pop.offsetHeight - 4;
  pop.style.left = `${Math.max(2, Math.min(fw - pop.offsetWidth - 2, left))}px`;
  pop.style.top = `${Math.max(2, Math.min(fh - pop.offsetHeight - 2, top))}px`;
  showMapState();
}

function wireCells() {
  canvas.addEventListener("pointermove", (ev) => { if (ev.pointerType === "mouse") showCell(cellFromEvent(ev)); });
  canvas.addEventListener("click", (ev) => showCell(cellFromEvent(ev)));
  canvas.addEventListener("pointerleave", (ev) => { if (ev.pointerType === "mouse" && document.activeElement !== canvas) hideCell(); });
  canvas.addEventListener("keydown", (ev) => {
    if (app.tab !== "map" || !app.map) return;
    const c = app.cell || { x: Math.floor(app.grid / 2), y: Math.floor(app.grid / 2) };
    const g = app.grid;
    const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (moves[ev.key]) {
      ev.preventDefault();
      const [dx, dy] = moves[ev.key];
      showCell({ x: Math.min(g - 1, Math.max(0, c.x + dx)), y: Math.min(g - 1, Math.max(0, c.y + dy)) });
    } else if (ev.key === "Escape") hideCell();
    else if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      showCell(c);
    }
  });
  canvas.addEventListener("focus", () => { if (app.tab === "map" && app.map) showCell(app.cell || { x: Math.floor(app.grid / 2), y: Math.floor(app.grid / 2) }); });
  canvas.addEventListener("blur", hideCell);
}

// ------------------------------------------------------------------------------------------------ style thumbnails
let thumbsKey = "";
function blankThumbs() {
  for (const c of document.querySelectorAll("canvas.thumb")) {
    const x = c.getContext("2d");
    x.fillStyle = "#f7f3eb";
    x.fillRect(0, 0, c.width, c.height);
  }
  thumbsKey = "";
}

function putThumb(id, v, smooth) {
  const tmp = document.createElement("canvas");
  tmp.width = tmp.height = v.n;
  tmp.getContext("2d").putImageData(new ImageData(v.rgba(), v.n, v.n), 0, 0);
  const c = $(id);
  const x = c.getContext("2d");
  x.imageSmoothingEnabled = smooth;
  x.drawImage(tmp, 0, 0, c.width, c.height);
}

/** Gesture thumbnails: the finished painting's recorded decisions replayed in every style (no director, no network). */
async function renderGestureThumbs(run, token) {
  const key = `g|${run.pid}|${JSON.stringify(run.history.map((h) => h.d))}`;
  if (key === thumbsKey) return;
  let t0 = performance.now();
  for (const [st, id] of [["brush", "thumb-brush"], ["sketch", "thumb-sketch"], ["pixel", "thumb-gpixel"]]) {
    let p = null;
    for await (const q of replayStyle(st, run.palette, run.pid, run.history, app.look.composition, app.look.stroke, 96)) {
      p = q;
      if (performance.now() - t0 > 12) { // a few marks per frame, never a long block
        await nextFrame();
        t0 = performance.now();
      }
      if (token.cancelled || (app.run !== null && app.run !== token)) return;
    }
    if (p) putThumb(id, p.view(), st !== "pixel");
  }
  thumbsKey = key;
}

/** Map thumbnails: the same field drawn as Pixel and as a small Impasto. */
async function renderMapThumbs() {
  const { field, palette, id } = app.map;
  const key = `m|${id}|${app.sample}|${app.map.source}|${app.blend}`;
  if (key === thumbsKey) return;
  putThumb("thumb-mpixel", pixelMap(field, palette, id, app.sample), false);
  const v = await new MapImpasto(field, palette, id, 96).finalAsync({ nextFrame });
  if (v) putThumb("thumb-impasto", v, true);
  thumbsKey = key;
}

/** The style controls show the painting's style; an old Paint link checks nothing on Gesture and says so. */
function showStyles() {
  setRadio("style-gesture", app.legacy ? "" : app.style.gesture);
  setRadio("style-map", app.style.map);
  $("pixel-options").hidden = app.style.map !== "pixel";
  $("legacy-note").hidden = !app.legacy;
  $("legacy-note").textContent = app.legacy
    ? "This old link uses the retired Paint look (the old Brush media), drawn exactly as before. Pick a style to redraw it." : "";
  $("style-about-gesture").textContent = STYLE_INFO.gesture[gestureStyle()].about;
  $("style-about-map").textContent = STYLE_INFO.map[app.style.map].about;
}

// ------------------------------------------------------------------------------------------------ tabs
function setTab(tab, { paint = true } = {}) {
  if (tab !== "gesture" && tab !== "map") return;
  const changed = app.tab !== tab;
  cancelRun();
  app.tab = tab;
  const m = tab === "map";
  for (const [id, on] of [["tab-gesture", !m], ["tab-map", m]]) {
    $(id).setAttribute("aria-selected", String(on));
    $(id).tabIndex = on ? 0 : -1;
  }
  $("panel-gesture").hidden = m;
  $("panel-map").hidden = !m;
  $("explainer-text").textContent = EXPLAINER[tab];
  $("odds").hidden = m;
  $("map-help").hidden = !m;
  $("pause").hidden = m;
  $("step").hidden = m;
  $("advanced").hidden = m;
  $("again-help").textContent = m
    ? "Ask it again: the same words and odds with a new seed. The variety comes from the seeded draws."
    : "Ask it again: the same words with a new seed. The variety comes from picking by the odds.";
  $("sees-help").textContent = m
    ? "The state text a model reads for the selected cell (the rules do not need it), and that cell's odds."
    : "The state text it reads before each mark (with the 5×5 canvas words) and the answers it gave.";
  $("answers-title").textContent = m ? "The selected cell's odds" : "Its answers for the last mark";
  canvas.tabIndex = m ? 0 : -1;
  if (m) canvas.setAttribute("aria-describedby", "map-help");
  else canvas.removeAttribute("aria-describedby");
  hideCell();
  overlay.hidden = true;
  blankThumbs();
  setRunning(false);
  updateEstimate();
  if (changed) {
    app.painted = null;
    badgeForChoice();
    if (paint && app.look) repaint();
    else if (!app.look) blankCanvas();
  }
}

// ------------------------------------------------------------------------------------------------ prompt, recipe, seed
function showBlocked(message) {
  cancelRun();
  app.look = null;
  app.map = null;
  app.painted = null;
  blankCanvas();
  blankThumbs();
  setProgress(0);
  setReading("");
  $("state-text").textContent = "No painting yet.";
  $("answers").replaceChildren();
  clearOdds();
  $("look").open = false;
  history.replaceState(null, "", location.pathname + location.search);
  setRunning(false);
  badgeForChoice();
  notice(message);
}

/** The recipe for these words: the endpoint or the model on the Gesture tab when chosen, else the rules (top picks). */
async function chooseRecipe(text) {
  if (useEndpoint()) return { look: await chooseLook(currentDirector(), text, app.budget), by: "endpoint" };
  if (slot.mode !== "model" || app.tab !== "gesture") return { look: await chooseLook(rules, text, app.budget), by: "rules" };
  notice("The model is reading your words to choose the recipe (six questions, a few seconds each)...");
  $("progress-label").textContent = "Choosing the recipe...";
  slot.director.onQuestion = (k, n) => { $("progress-label").textContent = k < n ? `The model is choosing the recipe: question ${k + 1} of ${n}...` : "Recipe chosen."; };
  const look = await chooseLook(slot.director, text, app.budget, { weighted: MODEL_QUESTIONS, seed: app.seed });
  notice("");
  return { look, by: "model" };
}

function readingFor(info) {
  const l = app.look;
  if (app.lookBy === "model") {
    return `Recipe from the model: ${l.mood} mood, ${l.harmony} harmony, ${l.hue} family, ${l.key} key, ${l.saturation}, ${l.composition}. An abstract, scene-like painting, not a picture of the thing.`;
  }
  if (info.known) return `Read as: ${info.matched.join(", ")}. An abstract, scene-like painting, not a picture of the thing.`;
  return "I don't know that scene, so this is a free-form painting. Steer it with \"Adjust the look\".";
}

async function onPaint(ev) {
  ev?.preventDefault();
  const now = performance.now();
  if (now - app.lastStart < 400) return; // debounce
  app.lastStart = now;
  const r = check($("prompt").value);
  if (!r.ok) {
    if (r.kind === "policy") showBlocked(BLOCK_MESSAGE);
    else notice(r.message);
    return;
  }
  const g = await runGuard(guard, r.text);
  if (g.blocked) {
    showBlocked(BLOCK_MESSAGE);
    return;
  }
  notice("");
  app.prompt = r.text;
  app.legacy = false;
  showStyles();
  readSeed(r.text);
  const info = readPrompt(r.text);
  const ticket = ++app.lookTicket;
  cancelRun();
  try {
    const rec = await chooseRecipe(r.text);
    if (ticket !== app.lookTicket) return; // a newer request replaced this one while the model was reading
    app.look = rec.look;
    app.lookBy = rec.by === "model" ? "model" : "rules";
  } catch (e) {
    if (ticket !== app.lookTicket) return;
    notice(e instanceof DirectorError ? `The director stopped: ${e.message}.` : "The director could not choose a look.");
    return;
  }
  fillLookFields(app.look);
  applyAccent(app.look);
  setReading(readingFor(info));
  if (!info.known && app.lookBy !== "model") $("look").open = true;
  repaint("paint");
}

/** Ask it again: the same words with a fresh random seed, so only the seeded picks from the odds change. */
function askAgain() {
  if (!app.look) return;
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  app.seed = a[0] % (SEED_MAX + 1);
  app.seedFromText = false;
  $("seed").value = String(app.seed);
  if (app.tab === "gesture" && slot.mode === "model" && app.prompt && !useEndpoint()) {
    const ticket = ++app.lookTicket;
    chooseRecipe(app.prompt).then((rec) => {
      if (ticket !== app.lookTicket) return;
      app.look = rec.look;
      app.lookBy = "model";
      fillLookFields(rec.look);
      applyAccent(rec.look);
      notice(`Asked again with seed ${app.seed}: same words, a new draw from the model's recipe odds and new picks for the marks.`);
      startGesture();
    }, (e) => notice(e instanceof DirectorError ? `The director stopped: ${e.message}.` : "The director could not choose a look."));
    return;
  }
  notice(app.tab === "map"
    ? `Asked again with seed ${app.seed}: same words and odds, new seeded draws.`
    : `Asked again with seed ${app.seed}: same words and look, new picks from the same odds.`);
  repaint("again");
}

function readSeed(text) {
  const raw = $("seed").value.trim();
  if (raw === "" || app.seedFromText) {
    app.seed = seedFor(text);
    app.seedFromText = true;
    $("seed").value = String(app.seed);
    return;
  }
  const v = clampInt(raw.replace(/\D/g, ""), 0, SEED_MAX, 0);
  if (String(v) !== raw) notice(`Seed must be a whole number from 0 to ${SEED_MAX}; using ${v}.`);
  $("seed").value = String(v);
  app.seed = v;
  app.seedFromText = false;
}

// ------------------------------------------------------------------------------------------------ model mode
let loadAbort = null;

async function loadModelClicked() {
  const btn = $("load-model");
  btn.disabled = true;
  btn.textContent = "Downloading model…";
  $("cancel-load").hidden = false;
  $("model-progress").hidden = false;
  $("model-progress").value = 0;
  $("model-status").textContent = "Downloading the model (about 650 MB, once; your words are not sent)...";
  showBadge(app.painted?.director || currentDirector());
  loadAbort = new AbortController();
  const state = await slot.start({ signal: loadAbort.signal, onProgress: ({ loaded, total }) => {
    $("model-progress").value = total ? loaded / total : 0;
    $("model-status").textContent = `Downloading the model: ${Math.round(loaded / 1e6)} of about ${Math.round(total / 1e6)} MB...`;
  } });
  loadAbort = null;
  $("model-progress").hidden = true;
  $("cancel-load").hidden = true;
  if (state === "ready") {
    const i = slot.director.info;
    btn.textContent = "Model enabled";
    $("decider-model").disabled = false;
    setRadio("decider", "model");
    $("model-status").textContent = `Loaded ${i.name} (${i.dtype}, ${i.mb} MB, ${i.backend}) in ${i.loadSeconds} s${i.cached ? "; kept in this browser's cache" : ""}. Model mode is on.`;
    updateEstimate();
    afterDeciderChange();
  } else {
    btn.disabled = false;
    btn.textContent = "Retry download and enable model (~650 MB)";
    setRadio("decider", "rules");
    $("model-status").textContent = `Model mode is not available: ${slot.error}. The rules stay on.`;
    if (app.painted) showBadge(app.painted.director, app.painted);
    else badgeForChoice();
  }
}

/** After Rules <-> Model: Gesture re-reads the words (the recipe changes); Map waits for Paint before asking the model. */
function afterDeciderChange() {
  updateEstimate();
  if (!$("prompt").value.trim() || !app.look) {
    app.painted = null;
    badgeForChoice();
    return;
  }
  if (app.tab === "gesture") onPaint();
  else if (slot.mode === "model") {
    notice(`Model mode is on. Press Paint to let the model answer ${app.coarse * app.coarse} cell questions (about ${fmtMin(app.coarse * app.coarse * (slot.director.msPerQuestion || 10000))}); the map on screen is still the rules'.`);
  } else repaint();
}

// ------------------------------------------------------------------------------------------------ files and links
function exportCanvas() {
  if (canvas.width >= 200) return canvas;
  const f = canvas.width === PIXEL_N ? 10 : Math.ceil(600 / canvas.width);
  const big = document.createElement("canvas");
  big.width = big.height = canvas.width * f;
  const c = big.getContext("2d");
  c.imageSmoothingEnabled = false;
  c.drawImage(canvas, 0, 0, big.width, big.height);
  return big;
}

function downloadCanvas(cv, name) {
  cv.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
}

const recipeNow = () => ({ tab: app.tab, style: app.tab === "map" ? app.style.map : gestureStyle(), look: app.look,
  seed: app.seed, budget: app.budget, mode: app.pick, grid: app.grid, sample: app.sample, coarse: app.coarse });
const shareOf = () => (!app.look ? "" : encodeShare(recipeNow()));
const fileName = (o) => `decisive-painter-${o.look.hue}-${o.look.mood}-seed${o.seed}-${o.tab === "map" ? `${o.grid}grid` : `${o.budget}marks`}-${o.style}.png`;

async function copyLink() {
  const url = location.href.split("#")[0] + shareOf();
  const decided = app.painted?.director?.kind;
  const extra = decided === "model" || decided === "endpoint"
    ? " It opens with the rules, so what the model or your endpoint decided will differ; the visitor can load the model." : "";
  try {
    await navigator.clipboard.writeText(url);
    notice(`Link copied (no words, just the recipe, seed and settings).${extra}`);
  } catch {
    notice(`Copy this link: ${url}${extra}`);
  }
}

function thumbnail(src) {
  const t = document.createElement("canvas");
  t.width = t.height = 96;
  const c = t.getContext("2d");
  c.imageSmoothingEnabled = src.width >= 200;
  c.drawImage(src, 0, 0, 96, 96);
  return t.toDataURL("image/jpeg", 0.8);
}

const describeEntry = (e) => `${e.look.mood} ${e.look.hue}, ${e.look.composition}, seed ${e.seed}, ${e.tab === "map"
  ? `${e.grid}x${e.grid} map` : `${e.budget} marks`}, ${(STYLE_INFO[e.tab][e.style] || {}).label || e.style}`;

function renderGallery() {
  const ul = $("gallery-list");
  ul.replaceChildren();
  if (!storageAvailable()) {
    const li = document.createElement("li");
    li.textContent = "This browser is not letting the page store anything, so the gallery is off. Everything else works.";
    ul.appendChild(li);
    return;
  }
  const items = listPaintings();
  if (!items.length) {
    const li = document.createElement("li");
    li.textContent = "Nothing saved yet.";
    ul.appendChild(li);
  }
  for (const e of items) {
    const li = document.createElement("li");
    li.className = "g-item";
    const desc = describeEntry(e);
    if (e.thumb) {
      const img = document.createElement("img");
      img.src = e.thumb;
      img.alt = `Saved painting: ${desc}`;
      img.width = img.height = 64;
      li.appendChild(img);
    }
    const p = document.createElement("p");
    p.textContent = desc;
    const mk = (label, aria, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.setAttribute("aria-label", `${aria}: ${desc}`);
      b.addEventListener("click", fn);
      return b;
    };
    const actions = document.createElement("div");
    actions.className = "g-actions";
    actions.append(mk("Open", "Open saved painting", () => openRecipe(e, "saved")),
      mk("Download", "Download saved painting", () => downloadRecipe(e)),
      mk("Delete", "Delete saved painting", () => { deletePainting(e.id); renderGallery(); }));
    li.append(p, actions);
    ul.appendChild(li);
  }
}

/** Redraw a saved recipe offscreen with the rules (as a shared link would) and download it. */
async function downloadRecipe(e) {
  let v;
  if (e.tab === "map") {
    const field = rulesField(e.look, e.seed, e.grid);
    const id = mapId(e.look, e.seed, e.grid);
    const pal = enginePalette(e.look);
    v = e.style === "pixel" ? pixelMap(field, pal, id, e.sample) : await new MapImpasto(field, pal, id).finalAsync({ nextFrame });
  } else {
    let last = null;
    for await (const s of paintSteps({ prompt: "(saved painting)", look: e.look, seed: e.seed, budget: e.budget, skin: e.style,
      director: rules, mode: e.mode, tick: () => sleep(0) })) last = s;
    v = last.painter.view();
  }
  const cv = document.createElement("canvas");
  cv.width = cv.height = v.n;
  cv.getContext("2d").putImageData(new ImageData(v.rgba(), v.n, v.n), 0, 0);
  let out = cv;
  if (v.n < 200) {
    const f = v.n === PIXEL_N ? 10 : Math.ceil(600 / v.n);
    out = document.createElement("canvas");
    out.width = out.height = v.n * f;
    const c = out.getContext("2d");
    c.imageSmoothingEnabled = false;
    c.drawImage(cv, 0, 0, out.width, out.height);
  }
  downloadCanvas(out, fileName(e));
}

/** Open a saved or shared recipe: always with the rules (a link never carries model output). */
function openRecipe(r, from = "link") {
  cancelRun();
  app.look = r.look;
  app.lookBy = "link";
  app.seed = r.seed;
  app.seedFromText = false;
  app.budget = r.budget;
  app.pick = r.mode;
  app.grid = r.grid;
  app.sample = r.sample;
  app.coarse = r.coarse;
  app.prompt = "";
  app.legacy = r.tab === "gesture" && r.style === "paint";
  if (r.tab === "map") app.style.map = r.style;
  else if (!app.legacy) app.style.gesture = r.style;
  $("prompt").value = "";
  $("seed").value = String(r.seed);
  $("budget").value = String(r.budget);
  $("budget-out").textContent = String(r.budget);
  $("grid").value = String(r.grid);
  $("grid-out").textContent = $("grid-out2").textContent = String(r.grid);
  $("coarse").value = String(r.coarse);
  setRadio("pick", r.mode);
  setRadio("sample", r.sample);
  setRadio("director", "rules");
  $("endpoint-box").hidden = true;
  setRadio("decider", slot.setMode("rules")); // a shared or saved painting opens with the rules
  fillLookFields(r.look);
  applyAccent(r.look);
  showStyles();
  setReading(from === "saved"
    ? "A saved painting: the recipe, seed and settings are stored, not the words. Drawn with the rules."
    : "A shared painting: the link carries the recipe, seed and settings, not the words. Drawn with the rules; load the model to let it decide.");
  updateEstimate();
  if (app.tab !== r.tab) setTab(r.tab, { paint: false });
  repaint();
}

function openFromHash() {
  if (!location.hash.includes("=")) return; // in-page anchors such as the skip link are not painting links
  let r;
  try {
    r = decodeShare(location.hash);
  } catch (e) {
    notice(e instanceof ShareError ? e.message : "This painting link cannot be read.");
    history.replaceState(null, "", location.pathname + location.search);
    return;
  }
  if (r) openRecipe(r);
}

// ------------------------------------------------------------------------------------------------ wiring
function wire() {
  $("prompt-form").addEventListener("submit", onPaint);
  $("seed").addEventListener("input", () => {
    const value = $("seed").value.trim();
    app.seedFromText = value === "" || value === String(app.seed);
  });
  for (const button of document.querySelectorAll("[data-example]")) {
    button.addEventListener("click", () => {
      $("prompt").value = button.dataset.example;
      $("prompt-form").requestSubmit();
    });
  }
  const tabs = ["tab-gesture", "tab-map"];
  $("tab-gesture").addEventListener("click", () => setTab("gesture"));
  $("tab-map").addEventListener("click", () => setTab("map"));
  for (const id of tabs) {
    $(id).addEventListener("keydown", (e) => {
      const i = tabs.indexOf(id);
      const j = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (j === undefined) return;
      e.preventDefault();
      const other = tabs[(j + tabs.length) % tabs.length];
      $(other).focus();
      $(other).click();
    });
  }
  $("pause").addEventListener("click", () => {
    app.paused = !app.paused;
    $("pause").textContent = app.paused ? "Resume" : "Pause";
  });
  $("step").addEventListener("click", () => {
    if (!app.paused) {
      app.paused = true;
      $("pause").textContent = "Resume";
    }
    app.stepOnce = true;
  });
  $("cancel-run").addEventListener("click", () => {
    if (!app.run) return;
    cancelRun();
    endRun(app.run);
    setMapProgress(0, 1, "Cancelled");
    notice("Cancelled. Nothing more is asked of the model; press Paint to try again.");
  });
  $("replay").addEventListener("click", () => repaint());
  $("show-state").addEventListener("click", showStateText);
  $("download").addEventListener("click", () => downloadCanvas(exportCanvas(), fileName(recipeNow())));
  $("copy-link").addEventListener("click", copyLink);
  $("save").addEventListener("click", () => {
    if (!app.look) return;
    const ok = savePainting({ ...recipeNow(), thumb: thumbnail(canvas) });
    notice(ok ? "Saved in this browser." : "This browser is not letting the page store anything, so it was not saved.");
    renderGallery();
  });
  $("again").addEventListener("click", askAgain);
  $("load-model").addEventListener("click", loadModelClicked);
  $("cancel-load").addEventListener("click", () => loadAbort?.abort());
  for (const el of document.querySelectorAll('input[name="decider"]')) {
    el.addEventListener("change", () => {
      setRadio("decider", slot.setMode(radioValue("decider")));
      afterDeciderChange();
    });
  }
  $("budget").addEventListener("input", () => {
    app.budget = clampInt($("budget").value, BUDGET_MIN, BUDGET_MAX, BUDGET_DEFAULT);
    $("budget-out").textContent = String(app.budget);
    updateEstimate();
  });
  $("budget").addEventListener("change", () => { if (app.look) startGesture(); });
  $("grid").addEventListener("input", () => {
    app.grid = clampInt($("grid").value, GRID_MIN, GRID_MAX, GRID_DEFAULT);
    $("grid-out").textContent = $("grid-out2").textContent = String(app.grid);
  });
  $("grid").addEventListener("change", () => { app.cell = null; if (app.look) startMap(); });
  for (const el of document.querySelectorAll('input[name="style-gesture"]')) {
    el.addEventListener("change", () => {
      app.style.gesture = radioValue("style-gesture");
      app.legacy = false;
      showStyles();
      updateEstimate();
      if (app.look) startGesture();
    });
  }
  for (const el of document.querySelectorAll('input[name="style-map"]')) {
    el.addEventListener("change", () => {
      app.style.map = radioValue("style-map");
      showStyles();
      updateEstimate();
      if (app.look) startMap();
    });
  }
  for (const el of document.querySelectorAll('input[name="sample"]')) {
    el.addEventListener("change", () => {
      app.sample = radioValue("sample");
      if (app.look && app.style.map === "pixel") startMap();
    });
  }
  $("certainty").addEventListener("change", () => {
    app.certainty = $("certainty").checked;
    drawOverlay();
  });
  $("coarse").addEventListener("change", () => {
    app.coarse = clampCoarse($("coarse").value);
    updateEstimate();
    if (slot.mode === "model" && app.look && app.tab === "map") notice(`Press Paint to let the model answer the ${app.coarse}x${app.coarse} grid.`);
  });
  $("blend").addEventListener("change", () => {
    app.blend = $("blend").checked;
    if (app.look && app.tab === "map" && app.map?.source === "model") startMap();
  });
  for (const el of document.querySelectorAll('input[name="pick"]')) {
    el.addEventListener("change", () => {
      app.pick = radioValue("pick");
      if (app.look && app.tab === "gesture") startGesture();
    });
  }
  for (const el of document.querySelectorAll('input[name="director"]')) {
    el.addEventListener("change", () => {
      $("endpoint-box").hidden = radioValue("director") !== "endpoint";
      app.painted = null;
      badgeForChoice();
    });
  }
  $("endpoint-url").addEventListener("change", badgeForChoice);
  $("gallery").addEventListener("toggle", () => { if ($("gallery").open) renderGallery(); });
  window.addEventListener("hashchange", () => {
    if (location.hash && location.hash !== shareOf()) openFromHash();
  });
  wireCells();
}

/** A short offscreen painting at load measures this device's speed for the estimate (no network, no storage). */
async function benchmark() {
  const look = readPrompt("a harbour at dawn").look;
  for (const skin of ["brush", "sketch", "pixel"]) {
    let ms = 0;
    let n = 0;
    let t0 = performance.now();
    for await (const s of paintSteps({ prompt: "benchmark", look, seed: 1, budget: 10, skin, director: rules, tick: () => sleep(0) })) {
      ms += performance.now() - t0;
      n = s.step;
      if (n >= 4) break;
      await nextFrame(); // one mark per task, so the measurement never blocks the page
      t0 = performance.now();
    }
    app.msPerMark[skin] = Math.round(ms / n);
  }
  app.msPerMark.paint = Math.round(app.msPerMark.brush * 1.25);
  updateEstimate();
}

blankCanvas();
blankThumbs();
showStyles();
buildLookFields();
wire();
setTab("gesture", { paint: false });
badgeForChoice();
updateEstimate();
openFromHash();
setTimeout(benchmark, 300);

