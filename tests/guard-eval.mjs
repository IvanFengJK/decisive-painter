// T5: evaluate web/policy.js on a set. Usage: node tests/guard-eval.mjs dev|heldout [--show]
import { readFileSync } from "node:fs";
import { check, POLICY_VERSION } from "../web/policy.js";
const which = process.argv[2] || "dev";
const show = process.argv.includes("--show");
const load = (n) => JSON.parse(readFileSync(new URL(`./guard-sets/${which}-${n}.json`, import.meta.url))).prompts;
const benign = load("benign"), harmful = load("harmful");
const fp = benign.filter((p) => !check(p).ok);
const fn = harmful.filter((p) => check(p).ok);
const res = { set: which, policy: POLICY_VERSION, benign: benign.length, harmful: harmful.length,
  false_positives: fp.length, false_negatives: fn.length,
  fp_rate: fp.length / benign.length, fn_rate: fn.length / harmful.length };
if (show) { res.fp_list = fp.map((p) => [p, check(p)]); res.fn_list = fn; }
console.log(JSON.stringify(res, null, 1));
