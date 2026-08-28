"""Probe a university site in OpenStreetMap — before a single coordinate enters config.

The site-agnostic successor to `probe_oth.py`. Same rule, inherited from `Campus-Insights` /
`Gleitschirm-Insights`: **no coordinate enters an AOI config without being looked up.** That rule
exists because an earlier project shipped an AOI built around a place node 4.6 km from the town it
named, and `probe_oth.py` earned it again — the OTH campus outline it measured turned out to be
half the separation the customer conversation had assumed.

`probe_oth.py` hard-codes Regensburg. It is deliberately left alone: it is the record of how the
OTH AOI was measured. This module carries the same stages with the site as an argument, so the
second university is a registry entry rather than a copied file.

  stage `sites`   which OSM features carry the university's name/operator, and where they are
  stage `bounds`  the true extent of named features — turns a guessed box into a measured one
  stage `detail`  what is inside a candidate campus box — buildings, trees, paths, PT stops
  stage `indoor`  does OSM have indoor room mapping here? (decides whether rooms can be real)
  stage `aoi`     per-category counts over the whole AOI — what the twin has to render
  stage `ele`     `ele`-tagged nodes, i.e. candidate control points for the registration gate

Raw responses are written to the temp folder; the summary is what gets read into config.

Usage
  python tools/geodata/probe_site.py --site lmu --stage sites
  python tools/geodata/probe_site.py --site lmu --stage bounds --ids way/123 relation/456
  python tools/geodata/probe_site.py --site lmu --stage indoor --west 11.57 --east 11.59 \
      --south 48.14 --north 48.16 --label stammgelaende
"""

from __future__ import annotations

import argparse
import http.client
import json
import math
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# Kumi first — measured in Campus-Insights: the main instance 504s reproducibly on the larger
# queries this kind of probe needs, while the same query returns in seconds here.
OVERPASS_MIRRORS = (
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
)
USER_AGENT = "Campus-Scheduler/0.1 (open geodata probe; +https://geodaten.bayern.de)"

OUT_DIR = Path(__file__).resolve().parents[2] / "temp"

# The search area for each site, deliberately WIDER than any AOI would be: the point of a probe is
# to find out where a university actually is, not to confirm a box somebody already drew. The
# `match` regex is what separates this university from the others in the same city — in München
# that matters, because TUM, HM and LMU all sit inside the same few square kilometres.
PROBE_SITES: dict[str, dict] = {
    "oth": {
        "label": "OTH Regensburg",
        "wide": {"west": 12.00, "east": 12.20, "south": 48.95, "north": 49.06},
        "match": "Ostbayerische Technische Hochschule|OTH Regensburg",
        "operator": "Ostbayerische|OTH",
    },
    "lmu": {
        "label": "LMU München",
        # Munich and its south-western/northern fringes: the Stammgelände is in Maxvorstadt, but
        # LMU faculties are known to sit well outside the Altstadt ring, so the box has to be wide
        # enough for the probe to FIND them rather than confirm the ones already thought of.
        "wide": {"west": 11.30, "east": 11.72, "south": 48.05, "north": 48.32},
        "match": "Ludwig-Maximilians|LMU",
        "operator": "Ludwig-Maximilians|LMU",
    },
    # ── The five twins that already have terrain and are being brought up to the LMU standard ──
    # Each entry names ONE university and has to survive the same test LMU's did: a
    # case-insensitive acronym over a German street index will find something. `RWTH` and `FAU`
    # therefore carry a word-boundary guard, and every pattern also carries the spelled-out form,
    # because OSM is inconsistent about which one a building actually has.
    #
    # ⚠️ `match`/`operator` GO INTO THE OVERPASS QUERY AND `strict` DOES NOT, AND THE DIFFERENCE
    # IS NOT COSMETIC. Overpass evaluates RE2, which has no lookaround, so a `(?<![A-Za-z])` guard
    # in `match` is an HTTP 400 rather than a stricter filter — measured here, three retries deep,
    # on the first RWTH probe. So the OVERPASS side casts the wide net and the optional `strict`
    # pattern (Python `re`, lookaround allowed) narrows the printed result. That is the right way
    # round: over-fetching costs a slower probe, over-filtering costs a missing campus.
    "rwth": {
        "label": "RWTH Aachen",
        "wide": {"west": 5.98, "east": 6.15, "south": 50.73, "north": 50.83},
        "match": r"RWTH|Rheinisch-Westf",
        "operator": r"RWTH|Rheinisch-Westf",
        "strict": r"(?<![A-Za-z])RWTH(?![A-Za-z])|Rheinisch-Westf",
    },
    "koeln": {
        "label": "Universität zu Köln",
        # ⚠️ 'Köln' alone is useless here: TH Köln (the Fachhochschule), the Deutsche Sporthochschule
        # and the Kunsthochschule für Medien all carry it. Only the full form identifies this one.
        "wide": {"west": 6.85, "east": 7.02, "south": 50.88, "north": 50.98},
        "match": r"Universität zu Köln|Universität Köln|University of Cologne",
        "operator": r"Universität zu Köln|Universität Köln",
    },
    "muenster": {
        "label": "Universität Münster",
        # ⚠️ FH Münster is a different institution in the same streets, and it is NOT excluded by
        # the word 'Münster'. 'Westfälische Wilhelms' is the old official name and still the most
        # common operator string in OSM; 'Universität Münster' is the current one.
        "wide": {"west": 7.52, "east": 7.70, "south": 51.91, "north": 52.01},
        "match": r"Universität Münster|Westfälische Wilhelms",
        "operator": r"Universität Münster|Westfälische Wilhelms",
    },
    "fau": {
        "label": "FAU Erlangen-Nürnberg",
        # Erlangen only — the AOI is deliberately not the whole university (Nürnberg is 20 km
        # south), and the wide box says so rather than pretending otherwise.
        "wide": {"west": 10.93, "east": 11.10, "south": 49.52, "north": 49.65},
        "match": r"Friedrich-Alexander|FAU",
        "operator": r"Friedrich-Alexander|FAU",
        "strict": r"Friedrich-Alexander|(?<![A-Za-z])FAU(?![A-Za-z])",
    },
    "tuebingen": {
        "label": "Universität Tübingen",
        "wide": {"west": 8.98, "east": 9.14, "south": 48.47, "north": 48.57},
        "match": r"Universität Tübingen|Eberhard[ -]Karls",
        "operator": r"Universität Tübingen|Eberhard[ -]Karls|Universitätsklinikum Tübingen",
    },
    "tuberlin": {
        "label": "TU Berlin",
        # Charlottenburg (Straße des 17. Juni) and Wedding (Seestraße), plus the corridor between
        # them — the two campuses this AOI is built around, and wide enough that the probe can find
        # the outlying institutes rather than confirm the two already thought of.
        "wide": {"west": 13.26, "east": 13.42, "south": 52.48, "north": 52.58},
        # ⚠️ 'Universität Berlin' IS THE WORST POSSIBLE PATTERN HERE, and it is the obvious one.
        # Berlin has *Freie* Universität Berlin and *Humboldt*-Universität zu Berlin, both of which
        # contain it; the city also holds UdK, HTW, HWR, BHT and the Charité. Only the full
        # 'Technische Universität Berlin' identifies this one, exactly as Köln needs its full form
        # to exclude TH Köln.
        # ⚠️ And 'TU' on its own is an acronym over a German street index — the RWTH/FAU lesson —
        # so the loose pattern keeps the space in 'TU Berlin' and `strict` adds the word boundary
        # that Overpass's RE2 cannot express.
        "match": r"Technische Universität Berlin|TU Berlin",
        "operator": r"Technische Universität Berlin|TU Berlin",
        "strict": r"Technische Universität Berlin|(?<![A-Za-z])TU Berlin(?![A-Za-z])",
    },
}


def overpass(query: str, attempts: int = 3, timeout: int = 180) -> dict:
    body = urllib.parse.urlencode({"data": query}).encode()
    last: Exception | None = None
    for attempt in range(attempts):
        for endpoint in OVERPASS_MIRRORS:
            try:
                request = urllib.request.Request(
                    endpoint, data=body, headers={"User-Agent": USER_AGENT}
                )
                with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
                    return json.loads(response.read())
            # ⚠️ `URLError` IS NOT THE WHOLE FAMILY, and the gap only shows once the retry loop is
            # actually needed. urllib wraps failures raised while OPENING the connection, but a
            # mirror that accepts the request and then drops it mid-body raises
            # `http.client.RemoteDisconnected` / `IncompleteRead` straight through — measured on
            # three of five probes in one afternoon. Those escaped this handler and killed the run
            # on the first flake, with two healthy mirrors and two retries left unused.
            except (
                urllib.error.HTTPError,
                urllib.error.URLError,
                http.client.HTTPException,
                TimeoutError,
                OSError,
            ) as exc:
                last = exc
                print(f"  {endpoint.split('/')[2]} failed: {exc}")
        wait = 15 * (attempt + 1)
        print(f"  attempt {attempt + 1} failed on every mirror — retrying in {wait}s")
        time.sleep(wait)
    raise RuntimeError(f"Overpass failed after {attempts} attempts: {last}")


def centre(element: dict) -> tuple[float, float] | None:
    if "lat" in element and "lon" in element:
        return element["lat"], element["lon"]
    if "center" in element:
        return element["center"]["lat"], element["center"]["lon"]
    if "bounds" in element:
        b = element["bounds"]
        return (b["minlat"] + b["maxlat"]) / 2, (b["minlon"] + b["maxlon"]) / 2
    return None


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    r = 6371008.8
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp = p2 - p1
    dl = math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def box(bounds: dict[str, float]) -> str:
    return f"{bounds['south']},{bounds['west']},{bounds['north']},{bounds['east']}"


def dump(site: str, name: str, payload: dict | list) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"{site}-probe-{name}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return path


def stage_sites(site: str, cfg: dict) -> None:
    """Which OSM features claim to be this university, and where are they?"""
    b = box(cfg["wide"])
    query = f"""
    [out:json][timeout:240];
    (
      nwr["amenity"="university"]({b});
      nwr["operator"~"{cfg['operator']}",i]({b});
      nwr["name"~"{cfg['match']}",i]({b});
    );
    out tags center;
    """
    data = overpass(query)
    print(f"raw -> {dump(site, 'sites', data)}")

    rows = []
    for el in data.get("elements", []):
        tags = el.get("tags", {})
        c = centre(el)
        if not c:
            continue
        rows.append(
            {
                "type": el["type"],
                "id": el["id"],
                "name": tags.get("name", ""),
                "amenity": tags.get("amenity", ""),
                "operator": tags.get("operator", ""),
                "street": f"{tags.get('addr:street', '')} {tags.get('addr:housenumber', '')}".strip(),
                "lat": round(c[0], 6),
                "lon": round(c[1], 6),
            }
        )

    # Only the rows that actually name THIS university. Everything else in the dump is context —
    # in a city with several universities, "amenity=university" is not an identification.
    import re

    pattern = re.compile(cfg.get("strict") or cfg["match"], re.IGNORECASE)
    mine = [r for r in rows if pattern.search(r["name"]) or pattern.search(r["operator"])]

    print(f"\n{len(rows)} university-ish features in the wide box, {len(mine)} of them {cfg['label']}\n")
    for r in sorted(mine, key=lambda r: (r["lat"], r["lon"])):
        print(
            f"  {r['type']:8} {r['id']:<12} {r['lat']:.5f},{r['lon']:.5f}  "
            f"{r['name'][:55]:<55} | {r['amenity']:<10} | {r['street']}"
        )

    if len(mine) >= 2:
        print("\nseparations over 300 m (this is what decides the AOI):")
        seen: set[tuple[int, int]] = set()
        for i, a in enumerate(mine):
            for bb in mine[i + 1 :]:
                key = (min(a["id"], bb["id"]), max(a["id"], bb["id"]))
                if key in seen:
                    continue
                seen.add(key)
                d = haversine_m((a["lat"], a["lon"]), (bb["lat"], bb["lon"]))
                if d > 300:
                    print(f"  {a['name'][:32]:<32} <-> {bb['name'][:32]:<32} {d / 1000:6.2f} km")


def stage_detail(site: str, bounds: dict[str, float], label: str) -> None:
    """What is inside a candidate campus box?"""
    b = box(bounds)
    query = f"""
    [out:json][timeout:180];
    (
      way["building"]({b});
      relation["building"]({b});
      node["natural"="tree"]({b});
      way["highway"~"^(footway|path|steps|pedestrian)$"]({b});
      node["public_transport"="platform"]({b});
      node["highway"="bus_stop"]({b});
    );
    out count;
    """
    data = overpass(query)
    print(f"raw -> {dump(site, f'detail-{label}', data)}")
    for el in data.get("elements", []):
        if el.get("type") == "count":
            t = el.get("tags", {})
            print(
                f"\n{label}: total={t.get('total')} nodes={t.get('nodes')} "
                f"ways={t.get('ways')} relations={t.get('relations')}"
            )


def stage_indoor(site: str, bounds: dict[str, float], label: str) -> None:
    """The decisive question for room-level analytics: is there indoor mapping here?"""
    b = box(bounds)
    query = f"""
    [out:json][timeout:180];
    (
      nwr["indoor"="room"]({b});
      nwr["indoor"="corridor"]({b});
      nwr["indoor"="level"]({b});
      nwr["building:levels"]({b});
    );
    out count;
    """
    data = overpass(query)
    print(f"raw -> {dump(site, f'indoor-{label}', data)}")
    for el in data.get("elements", []):
        if el.get("type") == "count":
            print(f"\n{label} indoor+levels: {el.get('tags', {})}")

    rooms = f"""
    [out:json][timeout:180];
    nwr["indoor"="room"]({b});
    out tags center;
    """
    data = overpass(rooms)
    els = data.get("elements", [])
    print(f"{label}: {len(els)} indoor=room features")
    for el in els[:25]:
        t = el.get("tags", {})
        print(f"    ref={t.get('ref', '-')!s:<12} name={t.get('name', '-')!s:<34} level={t.get('level', '-')}")


def stage_aoi(site: str, bounds: dict[str, float]) -> None:
    """Per-category counts over the whole AOI — what the twin will actually have to render."""
    b = box(bounds)
    categories = {
        "buildings": f'way["building"]({b});relation["building"]({b});',
        "buildings_with_levels": f'way["building"]["building:levels"]({b});',
        "trees": f'node["natural"="tree"]({b});',
        "tree_rows": f'way["natural"="tree_row"]({b});',
        "wood_landuse": f'way["landuse"~"^(forest|grass|meadow|village_green)$"]({b});relation["landuse"~"^(forest|grass|meadow)$"]({b});',
        "footways": f'way["highway"~"^(footway|path|steps|pedestrian|cycleway)$"]({b});',
        "roads": f'way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|service|unclassified)$"]({b});',
        "pt_stops": f'node["highway"="bus_stop"]({b});node["railway"="tram_stop"]({b});node["public_transport"="platform"]({b});',
        "water": f'way["natural"="water"]({b});way["waterway"]({b});relation["natural"="water"]({b});',
    }
    results: dict[str, str] = {}
    for name, body in categories.items():
        query = f"[out:json][timeout:240];({body});out count;"
        data = overpass(query)
        total = "?"
        for el in data.get("elements", []):
            if el.get("type") == "count":
                total = el.get("tags", {}).get("total", "?")
        results[name] = total
        print(f"  {name:<22} {total}")
        time.sleep(3)
    dump(site, "aoi-counts", results)


def stage_bounds(site: str, ids: list[str]) -> None:
    """True extent of named OSM features — turns a guessed campus box into a measured one.

    ⚠️ `out geom;`, never `out tags geom;` — the latter returns relations with ZERO members, which
    silently hides exactly the large multi-part campus outlines this stage exists to measure.
    """
    parts = []
    for raw in ids:
        kind, _, oid = raw.partition("/")
        parts.append(f"{kind}({oid});")
    query = f"[out:json][timeout:240];({''.join(parts)});out geom;"
    data = overpass(query)
    print(f"raw -> {dump(site, 'bounds', data)}")
    for el in data.get("elements", []):
        tags = el.get("tags", {})
        b = el.get("bounds")
        if not b:
            print(f"  {el['type']}/{el['id']} — no bounds returned")
            continue
        w_m = haversine_m((b["minlat"], b["minlon"]), (b["minlat"], b["maxlon"]))
        h_m = haversine_m((b["minlat"], b["minlon"]), (b["maxlat"], b["minlon"]))
        print(
            f"\n  {el['type']}/{el['id']}  {tags.get('name', '')[:50]}\n"
            f"    west={b['minlon']:.5f} east={b['maxlon']:.5f} "
            f"south={b['minlat']:.5f} north={b['maxlat']:.5f}\n"
            f"    extent {w_m:.0f} x {h_m:.0f} m"
        )


def stage_ele(site: str, bounds: dict[str, float]) -> None:
    """Candidate control points for the registration gate."""
    b = box(bounds)
    query = f"""
    [out:json][timeout:180];
    node["ele"]({b});
    out tags center;
    """
    data = overpass(query)
    print(f"raw -> {dump(site, 'ele', data)}")
    els = data.get("elements", [])
    print(f"\n{len(els)} ele-tagged nodes")
    for el in els:
        t = el.get("tags", {})
        print(
            f"  node/{el['id']:<12} {el['lat']:.6f},{el['lon']:.6f}  ele={t.get('ele'):<10} "
            f"{t.get('name', '')[:40]:<40} {[k for k in t if k not in ('ele', 'name')][:4]}"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", default="lmu", choices=sorted(PROBE_SITES))
    parser.add_argument(
        "--stage", required=True, choices=["sites", "detail", "indoor", "aoi", "bounds", "ele"]
    )
    parser.add_argument("--ids", nargs="*", default=[], help="e.g. relation/1733231 way/28938080")
    parser.add_argument("--west", type=float)
    parser.add_argument("--east", type=float)
    parser.add_argument("--south", type=float)
    parser.add_argument("--north", type=float)
    parser.add_argument("--label", default="box")
    args = parser.parse_args()

    cfg = PROBE_SITES[args.site]
    bounds = dict(cfg["wide"])
    for key in ("west", "east", "south", "north"):
        if getattr(args, key) is not None:
            bounds[key] = getattr(args, key)

    if args.stage == "sites":
        stage_sites(args.site, cfg)
    elif args.stage == "detail":
        stage_detail(args.site, bounds, args.label)
    elif args.stage == "indoor":
        stage_indoor(args.site, bounds, args.label)
    elif args.stage == "aoi":
        stage_aoi(args.site, bounds)
    elif args.stage == "bounds":
        stage_bounds(args.site, args.ids)
    else:
        stage_ele(args.site, bounds)


if __name__ == "__main__":
    main()
