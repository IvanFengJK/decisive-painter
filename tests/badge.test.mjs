// The decision-maker badge reads the Director itself, so a model Director changes it with no page edits.
import assert from "node:assert/strict";
import { test } from "node:test";
import { EndpointDirector, RuleDirector, directorBadge, optionsOf, paintSteps } from "../web/director.js";
import { readPrompt } from "../web/recipes.js";

class MockModel {
  name = "Mock model (test)";
  kind = "model";
  async init() {}
  async decide(state, questions) {
    return questions.map((q) => ({ id: q.id, probs: optionsOf(q).map((_, i) => i + 1) }));
  }
}

test("badge: the rules director today, with an empty model slot", () => {
  assert.deepEqual(directorBadge(new RuleDirector()), { decider: "Decision-maker: Rules (authored tables)", model: "Model: none loaded" });
});

test("badge: a mock model Director fills both lines from its name", () => {
  assert.deepEqual(directorBadge(new MockModel()), { decider: "Decision-maker: Mock model (test)", model: "Model: Mock model (test)" });
});

test("badge: an endpoint is named but does not claim to be a model", () => {
  const b = directorBadge(new EndpointDirector("http://localhost:8787/decide"));
  assert.equal(b.decider, "Decision-maker: Your endpoint (localhost:8787)");
  assert.equal(b.model, "Model: none loaded");
});

test("badge: the mock model Director paints through the same harness", async () => {
  const look = readPrompt("a red barn on a hill").look;
  let n = 0;
  for await (const s of paintSteps({ prompt: "a red barn on a hill", look, seed: 3, budget: 10, director: new MockModel() })) {
    for (const q of s.qs) assert.ok(Math.abs(s.P[q.id].reduce((a, b) => a + b, 0) - 1) < 1e-9);
    n = s.step;
  }
  assert.equal(n, 10);
});
