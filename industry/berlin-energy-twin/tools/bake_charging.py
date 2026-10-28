"""Bake Berlin's public charging infrastructure from the Geoportal (PLAN §3, Phase 1).

Source: WFS `eladesaeulen` (Senatsverwaltung, BNetzA register matched with the
Land's own public-space data), DL-DE-Zero 2.0. Static: there is NO live status
for Berlin in any open feed (MobiData BW only re-serves the BNetzA register
here), so nothing in this file may ever be read as availability.

Writes public/data/charging.json:
  stations   one row per location: position, operator, BSW flag, points, max kW, AC/DC, year,
             public space or private ground
  districts  per Bezirk: all charge points incl. private (Land figure), kWh of public charging
             per year 2012-2024 (gaps where the Land published none)

Usage: python tools/bake_charging.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bake_common import DL_DE_ZERO, in_berlin, utm_to_lonlat, wfs_features, write  # noqa: E402

SERVICE = "eladesaeulen"
#: Both Berliner Stadtwerke companies that operate charge points (KommunalPartner runs the
#: Land's public-space network, EnergiePartner a few sites on private ground).
BSW_OPERATORS = {"Berliner Stadtwerke KommunalPartner GmbH", "Berliner Stadtwerke EnergiePartner GmbH"}


def is_bsw(operator: str | None) -> bool:
    """Exact names only: 'Stadtwerke' alone would also match other cities' utilities."""
    return (operator or "").strip() in BSW_OPERATORS


def kw(value: str | None) -> float | None:
    """'3,7' -> 3.7; None or junk -> None."""
    if value is None:
        return None
    m = re.fullmatch(r"\s*(\d+(?:[.,]\d+)?)\s*", str(value))
    return float(m.group(1).replace(",", ".")) if m else None


def station(f: dict, idx: int) -> dict:
    p = f["properties"]
    coords = f["geometry"]["coordinates"]
    e, n = coords[0] if f["geometry"]["type"] == "MultiPoint" else coords
    lon, lat = utm_to_lonlat(e, n)
    if not in_berlin(lon, lat):
        raise RuntimeError(f"station {p.get('adresse')} at {lon},{lat} is outside Berlin: CRS mix-up?")
    powers = [x for x in (kw(p.get(f"ladeleistung_{i}")) for i in range(1, 5)) if x is not None]
    return {
        "id": f"cs{idx}",
        "lon": lon,
        "lat": lat,
        "op": (p.get("betreiber") or "").strip(),
        "bsw": is_bsw(p.get("betreiber")),
        "addr": (p.get("adresse") or "").strip(),
        "plz": p.get("plz"),
        "bez": p.get("bezirk"),
        "points": int(p.get("anzahl_ladepunkte") or 0),
        "kw": max(powers) if powers else None,
        "dc": p.get("art_ladeeinrichtung") == "DC",
        "year": p.get("jahr_inbetriebnahme"),
        "public": p.get("oeffentlicher_raum") == "ja",
    }


def districts(points_rows: list[dict], kwh_rows: list[dict]) -> list[dict]:
    kwh = {r["properties"]["bezirk"]: r["properties"] for r in kwh_rows}
    out = []
    for r in points_rows:
        p = r["properties"]
        k = kwh.get(p["bezirk"], {})
        years = {int(m.group(1)): v for key, v in k.items() if (m := re.fullmatch(r"j(\d{4})m", key)) and v is not None}
        out.append({
            "bez": p["bezirk"],
            "allPoints": p["gesanzahlbezirk"],
            "allPointsKw": p["gesleistung"],
            "pointsAsOf": p["datum"],
            "publicKwhByYear": {str(y): round(v * 1000) for y, v in sorted(years.items())},
        })
    return sorted(out, key=lambda d: d["bez"])


def main() -> None:
    feats = wfs_features(SERVICE, "lades_standorte")
    stations = [station(f, i) for i, f in enumerate(feats)]
    dist = districts(wfs_features(SERVICE, "ladepkt_bez"), wfs_features(SERVICE, "lades_stromverbr_bez"))
    bsw = [s for s in stations if s["bsw"]]
    print(f"{len(stations)} stations, {sum(s['points'] for s in stations)} points; "
          f"BSW {len(bsw)} stations, {sum(s['points'] for s in bsw)} points; {len(dist)} districts")
    write(
        "charging.json",
        {"stations": stations, "districts": dist},
        source="Geoportal Berlin, WFS eladesaeulen (lades_standorte, ladepkt_bez, lades_stromverbr_bez)",
        licence=DL_DE_ZERO,
        attribution="Geoportal Berlin / Elektro-Ladesäulen und Ladepunkte",
        notes="Register data, no live status. districts.allPoints includes private charge points (Land figure).",
    )


if __name__ == "__main__":
    main()
