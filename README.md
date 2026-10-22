# Decisive Painter

*Decisions, not diffusion: a painter that picks from menus.*

A free, in-browser painter driven by a **decision-maker**, not a diffusion model. The decision-maker never sees or
makes pixels: it answers typed multiple-choice questions with a probability for every option, and code draws the
answers. Everything runs in the visitor's browser; the site is plain HTML, CSS and ES modules with no build step, no
analytics and no cookies. It is a hobby project for learning how decision-model inference on the edge can drive art.

## In short

Decisive Painter is a browser-based art experiment inspired by Jev-style decision models: a decision-maker answers
structured questions with probabilities, and ordinary code turns those choices into pixels. No diffusion model
generates the image.

- **Gesture** (the main view) builds the painting one mark at a time: the decision-maker reads the scene, chooses a
  recipe, then chooses each mark, and you can inspect the odds for every choice as it works. **Probability map** (the
  second tab) gives colour odds for every cell of a grid at once; the painting is those odds, drawn.
- **Rules** (the default) uses authored decision tables and paints instantly. **Model** is optional: only after you
  press the download button, Qwen3-0.6B (about 650 MB) runs locally in your browser, on WebGPU when available with a
  WebAssembly fallback, and chooses the recipe (and, if you opt in, the colour of a few marks). Your prompt never
  leaves your device.
- Everything renders locally. Share links carry only the recipe, seed and settings, never your words or model output.
- The model never generates pixels directly: it only answers the questions, and the same deterministic renderer draws
  the answers either way.
- The current implementation demonstrates the shape of a Jev-style decision interface; it is not itself a live Jev
  integration, and the Qwen model is not Jev.

Two tabs are two ways to draw with a decision-maker, each with its own styles:

- **Gesture**: the decision-maker picks one mark at a time from menus (gesture, place, size, medium, colour role, fill,
  weight) in five phases, with odds for every choice; code draws the marks. Styles: **Brush** (the five media look
  different: pencil, pen, marker, charcoal, wash), **Sketch** (line only) and **Pixel** (64x64, seven colours).
  10 to 50 marks.
- **Probability map**: the decision-maker gives odds over the six palette roles (dominant, secondary, accent, neutral,
  shadow, highlight) for every cell of a 16x16 to 48x48 grid; the painting is those odds, drawn. Styles: **Pixel** (one
  block per cell, most likely or sampled) and **Impasto** (thick oil paint: strokes along the luminance contours,
  pigments sampled from each cell's odds, relief by uncertainty, lit). Tap or hover a cell to see its odds; "Show
  certainty" draws 1 - normalised entropy.

The decision-maker is a visible **Rules | Model** toggle on both tabs, and the badge always says exactly what decided
the painting on screen:

- **Rules** (default, instant, no download): authored tables. Badge: "Decision-maker: Rules (authored tables)". A plain
  visit opens on an example the rules paint at once ("a field of sunflowers at noon", its automatic seed); a painting
  link shows its own painting instead.
- **Model** (after the visitor presses Download and enable model): **Qwen3-0.6B**, int8, about 650 MB, running in a Worker in
  the tab, on WebGPU when the graphics card can run it and on WebAssembly otherwise; nothing is sent to a server. The
  page says which backend it used and, when it is WebAssembly, why WebGPU was not. Badge: "Decision-maker: Qwen3-0.6B
  (running in your browser)" plus what it decides: on Gesture "recipe: model, marks: authored weights" (the six recipe
  questions). With "Let the model choose the colour of a few marks too" ticked (off by default), it also chooses the
  colour role of one or two marks in each phase after the backdrop, each time reading a short summary of the painting
  so far. The odds cards of those marks are then labelled "model" and the badge says "recipe and the colour of 4 of 30
  marks: model; everything else: authored weights". On the map "Model on a 6x6 grid, interpolated" (one colour question per coarse cell, interpolated to the full grid;
  4x4 and 8x8 too; optionally "..., blended with rules").

## Run it locally

```sh
git clone https://github.com/IvanFengJK/decisive-painter.git
cd decisive-painter/web
python3 -m http.server 8000
# open http://localhost:8000/
```

Any static server works. Opening `index.html` from the file system does not, because browsers do not load ES modules
from `file://` URLs.

## Deploy to Vercel

It is a static project with nothing to build.

- Command line, from the root of a clone of `https://github.com/IvanFengJK/decisive-painter.git`: `vercel link` (once), then `vercel deploy web` (a preview), then
  `vercel deploy web --prod`.
- Dashboard: import the repository `https://github.com/IvanFengJK/decisive-painter.git` and set **Framework preset: Other**, **Build command: empty**, **Output directory:
  `web`** (or set the Root Directory to `web`).

`web/vercel.json` adds a few security headers. The Content-Security-Policy is a `<meta>` tag in the page, so it works
on any static host; it allows scripts and connections only to the page itself, plus huggingface.co (and its file CDN)
and cdn.jsdelivr.net for Model mode, and workers only from the page.

## Tests

Node 22 or newer. From the repository root:

```sh
node --test tests/*.test.mjs          # Director and cell contracts, fields, Impasto checks, guardrails, share links (seconds)
node tests/guard-eval.mjs heldout     # guardrail lists on a test set: dev, heldout or heldout2
node tests/browser.mjs                # headless Chromium: both tabs, every style, determinism, share links, performance,
                                      # network, CSP, accessibility (about 10 minutes without the model,
                                      # about 20 with MODEL_MIRROR set; writes out/). Keep it for release checks.
node tests/browser.mjs quick          # everyday check: first load, determinism and share links (about 4 minutes)
node tests/browser.mjs t0             # one section: t0 t1 t2 t3 t5 t6 t9 model (t0: the startup example, links vs
                                      # the example, phone layout, Tab order, the link preview)
node tests/og-image.mjs               # regenerate web/og-image.jpg (the 1200x630 link preview) from the startup example
node tests/sheet.mjs 8                # contact sheet of 8 scenes x 5 views in Rules mode (out/shots/contact-sheet.png)
```

Linting uses dev-only tools (the site itself still has no dependencies and no build step):

```sh
npm ci && npm run lint                # ESLint over web/ and tests/
uvx ruff check                        # Ruff over harness/ (or: pipx run ruff check)
```

GitHub Actions (`.github/workflows/ci.yml`) runs lint, the node tests, a harness render and `browser.mjs quick` on
every pull request and every push to `main`. There the 100 ms long-task budgets are logged, not enforced
(`PERF_REPORT_ONLY=1`), because shared runners miss them on a cold start; run the browser tests locally for those.
Deploys stay with Vercel's Git integration: a preview for every branch, production for `main`.

Model mode end to end needs the real model. Make a verified local mirror of the pinned files once (about 650 MB; the
page's requests to the model hosts are rerouted to it by the test, unseen by the page), then:

```sh
node tests/model-files.mjs out/model-mirror
MODEL_MIRROR=out/model-mirror node tests/browser.mjs model       # load, Gesture recipe, Map 6x6, cancel, fallback
MODEL_MIRROR=out/model-mirror node tests/model-sheet.mjs         # 4 scenes, Model beside Rules, both tabs
```

`MODEL_LIVE=1` instead of `MODEL_MIRROR` downloads from Hugging Face. `tests/browser.mjs` drives an installed Chromium
over the DevTools protocol, with no npm packages; set `CHROME=/path/to/chrome` to choose one.

The Python reference renderer that the Gesture renderer was ported from is in `harness/`:

```sh
pip install -r harness/requirements.txt
python harness/render_decisions.py harness/example-decisions.json example.png            # portable RNG, like the site
python harness/render_decisions.py harness/example-decisions.json frozen.png --frozen   # the original renderer
```

## Decisions, not diffusion

A **typed-question decision model** reads a short text and answers questions of three kinds: *choice* (one option from
a list), *yes/no*, and *score* (a level on a scale), with a probability for every option. Code then picks from those
odds and draws. A diffusion model generates the pixels of an image; here **no pixels are generated by a model**. Every
decision is small, named and checkable, and any painting can be replayed exactly from its choices, which is what share
links and Replay do.

## How it works

- `web/director.js`: the Director interface (`name`, `init()`, `decide(state, questions)` -> answers with
  probabilities), answer validation, the Gesture harness loop, the RuleDirector, the optional EndpointDirector (your own
  server, Gesture tab, under Advanced) and the exact badge text. Contracts: [docs/DIRECTOR.md](docs/DIRECTOR.md).
- `web/field.js`: the Probability map. The cell question contract (`cell:x,y`, six role options, a batched
  `decide()`), the rules field (region tables on the composition's named places, soft edges, a vertical light
  gradient, seeded value noise, a subject blob; every cell sums to 1), the model field (coarse answers, bilinear
  interpolation in probability space, optional blend, validity checks) and Pixel.
- `web/impasto.js`: Impasto from a field (pure JavaScript on typed arrays, seeded; a cheap preview first, the full
  composite in slices between animation frames, a 0.5 s fade, none with reduced motion).
- `web/render.js`, `web/brush.js`, `web/styles.js`: the Gesture renderer, the Brush media, Sketch and Pixel, and the old
  Paint code kept so `v=1` Paint links keep their exact pixels.
- `web/model-director.js`, `web/model-loader.js`, `web/model-worker.js`, `web/model-host.js`: Model mode. The model
  scores the lettered options from the next-token probabilities, both option orders averaged, no option above 0.85; it
  runs in a Worker so the page stays responsive. The worker tries WebGPU first (a hardware adapter, the session starts,
  a fixed test question gets the expected answer) and otherwise starts again on WebAssembly with the files from the
  cache.
- The page's link preview: Open Graph and Twitter-card tags in `web/index.html` with the canonical URL
  `https://kev-paint.vercel.app/` and `web/og-image.jpg` (1200x630), made from the startup example by `tests/og-image.mjs`.
- `web/recipes.js`, `web/state.js`: about 60 authored scene recipes, generic words, and the state text with the
  visitor's words in one delimited field.
- Share links (`web/share.js`): version 2 carries the tab, style, recipe (as option numbers), seed, and the budget or
  the grid size, sampling mode and coarse grid; never text or model output. Every link opens with the rules. Version 1
  links open on the Gesture tab with identical pixels.
- Choices and their reasons: [docs/DECISIONS.md](docs/DECISIONS.md). How the project got here:
  [docs/HISTORY.md](docs/HISTORY.md).

## Guardrails

The text box accepts short scene descriptions only.

- **L0, hygiene:** Unicode normalisation, invisible and direction characters removed, no markup, at most 80 characters.
- **L1, policy lists:** sexual content, minors, violence, hate, self-harm and private people, matched across look-alike
  letters, leetspeak, spaced-out letters and repeats.
- **L2:** one neutral message for every block.
- **L3:** a slot for a guard model. It can only add blocks and fails closed. It is off on the live page.
- **L4:** the text reaches the Director only as one delimited field.
- **L5:** clamped numbers and debounced buttons.

Measured blind on two fresh held-out sets (each committed before it was run): **0% false positives** (no benign prompt
blocked: 0 of 60 and 0 of 30) and **about 3% false negatives** (2 of 60 and 1 of 30 harmful prompts missed). Those
misses were fixed afterwards, so every set now passes, but that is not a new measurement: the blind figures above are the
honest estimate. The wordlist is not perfect. Nothing typed leaves the page unless the visitor turns on "My own
endpoint" under Advanced, which shows a warning. The guardrails run before any decision-maker, so a refused text
never reaches the model.

## Limits

- The paintings are abstract by design: colour fields, bands and marks arranged like a scene, not recognisable objects.
- About 60 scenes are authored. Other text falls back to generic words and a hashed look.
- Model mode is a general 0.6B model scoring options, not a trained decision model. Earlier tests found small models
  drift towards austere, mid-value, near-monochrome palettes, and a no-model control beat a 0.6B model; expect the rules
  to look better. Per-cell colour is the hardest job for it: maps from the model are rough.
- Model mode is slow on WebAssembly: about 40 s for the recipe, about 50 s more with the mark colours ticked and
  several minutes for a 6x6 map on a desktop CPU. The model's mark colours usually look worse than the rules' (it almost
  never picks the dominant colour), which is why they are opt-in. Cancel stops between questions: the question the
  model is reading still finishes in its worker (up to about 6 s on WebAssembly), and the next painting waits for it. Only the int8 build is used; 4-bit builds changed the top picks too often.
- WebGPU helps less than it could: the WebGPU runtime has no kernels for the int8 build's quantised matrix products, so
  those still run on the CPU. Measured on one laptop (RTX 3080 Ti, Windows Chrome), a 412-token prompt took 5.2 s on
  WebGPU against 17.7 s on WebAssembly, and a 75-token recipe question 1.4 s against 1.9 s; loading took about 1.7 s
  longer (the test question). Other GPUs are not measured. With storage blocked (some private windows) WebGPU is not
  tried, because a failed try would download the model a second time. If WebGPU fails after loading, that question
  fails (the rules take over for the painting) and the model moves to WebAssembly for the next one. Headless Chromium under WSL2 only offers a software adapter,
  which the page does not use, so the browser tests exercise the WebAssembly fallback.
- WebGPU and WebAssembly can answer near-ties differently (a different top option on 3 of 6 test prompts), so the same
  words and seed can give another recipe on another device. Share links never carry model output, so links are not
  affected.
- A word list is never perfect: it will miss some harmful phrasings and may block an odd harmless one.
- Determinism was tested in Chromium and node only; Impasto uses floating-point maths per pixel, so other engines may
  differ slightly.

## Credit

- Gesture-level decisions: inspired by danmana/jev-paints (github.com/danmana/jev-paints).
- Per-cell colour probabilities and the impasto look: inspired by achimala/jev-paint (github.com/achimala/jev-paint).

This project uses the ideas only: no code, lists or wording from either.

## Licence

MIT, see [LICENSE](LICENSE). Sources and licences of everything included or loaded: [docs/LICENSES.md](docs/LICENSES.md).
