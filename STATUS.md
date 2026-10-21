# Round 23 status

Started 19:44 (2026-10-21). Untracked (`.git/info/exclude`).

| time | step |
|---|---|
| 19:44 | snapshot; branch `model-mode` |
| 19:48 | prototype: Qwen3-0.6B int8 runs in headless Chromium (WASM); letter scores sensible |
| 19:58 | Model mode end to end under the CSP (after pinning the revision in the URL template) |
| 20:08 | Model mode browser group 16/17; two bugs found and fixed (share link, size label) |
| 20:24 | full browser suite in the working tree 198/198 |
| **20:37** | **Gate A passed (53 min):** fresh clone of `model-mode`, node 48/48, browser 198/198, no retries |
| 20:36 | quality sheet built and validated (40 rows, no problems) |
| 20:40 | my picks sealed (below); Track B starts |

## Quality sheet (in `out/sheet/`, not committed)

Before judging, `out/sheet/coverage.md` lists which prompts the keyword table matched:
- **33 of 40 scene matches.**
- **7 fell back** (no scene matched): #14 a bowl of ramen and #18 a slice of watermelon (hash only); #20 a rainy cafe
  window, #26 a red umbrella in the rain, #27 cherry blossoms in spring, #36 a misty bamboo forest and #40 a bakery at
  dawn (hash plus generic words).

The second criterion (the model above the rules on at least 70% of fallback prompts) therefore rests on 7 prompts and
needs 5 of 7.

**Claude's picks, sealed before opening the key:** `out/sheet/claude-picks.csv`,
SHA-256 `f9c4f57774e38f78ddb0341fafc5e6b6414370210a2462b93973afa3c581fbbd`. Neither the key (`key.json`) nor
`model-looks.json` (which would reveal the model's recipes) has been opened. Your empty form is `out/sheet/answers.csv`.
Score with `node tests/score-sheet.mjs out/sheet <answers.csv>`.

## Track B

Started 20:40, box 1 h 45 (until about 22:25); stopped at 21:10.
- Kev-0.6B re-downloaded; LoRA merged on the CPU; backbone exported to ONNX (one causal row per question, no KV cache).
- Plain int8 failed parity (77/120). Weight-only 8-bit with blocks of 16 and an fp16 embedding passed (891 MB).
- JS port verified against kev's Python on 20 states: top pick 120/120, max |dp| 0.0168, in node and in Chromium (WASM).
- Not on the page: the export needs a public host (BLOCKERS-r23.md). Supplementary four-card sheet in out/sheet4/.

## Scored (21:36, after your judging)

- My sealed picks were checked against the SHA-256 above: **match**. Then the key was opened.
- **Result: the model does not help (both judges, both criteria).**
  - (a) model first: Ivan 9/40, Claude 4/40 (need 24).
  - (b) above the rules on the 7 fallback prompts: Ivan 2/7, Claude 3/7 (need 5).
  - Average rank Rules / Model / hash: Ivan 1.50 / 2.10 / 2.40, Claude 1.30 / 2.27 / 2.42.
  - We agreed on the top card in 28/40 prompts.
  - Details are in REPORT-r23.md.
- The supplementary Kev sheet (`out/sheet4/`) was not ranked, so it is not scored.

## End

21:22: final fresh clone of model-mode (4692b9e): node 48/48, browser 198/198, no retries. Self-check in REPORT-r23.md.
