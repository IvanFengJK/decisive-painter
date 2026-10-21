# Round 17: exact Python twin of web/rng.js (FNV-1a 32-bit of the seed string -> mulberry32; Box-Muller normals, two draws
# each). Used only by render_portable.py so reference images can be regenerated from recorded decisions (DECISIONS.md D3).
import math

import numpy as np

M32 = 0xFFFFFFFF


def fnv1a(s):
    h = 0x811C9DC5
    for b in str(s).encode("utf-8"):
        h ^= b
        h = (h * 0x01000193) & M32
    return h


def _imul(a, b):
    return (a * b) & M32


class PortableRng:
    def __init__(self, seed):
        self.s = fnv1a(seed) if isinstance(seed, str) else seed & M32

    def next32(self):
        self.s = (self.s + 0x6D2B79F5) & M32
        t = self.s
        t = _imul(t ^ (t >> 15), t | 1)
        t ^= (t + _imul(t ^ (t >> 7), t | 61)) & M32
        return (t ^ (t >> 14)) & M32

    def _one(self):
        return self.next32() / 4294967296

    def _n(self, size):
        return int(np.prod(size)) if size is not None else None

    def random(self, size=None):
        if size is None:
            return self._one()
        return np.array([self._one() for _ in range(self._n(size))], dtype=np.float64).reshape(size)

    def uniform(self, a, b, size=None):
        if size is None:
            return a + (b - a) * self._one()
        return np.array([a + (b - a) * self._one() for _ in range(self._n(size))]).reshape(size)

    def _normal1(self, mu, sigma):
        u1 = 1 - self._one()
        u2 = self._one()
        return mu + sigma * math.sqrt(-2 * math.log(u1)) * math.cos(2 * math.pi * u2)

    def normal(self, mu=0.0, sigma=1.0, size=None):
        if size is None:
            return self._normal1(mu, sigma)
        return np.array([self._normal1(mu, sigma) for _ in range(self._n(size))]).reshape(size)

    def integers(self, lo, hi):
        return lo + int(math.floor(self._one() * (hi - lo)))
