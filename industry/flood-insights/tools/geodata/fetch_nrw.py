"""Download Geobasis NRW tiles covering an AOI — terrain, surface model and LoD2 buildings.

The Ahr's realism comes from four layers, three of which are state survey data. Rheinland-Pfalz
serves those through Metalink catalogues (see `fetch_dgm1.py`); North Rhine-Westphalia serves an
`index.json` per product instead, so the Steinbach corridor needs its own fetcher rather than a
flag on the RLP one. The two authorities also differ in licence, which is a reason to keep them
visibly apart rather than behind one abstraction:

    Rheinland-Pfalz   dl-de/by-2-0    attribution required
    North Rhine-West. dl-de/zero-2-0  no conditions

Products (verified against the live catalogue on 2026-07-29):

    dgm1    1 m digital terrain model, GeoTIFF   dgm1_32_<E>_<N>_1_nw_<year>.tif
    dom1    1 m digital surface model, GeoTIFF   dom1_32_<E>_<N>_1_nw_<year>.tif
    lod2    LoD2 building models, CityGML        LoD2_32_<E>_<N>_1_NW.gml

⚠️ There is a fourth product, `ndom50`, which is DOM minus DGM already normalised to canopy
height — tempting, because it would save `build_vegetation.py` a subtraction. It is not used, for
two reasons. It is 50 cm rather than 1 m, so it would not line up with the terrain grid without
resampling; and its file names break the pattern every other product follows:

    dgm1_32_280_5652_1_nw_2022.tif      easting separated
    ndom50_32280_5652_1_nw_2023.tif     easting glued to the zone

A tile matcher written for the first spelling silently finds nothing in the second — this script
matched 0 of 48 ndom50 tiles on the first run while finding all 48 of the others, which is how
the difference was noticed rather than assumed.

Usage
  python tools/geodata/fetch_nrw.py --aoi steinbach-2021 --product dgm1 --dry-run
  python tools/geodata/fetch_nrw.py --aoi steinbach-2021 --product dgm1
  python tools/geodata/fetch_nrw.py --aoi steinbach-2021 --product all

Attribution: © GeoBasis-DE / BKG / Land NRW (<Jahr>), dl-de/zero-2-0
"""

from __future__ import annotations

import argparse
import json
import re
import urllib.error
import urllib.request
from pathlib import Path

from aoi import load_aoi, raw_dir
from utm import bbox_to_utm32

CATALOGUE = "https://www.opengeodata.nrw.de/produkte/geobasis/"

PRODUCTS = {
    "dgm1": {
        "path": "hm/dgm1_tiff/dgm1_tiff/",
        "pattern": re.compile(r"dgm1_32_(\d{3})_(\d{4})_1_nw_(\d{4})\.tif"),
        "what": "1 m terrain",
    },
    "dom1": {
        "path": "hm/dom1_tiff/dom1_tiff/",
        "pattern": re.compile(r"dom1_32_(\d{3})_(\d{4})_1_nw_(\d{4})\.tif"),
        "what": "1 m surface (trees + roofs)",
    },
    "lod2": {
        "path": "3dg/lod2_gml/lod2_gml/",
        "pattern": re.compile(r"LoD2_32_(\d{3})_(\d{4})_1_NW\.gml"),
        "what": "LoD2 buildings",
    },
}


def catalogue(product: str) -> list[dict]:
    """Every tile NRW publishes for one product, with name and byte size."""
    url = CATALOGUE + PRODUCTS[product]["path"] + "index.json"
    print(f"catalogue: {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "flut-insights"})
    with urllib.request.urlopen(req, timeout=180) as resp:  # noqa: S310 - fixed https host
        data = json.loads(resp.read().decode("utf-8"))
    datasets = data.get("datasets") or []
    if not datasets:
        raise SystemExit(f"{url} returned no datasets — the catalogue layout has changed")
    return datasets[0].get("files", [])


def tiles_for_aoi(product: str, bbox: dict) -> list[dict]:
    """The published tiles whose kilometre square intersects the AOI.

    NRW tiles are 1 km squares named after their south-west corner, so the AOI reduces to a range
    of whole kilometres in UTM32 and the match is arithmetic rather than geometric.
    """
    e0, n0, e1, n1 = bbox_to_utm32(bbox["west"], bbox["south"], bbox["east"], bbox["north"])
    east_km = range(int(e0 // 1000), int(e1 // 1000) + 1)
    north_km = range(int(n0 // 1000), int(n1 // 1000) + 1)
    wanted = {(e, n) for e in east_km for n in north_km}
    print(
        f"AOI covers E {min(east_km)}..{max(east_km)} km, N {min(north_km)}..{max(north_km)} km "
        f"-> {len(wanted)} kilometre squares"
    )

    pattern = PRODUCTS[product]["pattern"]
    selected = []
    for entry in catalogue(product):
        match = pattern.fullmatch(entry.get("name", ""))
        if not match:
            continue
        east, north = int(match.group(1)), int(match.group(2))
        if (east, north) in wanted:
            selected.append(
                {
                    "name": entry["name"],
                    "bytes": int(entry.get("size") or 0),
                    "url": CATALOGUE + PRODUCTS[product]["path"] + entry["name"],
                    "year": int(match.group(3)) if match.lastindex and match.lastindex >= 3 else None,
                }
            )

    missing = wanted - {
        (int(pattern.fullmatch(t["name"]).group(1)), int(pattern.fullmatch(t["name"]).group(2)))
        for t in selected
    }
    if missing:
        # Not fatal: NRW ends at the state border and the corridor runs close to it, so a square
        # with no tile is a real answer rather than a failure. Said out loud so a hole in the
        # terrain is never a surprise later.
        print(f"  {len(missing)} square(s) have no tile (state border or water): {sorted(missing)[:6]}")
    return sorted(selected, key=lambda t: t["name"])


def download(tile: dict, out: Path) -> bool:
    """Fetch one tile unless a complete copy is already on disk. Returns True if it downloaded."""
    target = out / tile["name"]
    if target.exists() and (tile["bytes"] == 0 or target.stat().st_size == tile["bytes"]):
        return False
    if target.exists():
        print(f"  {tile['name']}: {target.stat().st_size} B on disk, expected {tile['bytes']} — refetching")

    req = urllib.request.Request(tile["url"], headers={"User-Agent": "flut-insights"})
    try:
        with urllib.request.urlopen(req, timeout=600) as resp:  # noqa: S310 - fixed https host
            payload = resp.read()
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"{tile['name']}: HTTP {exc.code} from {tile['url']}") from exc

    # Write via a temporary name so an interrupted run cannot leave a half tile that the size
    # check above would then accept on the next pass.
    tmp = target.with_suffix(target.suffix + ".part")
    tmp.write_bytes(payload)
    tmp.replace(target)
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="steinbach-2021")
    parser.add_argument("--product", default="all", choices=[*PRODUCTS, "all"])
    parser.add_argument("--out", type=Path, default=None, help="override the per-AOI raw folder")
    parser.add_argument("--dry-run", action="store_true", help="list tiles and total size only")
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    geobasis = cfg.get("geobasis", {})
    authority = geobasis.get("authority", "")
    if "NRW" not in authority and "Nordrhein" not in authority:
        raise SystemExit(
            f"AOI '{cfg['id']}' names its survey authority as '{authority}'. This fetcher only "
            "serves Geobasis NRW — using it for another state would download tiles under the "
            "wrong licence and attribute them to the wrong issuer."
        )

    products = list(PRODUCTS) if args.product == "all" else [args.product]
    for product in products:
        print(f"\n=== {product} — {PRODUCTS[product]['what']} ===")
        selected = tiles_for_aoi(product, cfg["bbox"])
        total = sum(t["bytes"] for t in selected)
        print(f"{len(selected)} tiles, {total / 1024 / 1024:.1f} MB")
        years = sorted({t["year"] for t in selected if t["year"]})
        if years:
            # The Ahr's terrain is post-flood and the app says so everywhere. Whether NRW's is too
            # depends on when these were flown, so the answer travels with the download rather
            # than being assumed either way.
            print(f"acquisition years present: {years}")

        if args.dry_run:
            for t in selected[:8]:
                print(f"  {t['name']}  {t['bytes'] / 1024 / 1024:.1f} MB")
            continue

        out = args.out or raw_dir(product, cfg["id"])
        out.mkdir(parents=True, exist_ok=True)
        fetched = 0
        for i, tile in enumerate(selected, 1):
            if download(tile, out):
                fetched += 1
            if i % 10 == 0 or i == len(selected):
                print(f"  {i}/{len(selected)}")
        print(f"downloaded {fetched} new tile(s) into {out}; {len(selected)} verified in total")


if __name__ == "__main__":
    main()
