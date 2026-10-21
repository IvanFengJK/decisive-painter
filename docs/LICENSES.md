# Licences and sources

## This repository

Everything here (the site in `web/`, the tests, the docs and the Python harness) was written for this project. The
site's code, tables, word lists, recipes, guardrail lists and wording were written in Round 17 or ported from our own
earlier rounds: the Round 12 renderer and lists (`harness/render.py`, `harness/lists.py`), the Round 14 phase menus and
code rules, and the Round 15 palette engine. Licence: MIT (see `LICENSE`).

No third-party code, fonts, images, libraries or scripts are included or loaded. The site needs no packages; the tests use
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

The idea's credit is in `README.md` and on the site's About page (`web/about.html`). No code or lists from that project
are used.
