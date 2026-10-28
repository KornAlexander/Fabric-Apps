"""Download the Berlin DGM1 (1 m terrain, DL-DE-Zero) and keep it as compact grids (PLAN D21).

The Atom feed lists 297 tiles of 2 km x 2 km, each a ZIP with one XYZ text file of
4 million "easting northing height" lines (about 17.5 MB zipped, 120 MB unzipped).
Text is useless to the bake, so every tile is parsed once into

  cache/dgm1/<e>_<n>.npy   uint16 centimetres above NHN, 2000 x 2000, row 0 = NORTH edge

and the ZIP is deleted afterwards (the whole city stays at about 2.4 GB instead of 5 GB
of ZIPs plus 36 GB of text). The file name is the tile's south-west corner in km,
exactly as the feed names it (`DGM1_390_5820.zip` covers E 390-392 km, N 5820-5822 km).

Cells the survey does not cover are 0 (no Berlin ground is at sea level).

  python tools/fetch_dgm1.py            # all tiles, resumable, 4 in parallel
  python tools/fetch_dgm1.py --limit 3  # first three, for a quick check
"""
from __future__ import annotations

import argparse
import io
import re
import sys
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
import pandas as pd

from bake_common import CACHE, get

FEED = "https://gdi.berlin.de/data/dgm1/atom/0.atom"
DIR = CACHE / "dgm1"
TILE_M = 2000


def tile_names() -> list[tuple[int, int]]:
    feed = get(FEED).decode("utf-8")
    keys = sorted({(int(e), int(n)) for e, n in re.findall(r"DGM1_(\d+)_(\d+)\.zip", feed)})
    if not keys:
        raise RuntimeError("DGM1 feed lists no tiles")
    return keys


def to_grid(xyz: bytes, e_km: int, n_km: int) -> np.ndarray:
    """XYZ text -> uint16 cm grid, north row first. Positions come from the coordinates, never the line order."""
    df = pd.read_csv(io.BytesIO(xyz), sep=r"\s+", header=None, names=["x", "y", "z"], dtype="float64", engine="c")
    col = np.floor(df["x"].to_numpy() - e_km * 1000).astype(np.int64)
    row = (TILE_M - 1) - np.floor(df["y"].to_numpy() - n_km * 1000).astype(np.int64)
    ok = (col >= 0) & (col < TILE_M) & (row >= 0) & (row < TILE_M)
    if (~ok).sum() > 0.01 * len(df):
        raise ValueError(f"{e_km}_{n_km}: {(~ok).sum()} points outside the tile, CRS or naming fault")
    grid = np.zeros((TILE_M, TILE_M), dtype=np.uint16)
    grid[row[ok], col[ok]] = np.clip(np.round(df["z"].to_numpy()[ok] * 100), 1, 65535).astype(np.uint16)
    return grid


def fetch_one(e_km: int, n_km: int) -> str:
    out = DIR / f"{e_km}_{n_km}.npy"
    if out.exists():
        return "cached"
    raw = get(f"https://gdi.berlin.de/data/dgm1/atom/DGM1_{e_km}_{n_km}.zip", timeout=300)
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        names = [i for i in z.infolist() if i.filename.lower().endswith(".xyz")]
        if len(names) != 1:
            raise ValueError(f"{e_km}_{n_km}: expected one .xyz, got {[i.filename for i in z.infolist()]}")
        grid = to_grid(z.read(names[0]), e_km, n_km)
    tmp = out.with_suffix(".tmp.npy")
    np.save(tmp, grid)
    tmp.replace(out)
    return f"{(grid > 0).mean() * 100:.0f} % covered"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()
    DIR.mkdir(parents=True, exist_ok=True)
    keys = tile_names()
    if args.limit:
        keys = keys[: args.limit]
    print(f"{len(keys)} DGM1 tiles", flush=True)
    failed = []
    with ThreadPoolExecutor(args.workers) as pool:
        jobs = {pool.submit(fetch_one, e, n): (e, n) for e, n in keys}
        for i, job in enumerate(as_completed(jobs), 1):
            e, n = jobs[job]
            try:
                print(f"[{i}/{len(keys)}] {e}_{n}: {job.result()}", flush=True)
            except Exception as ex:  # keep going, report at the end; a rerun resumes
                failed.append((e, n))
                print(f"[{i}/{len(keys)}] {e}_{n}: FAILED {ex}", flush=True)
    if failed:
        print(f"{len(failed)} failed, rerun to resume: {failed}")
        sys.exit(1)


if __name__ == "__main__":
    main()
