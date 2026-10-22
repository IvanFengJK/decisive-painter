// The decision-maker badge reads the Director itself, so a model Director changes it with no page edits.
import assert from "node:assert/strict";
import { test } from "node:test";
import { EndpointDirector, MODEL_BADGE, RECIPE_ONLY_NOTE, RULES_BADGE, RuleDirector, decisionBadge, directorBadge, marksNote, optionsOf,
  paintSteps } from "../web/director.js";
import { ModelDirector } from "../web/model-director.js";
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
  assert.deepEqual(directorBadge(new RuleDirector()), { decider: "Decision-maker: Rules (authored tables)", model: "Model: none loaded", note: "" });
});

test("badge: a mock model Director fills both lines from its name", () => {
  assert.deepEqual(directorBadge(new MockModel()), { decider: "Decision-maker: Mock model (test)", model: "Model: Mock model (test)", note: "" });
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

test("badge: Gesture + model says exactly which marks the model decided", () => {
  const model = new ModelDirector({ scorer: async () => [0], info: { name: "Qwen3-0.6B" } });
  assert.deepEqual(decisionBadge({ tab: "gesture", director: model, budget: 30 }), { decider: MODEL_BADGE, note: RECIPE_ONLY_NOTE });
  assert.equal(RECIPE_ONLY_NOTE, "recipe: model, marks: authored weights");
  model.marks = true;
  assert.equal(decisionBadge({ tab: "gesture", director: model, budget: 30 }).note,
    "recipe and the colour of 4 of 30 marks: model; everything else: authored weights");
  assert.equal(decisionBadge({ tab: "gesture", director: model, budget: 50 }).note,
    "recipe and the colour of 5 of 50 marks: model; everything else: authored weights");
  assert.equal(decisionBadge({ tab: "gesture", director: model }).note,
    "recipe and the colour of a few marks: model; everything else: authored weights");
  assert.equal(decisionBadge({ tab: "map", director: model, coarse: 6 }).note, "Model on a 6x6 grid, interpolated", "the map note is unchanged");
  assert.deepEqual(decisionBadge({ tab: "gesture", director: new RuleDirector(), budget: 30 }), { decider: RULES_BADGE, note: "" });
  assert.equal(marksNote({ questions: ["colour", "fill"], budget: 20, planned: 5, decided: 0, fallback: null }),
    "recipe and the colour and fill of 5 of 20 marks: model; everything else: authored weights");
  assert.equal(marksNote({ questions: ["colour"], budget: 20, planned: 5, decided: 3, fallback: { step: 14, reason: "the model stopped while answering" } }),
    "recipe and the colour of 3 of 20 marks: model; everything else: authored weights (from mark 14 on, the rules: the model stopped while answering)");
  assert.equal(marksNote(null), RECIPE_ONLY_NOTE);
});
