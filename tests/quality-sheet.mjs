// Round 23 quality sheet: for 40 prompts, three recipe cards in shuffled columns (Rules, Model, a plain hash baseline),
// each with the six role colours and the first 12 marks of a 30-mark painting. The key is a separate file.
//   MODEL_MIRROR=<dir> node tests/quality-sheet.mjs <outdir>      (or MODEL_LIVE=1)
// Writes <outdir>/sheet.html, thumbs/, key.json (do not open before judging), answers.csv (empty form),
// coverage.md (which prompts the keyword table matched), model-looks.json, and validates the sheet.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Browser } from "./lib/cdp.mjs";
import { serveMirror } from "./lib/mirror.mjs";
import { serve } from "./lib/serve.mjs";
import { writePng } from "./lib/png.mjs";
import { mirrorPath } from "./model-files.mjs";
import { RuleDirector, chooseLook, paintSteps } from "../web/director.js";
import { check } from "../web/policy.js";
import { LOOK_FIELDS, readPrompt } from "../web/recipes.js";
import { enginePalette } from "../web/render.js";
import { Rng, fnv1a } from "../web/rng.js";

const OUT = process.argv[2];
if (!OUT) throw new Error("usage: node tests/quality-sheet.mjs <outdir>");
const ROOT = new URL("../", import.meta.url).pathname;
export const PROMPTS = [
  // the 12 Round 12 scenes
  "a lighthouse in a storm", "a field of sunflowers at noon", "snowy pine forest at dawn", "a fishing boat at sunset",
  "city rooftops in the rain", "desert dunes under a full moon", "a quiet pond with lily pads", "an autumn forest path",
  "a red barn on a hill", "waves breaking on rocks", "a night market", "a mountain lake reflection",
  // 28 ordinary ones: colours, places, weather, foods, animals
  "purple tulips in a vase", "a bowl of ramen", "a sleepy orange cat", "a busy train station", "fog over a harbour",
  "a slice of watermelon", "a blue whale", "a rainy cafe window", "a pink flamingo", "a snowy mountain cabin",
  "green tea and cookies", "a golden retriever on a beach", "a thunderstorm over wheat fields", "a red umbrella in the rain",
  "cherry blossoms in spring", "a desert cactus at sunset", "a bowl of lemons", "a crowded beach in summer",
  "a frozen lake in winter", "an old library with candles", "a jellyfish in dark water", "a chocolate cake",
  "a hot air balloon over hills", "a misty bamboo forest", "a parrot in the jungle", "a lavender field",
  "a neon city street at night", "a bakery at dawn",
];
const SIX = ["mood", "harmony", "hue", "key", "saturation", "composition"];
const seedFor = (text) => fnv1a(`seed|${text.trim().toLowerCase()}`) % 1000000; // as the page does

/** The plain hash baseline: each of the six answers from its own hash of the words (other fields as the rules). */
function hashBaseline(prompt, rulesLook) {
  const out = { ...rulesLook };
  for (const f of SIX) out[f] = LOOK_FIELDS[f][fnv1a(`baseline|${f}|${prompt.trim().toLowerCase()}`) % LOOK_FIELDS[f].length];
  return out;
}

async function modelLooks() {
  const MIR = process.env.MODEL_MIRROR;
  if (!MIR && process.env.MODEL_LIVE !== "1") throw new Error("set MODEL_MIRROR=<dir> or MODEL_LIVE=1");
  const { server, url } = await serve(`${ROOT}web`);
  const mirror = MIR ? await serveMirror(MIR) : null;
  const b = await Browser.launch();
  const p = await b.newPage({ width: 1000, height: 800 });
  if (mirror) await p.route((u) => { const x = new URL(u); return existsSync(mirrorPath(MIR, `${x.origin}${x.pathname}`)) ? `${mirror.url}/${x.host}${x.pathname}` : "block"; });
  await p.goto(url);
  const res = await p.eval(`(async () => {
    const L = await import('./model-loader.js'); const M = await import('./model-director.js'); const D = await import('./director.js');
    const t0 = performance.now(); const { scorer, info } = await L.loadModel(); const loadMs = performance.now() - t0;
    const md = new M.ModelDirector({ scorer, info });
    const odds = {};
    const rec = { name: md.name, kind: md.kind, info: md.info, async init() {}, async decide(s, q) { const a = await md.decide(s, q); odds.last = a; return a; } };
    const out = [];
    for (const [prompt, seed] of ${JSON.stringify(PROMPTS.map((x) => [x, seedFor(x)]))}) {
      const t1 = performance.now();
      const look = await D.chooseLook(rec, prompt, 30, { weighted: M.MODEL_QUESTIONS, seed });
      out.push({ prompt, seed, look, ms: Math.round(performance.now() - t1), odds: odds.last.filter((a) => M.MODEL_QUESTIONS.includes(a.id)) });
    }
    return { info, loadMs: Math.round(loadMs), out };
  })()`);
  await b.close();
  server.close();
  if (mirror) mirror.server.close();
  return res;
}

function thumb(look, seed) {
  return (async () => {
    let last;
    for await (const s of paintSteps({ prompt: "x", look, seed, budget: 30, skin: "paint", director: new RuleDirector() })) {
      last = s;
      if (s.step >= 12) break;
    }
    const v = last.painter.view();
    const n = v.n, k = 4, m = n / k, src = v.rgba(), dst = new Uint8Array(m * m * 4);
    for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) s += src[((y * k + dy) * n + x * k + dx) * 4 + c];
      dst[(y * m + x) * 4 + c] = Math.round(s / (k * k));
    }
    return { px: dst, size: m };
  })();
}

mkdirSync(join(OUT, "thumbs"), { recursive: true });
for (const s of PROMPTS) if (!check(s).ok) throw new Error(`guardrail blocks "${s}"`);
const ml = existsSync(join(OUT, "model-looks.json")) ? JSON.parse(readFileSync(join(OUT, "model-looks.json"), "utf8")) : await modelLooks();
writeFileSync(join(OUT, "model-looks.json"), JSON.stringify(ml, null, 1));
const rng = new Rng("quality-sheet-r23");
const key = {}, coverage = [], rows = [];
for (const [i, prompt] of PROMPTS.entries()) {
  const id = String(i + 1).padStart(2, "0");
  const seed = seedFor(prompt);
  const info = readPrompt(prompt);
  const rulesLook = await chooseLook(new RuleDirector(), prompt, 30);
  const modelLook = ml.out[i].look;
  if (ml.out[i].prompt !== prompt) throw new Error("model looks out of order");
  const cards = { rules: rulesLook, model: modelLook, hash: hashBaseline(prompt, rulesLook) };
  const kind = info.scene ? "scene" : info.known ? "generic" : "hash";
  coverage.push({ id, prompt, kind, matched: info.matched });
  const order = ["rules", "model", "hash"];
  for (let j = order.length - 1; j > 0; j--) { const r = Math.floor(rng.random() * (j + 1)); [order[j], order[r]] = [order[r], order[j]]; }
  key[id] = Object.fromEntries(order.map((src, j) => ["ABC"[j], src]));
  const cells = [];
  for (const [j, src] of order.entries()) {
    const L = "ABC"[j];
    const look = cards[src];
    const pal = enginePalette(look).roles;
    const t = await thumb(look, seed);
    const file = `thumbs/p${id}-${L}.png`;
    writePng(join(OUT, file), t.px, t.size, t.size);
    const sw = pal.map(([role, hex]) => `<span class="sw" style="background:${hex}" title="${role}"></span>`).join("");
    cells.push(`<td><div class="card" data-label="${L}" data-fp="${createHash("sha256").update(JSON.stringify(look)).digest("hex").slice(0, 16)}"><b class="lab">${L}</b><div class="pal">${sw}</div><img src="${file}" width="150" height="150" alt="card ${L} of prompt ${id}"></div></td>`);
  }
  rows.push(`<tr><th class="num">${id}</th><td class="p">${prompt}</td>${cells.join("")}</tr>`);
}
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Round 23 recipe sheet</title><style>
body{font:14px/1.4 system-ui,sans-serif;margin:16px;background:#f6f1e7;color:#1f1b16} table{border-collapse:collapse} td,th{border:1px solid #ccc3b3;padding:6px;vertical-align:top}
.p{width:190px} .num{width:28px} .card{width:162px;overflow:hidden} .lab{display:block;font-size:13px} .pal{display:flex;gap:2px;margin:3px 0}
.sw{display:inline-block;width:24px;height:16px;border:1px solid #0002} img{display:block;width:150px;height:150px}
</style></head><body><h1>Recipe sheet (Round 23)</h1>
<p>For each prompt, three recipes (mood, harmony, hue family, value key, saturation, composition) in shuffled columns A, B, C:
one from the rules, one from the model, one from a plain hash of the words. Each card shows the six role colours and the
first 12 marks of a 30-mark painting with the same seed. Rank the three cards per prompt from the best fit to the words
to the worst, in answers.csv (for example <code>BCA</code>). The key is in key.json; please do not open it until you have finished.</p>
<table><tr><th>#</th><th>prompt</th><th>A</th><th>B</th><th>C</th></tr>${rows.join("\n")}</table></body></html>`;
writeFileSync(join(OUT, "sheet.html"), html);
writeFileSync(join(OUT, "key.json"), JSON.stringify(key, null, 1));
writeFileSync(join(OUT, "answers.csv"), "prompt_id,prompt,ranking_best_to_worst\n" + PROMPTS.map((p, i) => `${String(i + 1).padStart(2, "0")},"${p}",`).join("\n") + "\n");
const cov = coverage.map((c) => `| ${c.id} | ${c.prompt} | ${c.kind === "scene" ? "keyword table (scene)" : c.kind === "generic" ? "fell back: hash look + generic words" : "fell back: hash only"} | ${c.matched.join(", ") || "-"} |`);
writeFileSync(join(OUT, "coverage.md"), `# Which prompts the keyword table matched (written before judging)\n\n"Fell back" = no scene in the keyword table matched, so the rules' look starts from the hash of the words (generic words such as colours or weather may then adjust it).\n\n| # | prompt | rules' recipe | matched words |\n|---|---|---|---|\n${cov.join("\n")}\n\nScene matches: ${coverage.filter((c) => c.kind === "scene").length}; fell back: ${coverage.filter((c) => c.kind !== "scene").length} (generic words ${coverage.filter((c) => c.kind === "generic").length}, hash only ${coverage.filter((c) => c.kind === "hash").length}).\n`);

// validate: three distinct cards per row, labels A-B-C, every thumbnail loads, nothing clipped
const { server, url } = await serve(OUT);
const b = await Browser.launch();
const p = await b.newPage({ width: 1100, height: 900 });
await p.goto(`${url}sheet.html`);
await p.waitFor("[...document.images].every((i) => i.complete)", 30000);
const v = await p.eval(`(() => { const rows = [...document.querySelectorAll('tr')].slice(1); const bad = [];
  rows.forEach((r, i) => { const cards = [...r.querySelectorAll('.card')];
    if (cards.map((c) => c.dataset.label).join('') !== 'ABC') bad.push(i + ': labels');
    if (new Set(cards.map((c) => c.dataset.fp)).size !== 3) bad.push(i + ': repeated card');
    for (const c of cards) { const img = c.querySelector('img'); const cr = c.getBoundingClientRect(), ir = img.getBoundingClientRect(), td = c.parentElement.getBoundingClientRect();
      if (!img.naturalWidth) bad.push(i + ': image missing');
      if (ir.right > cr.right + 0.5 || ir.bottom > cr.bottom + 0.5 || cr.right > td.right + 0.5 || cr.bottom > td.bottom + 0.5) bad.push(i + ': clipped');
      if (c.querySelectorAll('.sw').length !== 6) bad.push(i + ': palette'); } });
  return { rows: rows.length, bad }; })()`);
writeFileSync(join(OUT, "sheet.png"), await p.screenshot());
await b.close();
server.close();
const keyOK = Object.values(key).every((k) => Object.values(k).sort().join() === "hash,model,rules");
console.log(JSON.stringify({ rows: v.rows, problems: v.bad, key_is_a_permutation_per_row: keyOK, model_load_ms: ml.loadMs,
  ms_per_prompt: Math.round(ml.out.reduce((a, o) => a + o.ms, 0) / ml.out.length) }));
if (v.rows !== 40 || v.bad.length || !keyOK) process.exit(1);
