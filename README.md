# Art Director

Type a scene, such as "a lighthouse in a storm", and watch it painted mark by mark. Before every mark an "art director"
harness writes a short text state (the request, the look, the progress, a 5x5 grid of words read back from the real
pixels) and asks a **Director** a few typed questions: which mark, where, which colour, how heavy. A seeded renderer
then draws the answer. The live Director is **rules plus authored recipes: there is no AI model inside**, and the
paintings are abstract and scene-like, not pictures of the thing. The Director is a small interface, so a model
(for example a WebGPU model in the browser, or your own server) can be plugged in without changing the page or the
renderer. The page is plain HTML, CSS and ES modules, about 160 KB, with no build step, no third-party scripts, no
analytics and no cookies.

![The Paint skin in the light theme: "a lighthouse in a storm" in 30 marks](docs/img/paint-desktop-light.png)

![The Pixel skin in the dark theme: the same scene, snapped to a 64x64 palette grid](docs/img/pixel-desktop-dark.png)

## Run it locally

```sh
cd web
python3 -m http.server 8000
# open http://localhost:8000/
```

Any static server works. Opening `index.html` from the file system does not, because browsers do not load ES modules
from `file://` URLs.

## Deploy to Vercel

It is a static project with nothing to build.

- Command line, from the repository root: `vercel deploy web` (a preview), then `vercel deploy web --prod`.
- Dashboard: import the repository and set **Framework preset: Other**, **Build command: empty**, **Output directory:
  `web`** (or set the Root Directory to `web`).

`web/vercel.json` adds a few security headers. The Content-Security-Policy is a `<meta>` tag in the page, so it works
on any static host.

## Tests

Node 22 or newer. From the repository root:

```sh
node --test tests/*.test.mjs          # Director contract, guardrails, share links, determinism (node only, seconds)
node tests/guard-eval.mjs heldout     # guardrail lists on a test set: dev, heldout or heldout2
node tests/browser.mjs                # headless Chromium: screenshots, layout, determinism, share links, network,
                                      # CSP, offline, speed, accessibility (about 5 minutes; writes out/)
```

`tests/browser.mjs` drives an installed Chromium over the DevTools protocol, with no npm packages. It looks in the
Playwright browser cache; set `CHROME=/path/to/chrome` to use another Chromium.

The Python reference renderer that the site's renderer was ported from is in `harness/`:

```sh
pip install -r harness/requirements.txt
python harness/render_decisions.py harness/example-decisions.json example.png            # portable RNG, like the site
python harness/render_decisions.py harness/example-decisions.json frozen.png --frozen   # the original renderer
```

## How it works

- `web/director.js`: the Director interface, answer validation, the harness loop and the RuleDirector. Contracts and
  examples are in [docs/DIRECTOR.md](docs/DIRECTOR.md); the harness is specified in
  [docs/harness-spec.md](docs/harness-spec.md).
- `web/recipes.js`: about 60 authored scene recipes and a parser for generic words. An unknown scene gets an honest
  message and a look picked from a hash of the text, which the visitor can change.
- `web/render.js`: a software rasteriser, so the same scene, seed, marks and skin give the same pixels in every browser.
  Share links carry only option numbers (no text).
- Three skins: Paint, Pixel and Sketch. "Be the art director" mode lets the visitor answer the questions.
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

On two blind held-out sets, written and committed before the lists were tuned, the lists blocked no benign prompt
(0 of 60 and 0 of 30). They missed 2 of 60 and 1 of 30 harmful ones, and those misses were fixed afterwards. Those
blind numbers are the honest estimate. Nothing typed leaves the page unless the visitor turns on "My own endpoint" under
Advanced, which shows a warning.

## Limits

- The paintings are abstract: colour fields, bands and marks arranged like a scene, not recognisable objects.
- About 60 scenes are authored. Other text falls back to generic words and a hashed look.
- A word list is never perfect: it will miss some harmful phrasings and may block an odd harmless one.
- Determinism was tested in Chromium and node only.

## Credit

Inspired by danmana/jev-paints (github.com/danmana/jev-paints). This project uses the idea only, none of its code or
lists.

## Licence

MIT, see [LICENSE](LICENSE). Sources and licences of everything included: [docs/LICENSES.md](docs/LICENSES.md).
