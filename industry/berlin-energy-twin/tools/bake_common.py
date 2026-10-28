"""Shared helpers for the Berlin bakes (PLAN §7 Phase 1).

Everything here is boring on purpose: HTTP with retries, the one coordinate
transform Berlin needs (ETRS89 / UTM 33N, EPSG:25833, review B1), and writing
compact JSON with a provenance block. Every baked file says where it came from,
under which licence and when, so the app's attribution and the report can be
generated from the files instead of being typed twice.
"""
from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "data"
CACHE = ROOT / "cache"
UA = "berliner-stadtwerke-zwilling/1.0 (open-data demo bake)"

#: Berlin's official CRS. always_xy so the order is (easting, northing) -> (lon, lat).
_TO_WGS84 = Transformer.from_crs("EPSG:25833", "EPSG:4326", always_xy=True)
_TO_UTM = Transformer.from_crs("EPSG:4326", "EPSG:25833", always_xy=True)

#: Generous box around the city limits. Anything outside is a CRS mix-up, not Berlin (review S10).
BERLIN_BBOX = {"west": 13.05, "east": 13.80, "south": 52.30, "north": 52.70}

DL_DE_ZERO = {"licence": "Datenlizenz Deutschland - Zero - Version 2.0", "url": "https://www.govdata.de/dl-de/zero-2-0"}
DL_DE_BY = {"licence": "Datenlizenz Deutschland - Namensnennung - Version 2.0", "url": "https://www.govdata.de/dl-de/by-2-0"}
ODBL = {"licence": "Open Database License (ODbL) 1.0", "url": "https://www.openstreetmap.org/copyright"}


def utm_to_lonlat(e: float, n: float) -> tuple[float, float]:
    lon, lat = _TO_WGS84.transform(e, n)
    return round(lon, 6), round(lat, 6)


def lonlat_to_utm(lon: float, lat: float) -> tuple[float, float]:
    return _TO_UTM.transform(lon, lat)


def in_berlin(lon: float, lat: float) -> bool:
    b = BERLIN_BBOX
    return b["west"] <= lon <= b["east"] and b["south"] <= lat <= b["north"]


def get(url: str, *, timeout: int = 120, attempts: int = 5, data: bytes | None = None) -> bytes:
    """GET (or POST with `data`) with exponential back-off. Raises after the last attempt."""
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # busy servers answer 5xx, HTML or time out
            last = e
            wait = min(60, 3 * 2**attempt)
            print(f"  {urllib.parse.urlsplit(url).netloc}: {e.__class__.__name__} ({e}), retry in {wait} s")
            time.sleep(wait)
    raise RuntimeError(f"unavailable after {attempts} attempts: {url}: {last}")


def get_json(url: str, **kw) -> dict:
    return json.loads(get(url, **kw))


def wfs_features(service: str, type_name: str, *, page: int = 5000, sort_by: str | None = None) -> list[dict]:
    """All features of a Geoportal Berlin WFS layer, paged with startIndex (review N4). EPSG:25833.

    ⚠️ Paging without `sort_by` is only safe for layers that fit in one page: GeoServer does not
    promise a stable order, and the population layer came back with overlapping pages (3.91 million
    residents instead of 3.70). Multi-page layers must name a unique key to sort by.
    """
    base = f"https://gdi.berlin.de/services/wfs/{service}"
    feats: list[dict] = []
    start = 0
    while True:
        q = urllib.parse.urlencode({
            "service": "WFS", "version": "2.0.0", "request": "GetFeature",
            "typeNames": f"{service}:{type_name}", "outputFormat": "application/json",
            "count": page, "startIndex": start, **({"sortBy": sort_by} if sort_by else {}),
        })
        d = get_json(f"{base}?{q}")
        crs = (d.get("crs") or {}).get("properties", {}).get("name", "")
        if crs and not crs.endswith("25833"):
            raise RuntimeError(f"{service}:{type_name} answered in {crs}, expected EPSG:25833")
        batch = d.get("features", [])
        feats += batch
        if start == 0 and len(batch) == page and not sort_by:
            raise RuntimeError(f"{service}:{type_name} needs more than one page: pass sort_by (stable paging)")
        if len(batch) < page:
            return feats
        start += page


OVERPASS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]


def overpass(query: str) -> dict:
    """One Overpass query, trying the mirrors in turn (they are often at capacity)."""
    last: Exception | None = None
    for attempt in range(3):
        for ep in OVERPASS:
            try:
                print(f"  overpass: {urllib.parse.urlsplit(ep).netloc}", flush=True)
                return json.loads(get(ep, data=urllib.parse.urlencode({"data": query}).encode(), attempts=1, timeout=120))
            except Exception as e:
                last = e
        time.sleep(min(60, 10 * 2**attempt))
    raise RuntimeError(f"overpass unavailable: {last}")


def wfs_filter(service: str, type_name: str, cql: str) -> list[dict]:
    """Features matching a GeoServer CQL filter (vendor parameter), EPSG:25833."""
    q = urllib.parse.urlencode({
        "service": "WFS", "version": "2.0.0", "request": "GetFeature",
        "typeNames": f"{service}:{type_name}", "outputFormat": "application/json", "CQL_FILTER": cql,
    })
    return get_json(f"https://gdi.berlin.de/services/wfs/{service}?{q}").get("features", [])


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def write(name: str, payload: dict, *, source: str, licence: dict, attribution: str, notes: str = "") -> Path:
    """Write public/data/<name> with a provenance block first."""
    OUT.mkdir(parents=True, exist_ok=True)
    doc = {"meta": {"source": source, "attribution": attribution, **licence, "bakedUtc": now_iso(), **({"notes": notes} if notes else {})}, **payload}
    p = OUT / name
    p.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {p.relative_to(ROOT)} ({p.stat().st_size / 1024:.0f} KB)")
    return p
