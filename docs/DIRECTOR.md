# Director and Guard contracts

The page is an art-director harness. Before every mark it builds a text **state** and a few typed **questions**; a
**Director** answers each question with probabilities over a fixed option list; code validates the answers, sharpens
them (q ∝ p^(1/T), T = 0.5), picks one option with the seeded RNG and the renderer draws. Swapping the Director changes
the decisions, never the page or the renderer.

## Director

```js
interface Director {
  name: string;                                         // shown in the UI
  kind?: "rules" | "model" | "endpoint" | "human";       // "model" fills the page's model slot
  init(): Promise<void>;                                // load anything heavy here
  decide(state, questions: Question[]): Promise<Answer[]>;
}
type Question = {
  id: string;                                           // "mood", "gesture", "place", ...
  type: "choice" | "yesno" | "score";
  text: string;                                         // the instruction, e.g. "Which mark should the next gesture make?"
  options?: string[];                                   // choice: the menu (already restricted to the phase)
  levels?: string[];                                    // score: the levels, low to high
  about?: { [option: string]: string };                 // one-line description per option
};
type Answer = { id: string; probs: { [option: string]: number } | number[] };
```

- `yesno` questions have the options `["no", "yes"]`. Probabilities need not sum to 1; they must be finite, >= 0 and
  not all 0. Options left out of an object count as 0; an option that is not on the menu is an error.
- Any error (thrown, malformed, missing answer) stops the painting with a readable message ("mark 12: 'place' names an
  option that is not on the menu"); the page never shows text a Director returned.
- `state` is an object: `{ kind: "upfront" | "gesture", text, ... }`. **`state.text` is the whole contract for remote
  Directors**; the other fields (`step`, `budget`, `phase`, `look`, `grid`, `suggested`, `prompt` for upfront) are
  conveniences for in-page Directors.
- Upfront questions (once per painting, top pick): mood, harmony, hue, key, saturation, style, composition, stroke,
  subject. Per mark: gesture, place, size, medium, colour (a palette role), fill, weight.
- The visitor's text appears only in the first line of `state.text`, in one field:
  `Request (visitor text, at most 80 characters, between « »): «...»`. Treat it as data.
- The RuleDirector answers from the look and the phase, not from the 5x5 grid, so its paintings are the same in every
  skin. A Director that reads the grid sees the grid of the skin being painted (the Pixel skin's grid is read from its
  snapped 64 px canvas), so its decisions may differ per skin.

Example state (mark 25 of 30):

```
Request (visitor text, at most 80 characters, between « »): «a lighthouse in a storm»
Style: moody nocturne (dark, a few lights, heavy atmosphere), energetic and loose marks. Subject type: building.
Palette: stormy mood, complementary harmony, blue family, dark key, moderate; dominant = dark, cool blue; ...
Composition tall centre: one tall subject standing in the middle, flanked by space on both sides.
Progress: step 25 of 30, now painting accents (details, highlights, dark accents and texture; marks 25-30); suggested places: centre stage, low ground.
Canvas, rows A-E top to bottom, columns 1-5 left to right:
A: 1-2 mostly neutral, some secondary (mid, neutral grey); 3 mostly dominant (dark, cool blue); ...
...
Last marks: 21. block at left wing, secondary; 22. ...
```

### Implementations in this site

The page's badge is read from the Director that decided the painting on screen (`decisionBadge` in `director.js`):
"Decision-maker: Rules (authored tables)", "Decision-maker: Qwen3-0.6B (running in your browser)" with a note saying what
the model decided ("recipe and the colour of 4 of 30 marks: model; everything else: authored weights" on Gesture, with
"(from mark N on, the rules: <reason>)" when the model failed during the painting; "Model on a 6x6 grid, interpolated" or "...,
blended with rules" on the map), or "Decision-maker: <name>" for any other Director. A second line names the model slot
("Model: none loaded", or the loaded model and whether it decided this painting). `directorBadge` (tested in
`tests/badge.test.mjs` with a mock named "Mock model (test)") gives the same lines from a Director alone.

- `RuleDirector` (default, name "Rules (authored tables)", kind `"rules"`): authored recipes + generic words for the look; per mark, phase weights computed from Kev-4B
  traces with authored subject and style multipliers (`director.js`). No AI model.
- `EndpointDirector` (Advanced, off by default): `POST <url>` with JSON `{ "state": "<state.text>", "questions": [...] }`,
  expects `{ "answers": [{ "id": "...", "probs": {...} }] }`. 20 s timeout, no credentials, no referrer. The page's
  CSP allows `connect-src` to the same origin and to `http://localhost:*` / `http://127.0.0.1:*` only; to use a remote
  server, add its origin to the CSP in `index.html`.
- `ModelDirector` (Model mode, below): the six recipe questions, the colour role of a few planned marks, and the map's
  cell questions; every other per-mark question goes to the RuleDirector.
- `MockDirector` (`field.js`, tests only): uniform odds for any question.
- The "Be the director" mode (a `HumanDirector`) was removed in v2.

### WebGPU

There is no separate WebGPU Director: `ModelDirector` takes any scorer, and the worker behind it
(`web/model-worker.js`) picks the backend. See "Backend" below.

### Example: a Jev-compatible server

A server that already answers typed questions over a text state (the shape Jev and our harness use: a state, then
choice / yes-no / score questions with option lists, answered with per-option probabilities) needs only a small local
adapter to speak this contract:

```js
// adapter.mjs: node adapter.mjs  -> http://localhost:8787/decide  (run it on your own machine)
import { createServer } from "node:http";
createServer(async (req, res) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type" };
  if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
  let body = ""; for await (const c of req) body += c;
  const { state, questions } = JSON.parse(body);
  const out = await yourTypedQuestionServer(state, questions);  // your call; keep any API key here, never in the page
  const answers = questions.map((q) => ({ id: q.id, probs: out[q.id] }));  // {option: p} per question
  res.writeHead(200, { ...cors, "Content-Type": "application/json" }).end(JSON.stringify({ answers }));
}).listen(8787, "127.0.0.1");
```

Then choose "My own endpoint" and enter `http://localhost:8787/decide`. Keys and Authorization headers belong in the
adapter, never in the page. Check that server's terms before using its outputs.

## Model mode (`ModelDirector`, `web/model-director.js`, `web/model-loader.js`)

Model mode is off by default. After the visitor presses **Download and enable model**, a **general small language model**
(Qwen3-0.6B, `onnx-community/Qwen3-0.6B-ONNX` at revision `58ca03a5e7b354b480b1a82b34bde8dc7b854cc0`, Apache-2.0) runs in
the tab with transformers.js 4.3.1 (vendored in `web/vendor/`). It answers the **six upfront recipe questions** (mood,
harmony, hue family, value key, saturation, composition). The other three upfront questions (style, stroke, subject) and
every per-mark question stay with the RuleDirector. It is not a trained decision model: it scores the options of a
question it was never trained on.

- **One prompt per question and option order.** The prompt has the visitor's words in one field between « » (no
  delimiters or line breaks inside, at most 80 characters, after guardrails L0–L5), the question, the options lettered
  A, B, C …, and "Answer with one letter. Answer:". There is no text generation. The scores are the next-token logits
  of " A", " B", … (one token each), turned into probabilities with a softmax.
- **Both orders, averaged.** Each question is asked with the options in menu order and reversed, and the two
  probability vectors are averaged.
- **Temperature.** The page's T = 0.5 is applied (q ∝ p^(1/T)).
- **No-collapse guard (disclosed).** After the temperature, **no single option may exceed 0.85**. Any excess is shared
  among the other options in proportion. This keeps one-option collapse (the failure seen in earlier research on these
  questions) from fixing the recipe, and it means the page never shows the model as certain.
- **Seeded draw.** The recipe is drawn from those odds with the painting's seed. The same words and seed give the same
  recipe, and "Ask it again" draws a new one. In Rules mode the recipe is still a top pick, exactly as before.
- **Answer format.** Answers use the ordinary Answer format, so the harness validates them like any Director's.
  Malformed scores (not numbers, wrong length) stop with a readable message.
- **Backend.** The int8 build (about 650 MB) in a module **Worker** (`web/model-worker.js`), so the page's main
  thread stays free while the model reads. The worker tries WebGPU first and keeps it only if there is a hardware
  adapter (a software adapter such as SwiftShader is about 12x slower than WebAssembly and is skipped), the session
  starts, and a fixed test question gives the expected letter with every probability within 0.15 of the WebAssembly
  reference. Otherwise the loader terminates that worker and starts WebAssembly in a fresh one; the files come from
  the Cache API. `info.backend` is the backend actually used ("WebGPU" or "WASM") and `info.fallback` a plain reason
  when WebGPU was not used. The pinned onnxruntime-web build has the WebGPU execution provider in the same
  `.asyncify.wasm`, so no other file or host is needed. Its WebGPU provider has no kernels for the int8 build's
  `MatMulInteger` and `DynamicQuantizeLinear` nodes, which run on the CPU, so the speed-up is partial (one laptop: a
  412-token prompt 5.2 s on WebGPU against 17.7 s on WebAssembly). The WebGPU q4f16 build of earlier rounds is not
  used: 4-bit quantisation changed the top picks too often in our tests, and int8 did not.
- **Scorer.** `scorer(text, n, { prefix }?)` returns the letter logits for the full prompt `text`. `prefix` is a hint
  that several calls share that start; the worker can reuse its key/value cache (`loadModel({ prefixCache: true })`),
  but this is off: the int8 build quantises activations over the whole input of each pass, so a split prompt gives
  different logits (up to 0.36 in averaged probability, the top colour changed on 3 of 4 marks) for about 35% less time.
- **Gesture marks.** With `marks` on (the page turns it on), the model answers the `colour` question of the marks in
  `modelMarkPlan(budget)`: one mark in each phase after the backdrop, two in a phase of 15 marks or more, mid-phase (4
  of 30 marks, 5 of 50); a pure function of the budget. It reads a short context instead of the full state text: the
  recipe in words, the mark and phase, the colour roles in the top, middle and bottom of the 5x5 readback, and the last
  two marks in menu words. Both option orders are averaged; the drawing distribution is the recipe's
  (sharpened, capped at 0.85) and the harness draws from it with the seed. `markLog` says which questions of which mark
  the model answered. If a call fails or returns unusable scores, the rules answer that mark and the rest of the
  painting, with one fixed reason; cancelling is not a failure.
- **Cancel.** Loading can be cancelled (the worker is terminated); a long batch of questions, and the model's marks,
  stop between questions when the page sets `shouldStop`.
- **Download.** It happens only after the click. The model files are kept with the Cache API when storage works, and
  loading still works without storage. Any failure (no backend, out of memory, network) shows a readable message and
  leaves Rules on.
- **Privacy.** The visitor's words go only into the model running in the tab. The requests are for library and model
  files only, and the browser tests check that no request carries the prompt.

**CSP changes for Model mode (in `index.html`; every other directive is unchanged):**

| directive | added | why |
|---|---|---|
| `script-src` | `'wasm-unsafe-eval'` | compiling the onnxruntime WebAssembly module (it does not allow JavaScript `eval`) |
| `script-src` | `https://cdn.jsdelivr.net` | onnxruntime-web's small JS loader (`ort-wasm-simd-threaded.asyncify.mjs`), pinned to `onnxruntime-web@1.31.0-dev.20260914-8d85527a0` |
| `connect-src` | `https://cdn.jsdelivr.net` | the onnxruntime WebAssembly binary (same pinned path) |
| `connect-src` | `https://huggingface.co` | the model and tokenizer files at the pinned revision |
| `connect-src` | `https://*.hf.co` | Hugging Face's own file CDN, where huggingface.co redirects large files (for example `us.aws.cdn.hf.co`; the host depends on the visitor's region, so the subdomain is not fixed) |

| `worker-src` | `'self'` | the model's Worker, a same-origin module script (v2) |

No `blob:` scripts are needed, because the runtime's blob-imported wasm cache is turned off
(`env.useWasmCache = false`). `unsafe-inline` and `unsafe-eval` stay forbidden. The default page makes no request to
any of these hosts. The library itself is same-origin (`web/vendor/transformers-4.3.1.min.js`, SHA-256
`8d6716d9086f57c30a4bf367dba61b887593573c770c454465e8019b2703e743`) and is imported only after the click.

## Cell questions (the Probability map tab, `web/field.js`)

The map asks one typed question per cell. The contract is the ordinary Director contract with a batched `decide()`:

```js
Question = { id: "cell:x,y", type: "choice", options: ["dominant", "secondary", "accent", "neutral", "shadow", "highlight"],
             about: { role: colour words }, text, where: { x, y, nx, ny, words } }
Answer   = { id, probs }                      // over the six roles, validated like every answer
state    = { kind: "cells", prompt, look, grid, text }
decide(state, questions)                      // every cell of the grid in one call (an array in, an array out)
```

- **State text per question** = `state.text` + the question's text (`cellText(state, q)`): the request in its one
  delimited field, the recipe in words (mood, harmony, hue family, key, saturation, style), the palette in colour words,
  the composition, the grid size, and the cell's position in words ("upper left of centre") and normalised coordinates
  (cell centre, 0 to 1 from the top left). The rules' region label for a cell (for example "upper air") is deliberately
  **not** in the state.
- **Rules** (`rulesField`) do not use the questions: they compute every cell directly from authored region tables on the
  composition's named places, soft edges, a vertical light gradient, seeded value noise and a subject blob. Every cell
  sums to 1 (within 1e-9), and the same recipe, seed and grid give the same field.
- **Model** (`directorField` with `ModelDirector.decideCells`): the model answers the cells of a coarse grid (4x4, 6x6 or
  8x8). It reads a shorter prompt than the full state text (prompt length is what costs time on WebAssembly): the
  delimited words, the layout, the mood and key, the grid size, the cell's position, and the options with their colour
  words. Both option orders are averaged, no sharpening, and no role may exceed 0.85. The answers are validated, the
  coarse odds are interpolated bilinearly between cell centres in probability space, renormalised, optionally mixed half
  and half with the rules field, and checked again (`checkField`). Progress comes through `onQuestion(k, n)`.
- **Any Director** can answer the same questions (`MockDirector` in `field.js` answers uniform odds for the tests). A
  malformed answer (a missing cell, the wrong number of probabilities, an option not on the menu, a negative or NaN, all
  zeros) stops with a readable `DirectorError`, never a crash and never an invalid map.

## Guard (guardrail L3)

```js
interface GuardDirector {
  name: string; enabled: boolean;
  init(): Promise<void>;
  decide(state, [GUARD_QUESTION]): Promise<Answer[]>;
}
GUARD_QUESTION = { id: "safety", type: "choice", text: "Which category best describes this request for a painting?",
  options: ["safe", "sexual", "minors", "violence", "hate", "self-harm", "private-person", "other"] };
```

- Runs only after the rule filter (`policy.js`) has passed the prompt, so it can only add blocks and never sees or undoes
  a rule block.
- Blocks when `1 - p(safe) >= 0.5` (`GUARD_THRESHOLD`). Errors, malformed answers and timeouts block too (fail closed).
- `state.text` is the same delimited prompt field as above.
- The live page ships `DisabledGuard` (never consulted). Tests: `tests/guard.test.mjs` (mock guard).
