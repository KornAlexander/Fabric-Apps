"""Phase 6 — Real-Time Intelligence: Eventhouse, gauge ingestion and the rate-of-rise rule.

PLAN §10.3 and Act IV lesson 1. The lesson is that the warning existed and did not arrive in time,
so the capability that answers it has to be the one that would have carried it: a live gauge feed
with a rule that fires on the *rate* of rise, not on an absolute level.

That distinction is the whole point. An absolute threshold is useless in a flash-flood catchment —
by the time the Ahr passed any fixed mark, the time to act had gone. A rate-of-rise rule fires
while the number still looks survivable.

The feed is real: the LfU Rheinland-Pfalz HVZ publishes Ahr gauge readings at 15-minute resolution
on an open, unauthenticated API (docs/gauge-data-sources.md).

Usage
  python tools/fabric/setup_rti.py --dry-run
  python tools/fabric/setup_rti.py
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from setup_lakehouse import FABRIC_API, request, token_for

EVENTHOUSE_NAME = "FlutInsightsEventhouse"
KQL_DATABASE_NAME = "FlutInsightsEventhouse"

# The rule that answers lesson 1. Written so it can be lifted into an Activator alert unchanged.
RATE_OF_RISE_KQL = """
// Flut-Insights — Vorwarnung über Anstiegsgeschwindigkeit (PLAN §10.3, Act IV Lektion 1)
//
// Eine feste Pegelmarke hilft in einem Einzugsgebiet wie der Ahr nicht: bis ein absoluter
// Schwellenwert erreicht ist, ist die Zeit zum Handeln vorbei. Diese Regel reagiert auf die
// Geschwindigkeit des Anstiegs — sie schlägt an, während der Wert noch harmlos aussieht.
PegelMessung
| where Zeitpunkt > ago(6h)
| order by Messstelle asc, Zeitpunkt asc
| extend VorherWert = prev(WasserstandCm), VorherZeit = prev(Zeitpunkt), VorherStelle = prev(Messstelle)
| where Messstelle == VorherStelle
| extend MinutenDelta = datetime_diff('minute', Zeitpunkt, VorherZeit)
| where MinutenDelta > 0
| extend AnstiegCmProStunde = (WasserstandCm - VorherWert) * 60.0 / MinutenDelta
| summarize
    AktuellerStandCm = arg_max(Zeitpunkt, WasserstandCm),
    MaxAnstiegCmProStunde = max(AnstiegCmProStunde)
    by Messstelle
| extend Warnstufe = case(
    MaxAnstiegCmProStunde >= 30, "Warnung: Anstieg über 30 cm/h",
    MaxAnstiegCmProStunde >= 15, "Beobachten: Anstieg über 15 cm/h",
    "unauffällig")
"""

TABLE_KQL = """
.create-merge table PegelMessung (
    Messstelle: string,
    Messstellennummer: string,
    Zeitpunkt: datetime,
    WasserstandCm: real,
    Quelle: string
)

.create-or-alter table PegelMessung ingestion json mapping 'PegelMessungMapping'
'['
'  {"column":"Messstelle","path":"$.messstelle","datatype":"string"},'
'  {"column":"Messstellennummer","path":"$.messstellennummer","datatype":"string"},'
'  {"column":"Zeitpunkt","path":"$.zeitpunkt","datatype":"datetime"},'
'  {"column":"WasserstandCm","path":"$.wasserstandCm","datatype":"real"},'
'  {"column":"Quelle","path":"$.quelle","datatype":"string"}'
']'

// Rollierende Kennzahlen für das Live-Panel.
.create-or-alter function PegelAnstieg() {
    PegelMessung
    | order by Messstelle asc, Zeitpunkt asc
    | extend VorherWert = prev(WasserstandCm), VorherZeit = prev(Zeitpunkt), VorherStelle = prev(Messstelle)
    | where Messstelle == VorherStelle
    | extend MinutenDelta = datetime_diff('minute', Zeitpunkt, VorherZeit)
    | where MinutenDelta > 0
    | extend AnstiegCmProStunde = (WasserstandCm - VorherWert) * 60.0 / MinutenDelta
}
"""


def create_eventhouse(token: str, workspace_id: str, name: str) -> str:
    status, payload, headers = request(
        "POST",
        f"{FABRIC_API}/v1/workspaces/{workspace_id}/eventhouses",
        token,
        {
            "displayName": name,
            "description": "Flut-Insights — Pegel-Livedaten der HVZ Rheinland-Pfalz (Demo)",
        },
    )
    if status in (200, 201):
        return payload["id"]
    if status == 202:
        location = headers.get("Location")
        for _ in range(80):
            time.sleep(3)
            s, p, _ = request("GET", location, token)
            if s == 200 and p.get("status") in (None, "Succeeded"):
                return p.get("id") or p.get("resourceId", "")
            if isinstance(p, dict) and p.get("status") == "Failed":
                raise SystemExit(f"eventhouse creation failed: {p}")
        raise SystemExit("eventhouse creation timed out")
    raise SystemExit(f"eventhouse creation failed: {status} {payload}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ids", type=Path, default=Path(__file__).parent / ".fabric-ids.json")
    parser.add_argument("--name", default=EVENTHOUSE_NAME)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    ids = json.loads(args.ids.read_text(encoding="utf-8"))
    token = token_for(FABRIC_API)
    workspace_id = ids["workspaceId"]

    status, items, _ = request("GET", f"{FABRIC_API}/v1/workspaces/{workspace_id}/items", token)
    existing = next(
        (
            i
            for i in items.get("value", [])
            if i.get("displayName") == args.name and i.get("type") == "Eventhouse"
        ),
        None,
    )

    if existing:
        eventhouse_id = existing["id"]
        print(f"eventhouse exists: {eventhouse_id}")
    elif args.dry_run:
        print(f"[dry run] would create eventhouse '{args.name}'")
        return
    else:
        eventhouse_id = create_eventhouse(token, workspace_id, args.name)
        print(f"created eventhouse {eventhouse_id}")

    # The KQL database is created alongside the eventhouse; find it and record its query URI.
    status, dbs, _ = request(
        "GET", f"{FABRIC_API}/v1/workspaces/{workspace_id}/kqlDatabases", token
    )
    kql = next(
        (d for d in dbs.get("value", []) if d.get("properties", {}).get("parentEventhouseItemId") == eventhouse_id),
        None,
    )
    if not kql:
        raise SystemExit("no KQL database found for the eventhouse")

    props = kql.get("properties", {})
    print(f"kql database {kql['id']}")
    print(f"  query uri   {props.get('queryServiceUri')}")
    print(f"  ingest uri  {props.get('ingestionServiceUri')}")

    ids.update(
        {
            "eventhouseId": eventhouse_id,
            "kqlDatabaseId": kql["id"],
            "kqlDatabaseName": kql.get("displayName"),
            "kqlQueryUri": props.get("queryServiceUri"),
            "kqlIngestUri": props.get("ingestionServiceUri"),
        }
    )
    args.ids.write_text(json.dumps(ids, indent=2), encoding="utf-8")

    # Ship the KQL alongside the repo so the rule is reviewable without opening the portal.
    kql_dir = Path("fabric/kql")
    kql_dir.mkdir(parents=True, exist_ok=True)
    (kql_dir / "01_schema.kql").write_text(TABLE_KQL, encoding="utf-8")
    (kql_dir / "02_rate_of_rise.kql").write_text(RATE_OF_RISE_KQL, encoding="utf-8")
    print(f"\nwrote KQL to {kql_dir}")
    print(
        f"portal: https://app.fabric.microsoft.com/groups/{workspace_id}/databases/{kql['id']}"
    )


if __name__ == "__main__":
    main()
