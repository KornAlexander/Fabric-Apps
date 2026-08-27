"""WGS84 <-> UTM conversion, without a projection library.

Standard Transverse Mercator on the GRS80/WGS84 ellipsoid (Krüger series, 6th order), which is
what the EPSG:258xx family uses. Accurate to a few millimetres across a UTM zone — far beyond what
a 1 m terrain grid needs.

Implemented here rather than pulled in as a dependency: `pyproj` ships large binary wheels, and
this repo is destined for public packaging (PLAN §14 Q6), so the fewer heavy dependencies the
better. This is the only projection maths the project needs.

⚠️ This was zone 32 only, and the zone was a module constant. That was true of every AOI while they
were all German and Italian, and it silently stopped being true at Horta Sud: Valencia sits at
-0.5°E, which is **zone 30**, and projecting it with a 9°E central meridian puts it roughly 800 km
from where it is. Nothing would have raised — the numbers are all finite and plausible. The series
maths below is entirely zone-independent; only the central meridian ever was.
"""

from __future__ import annotations

import math

# GRS80 / WGS84 ellipsoid
_A = 6378137.0
_F = 1 / 298.257222101
_E2 = _F * (2 - _F)
_N = _F / (2 - _F)

_K0 = 0.9996
_FALSE_EASTING = 500000.0
_FALSE_NORTHING = 0.0  # northern hemisphere

#: The zone this project started with, and the default everywhere for backwards compatibility.
UTM_ZONE = 32


def zone_for_lon(lon: float) -> int:
    """The UTM zone a longitude falls in. 1..60, six degrees each, zone 1 starting at 180°W.

    Derived rather than configured on purpose: a zone written into a config can disagree with the
    bbox it sits next to, and the failure is silent.
    """
    return int((lon + 180) // 6) + 1


def epsg_for_zone(zone: int) -> str:
    """ETRS89 / UTM northern-hemisphere code for a zone — 25832 for 32, 25830 for 30."""
    return f"EPSG:{25800 + zone}"


def _lon_origin(zone: int) -> float:
    """Central meridian of a zone, in radians. Zone 32 -> 9°E, zone 30 -> -3°E."""
    return math.radians(6 * zone - 183)

# Meridional arc coefficients
_A_BAR = _A / (1 + _N) * (1 + _N**2 / 4 + _N**4 / 64)
_ALPHA = (
    _N / 2 - 2 / 3 * _N**2 + 5 / 16 * _N**3,
    13 / 48 * _N**2 - 3 / 5 * _N**3,
    61 / 240 * _N**3,
)
_BETA = (
    _N / 2 - 2 / 3 * _N**2 + 37 / 96 * _N**3,
    1 / 48 * _N**2 + 1 / 15 * _N**3,
    17 / 480 * _N**3,
)
_DELTA = (
    2 * _N - 2 / 3 * _N**2 - 2 * _N**3,
    7 / 3 * _N**2 - 8 / 5 * _N**3,
    56 / 15 * _N**3,
)


def wgs84_to_utm(lon: float, lat: float, zone: int = UTM_ZONE) -> tuple[float, float]:
    """Return (easting, northing) in metres for the given UTM zone."""
    phi = math.radians(lat)
    lam = math.radians(lon) - _lon_origin(zone)

    t = math.sinh(math.atanh(math.sin(phi)) - 2 * math.sqrt(_N) / (1 + _N) * math.atanh(2 * math.sqrt(_N) / (1 + _N) * math.sin(phi)))
    xi = math.atan(t / math.cos(lam))
    eta = math.atanh(math.sin(lam) / math.sqrt(1 + t * t))

    easting = _K0 * _A_BAR * eta
    northing = _K0 * _A_BAR * xi
    for j, alpha in enumerate(_ALPHA, start=1):
        easting += _K0 * _A_BAR * alpha * math.cos(2 * j * xi) * math.sinh(2 * j * eta)
        northing += _K0 * _A_BAR * alpha * math.sin(2 * j * xi) * math.cosh(2 * j * eta)

    return easting + _FALSE_EASTING, northing + _FALSE_NORTHING


def utm_to_wgs84(easting: float, northing: float, zone: int = UTM_ZONE) -> tuple[float, float]:
    """Return (lon, lat) in degrees from UTM coordinates in the given zone."""
    xi = (northing - _FALSE_NORTHING) / (_K0 * _A_BAR)
    eta = (easting - _FALSE_EASTING) / (_K0 * _A_BAR)

    xi_p = xi
    eta_p = eta
    for j, beta in enumerate(_BETA, start=1):
        xi_p -= beta * math.sin(2 * j * xi) * math.cosh(2 * j * eta)
        eta_p -= beta * math.cos(2 * j * xi) * math.sinh(2 * j * eta)

    chi = math.asin(math.sin(xi_p) / math.cosh(eta_p))
    phi = chi
    for j, delta in enumerate(_DELTA, start=1):
        phi += delta * math.sin(2 * j * chi)

    lam = math.atan(math.sinh(eta_p) / math.cos(xi_p))
    return math.degrees(lam + _lon_origin(zone)), math.degrees(phi)


def bbox_to_utm(
    west: float, south: float, east: float, north: float, zone: int = UTM_ZONE
) -> tuple[float, float, float, float]:
    """Project a geographic bbox, taking the envelope of all four corners.

    The corners are used rather than just SW/NE because a geographic rectangle is not a rectangle
    in UTM — the top and bottom edges bow. Taking the envelope guarantees full coverage.
    """
    corners = [
        wgs84_to_utm(west, south, zone),
        wgs84_to_utm(east, south, zone),
        wgs84_to_utm(west, north, zone),
        wgs84_to_utm(east, north, zone),
    ]
    eastings = [c[0] for c in corners]
    northings = [c[1] for c in corners]
    return min(eastings), min(northings), max(eastings), max(northings)


# ── zone-32 names, kept so the fifteen existing callers need no change ──────────────────────────


def wgs84_to_utm32(lon: float, lat: float) -> tuple[float, float]:
    """Return (easting, northing) in metres, EPSG:25832."""
    return wgs84_to_utm(lon, lat, 32)


def utm32_to_wgs84(easting: float, northing: float) -> tuple[float, float]:
    """Return (lon, lat) in degrees from EPSG:25832 coordinates."""
    return utm_to_wgs84(easting, northing, 32)


def bbox_to_utm32(
    west: float, south: float, east: float, north: float
) -> tuple[float, float, float, float]:
    """Project a geographic bbox into EPSG:25832, as the envelope of its four corners."""
    return bbox_to_utm(west, south, east, north, 32)
