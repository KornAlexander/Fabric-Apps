"""Fetch the Steinbachtalsperre's mapped water body and dam from OpenStreetMap.

⚠️ Why this exists rather than a flood fill on the terrain.

The first attempt seeded a fill at the lowest cell near the dam and filled at crest level. It took
64 % of the map. Two reasons, both instructive:

  1. The `DAM` constant in `src/twin3d/steinbachCorridor.ts` (6.83748, 50.59070) is INSIDE the
     reservoir, not on the wall — OSM puts the wall at 6.83244, 50.58745, the south-west end of a
     body that runs north-east. The constant is fine for pointing a camera and useless for seeding
     a basin.
  2. Crest level is by definition the level at which the reservoir spills. A fill at exactly that
     height escapes through the outlet and over the wall, which is not a bug in the fill — it is
     what a crest is.

The reservoir is a mapped object with a surveyed outline. Asking for it is both simpler and more
honest than inferring it from a height threshold.

Output: public/terrain/<aoi>/reservoir.json — the outline in lon/lat, plus the dam way.
"""

from __future__ import annotations

import argparse
import json
import urllib.parse
import urllib.request
from pathlib import Path

from aoi import load_aoi

OVERPASS = "https://overpass-api.de/api/interpreter"

QUERY = """
[out:json][timeout:90];
(
  way["natural"="water"]["name"="{name}"]({s},{w},{n},{e});
  way["waterway"="dam"]({s},{w},{n},{e});
);
out geom;
"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="steinbach-2021")
    parser.add_argument("--name", default="Steinbachtalsperre", help="OSM name of the water body")
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    b = cfg["bbox"]
    query = QUERY.format(
        name=args.name, s=b["south"], w=b["west"], n=b["north"], e=b["east"]
    )

    request = urllib.request.Request(
        OVERPASS,
        data=urllib.parse.urlencode({"data": query}).encode(),
        headers={"User-Agent": "flut-insights/1.0 (research; open data)"},
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        payload = json.loads(response.read().decode("utf-8"))

    water = None
    dams = []
    for element in payload.get("elements", []):
        tags = element.get("tags", {})
        geometry = element.get("geometry") or []
        if not geometry:
            continue
        ring = [[round(p["lon"], 7), round(p["lat"], 7)] for p in geometry]
        if tags.get("name") == args.name and tags.get("natural") == "water":
            water = ring
        elif tags.get("waterway") == "dam":
            dams.append(ring)

    if water is None:
        raise SystemExit(
            f"no water body named '{args.name}' in the {args.aoi} bbox. Overpass returned "
            f"{len(payload.get('elements', []))} elements. Check the name in OSM rather than "
            "guessing one — an outline for the wrong lake would be worse than none."
        )

    lons = [p[0] for p in water]
    lats = [p[1] for p in water]
    out_dir = Path("public/terrain") / cfg["id"]
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / "reservoir.json"
    target.write_text(
        json.dumps(
            {
                "aoi": cfg["id"],
                "name": args.name,
                "source": "OpenStreetMap",
                "licence": "ODbL",
                "attribution": "© OpenStreetMap contributors (ODbL)",
                "note": (
                    "The mapped extent of the water body, used to bound the drawn water surface. "
                    "The LEVEL comes from the operator's published figures in src/data/steinbach.ts "
                    "— this file says where the reservoir is, never how full it was."
                ),
                "outline": water,
                "dams": dams,
                "boundsWgs84": {
                    "west": min(lons),
                    "south": min(lats),
                    "east": max(lons),
                    "north": max(lats),
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    print(f"{args.name}: {len(water)} outline nodes, {len(dams)} dam way(s)")
    print(f"  bbox {min(lons):.5f},{min(lats):.5f} .. {max(lons):.5f},{max(lats):.5f}")
    print(f"wrote {target} ({target.stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
