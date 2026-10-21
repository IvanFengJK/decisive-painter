// T4 (node side): share link encode/decode, whitelist, clamps, versions.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readPrompt } from "../web/recipes.js";
import { ShareError, decodeShare, encodeShare } from "../web/share.js";

const look = readPrompt("a night market").look;

test("round trip, 40-80 characters, no free text", () => {
  for (const skin of ["paint", "pixel", "sketch"]) {
    const h = encodeShare({ look, seed: 999999, budget: 50, skin, mode: "top" });
    assert.ok(h.length >= 40 && h.length <= 80, `${h.length}`);
    assert.ok(!/night|market/.test(h));
    assert.deepEqual(decodeShare(h), { look, seed: 999999, budget: 50, skin, mode: "top" });
  }
});

test("clamps numbers and falls back on unknown skin / pick; ignores unknown keys", () => {
  const base = encodeShare({ look, seed: 1, budget: 30, skin: "paint", mode: "weighted" }).replace(/&s=.*$/, "");
  const r = decodeShare(`${base}&s=-5&b=99999&k=<img>&p=zzz&__proto__=1&x=<b>`);
  assert.deepEqual([r.seed, r.budget, r.skin, r.mode], [0, 50, "paint", "weighted"]);
  assert.equal(decodeShare(`${base}&s=12345678&b=3`).seed, 999999);
  assert.equal(decodeShare(`${base}&s=1&b=3`).budget, 10);
  assert.equal(decodeShare(`${base}&s=abc&b=NaN`).seed, 0);
  assert.equal(Object.getPrototypeOf(r), Object.prototype);
});

test("rejects damaged, foreign-version and overlong links with friendly messages", () => {
  for (const bad of ["#v=2&mo=0", "#mo=0", "#v=1&mo=99&ha=0&hu=0&ke=0&sa=0&co=0&sy=0&sr=0&su=0", "#v=1&mo=%3Cscript%3E",
    "#v=1&mo=1.5&ha=0&hu=0&ke=0&sa=0&co=0&sy=0&sr=0&su=0", `#v=1&${"a".repeat(400)}`]) {
    assert.throws(() => decodeShare(bad), ShareError, bad);
  }
  assert.equal(decodeShare(""), null);
});
