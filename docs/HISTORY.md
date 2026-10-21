# How this project got here

Art Director started as an attempt to put a small language model in a browser and have it paint a typed scene, in the
spirit of Jev (a closed model that paints by answering questions) and of the idea credited below. It ran for many
research rounds. Each round had a pre-registered test, usually a blind sheet where paintings from a model
were ranked against "no-model controls": the same harness with uniform-random answers, or with fixed priors that never
read the prompt.

The first rounds trained tiny image students (a 33M-parameter text-to-palette model distilled from an image generator,
then typed decision heads). They learned some prompt dependence but mostly painted grey or one flat colour, and never
met the "learned to paint" rule. Rounds 7 to 11 tried open vision and text models that imitate Jev, from 4B to 9B
parameters. They chose colours well but placed things no better than a constant centre box, and bigger models closed
only part of the gap.

Round 12 changed the approach to an "art director" harness: before every mark, code writes a short text state (the
request, the look, progress, a 5x5 grid of words read back from the real pixels) and asks a few typed questions
(which mark, where, which colour role); the model only answers with probabilities over fixed options, and code does
the geometry and the drawing. With the closed reference model the harness worked: its painting beat all three controls
in 9 of 12 blind scenes. The no-model controls were the important finding, because they often looked as good as the
open models.

Round 13 sharpened the answers. Kev-4B, a 4B open model, then passed the blind reading under both judges (8 and 11 of
12 rows above both controls). It is the smallest model that passed, and at about 9 GB it is too big for a browser.

Rounds 14 and 15 tried to make a sub-1B model (Kev-0.6B) pass with harness-only levers, a colour engine and
self-distillation from Kev-4B. None of these passed. The harness without a model did better than the 0.6B model inside
it: in Round 15, for one judge, the no-model harness ranked above both controls in 7 of 12 rows, while the
0.6B model ranked above that no-model harness in only 2 of 12. No sub-1B model beat the control.

That result decided the live site. If the harness's structure does most of the work, an honest small page can use
that structure directly: the Director that answers the questions is rules plus authored recipes (about 60 scenes and a
word parser), with per-phase weights computed from Kev-4B's recorded answers (Apache-2.0). There is no model inside.
The Director is an interface ([docs/DIRECTOR.md](DIRECTOR.md)), so a browser model can be plugged in later without
changing the page or the renderer. The harness itself is specified in [docs/harness-spec.md](harness-spec.md) and its
Python reference renderer is in [harness/](../harness/).

Credit: the idea of a painter driven by a model's typed answers comes from danmana/jev-paints
(github.com/danmana/jev-paints). This project does not use its code or lists.
