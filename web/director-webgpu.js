// STUB: where a browser model (WebGPU) plugs in. Nothing here runs a model; the page never imports this file.
// It documents the shape of a WebGpuDirector so one can be dropped in without changing the page or the renderer.
//
// A WebGpuDirector implements the same interface as RuleDirector (see director.js and DIRECTOR.md):
//
//   class WebGpuDirector {
//     name = "My browser model (WebGPU)";
//     async init() {
//       // 1. check navigator.gpu; if absent, throw new DirectorError("this browser has no WebGPU")
//       // 2. load the weights and tokenizer from the SAME ORIGIN (default-src 'self' in the page's CSP; a model on
//       //    another host needs that host added to connect-src). Show progress; cache with the Cache API.
//       // 3. create the inference session (for example onnxruntime-web with the WebGPU execution provider, vendored
//       //    into web/ because the page loads no third-party scripts).
//     }
//     async decide(state, questions) {
//       // state.text is the whole state (5x5 canvas words, palette words, progress, last marks; the visitor's prompt is
//       // the one «delimited» field). For each question, score each option in questions[i].options (or 'no'/'yes' for
//       // yesno, questions[i].levels for score) and return [{id, probs}]. The harness validates every answer, applies
//       // the temperature and picks with the seeded RNG, so the model never writes free text into the page.
//       return questions.map((q) => ({ id: q.id, probs: q.options.map(() => 1) }));
//     }
//   }
//
// To enable it: export it from this file, add an option to the Director picker in app.js (Advanced), and import it
// there lazily (await import("./director-webgpu.js")) so visitors who never choose it download nothing.
// Round 15's recorded plan for a Kev-0.6B-sized model (prefill once per mark, one branch row per question, a pointer
// head in JS, int8 weights of about 600 MB) is in experiments/r15/out/package/browser-route.md.
export const WEBGPU_DIRECTOR_AVAILABLE = false;
