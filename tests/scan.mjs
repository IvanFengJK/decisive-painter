// T10 repository scan: secrets, e-mail identities, where the J-word may appear, and size. Prints counts only, never a
// matched value.   node tests/scan.mjs
//  - secret: if TYPESAFE_API_KEY is set in the environment, its value is compared in memory with every tracked file and
//    every blob in the history (never printed); gitleaks runs over the history if it is installed (redacted);
//  - e-mail: every author and committer address in the history is the noreply identity; tracked files contain no other
//    address;
//  - the J-word appears only in README.md, docs/HISTORY.md, docs/DIRECTOR.md and web/about.html (the credits);
//  - size: a fresh clone under 10 MB, no tracked file over 2 MB.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("../", import.meta.url).pathname;
const git = (...a) => spawnSync("git", a, { cwd: ROOT, encoding: "buffer", maxBuffer: 1 << 30 });
const text = (...a) => git(...a).stdout.toString("utf8");
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};

// secret value, in memory only
const key = process.env.TYPESAFE_API_KEY;
if (key && key.length >= 8) {
  const needle = Buffer.from(key);
  const blobs = new Set(text("rev-list", "--objects", "--all").split("\n").map((l) => l.split(" ")[0]).filter(Boolean));
  let hits = 0;
  for (const id of blobs) {
    if (text("cat-file", "-t", id).trim() !== "blob") continue;
    if (git("cat-file", "-p", id).stdout.includes(needle)) hits++;
  }
  check("T10 the key value is in no blob of the history", hits === 0, `${blobs.size} objects checked, ${hits} hits`);
} else {
  console.log("skip T10 key value comparison: TYPESAFE_API_KEY is not set in this environment");
}
// the history of the checked-out branch (other local branches may hold vendored files with false positives)
const gl = spawnSync("gitleaks", ["git", "--redact", "--no-banner", "--exit-code", "3", "--log-level", "error", "--log-opts", "HEAD", ROOT], { encoding: "utf8" });
if (gl.error) console.log("skip T10 gitleaks: not installed");
else check("T10 gitleaks finds no secret in this branch's history", gl.status === 0, `exit ${gl.status}`);

// e-mail identities
const ids = new Set(text("log", "--all", "--format=%ae%n%ce").split("\n").filter(Boolean));
check("T10 every author and committer is the noreply identity", [...ids].every((e) => /@users\.noreply\.github\.com$/.test(e)), `${ids.size} identities`);
const mails = text("grep", "-I", "-o", "-h", "-E", "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}").split("\n").filter(Boolean);
const other = mails.filter((m) => !/@users\.noreply\.github\.com$/.test(m) && !/@(example\.com|example\.org)$/.test(m) && !/^[^@]+@\d/.test(m));
check("T10 no e-mail address in tracked files other than noreply or example", other.length === 0, `${mails.length} found, ${other.length} other`);

// the J-word
const word = ["j", "e", "v"].join("");
const files = text("grep", "-I", "-i", "-l", word).split("\n").filter(Boolean);
const allowed = new Set(["README.md", "docs/HISTORY.md", "docs/DIRECTOR.md", "web/about.html"]);
const bad = files.filter((f) => !allowed.has(f));
check("T10 the J-word only in README, HISTORY, DIRECTOR and the About credits", bad.length === 0, bad.join(", ") || files.join(", "));

// size
const dir = mkdtempSync(join(tmpdir(), "dp-scan-"));
spawnSync("git", ["clone", "-q", "--no-local", "--branch", text("rev-parse", "--abbrev-ref", "HEAD").trim(), ROOT, join(dir, "c")]);
const du = spawnSync("du", ["-sb", join(dir, "c")], { encoding: "utf8" }).stdout.split("\t")[0];
rmSync(dir, { recursive: true, force: true });
check("T10 a fresh clone is under 10 MB", Number(du) < 10e6, `${(Number(du) / 1e6).toFixed(2)} MB`);
const sizes = text("ls-tree", "-r", "-l", "HEAD").split("\n").filter(Boolean).map((l) => {
  const [meta, path] = l.split("\t");
  return { path, size: Number(meta.trim().split(/\s+/)[3]) };
});
const big = sizes.reduce((a, b) => (b.size > a.size ? b : a), { size: 0 });
check("T10 no tracked file over 2 MB", big.size < 2e6, `largest ${big.path} ${(big.size / 1e6).toFixed(2)} MB`);
const shots = sizes.filter((s) => /^out\/|\.png$/.test(s.path));
check("T10 no screenshots or sheets committed", shots.length === 0, shots.map((s) => s.path).join(", "));
process.exit(failed ? 1 : 0);
