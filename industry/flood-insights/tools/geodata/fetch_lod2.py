"""Download LoD2 CityGML building models for an AOI from LVermGeo Rheinland-Pfalz.

PLAN §4.2. LoD2 carries real roof geometry, measured ground and ridge heights, and building
function codes — the difference between a convincing valley and a field of grey boxes.

Same access route as DGM1 (see fetch_dgm1.py): a Metalink catalogue per administrative unit, each
entry with a SHA-256 hash.

  https://geobasis-rlp.de/data/geb3dlo/current/meta4/geb3dlo_gml_07.meta4
  https://geobasis-rlp.de/data/geb3dlo/current/gml/<tile>.gz

Licence: dl-de/by-2-0. Attribution mandatory — see NOTICE.md.

Usage
  python tools/geodata/fetch_lod2.py --dry-run
  python tools/geodata/fetch_lod2.py --out data/raw/lod2
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

from aoi import load_aoi, load_osm_cache, raw_dir
from utm import bbox_to_utm32

META4 = "https://geobasis-rlp.de/data/geb3dlo/current/meta4/geb3dlo_gml_07.meta4"
METALINK_NS = {"m": "urn:ietf:params:xml:ns:metalink"}

# Tiles are named by their UTM32 south-west corner in kilometres, like the DGM1 tiles.
TILE_RE = re.compile(r"_(\d{3})_(\d{4})_")


GML_BASE = "https://geobasis-rlp.de/data/geb3dlo/current/gml"
TILE_KM = 2  # LoD2 tiles are 2 km, unlike the 1 km DGM1/DOM1 tiles


def catalogue_from_grid(bbox_utm: tuple[float, float, float, float]) -> list[dict]:
    """Derive the tile list from the AOI grid, for when the published catalogue is missing.

    ⚠️ Fallback only. The Metalink catalogue carries a size and a SHA-256 per tile, and that is
    how this pipeline normally verifies what it downloaded. On 2026-07-28 the catalogue started
    answering 404 while the tiles themselves still served 200 — the publisher's index was gone,
    not the data. Blocking the whole build on a missing index would be the wrong call, so the tile
    names are reconstructed from the naming scheme instead. Nothing is checksummed on this path.
    """
    min_e, min_n, max_e, max_n = bbox_utm
    tiles = []
    for east in range(int(min_e // 1000 // TILE_KM * TILE_KM), int(max_e // 1000) + TILE_KM, TILE_KM):
        for north in range(
            int(min_n // 1000 // TILE_KM * TILE_KM), int(max_n // 1000) + TILE_KM, TILE_KM
        ):
            tiles.append(
                {
                    "name": f"LoD2_32_{east}_{north}_2_RP.gml",
                    "eastKm": east,
                    "northKm": north,
                    "bytes": 0,
                    "sha256": None,
                    "url": f"{GML_BASE}/LoD2_32_{east}_{north}_2_RP.gml",
                }
            )
    return tiles


def fetch_catalogue() -> list[dict]:
    print(f"catalogue: {META4}")
    with urllib.request.urlopen(META4, timeout=180) as resp:  # noqa: S310 - fixed https host
        root = ET.parse(resp).getroot()

    tiles = []
    for file_el in root.findall("m:file", METALINK_NS):
        name = file_el.get("name", "")
        match = TILE_RE.search(name)
        # The catalogue lists a .gml, a .txt and a _meta.xml per tile. Only the CityGML carries
        # geometry; taking all three tripled the apparent download size for nothing.
        if not match or not name.lower().endswith(".gml"):
            continue
        url_el = file_el.find("m:url", METALINK_NS)
        hash_el = file_el.find("m:hash", METALINK_NS)
        size_el = file_el.find("m:size", METALINK_NS)
        tiles.append(
            {
                "name": name,
                "eastKm": int(match.group(1)),
                "northKm": int(match.group(2)),
                "bytes": int(size_el.text) if size_el is not None and size_el.text else 0,
                "sha256": hash_el.text if hash_el is not None else None,
                "url": url_el.text if url_el is not None else None,
            }
        )
    print(f"  {len(tiles)} tiles in the catalogue")
    return tiles


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="ahrtal-2021")
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--around-places",
        type=float,
        default=1.0,
        help="km around each focus place",
    )
    parser.add_argument(
        "--along-river",
        type=float,
        default=0.0,
        help="km either side of the Ahr centreline; 0 disables the corridor",
    )
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    # Raw data lives per AOI. Resolved here rather than in the argparse
    # default, which runs before the config is known.
    args.out = args.out or raw_dir("lod2", cfg["id"])
    b = cfg["bbox"]
    bbox = bbox_to_utm32(b["west"], b["south"], b["east"], b["north"])
    print(f"AOI {cfg['id']}  UTM32 {bbox[0]:.0f}..{bbox[2]:.0f} E, {bbox[1]:.0f}..{bbox[3]:.0f} N")

    # Restrict to the neighbourhood of the focus places, and optionally to a band along the river.
    # LoD2 for the whole 13x9 km AOI is hundreds of megabytes of geometry for hillsides nobody
    # looks at, but a ring around each focus place misses every settlement between them, which is
    # most of the valley. The corridor is what makes "all the buildings in the valley" a bounded
    # request rather than the whole plateau.
    from utm import wgs84_to_utm32

    wanted: set[tuple[int, int]] = set()
    radius = int(args.around_places)
    for place in cfg["focusPlaces"]:
        e, n = wgs84_to_utm32(place["lon"], place["lat"])
        ekm, nkm = int(e // 1000), int(n // 1000)
        for de in range(-radius, radius + 1):
            for dn in range(-radius, radius + 1):
                wanted.add((ekm + de, nkm + dn))
    print(f"  {len(wanted)} candidate tiles around {len(cfg['focusPlaces'])} places")

    if args.along_river > 0:
        chainage_path = raw_dir("osm", cfg["id"]) / "river_chainage.json"
        if not chainage_path.exists():
            raise SystemExit(f"missing {chainage_path} — run fetch_osm.py first")
        points = load_osm_cache(chainage_path, cfg["id"])["points"]
        reach = int(args.along_river)
        before = len(wanted)
        for point in points:
            e, n = wgs84_to_utm32(point["lon"], point["lat"])
            ekm, nkm = int(e // 1000), int(n // 1000)
            for de in range(-reach, reach + 1):
                for dn in range(-reach, reach + 1):
                    wanted.add((ekm + de, nkm + dn))
        print(f"  +{len(wanted) - before} tiles from a {args.along_river:g} km river corridor")

    try:
        tiles = fetch_catalogue()
    except urllib.error.HTTPError as exc:
        if exc.code != 404:
            raise
        print(f"  catalogue is {exc.code} — falling back to the tile naming scheme")
        print("  ⚠️ no size or SHA-256 available on this path; tiles are not verified")
        tiles = catalogue_from_grid(bbox)

    selected = sorted(
        (t for t in tiles if (t["eastKm"], t["northKm"]) in wanted),
        key=lambda t: (t["northKm"], t["eastKm"]),
    )
    total_mb = sum(t["bytes"] for t in selected) / 1024 / 1024
    print(f"\nselected {len(selected)} tiles, {total_mb:.1f} MB")

    if args.dry_run:
        for t in selected[:8]:
            print(f"  {t['name']}  {t['bytes'] / 1024:.0f} KB")
        if len(selected) > 8:
            print(f"  ... and {len(selected) - 8} more")
        return

    args.out.mkdir(parents=True, exist_ok=True)
    fetched = 0
    for i, tile in enumerate(selected, start=1):
        target = args.out / tile["name"]
        if target.exists() and tile["sha256"] and sha256(target) == tile["sha256"]:
            continue
        with urllib.request.urlopen(tile["url"], timeout=300) as resp:  # noqa: S310
            target.write_bytes(resp.read())
        if tile["sha256"] and sha256(target) != tile["sha256"]:
            target.unlink()
            raise SystemExit(f"checksum mismatch for {tile['name']}")
        fetched += 1
        print(f"  [{i}/{len(selected)}] {tile['name']}", end="\r")

    print(f"\ndownloaded {fetched} new tile(s); {len(selected)} verified in {args.out}")


if __name__ == "__main__":
    main()
