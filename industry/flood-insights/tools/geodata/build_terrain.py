"""Mosaic the DGM1 tiles into the browser terrain grid for an AOI.

PLAN §4.7 / §9.4: 1 m source, **2 m simulation grid**, **4 m render grid**. 1 m is kept only for
per-building ground elevation later.

Output (into public/terrain/<aoi-id>/):
  heightmap_4m.u16   uint16 little-endian, row-major, north-to-south (image order)
  metadata.json      grid size, UTM origin, height scale/offset, attribution

uint16 rather than float32 halves the download for no meaningful loss: the AOI spans ~200 m of
relief, so 65 535 steps give ~3 mm vertical resolution — far finer than DGM1's own accuracy.

Usage
  python tools/geodata/build_terrain.py
  python tools/geodata/build_terrain.py --resolution 2 --name heightmap_2m
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

from aoi import load_aoi, raw_dir
from utm import bbox_to_utm32, utm32_to_wgs84, wgs84_to_utm32

# Both states tile on the same ADV kilometre grid and differ only in the code in the file name:
# `_rp_` for Rheinland-Pfalz, `_nw_` for North Rhine-Westphalia. The geometry is identical, so the
# reader accepts either rather than the pipeline gaining a second copy of itself per state.
TILE_RE = re.compile(r"dgm1_32_(\d{3})_(\d{4})_1_(?:rp|nw)_(\d{4})\.tif")
TILE_M = 1000  # DGM1 tiles are 1 km squares at 1 m posting
NODATA = -9999.0


def build(
    tile_dir: Path,
    bbox_utm: tuple[float, float, float, float],
    resolution: int,
    focus_places: list[dict] | None = None,
    geobasis: dict | None = None,
) -> tuple[np.ndarray, dict, np.ndarray]:
    # ⚠️ Provenance comes from the AOI, not from this file. It used to be three hardcoded strings
    # naming LVermGeo Rheinland-Pfalz, a 2024/2025 acquisition and dl-de/by-2-0. Pointed at the
    # Steinbach corridor that would have stamped Geobasis NRW's tiles — a different authority on a
    # different licence, acquired in a different year — with Rheinland-Pfalz's credit. Wrong
    # attribution is not a cosmetic bug.
    geobasis = geobasis or {}
    min_e, min_n, max_e, max_n = bbox_utm

    # Snap the grid origin to a whole multiple of the resolution so cells line up with the source.
    origin_e = int(min_e // resolution * resolution)
    origin_n = int(min_n // resolution * resolution)
    width = int((max_e - origin_e) // resolution) + 1
    height = int((max_n - origin_n) // resolution) + 1
    print(f"grid: {width} x {height} cells at {resolution} m")
    print(f"origin (UTM32): {origin_e} E, {origin_n} N")

    grid = np.full((height, width), np.nan, dtype=np.float32)

    tiles = sorted(tile_dir.glob("dgm1_32_*.tif"))
    print(f"mosaicking {len(tiles)} tiles...")
    step = resolution  # source is 1 m, so we subsample every `resolution`-th sample

    for index, path in enumerate(tiles, start=1):
        match = TILE_RE.fullmatch(path.name)
        if not match:
            continue
        tile_e = int(match.group(1)) * 1000
        tile_n = int(match.group(2)) * 1000

        data = np.array(Image.open(path), dtype=np.float32)
        data[data <= NODATA + 1] = np.nan

        # DGM1 tiles are stored north-up: row 0 is the NORTH edge of the tile.
        sub = data[::step, ::step]
        rows, cols = sub.shape

        # Column offset is straightforward; the row offset has to be flipped because our grid is
        # also image-ordered (row 0 = north) while UTM northing increases upward.
        col0 = (tile_e - origin_e) // resolution
        tile_top_n = tile_n + TILE_M
        row0 = (origin_n + height * resolution - tile_top_n) // resolution

        src_r0 = max(0, -row0)
        src_c0 = max(0, -col0)
        dst_r0 = max(0, row0)
        dst_c0 = max(0, col0)
        copy_rows = min(rows - src_r0, height - dst_r0)
        copy_cols = min(cols - src_c0, width - dst_c0)
        if copy_rows <= 0 or copy_cols <= 0:
            continue

        grid[dst_r0 : dst_r0 + copy_rows, dst_c0 : dst_c0 + copy_cols] = sub[
            src_r0 : src_r0 + copy_rows, src_c0 : src_c0 + copy_cols
        ]
        if index % 25 == 0:
            print(f"  {index}/{len(tiles)}")

    filled = np.isfinite(grid)
    coverage = filled.mean() * 100
    print(f"coverage: {coverage:.1f}% of cells have data")

    z_min = float(np.nanmin(grid))
    z_max = float(np.nanmax(grid))
    print(f"elevation range: {z_min:.2f} .. {z_max:.2f} m")

    # Gaps are structural, not accidental: the AOI envelope reaches past the Rheinland-Pfalz border
    # into NRW (where this dataset stops), and the UTM envelope of a geographic bbox bows outside
    # the bbox itself at the corners.
    #
    # Fill them from the NEAREST valid cell. Filling with a constant creates a visible cliff wall at
    # the AOI edge; filling with the minimum is worse still, because the level-set shader then
    # renders the holes as a permanent lake. Nearest-neighbour blends in, and the accompanying
    # nodata mask keeps those cells hydraulically inert regardless of their elevation.
    #
    # ⚠️ That mask is a BUILD artefact, not a runtime one. Its only consumer is build_flowfield.py,
    # which subtracts it from the reachable area; `nodata` appears nowhere in src/. It used to be
    # written into public/terrain/ and was therefore deployed — 26.9 MB across three AOIs, at one
    # byte per cell, that no browser ever reads. It now goes to data/derived/ instead.
    gaps = ~filled
    gap_elev_min = gap_elev_max = None
    if gaps.any():
        print(f"  {gaps.sum()} cells ({gaps.mean() * 100:.2f}%) have no data -> nearest-neighbour fill")
        _, indices = ndimage.distance_transform_edt(gaps, return_indices=True)
        grid = grid[tuple(indices)]
        # Sample AFTER the fill: before it these cells are NaN by definition. What matters is the
        # elevation they were handed, because that is what the flow field will test.
        gap_elev = grid[gaps]
        gap_elev_min = float(np.nanmin(gap_elev))
        gap_elev_max = float(np.nanmax(gap_elev))
        print(f"  filled cells span {gap_elev_min:.1f}..{gap_elev_max:.1f} m")

    scale = (z_max - z_min) / 65535.0
    quantised = np.round((grid - z_min) / scale).astype(np.uint16)

    lon_w, lat_s = utm32_to_wgs84(origin_e, origin_n)
    lon_e, lat_n = utm32_to_wgs84(
        origin_e + width * resolution, origin_n + height * resolution
    )

    # Project the focus places into normalised grid coordinates so the front end can frame them
    # without carrying a projection implementation of its own.
    places = []
    for place in focus_places or []:
        e, n = wgs84_to_utm32(place["lon"], place["lat"])
        u = (e - origin_e) / (width * resolution)
        v = (origin_n + height * resolution - n) / (height * resolution)  # row 0 = north
        row = int(np.clip(v * height, 0, height - 1))
        col = int(np.clip(u * width, 0, width - 1))
        places.append(
            {
                "id": place["id"],
                "name": place["name"],
                "u": round(float(u), 5),
                "v": round(float(v), 5),
                "groundM": round(float(grid[row, col]), 2),
            }
        )
        print(f"  {place['name']}: u={u:.3f} v={v:.3f} ground={grid[row, col]:.1f} m")

    # The provenance note has to name THIS AOI's authority. The Ahr is Rheinland-Pfalz and the
    # Steinbach corridor is NRW, and the AOI config is explicit that neither may be reused for
    # the other.
    authority = (geobasis or {}).get("authority", "the data provider")

    metadata = {
        "width": width,
        "height": height,
        "resolutionM": resolution,
        "crs": "EPSG:25832",
        "verticalDatum": "DHHN2016",
        "origin": {"easting": origin_e, "northing": origin_n},
        "heightMinM": round(z_min, 3),
        "heightMaxM": round(z_max, 3),
        "heightScale": scale,
        "encoding": "uint16-le, row-major, row 0 = north",
        "boundsWgs84": {
            "west": round(lon_w, 6),
            "south": round(lat_s, 6),
            "east": round(lon_e, 6),
            "north": round(lat_n, 6),
        },
        "coveragePct": round(coverage, 2),
        "focusPlaces": places,
        "nodataFill": "nearest",
        "nodataCells": int(gaps.sum()),
        "nodataElevRangeM": (
            None if gap_elev_min is None else [round(gap_elev_min, 1), round(gap_elev_max, 1)]
        ),
        # Two things used to be wrong here. The note named Rheinland-Pfalz whatever the AOI, so
        # the Steinbach sidecar cited the wrong Land two keys above its own "Geobasis NRW"
        # source — the exact reuse the AOI config warns against. And it described gap filling
        # even when there were no gaps to fill.
        "nodataNote": (
            f"Cells without DGM1 data (AOI edge beyond the coverage of {authority}, and UTM "
            "envelope corners outside the geographic bbox) are filled from the nearest valid "
            "cell for appearance, and flagged in the nodata mask so they are never inundated. "
            "The mask is a BUILD artefact under data/derived/ — build_flowfield.py is its only "
            "reader and the browser never loads it. See PLAN.md §4.1."
            if gaps.any()
            else "The source covers this AOI completely, so there are no gaps and no mask."
        ),
        "source": geobasis.get("source") or f"DGM1, {geobasis.get('authority', 'unknown authority')}",
        "sourceAcquisition": geobasis.get("acquisition", "see the AOI config"),
        "attribution": geobasis.get("attribution", ""),
        "licence": geobasis.get("licence", ""),
    }
    return quantised, metadata, gaps

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="ahrtal-2021")
    parser.add_argument("--tiles", type=Path, default=None)
    parser.add_argument("--resolution", type=int, default=4, help="output grid spacing in metres")
    parser.add_argument("--name", default=None, help="output basename (default heightmap_<res>m)")
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    # Raw data lives per AOI. Resolved here rather than in the argparse
    # default, which runs before the config is known.
    args.tiles = args.tiles or raw_dir("dgm1", cfg["id"])
    b = cfg["bbox"]
    bbox_utm = bbox_to_utm32(b["west"], b["south"], b["east"], b["north"])

    grid, metadata, nodata_mask = build(
        args.tiles, bbox_utm, args.resolution, cfg.get("focusPlaces"), cfg.get("geobasis")
    )

    out_dir = Path("public/terrain") / cfg["id"]
    out_dir.mkdir(parents=True, exist_ok=True)
    name = args.name or f"heightmap_{args.resolution}m"

    raw_path = out_dir / f"{name}.u16"
    raw_path.write_bytes(grid.astype("<u2").tobytes())
    metadata["file"] = raw_path.name

    # The mask goes to data/derived/, NOT next to the heightmap. build_flowfield.py is its only
    # reader; the browser never touches it. Keeping it under public/ deployed one byte per cell to
    # every visitor for nothing.
    #
    # A fully covered AOI gets no mask at all. Writing one anyway produced 8.3 MB of zeros for
    # Steinbach and 0.4 MB for Castel Bolognese, plus a sidecar pointing at a file that says
    # nothing — a mask is only meaningful where there is something to mask.
    derived_dir = Path("data/derived") / cfg["id"]
    derived_dir.mkdir(parents=True, exist_ok=True)
    nodata_path = derived_dir / f"{name}_nodata.u8"
    if nodata_mask.any():
        nodata_path.write_bytes((nodata_mask * 255).astype(np.uint8).tobytes())
        metadata["nodataFile"] = str(nodata_path).replace("\\", "/")
        print(f"wrote {nodata_path} (build artefact, not deployed)")
    else:
        print(f"no gaps in {cfg['id']} — no mask written")
        if nodata_path.exists():
            nodata_path.unlink()
            print(f"removed stale {nodata_path}, left by a build that wrote one regardless")

    # Remove a copy left under public/ by an older build, so a rebuild does not keep shipping it.
    stale_mask = out_dir / f"{name}_nodata.u8"
    if stale_mask.exists():
        size_mb = stale_mask.stat().st_size / 1024 / 1024
        stale_mask.unlink()
        print(f"removed deployed {stale_mask.name} ({size_mb:.1f} MB) — no runtime reader")

    meta_path = out_dir / f"{name}.json"
    meta_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    print(f"\nwrote {raw_path} ({raw_path.stat().st_size / 1024 / 1024:.1f} MB)")
    print(f"wrote {meta_path}")


if __name__ == "__main__":
    main()
