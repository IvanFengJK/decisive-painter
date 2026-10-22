# Decisions

## Round 17: the site

Choices where the brief left room, each the simplest option that satisfies the rules. Edited for this repository:
paths point to the files here, and two entries about the research repository and machine (D1, D22) are left out.

- **D2 Spec vs code.** Where `harness-spec.md` and the Python differ, the code was followed. Found: (a) the spec says "50 marks
  always"; the Kev-4B traces were run without L2, so their paintings stop at 41-49 marks when the model said "finished" (the
  reference check renders exactly the recorded marks); (b) the spec's place menus say "grid cells >= 50 % inside them"; the
  code (`levers._cells_over`) measures coverage on a 100x100 raster with rounded box edges (ported as such); (c) the spec
  does not mention that `fill_strokes` always draws `rng.uniform(-35, 35)` even when the angle comes from the table
  (Python evaluates `dict.get`'s default eagerly); the port keeps that draw.
- **D3 RNG.** The Python renderer uses numpy PCG64 with numpy's normal and integer algorithms, which cannot be ported
  exactly in a few lines. The site uses `web/rng.js`: FNV-1a (32 bit) of the same seed strings ("painting id|step",
  "painting id|paper") feeding mulberry32; normals by Box-Muller (two draws each, no caching); integers by floor. Its exact
  Python twin is `harness/portable_rng.py`, used by `harness/render_portable.py`, a COPY of the frozen
  renderer with only the generator swapped and a geometry logger wrapped around ImageDraw (the frozen file is untouched).
  `harness/render_decisions.py` renders any decisions file with either renderer.
- **D4 Software rasteriser.** Canvas2D antialiasing differs between browsers, so `render.js` rasterises in software
  (scanline polygons, thick lines as quads with round joints, discs, Pillow-style fractional box blur, Pillow-style bicubic
  for the paper noise). Same pixels in every browser and in node; this is what makes share links reproduce across devices
  and lets node run the contract tests. The display canvas only receives finished pixels (putImageData).
- **D5 Pixel-size constants scale with the canvas.** Every pixel-sized constant (jitter, wobble, blur radii, subdivision
  steps, minimum gap and dot radius) is multiplied by k = size / 600. At the Python size k = 1 exactly, so the 600 px check is
  unaffected; the Pixel skin draws at 192 px (k = 0.32).
- **D6 Phase weights.** From the 12 Kev-4B traces only (computed by a script in the research branch,
  not included here, and pasted into `web/director.js`): Kev-4B's mean model distribution per phase for
  gesture, size, fill, weight, colour role and place class, mixed 85/15 with uniform. Kev-4B was run with no prior (b = 0), so
  no table informed by another model's outputs enters. On top: authored multipliers (subject type, style), authored role weights (mixed 50/50) and
  the Round 14 L2 code rules as strong preferences (size, weight x2; medium 0.8 by style). T = 0.5 as in the harness.
- **D7 Subject type.** The brief asks for broad subject types; they become a ninth upfront question `subject` (fixed list of
  10) so the share link can carry it without free text. The RuleDirector uses it only in the subject, distance and accents
  phases (gesture multipliers).
- **D8 RuleDirector ignores the grid.** It answers from the look and the phase, not from the 5x5 words, so its decisions
  are identical across skins (the read-back of the Pixel skin is computed from its snapped 64 px grid, so a director that
  reads the grid could decide differently per skin; that is documented in `docs/DIRECTOR.md`).
- **D9 State text.** The L4 short state from the spec, with the progress line worded as the brief asks ("step n of N, now
  painting <phase>") and the prompt in one field `Request (visitor text, at most 80 characters, between « »): «...»`
  with « » and newlines removed from the text.
- **D10 Upfront look.** The look comes from `chooseLook` (upfront questions answered by the Director, top pick). The
  RuleDirector's answers are one-hot from the recipe; the picker can then change any field. Share links carry the look.
- **D11 Skins.** Pixel: the same marks drawn at 192 px (k = 0.32), averaged 3x3 to 64x64, every pixel snapped to the
  nearest of paper + the six role colours (CIELAB), shown with `image-rendering: pixelated` (PNG export 640 px, nearest
  neighbour). Sketch: line gestures stay; solid shapes become outlines (`fill = outline only`); broad washes become light
  level hatching (`horizontal dashes`) because an outline of the whole frame reads as a border; every mark in `ink pen`
  with `precise and controlled` strokes; ink = the shadow role, except accent-role marks, which keep the accent colour.
- **D12 Pacing.** 90 ms between marks so the painting can be watched; 0 with prefers-reduced-motion. The estimate is
  marks x (measured ms per mark on this device + pacing); measured once at load on 4 offscreen marks, then updated after
  each painting.
- **D13 CSP.** `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'
  http://localhost:* http://127.0.0.1:*; object-src 'none'; base-uri 'none'; form-action 'none'`. connect-src allows
  localhost only, so the EndpointDirector works with a server on the visitor's own machine and nothing else
  (`docs/DIRECTOR.md` says how to add a host). `<link rel="icon" href="data:,">` stops the automatic favicon request.
- **D14 Offline.** No service worker (not in the file layout): every module is loaded at start, so a loaded page paints
  with the network off (tested); a reload needs the server (or the browser cache).
- **D15 Share link format.** `#v=1&mo&ha&hu&ke&sa&co&sy&sr&su` (option indices) `&s` seed `&b` marks `&k` skin `&p` pick:
  75 characters. The prompt is never in the link; a link redraws with the RuleDirector, and the page says so when the
  painting was made by an endpoint or by the visitor.
- **D16 Gallery.** localStorage (simpler than IndexedDB; 20 entries x ~4 KB JPEG thumbnails). Entries are re-validated
  on read (whitelisted fields, `data:image/...;base64` thumbnails only), so a tampered entry cannot inject anything.
- **D17 Guard slot.** Fails closed: a guard error, malformed answer or timeout blocks with the same neutral sentence.
  Only consulted after the rule filter passes, so it can only add blocks.
- **D18 Guardrail sets and tuning.** Held-out sets (60 + 60) were committed before policy.js existed. One blind run
  (policy v.4): 0/60 false positives, 2/60 false negatives. Two mechanism bugs were fixed after it (runs of 3+ letters,
  letter-joining swallowing the article "a"); a SECOND held-out set (30 + 30) was then committed and run once (v.6):
  0/30, 1/30 ("ex wife" without a hyphen); that pattern was fixed (v.7). All three sets now pass fully, but only the
  blind numbers above are honest generalisation estimates.
- **D19 Be the director** (removed in v2; called "Be the art director" until v1.1.0). A HumanDirector implements the same interface; each question is a select pre-filled
  with a weighted pick from the RuleDirector (the die re-rolls one; "Let the director choose all" re-rolls all). In this
  mode the state panel shows the state being decided, not the previous one.
- **D20 Colour count (T3).** Distinct colours after quantising each channel to steps of 24 and ignoring colours under
  0.2 % of the pixels (`render.colourCount`), i.e. colours the eye can see, not antialiasing noise.
- **D21 Test browser.** Playwright's npm package is not installed and `playwright install` is not allowed, so
  `tests/lib/cdp.mjs` drives the already-installed Chromium (chrome-headless-shell 1243) over the DevTools protocol with
  node's built-in WebSocket. CPU throttling uses `Emulation.setCPUThrottlingRate` (4x).

## Round 19: this repository

- **R1 Layout.** A new orphan branch `release` with `README.md`, `LICENSE`, `.gitignore`, `web/`, `tests/`, `docs/` and
  `harness/`, copied (not moved) from the Round 17 branch. No research history, experiment outputs, model weights or
  `legacy/` folder.
- **R2 `web/` is the deployed site** (the same bytes, including `vercel.json`) with three differences: `DIRECTOR.md` moved
  to `docs/` (it is documentation, and it names a reference model); the old `web/README.md` was folded into the root
  `README.md`; the Vercel CLI's local `.vercel/` folder and its `.gitignore` are not included. `web/LICENSES.md` stays
  because the About page links to it.
- **R3 Tests.** Kept: the node tests, the headless-browser tests (`tests/browser.mjs`, `tests/lib/`) and the guardrail
  sets with their evaluator. Left out: `tests/render-check.mjs` (it needs research reference files built from model
  traces) and `tests/scan.mjs` (its pattern list contains the very strings the release scan looks for). The About-page
  test checks the credit by its two halves instead of repeating the full line. The renderer's parity with the Python
  twin can be checked with `harness/render_decisions.py` (see the README).
- **R4 Harness spec.** `docs/harness-spec.md` is a release edition: three sentences about two frequency tables that were
  informed by a closed reference model's cached decisions were reworded, those tables are not included, the example
  state from a recorded model run was replaced by a pointer to `docs/DIRECTOR.md`, and paths point to this repository.
- **R5 Harness.** `harness/render.py` and `harness/lists.py` are the frozen Round 12 files, unchanged (authored lists,
  frozen before any model run). `harness/render_portable.py` changed only its import path (its files now sit next to it).
  `render_decisions.py` and `example-decisions.json` (hand-written decisions, not model output) are new.
  `requirements.txt` pins the versions it was tested with.
- **R6 Licence.** MIT, "Copyright (c) 2026 Ivan", because no `LICENSE-CHOICE.txt` exists. Change it before publishing if
  you prefer another licence.
- **R7 Docs licences.** `docs/LICENSES.md` is the repository-level version of `web/LICENSES.md` (same facts, plus the
  repository's own files).
- **R8 Commits** use the existing git author and carry no `Co-Authored-By` lines (the git config sets no trailers).
- **R9 Where the reports live.** `CLEANUP-PLAN.md` and `REPORT-r19.md` are written untracked in `../r17-wt`, not in the
  main working tree (which must stay unchanged) and not in this repository.
- **R10 Phase B** (deletions) was skipped: `../cleanup-approved.txt` does not exist.
- **R11 Screenshots** in `docs/img/` are the site's own paintings from the Round 17 test run (RuleDirector, no model).

## Version 2: two tabs and a browser model

- **V1 Two ways to draw.** Gesture (the existing method) and Probability map (per-cell odds over the six palette roles).
  Each has its own styles: Brush, Sketch, Pixel; Pixel, Impasto. Defaults: Brush and Impasto. "Be the art director"
  was removed.
- **V2 Brush and old links.** Brush is the old Paint marks with the five media reworked (`web/brush.js`). Version 1 Paint
  links are drawn by the unchanged old Paint code, so their pixels stay identical; they open on the Gesture tab with a
  note and keep their v=1 link.
- **V3 Model mode is int8 in a Worker, on WebGPU when it works, else WebAssembly.** No 4-bit build (it changed top
  picks a lot). WebGPU is kept only with a hardware adapter and a passing test question; any failure restarts on
  WebAssembly. WebGPU stays the default although it can answer near-ties differently from WebAssembly (3 of 6 test
  prompts): about 3.4x faster on long prompts, and links never carry model output. The Worker keeps the page
  responsive while the model reads.
- **V4 What the model decides.** Gesture: the six recipe questions, then the colour role of 4 of 30 marks (one or two
  per phase after the backdrop, which is painted on bare paper and has nothing to read), about 50 s more on
  WebAssembly; everything else follows the authored weights. Colour because it depends most on what is already
  painted and has six options; gesture and place can have more than the eight answer letters. Map: one
  colour question per cell of a coarse grid (4x4, 6x6 or 8x8), interpolated bilinearly to the full grid, optionally
  blended 50/50 with the rules; the Map tab's recipe comes from the rules' reading. Every question of
  every mark is not offered (about 20 minutes per painting).
- **V5 The badge is about the painting on screen.** A recipe the model did not choose is painted by the rules and the
  badge says Rules; on the Map tab the rules' map stays (with a Rules badge) until Paint asks the model.
- **V6 The map's cell prompt for the model is short** (prompt length is the cost on WebAssembly). The full state text
  (request, recipe in words, palette, composition, grid size, cell position) is what remote directors and the state
  panel see. Prefix key/value caching was tried and dropped: its logits did not match the full prompt (measured again for the
  mark prompts: about 35% faster, the top colour changed on 3 of 4 marks; it stays behind `prefixCache`, off).
- **V7 Long tasks.** Brush marks run in slices (a generator that yields between blurs, line sets and the composite) and
  Impasto composites in ~30 ms slices between animation frames; pixels do not depend on the slicing.
- **V8 Share links v2** carry tab, style, recipe, seed, and budget and pick (Gesture) or grid, sampling and coarse grid
  (Map); never text or model output; every link opens with the rules.
- **V9 Download and Save** wait for a finished picture (disabled during a run).
- **V10 The page opens on an example.** A plain visit paints "a field of sunflowers at noon" with the rules and its
  automatic seed, unpaced (about 1.4 s), so typing it and pressing Paint gives the same pixels. It writes no link into
  the address bar and sets its own `dataset.example` marker. A painting link shows its own painting and never the
  example; a damaged link shows its notice and the example. The canvas is at the top, with the tabs, scene box, Paint
  and seed right under it; on phones Pause and Next mark sit below the first screen so Paint stays on it.
- **V11 Link preview.** Open Graph and Twitter-card tags with the verified production URL `https://kev-paint.vercel.app/`
  (the Vercel project serving `web/`) and `og-image.jpg`, 1200x630: JPEG because the PNG of the paper texture was
  530 KB.
