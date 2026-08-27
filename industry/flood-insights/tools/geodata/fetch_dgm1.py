"""Download the DGM1 terrain tiles covering an AOI from LVermGeo Rheinland-Pfalz.

DGM1 is the 1 m digital terrain model — the elevation surface the whole flood simulation stands on
(PLAN §4.1, §6). It is open data under dl-de/by-2-0.

Access route (found 2026-07-27, see docs/terrain-sources.md):
  the GeoShop product page is driven by https://geoshop.rlp.de/files/anpassungen/hvd/products/dgm1.json
  which points at Metalink (.meta4) catalogues per administrative unit:
    https://geobasis-rlp.de/data/dgm1/current/meta4/dgm1_tif_07<kreisschluessel>.meta4
  Each entry gives the tile URL, size and a SHA-256 hash. Tiles are 1 km squares named
    dgm1_32_<easting_km>_<northing_km>_1_rp_<year>.tif
  so the AOI can be turned into a tile list arithmetically.

Usage
  python tools/geodata/fetch_dgm1.py --dry-run          # list tiles + total size
  python tools/geodata/fetch_dgm1.py --out data/raw/dgm1

Attribution: © GeoBasis-DE / LVermGeoRP <Jahr>, dl-de/by-2-0, www.lvermgeo.rlp.de [Daten bearbeitet]
"""

from __future__ import annotations

import argparse
import hashlib
import re
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

from aoi import load_aoi, raw_dir
from utm import bbox_to_utm32

META4_BASE = "https://geobasis-rlp.de/data/dgm1/current/meta4"
METALINK_NS = {"m": "urn:ietf:params:xml:ns:metalink"}

# Whole-of-Rheinland-Pfalz catalogue. A per-Kreis catalogue (e.g. 07131 for Landkreis Ahrweiler)
# is smaller, but an AOI that straddles a district boundary then silently loses its edge tiles —
# which is exactly what happened on the first run. The AOI decides which tiles are kept, so
# searching the full state catalogue costs one larger XML parse and removes a whole class of bug.
DEFAULT_KREIS = ""

TILE_RE = re.compile(r"dgm1_32_(\d{3})_(\d{4})_1_rp_(\d{4})\.tif")


def fetch_catalogue(kreis: str) -> list[dict]:
    url = f"{META4_BASE}/dgm1_tif_07{kreis}.meta4"
    print(f"catalogue: {url}")
    with urllib.request.urlopen(url, timeout=120) as resp:  # noqa: S310 - fixed https host
        root = ET.parse(resp).getroot()

    tiles = []
    for file_el in root.findall("m:file", METALINK_NS):
        name = file_el.get("name", "")
        match = TILE_RE.fullmatch(name)
        if not match:
            continue
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
    print(f"  {len(tiles)} DGM1 tiles in the catalogue")
    return tiles


def select_tiles(tiles: list[dict], bbox_utm: tuple[float, float, float, float]) -> list[dict]:
    """Keep tiles whose 1 km square intersects the AOI envelope."""
    min_e, min_n, max_e, max_n = bbox_utm
    east_lo, east_hi = int(min_e // 1000), int(max_e // 1000)
    north_lo, north_hi = int(min_n // 1000), int(max_n // 1000)
    print(f"  tile range: E {east_lo}..{east_hi} km, N {north_lo}..{north_hi} km")

    selected = [
        t
        for t in tiles
        if east_lo <= t["eastKm"] <= east_hi and north_lo <= t["northKm"] <= north_hi
    ]
    return sorted(selected, key=lambda t: (t["northKm"], t["eastKm"]))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(tile: dict, out_dir: Path) -> bool:
    target = out_dir / tile["name"]
    if target.exists() and tile["sha256"] and sha256(target) == tile["sha256"]:
        return False  # already have it, verified
    with urllib.request.urlopen(tile["url"], timeout=300) as resp:  # noqa: S310
        target.write_bytes(resp.read())
    if tile["sha256"] and sha256(target) != tile["sha256"]:
        target.unlink()
        raise RuntimeError(f"checksum mismatch for {tile['name']}")
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="ahrtal-2021")
    parser.add_argument(
        "--kreis",
        default=DEFAULT_KREIS,
        help="Kreisschluessel suffix to narrow the catalogue; empty means the whole state",
    )
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--dry-run", action="store_true", help="list tiles without downloading")
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    # Raw data lives per AOI. Resolved here rather than in the argparse
    # default, which runs before the config is known.
    args.out = args.out or raw_dir("dgm1", cfg["id"])
    b = cfg["bbox"]
    bbox_utm = bbox_to_utm32(b["west"], b["south"], b["east"], b["north"])
    print(f"AOI {cfg['id']}")
    print(f"  bbox WGS84: {b['west']}..{b['east']} E, {b['south']}..{b['north']} N")
    print(
        "  bbox UTM32: "
        f"{bbox_utm[0]:.0f}..{bbox_utm[2]:.0f} E, {bbox_utm[1]:.0f}..{bbox_utm[3]:.0f} N"
    )

    tiles = fetch_catalogue(args.kreis)
    selected = select_tiles(tiles, bbox_utm)
    total_mb = sum(t["bytes"] for t in selected) / 1024 / 1024
    years = sorted({t["year"] for t in selected})
    print(f"\nselected {len(selected)} tiles, {total_mb:.0f} MB, acquisition years {years}")

    if args.dry_run:
        for t in selected[:10]:
            print(f"  {t['name']}  {t['bytes'] / 1024:.0f} KB")
        if len(selected) > 10:
            print(f"  ... and {len(selected) - 10} more")
        return

    args.out.mkdir(parents=True, exist_ok=True)
    fetched = 0
    for i, tile in enumerate(selected, start=1):
        if download(tile, args.out):
            fetched += 1
        print(f"  [{i}/{len(selected)}] {tile['name']}", end="\r")
    print(f"\ndownloaded {fetched} new tile(s) into {args.out}; {len(selected)} verified in total")


if __name__ == "__main__":
    main()
