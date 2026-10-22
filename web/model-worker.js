// Model mode's worker: loads the vendored transformers.js and Qwen3-0.6B (ONNX, int8, WebAssembly) and scores prompts,
// so the page's main thread stays free while the model reads. Started only after the visitor presses Download and enable model.
// Messages in:  { type: "load" } | { type: "score", id, text, n }
// Messages out: { type: "progress", loaded, total } | { type: "ready", info } | { type: "scores", id, scores }
//               | { type: "error", id?, message }
// The worker returns numbers only (the next-token logits of the letters A..); it never returns text.
import { LIB_PATH, MODEL, ORT_WASM, LETTERS, friendly } from "./model-host.js";

let tokenizer = null, model = null, letterIds = null;

async function storageWorks() {
  try {
    await caches.open("decisive-painter-probe");
    await caches.delete("decisive-painter-probe");
    return true;
  } catch {
    return false;
  }
}

async function load() {
  let T;
  try {
    T = await import(LIB_PATH);
  } catch (e) {
    throw new Error(`the model library could not be loaded (${friendly(e)})`);
  }
  const { AutoTokenizer, AutoModelForCausalLM, env } = T;
  env.allowLocalModels = false;
  env.remotePathTemplate = `{model}/resolve/${MODEL.revision}/`; // every file from the pinned commit
  env.backends.onnx.wasm.wasmPaths = ORT_WASM;
  const cache = await storageWorks();
  env.useBrowserCache = cache; // the Cache API keeps the model files for the next visit; off when storage is blocked
  env.useWasmCache = false; // that cache imports the runtime from a blob: URL, which the page's CSP does not allow
  const files = {};
  const progress = (p) => {
    if (p.status === "progress" && p.total) {
      files[p.file] = { loaded: p.loaded, total: p.total };
      const v = Object.values(files);
      postMessage({ type: "progress", loaded: v.reduce((a, f) => a + f.loaded, 0), total: v.reduce((a, f) => a + f.total, 0) });
    }
  };
  const t0 = performance.now();
  try {
    tokenizer = await AutoTokenizer.from_pretrained(MODEL.id, { revision: MODEL.revision, progress_callback: progress });
    model = await AutoModelForCausalLM.from_pretrained(MODEL.id, { revision: MODEL.revision, dtype: MODEL.dtype,
      device: "wasm", progress_callback: progress });
  } catch (e) {
    throw new Error(friendly(e));
  }
  const ids = [...LETTERS].map((l) => tokenizer.encode(` ${l}`, { add_special_tokens: false }));
  if (ids.some((t) => t.length !== 1)) throw new Error("the model's tokenizer does not have one token per answer letter");
  letterIds = ids.map((t) => t[0]);
  const bytes = Object.values(files).reduce((a, f) => a + f.total, 0);
  return { name: MODEL.name, dtype: MODEL.dtype, backend: "WASM", mb: Math.round(bytes / 1e6),
    loadSeconds: Math.round((performance.now() - t0) / 100) / 10, cached: cache };
}

function lettersOf(logits, n) {
  const [, len, vocab] = logits.dims;
  const row = logits.data.subarray((len - 1) * vocab, len * vocab);
  return letterIds.slice(0, n).map((id) => Number(row[id]));
}

/**
 * Next-token letter logits for `text`. With a `prefix` (the part shared by many questions, ending in a line break), the
 * prefix is run once and its key/value cache reused, so each question only pays for its own lines; `text` is then the
 * rest of the prompt. The cache is copied for every question because a forward pass updates the cache it is given.
 */
async function score(text, n, prefix) {
  if (!prefix) return lettersOf((await model(tokenizer(text))).logits, n);
  if (!pre || pre.text !== prefix) {
    const enc = tokenizer(prefix);
    const out = await model(enc);
    pre = { text: prefix, len: enc.input_ids.dims[1], cache: out.past_key_values };
  }
  const s = tokenizer(text, { add_special_tokens: false });
  const L = pre.len + s.input_ids.dims[1];
  const attention_mask = new Lib.Tensor("int64", new BigInt64Array(L).fill(1n), [1, L]);
  const out = await model({ input_ids: s.input_ids, attention_mask, past_key_values: new Lib.DynamicCache({ ...pre.cache }) });
  return lettersOf(out.logits, n);
}

let queue = Promise.resolve(); // one forward pass at a time
self.onmessage = (ev) => {
  const m = ev.data || {};
  if (m.type === "load") {
    load().then((info) => postMessage({ type: "ready", info }), (e) => postMessage({ type: "error", message: String(e.message || e) }));
  } else if (m.type === "score") {
    queue = queue.then(() => score(String(m.text), Number(m.n), m.prefix ? String(m.prefix) : ""))
      .then((scores) => postMessage({ type: "scores", id: m.id, scores }), (e) => postMessage({ type: "error", id: m.id, message: friendly(e, "run") }));
  }
};
