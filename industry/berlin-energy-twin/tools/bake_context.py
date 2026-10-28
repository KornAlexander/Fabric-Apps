"""Bake the context layers: districts with population, residents per estate, substations
(PLAN §3, §4.5, D5).

Sources:
* District outlines: Geoportal Berlin WFS `eladesaeulen:ladepkt_bez` (DL-DE-Zero), the
  same outlines the charging figures per district refer to.
* Population: Umweltatlas "Einwohnerdichte 2025" (`ua_einwohnerdichte_2025`), registered
  residents per block on 31.12.2025, CC BY 3.0 DE, source line
  "Amt für Statistik Berlin-Brandenburg / Einwohnerdichte 2025 (Umweltatlas)".
  Blocks are summed per district by the district number at the start of the block key,
  and per estate by block centre inside the estate outline.
* District heating: Energieatlas WFS `ea_energienetze:netz_fw_puff_`, network area per operator
  INCLUDING a 250 m buffer (that is how the Land publishes it, DL-DE-Zero); labelled so in the app.
* Substations: OpenStreetMap `power=substation` in Berlin (ODbL), with voltage when tagged.
  The grid load is not public and is not shown.

Run after bake_sites.py (it reads the estate outlines from sites.json).
Writes public/data/context.json.

Usage: python tools/bake_context.py
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

from shapely.geometry import Point, mapping, shape

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bake_common import OUT, in_berlin, overpass, utm_to_lonlat, wfs_features, write  # noqa: E402
from bake_sites import rounded, to_lonlat  # noqa: E402

CC_BY_3 = {"licence": "Creative Commons Namensnennung 3.0 Deutschland", "url": "https://creativecommons.org/licenses/by/3.0/de/"}

SUBSTATIONS_Q = """[out:json][timeout:180];
area["name"="Berlin"]["admin_level"="4"]->.a;
nwr["power"="substation"](area.a);
out center tags;"""


def kv(tags: dict) -> float | None:
    vals = [int(p) / 1000 for p in str(tags.get("voltage", "")).split(";") if p.strip().isdigit()]
    return max(vals) if vals else None


def main() -> None:
    blocks = wfs_features("ua_einwohnerdichte_2025", "ua_einwohnerdichte_2025", sort_by="schluessel")
    if len({b["properties"]["schluessel"] for b in blocks}) != len(blocks):
        raise RuntimeError("population blocks repeat: paging is not stable")
    print(f"{len(blocks)} population blocks, {sum(b['properties']['ew2025'] or 0 for b in blocks):,} residents")

    # ⚠️ The block key starts with the number of one of the 23 PRE-2001 districts, not today's 12,
    # so the blocks are joined to the current outlines by position (block centre inside outline).
    bez_feats = wfs_features("eladesaeulen", "ladepkt_bez")
    bez_utm = [(f["properties"]["id_bezirk"], shape(f["geometry"])) for f in bez_feats]
    by_bez: dict[int, int] = defaultdict(int)
    unassigned = 0
    for b in blocks:
        pt = shape(b["geometry"]).representative_point()
        hit = next((i for i, g in bez_utm if g.contains(pt)), None)
        if hit is None:
            unassigned += b["properties"]["ew2025"] or 0
        else:
            by_bez[hit] += b["properties"]["ew2025"] or 0
    total = sum(b["properties"]["ew2025"] or 0 for b in blocks)
    if unassigned > total * 0.001:
        raise RuntimeError(f"{unassigned} residents fall outside every district outline")

    districts = []
    for f in bez_feats:
        p = f["properties"]
        g = to_lonlat(shape(f["geometry"]).simplify(20))
        c = g.representative_point()
        districts.append({"id": p["id_bezirk"], "bez": p["bezirk"], "residents": by_bez.get(p["id_bezirk"]),
                          "lon": round(c.x, 6), "lat": round(c.y, 6), "outline": rounded(mapping(g))})
    print("residents per district:", {d["bez"]: d["residents"] for d in districts}, "unassigned", unassigned)

    # Residents per estate: block centre inside the outline.
    sites = json.loads((OUT / "sites.json").read_text(encoding="utf-8"))
    centres = []
    for b in blocks:
        pt = shape(b["geometry"]).representative_point()
        centres.append((Point(*utm_to_lonlat(pt.x, pt.y)), b["properties"]["ew2025"] or 0))
    estates = {}
    for e in sites["estates"]:
        poly = shape(e["outline"])
        estates[e["id"]] = sum(n for pt, n in centres if poly.contains(pt))
    print("residents per estate:", estates)

    heat = []
    for f in wfs_features("ea_energienetze", "netz_fw_puff_"):
        p = f["properties"]
        g = to_lonlat(shape(f["geometry"]).simplify(30))
        heat.append({"operator": p["netzbetreiber"], "short": p.get("bezkurz"), "asOf": p.get("stand_daten"),
                     "link": p.get("link"), "outline": rounded(mapping(g), 5)})
    print("district heating areas:", [h["short"] for h in heat])

    subs = []
    for el in overpass(SUBSTATIONS_Q)["elements"]:
        t = el.get("tags", {})
        c = el.get("center") or {"lat": el.get("lat"), "lon": el.get("lon")}
        if c["lat"] is None or not in_berlin(c["lon"], c["lat"]):
            continue
        subs.append({"id": f"{el['type'][0]}{el['id']}", "lon": round(c["lon"], 6), "lat": round(c["lat"], 6),
                     "kv": kv(t), "name": t.get("name"), "operator": t.get("operator"), "kind": t.get("substation")})
    print(f"{len(subs)} substations, {sum(1 for s in subs if (s['kv'] or 0) >= 110)} at 110 kV and above")

    write(
        "context.json",
        {"districts": sorted(districts, key=lambda d: d["id"]), "estateResidents": estates, "heat": heat, "substations": subs,
         "populationAsOf": "2025-12-31"},
        source="Geoportal Berlin (district outlines, DL-DE-Zero); Energieatlas Berlin (district heating areas incl. 250 m buffer, DL-DE-Zero); Umweltatlas Einwohnerdichte 2025 (CC BY 3.0 DE); "
               "OpenStreetMap substations (ODbL)",
        licence=CC_BY_3,
        attribution="Amt für Statistik Berlin-Brandenburg / Einwohnerdichte 2025 (Umweltatlas); © OpenStreetMap contributors",
        notes="Residents = residents register (main residence) on 31.12.2025, summed from blocks: about 3.9 million, higher than the census-based official population (3.70 million). No grid load is shown.",
    )


if __name__ == "__main__":
    main()
