// Headless-browser tests (T1 screenshots + layout, T2 determinism, T3 scenes and budgets, T4 share links, T7 network,
// CSP, offline and blocked storage, T9 throttled speed, accessibility checks, a live EndpointDirector check).
// Uses the installed Chromium through tests/lib/cdp.mjs. Run: node tests/browser.mjs   (about 5 minutes)
// Writes out/shots/*.png and out/browser-results.json; exits 1 if any check fails.
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { Browser } from "./lib/cdp.mjs";
import { serve } from "./lib/serve.mjs";
import { RuleDirector, paintSteps } from "../web/director.js";
import { readPrompt } from "../web/recipes.js";
import { encodeShare } from "../web/share.js";
import { BLOCK_MESSAGE } from "../web/policy.js";

const ROOT = new URL("../", import.meta.url).pathname;
const SHOTS = `${ROOT}out/shots/`;
mkdirSync(SHOTS, { recursive: true });
const only = process.argv[2] || "all";
const results = { started: new Date().toISOString(), checks: [], shots: [], t3: [], t9: {}, t2: [], t4: [], t7: {}, a11y: {} };
let failed = 0;
function check(name, ok, detail = "") {
  results.checks.push({ name, ok: !!ok, detail });
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${typeof detail === "string" ? detail : JSON.stringify(detail)})` : ""}`);
}

const { server, url } = await serve(`${ROOT}web`);
const browser = await Browser.launch();
const VIEWS = { phone: { width: 370, height: 822, mobile: true }, desktop: { width: 1280, height: 800, mobile: false } };
const SCENES = ["a lighthouse in a storm", "a field of sunflowers at noon", "snowy pine forest at dawn", "a fishing boat at sunset",
  "city rooftops in the rain", "desert dunes under a full moon", "a quiet pond with lily pads", "an autumn forest path",
  "a red barn on a hill", "waves breaking on rocks", "a night market", "a mountain lake reflection"];

// ------------------------------------------------------------------------------------------------ page helpers
const js = (s) => JSON.stringify(s);
async function open(view, theme, hash = "", opts = {}) {
  const p = await browser.newPage({ ...VIEWS[view], dark: theme === "dark", ...opts });
  await p.goto(url + (opts.path || "") + hash);
  return p;
}
const doneId = (p) => p.eval("Number(document.body.dataset.done || 0)");
async function waitDone(p, before, timeout = 60000) {
  return p.waitFor(`Number(document.body.dataset.done || 0) > ${before}`, timeout);
}
async function paint(p, prompt, timeout) {
  const before = await doneId(p);
  const t0 = Date.now();
  await p.eval(`document.getElementById('prompt').value=${js(prompt)}; document.getElementById('paint').click(); 1`);
  await waitDone(p, before, timeout);
  return Date.now() - t0;
}
async function setSkin(p, skin) {
  const before = await doneId(p);
  const t0 = Date.now();
  await p.eval(`(() => { const r = document.querySelector('input[name=skin][value=${skin}]'); r.checked = true; r.dispatchEvent(new Event('change')); return 1; })()`);
  await waitDone(p, before);
  return Date.now() - t0;
}
const canvasInfo = (p) => p.eval(`(async () => {
  const c = document.getElementById('canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const m = await import('./render.js');
  let painted = 0; const pr = d[0], pg = d[1], pb = d[2];
  for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i]-pr) + Math.abs(d[i+1]-pg) + Math.abs(d[i+2]-pb) > 30) painted++;
  const h = await crypto.subtle.digest('SHA-256', d);
  return { w: c.width, painted: painted / (d.length / 4), colours: m.colourCount(d),
    sha: [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('') };
})()`);
const layout = (p) => p.eval("({ sw: document.documentElement.scrollWidth, iw: innerWidth })");
async function shot(p, name, desc) {
  writeFileSync(`${SHOTS}${name}.png`, await p.screenshot());
  results.shots.push({ file: `out/shots/${name}.png`, desc });
}
function nodeSha({ look, seed, budget, skin, mode = "weighted" }) {
  return (async () => {
    let last;
    for await (const s of paintSteps({ prompt: "x", look, seed, budget, skin, director: new RuleDirector(), mode })) last = s;
    return createHash("sha256").update(last.painter.view().rgba()).digest("hex");
  })();
}

// ------------------------------------------------------------------------------------------------ T1 screenshots
if (only === "all" || only === "t1") {
  for (const view of ["phone", "desktop"]) {
    for (const theme of ["light", "dark"]) {
      const tag = `${view}-${theme}`;
      const p = await open(view, theme);
      await shot(p, `${tag}-start`, "the empty page before painting");
      await paint(p, "a lighthouse in a storm");
      for (const skin of ["paint", "pixel", "sketch"]) {
        if (skin !== "paint") await setSkin(p, skin);
        const c = await canvasInfo(p);
        const l = await layout(p);
        check(`T1 ${tag} ${skin}: canvas non-blank`, c.painted > 0.05, `${(c.painted * 100).toFixed(0)}% painted, ${c.colours} colours`);
        check(`T1 ${tag} ${skin}: no horizontal scroll`, l.sw <= l.iw, l);
        await shot(p, `${tag}-${skin}`, `Paint mode, lighthouse prompt, ${skin} skin`);
      }
      await setSkin(p, "paint");
      // the picker: an unknown scene opens it and says so
      await paint(p, "xqzv plorb");
      const reading = await p.eval("document.getElementById('reading').textContent");
      check(`T1 ${tag}: unknown scene says so and opens the picker`, /don't know that scene/.test(reading)
        && await p.eval("document.getElementById('look').open"), reading);
      await p.eval("document.getElementById('look').scrollIntoView(); 1");
      await shot(p, `${tag}-picker`, "unknown scene: free-form message and the open look picker");
      // block message
      await p.eval(`document.getElementById('prompt').value=${js("hardcore porn")}; document.getElementById('paint').click(); 1`);
      await new Promise((r) => setTimeout(r, 500));
      const blk = await p.eval("({ n: document.getElementById('notice').textContent, box: document.getElementById('prompt').value, ro: document.getElementById('prompt').readOnly, dis: document.getElementById('prompt').disabled, body: document.body.innerText })");
      const c = await canvasInfo(p);
      check(`T1 ${tag}: block message is the neutral sentence`, blk.n === BLOCK_MESSAGE, blk.n);
      check(`T1 ${tag}: blocked text is not echoed anywhere but the editable box`, !blk.body.includes("hardcore") && !blk.ro && !blk.dis);
      check(`T1 ${tag}: nothing painted after a block`, c.painted < 0.001);
      await p.eval("window.scrollTo(0, 0); 1");
      await shot(p, `${tag}-blocked`, "a blocked prompt: neutral sentence, blank paper, box still editable");
      // be the director
      await p.eval("document.getElementById('tab-director').click(); 1");
      await p.eval(`document.getElementById('prompt').value=${js("a red barn on a hill")}; document.getElementById('paint').click(); 1`);
      await p.waitFor("!document.getElementById('director-ui').hidden && document.getElementById('d-step').textContent === '1'");
      for (let i = 1; i <= 3; i++) {
        await p.eval(`document.getElementById('dq-gesture').selectedIndex = ${i}; document.getElementById('d-apply').click(); 1`);
        await p.waitFor(`document.getElementById('d-step').textContent === '${i + 1}'`);
      }
      const dc = await canvasInfo(p);
      check(`T1 ${tag}: director mode paints the visitor's marks`, dc.painted > 0.02, `${(dc.painted * 100).toFixed(0)}%`);
      check(`T1 ${tag}: director mode read-back updated`, /step 4 of 30/.test(await p.eval("document.getElementById('state-text').textContent")));
      await p.eval("document.getElementById('director-ui').scrollIntoView(); 1");
      await shot(p, `${tag}-director`, "Be the director: mark 4 menus with dice and the rules' odds, after three chosen marks");
      check(`T1 ${tag}: no console errors (index)`, p.errors.length === 0, p.errors.slice(0, 3));
      await p.close();
      const a = await open(view, theme, "", { path: "about.html" });
      const txt = await a.eval("document.body.innerText");
      check(`T1 ${tag}: About page credit and honesty lines`, txt.includes("Inspired by danmana/") && txt.includes("this project does not use its code or lists.")
        && /no AI model inside/i.test(txt) && /abstract, scene-like paintings/i.test(txt));
      const al = await layout(a);
      check(`T1 ${tag}: About no horizontal scroll`, al.sw <= al.iw, al);
      check(`T1 ${tag}: no console errors (about)`, a.errors.length === 0, a.errors.slice(0, 3));
      await shot(a, `${tag}-about`, "the About page");
      await a.close();
    }
  }
  // a hostile share link's friendly error
  const p = await open("phone", "light", "#v=7&mo=0");
  await shot(p, "phone-light-badlink", "a share link from an unsupported version: friendly error, nothing painted");
  await p.close();
}

// ------------------------------------------------------------------------------------------------ T2 determinism
if (only === "all" || only === "t2") {
  const look = readPrompt("a red barn on a hill").look;
  for (const skin of ["paint", "pixel", "sketch"]) {
    const rec = { look, seed: 4242, budget: 30, skin, mode: "weighted" };
    const hash = encodeShare(rec);
    const shas = [];
    for (const [view, theme] of [["desktop", "light"], ["phone", "dark"]]) {
      const p = await open(view, theme, hash);
      await waitDone(p, 0);
      shas.push((await canvasInfo(p)).sha);
      await p.close();
    }
    const ns = await nodeSha(rec);
    results.t2.push({ skin, browser_load_1: shas[0], browser_load_2: shas[1], node: ns });
    check(`T2 ${skin}: identical pixels on two loads (desktop light, phone dark)`, shas[0] === shas[1]);
    check(`T2 ${skin}: browser pixels equal node's render`, shas[0] === ns);
  }
}

// ------------------------------------------------------------------------------------------------ T3 scenes, budgets
if (only === "all" || only === "t3") {
  const p = await open("desktop", "light");
  for (const s of SCENES) {
    const ms = await paint(p, s);
    const row = { prompt: s, paint_ms: ms };
    row.paint = (await canvasInfo(p)).colours;
    const cp = await canvasInfo(p);
    check(`T3 "${s}": non-blank, multi-colour, under 10 s`, cp.painted > 0.05 && cp.colours >= 3 && ms < 10000, `${ms} ms, ${cp.colours} colours`);
    for (const skin of ["pixel", "sketch"]) {
      row[`${skin}_ms`] = await setSkin(p, skin);
      row[skin] = (await canvasInfo(p)).colours;
    }
    await setSkin(p, "paint");
    results.t3.push(row);
  }
  const shas = [];
  for (const b of [10, 30, 50]) {
    const before = await doneId(p);
    await p.eval(`(() => { const r = document.getElementById('budget'); r.value = '${b}'; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); return 1; })()`);
    await waitDone(p, before);
    const c = await canvasInfo(p);
    const label = await p.eval("document.getElementById('progress-label').textContent");
    shas.push(c.sha);
    check(`T3 budget ${b}: valid painting`, c.painted > 0.05 && label === `Finished: ${b} marks`, `${label}, ${c.colours} colours`);
    results.t3.push({ budget: b, colours: c.colours, painted: Number(c.painted.toFixed(3)), estimate: await p.eval("document.getElementById('estimate').textContent") });
  }
  check("T3 budgets 10, 30, 50 give three different paintings", new Set(shas).size === 3);
  await p.close();
}

// ------------------------------------------------------------------------------------------------ T4 share links
if (only === "all" || only === "t4") {
  for (const skin of ["paint", "pixel"]) {
    const a = await open("desktop", "light");
    await paint(a, "desert dunes under a full moon");
    if (skin !== "paint") await setSkin(a, skin);
    const hash = await a.eval("location.hash");
    const sa = (await canvasInfo(a)).sha;
    await a.close();
    const b = await open("phone", "light", hash);
    await waitDone(b, 0);
    const sb = (await canvasInfo(b)).sha;
    await b.close();
    results.t4.push({ skin, hash, length: hash.length, same: sa === sb });
    check(`T4 ${skin}: share link round trip gives identical pixels`, sa === sb, `${hash.length} chars: ${hash}`);
    check(`T4 ${skin}: link carries no free text`, !/desert|dunes|moon/i.test(hash));
  }
  const base = "mo=0&ha=0&hu=0&ke=0&sa=0&co=0&sy=0&sr=0&su=0";
  const crafted = [
    ["huge budget", `#v=1&${base}&s=7&b=99999&k=paint&p=w`, "clamp", (r) => r.max === 50],
    ["negative seed", `#v=1&${base}&s=-5&b=20&k=paint&p=w`, "clamp", (r) => r.seed === "0"],
    ["script string", `#v=1&mo=%3Cscript%3Ewindow.__pwned%3D1%3C%2Fscript%3E&ha=0&hu=0&ke=0&sa=0&co=0&sy=0&sr=0&su=0&s=1&b=20`, "reject", (r) => /damaged/.test(r.notice)],
    ["script in skin", `#v=1&${base}&s=1&b=20&k=%3Cimg%20src%3Dx%20onerror%3Dwindow.__pwned%3D1%3E`, "clamp", (r) => r.done],
    ["unknown keys", `#v=1&${base}&s=1&b=20&k=paint&__proto__=1&constructor=x&evil=%3Cb%3E`, "ignore", (r) => r.done],
    ["unsupported version", `#v=2&${base}&s=1&b=20`, "reject", (r) => /different version/.test(r.notice)],
    ["index out of range", `#v=1&mo=99&ha=0&hu=0&ke=0&sa=0&co=0&sy=0&sr=0&su=0&s=1&b=20`, "reject", (r) => /damaged/.test(r.notice)],
    ["overlong", `#v=1&${base}&x=${"a".repeat(2000)}`, "reject", (r) => /too long/.test(r.notice)],
  ];
  for (const [name, hash, expect, ok] of crafted) {
    const p = await open("desktop", "light", hash);
    await new Promise((r) => setTimeout(r, 1500));
    if (expect !== "reject") await waitDone(p, 0).catch(() => {});
    const r = await p.eval(`({ notice: document.getElementById('notice').textContent, max: document.getElementById('progress').max,
      seed: document.getElementById('seed').value, done: !!document.body.dataset.done, pwned: !!window.__pwned,
      scripts: document.scripts.length, imgs: document.querySelectorAll('img').length })`);
    const good = ok(r) && !r.pwned && r.scripts === 1 && r.imgs === 0;
    results.t4.push({ crafted: name, expect, ...r, ok: good });
    check(`T4 crafted link (${name}) is ${expect === "reject" ? "rejected" : expect === "ignore" ? "accepted, unknown keys ignored" : "clamped"}, nothing unsafe`, good, r.notice || `max ${r.max}, seed ${r.seed}`);
    check(`T4 crafted link (${name}): no console errors`, p.errors.length === 0, p.errors.slice(0, 2));
    await p.close();
  }
}

// ------------------------------------------------------------------------------------------------ T7 network, CSP, storage
if (only === "all" || only === "t7") {
  const p = await open("desktop", "light");
  await new Promise((r) => setTimeout(r, 800));
  const initial = p.requests.map((r) => r.url);
  const n0 = p.requests.length;
  await paint(p, "a night market");
  await setSkin(p, "pixel");
  await paint(p, "waves breaking on rocks");
  results.t7.initial_requests = initial.map((u) => u.replace(url, "/"));
  results.t7.requests_while_painting = p.requests.length - n0;
  check("T7 every page request is same-origin", initial.every((u) => u.startsWith(url)), initial.length);
  check("T7 zero network requests while painting (3 paintings)", p.requests.length === n0, p.requests.slice(n0).map((r) => r.url));
  const csp = await p.eval("document.querySelector('meta[http-equiv=Content-Security-Policy]').content");
  check("T7 CSP meta present with default-src 'self' and no unsafe-inline", /default-src 'self'/.test(csp) && !/unsafe/.test(csp), csp);
  check("T7 the site works under the CSP (no violations logged)", p.errors.length === 0, p.errors.slice(0, 3));
  await p.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  const offMs = await paint(p, "a quiet pond with lily pads");
  check("T7 painting works offline once loaded", offMs < 20000, `${offMs} ms`);
  await p.close();
  // the CSP is enforced: an injected inline script does not run
  const q = await open("desktop", "light");
  const blocked = await q.eval(`new Promise((res) => { let v = false; document.addEventListener('securitypolicyviolation', () => { v = true; });
    const s = document.createElement('script'); s.textContent = 'window.__inline = 1'; document.body.appendChild(s);
    setTimeout(() => res({ ran: !!window.__inline, violation: v }), 300); })`);
  check("T7 CSP blocks inline script (injected test script did not run)", !blocked.ran && blocked.violation, blocked);
  await q.close();
  // storage blocked
  const s = await open("phone", "light", "", { blockStorage: true });
  await paint(s, "a fox in the snow");
  await s.eval("document.getElementById('save').click(); document.getElementById('gallery').open = true; 1");
  await new Promise((r) => setTimeout(r, 300));
  const st = await s.eval("({ n: document.getElementById('notice').textContent, g: document.getElementById('gallery-list').textContent })");
  check("T7 storage blocked: painting works, save explains, gallery off", /not letting/.test(st.n) && /gallery is off/.test(st.g), st);
  check("T7 storage blocked: no console errors", s.errors.length === 0, s.errors.slice(0, 3));
  // storage allowed: save and reopen
  await s.close();
  const g = await open("desktop", "light");
  await paint(g, "a red barn on a hill");
  await g.eval("document.getElementById('save').click(); document.getElementById('gallery').open = true; 1");
  await new Promise((r) => setTimeout(r, 300));
  const thumbs = await g.eval("[...document.querySelectorAll('#gallery-list img')].map((i) => i.src.length)");
  check("T7 gallery saves a thumbnail under 30 KB", thumbs.length === 1 && thumbs[0] < 30000, thumbs);
  await g.eval("document.getElementById('gallery').scrollIntoView(); 1");
  await shot(g, "desktop-light-gallery", "the local gallery with one saved painting (open, download, delete)");
  await g.close();
  // EndpointDirector: off by default; works against a local server; readable errors
  const mock = createServer((req, res) => {
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Content-Type": "application/json" };
    if (req.method === "OPTIONS") { res.writeHead(204, cors).end(); return; }
    let body = "";
    req.on("data", (d) => { body += d; });
    req.on("end", () => {
      if (req.url === "/broken") { res.writeHead(500, cors).end("{}"); return; }
      const { questions } = JSON.parse(body);
      res.writeHead(200, cors).end(JSON.stringify({ answers: questions.map((q) => ({ id: q.id, probs: (q.options || ["no", "yes"]).map(() => 1) })) }));
    });
  });
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  const ep = `http://127.0.0.1:${mock.address().port}`;
  const e = await open("desktop", "light");
  const dflt = await e.eval("({ rules: document.querySelector('input[name=director][value=rules]').checked, hidden: document.getElementById('endpoint-box').hidden })");
  check("T7 EndpointDirector is off by default", dflt.rules && dflt.hidden);
  await e.eval(`(() => { const r = document.querySelector('input[name=director][value=endpoint]'); r.checked = true; r.dispatchEvent(new Event('change'));
    document.getElementById('endpoint-url').value = ${js(ep + "/decide")}; return 1; })()`);
  const warn = await e.eval("document.getElementById('endpoint-warning').textContent");
  check("T7 endpoint warning visible", /sent to the URL/.test(warn) && !(await e.eval("document.getElementById('endpoint-box').hidden")));
  await paint(e, "a lighthouse in a storm");
  const sent = e.requests.filter((r) => r.url.startsWith(ep)).length;
  check("T7 EndpointDirector paints from a local server (1 look + 30 marks requests)", sent >= 31, `${sent} requests`);
  await e.eval(`document.getElementById('endpoint-url').value = ${js(ep + "/broken")}; 1`);
  await e.eval(`document.getElementById('prompt').value='a red barn'; document.getElementById('paint').click(); 1`);
  await e.waitFor("/HTTP 500/.test(document.getElementById('notice').textContent)", 10000).catch(() => {});
  const en = await e.eval("document.getElementById('notice').textContent");
  check("T7 broken endpoint gives a readable error", /HTTP 500/.test(en), en);
  await new Promise((r) => setTimeout(r, 600)); // past the Paint button's 400 ms debounce
  await e.eval(`document.getElementById('endpoint-url').value = 'https://example.com/decide'; document.getElementById('prompt').value='a red barn on a hill'; document.getElementById('paint').click(); 1`);
  await new Promise((r) => setTimeout(r, 1500));
  const remote = await e.eval("document.getElementById('notice').textContent");
  check("T7 a remote endpoint is refused by the page's CSP with a readable message", /could not reach/.test(remote), remote);
  results.t7.endpoint_errors_seen = e.errors.length;
  await e.close();
  mock.close();
}

// ------------------------------------------------------------------------------------------------ T9 throttled speed
if (only === "all" || only === "t9") {
  for (const skin of ["paint", "pixel"]) {
    const p = await open("phone", "light");
    await p.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    if (skin === "pixel") await p.eval("document.querySelector('input[name=skin][value=pixel]').checked = true; document.querySelector('input[name=skin][value=pixel]').dispatchEvent(new Event('change')); 1");
    await new Promise((r) => setTimeout(r, 1500));
    const ms = await paint(p, "a fishing boat at sunset", 120000);
    results.t9[skin] = { wall_ms: ms, budget: 30, cpu_throttle: 4, pacing_ms_per_mark: 90 };
    check(`T9 ${skin} at 4x CPU throttle, 30 marks under ${skin === "paint" ? 20 : 10} s`, ms < (skin === "paint" ? 20000 : 10000), `${ms} ms`);
    await p.close();
  }
}

// ------------------------------------------------------------------------------------------------ accessibility
if (only === "all" || only === "a11y") {
  for (const theme of ["light", "dark"]) {
    const p = await open("desktop", theme);
    await paint(p, "a lighthouse in a storm");
    const names = await p.eval(`[...document.querySelectorAll('button, input, select, textarea, [role=tab], a, canvas, pre[tabindex]')].filter((e) => e.offsetParent !== null || e.tagName === 'CANVAS').map((e) => {
      const lab = e.getAttribute('aria-label') || (e.getAttribute('aria-labelledby') || '').split(' ').map((i) => document.getElementById(i)?.textContent || '').join(' ').trim()
        || (e.id && document.querySelector('label[for="' + e.id + '"]')?.textContent) || e.closest('label')?.textContent || e.textContent || e.title || e.placeholder;
      return { el: e.tagName.toLowerCase() + (e.id ? '#' + e.id : ''), name: (lab || '').trim().slice(0, 40) };
    })`);
    const missing = names.filter((n) => !n.name);
    check(`A11y ${theme}: every visible control has an accessible name`, missing.length === 0, missing);
    const vars = await p.eval(`(() => { const s = getComputedStyle(document.documentElement); const g = (v) => s.getPropertyValue(v).trim();
      return { bg: g('--bg'), surface: g('--surface'), surface2: g('--surface-2'), fg: g('--fg'), muted: g('--muted'), line: g('--line-strong'), focus: g('--focus'),
        accent: g('--accent'), onAccent: g('--on-accent'), warnBg: g('--warn-bg'), warnFg: g('--warn-fg') }; })()`);
    const hex = (h) => h.replace("#", "").match(/../g).map((x) => parseInt(x, 16) / 255);
    const L = (c) => c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
    const cr = (a, b) => { const x = L(hex(a)), y = L(hex(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const pairs = [["fg", "bg", 4.5], ["fg", "surface", 4.5], ["fg", "surface2", 4.5], ["muted", "surface", 4.5], ["muted", "bg", 4.5],
      ["onAccent", "accent", 4.5], ["accent", "surface", 3], ["focus", "surface", 3], ["focus", "bg", 3], ["line", "surface", 3], ["warnFg", "warnBg", 4.5]];
    const table = pairs.map(([a, b, need]) => ({ pair: `${a} on ${b}`, ratio: Number(cr(vars[a], vars[b]).toFixed(2)), need }));
    results.a11y[`contrast_${theme}`] = table;
    check(`A11y ${theme}: contrast AA for text and 3:1 for UI parts`, table.every((t) => t.ratio >= t.need), table.filter((t) => t.ratio < t.need));
    // keyboard: Tab order reaches the main controls and focus is visible
    const order = [];
    for (let i = 0; i < 14; i++) {
      await p.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      await p.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      order.push(await p.eval("(() => { const e = document.activeElement; const s = getComputedStyle(e); return { id: e.id || e.tagName, outline: s.outlineStyle + ' ' + s.outlineWidth }; })()"));
    }
    results.a11y[`tab_order_${theme}`] = order;
    check(`A11y ${theme}: Tab reaches prompt and Paint with a visible focus ring`, ["prompt", "paint"].every((id) => order.some((o) => o.id === id && /solid 3px/.test(o.outline))), order.map((o) => o.id));
    // keyboard-only painting: focus the box, type, press Enter
    await p.eval("document.getElementById('prompt').focus(); document.getElementById('prompt').value=''; 1");
    const before = await doneId(p);
    await p.send("Input.insertText", { text: "a harbour at dawn" });
    await p.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
    await p.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await waitDone(p, before).then(() => check(`A11y ${theme}: keyboard-only painting (type + Enter)`, true), () => check(`A11y ${theme}: keyboard-only painting`, false));
    const aria = await p.eval("document.getElementById('canvas').getAttribute('aria-label')");
    check(`A11y ${theme}: canvas has a descriptive aria-label`, /^Abstract painting in 30 marks/.test(aria), aria);
    await p.close();
  }
  const r = await open("desktop", "light", "", { reducedMotion: true });
  const ms = await paint(r, "a lighthouse in a storm");
  const tr = await r.eval("getComputedStyle(document.querySelector('.panel summary'), '::before').transitionDuration");
  results.a11y.reduced_motion = { paint_ms: ms, transition: tr };
  check("A11y reduced motion: no transitions and no pacing between marks", tr === "0s" && ms < 2500, `${ms} ms, transition ${tr}`);
  await r.close();
}

results.finished = new Date().toISOString();
results.failed = failed;
writeFileSync(`${ROOT}out/browser-results${only === "all" ? "" : `-${only}`}.json`, JSON.stringify(results, null, 1));
await browser.close();
server.close();
console.log(failed ? `${failed} FAILED` : "ALL BROWSER CHECKS PASSED");
process.exit(failed ? 1 : 0);
