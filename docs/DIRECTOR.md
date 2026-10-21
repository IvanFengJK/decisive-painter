# Director and Guard contracts

The page is an art-director harness. Before every mark it builds a text **state** and a few typed **questions**; a
**Director** answers each question with probabilities over a fixed option list; code validates the answers, sharpens
them (q ∝ p^(1/T), T = 0.5), picks one option with the seeded RNG and the renderer draws. Swapping the Director changes
the decisions, never the page or the renderer.

## Director

```js
interface Director {
  name: string;                                         // shown in the UI
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

- `RuleDirector` (default): authored recipes + generic words for the look; per mark, phase weights computed from Kev-4B
  traces with authored subject and style multipliers (`director.js`). No AI model.
- `EndpointDirector` (Advanced, off by default): `POST <url>` with JSON `{ "state": "<state.text>", "questions": [...] }`,
  expects `{ "answers": [{ "id": "...", "probs": {...} }] }`. 20 s timeout, no credentials, no referrer. The page's
  CSP allows `connect-src` to the same origin and to `http://localhost:*` / `http://127.0.0.1:*` only; to use a remote
  server, add its origin to the CSP in `index.html`.
- `HumanDirector` ("Be the art director"): the visitor's choices as one-hot answers; the dice ask the RuleDirector.

### Example: a WebGPU model in the browser

```js
// director-webgpu.js (sketch; see the stub there)
export class WebGpuDirector {
  name = "Small model on this device (WebGPU)";
  async init() {
    if (!navigator.gpu) throw new DirectorError("this browser has no WebGPU");
    this.session = await loadModelFromSameOrigin("./model/"); // vendored runtime + weights, same origin
  }
  async decide(state, questions) {
    const h = await this.session.prefill(state.text);          // one pass over the state per mark
    return Promise.all(questions.map(async (q) => ({
      id: q.id,
      probs: await this.session.scoreOptions(h, q.text, q.options ?? ["no", "yes"], q.about),
    })));
  }
}
```

Register it in `app.js` as a third choice under Advanced and import it lazily so other visitors download nothing.

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
