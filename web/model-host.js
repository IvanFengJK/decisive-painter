// Model mode's fixed sources: the vendored library, the onnxruntime-web build it was compiled against, and the pinned
// model. Shared by the page (model-loader.js) and the worker (model-worker.js); nothing here makes a request.
export const LIB_VERSION = "4.3.1";
export const LIB_PATH = `./vendor/transformers-${LIB_VERSION}.min.js`;
// the onnxruntime-web build that transformers.js 4.3.1 was compiled against (its WASM runtime is fetched from here)
export const ORT_WASM = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/";
export const MODEL = {
  id: "onnx-community/Qwen3-0.6B-ONNX",
  revision: "58ca03a5e7b354b480b1a82b34bde8dc7b854cc0",
  name: "Qwen3-0.6B",
  licence: "Apache-2.0",
  dtype: "int8", // 8-bit weights on WebAssembly: 4-bit builds changed the top picks too often in our tests
  mb: 650, // model file + tokenizer + runtime, in MB of 10^6 bytes
};
export const LETTERS = "ABCDEFGH";

/** A plain reason for a failed load or forward pass (never the raw error text). */
export function friendly(e, when = "load") {
  const m = String(e?.message || e || "");
  if (/memory|allocation|RangeError/i.test(m)) return "this device ran out of memory loading the model";
  if (/fetch|network|Failed to load|NetworkError|ERR_|CSP|Content Security/i.test(m)) return "the model files could not be downloaded";
  if (/wasm|WebAssembly|backend|execution provider/i.test(m)) return "this browser cannot run the model (no WebAssembly backend)";
  if (/tokenizer does not have/i.test(m)) return m;
  return when === "run" ? "the model stopped while answering" : "the model could not be loaded";
}
