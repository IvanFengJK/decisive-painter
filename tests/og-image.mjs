// The link preview image (Open Graph / LinkedIn): web/og-image.jpg, 1200 x 630 (JPEG: a PNG of the paper grain is ~500 KB).
//   node tests/og-image.mjs [out.jpg]
// It opens the page in headless Chromium with no link, waits for the startup example (painted by the rules, no model),
// takes that painting and the odds of its last mark, lays them out beside the title on a 1200 x 630 page and screenshots
// it. Run it again after changing the example (EXAMPLE in web/app.js) or the page's colours.
import { writeFileSync } from "node:fs";
import { Browser } from "./lib/cdp.mjs";
import { serve } from "./lib/serve.mjs";

const ROOT = new URL("../", import.meta.url).pathname;

/** Width and height from a JPEG's start-of-frame marker (also used by tests/browser.mjs to check the file). */
export function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return { w: 0, h: 0 };
  for (let i = 2; i + 9 < buf.length;) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return { w: 0, h: 0 };
}
if (process.argv[1] === new URL(import.meta.url).pathname) await main(); // imported by the tests for jpegSize only

async function main() {
  const out = process.argv[2] || `${ROOT}web/og-image.jpg`;
  const W = 1200, H = 630;

  const { server, url } = await serve(`${ROOT}web`);
  const browser = await Browser.launch();
  try {
    const p = await browser.newPage({ width: 1280, height: 800 });
    await p.goto(url);
    await p.waitFor("document.body.dataset.example === 'painted'", 60000);
    const ex = await p.eval(`({
      png: document.getElementById('canvas').toDataURL('image/png'),
      words: document.getElementById('example-note').textContent,
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
      step: document.getElementById('odds').dataset.step,
      cards: ['gesture', 'colour'].map((q) => { const c = document.querySelector('.odds-card[data-q=' + q + ']');
        const lis = [...c.querySelectorAll('li:not(.other)')]; const pick = lis.find((li) => li.classList.contains('chosen'));
        const shown = lis.slice(0, 4).includes(pick) ? lis.slice(0, 4) : [...lis.slice(0, 3), pick]; // the picked option always shows
        return { title: c.querySelector('h3').textContent, rows: shown.map((li) => ({
          name: [...li.querySelector('.o-name').childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(''),
          pct: li.querySelector('.o-pct').textContent, p: Number(li.dataset.p), chosen: li.classList.contains('chosen') })) }; }),
      requests: performance.getEntriesByType('resource').map((e) => e.name),
    })`);
    if (ex.requests.some((u) => !u.startsWith(url) || /model-(loader|worker|host)|vendor\//.test(u))) throw new Error(`unexpected request: ${ex.requests}`);
    await p.close();

    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    const card = (c) => `<div class="card"><h3>${esc(c.title)}</h3><ol>${c.rows.map((r) => `<li class="${r.chosen ? "chosen" : ""}">
      <span class="n">${r.chosen ? "&#10003; " : ""}${esc(r.name)}</span><span class="p">${esc(r.pct)}</span>
      <span class="bar"><span style="width:${(r.p * 100).toFixed(1)}%"></span></span></li>`).join("")}</ol></div>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      * { box-sizing: border-box; margin: 0; }
      html, body { width: ${W}px; height: ${H}px; overflow: hidden; }
      body { background: #f6f1e7; color: #1f1b16; font-family: "Ubuntu Sans", Ubuntu, "DejaVu Sans", system-ui, sans-serif; position: relative; }
      .text { position: absolute; left: 64px; top: 64px; width: 530px; }
      h1 { font-size: 66px; white-space: nowrap; line-height: 1.02; font-weight: 700; letter-spacing: -0.01em; }
      h2 { margin-top: 16px; font-size: 40px; line-height: 1.15; font-weight: 600; color: #8a4b2a; }
      p { margin-top: 20px; font-size: 25px; line-height: 1.38; color: #574f44; }
      .cards { position: absolute; left: 64px; bottom: 58px; display: flex; flex-wrap: wrap; gap: 14px; width: 530px; }
      .cards h4 { flex-basis: 100%; margin-bottom: -6px; font-size: 18px; font-weight: 600; color: #574f44; }
      .card { width: 253px; padding: 12px 14px; background: #fffdf8; border: 1px solid #ddd3c3; border-radius: 12px; }
      .card h3 { font-size: 18px; margin-bottom: 6px; }
      ol { list-style: none; padding: 0; display: grid; gap: 5px; }
      li { display: grid; grid-template-columns: 1fr auto; font-size: 16px; line-height: 1.3; column-gap: 8px; }
      li .bar { grid-column: 1 / -1; height: 6px; margin-top: 2px; background: #efe8db; border-radius: 3px; overflow: hidden; }
      li .bar span { display: block; height: 100%; background: #857a69; }
      li.chosen .n, li.chosen .p { font-weight: 700; }
      li.chosen .bar span { background: ${esc(ex.accent || "#8a4b2a")}; }
      .p { color: #574f44; font-variant-numeric: tabular-nums; }
      .art { position: absolute; right: 64px; top: 58px; width: 514px; height: 514px; border-radius: 8px; overflow: hidden;
        box-shadow: 0 1px 2px rgb(0 0 0 / 0.14), 0 10px 30px rgb(60 40 20 / 0.16); }
      .art img { display: block; width: 100%; height: 100%; }
      .cap { position: absolute; right: 64px; bottom: 22px; width: 514px; text-align: center; font-size: 17px; color: #574f44; }
    </style></head><body>
      <div class="text"><h1>Decisive Painter</h1><h2>Decisions, not diffusion</h2>
        <p>A decision-maker answers multiple-choice questions with odds for every option; code draws the answers. Free, in your browser.</p></div>
      <div class="cards"><h4>The decision-maker's odds for the last mark</h4>${ex.cards.map(card).join("")}</div>
      <div class="art"><img src="${ex.png}" alt=""></div>
      <div class="cap">“a field of sunflowers at noon”, 30 marks, drawn by the rules</div>
    </body></html>`;

    const q = await browser.newPage({ width: W, height: H });
    await q.eval(`(() => { document.open(); document.write(${JSON.stringify(html)}); document.close(); return 1; })()`);
    await q.waitFor("document.images[0] && document.images[0].complete && document.fonts.status === 'loaded'", 10000);
    const shot = await q.send("Page.captureScreenshot", { format: "jpeg", quality: 88, clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
    const buf = Buffer.from(shot.data, "base64");
    const { w, h } = jpegSize(buf);
    if (w !== W || h !== H) throw new Error(`the image is ${w} x ${h}, not ${W} x ${H}`);
    writeFileSync(out, buf);
    console.log(`${out}: ${w} x ${h} JPEG, ${buf.length} bytes (${ex.words}; odds of mark ${ex.step})`);
    await q.close();
  } finally {
    await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 3000))]);
    server.close();
  }
}
