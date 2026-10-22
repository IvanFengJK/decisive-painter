# Licences and sources

## This repository

Everything here (the site in `web/`, the tests, the docs and the Python harness) was written for this project. The
site's code, tables, word lists, recipes, guardrail lists and wording were written in Round 17 or ported from our own
earlier rounds: the Round 12 renderer and lists (`harness/render.py`, `harness/lists.py`), the Round 14 phase menus and
code rules, and the Round 15 palette engine. Licence: MIT (see `LICENSE`).

One third-party file is included: `web/vendor/transformers-4.3.1.min.js` (transformers.js 4.3.1, Apache License 2.0;
licence in `web/vendor/LICENSE-transformers.txt`), loaded only after the visitor presses Load model, inside the model's
Worker. Model mode then fetches at run time, and nothing of it is included:

- **onnxruntime-web** `1.31.0-dev.20260914-8d85527a0` (MIT License) from cdn.jsdelivr.net: the WebAssembly runtime.
- **Qwen3-0.6B**, ONNX build `onnx-community/Qwen3-0.6B-ONNX` at revision `58ca03a5e7b354b480b1a82b34bde8dc7b854cc0`,
  file `onnx/model_int8.onnx` (about 618 MB) plus its tokenizer and config, from huggingface.co. Licence checked on
  2026-10-22: the base model `Qwen/Qwen3-0.6B` is released under the **Apache License 2.0** (its model card says
  `license: apache-2.0` and links the full Apache 2.0 text in its repository); the ONNX build's card names
  `Qwen/Qwen3-0.6B` as its base model and states no other licence, so the Apache 2.0 terms of the base model apply.
  Apache 2.0 allows use, modification and redistribution, including commercial use, with the licence and notices kept;
  it gives no trademark rights and no warranty. This site does not redistribute the weights: the visitor's browser
  fetches them from Hugging Face. No fonts or images from
others are included. The site needs no packages; the tests use
only node's standard library and an already-installed Chromium; the Python harness needs numpy and Pillow
(`harness/requirements.txt`), which are installed separately and not included.

## Numbers computed from model outputs

- **Kev-4B** (Apache License 2.0). The RuleDirector's phase weights (`PHASE_WEIGHTS` in `web/director.js`: per phase, the
  mean distribution over gesture, size, fill, weight, colour role and place class, mixed 85/15 with uniform) were
  computed from Kev-4B's recorded probabilities in 12 paintings run with no prior. The traces and the script stay in the
  research branch and are not included. No weights of any model are included or downloaded.
- No other model's outputs are used. The research harness's phase prior and role tables, which were informed by a closed
  reference model's cached decisions, are not included and not used.

## Credit

The two projects whose ideas this site uses (gesture-level decisions for the Gesture tab; per-cell colour probabilities
and the impasto look for the Probability map tab) are credited in `README.md` and on the About page (`web/about.html`).
No code, lists or wording from either project are used; their source was not read.
