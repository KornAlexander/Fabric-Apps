"""Phase 5 — create the Direct Lake semantic model over the Lakehouse.

PLAN §10.1. Two conventions are followed deliberately:

* **German Title Case table names with spaces** (`Gebäude`, `Police`, `Schaden`) per the Tabular
  style guide — the model is what a business user sees, not a database.
* **Every measure lives on a dedicated `Measure` table.** That keeps the field list navigable and
  is the house convention.

⚠️ Direct Lake partition gotcha (learned the hard way, /memories/fabric_rest_api.md): this lakehouse
is NOT schema-enabled, so tables sit at `Tables/{name}` and the partition must OMIT `schemaName`.
Writing `schemaName: dbo` points at a non-existent `Tables/dbo/{name}` and every table silently
fails to frame.

Usage
  python tools/fabric/create_semantic_model.py
"""

from __future__ import annotations

import argparse
import base64
import json
import time
import uuid
from pathlib import Path

from setup_lakehouse import FABRIC_API, request, token_for

MODEL_NAME = "Flut-Insights — Portfolio & Schaden"


def tag() -> str:
    return str(uuid.uuid4())


def column(name: str, source: str, dtype: str, fmt: str | None = None, hidden: bool = False) -> str:
    lines = [
        f"\tcolumn '{name}'",
        f"\t\tdataType: {dtype}",
        f"\t\tsourceColumn: {source}",
        f"\t\tlineageTag: {tag()}",
        "\t\tsummarizeBy: none",
    ]
    if fmt:
        lines.append(f'\t\tformatString: {fmt}')
    if hidden:
        lines.append("\t\tisHidden")
    lines.append("")
    return "\n".join(lines)


def table_tmdl(display: str, entity: str, columns: str) -> str:
    return f"""table '{display}'
\tlineageTag: {tag()}

{columns}
\tpartition '{display}' = entity
\t\tmode: directLake
\t\tsource
\t\t\tentityName: {entity}
\t\t\texpressionSource: DatabaseQuery

\tannotation PBI_ResultType = Table

"""


def build_definition(sql_endpoint: str, database_id: str) -> dict[str, str]:
    """Return {path: text} for every part of the semantic model definition."""

    gebaeude = table_tmdl(
        "Gebäude",
        "geo_building",
        "".join(
            [
                column("Gebäude ID", "buildingId", "string"),
                column("Ort", "village", "string"),
                column("Straße", "street", "string"),
                column("Gebäudetyp", "buildingType", "string"),
                column("Grundfläche m²", "footprintM2", "double", '"#,0"'),
                column("Geländehöhe m", "groundElevM", "double", '"#,0.00"'),
                column("Fluss-km", "riverKm", "double", '"#,0.0"'),
                column("Gefährdungsklasse", "hazardClass", "string"),
                column("Wiederkehrintervall Jahre", "returnPeriodYears", "double", '"#,0"'),
                column("Wassertiefe m", "depthM", "double", '"#,0.00"'),
                column("Überflutungsklasse", "inundationClass", "string"),
                column("Schadensgrad", "damageRatio", "double", '"0.0%"'),
            ]
        ),
    )

    police = table_tmdl(
        "Police",
        "portfolio_policy",
        "".join(
            [
                column("Policen ID", "policyId", "string"),
                column("Gebäude ID", "buildingId", "string", hidden=True),
                column("Versicherer", "insurer", "string"),
                column("Versicherungssumme", "sumInsuredEur", "double", '"#,0 €"'),
                column("Elementarbaustein", "elementarCover", "boolean"),
                column("Wartezeit offen", "waitingPeriodOpen", "boolean"),
                column("Selbstbeteiligung", "deductibleEur", "double", '"#,0 €"'),
                column("Ort", "village", "string"),
                column("Gefährdungsklasse", "hazardClass", "string"),
            ]
        ),
    )

    schaden = table_tmdl(
        "Schaden",
        "claims_claim",
        "".join(
            [
                column("Schaden ID", "claimId", "string"),
                column("Policen ID", "policyId", "string", hidden=True),
                column("Gebäude ID", "buildingId", "string", hidden=True),
                column("Ort", "village", "string"),
                column("Gefährdungsklasse", "hazardClass", "string"),
                column("Wassertiefe m", "depthM", "double", '"#,0.00"'),
                column("Schaden geschätzt", "estimatedLossEur", "double", '"#,0 €"'),
                column("Entschädigung", "coveredEur", "double", '"#,0 €"'),
                column("Nicht gedeckt", "uncoveredEur", "double", '"#,0 €"'),
                column("Deckungsgrund", "coverageReason", "string"),
            ]
        ),
    )

    # Measures need a host table that is not Direct Lake, so this is a one-row calculated table.
    measures = f"""table 'Measure'
\tlineageTag: {tag()}

\tcolumn 'Value'
\t\tdataType: int64
\t\tisHidden
\t\tlineageTag: {tag()}
\t\tsourceColumn: [Value]
\t\tsummarizeBy: none

\tmeasure 'Gebäude #' = COUNTROWS('Gebäude')
\t\tformatString: #,0
\t\tlineageTag: {tag()}

\tmeasure 'Gebäude überflutet #' = CALCULATE(COUNTROWS('Gebäude'), 'Gebäude'[Wassertiefe m] > 0)
\t\tformatString: #,0
\t\tlineageTag: {tag()}

\tmeasure 'Ø Wassertiefe (m)' = CALCULATE(AVERAGE('Gebäude'[Wassertiefe m]), 'Gebäude'[Wassertiefe m] > 0)
\t\tformatString: #,0.00
\t\tlineageTag: {tag()}

\tmeasure 'Versicherungssumme Σ' = SUM('Police'[Versicherungssumme])
\t\tformatString: #,0 €
\t\tlineageTag: {tag()}

\tmeasure 'Elementar-Quote %' = DIVIDE(CALCULATE(COUNTROWS('Police'), 'Police'[Elementarbaustein] = TRUE()), COUNTROWS('Police'))
\t\tformatString: 0.0%
\t\tlineageTag: {tag()}

\tmeasure 'Schaden geschätzt Σ' = SUM('Schaden'[Schaden geschätzt])
\t\tformatString: #,0 €
\t\tlineageTag: {tag()}

\tmeasure 'Entschädigung Σ' = SUM('Schaden'[Entschädigung])
\t\tformatString: #,0 €
\t\tlineageTag: {tag()}

\tmeasure 'Nicht gedeckt Σ' = SUM('Schaden'[Nicht gedeckt])
\t\tformatString: #,0 €
\t\tlineageTag: {tag()}

\tmeasure 'Deckungsquote %' = DIVIDE([Entschädigung Σ], [Schaden geschätzt Σ])
\t\tformatString: 0.0%
\t\tlineageTag: {tag()}

\tmeasure 'Schaden je Gebäude' = DIVIDE([Schaden geschätzt Σ], [Gebäude überflutet #])
\t\tformatString: #,0 €
\t\tlineageTag: {tag()}

\tpartition 'Measure' = calculated
\t\tmode: import
\t\tsource = {{0}}

\tannotation PBI_Id = Measure

"""

    expressions = f"""expression 'DatabaseQuery' =
\t\tlet
\t\t\tdatabase = Sql.Database("{sql_endpoint}", "{database_id}")
\t\tin
\t\t\tdatabase
\tlineageTag: {tag()}
\tannotation PBI_IncludeFutureArtifacts = False

"""

    relationships = f"""relationship {tag()}
\tfromColumn: Police.'Gebäude ID'
\ttoColumn: Gebäude.'Gebäude ID'

relationship {tag()}
\tfromColumn: Schaden.'Policen ID'
\ttoColumn: Police.'Policen ID'

"""

    model = """model Model
\tculture: de-DE
\tdefaultPowerBIDataSourceVersion: powerBI_V3
\tsourceQueryCulture: de-DE
\tdataAccessOptions
\t\tlegacyRedirects
\t\treturnErrorValuesAsNull

ref table 'Gebäude'
ref table 'Police'
ref table 'Schaden'
ref table 'Measure'
ref expression 'DatabaseQuery'
"""

    database = """database
\tcompatibilityLevel: 1604
"""

    platform = json.dumps(
        {
            "$schema": "https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json",
            "metadata": {"type": "SemanticModel", "displayName": MODEL_NAME},
            "config": {"version": "2.0", "logicalId": str(uuid.uuid4())},
        },
        indent=2,
    )

    pbism = json.dumps({"version": "4.0", "settings": {}}, indent=2)

    return {
        ".platform": platform,
        "definition.pbism": pbism,
        "definition/database.tmdl": database,
        "definition/model.tmdl": model,
        "definition/expressions.tmdl": expressions,
        "definition/relationships.tmdl": relationships,
        "definition/tables/Gebäude.tmdl": gebaeude,
        "definition/tables/Police.tmdl": police,
        "definition/tables/Schaden.tmdl": schaden,
        "definition/tables/Measure.tmdl": measures,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ids", type=Path, default=Path(__file__).parent / ".fabric-ids.json")
    parser.add_argument("--name", default=MODEL_NAME)
    parser.add_argument("--save", type=Path, default=None, help="also write the TMDL locally")
    args = parser.parse_args()

    ids = json.loads(args.ids.read_text(encoding="utf-8"))
    token = token_for(FABRIC_API)

    status, lakehouse, _ = request(
        "GET",
        f"{FABRIC_API}/v1/workspaces/{ids['workspaceId']}/lakehouses/{ids['lakehouseId']}",
        token,
    )
    if status != 200:
        raise SystemExit(f"cannot read lakehouse: {status} {lakehouse}")
    sql = lakehouse["properties"]["sqlEndpointProperties"]
    print(f"SQL endpoint {sql['connectionString']}")

    parts_text = build_definition(sql["connectionString"], sql["id"])
    if args.save:
        for path, text in parts_text.items():
            target = args.save / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text, encoding="utf-8")
        print(f"wrote TMDL to {args.save}")

    parts = [
        {
            "path": path,
            "payload": base64.b64encode(text.encode("utf-8")).decode("ascii"),
            "payloadType": "InlineBase64",
        }
        for path, text in parts_text.items()
    ]

    existing = None
    s, items, _ = request("GET", f"{FABRIC_API}/v1/workspaces/{ids['workspaceId']}/items", token)
    if s == 200:
        for item in items.get("value", []):
            if item.get("displayName") == args.name and item.get("type") == "SemanticModel":
                existing = item["id"]

    if existing:
        print(f"updating existing model {existing}")
        url = f"{FABRIC_API}/v1/workspaces/{ids['workspaceId']}/semanticModels/{existing}/updateDefinition"
        body = {"definition": {"parts": parts}}
    else:
        print("creating semantic model")
        url = f"{FABRIC_API}/v1/workspaces/{ids['workspaceId']}/semanticModels"
        body = {"displayName": args.name, "definition": {"parts": parts}}

    status, payload, headers = request("POST", url, token, body)
    if status == 202:
        location = headers.get("Location")
        for _ in range(80):
            time.sleep(3)
            s, p, _ = request("GET", location, token)
            state = p.get("status") if isinstance(p, dict) else None
            if state == "Succeeded":
                print("succeeded")
                break
            if state == "Failed":
                raise SystemExit(f"failed: {json.dumps(p)[:1500]}")
        else:
            raise SystemExit("timed out")
    elif status not in (200, 201):
        raise SystemExit(f"{status}: {json.dumps(payload)[:2000]}")
    else:
        print("succeeded")

    s, items, _ = request("GET", f"{FABRIC_API}/v1/workspaces/{ids['workspaceId']}/items", token)
    for item in items.get("value", []):
        if item.get("displayName") == args.name:
            ids["semanticModelId"] = item["id"]
            args.ids.write_text(json.dumps(ids, indent=2), encoding="utf-8")
            print(f"model id {item['id']}")
            print(
                "portal: https://app.fabric.microsoft.com/groups/"
                f"{ids['workspaceId']}/datasets/{item['id']}"
            )


if __name__ == "__main__":
    main()
