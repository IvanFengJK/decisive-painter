# Round 12 renderer (own implementation; Pillow + numpy only). A gesture's decisions -> strokes on a paper canvas.
# Deterministic: every random choice comes from a generator seeded with sha256(painting id, step), so the same
# decisions always give the same picture. Frozen before any model run.
import hashlib
import math

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from lists import COMPOSITIONS, GRID, LINEAR, PALETTES, grid_box

W = 600
MEDIUM = {  # base width px, base alpha, grain power, blur px, blend
    "pencil": (2.0, 0.60, 1.6, 0.0, "over"),
    "ink pen": (2.2, 0.95, 0.0, 0.0, "over"),
    "felt marker": (9.0, 0.55, 0.2, 0.4, "glaze"),
    "charcoal": (7.0, 0.80, 1.4, 1.2, "over"),
    "watercolour": (15.0, 0.62, 0.5, 3.5, "glaze"),
    "oil pastel": (8.0, 0.92, 0.8, 0.3, "over"),
}
WEIGHT = {"light": (0.55, 0.75), "medium": (0.85, 1.0), "heavy": (1.0, 1.35)}  # alpha mult, width mult
STROKE = {  # jitter px, extra blur, broken dashes, overshoot
    "calm and even": (1.5, 0.0, False, 0.0),
    "energetic and loose": (4.5, 0.0, False, 0.12),
    "precise and controlled": (0.6, 0.0, False, 0.0),
    "rough and broken": (3.0, 0.0, True, 0.04),
    "soft and blended": (2.5, 1.6, False, 0.02),
}
SIZE = {"small": 0.38, "medium": 0.62, "large": 0.92}


def hexrgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32) / 255.0


def seed_of(*parts):
    return int(hashlib.sha256("|".join(map(str, parts)).encode()).hexdigest()[:15], 16)


def place_box(composition, place):
    return grid_box(place) if place in GRID else COMPOSITIONS[composition]["places"][place]


# ---------------------------------------------------------------------------------------------- strokes
def jitter_line(pts, rng, amp, broken):
    """Subdivide a polyline and push points sideways by smooth noise; optionally break it into dashes."""
    pts = np.asarray(pts, dtype=np.float32)
    out = [pts[0]]
    for a, b in zip(pts[:-1], pts[1:]):
        n = max(2, int(np.linalg.norm(b - a) / 6))
        for t in np.linspace(0, 1, n + 1)[1:]:
            out.append(a + (b - a) * t)
    out = np.array(out)
    if amp > 0 and len(out) > 2:
        noise = rng.normal(0, amp, (len(out), 2)).astype(np.float32)
        k = np.ones(min(5, len(out))) / min(5, len(out))
        noise = np.stack([np.convolve(noise[:, i], k, mode="same") for i in range(2)], 1) * 1.8
        out = out + noise
    segs = [out]
    if broken and len(out) > 8:
        segs, i = [], 0
        while i < len(out) - 1:
            L = int(rng.integers(4, 14)); segs.append(out[i:i + L + 1]); i += L + int(rng.integers(1, 4))
    return [s for s in segs if len(s) >= 2]


def draw_lines(draw, lines, rng, width, amp, broken, value=255):
    for ln in lines:
        for seg in jitter_line(ln, rng, amp, broken):
            w = max(1, int(round(width * rng.uniform(0.75, 1.25))))
            draw.line([tuple(p) for p in seg], fill=int(value * rng.uniform(0.75, 1.0)), width=w, joint="curve")


def shape_polygon(kind, bx, rng, amp):
    x0, y0, x1, y1 = bx
    cx, cy, w, h = (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0
    t = np.linspace(0, 2 * np.pi, 72, endpoint=False)

    def ell(rx, ry, ccx=cx, ccy=cy):
        return np.stack([ccx + rx * np.cos(t), ccy + ry * np.sin(t)], 1)
    if kind == "round disc":
        r = min(w, h) / 2; P = ell(r, r)
    elif kind == "tall oval":
        P = ell(min(w, 0.62 * h) / 2, h / 2)
    elif kind == "wide oval":
        P = ell(w / 2, min(h, 0.62 * w) / 2)
    elif kind == "low mound":
        tt = np.linspace(np.pi, 2 * np.pi, 48)
        P = np.concatenate([np.stack([cx + w / 2 * np.cos(tt), y1 + h * np.sin(tt)], 1), [[x1, y1], [x0, y1]]])
    elif kind == "pointed triangle":
        P = np.array([[cx, y0], [x1, y1], [x0, y1]], dtype=float)
    elif kind == "wedge":
        P = np.array([[x0, y1], [x1, y1], [x1, y0]] if rng.random() < 0.5 else [[x0, y0], [x0, y1], [x1, y1]], dtype=float)
    elif kind == "upright column":
        cw = 0.42 * w; P = np.array([[cx - cw / 2, y0], [cx + cw / 2, y0], [cx + cw / 2, y1], [cx - cw / 2, y1]], dtype=float)
    elif kind == "horizontal band":
        bh = min(h, max(0.35 * h, 0.18 * w)); P = np.array([[x0, cy - bh / 2], [x1, cy - bh / 2], [x1, cy + bh / 2], [x0, cy + bh / 2]], dtype=float)
    else:  # block, broad wash
        P = np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], dtype=float)
    # resample the outline and wobble it
    Q = []
    for a, b in zip(P, np.roll(P, -1, 0)):
        n = max(2, int(np.linalg.norm(b - a) / 8))
        Q.extend(a + (b - a) * s for s in np.linspace(0, 1, n, endpoint=False))
    Q = np.array(Q)
    wob = rng.normal(0, amp * 1.4 + (6 if kind == "broad wash" else 1.0), (len(Q), 2))
    k = np.ones(7) / 7
    wob = np.stack([np.convolve(np.pad(wob[:, i], 3, mode="wrap"), k, mode="valid") for i in range(2)], 1)
    return Q + wob


def fill_strokes(kind, bx, rng, width, spacing_mult, angle=None):
    """Parallel strokes across the box (clipped later by the shape mask)."""
    x0, y0, x1, y1 = bx
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    if angle is None:
        angle = {"horizontal band": 0.0, "upright column": 90.0, "low mound": 8.0, "broad wash": 0.0}.get(kind, rng.uniform(-35, 35))
    th = math.radians(angle + rng.normal(0, 4))
    d = np.array([math.cos(th), math.sin(th)]); nrm = np.array([-d[1], d[0]])
    R = math.hypot(x1 - x0, y1 - y0) / 2 + 4
    gap = max(2.0, width * spacing_mult)
    lines = []
    for off in np.arange(-R, R, gap):
        c = np.array([cx, cy]) + nrm * (off + rng.normal(0, gap * 0.15))
        L = R * rng.uniform(0.85, 1.05)
        lines.append([c - d * L, c + d * L])
    return lines


def linear_strokes(kind, bx, rng, width):
    x0, y0, x1, y1 = bx
    w, h = x1 - x0, y1 - y0
    U = lambda a, b: rng.uniform(a, b)
    L = []
    if kind == "vertical hatching":
        for _ in range(int(rng.integers(6, 15))):
            x = U(x0, x1); a = U(y0, y0 + 0.3 * h); L.append([[x, a], [x + U(-3, 3), a + U(0.5, 1.0) * (y1 - a)]])
    elif kind == "horizontal dashes":
        for _ in range(int(rng.integers(6, 15))):
            y = U(y0, y1); a = U(x0, x0 + 0.4 * w); L.append([[a, y], [a + U(0.3, 0.9) * (x1 - a), y + U(-3, 3)]])
    elif kind == "slanted strokes":
        for _ in range(int(rng.integers(7, 16))):
            x, y = U(x0, x1), U(y0, y1); s = U(0.15, 0.35) * max(w, h); L.append([[x - s * 0.5, y + s], [x + s * 0.5, y - s]])
    elif kind == "cross-hatching":
        for sgn in (1, -1):
            for _ in range(int(rng.integers(6, 12))):
                x, y = U(x0, x1), U(y0, y1); s = U(0.15, 0.3) * max(w, h); L.append([[x - s, y - sgn * s], [x + s, y + sgn * s]])
    elif kind == "flowing ribbon":
        xs = np.linspace(x0, x1, 40); ph = U(0, 6.28); amp = U(0.15, 0.4) * h; cy = U(y0 + 0.3 * h, y1 - 0.3 * h)
        L.append(np.stack([xs, cy + amp * np.sin(ph + (xs - x0) / max(w, 1) * U(4, 9))], 1))
    elif kind == "stacked arcs":
        n = int(rng.integers(3, 7))
        for i in range(n):
            cy = y0 + (i + 1) * h / (n + 1); cx = U(x0 + 0.3 * w, x1 - 0.3 * w); rx = U(0.2, 0.5) * w; ry = U(0.1, 0.3) * h
            t = np.linspace(math.pi, 2 * math.pi, 24); L.append(np.stack([cx + rx * np.cos(t), cy + ry * np.sin(t)], 1))
    elif kind == "zigzag":
        n = int(rng.integers(6, 13)); xs = np.linspace(x0, x1, n); ys = [y0 + h * (0.2 if i % 2 else 0.8) + U(-0.1, 0.1) * h for i in range(n)]
        L.append(np.stack([xs, ys], 1))
    elif kind == "outline loop":
        t = np.linspace(0, 2 * math.pi, 60); cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        for _ in range(2):
            L.append(np.stack([cx + w / 2 * U(0.92, 1.0) * np.cos(t), cy + h / 2 * U(0.92, 1.0) * np.sin(t)], 1))
    elif kind == "tangled scribble":
        p = np.array([U(x0, x1), U(y0, y1)]); v = rng.normal(0, 1, 2); pts = []
        for _ in range(int(rng.integers(90, 200))):
            v = 0.8 * v + rng.normal(0, 1.2, 2); p = np.clip(p + v * max(w, h) * 0.03, [x0, y0], [x1, y1]); pts.append(p.copy())
        L.append(np.array(pts))
    return L


# ---------------------------------------------------------------------------------------------- canvas
class Canvas:
    def __init__(self, paper_hex, painting_id, size=W):
        self.n = size
        rng = np.random.default_rng(seed_of(painting_id, "paper"))
        base = hexrgb(paper_hex)
        low = Image.fromarray((rng.random((size // 8, size // 8)) * 255).astype(np.uint8)).resize((size, size), Image.BICUBIC)
        lowf = (np.asarray(low, np.float32) / 255 - 0.5) * 0.035
        self.grain = np.asarray(Image.fromarray((rng.random((size, size)) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8)), np.float32) / 255
        self.grain = (self.grain - self.grain.min()) / (self.grain.max() - self.grain.min() + 1e-6)
        self.px = np.clip(base[None, None, :] + lowf[..., None] + (self.grain[..., None] - 0.5) * 0.02, 0, 1).astype(np.float32)
        self.painting_id = painting_id

    def gesture(self, step, d, composition, colour_hex, stroke_char):
        """d: {gesture, place, size, medium, fill, weight}; colour already resolved to hex."""
        rng = np.random.default_rng(seed_of(self.painting_id, step))
        n = self.n
        bw0, bh0 = place_box(composition, d["place"])[0::2], place_box(composition, d["place"])[1::2]
        x0, x1 = bw0[0] * n, bw0[1] * n; y0, y1 = bh0[0] * n, bh0[1] * n
        f = SIZE[d["size"]] if d["gesture"] != "broad wash" else max(SIZE[d["size"]], 0.75)
        w, h = (x1 - x0) * f, (y1 - y0) * f
        cx = rng.uniform(x0 + w / 2, x1 - w / 2) if x1 - x0 > w else (x0 + x1) / 2
        cy = rng.uniform(y0 + h / 2, y1 - h / 2) if y1 - y0 > h else (y0 + y1) / 2
        bx = (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)
        base_w, alpha, grain_p, blur, blend = MEDIUM[d["medium"]]
        a_mult, w_mult = WEIGHT[d["weight"]]
        amp, sblur, broken, over = STROKE[stroke_char]
        width = base_w * w_mult * (n / 600)
        if over:
            ex, ey = (bx[2] - bx[0]) * over, (bx[3] - bx[1]) * over; bxs = (bx[0] - ex, bx[1] - ey, bx[2] + ex, bx[3] + ey)
        else:
            bxs = bx
        m = Image.new("L", (n, n), 0); dr = ImageDraw.Draw(m)
        g = d["gesture"]
        if g in LINEAR:
            draw_lines(dr, linear_strokes(g, bxs, rng, width), rng, width * (2.4 if g == "flowing ribbon" else 1.0), amp, broken)
        if g == "dotted speckle":
            x0b, y0b, x1b, y1b = bxs
            for _ in range(int(rng.integers(60, 200))):
                x, y = rng.uniform(x0b, x1b), rng.uniform(y0b, y1b); r = max(1.0, width * rng.uniform(0.4, 0.9))
                dr.ellipse([x - r, y - r, x + r, y + r], fill=int(255 * rng.uniform(0.7, 1)))
        if g not in LINEAR:
            poly = shape_polygon(g, bxs, rng, amp)
            shape = Image.new("L", (n, n), 0); ImageDraw.Draw(shape).polygon([tuple(p) for p in poly], fill=255)
            fill = d["fill"] if g != "broad wash" else ("thin wash" if d["fill"] in ("thin wash", "solid fill") else d["fill"])
            if fill == "outline only":
                draw_lines(dr, [np.vstack([poly, poly[:1]])], rng, width * 1.1, amp, broken)
            else:
                if fill == "thin wash":
                    sm = shape.filter(ImageFilter.GaussianBlur(max(2.0, 0.03 * max(w, h))))
                    m = Image.fromarray((np.asarray(sm, np.float32) * 0.9).astype(np.uint8)); dr = ImageDraw.Draw(m)
                    draw_lines(dr, fill_strokes(g, bxs, rng, width * 2.5, 1.6), rng, width * 2.5, amp, broken, value=170)
                elif fill == "hatched fill":
                    draw_lines(dr, fill_strokes(g, bxs, rng, width, 3.2, angle=45.0), rng, width, amp, broken)
                else:  # solid fill
                    draw_lines(dr, fill_strokes(g, bxs, rng, width, 0.55), rng, width * 1.15, amp, broken)
                m = Image.fromarray((np.asarray(m, np.float32) * np.asarray(shape.filter(ImageFilter.GaussianBlur(1.0)), np.float32) / 255).astype(np.uint8))
        if blur + sblur > 0:
            m = m.filter(ImageFilter.GaussianBlur(blur + sblur))
        M = np.asarray(m, np.float32) / 255
        if grain_p > 0:
            M = M * (0.35 + 0.65 * self.grain ** grain_p)
        if d["medium"] == "watercolour":  # pigment gathers at the edges of a wash
            edge = np.clip(M - np.asarray(Image.fromarray((M * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(4)), np.float32) / 255, 0, 1)
            M = np.clip(M * 0.85 + edge * 1.4, 0, 1)
        A = np.clip(M * alpha * a_mult, 0, 1)[..., None]
        col = hexrgb(colour_hex)[None, None, :]
        if blend == "glaze":
            self.px = self.px * (1 - A) + (0.55 * self.px * col + 0.45 * col) * A
        else:
            self.px = self.px * (1 - A) + col * A
        return bx

    def image(self, out=None):
        im = Image.fromarray((np.clip(self.px, 0, 1) * 255).astype(np.uint8))
        return im if out is None else im.resize((out, out), Image.LANCZOS)


# ---------------------------------------------------------------------------------------------- read-back
def _lab(rgb):
    c = np.where(rgb > 0.04045, ((rgb + 0.055) / 1.055) ** 2.4, rgb / 12.92)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = c @ M.T / np.array([0.9505, 1.0, 1.089])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def readback(canvas, palette):
    """5x5 grid of phrases from real pixels: nearest of (paper, the 5 palette colours) in CIELAB per pixel."""
    cols, paper = PALETTES[palette]
    pp = hexrgb(paper)
    # targets: paper, the 5 colours, and their pale tints (halfway to the paper), so a light wash reads "pale X"
    names = ["paper"] + [c for c, _ in cols] + [f"pale {c}" for c, _ in cols]
    ref = _lab(np.stack([pp] + [hexrgb(h) for _, h in cols] + [(hexrgb(h) + pp) / 2 for _, h in cols]))
    px = canvas.px[::3, ::3]
    lab = _lab(px)
    idx = np.argmin(((lab[..., None, :] - ref[None, None]) ** 2).sum(-1), -1)
    n = idx.shape[0]
    out = {}
    for r, R in enumerate("ABCDE"):
        for c in range(5):
            cell = idx[r * n // 5:(r + 1) * n // 5, c * n // 5:(c + 1) * n // 5].ravel()
            counts = np.bincount(cell, minlength=len(names)) / cell.size
            cov = 1 - counts[0]
            paint = counts[1:]
            if cov < 0.05:
                out[f"{R}{c + 1}"] = "empty paper"; continue
            order = np.argsort(-paint)
            X, Y = names[order[0] + 1], names[order[1] + 1]
            share2 = paint[order[1]] / max(cov, 1e-6)
            mix = f"{X}, some {Y}" if share2 >= 0.2 else X
            if cov < 0.35:
                out[f"{R}{c + 1}"] = f"a little {X} on paper"
            elif cov < 0.75:
                out[f"{R}{c + 1}"] = f"{mix}, paper showing"
            else:
                out[f"{R}{c + 1}"] = f"mostly {mix}"
    return out
