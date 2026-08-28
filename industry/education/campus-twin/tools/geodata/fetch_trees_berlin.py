"""Download Berlin's surveyed tree cadastre for an AOI and write it as a GeoPackage.

The fifth survey authority needed a fifth answer to the canopy question, and Berlin gives the best
one in this repository. Bavaria publishes a tree cadastre and `fetch_trees.py` downloads it;
Baden-Württemberg and NRW publish none, so Tübingen, Aachen, Köln and Münster derive their canopy
from a normalised surface model instead (`build_vegetation_ndom.py`) — a raster guess at where the
tall things are. Berlin publishes **individually surveyed trees with a measured height**, which is
the Bavarian tier of quality, so this site takes the Bavarian route.

Measured over the TU Berlin core, 2026-08-26:

  baumbestand:strassenbaeume   15 375 street trees, 100.0 % carrying `baumhoehe`, 3–34 m
  baumbestand:anlagenbaeume    25 498 park trees,    99.7 % carrying `baumhoehe`, 1–33 m

40 873 measured trees against OTH's 21 681 from the Bavarian cadastre, in an AOI whose whole appeal
has to come from the surface rather than the landform — Berlin has ~35 m of relief across 5 km.

⚠️ **BOTH LAYERS, NOT JUST THE STREET TREES.** `strassenbaeume` is the obvious one and it is the
smaller of the two: nearly two thirds of the trees here are `anlagenbaeume`, the trees in parks and
on public grounds. Taking only the street layer would leave the Tiergarten, Volkspark Humboldthain
and the TU campus greens bare while every kerbside lime was present, which reads as a rendering
bug rather than as a missing dataset.

⚠️ **`dgmhoehe` IS SAMPLED HERE, NOT PUBLISHED.** The Bavarian cadastre ships a ground elevation per
tree and `build_vegetation.py` reads a `dgmhoehe` column because of it. Berlin's WFS has no such
field, so this script samples the ground under each tree out of the heightmap the pipeline has
already built. That is not a downgrade — it is the same DGM1 surface the tree will be drawn on, so
the trees cannot float or sink relative to the terrain the way an independently-sourced elevation
can. It does mean `build_terrain.py` must have run first.

⚠️ **THE FIRST FEATURE OF EACH LAYER IS A PLACEHOLDER.** `gisid=00000000_00000000` with every
attribute NULL. It is skipped by the height filter anyway, but a reader that trusted feature one to
show the shape of the data would conclude the cadastre carries no heights at all.

Output is a GeoPackage in the shape `build_vegetation.py` reads: one table per kilometre northing
band, each with `geom`, `dgmhoehe` and `baumhoehe`, catalogued in `gpkg_contents` with its extent.
Written with `sqlite3` and 29 bytes of hand-rolled WKB for the same reason that module decodes it
that way — GDAL is a large binary dependency for a file format that is a SQLite database.

Usage
  python tools/geodata/fetch_trees_berlin.py --aoi tu-berlin
  python tools/geodata/fetch_trees_berlin.py --aoi tu-berlin --dry-run
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import struct
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from aoi import bbox_wsen, cache_dir, load_aoi, terrain_dir
from utm import active_zone, bbox_to_utm

WFS = "https://gdi.berlin.de/services/wfs/baumbestand"

LAYERS = ("baumbestand:strassenbaeume", "baumbestand:anlagenbaeume")

USER_AGENT = "Campus-Scheduler/0.1 (open geodata pipeline; +https://gdi.berlin.de)"

ATTRIBUTION = "Datenquelle: Geoportal Berlin / Baumbestand, Land Berlin, dl-de/zero-2-0"

#: The service caps a single response; page through with STARTINDEX rather than asking for 40 000.
PAGE = 5000

#: GeoPackage binary header: 'GP', version, flags, srs id, then the WKB payload.
GPKG_MAGIC = b"GP"


def encode_point(easting: float, northing: float, srs_id: int) -> bytes:
    """A GeoPackage POINT blob: 8-byte header, then a little-endian WKB point.

    The inverse of `decode_point` in `build_vegetation.py`, and deliberately the same 29 bytes:
    flags 0x01 means little-endian with NO envelope, which is what that decoder's
    `envelope_doubles[0] == 0` branch expects.
    """
    header = GPKG_MAGIC + bytes([0, 0x01]) + struct.pack("<i", srs_id)
    wkb = bytes([1]) + struct.pack("<I", 1) + struct.pack("<dd", easting, northing)
    return header + wkb


def fetch_page(layer: str, bbox: tuple[float, float, float, float], zone: int, start: int) -> dict:
    crs = f"urn:ogc:def:crs:EPSG::258{zone}"
    params = {
        "SERVICE": "WFS",
        "VERSION": "2.0.0",
        "REQUEST": "GetFeature",
        "TYPENAMES": layer,
        "OUTPUTFORMAT": "application/json",
        "SRSNAME": crs,
        "BBOX": f"{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]},{crs}",
        "COUNT": str(PAGE),
        "STARTINDEX": str(start),
    }
    url = f"{WFS}?{urllib.parse.urlencode(params)}"
    last: Exception | None = None
    for attempt in range(4):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=300) as response:  # noqa: S310
                return json.loads(response.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001 - network, retried below
            last = exc
            wait = 4 * (attempt + 1)
            print(f"    retrying in {wait}s ({exc})")
            time.sleep(wait)
    raise RuntimeError(f"{layer} @{start}: {last}")


def ground_sampler(cfg: dict):
    """Return a function giving the DGM1 ground elevation at a UTM point, from the built heightmap."""
    import numpy as np

    meta_path = terrain_dir(cfg) / "heightmap.json"
    if not meta_path.exists():
        raise SystemExit(
            f"{meta_path} not found — run tools/geodata/build_terrain.py first. Berlin publishes "
            "no per-tree ground elevation, so the terrain has to exist before the trees can sit on it."
        )
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    width, height = int(meta["width"]), int(meta["height"])
    res = float(meta["resolutionM"])
    origin_e = float(meta["origin"]["easting"])
    origin_n = float(meta["origin"]["northing"])
    top_n = origin_n + height * res
    lo = float(meta["heightMinM"])
    scale = float(meta["heightScale"])

    grid = np.frombuffer((terrain_dir(cfg) / meta["file"]).read_bytes(), dtype="<u2").reshape(
        height, width
    )

    def sample(easting: float, northing: float) -> float | None:
        col = int((easting - origin_e) // res)
        row = int((top_n - northing) // res)
        if not (0 <= col < width and 0 <= row < height):
            return None
        return lo + float(grid[row, col]) * scale

    return sample


def write_gpkg(path: Path, bands: dict[int, list[tuple[bytes, float, float]]], srs_id: int) -> None:
    """Write the minimal GeoPackage `build_vegetation.py` reads: catalogue plus one table per band."""
    if path.exists():
        path.unlink()
    connection = sqlite3.connect(path)
    cur = connection.cursor()
    # application_id 'GPKG' and user_version 1.2.1, so the file identifies itself correctly.
    cur.execute("PRAGMA application_id = 1196444487")
    cur.execute("PRAGMA user_version = 10201")
    cur.execute(
        "CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT NOT NULL, srs_id INTEGER PRIMARY KEY, "
        "organization TEXT NOT NULL, organization_coordsys_id INTEGER NOT NULL, "
        "definition TEXT NOT NULL, description TEXT)"
    )
    cur.executemany(
        "INSERT INTO gpkg_spatial_ref_sys VALUES (?,?,?,?,?,?)",
        [
            ("Undefined cartesian", -1, "NONE", -1, "undefined", None),
            ("Undefined geographic", 0, "NONE", 0, "undefined", None),
            (f"ETRS89 / UTM zone {srs_id - 25800}N", srs_id, "EPSG", srs_id, "", None),
        ],
    )
    cur.execute(
        "CREATE TABLE gpkg_contents (table_name TEXT PRIMARY KEY, data_type TEXT NOT NULL, "
        "identifier TEXT UNIQUE, description TEXT DEFAULT '', "
        "last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), "
        "min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE, srs_id INTEGER)"
    )
    cur.execute(
        "CREATE TABLE gpkg_geometry_columns (table_name TEXT NOT NULL, column_name TEXT NOT NULL, "
        "geometry_type_name TEXT NOT NULL, srs_id INTEGER NOT NULL, z TINYINT NOT NULL, "
        "m TINYINT NOT NULL, PRIMARY KEY (table_name, column_name))"
    )

    for band, rows in sorted(bands.items()):
        if not rows:
            continue
        table = f"baeume_{band}"
        cur.execute(
            f"CREATE TABLE '{table}' (fid INTEGER PRIMARY KEY AUTOINCREMENT, geom BLOB, "  # noqa: S608
            "dgmhoehe DOUBLE, baumhoehe DOUBLE, kronedurch DOUBLE, art TEXT)"
        )
        cur.executemany(
            f"INSERT INTO '{table}' (geom, dgmhoehe, baumhoehe, kronedurch, art) "  # noqa: S608
            "VALUES (?,?,?,?,?)",
            rows,
        )
        eastings = [struct.unpack("<d", r[0][13:21])[0] for r in rows]
        northings = [struct.unpack("<d", r[0][21:29])[0] for r in rows]
        cur.execute(
            "INSERT INTO gpkg_contents (table_name, data_type, identifier, min_x, min_y, max_x, "
            "max_y, srs_id) VALUES (?,'features',?,?,?,?,?,?)",
            (table, table, min(eastings), min(northings), max(eastings), max(northings), srs_id),
        )
        cur.execute(
            "INSERT INTO gpkg_geometry_columns VALUES (?,'geom','POINT',?,0,0)", (table, srs_id)
        )
    connection.commit()
    connection.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="tu-berlin")
    parser.add_argument("--min-height", type=float, default=1.0)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    zone = active_zone()
    if zone != 33:
        raise SystemExit(
            f"AOI '{cfg['id']}' works in UTM zone {zone}; the Berlin tree cadastre is EPSG:25833."
        )
    srs_id = 25800 + zone
    bbox = bbox_to_utm(*bbox_wsen(cfg, "core"))
    print(f"AOI {cfg['id']} — Baumbestand over E {bbox[0]:.0f}..{bbox[2]:.0f} N {bbox[1]:.0f}..{bbox[3]:.0f}")

    if args.dry_run:
        for layer in LAYERS:
            page = fetch_page(layer, bbox, zone, 0)
            print(f"  {layer:32} numberMatched={page.get('numberMatched', '?')}")
        return

    sample_ground = ground_sampler(cfg)

    bands: dict[int, list[tuple[bytes, float, float, float | None, str | None]]] = {}
    kept = no_height = off_grid = 0

    for layer in LAYERS:
        start = 0
        while True:
            page = fetch_page(layer, bbox, zone, start)
            features = page.get("features", [])
            if not features:
                break
            for feature in features:
                props = feature.get("properties") or {}
                height = props.get("baumhoehe")
                if not height or height < args.min_height:
                    no_height += 1
                    continue
                coords = (feature.get("geometry") or {}).get("coordinates")
                if not coords:
                    continue
                easting, northing = float(coords[0]), float(coords[1])
                ground = sample_ground(easting, northing)
                if ground is None:
                    off_grid += 1
                    continue
                band = int(northing // 1000)
                bands.setdefault(band, []).append(
                    (
                        encode_point(easting, northing, srs_id),
                        ground,
                        float(height),
                        props.get("kronedurch"),
                        props.get("art_dtsch"),
                    )
                )
                kept += 1
            print(f"  {layer:32} {start:6d}+{len(features):5d}  kept {kept}")
            if len(features) < PAGE:
                break
            start += PAGE

    out_dir = cache_dir("trees", cfg["id"])
    path = out_dir / f"baumbestand-{cfg['id']}.gpkg"
    write_gpkg(path, bands, srs_id)

    print(f"\n{kept:,} trees in {len(bands)} bands -> {path} ({path.stat().st_size / 1e6:.1f} MB)")
    print(f"  skipped: {no_height:,} without a usable height, {off_grid:,} outside the heightmap")
    print(ATTRIBUTION)


if __name__ == "__main__":
    main()
