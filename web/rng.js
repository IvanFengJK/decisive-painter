// Portable seeded RNG: FNV-1a (32 bit) of a seed string -> mulberry32. The same seed string gives the same sequence in
// node and in every browser, and experiments/r17/portable_rng.py is its exact Python twin (DECISIONS.md D3).
// Draw shapes follow numpy's Generator so the renderer port reads like the Python original:
// random(), uniform(a, b), normal(mu, sigma) (Box-Muller, two draws per value, no caching), integers(lo, hi) (hi excluded).

export function fnv1a(str) {
  const bytes = new TextEncoder().encode(String(str));
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export class Rng {
  constructor(seed) {
    this.s = (typeof seed === "string" ? fnv1a(seed) : seed) >>> 0;
  }

  next32() {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  random() {
    return this.next32() / 4294967296;
  }

  uniform(a, b) {
    return a + (b - a) * this.random();
  }

  normal(mu = 0, sigma = 1) {
    const u1 = 1 - this.random();
    const u2 = this.random();
    return mu + sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  integers(lo, hi) {
    return lo + Math.floor(this.random() * (hi - lo));
  }

  /** Index drawn from weights (inverse CDF, one draw); weights need not sum to 1. */
  choice(weights) {
    let total = 0;
    for (const w of weights) total += Math.max(0, w);
    if (!(total > 0)) return Math.floor(this.random() * weights.length);
    let u = this.random() * total;
    for (let i = 0; i < weights.length; i++) {
      u -= Math.max(0, weights[i]);
      if (u < 0) return i;
    }
    return weights.length - 1;
  }
}

/** The seed string rule: parts joined with "|", as in the Python harness's seed_of. */
export function seedString(...parts) {
  return parts.map(String).join("|");
}
