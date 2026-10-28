"""Areas of interest for the Berlin 3D bakes (PLAN §7 Phase 2, D26-D28).

Same nesting idea as the SWS twin's `fetch_lgl.py`: a coarse orthophoto base over
the whole city (the overview for fly-overs, D27) and sharp site patches on top of
it that also carry LoD2 buildings. Rewritten for Berlin's CRS (EPSG:25833); the
LGL tile grid logic did not travel and is not here.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from pyproj import Transformer

to_utm = Transformer.from_crs("EPSG:4326", "EPSG:25833", always_xy=True)
to_wgs = Transformer.from_crs("EPSG:25833", "EPSG:4326", always_xy=True)

DEFAULT_AOI = Path(__file__).with_name("aoi_berlin.json")


@dataclass(frozen=True)
class Patch:
    id: str
    west: float
    east: float
    south: float
    north: float
    zoom: int
    """Smallest footprint kept, m2."""
    min_footprint: float
    """Orthophoto only - no buildings. The city-wide base would be hundreds of
    megabytes as LoD2, and is seen from far enough that a photo carries it."""
    imagery_only: bool = False
    """Longest side of the SHIPPED jpeg, px. It is also a GPU texture (the roofs
    sample it), so 4096 is the ceiling that every laptop and projector PC takes."""
    ship_px: int = 4096
    """Ground resolution of the source mosaic the roof colours are measured from."""
    source_m: float = 0.2

    def contains(self, lon: float, lat: float) -> bool:
        return self.west <= lon <= self.east and self.south <= lat <= self.north

    def utm_bounds(self) -> tuple[float, float, float, float]:
        return _utm_bounds(self.west, self.east, self.south, self.north)


@dataclass(frozen=True)
class Aoi:
    id: str
    patches: tuple[Patch, ...]

    def patch_of(self, lon: float, lat: float) -> Patch | None:
        """The most detailed building patch covering this point (highest zoom wins)."""
        best: Patch | None = None
        for p in self.patches:
            if p.imagery_only or not p.contains(lon, lat):
                continue
            if best is None or p.zoom > best.zoom:
                best = p
        return best

    def building_patches(self) -> list[Patch]:
        return [p for p in self.patches if not p.imagery_only]


def _utm_bounds(west: float, east: float, south: float, north: float) -> tuple[float, float, float, float]:
    """Axis-aligned UTM bounds that certainly contain the lon/lat box.

    All four corners: the graticule is rotated against UTM 33 (about 1.3 degrees at
    13.35 E), so projecting only SW and NE clips a sliver off one side.
    """
    xs, ys = [], []
    for lon in (west, east):
        for lat in (south, north):
            x, y = to_utm.transform(lon, lat)
            xs.append(x)
            ys.append(y)
    return min(xs), min(ys), max(xs), max(ys)


def _box_around(lon: float, lat: float, half_m: float) -> tuple[float, float, float, float]:
    x, y = to_utm.transform(lon, lat)
    w, s = to_wgs.transform(x - half_m, y - half_m)
    e, n = to_wgs.transform(x + half_m, y + half_m)
    return w, s, e, n


def _grow(b: tuple[float, float, float, float], m: float) -> tuple[float, float, float, float]:
    x0, y0, x1, y1 = _utm_bounds(b[0], b[2], b[1], b[3])
    w, s = to_wgs.transform(x0 - m, y0 - m)
    e, n = to_wgs.transform(x1 + m, y1 + m)
    return w, s, e, n


def site_patches(rule: dict, root: Path, explicit: list[Patch]) -> list[Patch]:
    """One patch per named degewo estate and per positioned BVG site (D29), from
    the sites bake, with overlapping boxes merged so no building is in two patches.

    Estates are the outline's box plus a margin, except where the config overrides
    it (Marzahn's outline is the whole Ortsteil, 4.8 x 7.2 km: only the central
    2.5 km are baked, decided 2026-10-27). Depots without an outline get a square
    around their point; Alt-Moabit has no point at all (D18) and is skipped.
    """
    from shapely.geometry import shape  # only the site bake needs shapely

    sites = json.loads((root / rule["from"]).read_text(encoding="utf-8"))
    over = rule.get("overrides", {})
    boxes: list[tuple[list[str], tuple[float, float, float, float], int]] = []
    for e in sites["estates"]:
        if e["kind"] != "named":
            continue
        if e["id"] in over:
            o = over[e["id"]]
            b = _box_around(o["centre"][0], o["centre"][1], o["halfM"])
        else:
            b = _grow(shape(e["outline"]).bounds, rule["estateMarginM"])
        boxes.append(([e["id"]], b, 17))
    for d in sites["depots"]:
        if d["lon"] is None:
            continue
        if d["outline"]:
            b = _grow(shape(d["outline"]).bounds, rule["depotMarginM"])
        else:
            b = _box_around(d["lon"], d["lat"], rule["pointHalfM"])
        boxes.append(([f"bvg-{d['id']}"], b, 18))

    # Every ranked degewo roof gets 3D (decided 2026-10-27): a small box round each
    # one not already inside a patch, so its outline and bar sit on the real roof.
    # A box touching an explicit patch (the hero) is dropped, never merged into
    # it, so the hand-made patches keep their ids and bounds.
    def inside(lon: float, lat: float, b: tuple[float, float, float, float]) -> bool:
        return b[0] <= lon <= b[2] and b[1] <= lat <= b[3]

    def touches(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> bool:
        return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]

    fixed = [(p.west, p.south, p.east, p.north) for p in explicit if not p.imagery_only]
    for r in sites["buildings"]:
        if any(inside(r["lon"], r["lat"], b) for _, b, _ in boxes) or any(inside(r["lon"], r["lat"], b) for b in fixed):
            continue
        b = _box_around(r["lon"], r["lat"], rule["roofHalfM"])
        if any(touches(b, f) for f in fixed):
            continue
        boxes.append(([f"degewo-{r['id']}"], b, 18))

    merged = True
    while merged:
        merged = False
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                (ia, a, za), (ib, b, zb) = boxes[i], boxes[j]
                if a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]:
                    boxes[i] = (ia + ib, (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])), min(za, zb))
                    del boxes[j]
                    merged = True
                    break
            if merged:
                break

    # Ids already hold hyphens, and "+" is unsafe in URLs, so merged ids join with "_".
    return [
        Patch("_".join(ids), round(b[0], 5), round(b[2], 5), round(b[1], 5), round(b[3], 5), z, 0.0, False, 4096, 0.2)
        for ids, b, z in boxes
    ]


def load_aoi(path: Path = DEFAULT_AOI) -> Aoi:
    cfg = json.loads(path.read_text(encoding="utf-8"))
    patches = [
        Patch(
            p["id"], p["west"], p["east"], p["south"], p["north"],
            int(p.get("zoom", 18)),
            float(p.get("minFootprint", 0)),
            bool(p.get("imageryOnly", False)),
            int(p.get("shipPx", 4096)),
            float(p.get("sourceM", 0.2)),
        )
        for p in cfg["patches"]
    ]
    if "sites" in cfg:
        patches += site_patches(cfg["sites"], path.resolve().parents[1], patches)
    return Aoi(cfg["id"], tuple(patches))
