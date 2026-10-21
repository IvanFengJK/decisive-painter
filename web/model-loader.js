// Model mode's loader: runs only after the visitor presses "Load model". It imports the vendored transformers.js,
// downloads Qwen3-0.6B (ONNX) from Hugging Face at a pinned revision, and returns a scorer for ModelDirector.
// Nothing here is imported or fetched before that click, and the visitor's words are never sent: every request is a
// library or model file; the prompt only goes into the model running in this tab.
import { DirectorError } from "./director.js";

export const LIB_VERSION = "4.3.1";
export const LIB_PATH = `./vendor/transformers-${LIB_VERSION}.min.js`;
// the onnxruntime-web build that transformers.js 4.3.1 was compiled against (its WASM runtime is fetched from here)
export const ORT_WASM = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/";
export const MODEL = {
  id: "onnx-community/Qwen3-0.6B-ONNX",
  revision: "58ca03a5e7b354b480b1a82b34bde8dc7b854cc0",
  name: "Qwen3-0.6B",
  licence: "Apache-2.0",
  // dtype per backend and the download it means (model file + tokenizer + runtime), in MB of 10^6 bytes
  webgpu: { dtype: "q4f16", mb: 600 },
  wasm: { dtype: "int8", mb: 650 },
};
export const LETTERS = "ABCDEFGH";

export async function pickBackend() {
  try {
    if (navigator.gpu && (await navigator.gpu.requestAdapter())) return "webgpu";
  } catch { /* no usable WebGPU */ }
  return "wasm";
}

async function storageWorks() {
  try {
    await caches.open("decisive-painter-probe");
    await caches.delete("decisive-painter-probe");
    return true;
  } catch {
    return false;
  }
}

function friendly(e) {
  const m = String(e?.message || e || "");
  if (/memory|allocation|RangeError/i.test(m)) return "this device ran out of memory loading the model";
  if (/fetch|network|Failed to load|NetworkError|ERR_|CSP|Content Security/i.test(m)) return "the model files could not be downloaded";
  if (/wasm|WebAssembly|backend|execution provider/i.test(m)) return "this browser cannot run the model (no WebGPU and no WebAssembly backend)";
  return "the model could not be loaded";
}

/** Load the library and the model; onProgress({ loaded, total }) in bytes. Returns { scorer, info }. */
export async function loadModel({ onProgress = () => {}, backend } = {}) {
  let T;
  try {
    T = await import(LIB_PATH);
  } catch (e) {
    throw new DirectorError(`the model library could not be loaded (${friendly(e)})`);
  }
  const { AutoTokenizer, AutoModelForCausalLM, env } = T;
  env.allowLocalModels = false;
  env.remotePathTemplate = `{model}/resolve/${MODEL.revision}/`; // every file from the pinned commit (the tokenizer ignores `revision`)
  env.backends.onnx.wasm.wasmPaths = ORT_WASM;
  const cache = await storageWorks();
  env.useBrowserCache = cache; // the Cache API keeps the model files for the next visit; off when storage is blocked
  env.useWasmCache = false; // that cache imports the runtime from a blob: URL, which the page's CSP does not allow
  const files = {};
  const progress = (p) => {
    if (p.status === "progress" && p.total) {
      files[p.file] = { loaded: p.loaded, total: p.total };
      const v = Object.values(files);
      onProgress({ loaded: v.reduce((a, f) => a + f.loaded, 0), total: v.reduce((a, f) => a + f.total, 0) });
    }
  };
  const tryLoad = async (be) => {
    const tokenizer = await AutoTokenizer.from_pretrained(MODEL.id, { revision: MODEL.revision, progress_callback: progress });
    const model = await AutoModelForCausalLM.from_pretrained(MODEL.id, { revision: MODEL.revision, dtype: MODEL[be].dtype,
      device: be, progress_callback: progress });
    return { tokenizer, model };
  };
  const t0 = performance.now();
  let be = backend || (await pickBackend());
  let loaded;
  try {
    loaded = await tryLoad(be);
  } catch (e) {
    if (be !== "webgpu") throw new DirectorError(friendly(e));
    be = "wasm"; // WebGPU was there but failed: try the CPU path once
    try {
      loaded = await tryLoad(be);
    } catch (e2) {
      throw new DirectorError(friendly(e2));
    }
  }
  const { tokenizer, model } = loaded;
  const ids = [...LETTERS].map((l) => tokenizer.encode(` ${l}`, { add_special_tokens: false }));
  if (ids.some((t) => t.length !== 1)) throw new DirectorError("the model's tokenizer does not have one token per answer letter");
  const letterIds = ids.map((t) => t[0]);
  const bytes = Object.values(files).reduce((a, f) => a + f.total, 0);
  const scorer = async (text, n) => {
    const inputs = tokenizer(text);
    const out = await model(inputs);
    const [, len, vocab] = out.logits.dims;
    const row = out.logits.data.subarray((len - 1) * vocab, len * vocab);
    return letterIds.slice(0, n).map((id) => Number(row[id]));
  };
  return {
    scorer,
    info: { name: MODEL.name, dtype: MODEL[be].dtype, backend: be === "webgpu" ? "WebGPU" : "WASM", mb: Math.round(bytes / 1e6),
      loadSeconds: Math.round((performance.now() - t0) / 100) / 10, cached: cache },
  };
}
