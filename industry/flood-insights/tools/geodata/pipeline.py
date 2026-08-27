"""Run the whole geodata pipeline end to end.

One command from an empty checkout to a runnable app. Every step downloads from an open source
and is safe to re-run — downloads are checksum-verified and skipped when already present.

    python tools/geodata/pipeline.py

Roughly 250 MB is downloaded on a first run and about 31 MB of derived assets end up in
`public/terrain/`. Sources and licences are listed in NOTICE.md; the attribution is not optional.

Steps
  1. gauges       official reference values for the river gauges (LfU Rheinland-Pfalz)
  2. osm          river centreline -> chainage model, and building footprints
  3. dgm1         1 m terrain tiles (LVermGeo) -> 4 m heightmap
  4. dom1         1 m surface tiles (LVermGeo), for the vegetation
  5. flowfield    nearest-chainage index + connectivity mask
  6. rating       stage-discharge curve per chainage point, from real cross-sections
  7. emsr517      Copernicus observed flood extent + damage grading
  8. validate     IoU of simulated against observed
  9. portfolio    hazard classes, per-building impact, synthetic insurance book
 10. lod2         LoD2 CityGML -> building mesh, with observed grades joined by containment
 11. vegetation   DOM1 minus DGM1 -> individual tree tops, with their measured heights
 12. landuse      OSM land cover and transport network -> surface colour raster
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).parent

STEPS: list[tuple[str, list[str], str]] = [
    ("gauges", ["fetch_lfu_reference.py"], "official gauge reference values"),
    ("osm", ["fetch_osm.py"], "river centreline and chainage model"),
    ("osm-buildings", ["fetch_osm_buildings.py"], "building footprints"),
    ("osm-landuse", ["fetch_osm_landuse.py"], "land cover and transport network"),
    ("dgm1", ["fetch_dgm1.py"], "1 m terrain tiles"),
    ("dom1", ["fetch_dom1.py"], "1 m surface tiles, for the vegetation"),
    ("terrain", ["build_terrain.py"], "4 m heightmap"),
    ("flowfield", ["build_flowfield.py"], "chainage index and connectivity"),
    ("rating", ["build_rating.py"], "stage-discharge rating per cross-section"),
    ("emsr517", ["probe_emsr517.py"], "Copernicus product catalogue"),
    ("emsr517-download", ["check_emsr517_coverage.py"], "Copernicus products and coverage"),
    ("validate", ["validate_simulation.py"], "validation against Copernicus"),
    ("portfolio", ["build_portfolio.py"], "hazard classes and synthetic portfolio"),
    ("app-portfolio", ["export_app_portfolio.py"], "packed portfolio for the browser"),
    # ⚠️ Before lod2-mesh, not after: the roof colours are sampled out of this photograph, so a
    # mesh built first gets the fallback grey for every building and nothing says so.
    ("drape", ["fetch_drape.py"], "aerial photo for the whole AOI, aligned to the heightmap"),
    # After the drape, because it measures it: where an AOI spans more than one flight campaign
    # the two meet in a visible step, and this solves the exponent that makes them render alike.
    (
        "drape-match",
        ["match_drape_campaigns.py"],
        "exposure match between flight campaigns of the orthophoto",
    ),
    ("lod2", ["fetch_lod2.py", "--around-places", "2", "--along-river", "1"], "LoD2 CityGML tiles"),
    ("lod2-mesh", ["build_lod2_mesh.py"], "LoD2 building mesh"),
    ("vegetation", ["build_vegetation.py", "--spacing", "10"], "trees from DOM1 minus DGM1"),
    ("landuse", ["build_landuse.py"], "land cover raster for surface colour"),
    ("observed-damage", ["join_observed_damage.py"], "observed damage grades"),
    # Optional and last: 154 MB of tiles that only photorealistic rendering ever fetches, and the
    # app is complete without them — the switch simply does not appear.
    ("drape-detail", ["fetch_drape_detail.py"], "high-resolution aerial windows per village"),
]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", nargs="*", help="run only these steps")
    parser.add_argument("--skip", nargs="*", default=[], help="skip these steps")
    parser.add_argument("--list", action="store_true", help="list the steps and exit")
    args = parser.parse_args()

    if args.list:
        for name, _cmd, description in STEPS:
            print(f"  {name:<18} {description}")
        return

    steps = [s for s in STEPS if (not args.only or s[0] in args.only) and s[0] not in args.skip]
    print(f"running {len(steps)} step(s)\n")

    started = time.time()
    for index, (name, command, description) in enumerate(steps, start=1):
        print(f"[{index}/{len(steps)}] {name} — {description}")
        result = subprocess.run(
            [sys.executable, str(HERE / command[0]), *command[1:]],
            cwd=HERE.parents[1],
        )
        if result.returncode != 0:
            raise SystemExit(f"\nstep '{name}' failed with exit code {result.returncode}")
        print()

    print(f"pipeline complete in {(time.time() - started) / 60:.1f} min")
    print("assets are in public/terrain/ — `npm run dev` will now render the twin")


if __name__ == "__main__":
    main()
