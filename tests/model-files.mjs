// The exact files Model mode downloads after "Load model" on the WASM path, with their SHA-256. The browser tests can
// serve them from a local mirror (MODEL_MIRROR=<dir>) so each run does not download 630 MB again; make the mirror with
//   node tests/model-files.mjs <dir>
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const REV = "58ca03a5e7b354b480b1a82b34bde8dc7b854cc0";
const HF = `https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX/resolve/${REV}`;
const ORT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist";
export const MODEL_FILES = [
  [`${HF}/config.json`, "8a04114ba59cc42b47d804d35d1d5c61d746ae4634f41f796768c6e302d39b9e"],
  [`${HF}/generation_config.json`, "9e9e031ae8bca36eefcdcdd0b35d83c61baa01e31d68d5f5a961c9ca1a4b95bf"],
  [`${HF}/tokenizer.json`, "e7a95fce95bf5b0946d0ddb3f9d7caa030b7e850bbe92b0edb26bcf563e9f3d5"],
  [`${HF}/tokenizer_config.json`, "7c5194eecfd95a4dcbd6b4b502af785d2541fd65a388d1cae7ad43693c67b802"],
  [`${HF}/onnx/model_int8.onnx`, "d93222c672992a398eeea3a4a1ca025738efd9a18ba5f1691419ff8ae23a8e75"],
  [`${ORT}/ort-wasm-simd-threaded.asyncify.wasm`, "49871f5a4409519797e127440868a6d1923339d9185907f301a5b2a1d90af082"],
  [`${ORT}/ort-wasm-simd-threaded.asyncify.mjs`, "0966b6105cd936744498aa60df7a22cbd47af3374dbc64a9ab561c08a71e3611"],
];
/** Where a URL lives in the mirror: <dir>/<host>/<path>. */
export const mirrorPath = (dir, url) => { const u = new URL(url); return join(dir, u.host, u.pathname); };

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2];
  if (!dir) throw new Error("usage: node tests/model-files.mjs <mirror dir>");
  for (const [url, sha] of MODEL_FILES) {
    const r = await fetch(url, { redirect: "follow" });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const got = createHash("sha256").update(buf).digest("hex");
    if (sha && got !== sha) throw new Error(`${url}: sha256 ${got}, expected ${sha}`);
    const out = mirrorPath(dir, url);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, buf);
    console.log(`${(buf.length / 1e6).toFixed(1).padStart(7)} MB  ${got}  ${url}`);
  }
}
