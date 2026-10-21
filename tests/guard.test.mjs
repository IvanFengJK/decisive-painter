// T5 guardrails + T6 mock guard (node --test tests/). Sets are in tests/guard-sets (never on the page).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DisabledGuard, GUARD_CATEGORIES, runGuard } from "../web/guard.js";
import { BLOCK_MESSAGE, check, hygiene } from "../web/policy.js";

const load = (n) => JSON.parse(readFileSync(new URL(`./guard-sets/${n}.json`, import.meta.url))).prompts;

for (const set of ["heldout", "heldout2", "dev"]) {
  test(`${set}: every benign prompt passes`, () => {
    const bad = load(`${set}-benign`).filter((p) => !check(p).ok);
    assert.deepEqual(bad, []);
  });
  test(`${set}: every policy-violating prompt is blocked`, () => {
    const missed = load(`${set}-harmful`).filter((p) => check(p).ok);
    assert.deepEqual(missed, []);
  });
}

test("block message is neutral and never echoes the visitor's text", () => {
  for (const p of load("heldout-harmful")) {
    const r = check(p);
    assert.equal(r.message, BLOCK_MESSAGE);
    assert.ok(!r.text, "no text returned for a blocked prompt");
  }
});

test("hygiene: long input, markup, script strings, empty, control characters", () => {
  assert.equal(check("abcdefghi ".repeat(9)).reason, "long");
  assert.equal(check("x".repeat(100000)).reason, "long");
  assert.equal(check("a harbour ".repeat(9)).reason, "long");
  for (const m of ["<b>sea</b>", "<script>alert(1)</script>", "javascript:alert(1)", "a lake onerror=alert(1)",
    "${process.exit()}", "{{constructor}}", "&#60;img&#62;", "%3Cscript%3E", "sea `rm -rf`", "\\u003cscript"]) {
    assert.equal(check(m).ok, false, m);
  }
  assert.equal(check("").reason, "empty");
  assert.equal(check("   ​​  ").reason, "empty");
  assert.equal(check(null).reason, "type");
  assert.equal(hygiene("a\u0000 lake\u0007 at\u001b dawn").text, "a lake at dawn");
  assert.equal(hygiene("a laaaaake").text, "a laake");
  assert.equal(hygiene("ａ　ｌａｋｅ").text, "a lake"); // NFKC
});

test("right-to-left override and zero-width tricks are removed and still checked", () => {
  assert.equal(hygiene("a ‮la‬ ke").text, "a la ke");
  assert.equal(check("‮nroP‬ in a field").ok, false);
  assert.equal(check("po​rn").ok, false);
  assert.equal(check("a ‮sea‬ at dawn").ok, true);
});

test("emoji pass hygiene and do not crash the filter", () => {
  for (const p of ["a 🌅 over the sea", "🐈 on a sofa", "🌲🌲🌲 forest", "👨‍👩‍👧 at the beach"]) {
    const r = check(p);
    assert.equal(r.ok, true, p);
  }
});

class MockGuard {
  constructor(p) { this.p = p; this.enabled = true; this.name = "mock guard"; this.calls = 0; }
  async init() {}
  async decide(state, questions) {
    this.calls++;
    assert.equal(questions.length, 1);
    assert.deepEqual(questions[0].options, GUARD_CATEGORIES);
    assert.match(state.text, /^Request \(visitor text/);
    if (this.p === "throw") throw new Error("down");
    if (this.p === "bad") return [{ id: "safety", probs: "??" }];
    return [{ id: "safety", probs: this.p }];
  }
}

async function fullCheck(prompt, guard) {
  const r = check(prompt);
  if (!r.ok) return r;
  const g = await runGuard(guard, r.text);
  return g.blocked ? { ok: false, kind: "guard", message: BLOCK_MESSAGE } : r;
}

test("mock guard: can add a block above the threshold", async () => {
  const g = new MockGuard({ safe: 0.2, violence: 0.8 });
  assert.equal((await fullCheck("a quiet harbour", g)).ok, false);
  const ok = new MockGuard({ safe: 0.9, other: 0.1 });
  assert.equal((await fullCheck("a quiet harbour", ok)).ok, true);
});

test("mock guard: can never remove a rule block (it is not even asked)", async () => {
  const g = new MockGuard({ safe: 1 });
  assert.equal((await fullCheck("hardcore porn", g)).ok, false);
  assert.equal(g.calls, 0);
});

test("mock guard: errors and malformed answers fail closed; the disabled guard passes", async () => {
  assert.equal((await fullCheck("a quiet harbour", new MockGuard("throw"))).ok, false);
  assert.equal((await fullCheck("a quiet harbour", new MockGuard("bad"))).ok, false);
  assert.equal((await fullCheck("a quiet harbour", new DisabledGuard())).ok, true);
});
