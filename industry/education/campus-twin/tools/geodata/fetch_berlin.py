"""Download Berlin (Geoportal Berlin) survey tiles for an AOI tier — the fifth geobasis authority.

Added for TU Berlin, and it is the first site in this repository that is **not in UTM zone 32**.
Everything Berlin publishes is EPSG:25833, and that is not a detail about precision — it is a
detail about *file names*. Tile discovery here is arithmetic on the coordinate, exactly as
`fetch_bvv.py` describes ("tile discovery is arithmetic, not a catalogue"), and the arithmetic is
done on zone-33 kilometres. TU Berlin sits at E 386 km in zone 33 and E 793 km in zone 32; asking
for `DGM1_793_5827.zip` does not return a slightly shifted tile, it returns a 404. See the module
docstring in `utm.py` for why the zone travels with the AOI.

Everything here is **dl-de/zero-2-0** (Datenlizenz Deutschland – Zero – Version 2.0), the most
permissive licence of the five authorities in this pipeline: attribution is not even required. It
is given anyway, because the app states the provenance of every layer it draws.

⚠️ **THE TWO PRODUCTS ARE ON DIFFERENT GRIDS, AND BOTH ARE VERIFIED RATHER THAN ASSUMED.**
Measured 2026-08-26 by HEAD over a 5 × 4 km block around the campus:

  DGM1  2 km cells, **even** kilometres on BOTH axes.  `DGM1_384_5818` and `DGM1_386_5820` exist;
        `DGM1_383_*`, `DGM1_385_*` and `DGM1_*_5819` all 404. ~17 MB per cell.
  LoD2  1 km cells, **every** kilometre.  385, 386 and 387 all exist. 1.5–7 MB per cell.

Getting either parity wrong does not fail loudly: `cells_for` simply yields cells that 404, the
run reports "not published for this cell" for every one of them, and the build continues to a
heightmap with no data in it.

⚠️ **THE ARCHIVES DO NOT CONTAIN WHAT THEIR NAMES SUGGEST.** The DGM1 dataset is described in the
catalogue as "CSV, gezippt"; the member is actually `dgm1_33_370_5808_2_be.xyz`, whitespace-
separated `easting northing height` on a 1 m grid — the same ASCII XYZ Baden-Württemberg ships,
which is why `xyz_to_geotiff` is imported from `fetch_lgl_bw.py` rather than written a second time.
The LoD2 member is `LoD2_33_371_5809_1_BE.**xml**`, not `.gml`.

⚠️ **AND THAT `.xml` IS WHY THE EXTENSION IS REWRITTEN ON EXTRACTION.** `build_lod2_mesh.py` finds
its input with `source.glob("*.gml")`. A faithfully extracted Berlin tile is therefore invisible to
it, and the failure is the quiet kind: the mesh step reports no tiles and the city comes out empty.
The content is ordinary CityGML (`core:CityModel`, `bldg:` namespaces), so normalising the suffix
is honest — it is the same format under a different name.

Usage
  python tools/geodata/fetch_berlin.py --aoi tu-berlin
  python tools/geodata/fetch_berlin.py --aoi tu-berlin --product lod2
  python tools/geodata/fetch_berlin.py --aoi tu-berlin --dry-run
"""

from __future__ import annotations

import argparse
import shutil
import time
import urllib.error
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path

from aoi import Tier, bbox_wsen, cache_dir, load_aoi
from fetch_lgl_bw import xyz_to_geotiff
from utm import active_zone, bbox_to_utm

BASE = "https://gdi.berlin.de/data"

USER_AGENT = "Campus-Scheduler/0.1 (open geodata pipeline; +https://gdi.berlin.de)"

ATTRIBUTION = "Datenquelle: Geoportal Berlin, Land Berlin, dl-de/zero-2-0"


@dataclass(frozen=True)
class Product:
    """One Berlin product: where its cells live, how they are gridded, what is inside."""

    #: Path template under the portal root. `{e}` and `{n}` are cell SW corner kilometres.
    template: str
    #: Which members of the archive are worth keeping.
    suffixes: tuple[str, ...]
    #: Cell edge length in kilometres — 2 for the terrain, 1 for the buildings.
    cell_km: int
    #: Kilometre parity the grid is anchored on, per axis. 0 = even, 1 = odd.
    parity: tuple[int, int]
    #: True when the payload is ASCII XYZ that must become a GeoTIFF for the rest of the pipeline.
    xyz_to_tiff: bool = False
    #: Suffix to write out as, when the published one is not what downstream globs for.
    rename_to: str | None = None


PRODUCTS: dict[str, Product] = {
    "dgm1": Product("/dgm1/atom/DGM1_{e}_{n}.zip", (".xyz",), cell_km=2, parity=(0, 0), xyz_to_tiff=True),
    "lod2": Product("/a_lod2/atom/LoD2_{e}_{n}.zip", (".xml",), cell_km=1, parity=(0, 0), rename_to=".gml"),
}


def cells_for(bbox_utm: tuple[float, float, float, float], product: Product) -> list[tuple[int, int]]:
    """Every cell whose square intersects the bounding box."""
    min_e, min_n, max_e, max_n = bbox_utm
    step = product.cell_km
    east_parity, north_parity = product.parity

    def floor_to(value: float, parity: int) -> int:
        km = int(value // 1000)
        # Step back to the nearest kilometre of the right parity, so the cell contains the point.
        return km - ((km - parity) % step)

    east_start, east_end = floor_to(min_e, east_parity), floor_to(max_e, east_parity)
    north_start, north_end = floor_to(min_n, north_parity), floor_to(max_n, north_parity)

    return [
        (e, n)
        for e in range(east_start, east_end + 1, step)
        for n in range(north_start, north_end + 1, step)
    ]


def fetch(url: str, attempts: int = 4) -> bytes:
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=900) as response:  # noqa: S310
                return response.read()
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                raise
            last = exc
        except Exception as exc:  # noqa: BLE001 - network, retried below
            last = exc
        wait = 4 * (attempt + 1)
        print(f"    retrying in {wait}s ({last})")
        time.sleep(wait)
    raise RuntimeError(f"{url}: {last}")


def head_size(url: str) -> int | None:
    try:
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT}, method="HEAD")
        with urllib.request.urlopen(request, timeout=120) as response:  # noqa: S310
            return int(response.headers.get("Content-Length") or 0)
    except Exception:  # noqa: BLE001 - a missing cell is a fact, not a failure
        return None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="tu-berlin")
    parser.add_argument("--product", default="dgm1", choices=sorted(PRODUCTS))
    parser.add_argument("--tier", default="core", choices=("core", "shell"))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    product = PRODUCTS[args.product]
    tier: Tier = args.tier

    # ⚠️ A guard, not a formality. Every URL below is built from zone-33 kilometres, so an AOI that
    # bound some other zone would generate names that 404 one by one and leave an empty build.
    if active_zone() != 33:
        raise SystemExit(
            f"AOI '{cfg['id']}' works in UTM zone {active_zone()}, but Berlin publishes only "
            f"EPSG:25833. Tile names here encode zone-33 kilometres, so this fetcher cannot "
            f"serve that AOI."
        )

    bbox_utm = bbox_to_utm(*bbox_wsen(cfg, tier))
    cells = cells_for(bbox_utm, product)

    out_dir = cache_dir(args.product, cfg["id"])
    archive_dir = cache_dir("raw", "berlin", cfg["id"])

    print(f"AOI {cfg['id']} ({tier}) — {args.product}")
    print(f"  bbox UTM33: {bbox_utm[0]:.0f}/{bbox_utm[1]:.0f} .. {bbox_utm[2]:.0f}/{bbox_utm[3]:.0f}")
    print(f"  {len(cells)} cells of {product.cell_km} km: {', '.join(f'{e}_{n}' for e, n in cells)}")

    if args.dry_run:
        total = 0
        for e, n in cells:
            size = head_size(BASE + product.template.format(e=e, n=n))
            state = f"{size / 1e6:8.1f} MB" if size else "   missing"
            total += size or 0
            print(f"    {e}_{n}  {state}")
        print(f"  total {total / 1e6:.1f} MB")
        return

    written = 0
    for index, (e, n) in enumerate(cells, start=1):
        url = BASE + product.template.format(e=e, n=n)
        archive = archive_dir / f"{args.product}_{e}_{n}.zip"

        if not archive.exists() or args.force:
            print(f"[{index}/{len(cells)}] {url.rsplit('/', 1)[-1]}")
            try:
                archive.write_bytes(fetch(url))
            except urllib.error.HTTPError as exc:
                if exc.code == 404:
                    print("    not published for this cell — skipping")
                    continue
                raise
        else:
            print(f"[{index}/{len(cells)}] {archive.name} (cached)")

        with zipfile.ZipFile(archive) as zf:
            for name in zf.namelist():
                if not name.lower().endswith(product.suffixes):
                    continue
                leaf = Path(name).name
                if product.xyz_to_tiff:
                    target = out_dir / (Path(leaf).stem + ".tif")
                    if target.exists() and not args.force:
                        continue
                    width, height = xyz_to_geotiff(zf.read(name), target)
                    print(f"    {leaf} -> {target.name} ({width}x{height})")
                else:
                    # See the module note: `.xml` here is CityGML, and `build_lod2_mesh.py` globs
                    # for `*.gml`. Rewriting the suffix is what keeps the tile visible to it.
                    stem = Path(leaf).stem
                    target = out_dir / (stem + (product.rename_to or Path(leaf).suffix))
                    if target.exists() and not args.force:
                        continue
                    with zf.open(name) as src, target.open("wb") as dst:
                        shutil.copyfileobj(src, dst)
                    print(f"    {leaf} -> {target.name} ({target.stat().st_size / 1e6:.1f} MB)")
                written += 1

    print(f"\n{written} files in {out_dir}")
    print(ATTRIBUTION)


if __name__ == "__main__":
    main()
