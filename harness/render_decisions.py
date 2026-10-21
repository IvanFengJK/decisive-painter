# Render a decisions JSON to a PNG with the Python reference renderer.
#   python harness/render_decisions.py harness/example-decisions.json out.png            # portable RNG (matches web/)
#   python harness/render_decisions.py harness/example-decisions.json out.png --frozen   # the frozen Round 12 renderer
# The JSON holds the painting id, the look (composition, stroke), the palette (paper hex and one hex per role) and the
# per-mark decisions; see example-decisions.json. Same file, same picture, every time.
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render as frozen  # noqa: E402
import render_portable as portable  # noqa: E402

FIELDS = ("gesture", "place", "size", "medium", "colour", "fill", "weight")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("decisions")
    ap.add_argument("png")
    ap.add_argument("--frozen", action="store_true", help="use render.py (numpy RNG) instead of the portable twin")
    a = ap.parse_args()
    with open(a.decisions, encoding="utf-8") as f:
        J = json.load(f)
    look, roles = J["look"], J["palette"]["roles"]
    R = frozen if a.frozen else portable
    canvas = R.Canvas(J["palette"]["paper"], J["painting_id"])
    for d in J["steps"]:
        missing = [k for k in FIELDS if k not in d]
        if missing:
            sys.exit(f"step {d.get('step')}: missing {', '.join(missing)}")
        canvas.gesture(d["step"], d, look["composition"], roles[d["colour"]], look["stroke"])
    canvas.image().save(a.png)
    print(f"{a.png}: {len(J['steps'])} marks, {'frozen' if a.frozen else 'portable'} renderer")


if __name__ == "__main__":
    main()
