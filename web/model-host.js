// Model mode's fixed sources: the vendored library, the onnxruntime-web build it was compiled against, and the pinned
// model; plus the pure helpers the page (model-loader.js) and the worker (model-worker.js) share to pick a backend and
// to check its answers. Nothing here makes a request; node tests import it directly.
export const LIB_VERSION = "4.3.1";
export const LIB_PATH = `./vendor/transformers-${LIB_VERSION}.min.js`;
// the onnxruntime-web build that transformers.js 4.3.1 was compiled against. Its one runtime (the asyncify .mjs and
// .wasm) holds both the WebAssembly and the WebGPU execution providers, so WebGPU fetches no extra files.
export const ORT_WASM = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/";
export const MODEL = {
  id: "onnx-community/Qwen3-0.6B-ONNX",
  revision: "58ca03a5e7b354b480b1a82b34bde8dc7b854cc0",
  name: "Qwen3-0.6B",
  licence: "Apache-2.0",
  dtype: "int8", // 8-bit weights: 4-bit builds changed the top picks too often in our tests
  mb: 650, // model file + tokenizer + runtime, in MB of 10^6 bytes
};
// the weights per backend: the same file on both, so one download serves both and a fallback reads them from the Cache
// API instead of downloading them again (with storage blocked WebGPU is not tried, see planBackends).
// On WebGPU this runtime has no kernels for the int8 layers (MatMulInteger, DynamicQuantizeLinear: 308 of the graph's
// nodes), so those still run on the CPU and the GPU takes the rest (attention, norms, the output layer). Measured on an
// RTX 3080 Ti laptop GPU (tests/webgpu-bench.mjs): a 412-token prompt 5.2 s instead of 17.7 s, a 75-token one 1.4 s
// instead of 1.9 s. The answers are not identical: on near-ties the top letter can differ from WebAssembly's.
export const DTYPES = { webgpu: MODEL.dtype, wasm: MODEL.dtype };
// Reusing a prefix's key/value cache is off unless asked for: the int8 build quantises its activations per forward pass
// (DynamicQuantizeLinear over the whole input), so every token's numbers depend on the other tokens read with it. Reading
// a shared prefix apart then changes the letter logits by several units and sometimes the top letter
// (tests/webgpu-bench.mjs: up to 0.48 in probability), although it is 6 to 8 times faster per question.
// loadModel({ prefixCache: true }) turns it on.
export const PREFIX_CACHE = false;
export const LETTERS = "ABCDEFGH";
export const BACKEND_NAME = { webgpu: "WebGPU", wasm: "WASM" };

/** A short name for a WebGPU adapter from its GPUAdapterInfo-like fields ("" when nothing is known). */
export function adapterName(a) {
  if (!a) return "";
  const s = [a.vendor, a.architecture || a.device, a.description].filter(Boolean).join(" ").trim();
  return `${s || "unknown adapter"}${isSoftware(a) ? " (software)" : ""}`;
}

/** A software WebGPU adapter (SwiftShader, llvmpipe, lavapipe) runs on the CPU, slower than the WebAssembly path. */
export function isSoftware(a) {
  return !!a && (a.fallback === true || /swiftshader|llvmpipe|lavapipe|software/i.test(`${a.vendor} ${a.architecture} ${a.description}`));
}

/**
 * Which backends to try, in order, and the plain reason WebGPU is skipped ("" when it is tried or not wanted).
 * prefer: "auto" | "webgpu" | "wasm". probe: what the worker found, { gpu: navigator.gpu exists, adapter: null |
 * { vendor, architecture, description, fallback }, storage: the Cache API works, error?: string }. "webgpu" also tries
 * a software adapter and blocked storage; every plan ends with WebAssembly, so a WebGPU failure never leaves the visitor
 * without the model. "auto" skips WebGPU when storage is blocked: a failed try would download the model a second time.
 */
export function planBackends(prefer = "auto", probe = {}) {
  if (prefer === "wasm") return { order: ["wasm"], fallback: "" };
  if (!probe.gpu) return { order: ["wasm"], fallback: "this browser has no WebGPU" };
  if (!probe.adapter) return { order: ["wasm"], fallback: "WebGPU found no graphics adapter" };
  if (isSoftware(probe.adapter) && prefer !== "webgpu") return { order: ["wasm"], fallback: "WebGPU here runs in software, which is slower than WebAssembly" };
  if (probe.storage === false && prefer !== "webgpu") return { order: ["wasm"], fallback: "this browser is not letting the page keep the model files, and a failed WebGPU try would download them twice" };
  return { order: ["webgpu", "wasm"], fallback: "" };
}

/** The plain reason a WebGPU attempt was given up (stage: "load" while starting it, "check" for the test question). */
export function webgpuFailure(e, stage = "load") {
  const m = String(e?.message || e || "");
  if (stage === "check") return "WebGPU gave unusable answers to a test question";
  if (/memory|allocation|RangeError|OOM/i.test(m)) return "the graphics card ran out of memory for the model";
  if (/NetworkError|Failed to fetch|ERR_|Content Security/i.test(m)) return "the download was interrupted while trying WebGPU";
  return "the model could not start on WebGPU";
}

/**
 * The test question every WebGPU load answers before it is used, and the letter logits the WebAssembly path gives it
 * (measured with tests/webgpu-bench.mjs on the pinned int8 model). A backend passes when its logits are finite, it picks
 * the same letter and its softmax is within SMOKE.tol of the reference for every letter.
 */
export const SMOKE = {
  text: "Question: What colour is grass?\nA. green\nB. purple\nC. orange\nD. white\nAnswer with one letter.\nAnswer:",
  n: 4,
  ref: [16.8981, 12.3377, 13.8257, 14.114], // softmax 0.89 / 0.01 / 0.04 / 0.06
  tol: 0.15,
};

export function softmax(x) {
  const m = Math.max(...x);
  const e = x.map((v) => Math.exp(v - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

/** Whether a backend's letter logits look usable: all finite, not all equal, and, given a reference, close to it. */
export function logitsOK(x, ref = null, tol = SMOKE.tol) {
  const v = Array.from(x || []);
  if (!v.length || v.some((a) => !Number.isFinite(a))) return false;
  if (Math.max(...v) - Math.min(...v) < 1e-6) return false;
  if (!ref) return true;
  if (ref.length !== v.length) return false;
  const p = softmax(v), q = softmax(ref);
  const top = (a) => a.indexOf(Math.max(...a));
  return top(p) === top(q) && p.every((a, i) => Math.abs(a - q[i]) <= tol);
}

/**
 * The tokens of `full` after those of `prefix`, when the prefix's tokens are exactly the start of the full prompt's
 * (they may not be: a word or a run of line breaks can be one token across the cut); null when they are not, or when
 * nothing would be left to read.
 */
export function restAfter(full, prefix) {
  if (!prefix.length || full.length <= prefix.length) return null;
  for (let i = 0; i < prefix.length; i++) if (full[i] !== prefix[i]) return null;
  return full.slice(prefix.length);
}

/** A plain reason for a failed load or forward pass (never the raw error text). */
export function friendly(e, when = "load") {
  const m = String(e?.message || e || "");
  if (/memory|allocation|RangeError/i.test(m)) return "this device ran out of memory loading the model";
  if (/fetch|network|Failed to load|NetworkError|ERR_|CSP|Content Security/i.test(m)) return "the model files could not be downloaded";
  if (/wasm|WebAssembly|backend|execution provider/i.test(m)) return "this browser cannot run the model (no WebAssembly backend)";
  if (/tokenizer does not have/i.test(m)) return m;
  return when === "run" ? "the model stopped while answering" : "the model could not be loaded";
}
