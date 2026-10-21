# Round 23 report: a real model in the browser loop (Model mode)

2026-10-21, 19:44 to 21:22 (about 1 h 38 of the 4-hour box). Untracked (`.git/info/exclude`); see also STATUS.md,
DECISIONS-r23.md (H1–H12), BLOCKERS-r23.md (Track B) and MORNING.txt.

## In one paragraph

**Track A works end to end, and it passed the 90-minute gate at 53 minutes.**
- **The model:** a general small language model, Qwen3-0.6B (int8 ONNX, Apache-2.0), downloads only after
  **Load model**. It runs in the tab on WebAssembly and answers the six recipe questions from the visitor's words by
  scoring lettered options. It does no text generation.
- **On this machine:** a recipe takes about **6.5 s per question** (40 s for the six) after a one-time **654 MB**
  download. The live download from Hugging Face took 49 s; from the browser cache it loads in 3–8 s.
- **Safety:** the default page still makes zero network requests, the guardrails run before the model, and the
  visitor's words appear in no request.

**The model does not help: both judges fail it on both pre-registered criteria.** It ranked first on 9/40 (Ivan) and
4/40 (Claude) prompts (24 needed), and above the rules on 2/7 and 3/7 of the fallback prompts (5 needed). The rules
were the best card on 26/40 and 32/40 prompts; the model was barely better than a plain hash of the words.

**Track B (Kev-0.6B, the trained decision model):**
- **Ported and verified:** the JavaScript port matches Kev's Python on 20 states, with top pick 120/120 and
  max |Δp| 0.0168, in node and in Chromium on WASM.
- **Not on the page:** its 891 MB export would have to be uploaded somewhere public, which this round did not allow.
  BLOCKERS-r23.md has the shortest fix.

## What works (Track A)

| item | result |
|---|---|
| **A1 model and library** | `onnx-community/Qwen3-0.6B-ONNX` @ `58ca03a5…` (Apache-2.0); WASM: `model_int8.onnx` 617.7 MB (SHA-256 `d93222c6…`); WebGPU: `model_q4f16.onnx` 569.8 MB (`9e33a591…`, not testable here). transformers.js **4.3.1** (15 days old), `transformers.min.js` 0.56 MB **vendored** in `web/vendor/` (SHA-256 `8d6716d9…e743`); onnxruntime-web `1.31.0-dev.20260914-8d85527a0` wasm 26.9 MB (`49871f5a…`) fetched after the click. All files are pinned and hashed in `tests/model-files.mjs`. **Backend that ran: WASM** (headless Chromium under WSL has `navigator.gpu` but no adapter). |
| **A2 ModelDirector** | One prompt per question and option order. The words sit in one « » field (no delimiters, at most 80 characters); the question; lettered options; "Answer:". Next-token logits of " A".." H", softmax, both orders averaged, T = 0.5, then the **0.85 cap** (disclosed in DIRECTOR.md and on the About page). The recipe is drawn from those odds with the seed. Six model questions per painting; style, stroke, subject and every mark stay with the rules. **6.4–6.6 s per question** in a clean run (two passes of about 3.2 s each over about 90 tokens); 10.1 s when another inference ran at the same time. |
| **A3 UI** | A **Rules \| Model** toggle (Model disabled until loaded) and **Load model (about 650 MB)** (600 when a WebGPU adapter exists), with a progress bar. Weights stay in the Cache API (it works when storage is blocked). A failure gives a readable message and Rules stay on. The badge reads "Decision-maker: Qwen3-0.6B (recipe) + Rules (marks)", "Model: Qwen3-0.6B, int8, 627 MB, WASM, 6.6 s per question" and "General small language model scoring the options (not a trained decision model)". The recipe line reads "Recipe from the model: …", and "question k of 6" shows while it thinks. Rules mode is the default and unchanged. About, README and DIRECTOR.md describe it honestly; the page no longer says "no AI model" without "by default". |
| **A4 security and privacy** | Zero requests before the click (13 page requests, all same-origin). After it, only the page's own `model-loader.js`, the vendored library, `huggingface.co` (pinned revision) and `cdn.jsdelivr.net` (pinned onnxruntime). **The visitor's words are in no request URL or body** (checked over every request of a session with 6 prompts). CSP additions: `script-src 'wasm-unsafe-eval' https://cdn.jsdelivr.net`; `connect-src https://huggingface.co https://*.hf.co https://cdn.jsdelivr.net`. No `blob:`, no `worker-src`, no `unsafe-inline` or `unsafe-eval`; every change is in a table in DIRECTOR.md. The guardrails block before the model (4–5 ms, no model call). Injection-like prompts still give a probability vector over the fixed options (node and browser). Malformed scorer output fails readably. Numbers are clamped as before. |
| **A5 tests** | **Node 48/48** (39 earlier plus 9 Model mode tests with mock scorers, including the toggle (`ModelSlot`), the badge and "Mock model (test)"). **Browser 198/198** (181 earlier plus 17 Model mode checks) in the working tree and in a fresh clone: the toggle end to end, a valid multi-colour Model painting, the fallback with a blocked download, no request before the click and no prompt text afterwards, guardrails first, injection, Ask it again, phone dark, no CSP errors. **No test needed the retry** (the "Ask it again" test now has a 120 s timeout and one recorded retry). The Model checks need `MODEL_MIRROR=<dir>` (made by `node tests/model-files.mjs <dir>`, hashes verified; the page's real requests are rerouted to it) or `MODEL_LIVE=1`; otherwise they say they are skipped. |
| **A6 quality sheet** | `out/sheet/sheet.html`: 40 prompts × 3 shuffled cards (Rules, Model, plain hash), six role colours and the first 12 of 30 marks each; `key.json` separate; empty `answers.csv`. **Validated:** 40 rows, no repeated card, labels A–B–C, nothing clipped, the key a permutation per row. `coverage.md` (written before judging): **33 scene matches, 7 fell back** (#14, 18, 20, 26, 27, 36, 40). **My picks are sealed** (SHA-256 `f9c4f577…fbbd` in STATUS.md); I have not opened `key.json` or `model-looks.json`. |

**Numbers on this machine (WASM, headless Chromium, 20 cores):**
- **Download:** 653.7 MB (617.7 model + 9.1 tokenizer + 26.9 runtime + small files).
- **Load:** 49 s live from Hugging Face for the model file; 7–8 s from the local mirror; 3.1 s from the browser cache.
- **Recipe:** 6.4–6.6 s per question, about 40 s for the six (one painting in Model mode took 42.6 s, recipe plus 30 marks).
- **The sheet's 40 recipes:** 39.3 s per prompt.

**Limits.**
- **The page pauses** for about 3 s at a time while the model thinks: inference runs on the main thread, yielding
  between passes (DECISIONS H5).
- **WebGPU is untested** here.
- **Hugging Face's CDN subdomain** depends on the visitor's region, so the CSP allows `*.hf.co`.
- **The model's odds**, analysed after judging: no collapse (mean top probability 0.57; 23 of 240 answers at the
  0.85 cap), but the recipes drift to teal and "side weight" (see "Whether the model helps").

## Whether the model helps: no

Scored after you finished (2026-10-21, 21:36). My picks were checked first: `out/sheet/claude-picks.csv` still had the
SHA-256 sealed in STATUS.md (`f9c4f577…fbbd`), **match**. Only then was `key.json` opened. Scorer:
`node tests/score-sheet.mjs out/sheet <answers.csv>`. It now also reads a spreadsheet-saved form, with one letter per
cell and ids without their leading zero.

**Pre-registered reading:** the model HELPS if its card is first on at least 24 of 40 prompts AND above the Rules card on
at least 5 of the 7 fallback prompts (#14, 18, 20, 26, 27, 36, 40).

| | Ivan | Claude | needed |
|---|---|---|---|
| (a) model ranked above both Rules and hash | **9 / 40** | **4 / 40** | 24 |
| (b) model above the Rules card on the 7 fallback prompts | **2 / 7** (29%) | **3 / 7** (43%) | 5 (70%) |
| **result** | **does not help** | **does not help** | |
| first places: Rules / Model / hash | 26 / 9 / 5 | 32 / 4 / 4 | |
| average rank (1 = best): Rules / Model / hash | **1.50** / 2.10 / 2.40 | **1.30** / 2.27 / 2.42 | |
| pairwise of 40: model above rules / model above hash / rules above hash | 11 / 25 / 31 | 6 / 23 / 34 | |
| first places on the 7 fallback prompts: Rules / Model / hash | 4 / 2 / 1 | 4 / 2 / 1 | |

**Agreement:** we chose the same top card on **28 / 40** prompts, and gave an identical full ranking on 21 / 40. The model
was first for both of us on 2 prompts (#18, #35) and last for both on 9 (#1, 5, 6, 7, 8, 11, 13, 32, 36).

**Where it won most clearly** (model ranked 1 by Ivan / by Claude):
- **#18 "a slice of watermelon" (a fallback), 1/1.** Model: warm, split-complementary, **pink**, light, side weight
  (light warm pink with a teal accent). Rules: joyful monochrome **yellow**, diagonal sweep. Hash: stormy, red family
  but a sand dominant. The model read the fruit's colour; the rules' hash fallback could not.
- **#35 "a hot air balloon over hills", 1/1.** Model: eerie, complementary, **teal** sky with a **red** accent, diagonal
  sweep. Rules: warm analogous green, open horizon. Hash: joyful monochrome pink, deep ground. A sky colour and a
  contrasting balloon accent.
- **#19 "a blue whale", 1/2.** Model: calm, complementary, **dark teal** with a pink accent, deep ground. Rules: calm
  analogous mid blue, deep ground (my first choice). Hash: eerie light teal, open horizon.

**Where it did worst** (last for both of us):
- **#8 "an autumn forest path", 3/3.** Model: eerie, split-complementary, **deep cool green** with a pink accent, side
  weight. Rules: warm analogous **orange** with a red accent, tall centre. The model missed autumn's colours.
- **#7 "a quiet pond with lily pads", 3/3.** Model: calm, complementary, **light warm yellow** with a blue accent, side
  weight. Rules: calm analogous **mid green**, mirror water. It got the wrong hue and lost the reflection composition.
- **#6 "desert dunes under a full moon", 3/3.** Model: calm, split-complementary, **dark cool green**, deep ground. Rules:
  eerie complementary **dark orange** (sand) with a teal accent, big sky. A green desert.

**What kind of prompt it helps or fails on.**
- **Helps:** it can help when the rules have no scene and the object's colour is everyday knowledge (watermelon →
  pink), or the picture is mostly sky (balloon, whale).
- **Fails:** it fails on scenes whose colour comes from the scene rather than a named word (autumn, desert, pond),
  where it picks a wrong hue and a generic composition.
- **The odds did not collapse:** the mean top probability was 0.57, and only 23 of 240 answers reached the 0.85 cap.
- **Its recipes drift to a few defaults:** teal in 13 of 40, "side weight" in 16 of 40, muted in 21, and almost never
  a mid key (1 of 40).
- **The fallback test rests on only 7 prompts**, so (b) is a small sample, but (a) is decisive on its own: 9 and 4
  against 24.

**Which parts of the premise are now true:**
- **True:** a small model (0.6B) can make decisions for this painter in the browser, with no server, after a one-time
  ~650 MB download, without the visitor's words leaving the tab and with honest labels.
- **True except hosting:** a trained decision model (Kev-0.6B) runs in the browser (WASM) and matches its Python
  scores (Track B).
- **False on this test:** that a general small model choosing the recipe makes better paintings than the authored
  rules. It made them worse than the rules for both judges, on both criteria, on the same 40 prompts. It was only
  slightly better than a hash of the words (above the hash on 25/40 and 23/40 prompts).
- **Still unshown:** whether a trained decision model would do better. Kev's recipes are on the supplementary four-card
  sheet (`out/sheet4/`), which you did not rank, so it is not scored. Earlier research also found Kev-0.6B collapsing
  on these questions.
- **Not practical on phones yet:** 650 MB and about 40 s per recipe on this desktop CPU, with WebGPU untested.

## Track B (Kev-0.6B): detail in BLOCKERS-r23.md

- **Re-downloaded** `jaredpalmer/kev-0.6b` and `Qwen/Qwen3-0.6B-Base`; merged the LoRA with Kev's loader (CPU, fp32;
  the Kev checkout was read only).
- **Exported** the backbone's hidden states to ONNX as one causal row per question. There is **no KV cache**: each
  row re-runs the ~60-token state.
- **Quantisation:**
  - plain dynamic int8 fails (77/120, Δp 0.50);
  - weight-only 8-bit with blocks of 32 just misses (118/120, 0.028);
  - **weight-only 8-bit with blocks of 16 and an fp16 embedding passes: 891 MB.**
- **The JS port** (token rows with Kev's delimiters and escaping, positions, pointer head) passes, with 20/20 identical
  token ids:

  | runtime | top pick | max \|Δp\| | per question |
  |---|---|---|---|
  | node | 120/120 | 0.0168 | 0.7 s |
  | Chromium WASM | 120/120 | 0.0168 | 3.6 s |

- **Not added to the page:** it needs a public host (an upload, out of bounds this round).
- **A four-card supplementary sheet** with Kev's recipes (same draw rules) is in `out/sheet4/` (validated, its own
  key). It is not part of the pre-registered reading. Neither of us ranked it, so it is not scored.
- The export and its scripts are in `out/trackb/` (not committed).

## Commits on `model-mode` (from `main` 2d9999f)

```
4692b9e fix: say plainly that rules decide by default and Model mode is optional
206f3e6 test: optional fourth card on the quality sheet for a trained decision model
e3e4323 test: scorer for the pre-registered quality-sheet reading
0290f72 docs: Model mode, the no-collapse guard and every CSP change
ca46391 test: quality sheet generator for Rules, Model and hash recipes
96758ca test: Model mode browser checks with a verified local mirror of the pinned model files
f4e31fd fix: Model mode keeps the share link and labels the download by the real backend
e7cfc0b feat: Model mode in the page: Load model on click, Rules | Model toggle, badge and fallback
3c9f58f feat: ModelDirector scores the six recipe questions from next-token letter probabilities
```

## Screenshots (`out/shots/`, not committed)

| file (per view and theme) | what it shows |
|---|---|
| `desktop-light-model.png` | Model mode after painting "a field of sunflowers at noon": the badge names Qwen3-0.6B (int8, 627 MB, WASM, seconds per question) with the honest note; "Recipe from the model: …"; the toggle on Model, "Model loaded" and its status line |
| `phone-dark-model.png` | the same on a phone in the dark theme ("a quiet pond with lily pads"), loaded from the browser's cache |
| `desktop-light-model-fallback.png` | Model mode's fallback: the download was blocked, with the readable message "Model mode is not available: the model files could not be downloaded. The rules stay on.", the button "Try loading the model again", and a painting by the rules |
| `*-start.png` | the empty page: name, tagline, explainer, badge, the Rules \| Model toggle and Load model |
| `*-paint.png`, `*-pixel.png`, `*-sketch.png` | Rules mode as before (the lighthouse), in the three skins |
| `*-director.png`, `*-director-odds.png` | Be the director at mark 4 with the rules' odds |
| `*-about.png` | About, with the new "Model mode (optional)" section |
| `*-picker.png`, `*-blocked.png`, `phone-light-badlink.png`, `desktop-light-gallery.png` | as in earlier rounds |

`*` = `phone-light`, `phone-dark`, `desktop-light` and `desktop-dark` (370×822 and 1280×800).

## Self-check

- **Nothing pushed or deployed by this session; no remote added.** No `git push`, `fetch`, `gh` or `vercel` was run.
  - **One thing you should know:** `../decisive-painter` already had your remote `decisive-painter` before this round,
    and its reflog shows `refs/remotes/decisive-painter/main` was created by **"update by push" at 19:45:03**, 24
    seconds after my start snapshot, while I was only querying the Hugging Face API. It pushed `main` (`2d9999f`, the
    v1.1.1 tip) and set `main` to track that remote.
  - That push did not come from my commands. `model-mode` has never been pushed: no remote branch contains it.
- **No key read or printed.** `TYPESAFE_API_KEY` was not touched this round: the secret scan of earlier rounds was not
  needed for these brief items, and nothing reads it.
- **No weights, screenshots or sheets committed.** No history path is a model, screenshot or sheet. The only
  third-party file committed is the vendored `transformers-4.3.1.min.js` (0.56 MB, Apache-2.0, with its licence).
- **Repository 4.85 MB** as a standalone clone (under 10 MB); the largest file is 0.71 MB. The ignored `out/` folder
  holds 852 MB of Track B files and the screenshots, and none of it is in git.
- **No other repository or worktree changed.** Compared with the start-of-round snapshot, every research worktree's
  `git status`, every branch and tag of the research repository, and the worktree list are identical. In
  `../decisive-painter` the only ref changes are the new branch `model-mode` and the remote-tracking ref above.
  `main` and all tags are unchanged, and the tree is clean.
- **The default page makes zero requests** before the click (13 same-origin page files; checked in every run).
- **The guardrails gate the model:** a blocked prompt is refused in 4–5 ms, with no model call.
- **The injection tests pass** (node and browser).
- **The fresh-clone tests pass:** node 48/48, browser 198/198 (final run on `4692b9e`).
- **Not touched:** the llama-server (healthy, `{"status":"ok"}`), the main tree, the Kev checkout (read only) and the
  research worktrees. Kev-0.6B and Qwen3-0.6B-Base were re-downloaded to the Hugging Face cache, as the brief allows.
