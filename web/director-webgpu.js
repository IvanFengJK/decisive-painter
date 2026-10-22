// POINTER: WebGPU is no longer a separate Director. Model mode (model-loader.js, model-worker.js) picks the backend
// itself: WebGPU when the browser has a hardware adapter, the model starts on it and it answers a test question like
// WebAssembly does (model-host.js: planBackends, SMOKE), else WebAssembly, in a fresh worker. The page never imports
// this file. Measurements and the per-backend timing script: tests/webgpu-bench.mjs.
export const WEBGPU_DIRECTOR_AVAILABLE = false;
