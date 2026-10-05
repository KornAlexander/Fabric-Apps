"""Download Baden-Wuerttemberg (LGL) survey tiles for an AOI: DGM1 terrain and LoD2 buildings.

LGL publishes its geobasis data openly (dl-de/by-2-0, attribution "Datenquelle: LGL,
www.lgl-bw.de, dl-de/by-2-0") on the Open GeoData portal as pre-cut ZIPs. Nothing needs a key.

⚠️ THE GRID IS 2 x 2 km, AND ITS SOUTH-WEST CORNERS SIT AT ODD EASTINGS AND EVEN NORTHINGS (km).
Snapping a box to the wrong parity asks for files that do not exist, and the portal answers 404
without saying why. Each ZIP holds four 1 km members:

  dgm1  /data/dgm/dgm1_32_{e}_{n}_2_bw.zip    -> dgm1_32_{e}_{n}_1_bw_<year>.xyz (CELL-CENTRE
        registered, `513000.50 5402999.50 251.79`, verified 2026-10-05), converted to GeoTIFF
  lod2  /data/lod2/LoD2_32_{e}_{n}_2_bw.zip   -> LoD2_32_{e}_{n}_1_BW.gml (plus a licence PDF and
        an INFO text, which are skipped)

ZIPs are cached under data/lgl/<product>/ (gitignored). `--mirror DIR` reads ZIPs already
downloaded elsewhere (another project's cache, for example) before going to the network.

Usage
  python tools/geodata/fetch_lgl.py --aoi stuttgart-centre --dry-run
  python tools/geodata/fetch_lgl.py --aoi stuttgart-centre
  python tools/geodata/fetch_lgl.py --aoi stuttgart-centre --product lod2 --mirror C:/path/to/zips
"""

from __future__ import annotations

import argparse
import math
import re
import shutil
import sys
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

from aoi import bbox_wsen, bind_cache, cache_dir, load_aoi
from raster import xyz_to_geotiff
from utm import bbox_to_utm

BASE = "https://opengeodata.lgl-bw.de"
USER_AGENT = "City-Utility-Twin/0.1 (open geodata pipeline; +https://opengeodata.lgl-bw.de)"

PRODUCTS: dict[str, tuple[str, str]] = {
    # product: (URL path template, member suffix)
    "dgm1": ("/data/dgm/dgm1_32_{e}_{n}_2_bw.zip", ".xyz"),
    "lod2": ("/data/lod2/LoD2_32_{e}_{n}_2_bw.zip", ".gml"),
}

CELL_KM = 2
#: The 1 km member's own south-west corner, parsed from its name (`..._32_513_5402_1_...`).
MEMBER_RE = re.compile(r"_32_(\d{3})_(\d{4})_1_", re.IGNORECASE)


def cells_for(bbox_utm: tuple[float, float, float, float]) -> list[tuple[int, int]]:
    """Every 2 km LGL cell (odd easting, even northing) that intersects the box."""
    min_e, min_n, max_e, max_n = bbox_utm
    e0 = math.floor(min_e / 1000)
    n0 = math.floor(min_n / 1000)
    if e0 % 2 == 0:
        e0 -= 1
    if n0 % 2 == 1:
        n0 -= 1
    return [
        (e, n)
        for e in range(e0, math.floor(max_e / 1000) + 1, CELL_KM)
        for n in range(n0, math.floor(max_n / 1000) + 1, CELL_KM)
    ]


def member_intersects(name: str, bbox_utm: tuple[float, float, float, float]) -> bool:
    match = MEMBER_RE.search(Path(name).name)
    if not match:
        return False
    e, n = int(match.group(1)) * 1000, int(match.group(2)) * 1000
    min_e, min_n, max_e, max_n = bbox_utm
    return e < max_e and e + 1000 > min_e and n < max_n and n + 1000 > min_n


def fetch_zip(url: str, target: Path, mirror: Path | None, attempts: int = 3) -> str:
    """Make sure `target` holds a complete ZIP for `url`. Returns how it got there."""
    if target.exists() and zipfile.is_zipfile(target):
        return "cached"
    if mirror and (mirror / target.name).exists() and zipfile.is_zipfile(mirror / target.name):
        shutil.copyfile(mirror / target.name, target)
        return "mirror"
    last = "no attempt"
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=600) as response:  # noqa: S310
                partial = target.with_suffix(".part")
                with open(partial, "wb") as out:
                    shutil.copyfileobj(response, out)
            # A truncated transfer or an HTML error page saved as .zip must not be cached.
            with zipfile.ZipFile(partial) as archive:
                bad = archive.testzip()
            if bad:
                raise RuntimeError(f"corrupt member {bad}")
            partial.replace(target)
            return "downloaded"
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return "not published"
            last = f"HTTP {exc.code}"
        except Exception as exc:  # noqa: BLE001 - network or corrupt, retried below
            last = str(exc)
        time.sleep(2 * (attempt + 1))
    raise SystemExit(f"{url}: failed after {attempts} attempts ({last})")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", required=True)
    parser.add_argument("--product", default="dgm1", choices=sorted(PRODUCTS))
    parser.add_argument("--mirror", type=Path, default=None, help="directory of already-downloaded ZIPs")
    parser.add_argument("--dry-run", action="store_true", help="list the cells, transfer nothing")
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    template, suffix = PRODUCTS[args.product]
    bbox_utm = bbox_to_utm(*bbox_wsen(cfg, "core"))
    cells = cells_for(bbox_utm)
    print(f"AOI {cfg['id']} (core), product {args.product}: {len(cells)} cells of {CELL_KM} km")

    if args.dry_run:
        for e, n in cells:
            print(f"  {BASE}{template.format(e=e, n=n)}")
        return 0

    zip_dir = cache_dir("lgl", args.product)
    out_dir = cache_dir(args.product, cfg["id"])
    out_suffix = ".tif" if suffix == ".xyz" else ".gml"
    # Collect first, write second: the cache binding needs the complete list of tiles this run
    # would write, so a stray tile from another vintage stops the build before anything changes.
    work: list[tuple[Path, str, Path, int, int]] = []
    for index, (e, n) in enumerate(cells, start=1):
        url = BASE + template.format(e=e, n=n)
        target = zip_dir / Path(url).name
        how = fetch_zip(url, target, args.mirror)
        print(f"  [{index}/{len(cells)}] {target.name}: {how}")
        if how == "not published":
            continue
        with zipfile.ZipFile(target) as archive:
            for info in archive.infolist():
                if info.is_dir() or not info.filename.lower().endswith(suffix):
                    continue
                if member_intersects(info.filename, bbox_utm):
                    work.append((target, info.filename, out_dir / (Path(info.filename).stem + out_suffix),
                                 info.CRC, info.file_size))
    bind_cache(out_dir, {"provider": "lgl-bw", "product": args.product, "base": BASE,
                         "members": sorted([out.name, crc, size] for _, _, out, crc, size in work)},
               {out.name for _, _, out, _, _ in work}, out_suffix)

    written = 0
    for zip_path, member, out, _, _ in work:
        if out.exists() and out.stat().st_size > 0:
            continue
        with zipfile.ZipFile(zip_path) as archive:
            payload = archive.read(member)
        if suffix == ".xyz":
            xyz_to_geotiff(payload, out)
        else:
            out.write_bytes(payload)
        written += 1

    tiles = len(list(out_dir.glob("*.tif" if suffix == ".xyz" else "*.gml")))
    print(f"\n{written} new files, {tiles} {args.product} tiles in {out_dir}")
    print((cfg.get("geobasis") or {}).get("attribution", ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
