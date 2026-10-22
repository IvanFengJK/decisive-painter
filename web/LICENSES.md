# Licences and sources

## This site

All code, tables, word lists, recipes, guardrail lists and wording in `web/` were written for this project (Round 17)
or ported from our own earlier rounds (the Round 12 renderer and lists, the Round 14 phase menus and code rules, the
Round 15 palette engine). Licence: the repository's licence (see `LICENSE` at the repository root).

No third-party code, fonts, images or scripts are included or loaded, except Model mode's vendored library below, which is
loaded only after the visitor presses Download and enable model.

## Numbers computed from model outputs

- **Kev-4B** (Apache License 2.0). The RuleDirector's phase weights (`PHASE_WEIGHTS` in `director.js`: per phase, the
  mean distribution over gesture, size, fill, weight, colour role and place class, mixed 85/15 with uniform) were
  computed from Kev-4B's recorded probabilities in 12 paintings of the Round 15 package (its `k4b` folder, run with no
  prior), by `experiments/r17/phase_weights.py`; output `experiments/r17/phase-weights-k4b.json`. No weights of the model
  are included or downloaded.
- No other model's outputs are used. In particular, the Round 14 phase prior and the Round 15 role tables (which were
  informed by another service's cached decisions) are **not** used anywhere in the site.

## Model mode (loaded only after the visitor presses Download and enable model)

- **transformers.js 4.3.1** (`@huggingface/transformers`, Apache License 2.0) is vendored as
  `vendor/transformers-4.3.1.min.js` (unchanged release file, SHA-256 `8d6716d9…e743`), with its licence in
  `vendor/LICENSE-transformers.txt`.
- **onnxruntime-web** (MIT License), the WebAssembly runtime it uses, is fetched at run time from cdn.jsdelivr.net
  (pinned `1.31.0-dev.20260914-8d85527a0`) and is not included.
- **Qwen3-0.6B** (Apache License 2.0), in the ONNX build `onnx-community/Qwen3-0.6B-ONNX`, is fetched at run time from
  Hugging Face (pinned revision `58ca03a5…`, file `onnx/model_int8.onnx`) and is not included. The ONNX build states no
  licence of its own and names `Qwen/Qwen3-0.6B` (Apache License 2.0) as its base model. No model weights are in this
  repository.

## Credit

On the About page (`about.html`, section Credits): the project that inspired gesture-level decisions and the one that
inspired per-cell probabilities and the impasto look. No code, lists or wording from either project are used.
