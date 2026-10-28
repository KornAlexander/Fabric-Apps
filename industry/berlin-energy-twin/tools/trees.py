"""Street and park trees from Berlin's tree register, for the site patches (D31).

WFS `baumbestand` (layers `strassenbaeume`, `anlagenbaeume`; DL-DE-Zero 2.0): one
point per tree with species, planting year, height and crown diameter. Real
trees at their real positions, so no tree is guessed from a surface model as in
the NRW twins.

Two gaps are filled and recorded in the payload meta, not hidden:
  - crown diameter 0 means "not recorded"; such crowns get 0.45 x height for
    broadleaves and 0.3 x height for conifers (typical urban ratios), and
  - the ground height under a tree is taken from the nearest LoD2 buildings'
    own ground heights (inverse-distance), until the DGM1 bake (D21) lands.
"""
from __future__ import annotations

import json
import sys
import urllib.parse
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from bake_common import CACHE, get_json  # noqa: E402

WFS = "https://gdi.berlin.de/services/wfs/baumbestand"
LAYERS = ("strassenbaeume", "anlagenbaeume")
SOURCE = "Geoportal Berlin, Baumbestand (Straßen- und Anlagenbäume), WFS baumbestand; DL-DE-Zero 2.0"

#: Colours of the crown, by the register's own species group (summer canopy).
BROADLEAF_RGB = (92, 124, 64)
CONIFER_RGB = (58, 88, 60)


def fetch(bounds_utm: tuple[float, float, float, float], key: str) -> list[dict]:
    """All register trees in a UTM box, cached per site."""
    cache = CACHE / "trees" / f"{key}.json"
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    x0, y0, x1, y1 = bounds_utm
    out: list[dict] = []
    for layer in LAYERS:
        start = 0
        while True:
            q = urllib.parse.urlencode({
                "SERVICE": "WFS", "VERSION": "2.0.0", "REQUEST": "GetFeature",
                "typeNames": f"baumbestand:{layer}", "outputFormat": "application/json",
                "BBOX": f"{x0},{y0},{x1},{y1},urn:ogc:def:crs:EPSG::25833",
                "count": 5000, "startIndex": start, "sortBy": "gisid",
                "propertyName": "gisid,geom,baumhoehe,kronedurch,art_gruppe",
            })
            feats = get_json(f"{WFS}?{q}")["features"]
            for f in feats:
                x, y = f["geometry"]["coordinates"][:2]
                pr = f["properties"]
                out.append({"x": x, "y": y, "h": pr.get("baumhoehe"), "c": pr.get("kronedurch"), "g": pr.get("art_gruppe") or ""})
            if len(feats) < 5000:
                break
            start += 5000
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(out), encoding="utf-8")
    return out


def ground_from_buildings(tx: np.ndarray, ty: np.ndarray, bx: np.ndarray, by: np.ndarray, bz: np.ndarray) -> np.ndarray:
    """Inverse-distance ground height from the 4 nearest building ground points."""
    z = np.empty(len(tx))
    for i in range(0, len(tx), 2000):  # chunks keep the distance matrix small
        dx = tx[i:i + 2000, None] - bx[None, :]
        dy = ty[i:i + 2000, None] - by[None, :]
        d = np.hypot(dx, dy)
        k = min(4, d.shape[1])
        near = np.argpartition(d, k - 1, axis=1)[:, :k]
        dn = np.take_along_axis(d, near, axis=1) + 1.0
        w = 1.0 / dn**2
        z[i:i + 2000] = (bz[near] * w).sum(axis=1) / w.sum(axis=1)
    return z


def crown_and_colour(t: dict) -> tuple[float, float, tuple[int, int, int], bool]:
    """(height m, crown radius m, rgb, estimated?) for one register record."""
    conifer = "Nadel" in t["g"]
    h = float(t["h"] or 0)
    c = float(t["c"] or 0)
    estimated = c <= 0
    if estimated:
        c = h * (0.3 if conifer else 0.45)
    return h, c / 2, CONIFER_RGB if conifer else BROADLEAF_RGB, estimated
