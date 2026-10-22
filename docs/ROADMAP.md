# Improvement roadmap

These are planned improvements for Decisive Painter. The first two build on each other; the page and sharing work can
be developed independently. Status as of 2026-10-22.

## UX improvements

- Keep the drawing-mode tabs above the scene input and label each settings panel with its mode, so visitors can find and
  understand Gesture and Probability map controls on phones. **Done.**
- Keep the scene input, model download action, and seed together near Paint. Explain the seed in plain language and show
  the chosen seed after an automatic draw so visitors can reproduce or share a painting. **Partly done:** the seed is
  explained and shown next to Paint. The model download sits in "Who decides?", below the playback controls.
- Reduce clutter from specialist controls: show Pixel colour options only for Pixel style, make model-map settings
  conditional on Model mode, and keep detailed decision input available as an optional inspection section.
- Keep Advanced Gesture controls near the painting actions, where they are easier to discover.
- Review whether the separate State text shortcut adds enough value; the inspection section itself can remain available
  for visitors interested in the decision process.
- Playback controls (Pause, Next mark) sit below the scene box, so Paint stays on a phone's first screen.

## 1. Run inference with WebGPU when available

Use WebGPU as the primary in-browser inference backend, with the current WebAssembly path as a fallback for browsers or
devices where WebGPU is unavailable or fails. Keep inference on the visitor's device and preserve the existing
download-on-demand behavior.

**Done.** The worker tries WebGPU first. It keeps WebGPU only with a hardware adapter, a session that starts, and a test
question that gives the expected answer. Otherwise it restarts on WebAssembly with the files from the cache. The page
names the backend it used and says why when that is not WebGPU. The int8 build's quantised matrix products have no
WebGPU kernels and still run on the CPU. Measured on one laptop (RTX 3080 Ti, Windows Chrome), a 412-token prompt took
5.2 s on WebGPU against 17.7 s on WebAssembly. Open:

- Measure other GPUs (integrated, mobile, Apple) and a real phone.
- WebGPU and WebAssembly can pick differently on near-ties. A build whose layers all run on WebGPU would be faster, but
  4-bit builds changed the top picks too often, so it needs its own quality check first.

## 2. Let the model make Gesture decisions over multiple turns

Once inference is fast enough, extend Model mode beyond choosing the upfront recipe. Let it decide selected marks during
the Gesture painting, using the evolving painting state, while keeping the current rules-based path available.

**Done (first step).** In Model mode the model also chooses the colour role of 4 of 30 marks: one or two in each phase
after the backdrop, each time reading a short summary of the canvas so far. This adds about 50 s on WebAssembly. Those
marks' odds cards are labelled "model", and the badge counts them. If the model fails, the rules finish the painting.
Open:

- Let the model decide more questions (gesture and place need more than eight answer letters, or a two-step menu).
- Turn on prefix key/value reuse once it matches full prompts. With this int8 build it does not yet.

## 3. Improve the first impression and sharing preview

- Show an example painting on page load and place the canvas higher in the page. **Done.** The rules paint "a field of
  sunflowers at noon" at once; a painting link shows its own painting instead.
- Add Open Graph metadata so shared links have a useful title, description, and image preview on LinkedIn. **Done.**
  The canonical URL is `https://kev-paint.vercel.app/` and the preview image is `og-image.jpg` (1200x630). After the
  next deploy, check it with LinkedIn's Post Inspector.
