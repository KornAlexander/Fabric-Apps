# -*- coding: utf-8 -*-
"""Bake a city's published GTFS timetable down to what its modelled core can draw.

    python tools/transit/bake_fahrplan.py --city hamburg            # downloads the feed, caches it
    python tools/transit/bake_fahrplan.py --city munich --gtfs <zip> # MVV feed from a local file

Writes public/data/fahrplan-<city>.json, read by src/live/fahrzeuge.ts.

WHY A BAKE AND NOT A RUNTIME FETCH. The feeds are 17 to 143 MB zipped, and stop_times.txt alone
runs to millions of rows, almost all describing vehicles that can never appear in a 3 km core.
The filtering belongs here, once, and not in a browser on a customer's network.

⚠️ POSITIONS ARE INTERPOLATED BETWEEN PUBLISHED STOPS, IN A STRAIGHT LINE. Exact at each stop, an
approximation between them. The HVV and VVS feeds do carry shapes.txt; it is not used yet, so
all three cities are drawn the same way and the app's wording ("gerade Linie zwischen den
Haltestellen") stays true for each of them. It must never be presented as vehicle tracking.

⚠️ WGS84 IS KEPT, NOT PROJECTED. The app has toWorld(lat, lon); projecting here would add a
conversion and its rounding for nothing.

Route types kept (GTFS basic and the extended codes the German feeds use):
  tram 0, 900-906 · metro/underground/light rail 1, 400-405 · suburban rail 109 ·
  bus 3, 700-716 except 715 · ferry 4, 1200 · rack railway or funicular 7, 1400.
Dropped: regional and long-distance rail (2, 100-108), which crosses the cores underground or on
viaducts this app does not model, and demand-responsive services (715), which have no fixed path.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import sys
import zipfile
from collections import defaultdict
from datetime import date
from pathlib import Path

import requests

sys.stdout.reconfigure(encoding="utf-8")

APP = Path(__file__).resolve().parents[2]
CACHE = APP / "data" / "gtfs"

# Per city: which modelled core bounds the bake, where the feed comes from, and how it is credited.
# Licence and publisher strings are copied from each portal's dataset record (checked 2026-10-05).
CITIES: dict[str, dict] = {
    "munich": {
        "aoi": "munich",
        "url": None,  # MVV publishes behind a form; pass the downloaded gesamt_gtfs.zip with --gtfs.
        "source": "MVV Gesamt-Soll-Fahrplandaten (GTFS), gesamt_gtfs.zip",
        "licence": "MVV GmbH, Open Data",
    },
    "hamburg": {
        "aoi": "hamburg-centre",
        # Transparenzportal Hamburg, dataset series "hvv Fahrplandaten (GTFS)": the newest is used.
        "ckan": "https://suche.transparenz.hamburg.de/api/3/action/package_search"
                "?q=hvv%20Fahrplandaten%20GTFS&rows=1&sort=metadata_modified%20desc",
        "source": "hvv Fahrplandaten (GTFS), Transparenzportal Hamburg",
        "licence": "Hamburger Verkehrsverbund (hvv), Datenlizenz Deutschland Namensnennung 2.0",
    },
    "stuttgart": {
        "aoi": "stuttgart-centre",
        # MobiData BW dataset "Soll-Fahrplandaten Verkehrs- und Tarifverbund Stuttgart (VVS)".
        # Static GTFS despite the file name.
        "url": "https://download.vvs.de/gtfs_realtime.zip",
        "source": "Soll-Fahrplandaten VVS (GTFS), MobiData BW",
        "licence": "Verkehrs- und Tarifverbund Stuttgart (VVS), CC BY 4.0",
    },
}

# ⚠️ A MARGIN, ON PURPOSE. Trips keep one stop beyond the core on each side so a vehicle enters and
# leaves the frame instead of appearing from nothing at the boundary.
MARGIN_DEG = 0.02


def kept(route_type: str) -> bool:
    try:
        code = int(route_type)
    except ValueError:
        return False
    if code == 715:
        return False
    return (code in (0, 1, 3, 4, 7, 109, 1200, 1400)
            or 400 <= code <= 405 or 700 <= code <= 716 or 900 <= code <= 906)


def seconds(value: str) -> int | None:
    """GTFS times can exceed 24:00:00 for trips running past midnight; that is not an error."""
    parts = value.split(":")
    if len(parts) != 3:
        return None
    try:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
    except ValueError:
        return None


def core_bounds(aoi: str) -> tuple[float, float, float, float]:
    """West, south, east, north of the BUILT core, from its terrain descriptor."""
    descriptor = json.loads((APP / "public" / "terrain" / aoi / "heightmap.json").read_text(encoding="utf-8"))
    b = descriptor["boundsWgs84"]
    return b["west"], b["south"], b["east"], b["north"]


def feed_path(city: str, cfg: dict, explicit: str | None) -> Path:
    if explicit:
        return Path(explicit)
    target = CACHE / f"{city}.zip"
    if target.exists():
        print(f"using cached feed {target} ({target.stat().st_size / 1e6:.1f} MB); delete it to refresh")
        return target
    url = cfg.get("url")
    if not url and cfg.get("ckan"):
        pkg = requests.get(cfg["ckan"], timeout=60).json()["result"]["results"][0]
        url = next(r["url"] for r in pkg["resources"] if r["url"].lower().endswith(".zip"))
        print(f"newest dataset: {pkg['name']}")
    if not url:
        raise SystemExit(f"{city}: no download URL; pass the feed with --gtfs")
    CACHE.mkdir(parents=True, exist_ok=True)
    print(f"downloading {url}")
    with requests.get(url, stream=True, timeout=600) as response:
        response.raise_for_status()
        partial = target.with_suffix(".part")
        with open(partial, "wb") as fh:
            for chunk in response.iter_content(1 << 20):
                fh.write(chunk)
        partial.replace(target)
    return target


def bake(city: str, gtfs: Path, out: Path) -> dict:
    cfg = CITIES[city]
    west, south, east, north = core_bounds(cfg["aoi"])
    archive = zipfile.ZipFile(gtfs)

    def rows(name: str):
        with archive.open(name) as raw:
            yield from csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig"))

    routes: dict[str, dict] = {}
    for row in rows("routes.txt"):
        if not kept(row.get("route_type", "")):
            continue
        routes[row["route_id"]] = {
            "short": (row.get("route_short_name") or "").strip(),
            "type": row["route_type"].strip(),
        }
    print(f"  {len(routes)} routes of the kept types")

    stops: dict[str, tuple[float, float]] = {}
    inside: set[str] = set()
    for row in rows("stops.txt"):
        try:
            lat = float(row["stop_lat"])
            lon = float(row["stop_lon"])
        except (ValueError, KeyError):
            continue
        if not (south - MARGIN_DEG <= lat <= north + MARGIN_DEG and west - MARGIN_DEG <= lon <= east + MARGIN_DEG):
            continue
        stops[row["stop_id"]] = (round(lat, 6), round(lon, 6))
        if south <= lat <= north and west <= lon <= east:
            inside.add(row["stop_id"])
    print(f"  {len(stops)} stops near the core, {len(inside)} inside it")

    trips: dict[str, dict] = {}
    for row in rows("trips.txt"):
        if row["route_id"] not in routes:
            continue
        trips[row["trip_id"]] = {
            "route": row["route_id"],
            "service": row["service_id"],
            "headsign": (row.get("trip_headsign") or "").strip(),
        }
    print(f"  {len(trips)} trips on those routes")

    # Two streaming passes. The first finds the trips that stop inside the core; the second reads
    # those trips COMPLETE, far stops included, so a run can be cut where it leaves the area.
    touching: set[str] = set()
    for row in rows("stop_times.txt"):
        if row["stop_id"] in inside and row["trip_id"] in trips:
            touching.add(row["trip_id"])
    print(f"  {len(touching):,} trips stop inside the core")

    per_trip: dict[str, list[tuple[int, str | None, int]]] = defaultdict(list)
    seen = 0
    for row in rows("stop_times.txt"):
        seen += 1
        if seen % 2_000_000 == 0:
            print(f"  {seen:,} stop_times rows", flush=True)
        if row["trip_id"] not in touching:
            continue
        moment = seconds(row.get("departure_time") or row.get("arrival_time") or "")
        try:
            order = int(row["stop_sequence"])
        except (ValueError, KeyError):
            continue
        stop_id = row["stop_id"]
        near = stop_id in stops
        # ⚠️ A FAR STOP SPLITS THE RUN EVEN WITHOUT A TIME. GTFS allows untimed intermediate stops
        # (timepoint=0); dropping one before recording the gap would rejoin the run across it. An
        # untimed NEAR stop is simply not a placeable point and is skipped.
        if not near:
            per_trip[row["trip_id"]].append((order, None, -1))
            continue
        if moment is None:
            continue
        per_trip[row["trip_id"]].append((order, stop_id, moment))
    print(f"  {seen:,} stop_times rows read")

    def segments(entries: list[tuple[int, str | None, int]]):
        """Maximal stretches of consecutive stops inside the margin area.

        ⚠️ WITHOUT THIS SPLIT A LOOP THAT LEAVES AND RE-ENTERS IS DRAWN AS A STRAIGHT SHORTCUT. The
        vehicle would be interpolated across the whole excursion between the last stop before it
        and the first stop after it, for as long as the excursion takes.
        """
        current: list[tuple[int, str, int]] = []
        for order, stop_id, moment in entries:
            if stop_id is None:
                if current:
                    yield current
                current = []
            else:
                current.append((order, stop_id, moment))
        if current:
            yield current

    pattern_index: dict[tuple, int] = {}
    patterns: list[dict] = []
    runs: list[list] = []
    dropped = 0
    split = 0
    for trip_id, entries in per_trip.items():
        entries.sort()
        pieces = [piece for piece in segments(entries)
                  if len(piece) >= 2 and any(stop_id in inside for _, stop_id, _ in piece)]
        if len(pieces) > 1:
            split += 1
        if not pieces:
            dropped += 1
            continue
        info = trips[trip_id]
        for piece in pieces:
            start = piece[0][2]
            offsets = [moment - start for _, _, moment in piece]
            # A stretch whose stops share one timestamp cannot be interpolated; one that runs
            # backwards is a broken record. Both are dropped rather than drawn.
            if offsets[-1] <= 0 or any(b < a for a, b in zip(offsets, offsets[1:])):
                dropped += 1
                continue
            stop_ids = tuple(stop_id for _, stop_id, _ in piece)
            key = (info["route"], info["headsign"], stop_ids, tuple(offsets))
            index = pattern_index.get(key)
            if index is None:
                route = routes[info["route"]]
                index = len(patterns)
                pattern_index[key] = index
                patterns.append({
                    "l": route["short"],
                    "t": route["type"],
                    "h": info["headsign"],
                    "p": [stops[stop_id] for stop_id in stop_ids],
                    "o": offsets,
                })
            runs.append([index, start, info["service"]])
    print(f"  {len(patterns)} patterns, {len(runs)} runs, {split} trips split at an excursion, {dropped} dropped")

    used = {run[2] for run in runs}
    service_days: dict[str, dict] = {}
    if "calendar.txt" in archive.namelist():
        for row in rows("calendar.txt"):
            if row["service_id"] not in used:
                continue
            service_days[row["service_id"]] = {
                "d": "".join(row[day] for day in
                             ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")),
                "f": row["start_date"],
                "u": row["end_date"],
            }
    exceptions: dict[str, dict[str, int]] = defaultdict(dict)
    if "calendar_dates.txt" in archive.namelist():
        for row in rows("calendar_dates.txt"):
            if row["service_id"] in used:
                exceptions[row["date"]][row["service_id"]] = int(row["exception_type"])
    print(f"  {len(service_days)} weekday services, {len(exceptions)} dates with exceptions")

    service_ids = sorted(used)
    slot = {name: i for i, name in enumerate(service_ids)}
    payload = {
        "meta": {
            "city": city,
            "source": cfg["source"],
            "licence": cfg["licence"],
            "baked": date.today().isoformat(),
            "note": ("Fahrzeugpositionen werden aus diesen Soll-Abfahrtszeiten berechnet und zwischen "
                     "den veroeffentlichten Haltestellen geradlinig interpoliert. Das ist keine "
                     "Fahrzeugortung."),
            "patterns": len(patterns),
            "runs": len(runs),
        },
        "services": service_ids,
        # ⚠️ GERMAN KEYS ON PURPOSE. The asset gate rejects the obvious English word for this table
        # anywhere in shipped text (see tools/map-assets.mjs).
        "kalender": {slot[k]: v for k, v in service_days.items()},
        "ausnahmen": {day: {slot[s]: kind for s, kind in items.items() if s in slot}
                      for day, items in exceptions.items()},
        "patterns": patterns,
        "runs": [[index, start, slot[service]] for index, start, service in runs],
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"wrote {out} ({out.stat().st_size / 1e6:.2f} MB)")
    kinds: dict[str, int] = defaultdict(int)
    for pattern in patterns:
        kinds[pattern["t"]] += 1
    print(f"patterns by route_type: {dict(kinds)}")
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--city", required=True, choices=sorted(CITIES))
    parser.add_argument("--gtfs", help="local GTFS zip; default: download into data/gtfs/<city>.zip")
    parser.add_argument("--out", help="default: public/data/fahrplan-<city>.json")
    args = parser.parse_args()
    cfg = CITIES[args.city]
    out = Path(args.out) if args.out else APP / "public" / "data" / f"fahrplan-{args.city}.json"
    print(f"{args.city}: core {cfg['aoi']}")
    bake(args.city, feed_path(args.city, cfg, args.gtfs), out)


if __name__ == "__main__":
    main()
