// Model mode's loader, on the page's side: runs only after the visitor presses "Download and enable model". It starts a module Worker
// (model-worker.js) that downloads and runs Qwen3-0.6B, and returns a scorer that sends one prompt at a time to it.
// Nothing here is imported or fetched before that click. The visitor's words only go into the model in this tab: every
// request is a library or model file.
import { DirectorError } from "./director.js";
import { MODEL } from "./model-host.js";

export { MODEL };

/**
 * Load the model in a Worker; onProgress({ loaded, total }) in bytes; `signal` (AbortSignal) cancels the download.
 * Resolves to { scorer, info, terminate }.
 */
export function loadModel({ onProgress = () => {}, signal } = {}) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL("./model-worker.js", import.meta.url), { type: "module" });
    } catch {
      reject(new DirectorError("this browser cannot start the model's worker"));
      return;
    }
    const pending = new Map();
    let next = 0;
    let ready = false;
    const fail = (message) => {
      worker.terminate();
      for (const p of pending.values()) p.reject(new DirectorError(message));
      pending.clear();
      if (!ready) reject(new DirectorError(message));
    };
    signal?.addEventListener("abort", () => fail("loading was cancelled"), { once: true });
    worker.onerror = (e) => {
      e.preventDefault?.();
      fail("the model's worker stopped");
    };
    worker.onmessage = (ev) => {
      const m = ev.data || {};
      if (m.type === "progress") onProgress({ loaded: m.loaded, total: m.total });
      else if (m.type === "ready") {
        ready = true;
        const scorer = (text, n) => new Promise((res, rej) => {
          const id = ++next;
          pending.set(id, { resolve: res, reject: rej });
          worker.postMessage({ type: "score", id, text, n });
        });
        resolve({ scorer, info: m.info, terminate: () => fail("the model was unloaded") });
      } else if (m.type === "scores" || (m.type === "error" && m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        if (!p) return;
        if (m.type === "scores") p.resolve(m.scores);
        else p.reject(new DirectorError(String(m.message)));
      } else if (m.type === "error") fail(String(m.message));
    };
    worker.postMessage({ type: "load" });
  });
}
