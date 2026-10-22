// Model mode's backend choice without a download: the pure helpers in model-host.js, and model-loader.js driven by a
// fake Worker that speaks the worker's messages (WebGPU fallback, progress, cancel, prefix, unload).
import assert from "node:assert/strict";
import { test } from "node:test";
import { DTYPES, MODEL, PREFIX_CACHE, SMOKE, adapterName, friendly, isSoftware, logitsOK, planBackends, restAfter,
  webgpuFailure } from "../web/model-host.js";
import { loadModel } from "../web/model-loader.js";

const NVIDIA = { vendor: "nvidia", architecture: "ampere", description: "", fallback: false };
const SWIFT = { vendor: "google", architecture: "swiftshader", description: "", fallback: true };

test("model-host: WebGPU is tried first only on a hardware adapter, and every plan ends with WebAssembly", () => {
  assert.deepEqual(planBackends("auto", { gpu: true, adapter: NVIDIA }), { order: ["webgpu", "wasm"], fallback: "" });
  assert.deepEqual(planBackends("auto", { gpu: false }), { order: ["wasm"], fallback: "this browser has no WebGPU" });
  assert.deepEqual(planBackends("auto", { gpu: true, adapter: null }), { order: ["wasm"], fallback: "WebGPU found no graphics adapter" });
  assert.deepEqual(planBackends("auto", { gpu: true, adapter: null, error: "x" }).order, ["wasm"]);
  assert.match(planBackends("auto", { gpu: true, adapter: SWIFT }).fallback, /software/);
  assert.deepEqual(planBackends("webgpu", { gpu: true, adapter: SWIFT }).order, ["webgpu", "wasm"], "asked for: a software adapter too");
  assert.deepEqual(planBackends("wasm", { gpu: true, adapter: NVIDIA }), { order: ["wasm"], fallback: "" }, "not attempted: no reason");
  for (const plan of [planBackends(), planBackends("auto", { gpu: true, adapter: NVIDIA }), planBackends("webgpu", {})]) assert.equal(plan.order.at(-1), "wasm");
});

test("model-host: adapters are named plainly, software ones marked", () => {
  assert.equal(adapterName(NVIDIA), "nvidia ampere");
  assert.equal(adapterName(SWIFT), "google swiftshader (software)");
  assert.equal(adapterName(null), "");
  assert.ok(isSoftware({ vendor: "mesa", architecture: "llvmpipe" }) && !isSoftware(NVIDIA));
});

test("model-host: the same int8 weights on both backends", () => {
  assert.equal(DTYPES.webgpu, "int8");
  assert.equal(DTYPES.wasm, MODEL.dtype);
  assert.equal(PREFIX_CACHE, false, "prefix reuse stays off for the int8 build (activations are quantised per pass)");
});

test("model-host: fallback reasons and errors are plain sentences, never the raw error", () => {
  assert.equal(webgpuFailure(new Error("Failed to create session: GPUDevice lost xyz"), "load"), "the model could not start on WebGPU");
  assert.equal(webgpuFailure(new Error("RangeError: Array buffer allocation failed")), "the graphics card ran out of memory for the model");
  assert.equal(webgpuFailure(new TypeError("Failed to fetch")), "the download was interrupted while trying WebGPU");
  assert.equal(webgpuFailure(null, "check"), "WebGPU gave unusable answers to a test question");
  assert.equal(friendly(new TypeError("Failed to fetch")), "the model files could not be downloaded");
  assert.equal(friendly(new Error("weird"), "run"), "the model stopped while answering");
});

test("model-host: the test question's logits must be finite, spread and close to the WebAssembly reference", () => {
  assert.ok(logitsOK([1, 2, 3]));
  assert.ok(!logitsOK([1, NaN, 3]) && !logitsOK([1, Infinity]) && !logitsOK([]) && !logitsOK([2, 2, 2]));
  if (SMOKE.ref) {
    assert.ok(logitsOK(SMOKE.ref, SMOKE.ref), "the reference passes itself");
    assert.ok(logitsOK(SMOKE.ref.map((v) => v + 5), SMOKE.ref), "a constant shift is the same answer");
    assert.ok(!logitsOK(SMOKE.ref.slice().reverse(), SMOKE.ref), "another answer fails");
    assert.equal(SMOKE.ref.length, SMOKE.n);
  }
});

test("model-host: a prefix is reused only when its tokens are exactly the start of the prompt's", () => {
  assert.deepEqual(restAfter([1, 2, 3, 4], [1, 2]), [3, 4]);
  assert.equal(restAfter([1, 2, 3, 4], [1, 5]), null, "the cut fell inside a token");
  assert.equal(restAfter([1, 2], [1, 2]), null, "nothing left to read");
  assert.equal(restAfter([1, 2], []), null);
});

// ------------------------------------------------------------------------------------------------ the loader
/** A Worker stand-in: script(worker, msg) answers each posted message; every instance is recorded. */
function fakeWorkers(script) {
  const made = [];
  globalThis.Worker = class {
    constructor(url, opts) {
      this.url = String(url);
      this.opts = opts;
      this.posted = [];
      this.terminated = false;
      made.push(this);
    }
    postMessage(m) {
      this.posted.push(m);
      queueMicrotask(() => script(this, m, made.length));
    }
    emit(data) {
      if (!this.terminated) this.onmessage?.({ data });
    }
    terminate() {
      this.terminated = true;
    }
  };
  return made;
}
const INFO = (backend, extra = {}) => ({ name: "Qwen3-0.6B", dtype: "int8", backend, mb: 627, loadSeconds: 1, cached: true, prefixCache: false, ...extra });

test("loader: a failed WebGPU attempt is dropped with its worker and WebAssembly loads in a fresh one", async () => {
  const made = fakeWorkers((w, m) => {
    if (m.type !== "load") return w.emit({ type: "scores", id: m.id, scores: [1, 2], reused: false });
    if (m.prefer !== "wasm") {
      w.emit({ type: "progress", loaded: 300e6, total: 627e6, backend: "webgpu" });
      w.emit({ type: "fallback", reason: "the model could not start on WebGPU", adapter: "nvidia ampere" });
    } else {
      w.emit({ type: "progress", loaded: 10e6, total: 20e6, backend: "wasm" }); // the second attempt starts small again
      w.emit({ type: "progress", loaded: 627e6, total: 627e6, backend: "wasm" });
      w.emit({ type: "ready", info: INFO("WASM", { fallback: m.fallback, adapter: m.adapter }) });
    }
  });
  const seen = [];
  const r = await loadModel({ onProgress: (p) => seen.push(p) });
  assert.equal(made.length, 2);
  assert.ok(made[0].terminated && !made[1].terminated);
  assert.deepEqual(made[1].posted[0], { type: "load", prefer: "wasm", prefixCache: false, fallback: "the model could not start on WebGPU", adapter: "nvidia ampere" });
  assert.equal(r.info.backend, "WASM");
  assert.equal(r.info.fallback, "the model could not start on WebGPU");
  assert.equal(r.info.adapter, "nvidia ampere");
  assert.ok(seen.every((p, i) => p.loaded <= p.total && (i === 0 || (p.loaded >= seen[i - 1].loaded && p.total >= seen[i - 1].total))), "progress never goes back or past the total");
  assert.deepEqual(await r.scorer("abc", 2), [1, 2]);
  r.terminate();
  assert.ok(made[1].terminated);
  await assert.rejects(r.scorer("abc", 2), /unloaded/);
});

test("loader: WebGPU that works is used, and the prefix is only sent when it starts the prompt", async () => {
  const made = fakeWorkers((w, m) => {
    if (m.type === "load") w.emit({ type: "ready", info: INFO("WebGPU", { adapter: "nvidia ampere" }) });
    else w.emit({ type: "scores", id: m.id, scores: [0, 1, 2], reused: !!m.prefix });
  });
  const r = await loadModel({ prefer: "auto" });
  assert.equal(made.length, 1);
  assert.equal(r.info.backend, "WebGPU");
  assert.equal(r.info.fallback, undefined);
  await r.scorer("head\nQuestion", 3, { prefix: "head\n" });
  await r.scorer("other\nQuestion", 3, { prefix: "head\n" });
  await r.scorer("head\nQuestion", 3);
  const scores = made[0].posted.filter((m) => m.type === "score");
  assert.deepEqual(scores.map((m) => m.prefix), ["head\n", undefined, undefined]);
  assert.ok(scores.every((m) => m.text.length && m.n === 3));
  assert.deepEqual(r.stats, { reused: 1, full: 2 });
});

test("loader: cancelling during either attempt stops everything with 'loading was cancelled'", async () => {
  for (const at of [1, 2]) {
    const ac = new AbortController();
    const made = fakeWorkers((w, m, k) => {
      if (k === at) ac.abort();
      else if (k === 1) w.emit({ type: "fallback", reason: "the model could not start on WebGPU", adapter: "" });
    });
    await assert.rejects(loadModel({ signal: ac.signal }), /loading was cancelled/);
    assert.ok(made.every((w) => w.terminated), `attempt ${at}: every worker is stopped`);
    assert.equal(made.length, at);
  }
  const ac = new AbortController();
  ac.abort();
  fakeWorkers(() => {});
  await assert.rejects(loadModel({ signal: ac.signal }), /loading was cancelled/);
});

test("loader: a load error is the worker's plain message; a crashed worker says so", async () => {
  fakeWorkers((w) => w.emit({ type: "error", message: "the model files could not be downloaded" }));
  await assert.rejects(loadModel(), /^DirectorError: the model files could not be downloaded$/);
  fakeWorkers((w) => w.onerror?.({ preventDefault() {} }));
  await assert.rejects(loadModel(), /the model's worker stopped/);
  delete globalThis.Worker;
});
