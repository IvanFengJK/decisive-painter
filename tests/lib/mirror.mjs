// A local mirror of the model files for the browser tests (see tests/model-files.mjs): serves <dir>/<host>/<path> with
// CORS, so a page whose requests to huggingface.co and cdn.jsdelivr.net are rerouted here (Page.route) loads the same bytes.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const TYPES = { ".json": "application/json", ".wasm": "application/wasm", ".mjs": "text/javascript", ".onnx": "application/octet-stream" };

export function serveMirror(dir) {
  const hits = [];
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
    const file = join(dir, path);
    if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { "Access-Control-Allow-Origin": "*" }).end();
      return;
    }
    const size = statSync(file).size;
    const type = TYPES[extname(file)] || "application/octet-stream";
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "Content-Length, Content-Range" };
    const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
    if (m) { // the library probes files with a one-byte range first, as Hugging Face allows
      const a = Number(m[1]), b = Math.min(size - 1, m[2] === "" ? size - 1 : Number(m[2]));
      hits.push({ path, bytes: b - a + 1, range: req.headers.range });
      res.writeHead(206, { "Content-Type": type, "Content-Length": b - a + 1, "Content-Range": `bytes ${a}-${b}/${size}`, ...cors });
      createReadStream(file, { start: a, end: b }).pipe(res);
      return;
    }
    hits.push({ path, bytes: size, range: "" });
    res.writeHead(200, { "Content-Type": type, "Content-Length": size, ...cors });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}`, hits })));
}
