// Model mode beside Rules, in headless Chromium with the real model (MODEL_MIRROR=<dir>, or MODEL_LIVE=1): for 4 scenes,
// columns = Gesture Brush (Rules), Gesture Brush (Model recipe), Map Impasto (Rules), Map Impasto (Model, 6x6 coarse grid).
//   MODEL_MIRROR=out/model-mirror node tests/model-sheet.mjs [out.png]      (about 25 minutes on WebAssembly)
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Browser } from "./lib/cdp.mjs";
import { serve } from "./lib/serve.mjs";
import { serveMirror } from "./lib/mirror.mjs";
import { writePng } from "./lib/png.mjs";
import { mirrorPath } from "./model-files.mjs";
import { SCENES } from "./scenes.mjs";

const ROOT = new URL("../", import.meta.url).pathname;
const out = process.argv[2] || `${ROOT}out/shots/model-vs-rules-sheet.png`;
const MIR = process.env.MODEL_MIRROR && new URL(process.env.MODEL_MIRROR, `file://${process.cwd()}/`).pathname;
const { server, url } = await serve(`${ROOT}web`);
const mirror = MIR ? await serveMirror(MIR) : null;
const browser = await Browser.launch();
const p = await browser.newPage({ width: 1280, height: 900 });
if (mirror) await p.route((u) => { const x = new URL(u); return existsSync(mirrorPath(MIR, `${x.origin}${x.pathname}`)) ? `${mirror.url}/${x.host}${x.pathname}` : "block"; });
await p.goto(url);
const done = () => p.eval("Number(document.body.dataset.done || 0)");
const waitDone = async (before, ms = 1800000) => p.waitFor(`Number(document.body.dataset.done || 0) > ${before}`, ms);
const grab = () => p.eval(`(() => { const c = document.getElementById('canvas'); const t = document.createElement('canvas'); t.width = t.height = 200;
  const x = t.getContext('2d'); x.imageSmoothingEnabled = c.width >= 200; x.drawImage(c, 0, 0, 200, 200); return Array.from(x.getImageData(0, 0, 200, 200).data); })()`);
const state = () => p.eval("({ d: document.getElementById('badge-decider').textContent, n: document.getElementById('badge-note').textContent, r: document.getElementById('reading').textContent, h: location.hash })");
const click = (id) => p.eval(`document.getElementById('${id}').click(); 1`);
const decider = (v) => p.eval(`(() => { const r = document.querySelector('input[name=decider][value=${v}]'); r.checked = true; r.dispatchEvent(new Event('change')); return 1; })()`);
const paint = async (prompt) => { const b = await done(); const t0 = Date.now(); await p.eval(`document.getElementById('prompt').value = ${JSON.stringify(prompt)}; document.getElementById('paint').click(); 1`); await waitDone(b); return Date.now() - t0; };

const t0 = Date.now();
await click("load-model");
await p.waitFor("/^Loaded|not available/.test(document.getElementById('model-status').textContent)", 900000);
const loadMs = Date.now() - t0;
const status = await p.eval("document.getElementById('model-status').textContent");
if (!/^Loaded/.test(status)) throw new Error(status);
const T = 200, G = 6, rows = 4;
const Wd = 4 * (T + G) + G, Hd = rows * (T + G) + G;
const sheet = new Uint8ClampedArray(Wd * Hd * 4).fill(255);
const put = (px, r, c) => { for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) for (let k = 0; k < 4; k++) sheet[((G + r * (T + G) + y) * Wd + G + c * (T + G) + x) * 4 + k] = px[(y * T + x) * 4 + k]; };
const report = { load_ms: loadMs, status, rows: [] };
for (let r = 0; r < rows; r++) {
  const prompt = SCENES[r];
  const row = { prompt };
  await p.eval("document.getElementById('seed').value = '7'; 1");
  // Gesture: Rules, then Model (the recipe from the model, marks by the authored weights)
  // back to Gesture and Rules for this prompt: switching the toggle repaints by itself, so the words go in first (a
  // second Paint click inside the page's 400 ms debounce would be ignored)
  await p.eval(`document.getElementById('prompt').value = ${JSON.stringify(prompt)}; 1`);
  if (r > 0) {
    const bt = await done();
    await click("tab-gesture");
    await waitDone(bt);
    const bd = await done();
    const tr = Date.now();
    await decider("rules");
    await waitDone(bd);
    row.gesture_rules = { ms: Date.now() - tr, ...(await state()) };
  } else row.gesture_rules = { ms: await paint(prompt), ...(await state()) };
  put(await grab(), r, 0);
  await decider("model");
  const b = await done();
  const tg = Date.now();
  await waitDone(b);
  row.gesture_model = { ms: Date.now() - tg, ...(await state()) };
  put(await grab(), r, 1);
  // Map: Rules, then Model on the 6x6 coarse grid
  await decider("rules");
  const bm = await done();
  await click("tab-map");
  await waitDone(bm);
  row.map_rules = { ...(await state()) };
  put(await grab(), r, 2);
  await decider("model");
  row.map_model = { ms: await paint(prompt), ...(await state()), per_question: await p.eval("document.getElementById('map-estimate').textContent") };
  put(await grab(), r, 3);
  report.rows.push(row);
  console.log(JSON.stringify(row));
}
mkdirSync(dirname(out), { recursive: true });
writePng(out, sheet, Wd, Hd, 4);
writeFileSync(`${ROOT}out/model-sheet.json`, JSON.stringify(report, null, 1));
console.log(`load ${loadMs} ms; wrote ${out}`);
await browser.close();
server.close();
mirror?.server.close();
