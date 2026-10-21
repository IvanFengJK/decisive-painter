// Share links made by v1.0.0 must still open the same painting (fixture recorded before the v1.1.0 changes).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { RuleDirector, paintSteps } from "../web/director.js";
import { decodeShare } from "../web/share.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/v1.0.0-links.json", import.meta.url), "utf8"));

for (const link of fixture.links) {
  test(`v1.0.0 link still paints the same pixels: ${link.skin}, ${link.mode}, ${link.budget} marks`, async () => {
    const r = decodeShare(link.hash);
    let last;
    for await (const s of paintSteps({ prompt: "x", look: r.look, seed: r.seed, budget: r.budget, skin: r.skin, director: new RuleDirector(), mode: r.mode })) last = s;
    assert.equal(createHash("sha256").update(last.painter.view().rgba()).digest("hex"), link.sha256);
  });
}
