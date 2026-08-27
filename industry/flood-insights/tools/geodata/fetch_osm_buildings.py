"""Fetch building footprints for an AOI from OpenStreetMap.

These are the objects the whole insurance story hangs on (PLAN §7, §9.3): every building gets a
ground elevation, an inundation depth per timestep, a hazard class and a synthetic policy.

LoD2 CityGML from LVermGeo (§4.2) carries real roof geometry and is the eventual source for the 3D
buildings. OSM footprints are used here because they are enough to establish the *analytical*
chain — footprint, centroid, area, ground elevation — without waiting on the CityGML pipeline.

Licence: OpenStreetMap contributors, ODbL. Attribution is mandatory — see NOTICE.md.

Usage
  python tools/geodata/fetch_osm_buildings.py --out data/raw/osm
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from aoi import bbox_tuple, load_aoi, raw_dir
from fetch_osm import overpass

# The valley, not a ring around each village. Querying a radius around the focus places missed
# every settlement between them — Rech, Marienthal, Walporzheim, Reimerzhoven — which is most of
# the places the flood actually went through. The AOI is taken whole and then narrowed to a band
# along the Ahr, so the plateau villages that sit hundreds of metres above the river (Ringen,
# Holzweiler, Lantershofen) stay out without having to name them.
DEFAULT_CORRIDOR_M = 2000


def build_query(bbox: tuple[float, float, float, float]) -> str:
    south, west, north, east = bbox
    b = f"{south},{west},{north},{east}"
    return f"""
[out:json][timeout:280];
(
  way["building"]({b});
  relation["building"]({b});
);
out geom;
"""


def river_corridor(chainage_path: Path):
    """A lookup that answers how far a point is from the Ahr, in metres.

    Uses the chainage model the rest of the pipeline is indexed on, so 'the valley' means the same
    thing here as it does in the simulation.

    ⚠️ The corridor is a band along the reach, not a sausage with round caps. A nearest-point
    distance alone gives the ends a half-disc of radius `corridorM`, and past the mouth that disc
    lands on the far side of the Rhine: 1 531 buildings in Linz am Rhein and Leubsdorf measured as
    "Ahr valley" and were filed under Kripp, up to 1.4 km beyond the Rhine's centreline. They were
    never touched by the Ahr. Anything past either end of the reach is therefore rejected outright,
    however close it is to the endpoint.
    """
    import numpy as np
    from scipy.spatial import cKDTree

    from utm import wgs84_to_utm32

    payload = json.loads(chainage_path.read_text(encoding="utf-8"))
    points = np.array([wgs84_to_utm32(p["lon"], p["lat"]) for p in payload["points"]])
    tree = cKDTree(points)
    last = len(points) - 1

    # Flow direction at each end, used to tell "beside the reach" from "past the end of it".
    start_dir = points[min(3, last)] - points[0]
    end_dir = points[last] - points[max(0, last - 3)]
    start_dir = start_dir / (np.linalg.norm(start_dir) or 1)
    end_dir = end_dir / (np.linalg.norm(end_dir) or 1)

    def distance_m(lon: float, lat: float) -> float:
        e, n = wgs84_to_utm32(lon, lat)
        distance, index = tree.query([e, n])
        # Half-planes at each end, tested regardless of which chainage point is nearest. Gating on
        # `index == last` was not enough: near the confluence the Ahr runs east-north-east, so a
        # building across the Rhine can still be nearest to an interior point and slip through.
        # That left 189 of them after the first attempt, all filed under Kripp.
        if float(np.dot([e, n] - points[last], end_dir)) > 0:
            return float("inf")  # downstream of the mouth
        if float(np.dot([e, n] - points[0], start_dir)) < 0:
            return float("inf")  # upstream of where the reach starts
        return float(distance)

    return distance_m


def polygon_centroid(points: list[tuple[float, float]]) -> tuple[float, float, float]:
    """Return (lon, lat, area_deg2) via the shoelace formula.

    Degenerate rings (a handful in OSM) fall back to the vertex mean so they are not silently
    dropped — a building with no policy attached would quietly bias the portfolio.
    """
    area2 = 0.0
    cx = 0.0
    cy = 0.0
    for i in range(len(points)):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % len(points)]
        cross = x1 * y2 - x2 * y1
        area2 += cross
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    if abs(area2) < 1e-14:
        n = max(len(points), 1)
        return sum(p[0] for p in points) / n, sum(p[1] for p in points) / n, 0.0
    return cx / (3 * area2), cy / (3 * area2), abs(area2) / 2


def area_m2(points: list[tuple[float, float]], lat: float) -> float:
    """Approximate planar area, adequate for a footprint a few tens of metres across."""
    m_per_deg_lat = 111_320.0
    m_per_deg_lon = 111_320.0 * math.cos(math.radians(lat))
    metric = [(x * m_per_deg_lon, y * m_per_deg_lat) for x, y in points]
    area2 = 0.0
    for i in range(len(metric)):
        x1, y1 = metric[i]
        x2, y2 = metric[(i + 1) % len(metric)]
        area2 += x1 * y2 - x2 * y1
    return abs(area2) / 2


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="ahrtal-2021")
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument(
        "--corridor",
        type=int,
        default=None,
        help="metres either side of the Ahr centreline that count as the valley",
    )
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    # Raw data lives per AOI. Resolved here rather than in the argparse
    # default, which runs before the config is known.
    args.out = args.out or raw_dir("osm", cfg["id"])
    places = cfg["focusPlaces"]
    south, west, north, east = bbox_tuple(cfg)
    corridor_m = args.corridor or int(cfg.get("valley", {}).get("corridorM", DEFAULT_CORRIDOR_M))

    # The corridor filter exists because the Ahr's AOI is 173 km2 and most of it is plateau that
    # no flood reaches — keeping every building would triple the payload with houses that are
    # never wet. An AOI without a river centreline does not get that filter, and should not: the
    # Steinbach box is 31 km2 chosen around the reservoir and two villages, so everything inside
    # it is the subject. Requiring a chainage file there would have meant inventing a centreline
    # for a stream the app has no reason to model.
    chainage_path = args.out / "river_chainage.json"
    river_name = cfg.get("river", {}).get("name") or "the river"
    if chainage_path.exists():
        distance_to_river = river_corridor(chainage_path)
        print(f"AOI {cfg['id']}: whole bbox, kept within {corridor_m} m of the {river_name}")
    elif cfg.get("river", {}).get("osmWaterwayRef") is None:
        distance_to_river = None
        print(f"AOI {cfg['id']}: whole bbox, no river corridor (this AOI declares no centreline)")
    else:
        raise SystemExit(
            f"missing {chainage_path} — run fetch_osm.py first, or set river.osmWaterwayRef to "
            "null in the AOI config if this area is not meant to have a centreline."
        )
    result = overpass(build_query(bbox_tuple(cfg)))
    elements = result.get("elements", [])
    print(f"  {len(elements)} building elements returned")

    buildings = []
    skipped = 0
    off_valley = 0
    for element in elements:
        geometry = element.get("geometry")
        if not geometry or len(geometry) < 3:
            skipped += 1
            continue
        ring = [(p["lon"], p["lat"]) for p in geometry]
        lon, lat, _ = polygon_centroid(ring)

        # `out geom` returns the whole of any way that merely touches the bbox, so clip.
        if not (west <= lon <= east and south <= lat <= north):
            skipped += 1
            continue

        # The valley, measured against the same centreline the simulation is indexed on.
        if distance_to_river is not None and distance_to_river(lon, lat) > corridor_m:
            off_valley += 1
            continue

        tags = element.get("tags", {})
        footprint = area_m2(ring, lat)
        if footprint < 20:  # sheds, bin stores; not insurable buildings
            skipped += 1
            continue

        # Nearest focus place, used later for the village breakdown.
        nearest = min(
            places,
            key=lambda p: (p["lat"] - lat) ** 2 + (p["lon"] - lon) ** 2,
        )

        levels = tags.get("building:levels")
        buildings.append(
            {
                "buildingId": f"osm-{element['type'][0]}{element['id']}",
                "lon": round(lon, 7),
                "lat": round(lat, 7),
                "footprintM2": round(footprint, 1),
                "buildingType": tags.get("building", "yes"),
                "levels": int(levels) if levels and levels.isdigit() else None,
                "street": tags.get("addr:street"),
                "village": nearest["name"],
                "villageId": nearest["id"],
            }
        )

    print(f"  kept {len(buildings)}, skipped {skipped}, outside the valley {off_valley}")
    by_village: dict[str, int] = {}
    for b in buildings:
        by_village[b["village"]] = by_village.get(b["village"], 0) + 1
    print(f"  per village: {by_village}")

    # ⚠️ Refuse to overwrite good data with an empty answer. Overpass under load returns HTTP 200
    # with zero elements rather than an error, and this step happily wrote a 0 KB buildings.json
    # over a 4.9 MB one — the whole portfolio silently gone, with only a cheerful "kept 0" to say
    # so. A rerun is cheap; losing the fetch is not.
    if not buildings:
        raise SystemExit(
            "Overpass returned no buildings. Refusing to overwrite "
            f"{args.out / 'buildings.json'} — rerun when the API is responding."
        )

    args.out.mkdir(parents=True, exist_ok=True)
    target = args.out / "buildings.json"
    target.write_text(
        json.dumps(
            {
                "aoi": cfg["id"],
                "count": len(buildings),
                "attribution": "© OpenStreetMap contributors (ODbL)",
                "buildings": buildings,
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )
    print(f"\nwrote {target} ({target.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
