"""Phase 6 — create the KQL table and ingest live Ahr gauge readings.

Pulls the current 48-hour window from the LfU Rheinland-Pfalz HVZ open API and pushes it into the
Eventhouse, then runs the rate-of-rise rule against what landed.

This is the real feed, not a simulation: `https://www.hochwasser.rlp.de/api/v1/index` publishes
15-minute readings for every Rheinland-Pfalz gauge, unauthenticated.

Usage
  python tools/fabric/ingest_gauges.py
"""

from __future__ import annotations

import argparse
import json
import urllib.request
from pathlib import Path

from setup_lakehouse import request, token_for

KUSTO_RESOURCE = "https://kusto.kusto.windows.net"
HVZ_API = "https://www.hochwasser.rlp.de/api/v1"

CREATE_TABLE = """.create-merge table PegelMessung (
    Messstelle: string,
    Messstellennummer: string,
    Zeitpunkt: datetime,
    WasserstandCm: real,
    Quelle: string
)"""

RATE_OF_RISE = """
PegelMessung
| order by Messstelle asc, Zeitpunkt asc
| extend VorherWert = prev(WasserstandCm), VorherZeit = prev(Zeitpunkt), VorherStelle = prev(Messstelle)
| where Messstelle == VorherStelle
| extend MinutenDelta = datetime_diff('minute', Zeitpunkt, VorherZeit)
| where MinutenDelta > 0
| extend AnstiegCmProStunde = (WasserstandCm - VorherWert) * 60.0 / MinutenDelta
| summarize
    Messwerte = count(),
    LetzterStandCm = arg_max(Zeitpunkt, WasserstandCm),
    MaxAnstiegCmProStunde = round(max(AnstiegCmProStunde), 1)
    by Messstelle
"""


def kusto(uri: str, database: str, token: str, command: str, mgmt: bool = False) -> dict:
    endpoint = f"{uri}/v1/rest/{'mgmt' if mgmt else 'query'}"
    status, payload, _ = request(
        "POST", endpoint, token, {"db": database, "csl": command}
    )
    if status != 200:
        raise SystemExit(f"kusto {'mgmt' if mgmt else 'query'} failed: {status} {json.dumps(payload)[:1200]}")
    return payload


def fetch_readings(gauges: list[dict]) -> list[dict]:
    req = urllib.request.Request(
        f"{HVZ_API}/index",
        headers={"Accept": "application/json", "User-Agent": "Flut-Insights/0.1 (demo)"},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:  # noqa: S310 - fixed https host
        index = json.load(resp)

    sites = index.get("measurementSites", {})
    rows = []
    for gauge in gauges:
        number = gauge["hvzStationNumber"]
        series = sites.get(number)
        if not series:
            print(f"  ! no current readings for {gauge['name']} ({number})")
            continue
        for point in series.get("measurements", []):
            if point.get("y") is None:
                continue
            rows.append(
                {
                    "messstelle": gauge["name"],
                    "messstellennummer": number,
                    "zeitpunkt": point["x"],
                    "wasserstandCm": float(point["y"]),
                    "quelle": "HVZ Rheinland-Pfalz",
                }
            )
        print(f"  {gauge['name']}: {len(series.get('measurements', []))} readings")
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ids", type=Path, default=Path(__file__).parent / ".fabric-ids.json")
    parser.add_argument("--aoi", type=Path, default=Path("config/aoi/ahrtal-2021.json"))
    args = parser.parse_args()

    ids = json.loads(args.ids.read_text(encoding="utf-8"))
    aoi = json.loads(args.aoi.read_text(encoding="utf-8"))
    uri = ids["kqlQueryUri"]
    database = ids["kqlDatabaseName"]
    token = token_for(KUSTO_RESOURCE)

    print(f"database {database} at {uri}")
    kusto(uri, database, token, CREATE_TABLE, mgmt=True)
    print("  table PegelMessung ready")

    print("\nfetching live readings from the HVZ")
    rows = fetch_readings(aoi["gauges"])
    print(f"  {len(rows)} rows")

    # Inline ingestion keeps this to a single call and is well within size limits for a 48 h window
    # across three gauges. A production feed would come through an Eventstream instead.
    payload = "\n".join(json.dumps(r, ensure_ascii=False) for r in rows)
    command = (
        ".ingest inline into table PegelMessung with "
        "(format='multijson', ingestionMappingReference='PegelMessungMapping') <|\n" + payload
    )

    mapping = (
        ".create-or-alter table PegelMessung ingestion json mapping 'PegelMessungMapping' "
        '\'[{"column":"Messstelle","path":"$.messstelle","datatype":"string"},'
        '{"column":"Messstellennummer","path":"$.messstellennummer","datatype":"string"},'
        '{"column":"Zeitpunkt","path":"$.zeitpunkt","datatype":"datetime"},'
        '{"column":"WasserstandCm","path":"$.wasserstandCm","datatype":"real"},'
        '{"column":"Quelle","path":"$.quelle","datatype":"string"}]\''
    )
    kusto(uri, database, token, mapping, mgmt=True)
    kusto(uri, database, token, command, mgmt=True)
    print("  ingested")

    print("\nrate-of-rise rule against the live data:")
    result = kusto(uri, database, token, RATE_OF_RISE)
    tables = [t for t in result.get("Tables", []) if t.get("TableName") == "Table_0"] or result.get(
        "Tables", []
    )
    if tables:
        columns = [c["ColumnName"] for c in tables[0]["Columns"]]
        for row in tables[0]["Rows"]:
            print("  " + ", ".join(f"{c}={v}" for c, v in zip(columns, row)))


if __name__ == "__main__":
    main()
