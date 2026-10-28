"""Read access to the cached Berlin DGM1 (tools/fetch_dgm1.py) in EPSG:25833 metres.

Tiles are 2000 x 2000 cells of 1 m, uint16 centimetres, row 0 = north edge, 0 = no data.
A cell's centre is at (e0 + col + 0.5, n0 + 2000 - row - 0.5) for the tile with
south-west corner (e0, n0).
"""
from __future__ import annotations

from functools import lru_cache

import numpy as np

from bake_common import CACHE

DIR = CACHE / "dgm1"
TILE_M = 2000


def tile_keys() -> list[tuple[int, int]]:
    """South-west corners in metres of every cached tile."""
    keys = []
    for p in DIR.glob("*_*.npy"):
        if ".tmp" in p.name:
            continue
        e, n = p.stem.split("_")
        keys.append((int(e) * 1000, int(n) * 1000))
    return sorted(keys)


@lru_cache(maxsize=24)
def _tile(e0: int, n0: int) -> np.ndarray | None:
    p = DIR / f"{e0 // 1000}_{n0 // 1000}.npy"
    if not p.exists():
        return None
    g = np.load(p).astype(np.float32) / 100.0
    g[g == 0] = np.nan
    return g


def window(west: float, south: float, east: float, north: float) -> tuple[np.ndarray, float, float]:
    """1 m grid covering the box (cell-aligned, north row first) and the box's (west, north) edge.

    Cells without survey are NaN.
    """
    w, s = int(np.floor(west)), int(np.floor(south))
    e, n = int(np.ceil(east)), int(np.ceil(north))
    out = np.full((n - s, e - w), np.nan, dtype=np.float32)
    for te in range(w - w % TILE_M, e, TILE_M):
        for tn in range(s - s % TILE_M, n, TILE_M):
            t = _tile(te, tn)
            if t is None:
                continue
            # overlap in metres, then in each array's own rows (north first)
            x0, x1 = max(w, te), min(e, te + TILE_M)
            y0, y1 = max(s, tn), min(n, tn + TILE_M)
            if x0 >= x1 or y0 >= y1:
                continue
            out[n - y1 : n - y0, x0 - w : x1 - w] = t[tn + TILE_M - y1 : tn + TILE_M - y0, x0 - te : x1 - te]
    return out, float(w), float(n)


def sample(e: np.ndarray, n: np.ndarray) -> np.ndarray:
    """Nearest 1 m cell for each point; NaN where the survey has no value."""
    shape = np.shape(e)
    e = np.asarray(e, dtype=np.float64).ravel()
    n = np.asarray(n, dtype=np.float64).ravel()
    z = np.full(e.shape, np.nan, dtype=np.float64)
    te = (np.floor(e / TILE_M) * TILE_M).astype(np.int64)
    tn = (np.floor(n / TILE_M) * TILE_M).astype(np.int64)
    for key in set(zip(te.tolist(), tn.tolist())):
        t = _tile(*key)
        if t is None:
            continue
        sel = (te == key[0]) & (tn == key[1])
        col = np.clip(np.floor(e[sel] - key[0]).astype(np.int64), 0, TILE_M - 1)
        row = np.clip(TILE_M - 1 - np.floor(n[sel] - key[1]).astype(np.int64), 0, TILE_M - 1)
        z[sel] = t[row, col]
    return z.reshape(shape)
