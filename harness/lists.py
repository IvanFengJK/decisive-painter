# Round 12 harness lists (own names and values; written from the design description only, no third-party lists).
# Frozen before any model run (STATUS.md). Boxes are normalised (x0, y0, x1, y1), y down.

# ---------------------------------------------------------------------------------------------- phases and budget
BUDGET = 50
PHASES = [  # (name, first gesture, last gesture, what it is for)
    ("backdrop", 1, 8, "lay in the sky, wall or overall ground colour"),
    ("ground", 9, 16, "the land, water, floor or table"),
    ("distance", 17, 24, "the horizon, far shapes and middle distance"),
    ("subject", 25, 40, "the main subject at the focal place"),
    ("accents", 41, 50, "details, highlights, dark accents and texture"),
]
FINISH_FROM = 25  # a "finished = yes" pick is honoured only from this gesture on

# ---------------------------------------------------------------------------------------------- compositions
# Every composition has at most 6 named places, so a place question has at most 6 + 25 grid cells = 31 options.
COMPOSITIONS = {
    "open horizon": {
        "about": "a level horizon across the middle, sky above and land or sea below, subject near the centre",
        "places": {"upper air": (0, 0, 1, .52), "far band": (0, .44, 1, .60), "low ground": (0, .56, 1, 1),
                   "centre stage": (.30, .28, .70, .80), "near edge": (0, .84, 1, 1), "whole frame": (0, 0, 1, 1)},
        "order": {"backdrop": ["upper air", "whole frame"], "ground": ["low ground", "near edge"], "distance": ["far band"],
                  "subject": ["centre stage"], "accents": ["centre stage", "near edge", "upper air"]},
    },
    "tall centre": {
        "about": "one tall subject standing in the middle, flanked by space on both sides",
        "places": {"upper air": (0, 0, 1, .50), "low ground": (0, .72, 1, 1), "centre stage": (.34, .08, .66, .92),
                   "left wing": (0, .20, .32, .92), "right wing": (.68, .20, 1, .92), "whole frame": (0, 0, 1, 1)},
        "order": {"backdrop": ["upper air", "whole frame"], "ground": ["low ground"], "distance": ["left wing", "right wing"],
                  "subject": ["centre stage"], "accents": ["centre stage", "low ground"]},
    },
    "big sky": {
        "about": "a low horizon with a large sky; a high light or moon; small land at the bottom",
        "places": {"upper air": (0, 0, 1, .74), "far band": (0, .66, 1, .80), "low ground": (0, .76, 1, 1),
                   "high point": (.55, .07, .86, .36), "centre stage": (.25, .42, .75, .86), "whole frame": (0, 0, 1, 1)},
        "order": {"backdrop": ["upper air", "whole frame"], "ground": ["low ground"], "distance": ["far band", "high point"],
                  "subject": ["centre stage", "high point"], "accents": ["high point", "centre stage", "low ground"]},
    },
    "deep ground": {
        "about": "a high horizon; most of the picture is ground or water receding into the distance",
        "places": {"upper air": (0, 0, 1, .26), "far band": (0, .20, 1, .36), "low ground": (0, .30, 1, 1),
                   "centre stage": (.25, .36, .75, .84), "near edge": (0, .80, 1, 1), "whole frame": (0, 0, 1, 1)},
        "order": {"backdrop": ["upper air", "whole frame"], "ground": ["low ground"], "distance": ["far band"],
                  "subject": ["centre stage"], "accents": ["near edge", "centre stage"]},
    },
    "side weight": {
        "about": "the main mass on the left, an answering smaller shape on the right, open space between",
        "places": {"upper air": (0, 0, 1, .50), "low ground": (0, .70, 1, 1), "left wing": (.04, .14, .52, .92),
                   "right wing": (.60, .34, .96, .82), "far band": (0, .44, 1, .60), "whole frame": (0, 0, 1, 1)},
        "order": {"backdrop": ["upper air", "whole frame"], "ground": ["low ground"], "distance": ["far band", "right wing"],
                  "subject": ["left wing"], "accents": ["left wing", "right wing"]},
    },
    "still life": {
        "about": "a close view of an object on a table, a plain wall behind",
        "places": {"back wall": (0, 0, 1, .64), "table top": (0, .58, 1, 1), "centre stage": (.24, .18, .76, .86),
                   "near edge": (0, .86, 1, 1), "left wing": (0, .20, .30, .80), "whole frame": (0, 0, 1, 1)},
        "order": {"backdrop": ["back wall", "whole frame"], "ground": ["table top"], "distance": ["left wing"],
                  "subject": ["centre stage"], "accents": ["centre stage", "near edge"]},
    },
    "mirror water": {
        "about": "a scene above a still water surface that repeats it below",
        "places": {"upper air": (0, 0, 1, .44), "far band": (0, .36, 1, .52), "water plane": (0, .50, 1, 1),
                   "centre stage": (.28, .14, .72, .52), "near edge": (0, .86, 1, 1), "whole frame": (0, 0, 1, 1)},
        "order": {"backdrop": ["upper air", "whole frame"], "ground": ["water plane"], "distance": ["far band"],
                  "subject": ["centre stage", "water plane"], "accents": ["water plane", "near edge"]},
    },
    "diagonal sweep": {
        "about": "a strong diagonal from lower left to upper right, with movement along it",
        "places": {"upper air": (0, 0, 1, .48), "low ground": (0, .54, 1, 1), "left wing": (0, .40, .52, 1),
                   "right wing": (.48, 0, 1, .62), "centre stage": (.28, .28, .72, .72), "whole frame": (0, 0, 1, 1)},
        "order": {"backdrop": ["upper air", "whole frame"], "ground": ["low ground", "left wing"], "distance": ["right wing"],
                  "subject": ["centre stage"], "accents": ["centre stage", "left wing"]},
    },
}

# ---------------------------------------------------------------------------------------------- palettes
# name -> (five (colour name, hex) pairs, paper hex)
PALETTES = {
    "harbour dusk": ([("slate blue", "#4f6479"), ("rust orange", "#b4532d"), ("sand", "#d8c49b"), ("deep teal", "#1d4f55"), ("lamp gold", "#e6c25a")], "#f3ecdc"),
    "storm grey": ([("charcoal", "#33363b"), ("pewter", "#7d858c"), ("sea foam", "#a9c4bd"), ("wet navy", "#26364d"), ("flash white", "#eef0ec")], "#e9e9e4"),
    "noon field": ([("sun yellow", "#f2c230"), ("leaf green", "#4f8a3b"), ("sky azure", "#6fa8dc"), ("earth brown", "#7a5230"), ("cloud white", "#f7f5ee")], "#fbf7ec"),
    "snow dawn": ([("snow white", "#f4f6f8"), ("ice blue", "#a9c6de"), ("pine green", "#2f4f3e"), ("dawn rose", "#e8a3a0"), ("shadow violet", "#6e6a8e")], "#eef0f2"),
    "sunset glow": ([("tangerine", "#f08a3c"), ("magenta haze", "#c4517a"), ("plum", "#4b2b4a"), ("gold glow", "#f7c873"), ("dark hull", "#2a2420")], "#f6efe2"),
    "rain city": ([("wet asphalt", "#3c4045"), ("terracotta", "#9c4e3a"), ("neon teal", "#3fb6b2"), ("umbrella yellow", "#e8c53a"), ("mist grey", "#b9bec4")], "#e4e4e0"),
    "moon desert": ([("dune ochre", "#c79a55"), ("night indigo", "#1f2547"), ("moon cream", "#f2e8c6"), ("shadow umber", "#5c4330"), ("star silver", "#c8ccd6")], "#efe6d2"),
    "lily pond": ([("pond green", "#3e6b4c"), ("lily pink", "#e7a1b4"), ("water teal", "#4c8c8c"), ("pad olive", "#7c9a3c"), ("sky reflection", "#bcd6e3")], "#f5f4ee"),
    "autumn path": ([("maple red", "#b23a26"), ("amber", "#d98c2b"), ("bark brown", "#5a3d2b"), ("moss", "#6b7a3a"), ("fog beige", "#d9cfb8")], "#f1e7d3"),
    "barn hill": ([("barn red", "#a8322b"), ("hill green", "#5d8a3e"), ("sky blue", "#8fbbe0"), ("hay gold", "#d8b04a"), ("trim white", "#f5f2ea")], "#f6f0e3"),
    "breaking surf": ([("ocean blue", "#1f5c8f"), ("foam white", "#f2f5f4"), ("rock grey", "#5d5a57"), ("spray aqua", "#7fc4c9"), ("kelp brown", "#5a4a2c")], "#eef2f2"),
    "night market": ([("lantern red", "#d13b2f"), ("neon pink", "#e45ca0"), ("electric blue", "#3c6ee0"), ("warm amber", "#f0a83a"), ("night black", "#15151d")], "#ece6dc"),
    "mountain lake": ([("glacier blue", "#6fa3c8"), ("granite grey", "#6f7378"), ("forest green", "#2e5a3f"), ("snowcap white", "#f3f5f6"), ("deep lake", "#1d3d5c")], "#f0f2f1"),
    "fireside": ([("soot black", "#1c1b1d"), ("amber eye", "#d9a032"), ("ash grey", "#8a8a8a"), ("cushion red", "#a8433a"), ("cream", "#efe5d0")], "#f6f1e6"),
    "orchard": ([("apple red", "#c62f2c"), ("leaf green", "#4d8b3a"), ("stem brown", "#6b4426"), ("blush pink", "#eba3a0"), ("table wood", "#b58a5a")], "#f8f3e8"),
    "coffee bar": ([("mug teal", "#5aa5ad"), ("coffee brown", "#6b4325"), ("steam grey", "#c9c7c2"), ("saucer white", "#f3f1ec"), ("counter tan", "#c9a476")], "#f4efe6"),
    "evergreen": ([("spruce", "#234a35"), ("sage", "#8aa67a"), ("bark", "#6a4a33"), ("sky mint", "#d3e6dc"), ("snow", "#f4f6f5")], "#f2f4ef"),
    "type poster": ([("signal teal", "#1fb8a3"), ("peach", "#f2a979"), ("ink black", "#1a1a1a"), ("butter", "#f2dc8a"), ("off-white", "#f5f3ec")], "#fbfaf5"),
    "pastel morning": ([("baby blue", "#bcd7ef"), ("peach", "#f6c6a5"), ("mint", "#c5e6cf"), ("lilac", "#cdbbe5"), ("butter", "#f7e9a8")], "#fbfaf6"),
    "earth tones": ([("ochre", "#c08f3e"), ("sienna", "#9a4f2b"), ("umber", "#4f3b2a"), ("olive", "#6e7040"), ("bone", "#e8dfc8")], "#f2ebdc"),
    "ocean night": ([("midnight", "#121a33"), ("moonlit blue", "#3a5a8c"), ("silver", "#c7cfd8"), ("sea green", "#2f6b62"), ("lamp yellow", "#f2d36b")], "#e8eaee"),
    "fauve heat": ([("cadmium red", "#d7372b"), ("cobalt", "#2f56b8"), ("viridian", "#23866c"), ("lemon", "#f2d43a"), ("violet", "#7b3fa0")], "#faf6ee"),
    "monochrome ink": ([("black", "#111111"), ("dark grey", "#4a4a4a"), ("mid grey", "#8c8c8c"), ("light grey", "#c8c8c8"), ("white", "#f6f6f6")], "#f4f2ec"),
    "tropical noon": ([("palm green", "#2f8a4f"), ("lagoon cyan", "#39b3c4"), ("coral", "#f0745a"), ("beach sand", "#ecd7a8"), ("hibiscus", "#c2305a")], "#fbf8ef"),
}

# ---------------------------------------------------------------------------------------------- styles, stroke character
STYLES = {
    "loose open-air sketch": "quick and airy, edges left unfinished",
    "quiet tonal study": "few colours, soft changes of light and dark",
    "bold poster": "flat strong shapes and clear silhouettes",
    "dreamy wet-on-wet": "soft blooms and blurred edges",
    "nervous ink drawing": "many fine scratchy lines",
    "naive folk picture": "simple symbolic shapes, bright and direct",
    "moody nocturne": "dark, a few lights, heavy atmosphere",
    "hot expressive colour": "saturated, energetic, unnatural colour",
    "flat woodblock": "flat bands of colour with outlines, decorative",
    "dotted light": "built from many small touches of colour",
    "childlike crayon": "wobbly playful lines",
    "atmospheric haze": "faint layered washes and deep distance",
}
STROKES = {
    "calm and even": "steady, regular marks",
    "energetic and loose": "long fast marks that wander",
    "precise and controlled": "tight, careful, evenly spaced marks",
    "rough and broken": "dry, broken, scratchy marks",
    "soft and blended": "marks that melt into each other",
}

# ---------------------------------------------------------------------------------------------- gestures
SOLID = {  # mark name -> short description shown to the model
    "horizontal band": "a wide flat strip across the place",
    "upright column": "a tall narrow block",
    "round disc": "a filled circle",
    "tall oval": "an upright ellipse",
    "wide oval": "a flat ellipse",
    "low mound": "a rounded hump rising from the bottom of the place",
    "pointed triangle": "a triangle pointing up",
    "block": "a rectangle",
    "wedge": "a slanted triangular slice",
    "broad wash": "a soft covering of the whole place",
}
LINEAR = {
    "vertical hatching": "several upright strokes",
    "horizontal dashes": "several level strokes",
    "slanted strokes": "several diagonal strokes",
    "cross-hatching": "two crossing sets of lines",
    "dotted speckle": "many small dots",
    "flowing ribbon": "one long wavy stroke",
    "stacked arcs": "a few curved arcs, like waves or hills",
    "zigzag": "a sharp back-and-forth line",
    "outline loop": "a closed outline around the place",
    "tangled scribble": "a loose knot of lines",
}
GESTURES = {**SOLID, **LINEAR}
MEDIA = {
    "pencil": "thin grey-graphite grain",
    "ink pen": "fine crisp line",
    "felt marker": "flat streaky stripes",
    "charcoal": "dark, grainy, smudged",
    "watercolour": "transparent soft wash with dark edges",
    "oil pastel": "thick waxy colour",
}
FILLS = {
    "solid fill": "cover the shape densely",
    "thin wash": "a transparent veil of colour",
    "outline only": "only draw the edge",
    "hatched fill": "fill with parallel lines",
}
SIZES = {"small": "about a third of the place", "medium": "about half of the place", "large": "most of the place"}
WEIGHTS = {"light": "faint, delicate marks", "medium": "normal pressure", "heavy": "strong, dense marks"}
GRID = [f"{r}{c}" for r in "ABCDE" for c in range(1, 6)]  # rows A (top) .. E (bottom), columns 1 (left) .. 5 (right)


def grid_box(cell):
    r, c = "ABCDE".index(cell[0]), int(cell[1]) - 1
    return (c / 5, r / 5, (c + 1) / 5, (r + 1) / 5)


def phase_of(step):
    for name, a, b, what in PHASES:
        if a <= step <= b:
            return name, a, b, what
    return PHASES[-1]
