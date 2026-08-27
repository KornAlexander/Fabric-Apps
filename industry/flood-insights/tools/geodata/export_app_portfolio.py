"""Export a compact portfolio bundle for the browser — the data the Act IV levers run on.

PLAN §7.4: the levers have to respond instantly, because the argument only lands if the audience
sees the number move while they are still holding the question. So the per-building data goes to
the client and the what-if is recomputed there, rather than round-tripping to a UDF for every
slider tick. (The UDFs in §10.4 remain the server-side surface for the assistant and any external
caller — same logic, three surfaces.)

Size matters: 5 273 buildings as verbose JSON is ~1.5 MB. Packing to parallel arrays with rounded
values brings it under 300 KB, which is inside the §9.4 budget.

Usage
  python tools/geodata/export_app_portfolio.py
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

from aoi import load_aoi


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="ahrtal-2021")
    parser.add_argument("--curated", type=Path, default=Path("data/curated"))
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    out_dir = Path("public/terrain") / cfg["id"]

    buildings = {
        row["buildingId"]: row
        for row in csv.DictReader((args.curated / "geo_building.csv").open(encoding="utf-8"))
    }
    policies = list(csv.DictReader((args.curated / "portfolio_policy.csv").open(encoding="utf-8")))

    villages: list[str] = []
    hazard_classes = ["GK1", "GK2", "GK3", "GK4"]

    village_idx: list[int] = []
    hazard_idx: list[int] = []
    ground: list[float] = []
    chainage: list[int] = []
    sum_insured: list[int] = []
    elementar: list[int] = []
    deductible: list[int] = []
    waiting: list[int] = []

    skipped = 0
    for policy in policies:
        building = buildings.get(policy["buildingId"])
        # Buildings with no hydraulic connection cannot flood at any discharge, so they carry
        # no exposure in the what-if and are left out of the client bundle.
        #
        # Compared against the empty string on purpose. csv.DictReader yields strings, so "0" is
        # truthy today and the one building sitting on chainage 0 — the top of the reach at
        # Kreuzberg — survives a truthiness test by luck rather than by intent. Swap this loader
        # for one that parses integers and `not chainageIndex` would silently drop it. That is
        # the same falsy-zero trap that once put the whole valley under 122 m of water; see the
        # note on resolveSiteChainage in src/twin3d/chainage.ts.
        if not building or building["chainageIndex"] == "":
            skipped += 1
            continue

        village = policy["village"]
        if village not in villages:
            villages.append(village)

        village_idx.append(villages.index(village))
        hazard_idx.append(hazard_classes.index(policy["hazardClass"]))
        ground.append(round(float(building["groundElevM"]), 2))
        chainage.append(int(building["chainageIndex"]))
        sum_insured.append(int(float(policy["sumInsuredEur"])))
        elementar.append(1 if policy["elementarCover"] == "True" else 0)
        deductible.append(int(float(policy["deductibleEur"])))
        waiting.append(1 if policy["waitingPeriodOpen"] == "True" else 0)

    bundle = {
        "aoi": cfg["id"],
        "insurer": "Musterschutz Gruppe",
        "synthetic": True,
        "count": len(ground),
        "villages": villages,
        "hazardClasses": hazard_classes,
        "villageIndex": village_idx,
        "hazardIndex": hazard_idx,
        "groundElevM": ground,
        "chainageIndex": chainage,
        "sumInsuredEur": sum_insured,
        "elementarCover": elementar,
        "deductibleEur": deductible,
        "waitingPeriodOpen": waiting,
        # The whole portfolio, including the buildings left out above.
        #
        # Two scalars rather than 6 744 more rows, because the only thing the client needs them
        # for is a denominator. Without them the app divided the Elementar count by the buildings
        # it happened to ship and displayed 39,8 %, while the report and the PLAN Phase-2 gate
        # both said 37,2 % — the same question answered twice, 2,6 points apart, because one
        # surface silently excluded the buildings that cannot flood. The lever still operates on
        # the exposed subset, which is correct: a building with no hydraulic route contributes no
        # loss whatever cover it carries.
        "portfolioTotal": len(policies),
        "elementarTotal": sum(1 for p in policies if p["elementarCover"] == "True"),
        # People per building is a modelling assumption, not a count of anybody. Used only to show
        # that warning time moves lives while damage barely moves (Act IV lesson 1).
        #
        # ⚠️ 2.1 was chosen when the map held 5 273 buildings in three villages. Extending the AOI
        # to the Rhine took it to 20 346 across twenty settlements and changed the building mix at
        # both ends, without this number being revisited. Measured against the current stock, over
        # the 5 392 buildings the flood reaches:
        #
        #   flat 2.1 on everything          11 323 people   <- what the app shows
        #   of which non-housing               655 people   (5.8 % — 150 garages, 24 schools,
        #                                                    22 industrial, sheds, carports, roofs;
        #                                                    the schools are empty at 02:00)
        #   storey-aware floor on housing   12 557 people   (+11 %, one household per storey)
        #
        # The two errors are of similar size and opposite sign, which is exactly why a flat
        # multiplier keeps looking defensible while the map changes shape underneath it. It has
        # not been replaced because only 19 % of the housing carries a storey count at all, so a
        # storey-aware model would be guessing for the other 81 % — trading a stated assumption
        # for an unstated one. The assumption is instead disclosed in the panel (act4.note).
        "assumedResidentsPerBuilding": 2.1,
        "note": (
            "Gebäudegeometrie real (OpenStreetMap, ODbL). Alle Versicherungsdaten synthetisch, "
            "Seed 20210714. Musterschutz Gruppe ist ein fiktives Unternehmen."
        ),
    }

    target = out_dir / "portfolio.json"
    target.write_text(json.dumps(bundle, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(ground)} buildings exported ({skipped} unconnected skipped)")
    print(f"villages: {villages}")
    print(f"wrote {target} ({target.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
