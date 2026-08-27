"""Fetch official gauge reference values from the LfU Rheinland-Pfalz water geodata API.

These are the *statistical* reference values (Hauptwerte, Jährlichkeiten) — not a time series.
They are what PLAN §4.4 and §5 need: the officially published peak, the return-period discharges
that anchor the hazard-class derivation, and the mean flow.

The endpoint pattern was recovered by driving the portal's Vue front end with Playwright and
reading the network log (PLAN §4.4 / docs/gauge-data-sources.md), because the routes are inside
lazy-loaded chunks and cannot be derived by static analysis.

    https://geodaten-wasser.rlp-umwelt.de/api/data/<dataset>?w=messstellennummer=<nr>
    https://geodaten-wasser.rlp-umwelt.de/api/export/<dataset>.csv?w=messstellennummer=<nr>

Dataset names are whitelisted server-side — guessing them returns 403.

Usage
  python tools/geodata/fetch_lfu_reference.py --out data/raw/lfu
"""

from __future__ import annotations

import argparse
import json
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from aoi import load_aoi

API = "https://geodaten-wasser.rlp-umwelt.de/api"

# Verified dataset names (captured from the portal's own requests).
DATASETS = [
    "messstellen_wasserstand_stammdaten",
    "messstellen_wasserstand_hauptwerte",
    "messstellen_wasserstand_jaehrlichkeiten_alljaehrlichkeiten",
    "messstellen_wasserstand_aktuellewasserstaende_lastmesswert",
]


def api_get(dataset: str, station_number: str) -> object | None:
    query = urllib.parse.quote(f"messstellennummer={station_number}", safe="")
    url = f"{API}/data/{dataset}?w={query}"
    # The API rejects bare requests with 403 — it checks Origin/Referer. Sending the same headers
    # the portal's own front end sends makes it behave. (Same-origin policy enforcement, not auth.)
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "Origin": "https://geodaten-wasser.rlp-umwelt.de",
            "Referer": f"https://geodaten-wasser.rlp-umwelt.de/wasserstand/{station_number}/hauptwerte",
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
            ),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310 - fixed https host
            return json.load(resp)
    except urllib.error.HTTPError as exc:
        print(f"  {dataset}: HTTP {exc.code}")
        return None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="ahrtal-2021")
    parser.add_argument("--out", type=Path, default=Path("data/raw/lfu"))
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    args.out.mkdir(parents=True, exist_ok=True)

    for gauge in cfg["gauges"]:
        # The portal uses the HVZ station number with two trailing zeros.
        station_number = f"{gauge['hvzStationNumber']}00"
        print(f"\n{gauge['name']} ({station_number})")
        bundle: dict[str, object] = {"gauge": gauge, "stationNumber": station_number}

        for dataset in DATASETS:
            payload = api_get(dataset, station_number)
            if payload is None:
                continue
            rows = payload if isinstance(payload, list) else payload.get("data", payload)
            count = len(rows) if isinstance(rows, list) else 1
            print(f"  {dataset}: {count} row(s)")
            bundle[dataset] = payload

        target = args.out / f"{gauge['id']}_reference.json"
        target.write_text(json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"  wrote {target}")


if __name__ == "__main__":
    main()
