"""Server-side readers for the same open sources the map draws from.

⚠️ THE ONE RULE FROM `src/live/` APPLIES HERE UNCHANGED: nothing in this module may invent a
value. If a source is unreachable the tool says so and returns no rows. There is no sample data,
no last-known replay and no plausible filler anywhere in this service, because the entire point of
putting an agent in front of four data owners is that what it says is what the source published.

⚠️ THESE CALLS RUN SERVER-SIDE, SO CORS DOES NOT APPLY. The browser needs a relay for ADS-B and
the Umweltbundesamt; this process does not. It still goes through the *same* canonical hosts, so
an answer in the chat and a shape on the map come from one place.
"""

from __future__ import annotations

import threading
import time
from typing import Any

import httpx

#: Landeshauptstadt München, offene Daten. Same layer the map uses.
WFS_URL = "https://geoportal.muenchen.de/geoserver/mor_wfs/ows"
BAUSTELLEN_TYPE = "mor_wfs:baustellen_opendata"
HALTESTELLEN_TYPE = "mor_wfs:oepnv_u_t_b_mvg_neu"

#: ⚠️ `air-data`, WITH A HYPHEN, ON THE `luftdaten` SUBDOMAIN. The widely documented
#: `www.umweltbundesamt.de/api/air_data/v3` answers 301 to this host. Tools that follow redirects
#: hide the move; anything that refuses them reports a confusing failure instead.
UBA_BASE = "https://luftdaten.umweltbundesamt.de/api/air-data/v3"

ADSB_BASE = "https://api.adsb.lol/v2/point"

#: How long a fetched payload may be reused.
#:
#: ⚠️ THE CATALOGUE NUMBER IS MEASURED, NOT GUESSED. On 2026-09-21 the Umweltbundesamt's station
#: catalogue answered in **59.9 seconds** for 110 KB while every other call that minute returned
#: inside 200 ms. It also barely changes: stations are commissioned and retired over years.
CACHE_SECONDS = {
    "baustellen": 600,
    "haltestellen": 3600,
    "uba_stations": 6 * 3600,
    "uba_components": 6 * 3600,
    "uba_readings": 120,
    "adsb": 10,
}

_TIMEOUTS = {"uba_stations": 75.0, "uba_components": 75.0}
_DEFAULT_TIMEOUT = 30.0

#: Refuse a response larger than this rather than buffering it.
MAX_BYTES = 8_000_000


class SourceUnavailable(RuntimeError):
    """A source is configured correctly and cannot be reached right now.

    ⚠️ A DIFFERENT ANSWER FROM "YOUR QUESTION WAS WRONG", and the difference is the reason this
    exists. An agent that receives a generic failure reports that something went wrong, and the
    user's sensible response is to reword the question, which cannot help. Saying the source is
    temporarily unreachable tells them to wait, and tells them their question was never answered
    rather than answered with nothing.
    """


_lock = threading.Lock()
_cache: dict[str, tuple[float, Any]] = {}


def _cached(key: str, kind: str, build):
    """Fetch through a small time cache, coalescing nothing (single small service)."""
    ttl = CACHE_SECONDS.get(kind, 60)
    now = time.monotonic()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    value = build()
    with _lock:
        _cache[key] = (now, value)
        # The key space is a handful of shapes; this only guards a pathological caller.
        if len(_cache) > 128:
            oldest = min(_cache, key=lambda k: _cache[k][0])
            _cache.pop(oldest, None)
    return value


def _get_json(url: str, kind: str, params: dict[str, Any] | None = None) -> Any:
    timeout = _TIMEOUTS.get(kind, _DEFAULT_TIMEOUT)
    try:
        with httpx.Client(timeout=timeout, follow_redirects=False) as client:
            response = client.get(
                url,
                params=params,
                headers={
                    "accept": "application/json",
                    "user-agent": "muenchen-zwilling-agent/1.0 (+internal Microsoft demo)",
                },
            )
    except httpx.HTTPError as exc:
        raise SourceUnavailable(f"{kind}: {type(exc).__name__}") from exc

    if response.is_redirect:
        # ⚠️ NOT FOLLOWED ON PURPOSE. A redirect means the endpoint moved, and the honest response
        # is to fail loudly so the constant gets corrected, rather than to quietly call whatever
        # host the previous one now points at.
        raise SourceUnavailable(
            f"{kind}: upstream redirected to {response.headers.get('location', '?')}"
        )
    if response.status_code != 200:
        raise SourceUnavailable(f"{kind}: HTTP {response.status_code}")
    if len(response.content) > MAX_BYTES:
        raise SourceUnavailable(f"{kind}: response too large ({len(response.content)} bytes)")
    try:
        return response.json()
    except ValueError as exc:
        raise SourceUnavailable(f"{kind}: upstream did not return JSON") from exc


# ------------------------------------------------------------------ Landeshauptstadt München


def _wfs(type_name: str, kind: str) -> list[dict[str, Any]]:
    """All features of one WFS layer, in EPSG:25832.

    ⚠️ THE WHOLE LAYER, CACHED, RATHER THAN A BBOX PER QUESTION. The agent asks about streets and
    overlaps, not rectangles, and the city's roadworks layer is a few thousand features. Fetching
    once every ten minutes and filtering in memory is both faster and kinder to the city's server
    than a fresh spatial query per chat turn.
    """

    def build() -> list[dict[str, Any]]:
        data = _get_json(
            WFS_URL,
            kind,
            {
                "service": "WFS",
                "version": "1.1.0",
                "request": "GetFeature",
                "typeName": type_name,
                "outputFormat": "application/json",
            },
        )
        features = data.get("features")
        return features if isinstance(features, list) else []

    return _cached(f"wfs:{type_name}", kind, build)


def baustellen() -> list[dict[str, Any]]:
    """Every current Baumaßnahme and Haltverbot the city publishes."""
    return _wfs(BAUSTELLEN_TYPE, "baustellen")


def haltestellen() -> list[dict[str, Any]]:
    """MVG stops as published by the city."""
    return _wfs(HALTESTELLEN_TYPE, "haltestellen")


# ------------------------------------------------------------------ Umweltbundesamt


def uba_stations() -> dict[str, Any]:
    return _cached(
        "uba:stations",
        "uba_stations",
        lambda: _get_json(
            f"{UBA_BASE}/stations/json", "uba_stations", {"use": "airquality", "lang": "de"}
        ),
    )


def uba_components() -> dict[str, Any]:
    return _cached(
        "uba:components",
        "uba_components",
        lambda: _get_json(f"{UBA_BASE}/components/json", "uba_components", {"lang": "de"}),
    )


def uba_airquality(station: str, date_from: str, hour_from: int, date_to: str, hour_to: int):
    key = f"uba:aq:{station}:{date_from}:{hour_from}:{date_to}:{hour_to}"
    return _cached(
        key,
        "uba_readings",
        lambda: _get_json(
            f"{UBA_BASE}/airquality/json",
            "uba_readings",
            {
                "station": station,
                "date_from": date_from,
                "time_from": hour_from,
                "date_to": date_to,
                "time_to": hour_to,
                "lang": "de",
            },
        ),
    )


# ------------------------------------------------------------------ ADS-B


def adsb(lat: float, lon: float, radius_nm: int) -> dict[str, Any]:
    key = f"adsb:{lat}/{lon}/{radius_nm}"
    return _cached(
        key,
        "adsb",
        lambda: _get_json(f"{ADSB_BASE}/{lat}/{lon}/{radius_nm}", "adsb"),
    )
