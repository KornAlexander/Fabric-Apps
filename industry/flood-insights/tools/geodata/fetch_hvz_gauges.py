"""Fetch Ahr gauge data from the Hochwasservorhersagezentrale Rheinland-Pfalz open API.

Source: https://www.hochwasser.rlp.de/api/v1  (open, unauthenticated)
See docs/gauge-data-sources.md for how this endpoint was identified and what it does *not* cover.

IMPORTANT
  * This API holds a rolling ~48 h window only. It is the LIVE feed, not the July 2021 archive.
  * The licence for these payloads is NOT yet confirmed. Do not redistribute the output
    until the attribution is recorded in NOTICE.md.

Usage
  python tools/geodata/fetch_hvz_gauges.py --out data/raw/hvz
"""

from __future__ import annotations

import argparse
import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API_BASE = "https://www.hochwasser.rlp.de/api/v1"

# Station numbers confirmed 2026-07-27 from /config — see docs/gauge-data-sources.md
AHR_STATIONS = {
    "27180403": "Altenahr",
    "27180607": "Bad Bodendorf",
    "27180094": "Müsch 2",
}

AHR_ALERT_REGION_ID = "31"  # "Ahr-Einzugsgebiet"


def _get_json(path: str) -> dict:
    req = urllib.request.Request(
        f"{API_BASE}{path}",
        headers={"Accept": "application/json", "User-Agent": "Flut-Insights/0.1 (demo)"},
    )
    with urllib.request.urlopen(req, timeout=90) as resp:  # noqa: S310 - fixed https host
        return json.load(resp)


def fetch(out_dir: Path) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    config = _get_json("/config")
    index = _get_json("/index")

    sites_meta = config.get("measurementsite", {})
    readings = index.get("measurementSites", {})

    ahr = {}
    for number, name in AHR_STATIONS.items():
        meta = sites_meta.get(number)
        series = readings.get(number)
        if meta is None:
            print(f"  ! {name} ({number}): no master data in /config")
        if series is None:
            print(f"  ! {name} ({number}): no current readings in /index")
        ahr[number] = {"name": name, "meta": meta, "series": series}
        n = len(series.get("measurements", [])) if series else 0
        last = series.get("yLast") if series else None
        print(f"  {name:<15} {number}  points={n:<5} last={last}")

    payload = {
        "fetchedAt": stamp,
        "source": API_BASE,
        "alertRegion": index.get("alertregions", {}).get(AHR_ALERT_REGION_ID),
        "stations": ahr,
    }

    target = out_dir / f"hvz_ahr_{stamp}.json"
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nwrote {target} ({target.stat().st_size / 1024:.1f} KB)")
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("data/raw/hvz"),
        help="output directory (gitignored)",
    )
    args = parser.parse_args()
    fetch(args.out)


if __name__ == "__main__":
    main()
