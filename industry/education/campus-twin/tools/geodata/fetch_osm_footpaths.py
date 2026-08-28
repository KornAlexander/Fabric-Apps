"""Fetch the pedestrian network — PLAN Phase 8, step 3.

Campus Flow routes people between the rooms their timetable actually sends them to, and it routes
them on the paths that actually exist. Straight lines between buildings would be a much easier
thing to draw and a completely different claim: the whole point of the lens is that the Mensa
bridge and the Schlossberg steps are where the load lands, and you only get that from real
geometry.

What counts as walkable is a decision, not a fact, so it is written down here rather than buried:

  * `highway=footway|path|steps|pedestrian|living_street|track` — the obvious cases
  * `highway=service|residential|unclassified` — campus service roads carry pedestrians in practice
    and excluding them cuts the graph into disconnected islands around Garching's car parks
  * `highway=tertiary|secondary|primary` — city streets carry PAVEMENTS, and excluding them cuts
    the graph at exactly the arterials a campus is divided by. ⚠️ ADDED 2026-08-21, and the same
    lesson as the service-road line above at a larger scale: without them, RWTH Aachen's network
    came back in TWO components and 10 409 of 21 115 building pairs had no route at all — not
    between the campuses, but between the Informatikzentrum and the Hauptgebäude, 1.3 km apart in
    the middle of the city. Aachen's halves are separated by the railway and the Süsterfeld- and
    Schurzelter Straße corridor, whose crossings are classified roads with pavements that OSM does
    not map as separate footways. Regensburg, Garching and Munich never exposed it because their
    campuses are compact enough to be spanned by service roads alone.
  * anything tagged `foot=no` or `access=private` is dropped whatever its highway value — which is
    what keeps a grade-separated trunk road out despite the line above

⚠️ **Steps are kept and flagged, not excluded.** Tübingen's Schlossberg is reached by stairs, and a
router that avoids them produces a beautiful, useless answer that walks everyone the long way round.
They are marked so the cost model can penalise them without pretending they are absent.

Output (data/raw/osm/<aoi>/footpaths.json)

Usage
  python tools/geodata/fetch_osm_footpaths.py --aoi garching
"""

from __future__ import annotations

import argparse
import json

from aoi import bbox_tuple, cache_dir, load_aoi
from overpass_client import overpass

WALKABLE = (
    "footway|path|steps|pedestrian|living_street|track|"
    "service|residential|unclassified|cycleway|corridor|"
    # ⚠️ THE CLASSIFIED STREETS, AND THEY ARE NOT OPTIONAL IN A CITY — see the module note.
    # `foot=no`/`access=private` in the query below is what keeps the genuinely unwalkable ones out,
    # which is why this can be a highway-class list rather than a per-city allow-list.
    "tertiary|secondary|primary"
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="oth-regensburg")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    out_dir = cache_dir("raw", "osm", cfg["id"])
    out_path = out_dir / "footpaths.json"
    if out_path.exists() and not args.force:
        print(f"cached: {out_path} (use --force to re-fetch)")
        return

    south, west, north, east = bbox_tuple(cfg)
    query = f"""
    [out:json][timeout:180];
    (
      way["highway"~"^({WALKABLE})$"]["foot"!="no"]["access"!="private"]({south},{west},{north},{east});
    );
    out geom tags;
    """

    print(f"fetching pedestrian network for {cfg['id']} ({south},{west},{north},{east})")
    data = overpass(query)
    elements = data.get("elements", [])

    ways = []
    kinds: dict[str, int] = {}
    for element in elements:
        geometry = element.get("geometry")
        if not geometry or len(geometry) < 2:
            continue
        tags = element.get("tags", {})
        highway = tags.get("highway", "?")
        kinds[highway] = kinds.get(highway, 0) + 1
        ways.append(
            {
                "id": element["id"],
                "highway": highway,
                "steps": highway == "steps",
                "name": tags.get("name"),
                "nodes": element.get("nodes", []),
                "geometry": [[round(p["lon"], 7), round(p["lat"], 7)] for p in geometry],
            }
        )

    out_path.write_text(
        json.dumps({"aoi": cfg["id"], "count": len(ways), "ways": ways}, ensure_ascii=False),
        encoding="utf-8",
    )

    print(f"\n{len(ways)} walkable ways")
    for kind, n in sorted(kinds.items(), key=lambda kv: -kv[1]):
        print(f"  {kind:<16} {n:>5}")
    print(f"wrote {out_path} ({out_path.stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
