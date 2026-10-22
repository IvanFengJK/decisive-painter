// Model mode's worker: loads the vendored transformers.js and Qwen3-0.6B (ONNX, int8) on WebGPU when the browser has a
// hardware adapter that answers a test question correctly, else on WebAssembly, and scores prompts, so the page's main
// thread stays free while the model reads. Started only after the visitor presses Download and enable model.
// Messages in:  { type: "load", prefer: "auto" | "webgpu" | "wasm", prefixCache?, fallback?, adapter? }
//               | { type: "score", id, text, n, prefix? }
// Messages out: { type: "progress", loaded, total, backend } | { type: "ready", info } | { type: "fallback", reason, adapter }
//               | { type: "scores", id, scores, reused } | { type: "error", id?, message }
// A WebGPU attempt that fails says "fallback" and the page starts a fresh worker on WebAssembly (the files then come
// from the Cache API). The worker returns numbers only (the next-token logits of the letters A..); it never returns text.
import { BACKEND_NAME, DTYPES, LIB_PATH, MODEL, ORT_WASM, LETTERS, PREFIX_CACHE, SMOKE, adapterName, friendly, logitsOK,
  planBackends, restAfter, webgpuFailure } from "./model-host.js";

let Lib = null, tokenizer = null, model = null, device = "", letterIds = null;
let reuse = PREFIX_CACHE; // whether a prefix's cache is reused at all (see PREFIX_CACHE)
let pre = null; // the last prefix: { text, ids, cache } (its key/value cache, reused while the prefix stays the same)

async function storageWorks() {
  try {
    await caches.open("decisive-painter-probe");
    await caches.delete("decisive-painter-probe");
    return true;
  } catch {
    return false;
  }
}

/** What this browser offers for WebGPU, without starting anything on it. */
async function probeWebGPU() {
  const gpu = self.navigator?.gpu;
  if (!gpu) return { gpu: false };
  try {
    const a = await gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!a) return { gpu: true, adapter: null };
    const i = a.info || {};
    return { gpu: true, adapter: { vendor: i.vendor || "", architecture: i.architecture || "", description: i.description || "",
      fallback: !!(a.isFallbackAdapter || i.isFallbackAdapter) } };
  } catch (e) {
    return { gpu: true, adapter: null, error: String(e?.message || e) };
  }
}

const files = {};
let stage = "wasm", posted = -1;
const progress = (p) => {
  if (p.status === "progress" && p.total) {
    files[p.file] = { loaded: p.loaded, total: p.total };
    const v = Object.values(files);
    const loaded = v.reduce((a, f) => a + f.loaded, 0), total = v.reduce((a, f) => a + f.total, 0);
    if (loaded - posted < total / 500 && p.loaded < p.total) return; // about 500 messages a download, not one per chunk
    posted = loaded;
    postMessage({ type: "progress", backend: stage, loaded, total });
  }
};

async function library(cache) {
  if (Lib) return Lib;
  try {
    Lib = await import(LIB_PATH);
  } catch (e) {
    throw new Error(`the model library could not be loaded (${friendly(e)})`);
  }
  const { env } = Lib;
  env.allowLocalModels = false;
  env.remotePathTemplate = `{model}/resolve/${MODEL.revision}/`; // every file from the pinned commit
  env.backends.onnx.wasm.wasmPaths = ORT_WASM;
  env.useBrowserCache = cache; // the Cache API keeps the model files for the next visit; off when storage is blocked
  env.useWasmCache = false; // that cache imports the runtime from a blob: URL, which the page's CSP does not allow
  return Lib;
}

async function loadOn(dev) {
  stage = dev;
  model = await Lib.AutoModelForCausalLM.from_pretrained(MODEL.id, { revision: MODEL.revision, dtype: DTYPES[dev],
    device: dev, progress_callback: progress });
  device = dev;
}

async function load({ prefer = "auto", prefixCache = PREFIX_CACHE, fallback = "", adapter = "" }) {
  const t0 = performance.now();
  reuse = !!prefixCache;
  const cache = await storageWorks();
  await library(cache);
  const probe = prefer === "wasm" ? null : { ...(await probeWebGPU()), storage: cache };
  const plan = probe ? planBackends(prefer, probe) : { order: ["wasm"], fallback };
  const name = probe ? adapterName(probe.adapter) : adapter;
  stage = plan.order[0];
  try {
    tokenizer ??= await Lib.AutoTokenizer.from_pretrained(MODEL.id, { revision: MODEL.revision, progress_callback: progress });
  } catch (e) {
    throw new Error(friendly(e));
  }
  const ids = [...LETTERS].map((l) => tokenizer.encode(` ${l}`, { add_special_tokens: false }));
  if (ids.some((t) => t.length !== 1)) throw new Error("the model's tokenizer does not have one token per answer letter");
  letterIds = ids.map((t) => t[0]);
  if (plan.order[0] === "webgpu") {
    let why = "";
    try {
      await loadOn("webgpu");
    } catch (e) {
      why = webgpuFailure(e, "load");
    }
    if (!why) {
      try { // one test question with a known answer: a backend that cannot run some layer gives NaN or nonsense here
        if (!logitsOK((await score(SMOKE.text, SMOKE.n, "")).scores, SMOKE.ref, SMOKE.tol)) why = webgpuFailure(null, "check");
      } catch (e) {
        why = webgpuFailure(e, "check");
      }
    }
    if (why) { // the page starts a fresh worker for WebAssembly, so nothing of this attempt stays in memory
      try { await model?.dispose(); } catch { /* the worker is terminated next anyway */ }
      model = null;
      return { fallback: why, adapter: name };
    }
  } else {
    try {
      await loadOn("wasm");
    } catch (e) {
      throw new Error(friendly(e));
    }
  }
  const bytes = Object.values(files).reduce((a, f) => a + f.total, 0);
  const info = { name: MODEL.name, dtype: DTYPES[device], backend: BACKEND_NAME[device], mb: Math.round(bytes / 1e6),
    loadSeconds: Math.round((performance.now() - t0) / 100) / 10, cached: cache, prefixCache: reuse };
  if (device === "wasm" && plan.fallback) info.fallback = plan.fallback;
  if (name) info.adapter = name;
  return { info };
}

/** The letter logits of the last position. */
function lettersOf(logits, n) {
  const [, len, vocab] = logits.dims;
  const row = logits.data.subarray((len - 1) * vocab, len * vocab);
  return letterIds.slice(0, n).map((id) => Number(row[id]));
}

const ones = (L) => new Lib.Tensor("int64", new BigInt64Array(L).fill(1n), [1, L]);
const ids64 = (a) => new Lib.Tensor("int64", BigInt64Array.from(a, BigInt), [1, a.length]);

/** The key/value cache of a forward pass's outputs (present.* renamed past_key_values.*). */
function cacheOf(out) {
  const c = {};
  for (const k in out) if (k.startsWith("present")) c[k.replace("present", "past_key_values")] = out[k];
  return c;
}

/** Free the outputs that live on the GPU (the key/value cache on WebGPU), except those in `keep`. */
function release(out, keep = null) {
  const kept = new Set(keep ? Object.values(keep) : []);
  for (const t of Object.values(out)) if (t?.location === "gpu-buffer" && !kept.has(t)) t.dispose();
}

/**
 * Next-token letter logits for `text` (always the whole prompt). The `prefix` (a start of `text` shared by many
 * questions) is ignored unless reuse is on (see PREFIX_CACHE); then the prefix is run once and its key/value cache
 * reused, so each question only pays for its own tokens. The cut is checked on the tokens: when the prefix's tokens are
 * not exactly the start of the prompt's (a word or a run of line breaks across the cut), the whole prompt is read
 * instead. A forward pass leaves the cache it is given unchanged (attention writes a new present.* cache, measured on
 * both backends), so one cache serves every question; on WebGPU the caches are GPU buffers and are freed here.
 */
async function score(text, n, prefix) {
  const full = tokenizer.encode(text);
  let rest = null;
  if (reuse && prefix && text.startsWith(prefix)) {
    if (!pre || pre.text !== prefix) {
      if (pre) release(pre.cache);
      pre = null;
      const ids = tokenizer.encode(prefix);
      const out = await model({ input_ids: ids64(ids), attention_mask: ones(ids.length) });
      const cache = cacheOf(out);
      release(out, cache);
      pre = { text: prefix, ids, cache };
    }
    rest = restAfter(full, pre.ids);
  }
  if (!rest) {
    const out = await model({ input_ids: ids64(full), attention_mask: ones(full.length) });
    const scores = lettersOf(out.logits, n);
    release(out);
    return { scores, reused: false };
  }
  const out = await model({ input_ids: ids64(rest), attention_mask: ones(full.length),
    past_key_values: new Lib.DynamicCache({ ...pre.cache }) });
  const scores = lettersOf(out.logits, n);
  release(out, pre.cache);
  return { scores, reused: true };
}

let queue = Promise.resolve(); // one forward pass at a time
self.onmessage = (ev) => {
  const m = ev.data || {};
  if (m.type === "load") {
    load(m).then((r) => postMessage(r.info ? { type: "ready", info: r.info } : { type: "fallback", reason: r.fallback, adapter: r.adapter }),
      (e) => postMessage({ type: "error", message: String(e.message || e) }));
  } else if (m.type === "score") {
    queue = queue.then(() => score(String(m.text), Number(m.n), m.prefix ? String(m.prefix) : ""))
      .then((r) => postMessage({ type: "scores", id: m.id, scores: r.scores, reused: r.reused }), (e) => postMessage({ type: "error", id: m.id, message: friendly(e, "run") }));
  }
};
