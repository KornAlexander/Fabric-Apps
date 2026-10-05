"""Fetch the core tier's survey tiles from whichever state surveyed the AOI.

The AOI's `geobasis.provider` decides the fetcher, never the site id: a second AOI in the same
state needs no code, and a site id cannot quietly route to the wrong authority.

  bavaria  (default; the Munich AOIs predate the field)  fetch_bvv.py
  hamburg  LGV Hamburg, whole-city archives read over HTTP ranges   fetch_hamburg.py
  lgl-bw   LGL Baden-Wuerttemberg, 2 km ZIPs                        fetch_lgl.py

All three write the same caches (data/dgm1/<aoi>/*.tif, data/lod2/<aoi>/*.gml), which is the
contract build_terrain.py and build_lod2_mesh.py read.

Usage
  python tools/geodata/fetch_geobasis.py --aoi hamburg-centre --product dgm1
  python tools/geodata/fetch_geobasis.py --aoi stuttgart-centre --product lod2 -- --mirror D:/zips
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from aoi import load_aoi

HERE = Path(__file__).resolve().parent

FETCHERS = {
    "bavaria": "fetch_bvv.py",
    "hamburg": "fetch_hamburg.py",
    "lgl-bw": "fetch_lgl.py",
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", required=True)
    parser.add_argument("--product", default="dgm1", choices=("dgm1", "lod2"))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("extra", nargs=argparse.REMAINDER, help="passed through after --")
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    provider = str((cfg.get("geobasis") or {}).get("provider", "bavaria"))
    if provider not in FETCHERS:
        raise SystemExit(f"AOI {cfg['id']}: unknown geobasis.provider {provider!r}; known: {', '.join(FETCHERS)}")

    command = [sys.executable, str(HERE / FETCHERS[provider]), "--aoi", cfg["id"], "--product", args.product]
    if args.dry_run:
        command.append("--dry-run")
    command += [part for part in args.extra if part != "--"]
    print(f"{cfg['id']}: geobasis provider {provider} -> {FETCHERS[provider]}")
    return subprocess.run(command, check=False).returncode


if __name__ == "__main__":
    sys.exit(main())
