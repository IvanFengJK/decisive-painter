// Minimal Chrome DevTools Protocol driver for the headless tests: launches the already-installed Chromium (no
// `playwright install`, no npm packages), one page per Session. Uses node's built-in WebSocket (node >= 22).
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export function findChrome() {
  const cands = [process.env.CHROME,
    join(homedir(), ".cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell"),
    join(homedir(), ".cache/ms-playwright/chromium-1243/chrome-linux64/chrome"),
    join(homedir(), ".cache/ms-playwright/chromium-1217/chrome-linux64/chrome")].filter(Boolean);
  const c = cands.find((p) => existsSync(p));
  if (!c) throw new Error("no Chromium found; set CHROME=/path/to/chrome");
  return c;
}

export class Browser {
  static async launch() {
    const dir = mkdtempSync(join(tmpdir(), "r17-chrome-"));
    const proc = spawn(findChrome(), ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${dir}`,
      "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-extensions", "--mute-audio",
      "--disable-background-networking", "--disable-component-update", "--disable-sync", "--hide-scrollbars",
      "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
    const ws = await new Promise((resolve, reject) => {
      let buf = "";
      proc.stderr.on("data", (d) => {
        buf += d;
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
        if (m) resolve(m[1]);
      });
      proc.on("exit", (c) => reject(new Error(`chrome exited ${c}: ${buf.slice(-500)}`)));
    });
    const b = new Browser(proc, dir);
    process.on("exit", () => { // never leave a headless browser behind, even when a test throws
      try { proc.kill("SIGKILL"); } catch { /* gone */ }
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ }
    });
    await b.connect(ws);
    return b;
  }

  constructor(proc, dir) {
    this.proc = proc;
    this.dir = dir;
    this.id = 0;
    this.waiting = new Map();
    this.listeners = new Map();
  }

  connect(url) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
      this.ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && this.waiting.has(msg.id)) {
          const { res, rej } = this.waiting.get(msg.id);
          this.waiting.delete(msg.id);
          msg.error ? rej(new Error(`${msg.error.message} ${msg.error.data || ""}`)) : res(msg.result);
        } else if (msg.method) {
          for (const cb of this.listeners.get(`${msg.sessionId || ""}|${msg.method}`) || []) cb(msg.params);
        }
      };
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((res, rej) => this.waiting.set(id, { res, rej }));
  }

  on(sessionId, method, cb) {
    const k = `${sessionId || ""}|${method}`;
    if (!this.listeners.has(k)) this.listeners.set(k, []);
    this.listeners.get(k).push(cb);
  }

  async newPage(opts) {
    const { targetId } = await this.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
    const p = new Page(this, sessionId, targetId);
    await p.init(opts);
    return p;
  }

  async close() {
    try { await this.send("Browser.close"); } catch { /* already gone */ }
    this.proc.kill("SIGKILL");
    rmSync(this.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

export class Page {
  constructor(browser, sessionId, targetId) {
    this.b = browser;
    this.s = sessionId;
    this.targetId = targetId;
    this.requests = [];
    this.errors = [];
  }

  send(m, p) { return this.b.send(m, p, this.s); }
  on(m, cb) { this.b.on(this.s, m, cb); }

  async init({ width = 1280, height = 800, mobile = false, dark = false, reducedMotion = false, blockStorage = false } = {}) {
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("Log.enable");
    await this.send("Network.enable");
    this.on("Network.requestWillBeSent", (e) => this.requests.push({ url: e.request.url, method: e.request.method, body: e.request.postData || "", t: Date.now() }));
    this.on("Runtime.consoleAPICalled", (e) => {
      if (e.type === "error" || e.type === "warning") this.errors.push(`console.${e.type}: ${e.args.map((a) => a.value ?? a.description).join(" ")}`);
    });
    this.on("Runtime.exceptionThrown", (e) => this.errors.push(`exception: ${e.exceptionDetails.exception?.description || e.exceptionDetails.text}`));
    this.on("Log.entryAdded", (e) => { if (e.entry.level === "error") this.errors.push(`log: ${e.entry.text} ${e.entry.url || ""}`); });
    await this.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
    if (mobile) await this.send("Emulation.setTouchEmulationEnabled", { enabled: true });
    await this.send("Emulation.setEmulatedMedia", { features: [
      { name: "prefers-color-scheme", value: dark ? "dark" : "light" },
      { name: "prefers-reduced-motion", value: reducedMotion ? "reduce" : "no-preference" }] });
    if (blockStorage) {
      await this.send("Page.addScriptToEvaluateOnNewDocument", { source:
        "Object.defineProperty(window,'localStorage',{get(){throw new DOMException('blocked by test','SecurityError')}});" +
        "Object.defineProperty(window,'indexedDB',{get(){throw new DOMException('blocked by test','SecurityError')}});" });
    }
  }

  /**
   * Reroute or block requests to the model hosts. decide(url) returns a new URL (served instead, unseen by the page),
   * "block" (the request fails as if the network refused it), or null (the request goes out unchanged).
   */
  async route(decide) {
    this.routed = [];
    await this.send("Fetch.enable", { patterns: ["https://huggingface.co/*", "https://*.hf.co/*", "https://cdn.jsdelivr.net/*"].map((urlPattern) => ({ urlPattern })) });
    this.on("Fetch.requestPaused", (e) => {
      const r = decide(e.request.url);
      this.routed.push({ url: e.request.url, to: r });
      if (r === "block") this.send("Fetch.failRequest", { requestId: e.requestId, errorReason: "BlockedByClient" }).catch(() => {});
      else this.send("Fetch.continueRequest", { requestId: e.requestId, ...(r ? { url: r } : {}) }).catch(() => {});
    });
  }

  async goto(url) {
    const loaded = new Promise((r) => this.on("Page.loadEventFired", r));
    await this.send("Page.navigate", { url });
    await loaded;
  }

  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  }

  async waitFor(expression, timeoutMs = 30000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (await this.eval(expression)) return Date.now() - t0;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`timeout waiting for ${expression}`);
  }

  async screenshot({ fullPage = true } = {}) {
    let clip;
    if (fullPage) {
      const m = await this.send("Page.getLayoutMetrics");
      const { width, height } = m.cssContentSize || m.contentSize;
      clip = { x: 0, y: 0, width: Math.ceil(width), height: Math.min(Math.ceil(height), 4000), scale: 1 };
    }
    const r = await this.send("Page.captureScreenshot", { format: "png", ...(clip ? { clip, captureBeyondViewport: true } : {}) });
    return Buffer.from(r.data, "base64");
  }

  async close() {
    await this.b.send("Target.closeTarget", { targetId: this.targetId });
  }
}
