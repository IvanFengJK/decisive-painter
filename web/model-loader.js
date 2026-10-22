// Model mode's loader, on the page's side: runs only after the visitor presses "Download and enable model". It starts a module Worker
// (model-worker.js) that downloads and runs Qwen3-0.6B, on WebGPU when that works here, else on WebAssembly, and returns
// a scorer that sends one prompt at a time to it. Nothing here is imported or fetched before that click. The visitor's
// words only go into the model in this tab: every request is a library or model file.
import { DirectorError } from "./director.js";
import { MODEL, PREFIX_CACHE } from "./model-host.js";

export { MODEL };

/** info.fallback after a question failed on WebGPU and the model moved to WebAssembly. */
export const SWITCHED = "WebGPU stopped working after the model loaded, so it moved to WebAssembly";

/**
 * Load the model in a Worker; onProgress({ loaded, total, backend }) in bytes, never going backwards; `signal`
 * (AbortSignal) cancels the download; prefer: "auto" (WebGPU when it works here, else WebAssembly) | "webgpu" (also a
 * software adapter) | "wasm". A failed WebGPU attempt is thrown away with its worker and WebAssembly loads in a fresh one,
 * from the Cache API (WebGPU is not tried when storage is blocked, so nothing is downloaded twice). If a question fails on
 * WebGPU after loading (a lost device, say), that question fails, the worker is replaced by a WebAssembly one and later
 * questions wait for it; `info` is updated in place and onSwitch(info) is called once it is ready.
 * Resolves to { scorer, info, terminate, stats }:
 * scorer(text, n, { prefix }) -> Promise<number[n]>, the letter logits of the whole prompt `text`; `prefix`, a start of
 * `text` shared by many calls, is ignored unless prefixCache is on, when the worker reuses its key/value cache (stats
 * counts how often it could; see PREFIX_CACHE for why it is off by default).
 * info: { name, dtype, backend: "WebGPU" | "WASM", mb, loadSeconds, cached, prefixCache, fallback?, adapter? }.
 */
export function loadModel({ onProgress = () => {}, onSwitch = () => {}, signal, prefer = "auto", prefixCache = PREFIX_CACHE } = {}) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const pending = new Map();
    const stats = { reused: 0, full: 0 };
    let worker = null, next = 0, ready = false, done = false, best = { loaded: 0, total: 0 };
    let info = null, switching = false, waiting = []; // waiting: questions asked while a WebAssembly worker replaces WebGPU
    const send = (q) => worker.postMessage({ type: "score", ...q });
    const fail = (message) => {
      done = true;
      worker?.terminate();
      for (const p of pending.values()) p.reject(new DirectorError(message));
      pending.clear();
      if (!ready) reject(new DirectorError(message));
    };
    if (signal?.aborted) {
      reject(new DirectorError("loading was cancelled"));
      return;
    }
    signal?.addEventListener("abort", () => { if (!ready) fail("loading was cancelled"); }, { once: true });
    const start = (msg) => {
      try {
        worker = new Worker(new URL("./model-worker.js", import.meta.url), { type: "module" });
      } catch {
        fail("this browser cannot start the model's worker");
        return;
      }
      worker.onerror = (e) => {
        e.preventDefault?.();
        fail("the model's worker stopped");
      };
      worker.onmessage = (ev) => {
        if (done && !ready) return;
        const m = ev.data || {};
        if (m.type === "progress") {
          if (ready) return; // a replacement worker reads the files from the cache; the page's download is done
          best = { loaded: Math.min(Math.max(best.loaded, m.loaded), Math.max(best.total, m.total)), total: Math.max(best.total, m.total) };
          onProgress({ ...best, backend: m.backend });
        } else if (m.type === "fallback") { // WebGPU did not work: drop that worker and its memory, load WebAssembly anew
          worker.terminate();
          start({ type: "load", prefer: "wasm", prefixCache, fallback: m.reason, adapter: m.adapter });
        } else if (m.type === "ready" && ready) { // the WebAssembly worker that replaced a failed WebGPU one
          Object.assign(info, { backend: m.info.backend, dtype: m.info.dtype, fallback: SWITCHED });
          switching = false;
          for (const q of waiting) send(q);
          waiting = [];
          onSwitch(info);
        } else if (m.type === "ready") {
          ready = true;
          const scorer = (text, n, opts = {}) => new Promise((res, rej) => {
            if (done) {
              rej(new DirectorError("the model was unloaded"));
              return;
            }
            const id = ++next;
            pending.set(id, { resolve: res, reject: rej });
            const prefix = typeof opts?.prefix === "string" && opts.prefix && text.startsWith(opts.prefix) ? opts.prefix : undefined;
            if (switching) waiting.push({ id, text, n, prefix });
            else send({ id, text, n, prefix });
          });
          info = { ...m.info, loadSeconds: Math.round((performance.now() - t0) / 100) / 10,
            mb: Math.max(m.info.mb || 0, Math.round(best.total / 1e6)) };
          resolve({ scorer, info, terminate: () => fail("the model was unloaded"), stats });
        } else if (m.type === "scores" || (m.type === "error" && m.id)) {
          const p = pending.get(m.id);
          pending.delete(m.id);
          if (!p) return;
          if (m.type === "scores") {
            stats[m.reused ? "reused" : "full"]++;
            p.resolve(m.scores);
          } else {
            p.reject(new DirectorError(String(m.message)));
            if (info.backend === "WebGPU" && !switching) { // the GPU path broke after loading: carry on with WebAssembly
              switching = true;
              worker.terminate();
              for (const q of pending.values()) q.reject(new DirectorError("the model stopped while answering"));
              pending.clear();
              start({ type: "load", prefer: "wasm", prefixCache, fallback: SWITCHED, adapter: info.adapter || "" });
            }
          }
        } else if (m.type === "error") fail(String(m.message));
      };
      worker.postMessage(msg);
    };
    start({ type: "load", prefer, prefixCache });
  });
}
