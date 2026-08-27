"""Phase 5 gate — verify the semantic model's measures against the source data.

PLAN §12: "Measures return correct totals against the Spark job." This runs the measures through
the XMLA/REST query endpoint and compares them to the curated CSVs the model was built from. If
the Direct Lake partitions are misconfigured the totals come back empty or wrong, which is exactly
the failure mode that is otherwise silent until a visual breaks.

Usage
  python tools/fabric/verify_model.py
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

from setup_lakehouse import request, token_for

POWERBI_RESOURCE = "https://analysis.windows.net/powerbi/api"
POWERBI_API = "https://api.powerbi.com/v1.0/myorg"

DAX = """
EVALUATE
ROW(
    "Gebaeude", [Gebäude #],
    "Ueberflutet", [Gebäude überflutet #],
    "ElementarQuote", [Elementar-Quote %],
    "SchadenSumme", [Schaden geschätzt Σ],
    "EntschaedigungSumme", [Entschädigung Σ],
    "NichtGedeckt", [Nicht gedeckt Σ]
)
"""


def expected_from_csv(curated: Path) -> dict[str, float]:
    buildings = list(csv.DictReader((curated / "geo_building.csv").open(encoding="utf-8")))
    policies = list(csv.DictReader((curated / "portfolio_policy.csv").open(encoding="utf-8")))
    claims = list(csv.DictReader((curated / "claims_claim.csv").open(encoding="utf-8")))
    return {
        "Gebaeude": len(buildings),
        "Ueberflutet": sum(1 for b in buildings if float(b["depthM"]) > 0),
        "ElementarQuote": sum(1 for p in policies if p["elementarCover"] == "True") / len(policies),
        "SchadenSumme": sum(float(c["estimatedLossEur"]) for c in claims),
        "EntschaedigungSumme": sum(float(c["coveredEur"]) for c in claims),
        "NichtGedeckt": sum(float(c["uncoveredEur"]) for c in claims),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ids", type=Path, default=Path(__file__).parent / ".fabric-ids.json")
    parser.add_argument("--curated", type=Path, default=Path("data/curated"))
    args = parser.parse_args()

    ids = json.loads(args.ids.read_text(encoding="utf-8"))
    model_id = ids.get("semanticModelId")
    if not model_id:
        raise SystemExit("no semanticModelId — run create_semantic_model.py first")

    token = token_for(POWERBI_RESOURCE)
    # Dataset-scoped, not group-scoped: the group form returns 401 GroupNotAccessible unless you
    # are a workspace member (/memories/fabric_rest_api.md).
    status, payload, _ = request(
        "POST",
        f"{POWERBI_API}/datasets/{model_id}/executeQueries",
        token,
        {"queries": [{"query": DAX}], "serializerSettings": {"includeNulls": True}},
    )
    if status != 200:
        raise SystemExit(f"query failed: {status} {json.dumps(payload)[:1500]}")

    row = payload["results"][0]["tables"][0]["rows"][0]
    actual = {k.strip("[]"): v for k, v in row.items()}
    expected = expected_from_csv(args.curated)

    print(f"{'measure':<22}{'model':>18}{'source':>18}   ok")
    ok = True
    for key, want in expected.items():
        got = actual.get(key)
        if got is None:
            match = False
        elif isinstance(want, float) and want < 2:
            match = abs(got - want) < 0.001
        else:
            match = abs(got - want) < max(1.0, abs(want) * 1e-6)
        ok &= match
        print(f"{key:<22}{got!s:>18}{want:>18,.2f}   {'yes' if match else 'NO'}")

    print()
    if ok:
        print("Phase 5 gate met: every measure matches the source data.")
    else:
        raise SystemExit(
            "Phase 5 gate NOT met. Empty or wrong totals usually mean the Direct Lake partitions "
            "did not frame — check that the partition omits schemaName for a non-schema lakehouse."
        )


if __name__ == "__main__":
    main()
