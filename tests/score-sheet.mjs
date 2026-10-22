// Score a judged quality sheet against its key (run only after judging):
//   node tests/score-sheet.mjs <sheet dir> <answers.csv>
// Pre-registered reading (Round 23): the model HELPS if its card is ranked above both Rules and the hash baseline on at
// least 24 of 40 prompts AND above the Rules card on at least 70% of the prompts where the rules fell back (no scene in
// the keyword table matched; see coverage.md).
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [dir, file] = process.argv.slice(2);
const key = JSON.parse(readFileSync(join(dir, "key.json"), "utf8"));
const coverage = readFileSync(join(dir, "coverage.md"), "utf8");
const fellBack = new Set([...coverage.matchAll(/^\| (\d\d) \| .* \| fell back/gm)].map((m) => m[1]));
// a ranking is either one cell ("BCA") or one letter per cell after the prompt (best, middle, worst), as a spreadsheet
// saves it; ids may lose their leading zero ("1" for "01")
const rows = readFileSync(file, "utf8").replace(/\r/g, "").trim().split("\n").slice(1).map((l) => {
  const cells = l.match(/("[^"]*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").trim());
  const id = cells[0].padStart(2, "0");
  const rank = cells.slice(2).join("").toUpperCase().replace(/[^ABCD]/g, "");
  return { id, rank };
});
const n = Object.keys(Object.values(key)[0]).length;
const bad = rows.filter((r) => r.rank.length !== n || new Set(r.rank).size !== n);
if (bad.length) throw new Error(`rows without a full A/B/C ranking: ${bad.map((r) => r.id).join(", ")}`);
let first = 0, fbAbove = 0;
const per = [];
for (const r of rows) {
  const order = [...r.rank].map((L) => key[r.id][L]); // sources, best to worst
  const m = order.indexOf("model"), ru = order.indexOf("rules");
  if (m === 0) first++;
  if (fellBack.has(r.id) && m < ru) fbAbove++;
  per.push(`${r.id} ${order.join(" > ")}${fellBack.has(r.id) ? " (fell back)" : ""}`);
}
const fbShare = fellBack.size ? fbAbove / fellBack.size : 0;
console.log(per.join("\n"));
console.log(JSON.stringify({ prompts: rows.length, model_first: first, need_first: 24, fell_back: fellBack.size, model_above_rules_on_fallback: fbAbove,
  share: Number(fbShare.toFixed(3)), need_share: 0.7, helps: first >= 24 && fbShare >= 0.7 }));
