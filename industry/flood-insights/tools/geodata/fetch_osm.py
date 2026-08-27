"""Fetch the river centreline and context vectors for an AOI from OpenStreetMap via Overpass.

Feeds the chainage model in PLAN §6.2: the centreline is resampled at a fixed step to produce the
~520 chainage points that the whole simulation is indexed on.

The AOI comes from config (PLAN §14 Q2) — nothing about the Ahr valley is hard-coded here.

Usage
  python tools/geodata/fetch_osm.py --out data/raw/osm
  python tools/geodata/fetch_osm.py --aoi <other-aoi> --out data/raw/osm

Licence: OpenStreetMap contributors, ODbL. Attribution is mandatory — see NOTICE.md.
"""

from __future__ import annotations

import argparse
import json
import math
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from aoi import bbox_tuple, load_aoi, raw_dir

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.osm.ch/api/interpreter",
]


def overpass(query: str, timeout: int = 300, attempts: int = 3) -> dict:
    """Query Overpass, falling back across mirrors — the main endpoint rate-limits readily.

    Running the pipeline makes several large requests in a row, which is exactly the pattern that
    earns a 504, so a refusal is retried on the other mirrors and then backed off rather than
    failing the whole build.
    """
    last_error: Exception | None = None
    for attempt in range(attempts):
        for endpoint in ENDPOINTS:
            try:
                data = urllib.parse.urlencode({"data": query}).encode()
                req = urllib.request.Request(
                    endpoint, data=data, headers={"User-Agent": "Flut-Insights/0.1 (demo)"}
                )
                with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
                    return json.load(resp)
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
                print(f"  {endpoint} failed: {exc}")
                last_error = exc
                time.sleep(3)
        if attempt + 1 < attempts:
            backoff = 20 * (attempt + 1)
            print(f"  all mirrors refused; waiting {backoff}s before retrying")
            time.sleep(backoff)
    raise RuntimeError(f"All Overpass endpoints failed: {last_error}")


def build_query(bbox: tuple[float, float, float, float], river_name: str) -> str:
    south, west, north, east = bbox
    b = f"{south},{west},{north},{east}"
    # Every *named* river in the box, not only the one wanted. One extra way per river costs
    # nothing and means a name mismatch can say what is actually there instead of "(none)" —
    # which is what it said for Castel Bolognese, where three rivers cross the box.
    return f"""
[out:json][timeout:280];
(
  way["waterway"="river"]["name"]({b});
  way["waterway"="stream"]({b});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified)$"]({b});
  way["bridge"]["highway"]({b});
  way["railway"="rail"]({b});
);
out geom;
"""


def haversine_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def stitch_centreline(ways: list[dict]) -> list[tuple[float, float]]:
    """Join river ways end-to-end into one ordered polyline.

    OSM splits a river into many ways in arbitrary order and direction, so greedily chain them by
    matching endpoints (within a small tolerance) and reverse segments as needed.
    """
    segments = [[(p["lon"], p["lat"]) for p in w["geometry"]] for w in ways if w.get("geometry")]
    if not segments:
        return []

    # Start from the westernmost segment — the Ahr flows west to east, and for any other AOI this
    # simply fixes a deterministic starting end.
    segments.sort(key=lambda s: min(pt[0] for pt in s))
    line = segments.pop(0)
    tolerance_m = 25.0

    changed = True
    while segments and changed:
        changed = False
        for i, seg in enumerate(segments):
            for candidate in (seg, seg[::-1]):
                if haversine_m(*line[-1], *candidate[0]) < tolerance_m:
                    line.extend(candidate[1:])
                    segments.pop(i)
                    changed = True
                    break
                if haversine_m(*line[0], *candidate[-1]) < tolerance_m:
                    line = candidate[:-1] + line
                    segments.pop(i)
                    changed = True
                    break
            if changed:
                break

    if segments:
        print(f"  note: {len(segments)} river way(s) could not be chained (gaps or tributaries)")
    return line


def clip_to_bbox(
    line: list[tuple[float, float]], bbox: tuple[float, float, float, float]
) -> list[tuple[float, float]]:
    """Keep only the longest run of the polyline that lies inside the AOI.

    Overpass `out geom` returns the FULL geometry of any way that merely intersects the bounding
    box, so a single OSM river way can extend tens of kilometres beyond the AOI. Without this the
    chainage model would be built for a river reach we have no terrain for.

    Endpoints are interpolated onto the boundary so the reach starts and ends exactly at the AOI
    edge rather than at whatever vertex happened to be nearest.
    """
    south, west, north, east = bbox

    def inside(pt: tuple[float, float]) -> bool:
        return west <= pt[0] <= east and south <= pt[1] <= north

    def boundary_point(
        a: tuple[float, float], b: tuple[float, float]
    ) -> tuple[float, float]:
        """Bisect the segment a(outside)-b(inside) onto the boundary; 40 steps is sub-millimetre."""
        for _ in range(40):
            mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
            if inside(mid):
                b = mid
            else:
                a = mid
        return b

    runs: list[list[tuple[float, float]]] = []
    current: list[tuple[float, float]] = []
    for i, pt in enumerate(line):
        if inside(pt):
            if not current and i > 0:
                current.append(boundary_point(line[i - 1], pt))
            current.append(pt)
        else:
            if current:
                current.append(boundary_point(pt, current[-1]))
                runs.append(current)
                current = []
    if current:
        runs.append(current)

    if not runs:
        return []
    if len(runs) > 1:
        print(f"  note: river enters the AOI {len(runs)} times; keeping the longest reach")
    return max(runs, key=len)


def resample(line: list[tuple[float, float]], step_m: float) -> list[dict]:
    """Resample to fixed spacing, returning chainage points with cumulative distance."""
    if len(line) < 2:
        return []
    points = [{"i": 0, "lon": line[0][0], "lat": line[0][1], "chainage_m": 0.0}]
    carried = 0.0
    total = 0.0

    for (x1, y1), (x2, y2) in zip(line, line[1:]):
        seg_len = haversine_m(x1, y1, x2, y2)
        if seg_len == 0:
            continue
        pos = step_m - carried
        while pos <= seg_len:
            f = pos / seg_len
            total += step_m
            points.append(
                {
                    "i": len(points),
                    "lon": x1 + (x2 - x1) * f,
                    "lat": y1 + (y2 - y1) * f,
                    "chainage_m": round(total, 2),
                }
            )
            pos += step_m
        carried = (carried + seg_len) % step_m
    return points


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="ahrtal-2021")
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    # Raw data lives per AOI. Resolved here rather than in the argparse
    # default, which runs before the config is known.
    args.out = args.out or raw_dir("osm", cfg["id"])
    bbox = bbox_tuple(cfg)
    # OpenStreetMap often carries the generic in the name — "Fiume Senio", not "Senio" — so the
    # tag to match on is its own field. `name` stays the human label used in the interface.
    # ⚠️ This used to read cfg["river"]["name"], and osmWaterwayRef was never read at all. That
    # went unnoticed because the Ahr's two values are identical.
    river_cfg = cfg["river"]
    ref = river_cfg.get("osmWaterwayRef") or river_cfg["name"]
    if not river_cfg.get("osmWaterwayRef"):
        print(f"  note: river.osmWaterwayRef is not set, matching on river.name '{ref}'")

    # A centreline can be more than one named reach, and need not be tagged `river`.
    #
    # The Ahr is one name, one tag, and both assumptions were baked in. The Steinbach corridor is
    # neither: the dam discharges into the Steinbach, which becomes the Orbach at Schweinheim, and
    # OpenStreetMap tags both `waterway=stream` because they are a few metres wide. Matching only
    # `river` found nothing and the run stopped, correctly — the reach exists, the filter was too
    # narrow. Names are matched in the order given, which is also the downstream order.
    river_names = [ref] if isinstance(ref, str) else list(ref)
    kinds = set(river_cfg.get("osmWaterwayTypes") or ["river"])
    step_m = float(cfg["river"]["chainageStepM"])

    label = " → ".join(river_names)
    print(f"AOI {cfg['id']}  bbox(S,W,N,E)={bbox}  river={label}  kinds={sorted(kinds)}  step={step_m} m")
    print("querying Overpass...")
    result = overpass(build_query(bbox, river_names[0]))
    elements = result.get("elements", [])
    print(f"  {len(elements)} ways returned")

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "overpass_raw.json").write_text(json.dumps(result), encoding="utf-8")

    # ⚠️ Is this answer even about the right place?
    #
    # A mirror can return a truncated result without erroring. Castel Bolognese did exactly that
    # on 2026-07-31: 1 way instead of 2,396, and the one way was named "Am Rechberg" — a German
    # name, hundreds of kilometres from an Italian bbox. The name filter below then matched
    # nothing and the run stopped with "fix river.osmWaterwayRef", which is a message about the
    # config, and the config was already correct. Re-running succeeded unchanged.
    #
    # A named-waterway query over a populated 12 x 13 km box returns thousands of ways. Tens means
    # the response is suspect, and saying so is the difference between re-running and editing a
    # file that was never wrong.
    if len(elements) < 50:
        raise SystemExit(
            f"\nOverpass returned only {len(elements)} ways for a {label} query over this bbox.\n"
            f"  That is implausibly few for a populated AOI and usually means a truncated or\n"
            f"  mirrored-to-the-wrong-place response rather than a configuration error.\n"
            f"  Sample of what came back: "
            f"{sorted({e.get('tags', {}).get('name') for e in elements if e.get('tags', {}).get('name')})[:5]}\n"
            f"  Re-run before changing config/aoi/{cfg['id']}.json."
        )

    # Stitched per name, in the order given, so the chainage runs continuously from the first
    # reach into the next rather than being reordered by whatever Overpass returned first.
    river_ways = []
    for name in river_names:
        reach = [
            e
            for e in elements
            if e.get("tags", {}).get("waterway") in kinds and e.get("tags", {}).get("name") == name
        ]
        print(f"  {len(reach):>3} ways named '{name}'")
        river_ways.extend(reach)

    # ⚠️ Stop here rather than writing an empty centreline.
    #
    # Matching zero ways is not a thin result, it is a broken one: every downstream step —
    # chainage, connectivity, per-building depth — reads this file and produces a confident,
    # empty answer from it. Castel Bolognese found zero because OpenStreetMap calls the river
    # "Fiume Senio" and the config said "Senio", and the run reported it in one line among ten
    # and exited successfully. A name mismatch has to be loud, because the alternative is a
    # twin where nothing floods and nothing says why.
    if not river_ways:
        present = sorted(
            {
                f"{e['tags']['name']} ({e['tags'].get('waterway')})"
                for e in elements
                if e.get("tags", {}).get("name")
            }
        )
        raise SystemExit(
            f"\nNo way named {river_names} is tagged {sorted(kinds)} inside this AOI.\n"
            f"  Named waterways actually present: {present or '(none)'}\n"
            f"  Fix river.osmWaterwayRef in config/aoi/{cfg['id']}.json to one of those, or set\n"
            f"  river.osmWaterwayTypes if the reach is a stream or canal. Refusing to write an\n"
            f"  empty centreline."
        )

    line = stitch_centreline(river_ways)
    raw_km = (
        sum(haversine_m(*a, *b) for a, b in zip(line, line[1:])) / 1000 if len(line) > 1 else 0
    )
    print(f"  stitched: {len(line)} vertices, {raw_km:.2f} km (includes geometry outside the AOI)")

    line = clip_to_bbox(line, bbox)
    length_km = (
        sum(haversine_m(*a, *b) for a, b in zip(line, line[1:])) / 1000 if len(line) > 1 else 0
    )
    print(f"  clipped to AOI: {len(line)} vertices, {length_km:.2f} km")

    chainage = resample(line, step_m)
    print(f"  chainage points at {step_m:.0f} m: {len(chainage)}")

    payload = {
        "aoi": cfg["id"],
        "river": label,
        "stepM": step_m,
        "lengthKm": round(length_km, 3),
        "attribution": "© OpenStreetMap contributors (ODbL)",
        "points": chainage,
    }
    target = args.out / "river_chainage.json"
    target.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"\nwrote {target} ({target.stat().st_size / 1024:.0f} KB)")

    counts: dict[str, int] = {}
    for e in elements:
        tags = e.get("tags", {})
        key = (
            "river"
            if tags.get("waterway") == "river"
            else "stream"
            if tags.get("waterway") == "stream"
            else "bridge"
            if tags.get("bridge")
            else "railway"
            if tags.get("railway")
            else "road"
            if tags.get("highway")
            else "other"
        )
        counts[key] = counts.get(key, 0) + 1
    print(f"  context features: {counts}")


if __name__ == "__main__":
    main()
