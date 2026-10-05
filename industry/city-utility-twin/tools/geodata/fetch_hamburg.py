"""Download Hamburg (LGV) survey tiles for an AOI: DGM1 terrain and LoD2 buildings.

Same toolchain lineage as the other fetchers here, with the archive URLs in the AOI's `geobasis`
block so a newer vintage is a config change, not a code change.

Hamburg is shaped differently from most German survey authorities, and the difference is the whole
reason this file exists:

**IT PUBLISHES ONE ARCHIVE PER PRODUCT FOR THE WHOLE CITY.** There is no per-tile download. Taken
at face value, a small city-centre box costs gigabytes for well under one per cent of the content.

**SO THE ARCHIVES ARE READ IN PLACE, OVER HTTP RANGE REQUESTS.** A ZIP keeps its index at the END
of the file, and both LGV hosts honour `Range` (verified 2026-10-05 for the 2026 LoD2 archive:
`Accept-Ranges: bytes`, 629 MB, 783 members indexed with 0.08 MB). `RemoteZip` gives `zipfile` a
seekable file-like object backed by ranged GETs, so only the AOI's own square kilometres move.

⚠️ THE FILE EXTENSIONS DESCRIBE THE CONTENT, NOT THE CONTAINER. The elevation archive is named
`...snap_1.ASCII`; it is a ZIP of per-tile XYZ files.

⚠️ THE DATASET IS TITLED "DGM 1", WITH A SPACE. Searching the catalogue for "DGM1" returns the
Schummerung instead, a hillshade PICTURE of terrain. Every height derived from it is meaningless.

Usage
  python tools/geodata/fetch_hamburg.py --aoi hamburg-centre
  python tools/geodata/fetch_hamburg.py --aoi hamburg-centre --product lod2
  python tools/geodata/fetch_hamburg.py --aoi hamburg-centre --dry-run
"""

from __future__ import annotations

import argparse
import io
import re
import sys
import time
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path

from aoi import bbox_wsen, bind_cache, cache_dir, load_aoi
from PIL import Image
from raster import xyz_to_geotiff
from utm import bbox_to_utm

USER_AGENT = "City-Utility-Twin/0.1 (open geodata pipeline; +https://transparenz.hamburg.de)"

#: Tiles inside both archives are 1 km squares, whatever the archive's name says.
CELL_KM = 1


@dataclass(frozen=True)
class Product:
    """One Hamburg archive: which AOI key names it, which members to keep, what to write."""

    archive_key: str
    suffixes: tuple[str, ...]


PRODUCTS: dict[str, Product] = {
    # ⚠️ THE FORMAT CHANGED BETWEEN VINTAGES: up to 2021 the tiles are ASCII XYZ (converted to
    # GeoTIFF here), the 2022 vintage ships GeoTIFF directly. Both are accepted.
    "dgm1": Product("dgm1Archive", (".xyz", ".tif")),
    "lod2": Product("lod2Archive", (".gml",)),
}

#: Tolerates both namings: elevation members carry the UTM zone (`dgm1_32_548_5934_1_hh.xyz`), the
#: 2016 building members did not (`LoD2_466_5974_1_HH.xml`), the 2026 ones do again
#: (`LoD2_32_466_5974_1_HH.gml`). Parsing the coordinates out of the published name means no
#: convention has to be special-cased.
TILE_RE = re.compile(r"_(?:32_)?(\d{3})_(\d{4})_1_", re.IGNORECASE)


def cells_for(bbox_utm: tuple[float, float, float, float]) -> list[tuple[int, int]]:
    """Every 1 km tile whose square intersects the bounding box."""
    min_e, min_n, max_e, max_n = bbox_utm
    return [
        (e, n)
        for e in range(int(min_e // 1000), int(max_e // 1000) + 1, CELL_KM)
        for n in range(int(min_n // 1000), int(max_n // 1000) + 1, CELL_KM)
    ]


class RemoteZip(io.RawIOBase):
    """A seekable file-like view of a remote ZIP, backed by HTTP Range requests."""

    def __init__(self, url: str) -> None:
        self.url = url
        self.pos = 0
        self.fetched = 0
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT}, method="HEAD")
        with urllib.request.urlopen(request, timeout=180) as response:  # noqa: S310
            self.length = int(response.headers.get("Content-Length") or 0)
            if "bytes" not in (response.headers.get("Accept-Ranges") or ""):
                raise SystemExit(
                    f"{url}: the host does not advertise Range support, so the archive would have "
                    "to be downloaded whole. Refusing rather than pulling gigabytes silently."
                )

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        if whence == io.SEEK_SET:
            self.pos = offset
        elif whence == io.SEEK_CUR:
            self.pos += offset
        else:
            self.pos = self.length + offset
        return self.pos

    def tell(self) -> int:
        return self.pos

    def seekable(self) -> bool:
        return True

    def readable(self) -> bool:
        return True

    def read(self, size: int = -1) -> bytes:  # type: ignore[override]
        if size < 0:
            size = self.length - self.pos
        if size <= 0:
            return b""
        end = min(self.pos + size, self.length) - 1
        blob = _ranged(self.url, self.pos, end)
        self.pos += len(blob)
        self.fetched += len(blob)
        return blob


def _ranged(url: str, start: int, end: int, attempts: int = 4) -> bytes:
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(
                url, headers={"User-Agent": USER_AGENT, "Range": f"bytes={start}-{end}"}
            )
            with urllib.request.urlopen(request, timeout=600) as response:  # noqa: S310
                blob = response.read()
            # A server that ignores Range answers 200 with the WHOLE file. Accepting that as the
            # requested slice would hand zipfile garbage at every offset.
            if len(blob) != end - start + 1:
                raise RuntimeError(f"asked for {end - start + 1} bytes, got {len(blob)}")
            return blob
        except Exception as exc:  # noqa: BLE001 - network, retried below
            last = exc
        wait = 4 * (attempt + 1)
        print(f"    retrying range {start}-{end} in {wait}s ({last})")
        time.sleep(wait)
    raise RuntimeError(f"{url} [{start}-{end}]: {last}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", required=True)
    parser.add_argument("--product", default="dgm1", choices=sorted(PRODUCTS))
    parser.add_argument("--dry-run", action="store_true", help="list the tiles, transfer nothing")
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    survey = cfg.get("geobasis") or {}
    product = PRODUCTS[args.product]
    url = survey.get(product.archive_key)
    if not url:
        raise SystemExit(f"AOI {cfg['id']}: geobasis.{product.archive_key} is not set")

    bbox_utm = bbox_to_utm(*bbox_wsen(cfg, "core"))
    cells = cells_for(bbox_utm)
    out_dir = cache_dir(args.product, cfg["id"])

    print(f"AOI {cfg['id']} (core), product {args.product}")
    print(f"  {len(cells)} tiles of {CELL_KM} km over {tuple(round(v) for v in bbox_utm)}")
    print(f"  archive: {url}")
    remote = RemoteZip(url)
    archive = zipfile.ZipFile(remote)
    print(f"  archive {remote.length / 1e9:.2f} GB, indexed with {remote.fetched / 1e6:.2f} MB")

    wanted: dict[tuple[int, int], zipfile.ZipInfo] = {}
    for info in archive.infolist():
        if info.is_dir() or not info.filename.lower().endswith(product.suffixes):
            continue
        match = TILE_RE.search(Path(info.filename).name)
        if match:
            wanted[(int(match.group(1)), int(match.group(2)))] = info

    have = [(cell, wanted[cell]) for cell in cells if cell in wanted]
    missing = [cell for cell in cells if cell not in wanted]
    stored = sum(info.compress_size for _, info in have)
    print(f"  {len(have)} of {len(cells)} tiles published, {stored / 1e6:.1f} MB to transfer")
    if missing:
        # Hamburg is a city state; a box can reach Schleswig-Holstein or Niedersachsen, where the
        # LGV publishes nothing. That is a fact about Hamburg, not a failure.
        print(f"  not published (outside Hamburg): {missing[:8]}{' ...' if len(missing) > 8 else ''}")
    if not have:
        raise SystemExit("no tile of this archive intersects the AOI - wrong archive or wrong box")

    if args.dry_run:
        for cell, info in have[:20]:
            print(f"    {cell[0]} {cell[1]}  {Path(info.filename).name}  {info.compress_size / 1e6:.2f} MB")
        return 0

    def out_name(info: zipfile.ZipInfo) -> str:
        leaf = Path(info.filename)
        return leaf.stem + (".tif" if leaf.suffix.lower() in (".xyz", ".tif") else leaf.suffix.lower())

    out_suffix = ".tif" if args.product == "dgm1" else ".gml"
    bind_cache(out_dir, {"provider": "hamburg", "archive": url, "bytes": remote.length,
                         "members": sorted([out_name(info), info.CRC, info.file_size] for _, info in have)},
               {out_name(info) for _, info in have}, out_suffix)

    written = 0
    for index, (cell, info) in enumerate(have, start=1):
        leaf = Path(info.filename).name
        member_suffix = Path(leaf).suffix.lower()
        target = out_dir / out_name(info)
        if target.exists() and target.stat().st_size > 0:
            continue
        print(f"  [{index}/{len(have)}] {leaf} ({info.compress_size / 1e6:.2f} MB)")
        payload = archive.read(info)  # CRC-checked by zipfile
        if member_suffix == ".xyz":
            xyz_to_geotiff(payload, target)
        elif member_suffix == ".tif":
            # build_terrain.py positions a tile by its ModelTiepoint. A TIFF without one would be
            # mosaicked at the origin or rejected three steps later; refuse it here instead.
            with Image.open(io.BytesIO(payload)) as image:
                tiepoint = image.tag_v2.get(33922)
            if not tiepoint or len(tiepoint) < 6:
                raise SystemExit(f"{leaf}: GeoTIFF without a ModelTiepoint")
            target.write_bytes(payload)
        else:
            target.write_bytes(payload)
        written += 1

    print(
        f"\n{written} new files in {out_dir} ({len(have)} tiles). "
        f"Transferred {remote.fetched / 1e6:.1f} MB instead of {remote.length / 1e9:.2f} GB."
    )
    print(survey.get("attribution", ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
