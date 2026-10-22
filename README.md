# Decisive Painter

*Decisions, not diffusion: a painter that picks from menus.*

A free, in-browser painter driven by a **decision-maker**, not a diffusion model. The decision-maker never sees or
makes pixels: it answers typed multiple-choice questions with a probability for every option, and code draws the
answers. Everything runs in the visitor's browser; the site is plain HTML, CSS and ES modules with no build step, no
analytics and no cookies. It is a hobby project for learning how decision-model inference on the edge can drive art.

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

- **Rules** (default, instant, no download): authored tables. Badge: "Decision-maker: Rules (authored tables)".
- **Model** (after the visitor presses Load model): **Qwen3-0.6B**, int8, about 650 MB, running in a Worker on
  WebAssembly in the tab; nothing is sent to a server. Badge: "Decision-maker: Qwen3-0.6B (running in your browser)"
  plus what it decides: on Gesture "recipe: model, marks: authored weights" (the six recipe questions, about 40 s); on
  the map "Model on a 6x6 grid, interpolated" (one colour question per coarse cell, interpolated to the full grid;
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
node tests/browser.mjs quick          # everyday check: determinism and share links only (about 3 minutes)
node tests/browser.mjs t1             # one section: t1 t2 t3 t5 t6 t9 model
node tests/sheet.mjs 8                # contact sheet of 8 scenes x 5 views in Rules mode (out/shots/contact-sheet.png)
```

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
  runs in a Worker so the page stays responsive.
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
- Model mode is slow on WebAssembly: about 40 s for the recipe and several minutes for a 6x6 map on a desktop CPU
  (measured numbers are in the round report). Only the int8 build is used; 4-bit builds changed the top picks too often.
- A word list is never perfect: it will miss some harmful phrasings and may block an odd harmless one.
- Determinism was tested in Chromium and node only; Impasto uses floating-point maths per pixel, so other engines may
  differ slightly.

## Credit

- Gesture-level decisions: inspired by danmana/jev-paints (github.com/danmana/jev-paints).
- Per-cell colour probabilities and the impasto look: inspired by achimala/jev-paint (github.com/achimala/jev-paint).

This project uses the ideas only: no code, lists or wording from either.

## Licence

MIT, see [LICENSE](LICENSE). Sources and licences of everything included or loaded: [docs/LICENSES.md](docs/LICENSES.md).
