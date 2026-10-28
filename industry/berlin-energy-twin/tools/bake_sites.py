"""Bake the partner sites and place every register unit (PLAN §4.1, §6, D18, D19, D22-D24).

Inputs: public/data/units.json (bake_mastr.py), tools/curated/sites.json.
Sources: OpenStreetMap (ODbL) for estate and depot outlines, Geoportal Berlin
solar atlas `ua_solarpotenzial_solarrechner` (DL-DE-Zero) for buildings and
their roof potential, Geoportal postcode areas (`eladesaeulen:ladepkt_plz`).

What it decides, and how:
* A unit's PLACE: the register's own coordinates ("register"), else the solar-atlas
  building its address matches inside the unit's postcode ("address"), else for a
  BVG unit the depot its name belongs to ("depot"), else only its postcode
  ("postcode", drawn as an aggregate, never as a point, D18).
* degewo BUILDINGS (D22): buildings that carry a degewo unit or a Senate-listed
  degewo plant. Only these are ranked by open roof potential.
* ESTATES: degewo's named estates (outline from OSM) plus register clusters
  (degewo units of one postcode, hull of their buildings). Other buildings in a
  named estate are context: potential only, no address (review S7).

Writes public/data/sites.json.

Usage: python tools/bake_sites.py
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

from shapely.geometry import LineString, MultiPoint, Point, Polygon, mapping, shape
from shapely.ops import polygonize, transform, unary_union

sys.path.insert(0, str(Path(__file__).resolve().parent))
from addresses import HouseNo, normalise_street, unit_address  # noqa: E402
from bake_common import (  # noqa: E402
    DL_DE_ZERO, OUT, ROOT, in_berlin, lonlat_to_utm, overpass, utm_to_lonlat, wfs_features, wfs_filter, write,
)

CURATED = json.loads((ROOT / "tools" / "curated" / "sites.json").read_text(encoding="utf-8"))
ATLAS = ("ua_solarpotenzial_solarrechner", "c_gebaeude")
#: Register clusters need this many degewo units in one postcode to become an area.
CLUSTER_MIN_UNITS = 3
#: Register coordinates and the atlas building point of the same plant lie up to ~60 m apart.
CLUSTER_BUFFER_M = 80


# --- geometry helpers --------------------------------------------------------------------------

def to_utm(geom):
    return transform(lambda x, y, z=None: lonlat_to_utm(x, y), geom)


def to_lonlat(geom):
    return transform(lambda x, y, z=None: utm_to_lonlat(x, y), geom)


def rounded(geojson: dict, nd: int = 5) -> dict:
    def r(c):
        return [round(c[0], nd), round(c[1], nd)] if isinstance(c[0], (int, float)) else [r(x) for x in c]
    return {"type": geojson["type"], "coordinates": r(geojson["coordinates"])}


def osm_area(element: dict):
    """A shapely polygon (lon/lat) from an Overpass `out geom` way or relation, or None."""
    if element["type"] == "way" and element.get("geometry"):
        pts = [(p["lon"], p["lat"]) for p in element["geometry"]]
        polys = list(polygonize([pts])) if pts[0] == pts[-1] else []
        return polys[0] if polys else None
    if element["type"] == "relation":
        members = [m for m in element.get("members", []) if m.get("type") == "way" and m.get("geometry")]
        # Boundaries use role "outer"; site relations (depots) often leave the role empty.
        outer = [m for m in members if m.get("role") == "outer"] or [m for m in members if m.get("role") in ("", None)]
        # Boundary rings come as many open segments: node them into one line set first.
        lines = unary_union([LineString([(q["lon"], q["lat"]) for q in m["geometry"]]) for m in outer if len(m["geometry"]) > 1])
        polys = list(polygonize(lines))
        if polys:
            return unary_union(polys)
        # A site relation of separate closed areas.
        closed = [Polygon([(q["lon"], q["lat"]) for q in m["geometry"]]) for m in outer
                  if len(m["geometry"]) > 3 and m["geometry"][0] == m["geometry"][-1]]
        return unary_union(closed) if closed else None
    return None


# --- inputs ------------------------------------------------------------------------------------

def postcodes() -> dict[str, object]:
    """Postcode polygons in UTM 33N, keyed by postcode."""
    return {f["properties"]["plz"]: shape(f["geometry"]) for f in wfs_features("eladesaeulen", "ladepkt_plz")}


def cached(key: str, fetch):
    """A WFS answer cached under cache/atlas/ (the case-insensitive filter scans the whole city: ~10 s each)."""
    p = ROOT / "cache" / "atlas" / (re.sub(r"[^\w.-]+", "_", key) + ".json")
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    data = fetch()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return data


def atlas_street(street_norm: str) -> list[dict]:
    """All solar-atlas buildings on one street (normalised name), any district."""
    safe = street_norm.replace("'", "''")
    return cached(f"street-{street_norm}", lambda: wfs_filter(*ATLAS, f"strToLowerCase(lage) LIKE '{safe}%'"))


def atlas_street_name(p: dict) -> str:
    """'Kleeblattstraße 11' minus its house number ('11', '2 H', '11C')."""
    lage, hn = (p.get("lage") or "").strip(), (p.get("hausnummer") or "").strip()
    return lage[: -len(hn)].strip() if hn and lage.endswith(hn) else lage


def street_spellings(norm: str) -> list[str]:
    """Spellings OSM may use for a normalised street ('kleeblattstraße' -> 'Kleeblattstraße')."""
    words = [w[:1].upper() + w[1:] for w in norm.split(" ")]
    if words and words[0].lower() in ("am", "an", "auf", "im", "in", "zum", "zur", "unter", "hinter"):
        words = [words[0]] + words[1:]
    return [" ".join(words)]


def building_row(f: dict, *, with_address: bool) -> dict:
    p = f["properties"]
    row = {
        "id": p["id"],
        "lon": round(float(p["gebaeudepunkt_lon"]), 6),
        "lat": round(float(p["gebaeudepunkt_lat"]), 6),
        "potKw": p.get("potenzielle_leistung") or 0,
        "areaM2": p.get("geeignete_flaeche") or 0,
        "fn": p.get("gebaeudefunktion"),
    }
    if with_address:
        row["addr"] = p.get("lage")
        # Ranked buildings only: the footprint the app outlines on the photo roof
        # (D33). 0.3 m simplification keeps every corner a viewer can see.
        if f.get("geometry"):
            foot = shape(f["geometry"]).simplify(0.3)
            row["outline"] = rounded(mapping(to_lonlat(foot)), 6)
            # The outline the app raises onto the roof: a 1.2 m band inside the
            # footprint. A band, not the whole roof, so the photo with its panels
            # stays visible; inside, not outside, so it never overhangs the eaves.
            band = foot.difference(foot.buffer(-1.2))
            if not band.is_empty:
                row["ring"] = rounded(mapping(to_lonlat(band)), 6)
    return row


# --- the bake ----------------------------------------------------------------------------------

def main() -> None:
    units = json.loads((OUT / "units.json").read_text(encoding="utf-8"))["units"]
    plz_poly = postcodes()
    print(f"{len(plz_poly)} postcode areas")

    # 1. Address matching for every unit without register coordinates, plus every degewo unit
    #    (a located degewo unit still needs its building for the solar gap).
    want = [u for u in units if u["city"] == "Berlin" and (not u["located"] or "degewo" in u["queries"])]
    by_street: dict[str, list[tuple[dict, object]]] = defaultdict(list)
    for u in want:
        a = unit_address(u)
        if a:
            by_street[a.street].append((u, a))
    print(f"{sum(len(v) for v in by_street.values())} units with an address on {len(by_street)} streets")

    placements: dict[str, dict] = {}
    unit_buildings: dict[str, list[dict]] = {}
    for street, items in sorted(by_street.items()):
        feats = atlas_street(street)
        for u, a in items:
            area = plz_poly.get(a.plz or u.get("plz"))
            hits = []
            for f in feats:
                p = f["properties"]
                if normalise_street(atlas_street_name(p)) != street:
                    continue
                h = HouseNo.parse(p.get("hausnummer") or "")
                if not h or not a.covers(h):
                    continue
                e, n = lonlat_to_utm(float(p["gebaeudepunkt_lon"]), float(p["gebaeudepunkt_lat"]))
                if area is not None and not area.buffer(25).contains(Point(e, n)):
                    continue  # same street name in another district
                hits.append(f)
            if hits:
                unit_buildings[u["id"]] = hits
                if not u["located"]:
                    xs = [float(h["properties"]["gebaeudepunkt_lon"]) for h in hits]
                    ys = [float(h["properties"]["gebaeudepunkt_lat"]) for h in hits]
                    placements[u["id"]] = {"lon": round(sum(xs) / len(xs), 6), "lat": round(sum(ys) / len(ys), 6),
                                           "method": "address", "buildings": [h["properties"]["id"] for h in hits]}
    # 1b. Fallback for addresses the solar atlas does not know yet (new builds such as Am Falkenberg
    #     11A-Q or Kleeblattstraße 4-34): OpenStreetMap building addresses, same street, number and
    #     postcode area. Placement only: these buildings have no atlas potential to rank.
    missing = [(u, a) for items in by_street.values() for u, a in items
               if u["id"] not in unit_buildings and not u["located"]]
    if missing:
        names = sorted({osm_street for _, a in missing for osm_street in street_spellings(a.street)})
        rx = "|".join(re.escape(n) for n in names)
        osm_addr = cached("osm-addresses-" + hashlib.sha1(rx.encode()).hexdigest()[:10], lambda: overpass(
            f'[out:json][timeout:180];area["name"="Berlin"]["admin_level"="4"]->.a;'
            f'nwr["addr:street"~"^({rx})$",i]["addr:housenumber"](area.a);out center tags;'))
        for u, a in missing:
            area = plz_poly.get(a.plz or u.get("plz"))
            pts = []
            for el in osm_addr["elements"]:
                t = el.get("tags", {})
                if normalise_street(t.get("addr:street", "")) != a.street:
                    continue
                h = HouseNo.parse(t.get("addr:housenumber", ""))
                c = el.get("center") or {"lon": el.get("lon"), "lat": el.get("lat")}
                if not h or not a.covers(h) or c.get("lon") is None:
                    continue
                e, n = lonlat_to_utm(c["lon"], c["lat"])
                if area is not None and not area.buffer(25).contains(Point(e, n)):
                    continue
                pts.append((c["lon"], c["lat"]))
            if pts:
                placements[u["id"]] = {"lon": round(sum(x for x, _ in pts) / len(pts), 6),
                                       "lat": round(sum(y for _, y in pts) / len(pts), 6), "method": "address-osm"}
        print(f"OSM address fallback placed {sum(1 for u, _ in missing if u['id'] in placements)} of {len(missing)}")

    for u in units:
        if u["located"]:
            placements[u["id"]] = {"lon": u["lon"], "lat": u["lat"], "method": "register",
                                   **({"buildings": [h["properties"]["id"] for h in unit_buildings[u["id"]]]}
                                      if u["id"] in unit_buildings else {})}

    # 2. BVG depots: footprints from OSM, units by name prefix.
    depot_rows = []
    osm_ids = [tuple(x) for d in CURATED["depots"] for x in (d.get("osm") or [])]
    q = "[out:json][timeout:180];(" + "".join(f"{t}({i});" for t, i in osm_ids) + ");out geom;"
    osm = {(e["type"], e["id"]): e for e in cached("osm-depots", lambda: overpass(q))["elements"]}
    for d in CURATED["depots"]:
        mine = [u for u in units if "bvg" in u["queries"]
                and any(u["name"].startswith(pfx) for pfx in d["unitPrefixes"])]
        parts = [osm_area(osm[tuple(x)]) for x in (d.get("osm") or []) if tuple(x) in osm]
        parts = [g for g in parts if g is not None]
        poly = unary_union(parts) if parts else None
        located = [(u["lon"], u["lat"]) for u in mine if u["located"]]
        if poly is not None:
            c = poly.representative_point()
            centre = (round(c.x, 6), round(c.y, 6))
        elif located:
            centre = (round(sum(x for x, _ in located) / len(located), 6), round(sum(y for _, y in located) / len(located), 6))
        else:
            centre = None
        for u in mine:
            if u["id"] not in placements and centre:
                placements[u["id"]] = {"lon": centre[0], "lat": centre[1], "method": "depot"}
            placements.setdefault(u["id"], {}).update({"depot": d["id"]})
        depot_rows.append({
            "id": d["id"], "name": d["name"], "kind": d["kind"], "status": d["status"],
            "deal2025": d["deal2025"], "source": d.get("source") or ("bvg-bsw-solar-2025" if d["deal2025"] else "mastr"),
            "lon": centre[0] if centre else None, "lat": centre[1] if centre else None,
            "outline": rounded(mapping(poly)) if poly is not None else None,
            "units": [u["id"] for u in mine],
            "kwGross": round(sum(u["kwGross"] or 0 for u in mine if u["carrier"] == "Solare Strahlungsenergie"), 2),
        })
        print(f"depot {d['id']}: {len(mine)} units, outline {'yes' if poly is not None else 'no'}, centre {centre}")

    # 3. Postcode fallback for everything still unplaced (D18).
    for u in units:
        if u["id"] not in placements or "lon" not in placements[u["id"]]:
            placements.setdefault(u["id"], {}).update({"method": "postcode", "plz": u["plz"]})
    used_plz = sorted({p["plz"] for p in placements.values() if p.get("method") == "postcode" and p.get("plz") in plz_poly})
    plz_rows = []
    for code in used_plz:
        g = to_lonlat(plz_poly[code].simplify(25))
        c = g.representative_point()
        plz_rows.append({"plz": code, "lon": round(c.x, 6), "lat": round(c.y, 6), "outline": rounded(mapping(g))})

    # 4. degewo buildings: every building carrying a degewo unit.
    degewo_units = [u for u in units if "degewo" in u["queries"]]
    buildings: dict[str, dict] = {}
    for u in degewo_units:
        for f in unit_buildings.get(u["id"], []):
            b = buildings.setdefault(f["properties"]["id"], {**building_row(f, with_address=True), "units": [], "installedKw": 0.0})
            b["units"].append(u["id"])
            if u["carrier"] == "Solare Strahlungsenergie":
                b["installedKw"] = round(b["installedKw"] + (u["kwGross"] or 0) / len(unit_buildings[u["id"]]), 2)

    # 5. Estates: named (OSM outline) and register clusters (hull of degewo buildings and located units).
    estates = []
    for e in CURATED["estates"]:
        res = cached(f"osm-estate-{e['id']}", lambda: overpass(f'[out:json][timeout:180];area["name"="Berlin"]["admin_level"="4"]->.a;{e["area"]["query"]}(area.a);out geom;'))
        polys = [p for p in (osm_area(el) for el in res["elements"]) if p is not None]
        if not polys:
            print(f"estate {e['id']}: no OSM outline, skipped (claim kept in the curated file)")
            continue
        poly = unary_union(polys)
        estates.append({"id": e["id"], "name": e["name"], "bezirk": e["bezirk"], "kind": "named",
                        "claim": e["claim"], "source": e["source"], "_poly": poly})
    by_plz: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for u in degewo_units:
        if u["city"] != "Berlin":
            continue
        p = placements.get(u["id"], {})
        if "lon" in p and p.get("method") in ("register", "address", "address-osm"):
            by_plz[u["plz"]].append((p["lon"], p["lat"]))
    for code, pts in sorted(by_plz.items()):
        if len(pts) < CLUSTER_MIN_UNITS:
            continue
        hull = to_lonlat(to_utm(MultiPoint(pts)).convex_hull.buffer(CLUSTER_BUFFER_M))
        streets = sorted({unit_address(u).street.title() for u in degewo_units
                          if u["plz"] == code and unit_address(u)})
        estates.append({"id": f"cluster-{code}", "name": f"{code} · " + ", ".join(streets[:3]) + (" …" if len(streets) > 3 else ""),
                        "bezirk": None, "kind": "cluster", "claim": None, "source": "mastr", "_poly": hull})

    # 6. Context buildings inside the named estates (potential only, no addresses).
    context = []
    for est in estates:
        poly = est.pop("_poly")
        est["outline"] = rounded(mapping(poly))
        inside_b = [b for b in buildings.values() if poly.contains(Point(b["lon"], b["lat"]))]
        for b in inside_b:
            b.setdefault("estates", []).append(est["id"])
        if est["kind"] != "named":
            continue
        w, s, e_, n = to_utm(poly).bounds
        feats = cached(f"bbox-{est['id']}", lambda: wfs_filter(*ATLAS, f"BBOX(geom,{w},{s},{e_},{n},'EPSG:25833')"))
        for f in feats:
            p = f["properties"]
            if p["id"] in buildings or not poly.contains(Point(float(p["gebaeudepunkt_lon"]), float(p["gebaeudepunkt_lat"]))):
                continue
            if (p.get("potenzielle_leistung") or 0) <= 0:
                continue
            context.append({**building_row(f, with_address=False), "estate": est["id"]})
        print(f"estate {est['id']}: {len(inside_b)} degewo buildings, {sum(1 for c in context if c['estate'] == est['id'])} context buildings")

    for p in placements.values():
        if "lon" in p and not in_berlin(p["lon"], p["lat"]) and p["method"] != "register":
            raise RuntimeError(f"placement outside Berlin: {p}")

    stats = defaultdict(lambda: defaultdict(int))
    for u in units:
        for q in u["queries"]:
            stats[q][placements[u["id"]]["method"]] += 1
    for q, s in stats.items():
        print(f"{q}: " + ", ".join(f"{k} {v}" for k, v in sorted(s.items())))
    unmatched = [u["name"] for u in degewo_units if u["city"] == "Berlin" and placements[u["id"]]["method"] == "postcode"]
    print(f"degewo units only placed by postcode ({len(unmatched)}): {unmatched}")
    print(f"{len(buildings)} degewo buildings, {len(context)} context buildings, {len(plz_rows)} postcode aggregates")

    write(
        "sites.json",
        {"sources": CURATED["sources"], "estates": estates, "depots": depot_rows,
         "buildings": sorted(buildings.values(), key=lambda b: b["id"]), "context": context,
         "postcodes": plz_rows, "placements": placements},
        source="OpenStreetMap (estate and depot outlines); Geoportal Berlin solar atlas and postcode areas; "
               "curated sources per site (tools/curated/sites.json)",
        licence=DL_DE_ZERO,
        attribution="Geoportal Berlin (Solarkataster, PLZ), © OpenStreetMap contributors (ODbL)",
        notes="Placement methods: register, address (solar-atlas building within the unit's postcode), depot, postcode. "
              "Context buildings carry no address on purpose.",
    )


if __name__ == "__main__":
    main()
