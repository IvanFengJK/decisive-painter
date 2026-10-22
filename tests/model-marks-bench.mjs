// What the model's mark decisions cost with the real model, in headless Chromium (no app.js involved: the page imports
// model-loader.js and model-director.js directly). For each scene: the recipe (six questions, both orders) and one
// Gesture painting with marks on, every scorer call timed, plus the model's colour odds on the planned marks.
//   MODEL_MIRROR=out/model-mirror node tests/model-marks-bench.mjs [scenes=2] [budget=30]     (writes out/model-marks-bench.json)
// BENCH_PREFER=wasm|webgpu|auto is passed to loadModel (a loader without that option ignores it); BENCH_WEB=<dir> serves
// another copy of the site (for example an older loader) instead of web/; BENCH_OUT names the JSON file.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { Browser } from "./lib/cdp.mjs";
import { serve } from "./lib/serve.mjs";
import { serveMirror } from "./lib/mirror.mjs";
import { mirrorPath } from "./model-files.mjs";
import { SCENES } from "./scenes.mjs";

const ROOT = new URL("../", import.meta.url).pathname;
const MIR = process.env.MODEL_MIRROR && new URL(process.env.MODEL_MIRROR, `file://${process.cwd()}/`).pathname;
if (!MIR) throw new Error("set MODEL_MIRROR=<dir> (a verified mirror: node tests/model-files.mjs out/model-mirror)");
const nScenes = Number(process.argv[2] || 2);
const budget = Number(process.argv[3] || 30);
const { server, url } = await serve(process.env.BENCH_WEB || `${ROOT}web`);
const prefer = process.env.BENCH_PREFER || "auto";
const outFile = process.env.BENCH_OUT || `${ROOT}out/model-marks-bench.json`;
const mirror = await serveMirror(MIR);
const browser = await Browser.launch();
const p = await browser.newPage({ width: 1000, height: 800 });
await p.route((u) => { const x = new URL(u); return existsSync(mirrorPath(MIR, `${x.origin}${x.pathname}`)) ? `${mirror.url}/${x.host}${x.pathname}` : "block"; });
await p.goto(url);
const res = await p.eval(`(async () => {
  const L = await import('./model-loader.js'); const M = await import('./model-director.js'); const D = await import('./director.js');
  const t0 = performance.now(); const loaded = await L.loadModel({ prefer: ${JSON.stringify(prefer)} }); const { scorer, info } = loaded; const loadMs = Math.round(performance.now() - t0);
  const gpu = !!navigator.gpu && !!(await navigator.gpu.requestAdapter().catch(() => null));
  let calls = [];
  const timed = async (text, n, opts) => { const t = performance.now(); const s = await scorer(text, n, opts);
    calls.push({ chars: text.length, prefix: opts?.prefix?.length || 0, ms: Math.round(performance.now() - t) }); return s; };
  const rulesOdds = (a, qs) => { const q = qs.find((x) => x.id === 'colour'); const P = D.validateAnswers(a, qs).colour;
    return Object.fromEntries(D.optionsOf(q).map((o, k) => [o, Math.round(D.sharpen(P)[k] * 1000) / 1000])); };
  const out = [];
  for (const [i, prompt] of ${JSON.stringify(SCENES.slice(0, nScenes))}.entries()) {
    const md = new M.ModelDirector({ scorer: timed, info, marks: true });
    calls = [];
    const t1 = performance.now();
    const look = await D.chooseLook(md, prompt, ${budget}, { weighted: M.MODEL_QUESTIONS, seed: 7 + i });
    const recipe = { ms: Math.round(performance.now() - t1), calls };
    calls = [];
    const odds = [];
    const t2 = performance.now();
    for await (const s of D.paintSteps({ prompt, look, seed: 7 + i, budget: ${budget}, director: md })) {
      if (md.lastMark.byModel.length) odds.push({ step: s.step, phase: s.phase, chosen: s.d.colour,
        model: Object.fromEntries(D.optionsOf(s.qs.find((q) => q.id === 'colour')).map((o, k) => [o, Math.round(D.sharpen(s.P.colour)[k] * 1000) / 1000])),
        rules: rulesOdds(await new D.RuleDirector().decide(s.state, s.qs), s.qs) });
    }
    const marks = { ms: Math.round(performance.now() - t2), calls, perMarkQuestion: md.msPerMarkQuestion,
      log: md.markLog.filter((e) => e.byModel.length || e.fallback), note: D.decisionBadge({ tab: 'gesture', director: md, budget: ${budget} }).note,
      estimateFromRecipeMs: Math.round(2 * recipe.ms / 6 * M.modelMarkQuestions(${budget})) };
    out.push({ prompt, look, recipe, marks, odds });
  }
  return { info, loadMs, prefixStats: loaded.stats || null, webgpuAdapter: gpu, budget: ${budget}, plan: M.modelMarkPlan(${budget}), out };
})()`);
mkdirSync(`${ROOT}out`, { recursive: true });
writeFileSync(outFile, JSON.stringify(res, null, 1));
const avg = (xs) => Math.round(xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length));
console.log(`model ${res.info.name} ${res.info.dtype} ${res.info.backend}${res.info.fallback ? ` (fallback: ${res.info.fallback})` : ""}; load ${res.loadMs} ms; WebGPU adapter: ${res.webgpuAdapter}; prefix reuse: ${JSON.stringify(res.prefixStats)}`);
for (const r of res.out) {
  console.log(`${r.prompt}: recipe ${r.recipe.ms} ms (${r.recipe.calls.length} calls, ${avg(r.recipe.calls.map((c) => c.ms))} ms/call, ${avg(r.recipe.calls.map((c) => c.chars))} chars); `
    + `marks ${r.marks.ms} ms for the whole painting (${r.marks.calls.length} calls, ${avg(r.marks.calls.map((c) => c.ms))} ms/call, ${avg(r.marks.calls.map((c) => c.chars))} chars); `
    + `estimate from the recipe rate ${r.marks.estimateFromRecipeMs} ms`);
  console.log(`  badge: ${r.marks.note}`);
  for (const o of r.odds) console.log(`  mark ${o.step} (${o.phase}): drew ${o.chosen}; model ${JSON.stringify(o.model)}; rules ${JSON.stringify(o.rules)}`);
}
await browser.close();
server.close();
mirror.server.close();
