"""Phase 2 + §6.4 — hazard classes, per-building inundation, damage and the synthetic portfolio.

Produces the tables the semantic model is built on (PLAN §8.2):
  geo_building.csv        footprint, village, ground elevation, chainage, hazard class
  sim_building_impact.csv depth and damage per building per timestep
  portfolio_policy.csv    the synthetic Musterschutz book
  claims_claim.csv        claims arising from the 2021 event

Three things in here are load-bearing and easy to get wrong:

1. **The hazard class is derived, not copied.** ZÜRS Geo is a GDV product and is not licensable
   (PLAN §5). So GK1–4 is computed from public data: for each building, find the discharge at which
   it first floods, convert that to a return period using the LfU Jährlichkeiten, and bin it on the
   same frequency boundaries ZÜRS uses. It is labelled everywhere as *not* ZÜRS.

2. **Every policy is invented.** Buildings and streets are real; customers, sums insured, coverage
   and claims are synthetic and seeded (§2.2 rule 3). The insurer is fictional — "Musterschutz",
   using the German placeholder prefix so it reads as invented on sight.

3. **The Elementar penetration is a calibration target, not an output.** Rheinland-Pfalz sat at
   roughly 37 % when this happened, and that gap is the point of Act IV lesson 3. The seeding is
   correlated with hazard class but must reproduce that headline share.

Usage
  python tools/geodata/build_portfolio.py
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import random
from pathlib import Path

import numpy as np

from aoi import load_aoi, load_osm_cache, raw_dir, terrain_name
from utm import wgs84_to_utm32

SEED = 20210714  # the date, so the book is reproducible and obviously not a real one

MUSTERSCHUTZ = "Musterschutz Gruppe"

# LfU Jährlichkeiten for Pegel Altenahr, series 1947–2021 (provisional recalculation, Stand 10/2024).
RETURN_PERIODS = [2, 5, 10, 20, 25, 50, 100]
HQ_VALUES = [73, 124, 175, 242, 268, 367, 500]

# JRC depth–damage curve for European residential buildings (Huizinga, de Moel & Szewczyk 2017):
# damage ratio of structure value against water depth in metres.
JRC_DEPTH_M = [0.0, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 6.0]
JRC_RATIO = [0.00, 0.25, 0.40, 0.50, 0.60, 0.75, 0.85, 0.95, 1.00]

# Inundation classes (PLAN §6.4).
def inundation_class(depth: float) -> str:
    if depth <= 0:
        return "trocken"
    if depth < 0.2:
        return "Kontakt"
    if depth < 1.0:
        return "Erdgeschoss"
    if depth < 2.5:
        return "über Erdgeschoss"
    return "überflutet"


def extrapolated_hq(period: float) -> float:
    """Discharge for a return period, log-extrapolated beyond the published HQ100.

    The GK1/GK2 boundary sits at a 200-year event, which the LfU table does not publish. Gumbel
    behaviour is close to linear in ln(T), so the last two published points are extended. Flagged
    as an extrapolation wherever it is used.
    """
    if period <= RETURN_PERIODS[-1]:
        return float(np.interp(period, RETURN_PERIODS, HQ_VALUES))
    slope = (HQ_VALUES[-1] - HQ_VALUES[-2]) / (
        math.log(RETURN_PERIODS[-1]) - math.log(RETURN_PERIODS[-2])
    )
    return HQ_VALUES[-1] + slope * (math.log(period) - math.log(RETURN_PERIODS[-1]))


def return_period_for(discharge: float) -> float:
    """Invert the frequency curve: how rare is this discharge at Altenahr?"""
    if discharge <= HQ_VALUES[0]:
        return 2.0
    if discharge <= HQ_VALUES[-1]:
        return float(np.interp(discharge, HQ_VALUES, RETURN_PERIODS))
    slope = (HQ_VALUES[-1] - HQ_VALUES[-2]) / (
        math.log(RETURN_PERIODS[-1]) - math.log(RETURN_PERIODS[-2])
    )
    return math.exp(math.log(RETURN_PERIODS[-1]) + (discharge - HQ_VALUES[-1]) / slope)


def hazard_class(period: float) -> tuple[str, str]:
    """GK1–4 on the ZÜRS frequency boundaries, from public data only."""
    if period <= 10:
        return "GK4", "HQ10 oder häufiger"
    if period <= 100:
        return "GK3", "seltener als HQ10, mindestens HQ100"
    if period <= 200:
        return "GK2", "seltener als HQ100, mindestens HQ200"
    return "GK1", "seltener als HQ200"


def load_grid(terrain_dir: Path, meta: dict) -> np.ndarray:
    raw = np.fromfile(terrain_dir / meta["file"], dtype="<u2")
    grid = raw.reshape(meta["height"], meta["width"]).astype(np.float32)
    return grid * meta["heightScale"] + meta["heightMinM"]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="ahrtal-2021")
    parser.add_argument("--out", type=Path, default=Path("data/curated"))
    parser.add_argument("--peak-discharge", type=float, default=1015.0)
    args = parser.parse_args()

    rng = random.Random(SEED)
    cfg = load_aoi(args.aoi)
    terrain_dir = Path("public/terrain") / cfg["id"]
    terrain_meta = json.loads((terrain_dir / f"{terrain_name(cfg)}.json").read_text(encoding="utf-8"))
    flow = json.loads((terrain_dir / "flowfield_16m.json").read_text(encoding="utf-8"))
    buildings = load_osm_cache(raw_dir("osm", cfg["id"]) / "buildings.json", cfg["id"])["buildings"]

    elevation = load_grid(terrain_dir, terrain_meta)
    cell = terrain_meta["resolutionM"]
    origin_e = terrain_meta["origin"]["easting"]
    top_n = terrain_meta["origin"]["northing"] + terrain_meta["height"] * cell

    flow_res = flow["resolutionM"]
    chain_grid = np.fromfile(terrain_dir / f"flowfield_{flow_res}m.u16", dtype="<u2").reshape(
        flow["height"], flow["width"]
    )
    bed = np.asarray(flow["bedProfileM"], dtype=np.float64)
    rating_q = np.asarray(flow["ratingDischargeM3s"], dtype=np.float64)
    rating_stage = np.asarray(flow["ratingStageM"], dtype=np.float64)
    n_chain = len(bed)
    not_connected = flow["notConnected"]

    print(f"{len(buildings)} buildings, {n_chain} chainage points")

    records = []
    for b in buildings:
        e, n = wgs84_to_utm32(b["lon"], b["lat"])
        col = int(np.clip((e - origin_e) / cell, 0, terrain_meta["width"] - 1))
        row = int(np.clip((top_n - n) / cell, 0, terrain_meta["height"] - 1))
        ground = float(elevation[row, col])

        fcol = int(np.clip(col * cell / flow_res, 0, flow["width"] - 1))
        frow = int(np.clip(row * cell / flow_res, 0, flow["height"] - 1))
        chain_index = int(chain_grid[frow, fcol])

        if chain_index == not_connected:
            # Not hydraulically connected to the river: no riverine flood reaches it at any
            # discharge, so it is the rarest class by definition.
            records.append(
                {
                    **b,
                    "groundElevM": round(ground, 2),
                    "chainageIndex": None,
                    "riverKm": None,
                    "floodDischargeM3s": None,
                    "returnPeriodYears": None,
                    "hazardClass": "GK1",
                    "hazardBasis": "nicht an das Gewässer angebunden",
                }
            )
            continue

        chain_index = min(chain_index, n_chain - 1)
        fraction = chain_index / max(n_chain - 1, 1)
        gain = 1 + 0.25 * fraction
        stages = rating_stage[chain_index]
        required_stage = ground - bed[chain_index]

        if required_stage <= 0:
            local_q = rating_q[0]
        elif required_stage >= stages[-1]:
            local_q = float("inf")
        else:
            local_q = float(np.interp(required_stage, stages, rating_q))

        if math.isinf(local_q):
            period = float("inf")
            gk, basis = "GK1", "seltener als HQ200"
            gauge_q = None
        else:
            gauge_q = local_q / gain  # back to the Altenahr reference the frequency curve uses
            period = return_period_for(gauge_q)
            gk, basis = hazard_class(period)

        records.append(
            {
                **b,
                "groundElevM": round(ground, 2),
                "chainageIndex": chain_index,
                "riverKm": round(chain_index * flow["chainageStepM"] / 1000, 3),
                "floodDischargeM3s": None if gauge_q is None else round(gauge_q, 1),
                "returnPeriodYears": None if math.isinf(period) else round(period, 1),
                "hazardClass": gk,
                "hazardBasis": basis,
            }
        )

    counts: dict[str, int] = {}
    for r in records:
        counts[r["hazardClass"]] = counts.get(r["hazardClass"], 0) + 1
    print(f"hazard classes: {dict(sorted(counts.items()))}")

    # ---- 2021 peak inundation + damage ------------------------------------------------------
    local_peak = args.peak_discharge * (
        1 + 0.25 * np.arange(n_chain) / max(n_chain - 1, 1)
    )
    peak_stage = np.array(
        [np.interp(local_peak[i], rating_q, rating_stage[i]) for i in range(n_chain)]
    )
    peak_wse = bed + peak_stage

    flooded = 0
    for r in records:
        idx = r["chainageIndex"]
        if idx is None:
            r["depthM"] = 0.0
        else:
            r["depthM"] = round(max(0.0, float(peak_wse[idx]) - r["groundElevM"]), 2)
        r["inundationClass"] = inundation_class(r["depthM"])
        r["damageRatio"] = round(float(np.interp(r["depthM"], JRC_DEPTH_M, JRC_RATIO)), 4)
        if r["depthM"] > 0:
            flooded += 1
    print(f"flooded at the 2021 peak: {flooded} of {len(records)} ({flooded/len(records)*100:.1f}%)")

    # ---- synthetic portfolio ----------------------------------------------------------------
    # Elementarschaden penetration in Rheinland-Pfalz was about 37 % at the time. Cover is
    # correlated with hazard class — people in visibly exposed places buy it more often — but the
    # uncovered GK1/GK2 tail has to stay large, because that gap is the whole point of Act IV.
    #
    # The relative ordering across classes is the assumption; the overall share is a calibration
    # target (PLAN §12 Phase 2 gate). So the class probabilities are scaled by a factor derived
    # from the actual class mix rather than hand-tuned until the printout looked right.
    RELATIVE_BY_CLASS = {"GK1": 0.31, "GK2": 0.38, "GK3": 0.52, "GK4": 0.66}
    TARGET_SHARE = 0.37

    weighted = sum(RELATIVE_BY_CLASS[r["hazardClass"]] for r in records) / len(records)
    calibration = TARGET_SHARE / weighted
    elementar_by_class = {
        cls: min(1.0, p * calibration) for cls, p in RELATIVE_BY_CLASS.items()
    }
    print(
        f"Elementar calibration factor {calibration:.3f} -> "
        + ", ".join(f"{c} {p:.2f}" for c, p in elementar_by_class.items())
    )

    # Regional rebuild cost per m² of gross floor area, in EUR. Deliberately round: this is a
    # synthetic book, and false precision would be precision theatre (§2.3).
    COST_PER_M2 = 1900

    policies = []
    claims = []
    for r in records:
        levels = r["levels"] or (2 if r["footprintM2"] > 60 else 1)
        floor_area = r["footprintM2"] * levels
        sum_insured = round(floor_area * COST_PER_M2 * rng.uniform(0.85, 1.15), -2)

        has_elementar = rng.random() < elementar_by_class[r["hazardClass"]]
        deductible = rng.choice([500, 1000, 2500])
        waiting_period_open = has_elementar and rng.random() < 0.03

        policies.append(
            {
                "policyId": f"MS-{abs(hash(r['buildingId'])) % 10**8:08d}",
                "buildingId": r["buildingId"],
                "insurer": MUSTERSCHUTZ,
                "sumInsuredEur": sum_insured,
                "elementarCover": has_elementar,
                "waitingPeriodOpen": waiting_period_open,
                "deductibleEur": deductible,
                "village": r["village"],
                "hazardClass": r["hazardClass"],
                "synthetic": True,
            }
        )

        if r["depthM"] > 0:
            loss = round(sum_insured * r["damageRatio"], 2)
            if not has_elementar:
                covered, reason = 0.0, "kein Elementarbaustein"
            elif waiting_period_open:
                covered, reason = 0.0, "Wartezeit"
            else:
                covered, reason = max(0.0, loss - deductible), "gedeckt"
            claims.append(
                {
                    "claimId": f"CL-{abs(hash(r['buildingId'])) % 10**8:08d}",
                    "policyId": policies[-1]["policyId"],
                    "buildingId": r["buildingId"],
                    "village": r["village"],
                    "hazardClass": r["hazardClass"],
                    "depthM": r["depthM"],
                    "estimatedLossEur": loss,
                    "coveredEur": round(covered, 2),
                    "uncoveredEur": round(loss - covered, 2),
                    "coverageReason": reason,
                    "synthetic": True,
                }
            )

    share = sum(1 for p in policies if p["elementarCover"]) / len(policies)
    print(f"Elementar penetration: {share * 100:.1f}% (target ~37%)")

    total_loss = sum(c["estimatedLossEur"] for c in claims)
    total_covered = sum(c["coveredEur"] for c in claims)
    print(f"estimated loss: {total_loss / 1e6:.1f} M EUR")
    print(f"covered:        {total_covered / 1e6:.1f} M EUR ({total_covered / total_loss * 100:.1f}%)")
    print(f"uncovered gap:  {(total_loss - total_covered) / 1e6:.1f} M EUR")

    args.out.mkdir(parents=True, exist_ok=True)

    def write_csv(name: str, rows: list[dict]) -> None:
        path = args.out / name
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(rows)
        print(f"  wrote {path} ({len(rows)} rows)")

    print()
    write_csv("geo_building.csv", records)
    write_csv("portfolio_policy.csv", policies)
    write_csv("claims_claim.csv", claims)

    summary = {
        "aoi": cfg["id"],
        "seed": SEED,
        "insurer": MUSTERSCHUTZ,
        "buildings": len(records),
        "hazardClasses": counts,
        "floodedAtPeak": flooded,
        "elementarSharePct": round(share * 100, 1),
        "estimatedLossEur": round(total_loss, 2),
        "coveredEur": round(total_covered, 2),
        "uncoveredEur": round(total_loss - total_covered, 2),
        "peakDischargeM3s": args.peak_discharge,
        "notes": [
            "Gefährdungsklasse ist eine eigene Ableitung aus öffentlichen Daten (LfU-Jährlichkeiten "
            "und DGM1). Methodisch an die ZÜRS-Klassen angelehnt, aber NICHT ZÜRS. "
            "ZÜRS® ist ein Produkt des GDV.",
            "Die GK1/GK2-Grenze bei HQ200 ist aus HQ50 und HQ100 logarithmisch extrapoliert.",
            "Gebäudegeometrie real (OpenStreetMap, ODbL); alle Versicherungsdaten synthetisch.",
        ],
    }
    (args.out / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"  wrote {args.out / 'summary.json'}")


if __name__ == "__main__":
    main()
