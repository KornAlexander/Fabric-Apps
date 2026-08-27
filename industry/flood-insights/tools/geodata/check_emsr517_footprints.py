"""Exact point-in-polygon test of the EMSR517 areaOfInterest footprints against the AOI focus places.

A bounding box says almost nothing here: Copernicus AOI footprints are often river corridors, not
rectangles, so a place can sit inside the bbox and outside the mapped area. PLAN §2 requires we
know which villages are genuinely covered, because the validation limitation has to be stated in
the UI rather than glossed over.

Parses shapefile polygon geometry directly — no GDAL dependency.

Usage
  python tools/geodata/check_emsr517_footprints.py
"""

from __future__ import annotations

import argparse
import json
import struct
import zipfile
from pathlib import Path

from aoi import load_aoi


def read_polygons(shp_bytes: bytes) -> list[list[list[tuple[float, float]]]]:
    """Return polygons as lists of rings; each ring is a list of (x, y)."""
    polygons: list[list[list[tuple[float, float]]]] = []
    offset = 100  # skip the file header
    total = len(shp_bytes)

    while offset < total:
        # Record header: big-endian record number and content length (in 16-bit words).
        _record_number, content_length = struct.unpack(">II", shp_bytes[offset : offset + 8])
        content_start = offset + 8
        shape_type = struct.unpack("<i", shp_bytes[content_start : content_start + 4])[0]

        if shape_type == 5:  # Polygon
            num_parts, num_points = struct.unpack(
                "<II", shp_bytes[content_start + 36 : content_start + 44]
            )
            parts_start = content_start + 44
            parts = struct.unpack(
                f"<{num_parts}I", shp_bytes[parts_start : parts_start + 4 * num_parts]
            )
            points_start = parts_start + 4 * num_parts
            coords = struct.unpack(
                f"<{num_points * 2}d",
                shp_bytes[points_start : points_start + 16 * num_points],
            )
            points = [(coords[i * 2], coords[i * 2 + 1]) for i in range(num_points)]

            rings = []
            for i, start in enumerate(parts):
                end = parts[i + 1] if i + 1 < len(parts) else num_points
                rings.append(points[start:end])
            polygons.append(rings)

        offset = content_start + content_length * 2

    return polygons


def point_in_rings(rings: list[list[tuple[float, float]]], x: float, y: float) -> bool:
    """Even-odd ray casting across all rings — holes flip the result, which is what we want."""
    inside = False
    for ring in rings:
        for i in range(len(ring)):
            x1, y1 = ring[i]
            x2, y2 = ring[(i + 1) % len(ring)]
            if (y1 > y) != (y2 > y):
                x_cross = x1 + (y - y1) / (y2 - y1) * (x2 - x1)
                if x < x_cross:
                    inside = not inside
    return inside


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="ahrtal-2021")
    parser.add_argument("--dir", type=Path, default=Path("data/raw/emsr517"))
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    places = cfg["focusPlaces"]

    results = []
    for zip_path in sorted(args.dir.glob("EMSR517_*_vector.zip")):
        with zipfile.ZipFile(zip_path) as zf:
            footprint = next(
                (n for n in zf.namelist() if n.endswith(".shp") and "areaOfInterest" in n), None
            )
            if not footprint:
                continue
            polygons = read_polygons(zf.read(footprint))

        covered = []
        for place in places:
            if any(point_in_rings(rings, place["lon"], place["lat"]) for rings in polygons):
                covered.append(place["name"])

        vertex_count = sum(len(r) for poly in polygons for r in poly)
        results.append(
            {
                "product": zip_path.name,
                "footprintVertices": vertex_count,
                "covers": covered,
            }
        )
        marker = "OK " if covered else "   "
        print(f"{marker}{zip_path.name}")
        print(f"     footprint vertices: {vertex_count}  covers: {', '.join(covered) or '-'}")

    out = args.dir / "footprint_coverage.json"
    out.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"\nwrote {out}")

    print("\nCoverage per focus place:")
    for place in places:
        hits = [r["product"] for r in results if place["name"] in r["covers"]]
        print(f"  {place['name']:<12} {len(hits)} product(s)")
        for h in hits:
            print(f"                 {h}")


if __name__ == "__main__":
    main()
