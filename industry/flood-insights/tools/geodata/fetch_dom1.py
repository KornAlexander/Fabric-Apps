"""Download the DOM1 surface tiles covering an AOI from LVermGeo Rheinland-Pfalz.

DGM1 is the bare earth. DOM1 is the same grid but the *surface* — the first thing the laser hits,
so tree canopy and rooftops instead of the ground beneath them. The difference of the two is a
normalised height model, and that is where this app's trees come from: not scattered decoration,
but the measured height of the vegetation that actually stands there (PLAN §4.1, §2.2).

Same access route and licence as the terrain, so this mirrors fetch_dgm1.py and reuses its
catalogue selection, checksum and download logic rather than restating them:
  https://geobasis-rlp.de/data/dom1/current/meta4/dom1_tif_07<kreisschluessel>.meta4
  tiles: dom1_32_<easting_km>_<northing_km>_1_rp_<year>.tif  (1 km squares, ~3.7 MB each)

Usage
  python tools/geodata/fetch_dom1.py --dry-run
  python tools/geodata/fetch_dom1.py --out data/raw/dom1

Attribution: © GeoBasis-DE / LVermGeoRP <Jahr>, dl-de/by-2-0, www.lvermgeo.rlp.de [Daten bearbeitet]
"""

from __future__ import annotations

import argparse
import re
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

from aoi import load_aoi, raw_dir
from fetch_dgm1 import METALINK_NS, download, select_tiles
from utm import bbox_to_utm32

META4_BASE = "https://geobasis-rlp.de/data/dom1/current/meta4"
TILE_RE = re.compile(r"dom1_32_(\d{3})_(\d{4})_1_rp_(\d{4})\.tif")

# The whole-state catalogue, for the same reason as the terrain: an AOI on a district boundary
# silently loses its edge tiles from a per-Kreis catalogue.
DEFAULT_KREIS = ""


def fetch_catalogue(kreis: str) -> list[dict]:
    url = f"{META4_BASE}/dom1_tif_07{kreis}.meta4"
    print(f"catalogue: {url}")
    with urllib.request.urlopen(url, timeout=180) as resp:  # noqa: S310 - fixed https host
        root = ET.parse(resp).getroot()

    tiles = []
    for file_el in root.findall("m:file", METALINK_NS):
        name = file_el.get("name", "")
        match = TILE_RE.fullmatch(name)
        if not match:
            continue  # the catalogue also lists .tfw world files, which we do not need
        east_km, north_km, year = match.groups()
        hash_el = file_el.find("m:hash", METALINK_NS)
        url_el = file_el.find("m:url", METALINK_NS)
        size_el = file_el.find("m:size", METALINK_NS)
        tiles.append(
            {
                "name": name,
                "eastKm": int(east_km),
                "northKm": int(north_km),
                "year": int(year),
                "bytes": int(size_el.text) if size_el is not None and size_el.text else 0,
                "sha256": hash_el.text if hash_el is not None else None,
                "url": url_el.text if url_el is not None else None,
            }
        )
    print(f"  {len(tiles)} DOM1 tiles in the catalogue")
    return tiles


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="ahrtal-2021")
    parser.add_argument("--kreis", default=DEFAULT_KREIS)
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    aoi = load_aoi(args.aoi)
    # Raw data lives per AOI. Resolved here rather than in the argparse default, which runs
    # before the config is known.
    args.out = args.out or raw_dir("dom1", aoi["id"])
    bbox = aoi["bbox"]
    bbox_utm = bbox_to_utm32(bbox["west"], bbox["south"], bbox["east"], bbox["north"])

    tiles = select_tiles(fetch_catalogue(args.kreis), bbox_utm)
    total = sum(t["bytes"] for t in tiles)
    print(f"  {len(tiles)} tiles intersect the AOI, {total / 1e6:.0f} MB")

    if args.dry_run:
        for tile in tiles[:5]:
            print(f"    {tile['name']}  {tile['bytes'] / 1e6:.1f} MB")
        if len(tiles) > 5:
            print(f"    ... and {len(tiles) - 5} more")
        return

    args.out.mkdir(parents=True, exist_ok=True)
    fetched = 0
    for index, tile in enumerate(tiles, start=1):
        if download(tile, args.out):
            fetched += 1
        if index % 25 == 0 or index == len(tiles):
            print(f"  {index}/{len(tiles)} ({fetched} downloaded, rest already present)")
    print(f"done: {args.out}")


if __name__ == "__main__":
    main()
