"""Convert LoD2 CityGML into a compact binary mesh the browser can load.

PLAN §4.2 / §9.3. LoD2 carries real roof shapes, measured heights and building function codes —
the difference between a valley and a field of grey boxes.

Output (public/terrain/<aoi>/):
  buildings_lod2.bin   interleaved float32 positions, triangles, in local metres
  buildings_lod2.json  per-building metadata + index ranges into the mesh

Design notes
------------
* Triangulation is a fan over each planar CityGML polygon. LoD2 surfaces are convex or near-convex
  in practice, so a fan is adequate and avoids pulling in an ear-clipping dependency.
* Coordinates are emitted relative to the terrain grid origin so the browser can place buildings in
  the same world space as the terrain without any projection maths of its own.
* Ground elevation per building is taken from the CityGML GroundSurface, which is measured — better
  than sampling our own DGM, and it is what §6.4 wants for depth–damage.

Usage
  python tools/geodata/build_lod2_mesh.py
"""

from __future__ import annotations

import argparse
import gzip
import json
import re
import math
import struct
import xml.etree.ElementTree as ET
from pathlib import Path

from aoi import load_aoi, load_osm_cache, raw_dir, terrain_name
from building_class import WALL_CLASS_NAMES, wall_class

NS = {
    "bldg": "http://www.opengis.net/citygml/building/1.0",
    "gml": "http://www.opengis.net/gml",
}

#: Who surveyed the tiles, keyed by the suffix the survey itself puts on every filename
#: (`LoD2_32_345_5604_1_NW.gml`). Read from the data rather than declared per AOI, because a
#: hardcoded credit is exactly how the Steinbach buildings came to be attributed to
#: Rheinland-Pfalz: they are NRW tiles, under a different licence, from a different authority.
LOD2_SOURCES = {
    "RP": (
        "3D-Gebäudemodell LoD2, LVermGeo Rheinland-Pfalz",
        "© GeoBasis-DE / LVermGeoRP, dl-de/by-2-0, www.lvermgeo.rlp.de [Daten bearbeitet]",
    ),
    "NW": (
        "3D-Gebäudemodell LoD2, Geobasis NRW",
        "© GeoBasis-DE / BKG / Land NRW, dl-de/zero-2-0, www.govdata.de/dl-de/zero-2-0",
    ),
}

# ALKIS building function codes worth naming; everything else stays numeric.
FUNCTION_LABELS = {
    "31001_1000": "Wohnhaus",
    "31001_1010": "Wohnhaus",
    "31001_1020": "Wohn- und Geschäftsgebäude",
    "31001_1120": "Betriebsgebäude",
    "31001_2000": "Gewerbe",
    "31001_2010": "Bürogebäude",
    "31001_2020": "Handel",
    "31001_3000": "Öffentliches Gebäude",
    "31001_3020": "Verwaltung",
    "31001_3041": "Schule",
    "31001_3065": "Kirche",
    "31001_9998": "Nebengebäude",
}


def read_gml(path: Path) -> str:
    raw = path.read_bytes()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return raw.decode("utf-8", "replace")


def polygons_of(element: ET.Element) -> list[list[tuple[float, float, float]]]:
    """Every gml:posList under an element, as lists of (easting, northing, height)."""
    rings = []
    for pos in element.iter(f"{{{NS['gml']}}}posList"):
        if not pos.text:
            continue
        values = [float(v) for v in pos.text.split()]
        points = [tuple(values[i : i + 3]) for i in range(0, len(values) - 2, 3)]
        if len(points) >= 4:
            rings.append(points)  # type: ignore[arg-type]
    return rings


def emit_fan(
    ring: list[tuple[float, float, float]],
    positions: list[float],
    heights: list[float],
    origin_e: float,
    origin_n: float,
    width_m: float,
    depth_m: float,
) -> int:
    """Fan-triangulate one planar CityGML ring into world space. Returns vertices added.

    Pulled out of the build loop when roofs stopped being emitted alongside the walls: the two now
    happen at different points and must produce byte-identical geometry, which is easier to
    guarantee with one function than with two copies of the same six lines.
    """
    pts = ring[:-1] if ring[0] == ring[-1] else ring
    if len(pts) < 3:
        return 0
    added = 0
    for i in range(1, len(pts) - 1):
        for p in (pts[0], pts[i], pts[i + 1]):
            # World space: x east of centre, y up, z south of centre.
            positions.append(p[0] - origin_e - width_m / 2)
            positions.append(p[2])
            positions.append((origin_n + depth_m) - p[1] - depth_m / 2)
            heights.append(p[2])
            added += 1
    return added


def write_roof_colours(
    out_dir: Path,
    buildings: list[dict],
    roof_outlines: list[list[list[tuple[float, float]]]],
    roof_spans: list[list[tuple[int, list[tuple[float, float]]]]],
) -> dict | None:
    """Measure every roof from the orthophoto this app already ships, and write it beside the mesh.

    ⚠️ **Pipeline order matters.** The drape is fetched by `fetch_drape.py`, which normally runs
    AFTER this script. On a first build there is no drape yet, so this returns None and the mesh
    ships without colour rather than failing — but the buildings step must then be RE-RUN once the
    drape exists, or the valley stays grey and nothing says why.

    Outputs (both optional to the client, both validated there by shape):
      buildings_colour.bin      4 bytes/building — r, g, b, 255 if measured else 0
      buildings_roof_spans.bin  7 bytes/surface  — uint32 LE vertexStart, then r, g, b
    """
    drape_meta_path = out_dir / "drape.json"
    if not drape_meta_path.exists():
        print("\nno drape.json yet — skipping roof colour; RE-RUN this after fetch_drape.py")
        return None

    from PIL import Image

    import roof_colour as rc

    meta = json.loads(drape_meta_path.read_text(encoding="utf-8"))
    Image.MAX_IMAGE_PIXELS = None  # the drape is deliberately larger than PIL's bomb threshold
    image = Image.open(out_dir / meta["file"]).convert("RGB")
    resolution = float(meta["metresPerPixel"])
    drape = rc.DrapeRef(
        image=image,
        resolution_m=resolution,
        origin_easting=float(meta["origin"]["easting"]),
        # drape.json records the origin at the SOUTH-west corner, the same convention as the
        # heightmap it is aligned to, while the image is written with row 0 = north.
        top_northing=float(meta["origin"]["northing"]) + float(meta["extentM"]["height"]),
    )
    print(f"\nmeasuring roof colour from {meta['file']} at {resolution:.3f} m/px")

    colours, stats = rc.measure_roof_colours(drape, roof_outlines)
    fallback = rc.fallback_colour(colours)
    measured = stats["measured"]
    print(
        f"  roof colour: {measured}/{stats['total']} measured "
        f"({100 * measured / max(stats['total'], 1):.1f}%), fallback {fallback}"
    )

    colour_path = out_dir / "buildings_colour.bin"
    colour_path.write_bytes(
        b"".join(
            bytes((*(c or fallback), 255 if c is not None else 0)) for c in colours
        )
    )

    # A roof surface may only claim its own colour on 30 pixels of evidence. At the Ahr's
    # 2.878 m/px that is 248 m² of a SINGLE pitch, which almost nothing reaches, so the pass would
    # cost 135 725 polygon samples to produce nearly nothing. Skipped by measurement rather than by
    # taste: the threshold is the same either way, this only avoids paying to discover it.
    span_rows: list[tuple[int, tuple[int, int, int]]] = []
    surface_area_needed = rc.MIN_SURFACE_PIXELS * resolution * resolution
    if resolution > 1.5:
        print(
            f"  per-surface colour skipped: one pitch would need {surface_area_needed:.0f} m² "
            f"to clear {rc.MIN_SURFACE_PIXELS} px at {resolution:.3f} m/px"
        )
    else:
        population_value = stats.get("populationValue", 0.56)
        for index, surfaces in enumerate(roof_spans):
            base = colours[index]
            if base is None:
                continue
            for vertex_start, ring in surfaces:
                pixels = rc.sample_polygons(drape, [ring])
                raw = rc.robust_colour(pixels)
                if raw is None:
                    continue
                variant = rc.surface_variant(
                    rc.to_albedo(raw, population_value), base, len(pixels)
                )
                if variant is not None:
                    span_rows.append((vertex_start, variant))
        print(f"  per-surface colour: {len(span_rows)} surfaces differ from their building")

    span_path = out_dir / "buildings_roof_spans.bin"
    span_path.write_bytes(
        b"".join(struct.pack("<I", v) + bytes(rgb) for v, rgb in sorted(span_rows))
    )

    walls: dict[str, int] = {}
    for b in buildings:
        name = WALL_CLASS_NAMES[b["wall"]]
        walls[name] = walls.get(name, 0) + 1
    print(f"  wall classes: {walls}")
    print(f"wrote {colour_path.name} ({colour_path.stat().st_size / 1024:.0f} KB) "
          f"and {span_path.name} ({span_path.stat().st_size / 1024:.0f} KB)")

    return {
        "roofColour": {
            "measured": measured,
            "total": stats["total"],
            "fallback": list(fallback),
            "surfaceVariants": len(span_rows),
            "drapeResolutionM": resolution,
            "source": meta.get("attribution", meta.get("source")),
            "note": (
                "Dachfarbe je Gebäude aus dem mitgelieferten Orthophoto gemessen; "
                "Wandfarbe ist eine Konvention je Gebäudeklasse, keine Messung."
            ),
        },
        "wallClasses": {str(k): v for k, v in WALL_CLASS_NAMES.items()},
        "wallCounts": walls,
    }


def ground_area_m2(rings: list[list[tuple[float, float, float]]]) -> float:
    """Area of the largest ground ring. The coordinates are already UTM metres, so this is direct."""
    best = 0.0
    for ring in rings:
        pts = ring[:-1] if ring[0] == ring[-1] else ring
        if len(pts) < 3:
            continue
        total = 0.0
        for (x1, y1, _), (x2, y2, _) in zip(pts, pts[1:] + pts[:1]):
            total += x1 * y2 - x2 * y1
        best = max(best, abs(total) * 0.5)
    return best


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="ahrtal-2021")
    parser.add_argument("--src", type=Path, default=None)
    parser.add_argument(
        "--radius",
        type=float,
        default=0.0,
        help="metres around each focus place to keep; 0 uses the valley corridor instead",
    )
    parser.add_argument(
        "--corridor",
        type=float,
        default=None,
        help="metres either side of the Ahr centreline to keep",
    )
    parser.add_argument(
        "--min-footprint",
        type=float,
        default=20.0,
        help="square metres; matches the threshold the insured portfolio already uses",
    )
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    # Raw data lives per AOI. Resolved here rather than in the argparse
    # default, which runs before the config is known.
    args.src = args.src or raw_dir("lod2", cfg["id"])
    out_dir = Path("public/terrain") / cfg["id"]
    terrain_meta = json.loads((out_dir / f"{terrain_name(cfg)}.json").read_text(encoding="utf-8"))
    origin_e = terrain_meta["origin"]["easting"]
    origin_n = terrain_meta["origin"]["northing"]
    width_m = terrain_meta["width"] * terrain_meta["resolutionM"]
    depth_m = terrain_meta["height"] * terrain_meta["resolutionM"]

    from utm import wgs84_to_utm32

    centres = [
        (*wgs84_to_utm32(p["lon"], p["lat"]), p["name"], p["id"]) for p in cfg["focusPlaces"]
    ]

    # Which buildings count as "in the valley". A radius around each focus place drops everything
    # between the villages, which is where a good deal of the Ahr actually runs; the corridor is
    # measured against the same centreline the simulation is indexed on, so the 3D buildings and
    # the insured portfolio cover exactly the same ground.
    corridor_m = args.corridor or float(cfg.get("valley", {}).get("corridorM", 2000))
    river_tree = None
    river_name = cfg.get("river", {}).get("name") or "the river"
    keep_all = args.radius <= 0 and cfg.get("river", {}).get("osmWaterwayRef") is None
    if keep_all:
        # An AOI with no centreline keeps everything inside its box. That is right for the
        # Steinbach corridor: 31 km2 chosen around the reservoir and two villages, where the whole
        # box is the subject. The corridor filter exists for the Ahr's 173 km2, most of which is
        # plateau no flood reaches — not as a general rule.
        print(f"keeping every building in the AOI ({cfg['id']} declares no river centreline)")
    elif args.radius <= 0:
        import numpy as np
        from scipy.spatial import cKDTree

        chainage_path = raw_dir("osm", cfg["id"]) / "river_chainage.json"
        if not chainage_path.exists():
            raise SystemExit(f"missing {chainage_path} — run fetch_osm.py first")
        points = load_osm_cache(chainage_path, cfg["id"])["points"]
        river_tree = cKDTree(np.array([wgs84_to_utm32(p["lon"], p["lat"]) for p in points]))
        print(f"keeping buildings within {corridor_m:.0f} m of the {river_name}")
    else:
        print(f"keeping buildings within {args.radius:.0f} m of a focus place")

    positions: list[float] = []
    buildings: list[dict] = []
    roof_outlines: list[list[list[tuple[float, float]]]] = []
    roof_spans: list[list[tuple[int, list[tuple[float, float]]]]] = []
    too_small = 0
    off_terrain = 0
    unsemantic = 0
    surveys: set[str] = set()

    for path in sorted(args.src.glob("*.gml")):
        # `LoD2_32_345_5604_1_NW.gml` — the survey stamps its own state onto every tile.
        stamp = path.stem.rsplit("_", 1)[-1].upper()
        if stamp in LOD2_SOURCES:
            surveys.add(stamp)
        text = read_gml(path)
        root = ET.fromstring(text)
        tile_count = 0

        for building in root.iter(f"{{{NS['bldg']}}}Building"):
            gml_id = building.get(f"{{{NS['gml']}}}id", "")

            ground_rings = []
            for ground in building.iter(f"{{{NS['bldg']}}}GroundSurface"):
                ground_rings.extend(polygons_of(ground))
            if not ground_rings:
                continue

            flat = [pt for ring in ground_rings for pt in ring]
            cx = sum(p[0] for p in flat) / len(flat)
            cy = sum(p[1] for p in flat) / len(flat)

            nearest = min(centres, key=lambda c: (c[0] - cx) ** 2 + (c[1] - cy) ** 2)
            # ⚠️ `keep_all` has to be explicit. The first version of the no-centreline branch only
            # changed which message was printed, so `river_tree` was None and control fell to the
            # elif below — which compares against `args.radius`, and radius is 0 in this branch
            # because `radius <= 0` is what selects it. Every building is further than 0 m from a
            # focus place, so all 2 787 were silently dropped and the run reported success.
            if keep_all:
                pass
            elif river_tree is not None:
                if float(river_tree.query([cx, cy])[0]) > corridor_m:
                    continue
            elif ((nearest[0] - cx) ** 2 + (nearest[1] - cy) ** 2) ** 0.5 > args.radius:
                continue

            # Clip to the terrain. A tile is 2 km and the corridor follows the river, so the
            # selection reaches past the AOI at both ends; a building beyond the heightmap has no
            # ground under it and hangs in the air.
            if not (origin_e <= cx <= origin_e + width_m and origin_n <= cy <= origin_n + depth_m):
                off_terrain += 1
                continue

            # Split the building by what the survey says each surface IS, rather than taking every
            # posList in document order. The semantics are there on 100 % of the 65 830 buildings
            # across both AOIs (`lod2_function_spike.py`), and throwing them away is what forced
            # every building to be one flat colour: a roof cannot be measured from the orthophoto
            # if the mesh no longer knows which triangles are roof.
            roof_surfaces: list[list[tuple[float, float, float]]] = []
            for roof in building.iter(f"{{{NS['bldg']}}}RoofSurface"):
                roof_surfaces.extend(polygons_of(roof))
            solid_rings: list[list[tuple[float, float, float]]] = []
            for tag in ("WallSurface", "GroundSurface", "ClosureSurface"):
                for surface in building.iter(f"{{{NS['bldg']}}}{tag}"):
                    solid_rings.extend(polygons_of(surface))

            all_rings = polygons_of(building)
            if not all_rings:
                continue
            # A handful of buildings carry geometry outside any semantic surface (5 of 53 300 in
            # the Ahr). They still get drawn — losing them would be a worse error than losing
            # their roof colour — but they are counted so the number cannot drift unnoticed.
            if not roof_surfaces and not solid_rings:
                solid_rings = all_rings
                unsemantic += 1

            # The cadastre records every structure, including bin stores and garden sheds. The
            # insured portfolio already drops anything under 20 m2 as not a building worth a
            # policy; applying the same rule here keeps the two describing the same place, and
            # takes a large bite out of the download for geometry nobody can see anyway.
            footprint_m2 = ground_area_m2(ground_rings)
            if footprint_m2 < args.min_footprint:
                too_small += 1
                continue

            start_vertex = len(positions) // 3
            heights: list[float] = []
            geom = (origin_e, origin_n, width_m, depth_m)

            # Walls and ground first, then roofs, so every roof triangle of a building sits in one
            # contiguous run starting at roofVertexStart. The shader needs no per-triangle flag to
            # tell a roof from a wall — the vertex index is the flag.
            for ring in solid_rings:
                emit_fan(ring, positions, heights, *geom)

            roof_start = len(positions) // 3
            surface_spans: list[tuple[int, list[tuple[float, float]]]] = []
            for ring in roof_surfaces:
                surface_start = len(positions) // 3
                if emit_fan(ring, positions, heights, *geom):
                    surface_spans.append((surface_start, [(p[0], p[1]) for p in ring]))

            vertex_count = len(positions) // 3 - start_vertex
            if vertex_count == 0:
                continue

            ground_z = min(p[2] for p in flat)
            function = building.findtext(f"{{{NS['bldg']}}}function", default="").strip()
            measured = building.findtext(f"{{{NS['bldg']}}}measuredHeight", default="").strip()

            # Largest ground ring, in UTM. Kept so observed damage can be matched by CONTAINMENT
            # rather than proximity — see join_observed_damage.py for why that distinction matters.
            largest = max(ground_rings, key=len)
            footprint = [[round(p[0], 2), round(p[1], 2)] for p in largest]

            buildings.append(
                {
                    "id": gml_id,
                    "village": nearest[2],
                    "villageId": nearest[3],
                    "groundElevM": round(ground_z, 2),
                    "roofElevM": round(max(heights), 2) if heights else round(ground_z, 2),
                    "measuredHeightM": round(float(measured), 2) if measured else None,
                    "function": FUNCTION_LABELS.get(function, function or None),
                    "vertexStart": start_vertex,
                    "vertexCount": vertex_count,
                    "roofVertexStart": roof_start,
                    "wall": wall_class(function, footprint_m2, float(measured) if measured else 0.0),
                    "easting": round(cx, 2),
                    "northing": round(cy, 2),
                    "footprint": footprint,
                }
            )
            roof_outlines.append([ring for _, ring in surface_spans])
            roof_spans.append(surface_spans)
            tile_count += 1

        print(f"  {path.name}: {tile_count} buildings kept")

    print(f"\n{len(buildings)} buildings, {len(positions) // 9} triangles")

    # ⚠️ Refuse to write an empty mesh. A filter that rejects everything looks exactly like a
    # tile set that contains nothing, and the run above reported "0 buildings kept" for all 48
    # tiles, wrote a 0-byte .bin and exited 0. The cause was a filter bug, not empty data.
    if not buildings:
        raise SystemExit(
            "No buildings survived the filters, so there is no mesh to write.\n"
            "The tiles are not empty unless the AOI really has no buildings - check the corridor "
            "radius, the river centreline and the terrain extent before assuming they are."
        )

    # Quantise the vertices. float32 is far more precision than a building corner has: the source
    # is a cadastral model, and a quarter of a metre is already below what LoD2 claims. Storing
    # x and z as int16 quarter-metres and y as uint16 centimetres halves the file, which is the
    # difference between shipping the whole valley and shipping three villages.
    #
    # Written planar rather than interleaved so each block stays two-byte aligned and the browser
    # can wrap it in a typed array with no copy.
    xs = positions[0::3]
    ys = positions[1::3]
    zs = positions[2::3]
    # The x/z scale is chosen from the AOI's own extent rather than fixed. int16 spans 32 767
    # steps, so a quarter-metre step reaches ±8.19 km — enough for a 13 km valley and not for a
    # 23 km one. Extending the map east to the Rhine put a vertex at −11 158 m and the guard below
    # stopped the build, which is what it is for. The scale travels in the metadata as `xzScaleM`
    # and the loader already dequantises with it, so widening it costs nothing in the app.
    reach_m = max((abs(v) for v in xs + zs), default=0.0)
    xz_scale = next(
        (step for step in (0.25, 0.5, 1.0, 2.0) if reach_m / step <= 32767),
        2.0,
    )
    y_scale = 0.01
    y_offset = math.floor(min(ys)) if ys else 0.0
    print(f"  vertices reach {reach_m:.0f} m from the centre -> x/z step {xz_scale} m")

    def quantise(values: list[float], scale: float, offset: float, lo: int, hi: int) -> list[int]:
        out = []
        for v in values:
            q = int(round((v - offset) / scale))
            if q < lo or q > hi:
                raise SystemExit(
                    f"vertex {v} falls outside the quantisation range — widen it in "
                    "build_lod2_mesh.py before shipping a bigger AOI"
                )
            out.append(q)
        return out

    qx = quantise(xs, xz_scale, 0.0, -32768, 32767)
    qy = quantise(ys, y_scale, y_offset, 0, 65535)
    qz = quantise(zs, xz_scale, 0.0, -32768, 32767)

    bin_path = out_dir / "buildings_lod2.bin"
    bin_path.write_bytes(
        struct.pack(f"<{len(qx)}h", *qx)
        + struct.pack(f"<{len(qy)}H", *qy)
        + struct.pack(f"<{len(qz)}h", *qz)
    )

    per_village: dict[str, int] = {}
    for b in buildings:
        per_village[b["village"]] = per_village.get(b["village"], 0) + 1

    # ⚠️ Credit the survey that actually flew these tiles. This block used to name LVermGeo
    # Rheinland-Pfalz for every AOI, so all 12 530 Steinbach buildings — NRW tiles, dl-de/zero-2-0,
    # a different authority in a different state — were published under RP's name and licence.
    if len(surveys) != 1:
        raise SystemExit(
            f"cannot attribute the mesh: tiles are stamped {sorted(surveys) or 'nothing'}.\n"
            "One AOI must come from one survey, or the credit in the footer is a guess."
        )
    source, attribution = LOD2_SOURCES[surveys.pop()]

    colour_meta = write_roof_colours(out_dir, buildings, roof_outlines, roof_spans) or {}

    common = {
        "aoi": cfg["id"],
        "count": len(buildings),
        "vertexCount": len(positions) // 3,
        "perVillage": per_village,
        "source": source,
        "attribution": attribution,
        **colour_meta,
    }

    # The browser needs six fields per building and never touches the footprint rings, which are
    # most of the bytes. They are written separately for the offline damage join, so the app is not
    # made to download a polygon library it has no use for.
    #
    # easting/northing are two of the six: the scene resolves each building's chainage point from
    # its UTM centroid at load. They were dropped here once as "the browser does not need this",
    # which cost nothing at build time and silently painted 97 % of the valley as submerged,
    # because the missing field arrived in the shader as NaN and NaN resolves to chainage 0.
    meta_path = out_dir / "buildings_lod2.json"
    meta_path.write_text(
        json.dumps(
            {
                **common,
                "encoding": (
                    f"planar int16 x ({xz_scale} m), uint16 y ({y_scale} m above yOffsetM), "
                    f"int16 z ({xz_scale} m)"
                ),
                "quantisation": {"xzScaleM": xz_scale, "yScaleM": y_scale, "yOffsetM": y_offset},
                "buildings": [
                    {
                        "village": b["village"],
                        "groundElevM": b["groundElevM"],
                        "vertexStart": b["vertexStart"],
                        "vertexCount": b["vertexCount"],
                        "roofVertexStart": b["roofVertexStart"],
                        "wall": b["wall"],
                        "easting": b["easting"],
                        "northing": b["northing"],
                    }
                    for b in buildings
                ],
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )

    # 🔴 This file must NOT go under public/. It carries, per cadastral ID, the exact footprint,
    # the building function and the Copernicus observed damage grade — 2 080 real addresses in the
    # Ahr AOI, most of them `Wohnhaus`. PLAN §2.2 permits that grading in aggregate and forbids
    # attaching it to an individual real address in the interface, and src/twin3d/buildings.ts
    # states outright that these fields "never reach the client".
    #
    # They did. Vite copies public/ into dist/, so until 2026-07-29 this sat on a public URL
    # returning HTTP 200 to anyone who asked. Withholding it from the UI achieves nothing while the
    # file itself is served. It is a pipeline artefact — join_observed_damage.py is its only
    # reader — so it belongs under data/derived/.
    footprint_dir = Path("data/derived") / cfg["id"]
    footprint_dir.mkdir(parents=True, exist_ok=True)
    footprint_path = footprint_dir / "buildings_lod2_footprints.json"
    footprint_path.write_text(
        json.dumps({**common, "buildings": buildings}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"wrote {footprint_path} (pipeline artefact — never deployed, see PLAN §2.2)")

    stale_footprints = out_dir / "buildings_lod2_footprints.json"
    if stale_footprints.exists():
        size_mb = stale_footprints.stat().st_size / 1024 / 1024
        stale_footprints.unlink()
        print(f"removed deployed {stale_footprints.name} ({size_mb:.1f} MB) — §2.2 violation")

    print(f"per village: {per_village}")
    print(f"skipped {too_small} structures under {args.min_footprint:.0f} m2")
    print(f"skipped {off_terrain} outside the terrain extent")
    if unsemantic:
        print(f"{unsemantic} buildings had no semantic surfaces — drawn, but not roof-coloured")
    print(f"wrote {bin_path} ({bin_path.stat().st_size / 1024 / 1024:.1f} MB)")
    print(f"wrote {meta_path} ({meta_path.stat().st_size / 1024:.0f} KB)")
    print(f"wrote {footprint_path} ({footprint_path.stat().st_size / 1024:.0f} KB, offline only)")


if __name__ == "__main__":
    main()
