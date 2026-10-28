"""
Turn Berlin LoD2 CityGML into a compact mesh the browser can draw, with each
building's roof colour measured from the TrueDOP 2025 orthophoto
(PLAN §7 Phase 2, D26). Ported from the SWS twin's LGL version.

Why this rather than flat extruded footprints: LoD2 carries the actual roof
shape - gables, hips, the Plattenbau's flat roofs with their stair towers - and
boxes with flat tops would look like a different city. In the site patches the
app drapes the patch's photo over the roofs themselves; the measured colour is
what a roof shows where no photo covers it.

Berlin facts this relies on (probed on LoD2_387_5807, 2026-10-27): CityGML 1.0,
`ETRS89_UTM33*DE_DHHN2016_NH` (the same height system as DGM1), Roof/Wall/
Ground/Closure semantics on every building, no Appearance of its own, 1 km Atom
tiles `LoD2_<E>_<N>.zip`, empty ZIPs of about 660 bytes outside the border.

Three things this does that a naive converter does not:

  1. **Splits surfaces by semantics.** Roofs are emitted after walls and ground
     per building, so the client can colour them differently from one buffer.
     It also skips `lod2TerrainIntersection`, the polyline where a building meets
     the ground: fan-triangulating that produced 59 % of the triangles in an
     earlier port, all of them degenerate slivers.
  2. **Measures roof colour** from the TrueDOP mosaic instead of inventing one.
     Nothing is invented that could have been measured.
  3. **Classifies walls** from the cadastre's own function code plus measured
     size. The class is evidence; the colour attached to it is convention, and
     is labelled as such in the app.

Coordinates are emitted as metres east/north of an origin, in Web Mercator
metres - the units MapLibre works in - so the client needs one matrix and no
projection maths. Absolute height is kept: the terrain underneath is real, and
a building placed at a made-up height floats or sinks.
"""
from __future__ import annotations

import argparse
import json
import math
import struct
import sys
import zipfile
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree as ET

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
import dgm  # noqa: E402
import trees as tree_register  # noqa: E402
from aoi import load_aoi, to_wgs  # noqa: E402
from bake_common import CACHE, get  # noqa: E402

Image.MAX_IMAGE_PIXELS = None

LOD2_CACHE = CACHE / "lod2"
LOD2_ATOM = "https://gdi.berlin.de/data/a_lod2/atom/LoD2_{e}_{n}.zip"

NS = {
    "bldg": "http://www.opengis.net/citygml/building/1.0",
    "gml": "http://www.opengis.net/gml",
}
B = f"{{{NS['bldg']}}}"
G = f"{{{NS['gml']}}}"

# --- wall classes ---------------------------------------------------------
# ALKIS function codes as in the SWS port. Berlin's hero tile (LoD2_387_5807) is
# 31001_1010 residential (261 of 544), 31001_2463 garages (140), 51009_1610
# roofed structures (46): the size rule below already sends garages and car-port
# roofs to "utility", whatever their code.
RENDER, UTILITY, CIVIC, COMMERCIAL, SACRED = 0, 1, 2, 3, 4
WALL_NAMES = ["render", "utility", "civic", "commercial", "sacred"]

CIVIC_CODES = {
    "31001_3010",  # public administration - Statistisches Landesamt, Gesundheitsamt
    "31001_3021",  # school
    "31001_3020",
    "31001_3023", "31001_3024",  # university (present in other BW cities)
    "31001_3036",  # culture - Kultur- und Kongresszentrum
    "31001_3044",  # church-affiliated - Johannes-Brenz-Schule
    "31001_3051", "31001_3052",  # hospital, clinic
    "31001_3065",  # kindergarten
    "31001_3071", "31001_3072",  # police, fire station
    "31001_3210", "31001_3211",  # sport
    "31001_2140",  # Polizeirevier
    "31001_2020",  # office/administration - Universität Stuttgart sits here
}
SACRED_CODES = {"31001_3041", "31001_3042", "31001_3043", "31001_3048"}
COMMERCIAL_CODES = {
    "31001_1123",  # residential + commercial - Gerber, Milaneo
    "31001_2050",  # commercial - Börse, Mittnachtbau
    "31001_2071",  # hotel/tower - Cloud No.7, Turm am Mailänder Platz
    "31001_2111", "31001_2112", "31001_2120",
    "31001_1122", "31001_1131",
}


def wall_class(code: str, footprint_m2: float, height_m: float) -> int:
    """Size overrules the code, because the code lies about small things.

    31001_2463 is 6 501 of the buildings here at a median 31 m2 and 3.1 m: those
    are garages and bin stores, not the "commercial" the code family suggests.
    A garage painted like an office block is what a viewer notices first.
    """
    if code in SACRED_CODES:
        return SACRED
    if footprint_m2 < 60 and height_m < 6:
        return UTILITY
    if code in CIVIC_CODES:
        return CIVIC
    if code in COMMERCIAL_CODES:
        return COMMERCIAL
    if height_m > 35:  # a tower is glass and concrete whatever the code says
        return COMMERCIAL
    return RENDER


# --- roof colour ----------------------------------------------------------
# Constants carried over from the Gleitschirm/Campus work; each one is a scar.
TARGET_VALUE = 0.56       # re-centre brightness after removing the aerial's sun
VALUE_RETENTION = 0.70    # how much real brightness spread survives
SATURATION_GAIN = 2.0     # undo haze and JPEG chroma loss - multiplicative
SATURATION_CAP = 0.60
MIN_ROOF_PIXELS = 6


def measure_roof_colour(
    pixels: np.ndarray, population_value: float
) -> tuple[int, int, int] | None:
    """Median roof colour with the photograph's sun taken back out."""
    if len(pixels) < MIN_ROOF_PIXELS:
        return None
    r, g, b = pixels[:, 0].astype(float), pixels[:, 1].astype(float), pixels[:, 2].astype(float)
    # Vegetation: a tree overhanging a roof is not the roof.
    keep = ~((g > r + 8) & (g > b + 8))
    if keep.sum() < MIN_ROOF_PIXELS:
        return None
    r, g, b = r[keep], g[keep], b[keep]
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    lo, hi = np.percentile(lum, [20, 80])
    band = (lum >= lo) & (lum <= hi)
    if band.sum() >= MIN_ROOF_PIXELS:
        r, g, b = r[band], g[band], b[band]
    med = np.array([np.median(r), np.median(g), np.median(b)]) / 255.0

    mx, mn = med.max(), med.min()
    v = mx
    s = 0.0 if mx <= 0 else (mx - mn) / mx
    if mx == mn:
        h = 0.0
    elif mx == med[0]:
        h = (60 * ((med[1] - med[2]) / (mx - mn)) + 360) % 360
    elif mx == med[1]:
        h = 60 * ((med[2] - med[0]) / (mx - mn)) + 120
    else:
        h = 60 * ((med[0] - med[1]) / (mx - mn)) + 240

    v = TARGET_VALUE + (v - population_value) * VALUE_RETENTION
    s = min(s * SATURATION_GAIN, SATURATION_CAP)
    v *= 1.0 - 0.22 * s  # a strongly coloured roof is a dark roof
    v = min(max(v, 0.12), 0.95)

    c = v * s
    x = c * (1 - abs(((h / 60) % 2) - 1))
    m = v - c
    seg = int(h // 60) % 6
    rgb = [(c, x, 0), (x, c, 0), (0, c, x), (0, x, c), (x, 0, c), (c, 0, x)][seg]
    return tuple(int(round((ch + m) * 255)) for ch in rgb)  # type: ignore[return-value]


# --- geometry -------------------------------------------------------------
def ring_coords(poly: ET.Element) -> list[tuple[float, float, float]]:
    ext = poly.find(f"{G}exterior")
    if ext is None:
        return []
    pl = ext.find(f".//{G}posList")
    if pl is not None and pl.text:
        v = [float(t) for t in pl.text.split()]
        pts = [(v[i], v[i + 1], v[i + 2]) for i in range(0, len(v) - 2, 3)]
    else:
        pts = []
        for p in ext.iter(f"{G}pos"):
            if p.text:
                v = [float(t) for t in p.text.split()]
                if len(v) >= 3:
                    pts.append((v[0], v[1], v[2]))
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    return pts


def surfaces_of(building: ET.Element, tag: str) -> list[list[tuple[float, float, float]]]:
    out = []
    for surf in building.iter(f"{B}{tag}"):
        for poly in surf.iter(f"{G}Polygon"):
            pts = ring_coords(poly)
            if len(pts) >= 3:
                out.append(pts)
    return out


def area_xy(pts) -> float:
    a = 0.0
    for i in range(len(pts)):
        x1, y1, _ = pts[i]
        x2, y2, _ = pts[(i + 1) % len(pts)]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2.0


def px_of(entry: dict, lon: np.ndarray, lat: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """lon/lat -> pixel in a mercator-aligned mosaic (linear in mercator)."""
    bd = entry["bounds"]
    w, h = entry["fullPx"]

    def merc_y(deg):
        return math.log(math.tan(math.pi / 4 + math.radians(deg) / 2))

    y0, y1 = merc_y(bd["north"]), merc_y(bd["south"])
    px = (lon - bd["west"]) / (bd["east"] - bd["west"]) * w
    my = np.log(np.tan(np.pi / 4 + np.radians(lat) / 2))
    py = (my - y0) / (y1 - y0) * h
    return px, py


class Site:
    """What one site patch collects while the tiles are parsed (D29)."""

    def __init__(self, patch) -> None:
        self.patch = patch
        self.verts_x: list[float] = []
        self.verts_y: list[float] = []
        self.verts_z: list[float] = []
        self.index_rows: list[dict] = []
        self.roofs: list[list[list[tuple[float, float, float]]]] = []
        self.codes: Counter[str] = Counter()
        self.walls: Counter[int] = Counter()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="public/data")
    ap.add_argument("--no-colour", action="store_true")
    args = ap.parse_args()
    out = Path(args.out)

    aoi = load_aoi()
    patches = aoi.building_patches()
    tiles = fetch_tiles([p.utm_bounds() for p in patches])
    sites = {p.id: Site(p) for p in patches}
    skipped_small = 0

    # Pass 1: geometry. Every building goes to the one site patch its centre is
    # in (site patches never overlap: aoi.site_patches merges them).
    for zpath in tiles:
        with zipfile.ZipFile(zpath) as zf:
            for entry in zf.namelist():
                if not entry.lower().endswith((".gml", ".xml")):  # Berlin ships .xml
                    continue
                root = ET.fromstring(zf.read(entry))
                for b in root.iter(f"{B}Building"):
                    grounds = surfaces_of(b, "GroundSurface")
                    roofs = surfaces_of(b, "RoofSurface")
                    walls = surfaces_of(b, "WallSurface")
                    if not roofs and not walls:
                        continue
                    ref = grounds or walls or roofs
                    cx = sum(p[0] for ring in ref for p in ring) / sum(len(r) for r in ref)
                    cy = sum(p[1] for ring in ref for p in ring) / sum(len(r) for r in ref)
                    clon, clat = to_wgs.transform(cx, cy)
                    patch = aoi.patch_of(clon, clat)
                    if patch is None:
                        continue
                    site = sites[patch.id]

                    footprint = sum(area_xy(r) for r in grounds) if grounds else area_xy(walls[0])
                    if footprint < patch.min_footprint:
                        skipped_small += 1
                        continue

                    all_pts = [p for ring in (grounds + walls + roofs) for p in ring]
                    ground_z = min(p[2] for ring in grounds for p in ring) if grounds else min(
                        p[2] for p in all_pts
                    )
                    height = max(p[2] for p in all_pts) - ground_z

                    fn = b.find(f"{B}function")
                    code = (fn.text or "").strip() if fn is not None and fn.text else "(none)"
                    site.codes[code] += 1
                    wcls = wall_class(code, footprint, height)
                    site.walls[wcls] += 1

                    start = len(site.verts_x)

                    def emit(rings, site=site):
                        for ring in rings:
                            # Fan triangulation. LoD2 surfaces are planar and
                            # convex in the overwhelming majority; the few
                            # concave ones cost a sliver, not a wrong building.
                            for i in range(1, len(ring) - 1):
                                for p in (ring[0], ring[i], ring[i + 1]):
                                    site.verts_x.append(p[0])
                                    site.verts_y.append(p[1])
                                    site.verts_z.append(p[2])

                    emit(walls)
                    # GroundSurface is deliberately NOT emitted: it is the floor
                    # slab, permanently buried in the terrain the building sits
                    # on. It is still read above, for the footprint area and the
                    # building's own ground height.
                    roof_start = len(site.verts_x)
                    emit(roofs)
                    site.index_rows.append(
                        {"start": start, "roofStart": roof_start, "end": len(site.verts_x), "wall": wcls, "ground": ground_z, "cx": cx, "cy": cy, "top": ground_z + height}
                    )
                    site.roofs.append(roofs)

    # Pass 2: colour and write, one site at a time. A full 0.2 m mosaic of an
    # estate is half a gigabyte decoded, so only one is ever held in memory.
    aerial = {e["id"]: e for e in json.loads((out / "aerial.json").read_text(encoding="utf-8"))["patches"]}
    manifest_sites = []
    for site in sites.values():
        if not site.index_rows:
            print(f"{site.patch.id}: no buildings")
            continue
        drape = None
        mosaic = CACHE / "aerial" / f"mosaic_{site.patch.id}.jpg"
        if not args.no_colour and mosaic.exists() and site.patch.id in aerial:
            drape = (np.asarray(Image.open(mosaic).convert("RGB")), aerial[site.patch.id])
        manifest_sites.append(write_site(site, drape, out))
        del drape

    write_roof_heights(sites, out)
    (out / "buildings.json").write_text(
        json.dumps(
            {
                "source": SOURCE,
                "attribution": ATTRIBUTION,
                "encoding": "one payload per site: buildings-<id>.json / .bin / _index.bin, each with its own origin",
                "sites": manifest_sites,
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    total = sum(s["bytes"] for s in manifest_sites) / 1e6
    n = sum(s["buildings"] for s in manifest_sites)
    print(f"wrote {len(manifest_sites)} sites, {n} buildings, {total:.1f} MB (small skip {skipped_small})")
    return 0


SOURCE = "Geoportal Berlin, 3D-Gebäudemodelle im Level of Detail 2 (LoD2, CityGML 1.0), Atom a_lod2; DL-DE-Zero 2.0"
ATTRIBUTION = "Geoportal Berlin / 3D-Gebäudemodelle LoD2"


def write_site(site: Site, drape: tuple[np.ndarray, dict] | None, out: Path) -> dict:
    p = site.patch
    n_buildings = len(site.index_rows)
    n_verts = len(site.verts_x)
    ux, uy, uz = np.array(site.verts_x), np.array(site.verts_y), np.array(site.verts_z)
    lon, lat = to_wgs.transform(ux, uy)

    # --- roof colour ------------------------------------------------------
    colours = np.zeros((n_buildings, 4), dtype=np.uint8)
    measured_n = 0
    if drape is not None:
        img, entry = drape
        pop_vals = []
        samples: list[np.ndarray | None] = []
        for roofs in site.roofs:
            px_list = []
            for ring in roofs:
                rlon, rlat = to_wgs.transform(np.array([q[0] for q in ring]), np.array([q[1] for q in ring]))
                x, y = px_of(entry, np.asarray(rlon), np.asarray(rlat))
                px_list.append(np.stack([x, y], axis=1))
            got = sample_polygons(img, px_list)
            samples.append(got)
            if got is not None and len(got) >= MIN_ROOF_PIXELS:
                lum = 0.299 * got[:, 0] + 0.587 * got[:, 1] + 0.114 * got[:, 2]
                pop_vals.append(np.median(lum) / 255.0)
        population_value = float(np.median(pop_vals)) if pop_vals else 0.5
        for i, got in enumerate(samples):
            rgb = measure_roof_colour(got, population_value) if got is not None else None
            if rgb:
                colours[i] = (*rgb, 255)
                measured_n += 1
    med = np.median(colours[colours[:, 3] > 0][:, :3], axis=0) if measured_n else [150, 120, 110]
    for i in range(n_buildings):
        if colours[i][3] == 0:
            colours[i] = (*[int(v) for v in med], 0)

    # --- quantise ---------------------------------------------------------
    # Each site has its own origin, its patch centre: int16 quarter metres of
    # mercator reach 8 km, about 5 km of ground here, and Berlin's sites lie up
    # to 30 km apart.
    origin_lon = (p.west + p.east) / 2
    origin_lat = (p.south + p.north) / 2

    # Stored as WEB MERCATOR metres from the origin, not ground metres: those are
    # exactly linear in MapLibre's coordinate space, so the client needs one
    # constant scale and no per-vertex projection.
    R = 6378137.0
    x0 = math.radians(origin_lon) * R
    y0 = math.log(math.tan(math.pi / 4 + math.radians(origin_lat) / 2)) * R
    ex = np.radians(np.asarray(lon, dtype=np.float64)) * R - x0
    ny = np.log(np.tan(np.pi / 4 + np.radians(np.asarray(lat, dtype=np.float64)) / 2)) * R - y0

    z_base = float(np.floor(uz.min()))
    STEP = 0.25
    qx = np.round(ex / STEP).astype(np.int32)
    qy = np.round(ny / STEP).astype(np.int32)
    qz = np.round((uz - z_base) / STEP).astype(np.int32)
    for name, arr in (("x", qx), ("y", qy), ("z", qz)):
        if arr.min() < -32768 or arr.max() > 32767:
            raise SystemExit(f"FATAL: {p.id} {name} out of int16 range: {arr.min()}..{arr.max()}")

    inter = np.empty((n_verts, 3), dtype=np.int16)
    inter[:, 0], inter[:, 1], inter[:, 2] = qx, qy, qz
    stem = f"buildings-{p.id}"
    (out / f"{stem}.bin").write_bytes(inter.tobytes())

    idx = bytearray()
    for row, col in zip(site.index_rows, colours):
        idx += struct.pack(
            "<IIIBBBB", row["start"], row["roofStart"], row["end"], row["wall"], int(col[0]), int(col[1]), int(col[2])
        )
    (out / f"{stem}_index.bin").write_bytes(bytes(idx))

    meta = {
        "aoi": p.id,
        "source": SOURCE,
        "attribution": ATTRIBUTION,
        "buildings": n_buildings,
        "vertexCount": n_verts,
        "origin": {"lon": origin_lon, "lat": origin_lat},
        "quantisation": {"xyScaleM": STEP, "zScaleM": STEP, "zBaseM": z_base},
        "encoding": "interleaved int16 x,y,z in 0.25 m units; x/y are Web Mercator metres from origin, z is height above zBaseM (DHHN2016)",
        "index": "per building: uint32 start, uint32 roofStart, uint32 end, uint8 wall, uint8 r,g,b (16 bytes)",
        "indexStride": 16,
        "wallClasses": WALL_NAMES,
        "wallSpread": {WALL_NAMES[k]: v for k, v in sorted(site.walls.items())},
        "roofColour": {
            "measured": measured_n,
            "total": n_buildings,
            "method": "median of TrueDOP 2025 pixels (0.2 m) inside each LoD2 roof polygon, vegetation rejected, sun normalised",
        },
        "topCodes": site.codes.most_common(12),
    }
    (out / f"{stem}.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    n_trees = write_trees(site, out, x0, y0, z_base, STEP)
    size = (out / f"{stem}.bin").stat().st_size + len(idx)
    print(f"{p.id}: {n_buildings} buildings, {n_verts:,} vertices, {size / 1e6:.1f} MB, roofs measured {measured_n / n_buildings:.1%}, {n_trees} trees")
    return {
        "id": p.id,
        "trees": n_trees,
        "bounds": {"west": p.west, "east": p.east, "south": p.south, "north": p.north},
        "buildings": n_buildings,
        "vertexCount": n_verts,
        "bytes": size,
        "roofMeasured": measured_n,
    }


def write_roof_heights(sites: dict[str, Site], out: Path) -> None:
    """Height of each ranked degewo roof above its own ground, from LoD2 (D33).

    The app draws the roof outline and the open-potential bar as extrusions,
    which MapLibre stands on the terrain; to sit ON the roof they start at the
    roof's height above ground. The match is the LoD2 building whose centre lies
    inside the solar atlas footprint (several parts: the tallest), else the
    nearest centre within 15 m. Unmatched roofs are listed, not guessed.
    """
    from shapely.geometry import Point, shape
    from shapely.ops import transform

    from aoi import to_utm

    ranked = json.loads((out / "sites.json").read_text(encoding="utf-8"))["buildings"]
    rows = [(r, s.patch.id) for s in sites.values() for r in s.index_rows]
    roofs: dict[str, dict] = {}
    unmatched = []
    for b in ranked:
        if not b.get("outline"):
            unmatched.append(b["id"])
            continue
        foot = transform(lambda x, y, z=None: to_utm.transform(x, y), shape(b["outline"]))
        inside = [(r, sid) for r, sid in rows if foot.contains(Point(r["cx"], r["cy"]))]
        if not inside:
            near = [(foot.distance(Point(r["cx"], r["cy"])), r, sid) for r, sid in rows]
            near = [n for n in near if n[0] <= 15]
            inside = [(r, sid) for _, r, sid in sorted(near, key=lambda n: n[0])[:1]]
        if not inside:
            unmatched.append(b["id"])
            continue
        r, sid = max(inside, key=lambda x: x[0]["top"])
        roofs[str(b["id"])] = {"site": sid, "groundM": round(r["ground"], 2), "roofM": round(r["top"] - r["ground"], 2)}
    (out / "roofs.json").write_text(
        json.dumps(
            {
                "source": SOURCE,
                "method": "tallest LoD2 building whose centre lies inside the solar atlas footprint, else nearest within 15 m; roofM is the height of the roof's highest point above the building's own ground",
                "unmatched": unmatched,
                "roofs": roofs,
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    print(f"roof heights: {len(roofs)} matched, {len(unmatched)} unmatched")


TREE_STRIDE = 12


def write_trees(site: Site, out: Path, x0: float, y0: float, z_base: float, step: float) -> int:
    """Register trees of one site in the buildings' own frame (D31): int16 x, y, z
    as the buildings, uint8 height in 0.25 m, uint8 crown radius in 0.125 m, rgb, pad."""
    p = site.patch
    raw = [t for t in tree_register.fetch(p.utm_bounds(), p.id)]
    if not raw:
        return 0
    tx = np.array([t["x"] for t in raw])
    ty = np.array([t["y"] for t in raw])
    lon, lat = to_wgs.transform(tx, ty)
    lon, lat = np.asarray(lon), np.asarray(lat)
    inside = (lon >= p.west) & (lon <= p.east) & (lat >= p.south) & (lat <= p.north)

    # Missing heights take the median of the same species group in this site.
    groups: dict[bool, list[float]] = {True: [], False: []}
    for t in raw:
        if t["h"]:
            groups["Nadel" in t["g"]].append(float(t["h"]))
    median = {k: (float(np.median(v)) if v else 10.0) for k, v in groups.items()}

    bx = np.array([r["cx"] for r in site.index_rows])
    by = np.array([r["cy"] for r in site.index_rows])
    bz = np.array([r["ground"] for r in site.index_rows])
    # Ground from the 1 m DGM1 (D21), the same survey the terrain tiles are made of;
    # the nearest LoD2 ground heights only where the DGM1 has no cell.
    ground = dgm.sample(tx, ty)
    no_dgm = np.isnan(ground)
    if no_dgm.any():
        ground[no_dgm] = tree_register.ground_from_buildings(tx[no_dgm], ty[no_dgm], bx, by, bz)

    R = 6378137.0
    mx = np.radians(lon) * R - x0
    my = np.log(np.tan(np.pi / 4 + np.radians(lat) / 2)) * R - y0
    buf = bytearray()
    heights: list[float] = []
    est_crown = est_height = 0
    for i, t in enumerate(raw):
        if not inside[i]:
            continue
        if not t["h"]:
            t = {**t, "h": median["Nadel" in t["g"]]}
            est_height += 1
        h, r, rgb, estimated = tree_register.crown_and_colour(t)
        if h < 2:
            continue
        est_crown += estimated
        heights.append(h)
        buf += struct.pack(
            "<hhhBBBBBx",
            int(round(mx[i] / step)), int(round(my[i] / step)), int(round((ground[i] - z_base) / step)),
            min(255, int(round(h * 4))), min(255, int(round(r * 8))), *rgb,
        )
    n = len(heights)
    (out / f"trees-{p.id}.bin").write_bytes(bytes(buf))
    (out / f"trees-{p.id}.json").write_text(
        json.dumps(
            {
                "source": tree_register.SOURCE,
                "count": n,
                "stride": TREE_STRIDE,
                "heightStats": {"min": min(heights), "median": float(np.median(heights)), "max": max(heights)} if n else {"min": 0, "median": 0, "max": 0},
                "estimated": {
                    "crown": est_crown,
                    "height": est_height,
                    "method": "crown 0.45 x height (broadleaf) or 0.3 x height (conifer) where the register has none; missing height = median of the species group in this site; ground from the DGM1 1 m cell under the trunk (nearest LoD2 ground heights where it has none)",
                    "groundFromBuildings": int(no_dgm[inside].sum()),
                },
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return n


def fetch_tiles(boxes: list[tuple[float, float, float, float]]) -> list[Path]:
    """Download the 1 km LoD2 tiles under the site boxes once; the cache is reused."""
    LOD2_CACHE.mkdir(parents=True, exist_ok=True)
    want = {
        (e, n)
        for x0, y0, x1, y1 in boxes
        for e in range(int(x0 // 1000), int(x1 // 1000) + 1)
        for n in range(int(y0 // 1000), int(y1 // 1000) + 1)
    }
    for e, n in sorted(want):
        path = LOD2_CACHE / f"LoD2_{e}_{n}.zip"
        if not path.exists():
            path.write_bytes(get(LOD2_ATOM.format(e=e, n=n)))
            print(f"  LoD2_{e}_{n}: {path.stat().st_size / 1e6:.1f} MB")
    return [LOD2_CACHE / f"LoD2_{e}_{n}.zip" for e, n in sorted(want)]


def sample_polygons(drape: np.ndarray, polys: list[np.ndarray]) -> np.ndarray | None:
    """Collect drape pixels inside a building's roof polygons."""
    if not polys:
        return None
    allpts = np.concatenate(polys, axis=0)
    x0 = int(math.floor(allpts[:, 0].min()))
    x1 = int(math.ceil(allpts[:, 0].max()))
    y0 = int(math.floor(allpts[:, 1].min()))
    y1 = int(math.ceil(allpts[:, 1].max()))
    h, w = drape.shape[:2]
    if x1 <= 0 or y1 <= 0 or x0 >= w or y0 >= h:
        return None
    x0, y0 = max(x0, 0), max(y0, 0)
    x1, y1 = min(x1, w), min(y1, h)
    if x1 - x0 < 1 or y1 - y0 < 1:
        return None
    mask = Image.new("L", (x1 - x0, y1 - y0), 0)
    d = ImageDraw.Draw(mask)
    for poly in polys:
        pts = [(float(px - x0), float(py - y0)) for px, py in poly]
        if len(pts) >= 3:
            d.polygon(pts, fill=255)
    m = np.asarray(mask) > 0
    if not m.any():
        return None
    patch = drape[y0:y1, x0:x1]
    return patch[m]


if __name__ == "__main__":
    raise SystemExit(main())
