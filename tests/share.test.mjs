// T5 (node side): share link encode/decode, whitelist, clamps, versions; v=1 links keep their meaning.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readPrompt } from "../web/recipes.js";
import { ShareError, decodeShare, encodeShare } from "../web/share.js";

const look = readPrompt("a night market").look;
const G = { look, seed: 999999, budget: 50, mode: "top", grid: 32, sample: "likely", coarse: 6 };

test("v=2 round trip per tab and style, under 120 characters, no free text", () => {
  for (const [tab, style] of [["gesture", "brush"], ["gesture", "sketch"], ["gesture", "pixel"], ["map", "pixel"], ["map", "impasto"]]) {
    const r = { ...G, tab, style, ...(tab === "map" ? { grid: 48, sample: "sampled", coarse: 8 } : {}) };
    const h = encodeShare(r);
    assert.ok(h.startsWith("#v=2&") && h.length <= 120, `${h.length} ${h}`);
    assert.ok(!/night|market/.test(h));
    const back = decodeShare(h);
    assert.deepEqual([back.tab, back.style, back.look, back.seed], [tab, style, look, 999999]);
    if (tab === "map") assert.deepEqual([back.grid, back.sample, back.coarse], [48, "sampled", 8]);
    else assert.deepEqual([back.budget, back.mode], [50, "top"]);
  }
});

test("v=1 links open the Gesture tab with their old skin; an old Paint painting keeps a v=1 link", () => {
  const v1 = "#v=1&mo=1&ha=1&hu=5&ke=2&sa=1&co=1&sy=6&sr=1&su=2&s=482130&b=30&k=paint&p=w";
  const r = decodeShare(v1);
  assert.deepEqual([r.tab, r.style, r.seed, r.budget, r.mode], ["gesture", "paint", 482130, 30, "weighted"]);
  assert.equal(encodeShare(r), v1);
  assert.equal(decodeShare(v1.replace("k=paint", "k=sketch")).style, "sketch");
  assert.equal(decodeShare(v1.replace("k=paint", "k=pixel")).style, "pixel");
  assert.equal(decodeShare(v1.replace("k=paint", "k=brush")).style, "paint"); // v=1 never knew Brush
  assert.ok(encodeShare(decodeShare(v1.replace("k=paint", "k=pixel"))).startsWith("#v=2&t=g&st=pixel&"));
});

test("clamps numbers and falls back on unknown tab / style / pick; ignores unknown keys", () => {
  const base = encodeShare({ ...G, tab: "map", style: "impasto" }).replace(/&s=.*$/, "");
  const r = decodeShare(`${base}&s=-5&g=99999&c=99&sm=zz&st=<img>&__proto__=1&x=<b>`);
  assert.deepEqual([r.seed, r.grid, r.coarse, r.sample, r.style], [0, 48, 8, "likely", "impasto"]);
  assert.equal(decodeShare(`${base}&s=1&g=3&c=1`).grid, 16);
  assert.equal(decodeShare(`${base}&s=1&g=3&c=1`).coarse, 4);
  assert.equal(decodeShare(`${base}&s=1&c=5`).coarse, 6);
  const t = decodeShare(base.replace("t=m", "t=zz").replace("st=impasto", "st=impasto") + "&s=1");
  assert.deepEqual([t.tab, t.style], ["gesture", "brush"]); // unknown tab: Gesture; impasto is not a Gesture style
  const gb = encodeShare({ ...G, tab: "gesture", style: "brush" }).replace(/&s=.*$/, "");
  assert.deepEqual([decodeShare(`${gb}&b=99999`).budget, decodeShare(`${gb}&b=3`).budget, decodeShare(`${gb}&p=zz`).mode], [50, 10, "weighted"]);
  assert.equal(Object.getPrototypeOf(r), Object.prototype);
});

test("rejects damaged, foreign-version and overlong links with friendly messages", () => {
  for (const bad of ["#v=2&mo=0", "#mo=0", "#v=3&mo=0&ha=0&hu=0&ke=0&sa=0&co=0&sy=0&sr=0&su=0", "#v=1&mo=99&ha=0&hu=0&ke=0&sa=0&co=0&sy=0&sr=0&su=0",
    "#v=2&t=m&mo=%3Cscript%3E", "#v=1&mo=1.5&ha=0&hu=0&ke=0&sa=0&co=0&sy=0&sr=0&su=0", `#v=2&${"a".repeat(300)}`]) {
    assert.throws(() => decodeShare(bad), ShareError, bad);
  }
  assert.equal(decodeShare(""), null);
});

test("a link never carries model output: the same recipe gives the same link whoever decided", () => {
  const r = { ...G, tab: "map", style: "pixel" };
  assert.equal(encodeShare({ ...r, field: [1, 2, 3], decider: "model" }), encodeShare(r));
});
