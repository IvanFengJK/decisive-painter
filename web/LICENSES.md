# Licences and sources

## This site

All code, tables, word lists, recipes, guardrail lists and wording in `web/` were written for this project (Round 17)
or ported from our own earlier rounds (the Round 12 renderer and lists, the Round 14 phase menus and code rules, the
Round 15 palette engine). Licence: the repository's licence (see `LICENSE` at the repository root).

No third-party code, fonts, images or scripts are included or loaded.

## Numbers computed from model outputs

- **Kev-4B** (Apache License 2.0). The RuleDirector's phase weights (`PHASE_WEIGHTS` in `director.js`: per phase, the
  mean distribution over gesture, size, fill, weight, colour role and place class, mixed 85/15 with uniform) were
  computed from Kev-4B's recorded probabilities in 12 paintings of the Round 15 package (its `k4b` folder, run with no
  prior), by `experiments/r17/phase_weights.py`; output `experiments/r17/phase-weights-k4b.json`. No weights of the model
  are included or downloaded.
- No other model's outputs are used. In particular, the Round 14 phase prior and the Round 15 role tables (which were
  informed by another service's cached decisions) are **not** used anywhere in the site.

## Credit

The idea's credit is on the About page (`about.html`, section Credit). No code or lists from that project are used.
