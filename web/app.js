// The page: prompt -> guardrails -> look -> the harness paints mark by mark with the chosen Director and skin.
// Visitor text is only ever written with textContent; the page makes no network request unless the visitor turns on
// their own endpoint under Advanced.
import { DirectorError, EndpointDirector, RuleDirector, chooseLook, directorBadge, optionsOf, paintSteps, sharpen } from "./director.js";
import { DisabledGuard, runGuard } from "./guard.js";
import { BLOCK_MESSAGE, check } from "./policy.js";
import { LOOK_FIELDS, readPrompt } from "./recipes.js";
import { PIXEL_N, enginePalette, hexRgb } from "./render.js";
import { Rng, fnv1a, seedString } from "./rng.js";
import { BUDGET_DEFAULT, BUDGET_MAX, BUDGET_MIN, SEED_MAX, ShareError, clampInt, decodeShare, encodeShare } from "./share.js";
import { FILLS, GESTURES, MEDIA, SIZES, WEIGHTS } from "./state.js";
import { deletePainting, listPaintings, savePainting, storageAvailable } from "./store.js";

const $ = (id) => document.getElementById(id);
const canvas = $("canvas");
const ctx = canvas.getContext("2d");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const PACE_MS = 90; // pause between marks so the painting can be watched (0 with reduced motion)

const rules = new RuleDirector();
const guard = new DisabledGuard();

const app = {
  mode: "paint",
  prompt: "",
  look: null,
  seed: null,
  seedFromText: true,
  budget: BUDGET_DEFAULT,
  skin: "paint",
  pick: "weighted",
  run: null,
  paused: false,
  stepOnce: false,
  lastStart: -Infinity,
  finished: null,
  msPerMark: { paint: 40, pixel: 8, sketch: 12 },
  pending: null,
  diceCount: 0,
  runs: 0,
};

// ------------------------------------------------------------------------------------------------ small helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const el = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (el) el.checked = true;
}

function updateEstimate() {
  const per = app.msPerMark[app.skin] + (reduceMotion.matches || app.mode === "director" ? 0 : PACE_MS);
  const s = Math.max(1, Math.round((app.budget * per) / 1000));
  $("estimate").textContent = app.mode === "director"
    ? "You decide every mark, so it takes as long as you like."
    : `About ${s} second${s === 1 ? "" : "s"} on this device (measured here).`;
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
function draw(view) {
  if (canvas.width !== view.n) {
    canvas.width = view.n;
    canvas.height = view.n;
  }
  canvas.classList.toggle("pixelated", view.n === PIXEL_N);
  ctx.putImageData(new ImageData(view.rgba(), view.n, view.n), 0, 0);
}

function blankCanvas() {
  canvas.width = 600;
  canvas.height = 600;
  canvas.classList.remove("pixelated");
  ctx.fillStyle = "#f7f3eb";
  ctx.fillRect(0, 0, 600, 600);
  canvas.setAttribute("aria-label", "Blank paper, waiting for a scene");
}

function describeCanvas(done, step) {
  const l = app.look;
  canvas.setAttribute("aria-label", done
    ? `Abstract painting in ${app.budget} marks: ${l.mood} mood, ${l.hue} family, ${l.key} key, ${l.composition} composition, ${app.skin} skin`
    : `Painting in progress, mark ${step} of ${app.budget}`);
}

// ------------------------------------------------------------------------------------------------ the director panel
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
      applyAccent(app.look);
      clearTimeout(lookTimer);
      lookTimer = setTimeout(() => startPainting(), 250);
    });
    wrap.append(label, sel);
    box.appendChild(wrap);
  }
}

function fillLookFields(look) {
  for (const f of Object.keys(LOOK_FIELDS)) $(`look-${f}`).value = look[f];
}

// ------------------------------------------------------------------------------------------------ be the director
const Q_HINT = {
  gesture: "The kind of mark: a shape or a set of lines.",
  place: "Where it goes: a named part of the composition or one cell of the 5x5 grid.",
  size: "How much of that place it covers.",
  medium: "What it is drawn with; this changes width, grain and edges.",
  colour: "Which colour of the painting's palette it uses.",
  fill: "For shapes: solid, a thin veil, only the edge, or parallel lines.",
  weight: "How strong the marks are.",
};
const ABOUT = { gesture: GESTURES, medium: MEDIA, fill: FILLS, size: SIZES, weight: WEIGHTS };

class HumanDirector {
  name = "You";
  kind = "human";
  async init() {}
  decide(state, questions) {
    return new Promise((resolve, reject) => {
      app.pending = { reject };
      renderQuestions(state, questions, resolve);
    });
  }
}

/** A small die drawn as inline SVG (no emoji font needed). */
function dieIcon() {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "22");
  svg.setAttribute("height", "22");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const r = document.createElementNS(NS, "rect");
  for (const [k, v] of Object.entries({ x: 3, y: 3, width: 18, height: 18, rx: 4, fill: "none", stroke: "currentColor", "stroke-width": 2 })) r.setAttribute(k, v);
  svg.appendChild(r);
  for (const [cx, cy] of [[8, 8], [16, 8], [12, 12], [8, 16], [16, 16]]) {
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", cx);
    c.setAttribute("cy", cy);
    c.setAttribute("r", 1.6);
    c.setAttribute("fill", "currentColor");
    svg.appendChild(c);
  }
  return svg;
}

function diceFor(state, q) {
  const p = sharpen(optionsOf(q).map((o) => rules.weights(state, q)[o]));
  const r = new Rng(seedString("dice", state.step, q.id, app.seed, app.diceCount++));
  return optionsOf(q)[r.choice(p)];
}

function renderQuestions(state, questions, resolve) {
  $("director-ui").hidden = false;
  $("state-text").textContent = state.text; // in this mode the visitor is the director, so they see the current state
  $("d-step").textContent = String(state.step);
  $("d-total").textContent = String(state.budget);
  $("d-phase").textContent = state.phase;
  const box = $("d-questions");
  box.replaceChildren();
  const sels = {};
  for (const q of questions) {
    const wrap = document.createElement("div");
    wrap.className = "field dq";
    const label = document.createElement("label");
    label.htmlFor = `dq-${q.id}`;
    label.textContent = q.id;
    const sel = document.createElement("select");
    sel.id = `dq-${q.id}`;
    sel.setAttribute("aria-describedby", `dq-${q.id}-hint`);
    for (const o of optionsOf(q)) {
      const op = document.createElement("option");
      op.value = o;
      const about = ABOUT[q.id]?.[o] || (q.id === "colour" ? q.about[o] : "");
      op.textContent = about ? `${o} (${about})` : o;
      sel.appendChild(op);
    }
    sel.value = diceFor(state, q);
    const dice = document.createElement("button");
    dice.type = "button";
    dice.className = "dice";
    dice.appendChild(dieIcon());
    dice.setAttribute("aria-label", `Let the director choose the ${q.id}`);
    dice.addEventListener("click", () => { sel.value = diceFor(state, q); });
    const hint = document.createElement("p");
    hint.className = "help";
    hint.id = `dq-${q.id}-hint`;
    hint.textContent = Q_HINT[q.id] || q.text;
    const line = document.createElement("div");
    line.className = "dq-line";
    line.append(sel, dice);
    wrap.append(label, line, hint);
    box.appendChild(wrap);
    sels[q.id] = sel;
  }
  $("d-dice-all").onclick = () => { for (const q of questions) sels[q.id].value = diceFor(state, q); };
  $("d-apply").onclick = () => {
    app.pending = null;
    resolve(questions.map((q) => ({ id: q.id, probs: { [sels[q.id].value]: 1 } })));
  };
}

// ------------------------------------------------------------------------------------------------ painting
function cancelRun() {
  if (app.run) app.run.cancelled = true;
  if (app.pending) {
    app.pending.reject(new DirectorError("stopped"));
    app.pending = null;
  }
  app.paused = false;
  $("pause").textContent = "Pause";
}

function currentDirector() {
  if (app.mode === "director") return new HumanDirector();
  if (radioValue("director") === "endpoint") return new EndpointDirector($("endpoint-url").value.trim());
  return rules;
}

/** The badge always names the Director that answers: the rules, an endpoint, the visitor, or a model. */
function showBadge(director) {
  const b = directorBadge(director);
  $("badge-decider").textContent = b.decider;
  $("badge-model").textContent = b.model;
}

function badgeForChoice() {
  try {
    showBadge(currentDirector());
  } catch {
    showBadge({ name: "Your endpoint (no valid URL yet)", kind: "endpoint" });
  }
}

function setRunning(running) {
  const dirMode = app.mode === "director";
  $("pause").disabled = !running || dirMode;
  $("step").disabled = !running || dirMode;
  for (const id of ["replay", "download", "copy-link", "save"]) $(id).disabled = !app.look;
}

async function waitTurn(token) {
  if (!reduceMotion.matches && app.mode === "paint") await sleep(PACE_MS);
  while (app.paused && !app.stepOnce && !token.cancelled) await sleep(40);
  app.stepOnce = false;
}

async function startPainting() {
  if (!app.look) return;
  cancelRun();
  const token = { cancelled: false, id: ++app.runs };
  app.run = token;
  app.finished = null;
  let director;
  try {
    director = currentDirector();
  } catch (e) {
    notice(e instanceof DirectorError ? `Director: ${e.message}.` : "That director could not start.");
    return;
  }
  const opts = { prompt: app.prompt || "(a shared painting; no words)", look: app.look, seed: app.seed, budget: app.budget,
    skin: app.skin, director, mode: app.pick };
  showBadge(director);
  setRunning(true);
  setProgress(0);
  $("director-ui").hidden = app.mode !== "director";
  let compute = 0;
  try {
    await director.init();
    const gen = paintSteps(opts);
    let t0 = performance.now();
    for await (const s of gen) {
      if (token.cancelled) return;
      draw(s.painter.view());
      compute += performance.now() - t0;
      showState(s);
      setProgress(s.step, s.phase);
      describeCanvas(false, s.step);
      await waitTurn(token);
      if (token.cancelled) return;
      t0 = performance.now();
    }
    if (app.mode === "paint" && director === rules) {
      app.msPerMark[app.skin] = Math.round(0.5 * app.msPerMark[app.skin] + (0.5 * compute) / app.budget);
      history.replaceState(null, "", shareOf());
    }
    app.finished = { ...opts };
    document.body.dataset.done = String(token.id); // lets tests wait for this run
    setProgress(app.budget);
    describeCanvas(true);
    updateEstimate();
    $("director-ui").hidden = true;
  } catch (e) {
    if (token.cancelled) return;
    notice(e instanceof DirectorError ? `The director stopped: ${e.message}.` : "Something went wrong while painting.");
  } finally {
    if (app.run === token) {
      setRunning(false);
      app.run = null;
    }
  }
}

function showBlocked(message) {
  cancelRun();
  app.look = null;
  blankCanvas();
  setProgress(0);
  setReading("");
  $("state-text").textContent = "No painting yet.";
  $("answers").replaceChildren();
  $("director-ui").hidden = true;
  $("look").open = false;
  history.replaceState(null, "", location.pathname + location.search);
  setRunning(false);
  notice(message);
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
  readSeed(r.text);
  const info = readPrompt(r.text);
  try {
    const dir = radioValue("director") === "endpoint" && app.mode === "paint" ? currentDirector() : rules;
    app.look = await chooseLook(dir, r.text, app.budget);
  } catch (e) {
    notice(e instanceof DirectorError ? `The director stopped: ${e.message}.` : "The director could not choose a look.");
    return;
  }
  fillLookFields(app.look);
  applyAccent(app.look);
  if (info.known) {
    setReading(`Read as: ${info.matched.join(", ")}. An abstract, scene-like painting, not a picture of the thing.`);
  } else {
    setReading("I don't know that scene, so this is a free-form painting. Steer it with \"Adjust the look\".");
    $("look").open = true;
  }
  startPainting();
}

function readSeed(text) {
  const raw = $("seed").value.trim();
  if (raw === "") {
    app.seed = seedFor(text);
    app.seedFromText = true;
    return;
  }
  const v = clampInt(raw.replace(/\D/g, ""), 0, SEED_MAX, 0);
  if (String(v) !== raw) notice(`Seed must be a whole number from 0 to ${SEED_MAX}; using ${v}.`);
  $("seed").value = String(v);
  app.seed = v;
  app.seedFromText = false;
}

// ------------------------------------------------------------------------------------------------ files and links
function exportCanvas() {
  if (canvas.width !== PIXEL_N) return canvas;
  const big = document.createElement("canvas");
  big.width = big.height = PIXEL_N * 10;
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

const shareOf = () => (!app.look ? "" : encodeShare({ look: app.look, seed: app.seed, budget: app.budget, skin: app.skin, mode: app.pick }));
const fileName = (o) => `menu-painter-${o.look.hue}-${o.look.mood}-seed${o.seed}-${o.budget}marks-${o.skin}.png`;

async function copyLink() {
  const url = location.href.split("#")[0] + shareOf();
  const extra = radioValue("director") === "endpoint" || app.mode === "director"
    ? " It redraws with the built-in rules, so marks you or your endpoint chose will differ." : "";
  try {
    await navigator.clipboard.writeText(url);
    notice(`Link copied (no words, just the look, seed and marks).${extra}`);
  } catch {
    notice(`Copy this link: ${url}${extra}`);
  }
}

function thumbnail() {
  const t = document.createElement("canvas");
  t.width = t.height = 96;
  const c = t.getContext("2d");
  c.imageSmoothingEnabled = canvas.width !== PIXEL_N;
  c.drawImage(canvas, 0, 0, 96, 96);
  return t.toDataURL("image/jpeg", 0.8);
}

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
    const desc = `${e.look.mood} ${e.look.hue}, ${e.look.composition}, seed ${e.seed}, ${e.budget} marks, ${e.skin}`;
    if (e.thumb) {
      const img = document.createElement("img");
      img.src = e.thumb;
      img.alt = `Saved painting: ${desc}`;
      img.width = img.height = 64;
      li.appendChild(img);
    }
    const p = document.createElement("p");
    p.textContent = desc;
    const open = document.createElement("button");
    open.type = "button";
    open.textContent = "Open";
    open.setAttribute("aria-label", `Open saved painting: ${desc}`);
    open.addEventListener("click", () => openRecipe(e));
    const dl = document.createElement("button");
    dl.type = "button";
    dl.textContent = "Download";
    dl.setAttribute("aria-label", `Download saved painting: ${desc}`);
    dl.addEventListener("click", () => downloadRecipe(e));
    const del = document.createElement("button");
    del.type = "button";
    del.textContent = "Delete";
    del.setAttribute("aria-label", `Delete saved painting: ${desc}`);
    del.addEventListener("click", () => {
      deletePainting(e.id);
      renderGallery();
    });
    const actions = document.createElement("div");
    actions.className = "g-actions";
    actions.append(open, dl, del);
    li.append(p, actions);
    ul.appendChild(li);
  }
}

async function downloadRecipe(e) {
  let last = null;
  for await (const s of paintSteps({ prompt: "(saved painting)", look: e.look, seed: e.seed, budget: e.budget, skin: e.skin,
    director: rules, mode: e.mode })) last = s;
  const v = last.painter.view();
  const cv = document.createElement("canvas");
  cv.width = cv.height = v.n;
  cv.getContext("2d").putImageData(new ImageData(v.rgba(), v.n, v.n), 0, 0);
  let out = cv;
  if (v.n === PIXEL_N) {
    out = document.createElement("canvas");
    out.width = out.height = PIXEL_N * 10;
    const c = out.getContext("2d");
    c.imageSmoothingEnabled = false;
    c.drawImage(cv, 0, 0, out.width, out.height);
  }
  downloadCanvas(out, fileName(e));
}

function applyRecipe(r) {
  app.look = r.look;
  app.seed = r.seed;
  app.seedFromText = false;
  app.budget = r.budget;
  app.skin = r.skin;
  app.pick = r.mode;
  app.prompt = "";
  $("prompt").value = "";
  $("seed").value = String(r.seed);
  $("budget").value = String(r.budget);
  $("budget-out").textContent = String(r.budget);
  setRadio("skin", r.skin);
  setRadio("pick", r.mode);
  setRadio("director", "rules");
  $("endpoint-box").hidden = true;
  fillLookFields(r.look);
  applyAccent(r.look);
  updateEstimate();
}

function openRecipe(r) {
  setMode("paint");
  applyRecipe(r);
  setReading("A saved or shared painting: the look, seed and marks are stored, not the words.");
  startPainting();
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

// ------------------------------------------------------------------------------------------------ modes and wiring
function setMode(mode) {
  if (app.mode === mode) return;
  cancelRun();
  app.mode = mode;
  const dir = mode === "director";
  $("tab-paint").setAttribute("aria-selected", String(!dir));
  $("tab-director").setAttribute("aria-selected", String(dir));
  $("tab-paint").tabIndex = dir ? -1 : 0;
  $("tab-director").tabIndex = dir ? 0 : -1;
  $("panel-mode").setAttribute("aria-labelledby", dir ? "tab-director" : "tab-paint");
  $("paint").textContent = dir ? "Start" : "Paint";
  $("director-ui").hidden = true;
  setRunning(false);
  updateEstimate();
  badgeForChoice();
  notice(dir ? "Type a scene and press Start; then choose each mark yourself." : "");
}

function wire() {
  $("prompt-form").addEventListener("submit", onPaint);
  $("tab-paint").addEventListener("click", () => setMode("paint"));
  $("tab-director").addEventListener("click", () => setMode("director"));
  for (const id of ["tab-paint", "tab-director"]) {
    $(id).addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const other = id === "tab-paint" ? "tab-director" : "tab-paint";
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
  $("replay").addEventListener("click", () => startPainting());
  $("download").addEventListener("click", () => downloadCanvas(exportCanvas(), fileName(app)));
  $("copy-link").addEventListener("click", copyLink);
  $("save").addEventListener("click", () => {
    if (!app.look) return;
    const ok = savePainting({ look: app.look, seed: app.seed, budget: app.budget, skin: app.skin, mode: app.pick, thumb: thumbnail() });
    notice(ok ? "Saved in this browser." : "This browser is not letting the page store anything, so it was not saved.");
    renderGallery();
  });
  $("surprise").addEventListener("click", () => {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    $("seed").value = String(a[0] % (SEED_MAX + 1));
    if (app.look) {
      app.seed = Number($("seed").value);
      app.seedFromText = false;
      startPainting();
    } else onPaint();
  });
  $("budget").addEventListener("input", () => {
    app.budget = clampInt($("budget").value, BUDGET_MIN, BUDGET_MAX, BUDGET_DEFAULT);
    $("budget-out").textContent = String(app.budget);
    updateEstimate();
  });
  $("budget").addEventListener("change", () => { if (app.look) startPainting(); });
  for (const el of document.querySelectorAll('input[name="skin"]')) {
    el.addEventListener("change", () => {
      app.skin = radioValue("skin");
      updateEstimate();
      if (app.look) startPainting();
    });
  }
  for (const el of document.querySelectorAll('input[name="pick"]')) {
    el.addEventListener("change", () => {
      app.pick = radioValue("pick");
      if (app.look) startPainting();
    });
  }
  for (const el of document.querySelectorAll('input[name="director"]')) {
    el.addEventListener("change", () => {
      $("endpoint-box").hidden = radioValue("director") !== "endpoint";
      badgeForChoice();
    });
  }
  $("endpoint-url").addEventListener("change", badgeForChoice);
  $("gallery").addEventListener("toggle", () => { if ($("gallery").open) renderGallery(); });
  window.addEventListener("hashchange", () => {
    if (location.hash && location.hash !== shareOf()) openFromHash();
  });
}

/** A short offscreen painting at load measures this device's speed for the estimate (no network, no storage). */
async function benchmark() {
  const look = readPrompt("a harbour at dawn").look;
  for (const skin of ["paint", "pixel"]) {
    const t0 = performance.now();
    let n = 0;
    for await (const s of paintSteps({ prompt: "benchmark", look, seed: 1, budget: 10, skin, director: rules })) {
      n = s.step;
      if (n >= 4) break;
    }
    app.msPerMark[skin] = Math.round((performance.now() - t0) / n);
    if (skin === "pixel") app.msPerMark.sketch = Math.round(app.msPerMark.paint * 0.35);
  }
  updateEstimate();
}

blankCanvas();
buildLookFields();
wire();
showBadge(rules);
updateEstimate();
openFromHash();
setTimeout(benchmark, 300);
