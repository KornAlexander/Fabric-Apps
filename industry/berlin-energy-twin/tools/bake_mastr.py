"""Bake the generating units of Berliner Stadtwerke, degewo and BVG from the
Marktstammdatenregister (PLAN §3, §6 `pv_unit`, review S1/S3/S11).

Source: the public unit overview of the MaStR (BNetzA), DL-DE-BY 2.0. The JSON
route behind the web table is undocumented and slow (100-row pages, about
30 s each); every answer is cached under cache/mastr/ so a rerun only asks for
what is missing. If the route breaks, the official Gesamtdatenexport carries
the same fields.

Rules:
* ONE row per MaStR unit number. A unit that two queries return (a BSW-built
  plant now operated by a partner) stays one row; `queries` lists who found it.
  Every kWp figure in the app and the model sums this one list (review S1).
* LEGAL ENTITIES ONLY. A unit whose operator is a natural person is dropped
  before anything is written (privacy, README).
* Street addresses are public only above the publication threshold (about
  30 kW); below it the register shows the postcode only. `located` says whether
  the register itself gives coordinates; nothing is geocoded here (review S3).

Writes public/data/units.json.

Usage: python tools/bake_mastr.py [--refresh]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bake_common import CACHE, DL_DE_BY, get_json, in_berlin, write  # noqa: E402

URL = "https://www.marktstammdatenregister.de/MaStR/Einheit/EinheitJson/GetErweiterteOeffentlicheEinheitStromerzeugung"
PAGE = 100
#: MaStR "Personenart" of an organisation. Anything else is a natural person and never stored.
ORGANISATION = 517

#: Which operator names count as which partner. Matched with the register's own
#: "contains" filter, then checked again here against the returned name.
QUERIES: dict[str, str] = {
    "bsw": "Berliner Stadtwerke",
    "degewo": "degewo",
    "bvg": "Berliner Verkehrsbetriebe",
}


def ms_date(v: str | None) -> str | None:
    """'/Date(1548892800000)/' -> '2019-01-31'."""
    m = re.fullmatch(r"/Date\((-?\d+)\)/", v or "")
    if not m:
        return None
    return datetime.fromtimestamp(int(m.group(1)) / 1000, tz=timezone.utc).date().isoformat()


def fetch(partner: str, name: str, refresh: bool) -> list[dict]:
    cache = CACHE / "mastr" / f"{partner}.json"
    if cache.exists() and not refresh:
        rows = json.loads(cache.read_text(encoding="utf-8"))
        print(f"{partner}: {len(rows)} rows from cache")
        return rows
    flt = urllib.parse.quote(f"Name des Anlagenbetreibers (nur Org.)~ct~'{name}'")
    rows: list[dict] = []
    page = 1
    while True:
        d = get_json(f"{URL}?sort=&page={page}&pageSize={PAGE}&group=&filter={flt}", timeout=240)
        rows += d.get("Data") or []
        print(f"{partner}: page {page}, {len(rows)}/{d.get('Total')}")
        if len(rows) >= (d.get("Total") or 0) or not d.get("Data"):
            break
        page += 1
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    return rows


def unit(r: dict) -> dict:
    lat, lon = r.get("Breitengrad"), r.get("Laengengrad")
    located = lat is not None and lon is not None
    return {
        "id": r["MaStRNummer"],
        "name": (r.get("EinheitName") or "").strip(),
        "operator": (r.get("AnlagenbetreiberName") or "").strip(),
        "carrier": r.get("EnergietraegerName"),
        "kwGross": r.get("Bruttoleistung"),
        "kwNet": r.get("Nettonennleistung"),
        "kwhStorage": r.get("NutzbareSpeicherkapazitaet"),
        "status": r.get("BetriebsStatusName"),
        "commissioned": ms_date(r.get("InbetriebnahmeDatum")),
        "plz": r.get("Plz"),
        "city": r.get("Ort"),
        "street": (r.get("Strasse") or "").strip() or None,
        "no": (r.get("Hausnummer") or "").strip() or None,
        "lon": round(lon, 6) if located else None,
        "lat": round(lat, 6) if located else None,
        "located": located,
        "mieterstrom": bool(r.get("MieterstromAngemeldet")),
        "siteKind": r.get("ArtDerSolaranlageBezeichnung"),
        "feedIn": r.get("VollTeilEinspeisungBezeichnung"),
        "queries": [],
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="ignore the cache and ask the register again")
    args = ap.parse_args()

    units: dict[str, dict] = {}
    dropped_persons = 0
    for partner, name in QUERIES.items():
        for r in fetch(partner, name, args.refresh):
            if r.get("AnlagenbetreiberPersonenArt") != ORGANISATION:
                dropped_persons += 1
                continue
            if name.lower() not in (r.get("AnlagenbetreiberName") or "").lower():
                continue  # the register's "contains" is looser than ours
            u = units.setdefault(r["MaStRNummer"], unit(r))
            if partner not in u["queries"]:
                u["queries"].append(partner)

    rows = sorted(units.values(), key=lambda u: u["id"])
    for u in rows:
        if u["located"] and not in_berlin(u["lon"], u["lat"]) and u["city"] == "Berlin":
            raise RuntimeError(f"{u['id']} says Berlin but sits at {u['lon']},{u['lat']}")
    assert len({u["id"] for u in rows}) == len(rows), "duplicate MaStR numbers"
    for p in QUERIES:
        mine = [u for u in rows if p in u["queries"]]
        print(f"{p}: {len(mine)} units, {sum(u['kwGross'] or 0 for u in mine) / 1000:.2f} MW gross, "
              f"{sum(u['located'] for u in mine)} located, {sum(u['mieterstrom'] for u in mine)} Mieterstrom")
    print(f"dropped {dropped_persons} units of natural persons (never stored)")
    write(
        "units.json",
        {"units": rows},
        source="Marktstammdatenregister (BNetzA), public unit overview, operator filter per partner",
        licence=DL_DE_BY,
        attribution="Bundesnetzagentur, Marktstammdatenregister",
        notes="Legal entities only. One row per MaStR unit. Addresses public only above the publication "
              "threshold (about 30 kW); `located` = register gives coordinates. Probe of 2026-10-27: BSW 257 units.",
    )


if __name__ == "__main__":
    main()
