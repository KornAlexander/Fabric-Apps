"""Derive real trees from the difference between the surface and the terrain.

DOM1 minus DGM1 is a normalised height model: at every square metre, how far above the bare earth
the first laser return sits. Vegetation is therefore *measured* here, not invented — each tree in
the app stands where a tree stands, and is as tall as that tree is (PLAN §2.2: the twin shows
data, and says so where it does not).

Two things have to be kept out of the result:

* **Buildings.** A roof is also "above the ground". OSM gives building centroids and footprint
  areas for the settlements, so each one masks a disc of the equivalent radius.
* **Roofs the OSM set does not know about** — barns, isolated houses. These are caught by texture
  instead: a roof is a smooth plane, a crown is rough. The local standard deviation of the height
  model separates them cleanly.

What comes out is a tree list, not a canopy raster: one entry per local maximum of the height
model, which is the classic way to find individual tree tops in a lidar surface.

Usage
  python tools/geodata/build_vegetation.py --dry-run
  python tools/geodata/build_vegetation.py

Attribution: © GeoBasis-DE / LVermGeoRP 2024–2025, dl-de/by-2-0 (DGM1, DOM1) · © OpenStreetMap
contributors, ODbL (building footprints used as a mask).
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import re
import struct
import zlib
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

from aoi import load_aoi, raw_dir, terrain_name
from scipy.spatial import cKDTree

from utm import wgs84_to_utm32

NODATA = -9999.0
TILE_M = 1000
# `_rp_` is Rheinland-Pfalz, `_nw_` North Rhine-Westphalia. Same ADV kilometre grid, same 1 m
# raster; only the state code differs, so one reader serves both.
TILE_RE = re.compile(r"(?:dgm1|dom1)_32_(\d{3})_(\d{4})_1_(?:rp|nw)_(\d{4})\.tif")

# A crown is rough, a roof is a plane. Measured over a 5 m window, canopy sits well above this and
# pitched roofs well below it.
ROUGHNESS_WINDOW = 5
MIN_ROUGHNESS_M = 0.55

# Radii, in metres, at which the canopy is sampled around each tree top to recover the crown's
# shape. The source is 1 m, so these are whole pixels.
RING_RADII = [1, 2, 3, 4, 5, 6, 7, 8]
# Where the crown ends: the radius at which the canopy has fallen to this fraction of the top.
CROWN_EDGE_FRACTION = 0.45
# Crown taper is probed at this fraction of the tree's height out from the apex.
TAPER_PROBE_FRACTION = 0.18
# Below this taper the crown falls away like a cone, which is a conifer. Read off the measured
# distribution, not chosen from a preference about how many spruces the Eifel ought to have.
CONIFER_SHAPE_MAX = 0.62


def ring_offsets(radius: int, samples: int = 16) -> list[tuple[int, int]]:
    """Distinct integer pixel offsets approximating a circle of the given radius."""
    seen: set[tuple[int, int]] = set()
    for k in range(samples):
        angle = 2 * math.pi * k / samples
        seen.add((round(radius * math.sin(angle)), round(radius * math.cos(angle))))
    return sorted(seen)


RING_OFFSETS = {r: ring_offsets(r) for r in RING_RADII}


def canopy_profile(ndom: np.ndarray, rows: np.ndarray, cols: np.ndarray) -> np.ndarray:
    """Mean canopy height on rings around each tree top: one column per radius in RING_RADII."""
    height, width = ndom.shape
    profile = np.zeros((rows.size, len(RING_RADII)), dtype=np.float32)
    for index, radius in enumerate(RING_RADII):
        offsets = RING_OFFSETS[radius]
        total = np.zeros(rows.size, dtype=np.float32)
        for dy, dx in offsets:
            rr = np.clip(rows + dy, 0, height - 1)
            cc = np.clip(cols + dx, 0, width - 1)
            total += ndom[rr, cc]
        profile[:, index] = total / len(offsets)
    return profile


def crown_from_profile(
    profile: np.ndarray, tops: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Recover crown radius and a taper factor from the measured canopy profile.

    The radius is where the canopy falls to CROWN_EDGE_FRACTION of the tree top, interpolated
    between the two rings that straddle it. In a closed stand it often never falls that far,
    because the neighbours hold the canopy up; the caller bounds those cases by the distance to
    the nearest tree, which is the only honest crown width available there.

    The taper is measured at a fixed fraction of the tree's own height rather than of its crown,
    so it does not inherit that saturation. A conifer's canopy has already dropped a long way a
    few metres from the apex; a broadleaf's is still near the top. That is a statement about crown
    form, which correlates with conifer against broadleaf but is not a species identification.
    """
    relative = profile / np.maximum(tops, 1e-3)[:, None]
    radii = np.array(RING_RADII, dtype=np.float32)

    below = relative < CROWN_EDGE_FRACTION
    has_edge = below.any(axis=1)
    first = np.argmax(below, axis=1)

    # Linear interpolation between the last ring above the threshold and the first one below it.
    previous = np.maximum(first - 1, 0)
    index = np.arange(len(first))
    r_lo, r_hi = radii[previous], radii[first]
    v_lo, v_hi = relative[index, previous], relative[index, first]
    span = np.where(np.abs(v_lo - v_hi) < 1e-6, 1e-6, v_lo - v_hi)
    fraction = np.clip((v_lo - CROWN_EDGE_FRACTION) / span, 0.0, 1.0)
    interpolated = r_lo + (r_hi - r_lo) * fraction

    crown = np.where(has_edge, np.where(first > 0, interpolated, radii[0]), radii[-1])

    # Taper, probed at a fixed fraction of the tree's height.
    probe = np.clip(tops * TAPER_PROBE_FRACTION, radii[0], radii[-1])
    taper = np.empty_like(crown)
    for i in range(len(crown)):
        taper[i] = np.interp(probe[i], radii, relative[i])
    return crown.astype(np.float32), np.clip(taper, 0.0, 1.0)


def load_float_tile(path: Path) -> np.ndarray:
    data = np.array(Image.open(path), dtype=np.float32)
    data[data <= NODATA + 1] = np.nan
    return data


def building_mask_discs(buildings_path: Path, origin_e: int, origin_n: int, width_m: int, depth_m: int):
    """Centre and radius, in UTM metres, of every OSM building footprint inside the AOI."""
    payload = json.loads(buildings_path.read_text(encoding="utf-8"))
    centres_e, centres_n, radii = [], [], []
    for b in payload["buildings"]:
        e, n = wgs84_to_utm32(b["lon"], b["lat"])
        if not (origin_e <= e <= origin_e + width_m and origin_n <= n <= origin_n + depth_m):
            continue
        area = float(b.get("footprintM2") or 80.0)
        # Equivalent-area radius, widened because the record is a centroid rather than an outline.
        radii.append(max(4.0, math.sqrt(area / math.pi) * 1.6))
        centres_e.append(e)
        centres_n.append(n)
    return np.array(centres_e), np.array(centres_n), np.array(radii)


#: Land-cover class for open water in `build_landuse.py`. Trees may not stand on it.
WATER_CLASS = 11


def water_mask(out_dir: Path):
    """Where OSM says there is open water, as a boolean grid plus its georeferencing.

    ⚠️ The build masked OSM BUILDING footprints and nothing else, so anything the surface model
    reported as tall over a lake became a tree standing on the lake. Measured before fixing: 698
    trees in the Ahr's water (median 10.1 m) and **290 in the Steinbach reservoir** (median 16.6 m,
    up to 35 m) — in the one scene whose entire subject is that reservoir.

    Water is the right mask and buildings were not enough, because the nDOM cannot tell a crown
    from anything else that stands above the ground return; over water the returns are noise, and
    noise that clears the 3 m threshold is indistinguishable from a small tree.

    Returns None when the AOI has no land cover built, in which case nothing is masked and the run
    says so rather than silently skipping the check.
    """
    meta_path = out_dir / "landuse.json"
    if not meta_path.exists():
        return None
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    blob = (out_dir / meta["file"]).read_bytes()
    raw = gzip.decompress(blob) if meta.get("compression") == "gzip" else zlib.decompress(blob)
    grid = np.frombuffer(raw, dtype=np.uint8).reshape(meta["height"], meta["width"])
    return {
        "is_water": grid == WATER_CLASS,
        "res": meta["resolutionM"],
        "origin_e": meta["origin"]["easting"],
        "origin_n": meta["origin"]["northing"],
        "width_m": meta["width"] * meta["resolutionM"],
        "depth_m": meta["height"] * meta["resolutionM"],
    }


def on_water(mask: dict, east: np.ndarray, north: np.ndarray) -> np.ndarray:
    """Boolean per position: does this point fall on open water?"""
    col = np.clip(
        ((east - mask["origin_e"]) / mask["res"]).astype(int), 0, mask["is_water"].shape[1] - 1
    )
    row = np.clip(
        (((mask["origin_n"] + mask["depth_m"]) - north) / mask["res"]).astype(int),
        0,
        mask["is_water"].shape[0] - 1,
    )
    return mask["is_water"][row, col]


def survey_credit(out_dir: Path) -> tuple[str, str]:
    """Who surveyed the elevation models this AOI's trees were measured from.

    ⚠️ Read from the AOI's own heightmap metadata rather than written in here. Hardcoding it named
    LVermGeo Rheinland-Pfalz for every AOI, so the Steinbach trees — derived from Geobasis NRW's
    models, published under dl-de/zero-2-0 — were credited to the wrong state under the wrong
    licence. That is the third place in this repo the same hardcoded credit had to be removed.
    """
    for path in sorted(out_dir.glob("heightmap_*.json")):
        meta = json.loads(path.read_text(encoding="utf-8"))
        if meta.get("attribution"):
            source = (meta.get("source") or "").replace("DGM1", "DOM1 minus DGM1", 1)
            return source, meta["attribution"]
    raise SystemExit(
        f"no heightmap in {out_dir} carries an attribution, so the trees cannot be credited"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="ahrtal-2021")
    parser.add_argument("--dgm", type=Path, default=None)
    parser.add_argument("--dom", type=Path, default=None)
    parser.add_argument("--buildings", type=Path, default=None)
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--min-height", type=float, default=3.0, help="metres above ground")
    parser.add_argument("--max-height", type=float, default=48.0, help="reject artefacts above this")
    parser.add_argument("--spacing", type=int, default=7, help="minimum metres between tree tops")
    parser.add_argument("--dry-run", action="store_true", help="process a few tiles only")
    args = parser.parse_args()

    # This script had no --aoi at all: the raw inputs were AOI-blind constants and the output was
    # hardcoded to ahrtal-2021, so it could only ever have built one AOI's trees.
    cfg = load_aoi(args.aoi)
    args.dgm = args.dgm or raw_dir("dgm1", cfg["id"])
    args.dom = args.dom or raw_dir("dom1", cfg["id"])
    args.buildings = args.buildings or raw_dir("osm", cfg["id"]) / "buildings.json"
    args.out = args.out or Path("public/terrain") / cfg["id"]

    terrain = json.loads((args.out / f"{terrain_name(cfg)}.json").read_text(encoding="utf-8"))
    origin_e = terrain["origin"]["easting"]
    origin_n = terrain["origin"]["northing"]
    width_m = terrain["width"] * terrain["resolutionM"]
    depth_m = terrain["height"] * terrain["resolutionM"]
    print(f"AOI {width_m} x {depth_m} m from {origin_e} E, {origin_n} N")

    b_e, b_n, b_r = building_mask_discs(args.buildings, origin_e, origin_n, width_m, depth_m)
    print(f"masking {len(b_e)} OSM building footprints")

    water = water_mask(args.out)
    if water is None:
        print("⚠️  no landuse.json — trees will NOT be masked off open water")
    else:
        print(f"masking open water ({100 * water['is_water'].mean():.2f}% of the AOI)")
    dropped_water = 0

    dom_by_key = {}
    for path in args.dom.glob("dom1_32_*.tif"):
        m = TILE_RE.fullmatch(path.name)
        if m:
            dom_by_key[(int(m.group(1)), int(m.group(2)))] = path

    dgm_tiles = sorted(args.dgm.glob("dgm1_32_*.tif"))
    if args.dry_run:
        dgm_tiles = dgm_tiles[:6]
    print(f"processing {len(dgm_tiles)} tiles")

    xs, zs, grounds, heights = [], [], [], []
    radii_out, shapes = [], []
    skipped = 0

    for index, dgm_path in enumerate(dgm_tiles, start=1):
        m = TILE_RE.fullmatch(dgm_path.name)
        if not m:
            continue
        tile_e, tile_n = int(m.group(1)), int(m.group(2))
        dom_path = dom_by_key.get((tile_e, tile_n))
        if dom_path is None:
            skipped += 1
            continue

        ground = load_float_tile(dgm_path)
        surface = load_float_tile(dom_path)
        if ground.shape != surface.shape:
            skipped += 1
            continue

        ndom = surface - ground
        valid = np.isfinite(ndom)
        ndom = np.where(valid, ndom, 0.0)

        tall = valid & (ndom >= args.min_height) & (ndom <= args.max_height)
        if not tall.any():
            continue

        # Local maxima of the canopy: one candidate per `spacing` metre neighbourhood.
        peak = ndimage.maximum_filter(ndom, size=args.spacing, mode="nearest")
        candidates = tall & (ndom >= peak - 1e-3)

        # Roughness separates crowns from roofs.
        mean = ndimage.uniform_filter(ndom, size=ROUGHNESS_WINDOW, mode="nearest")
        mean_sq = ndimage.uniform_filter(ndom * ndom, size=ROUGHNESS_WINDOW, mode="nearest")
        roughness = np.sqrt(np.maximum(mean_sq - mean * mean, 0.0))
        candidates &= roughness >= MIN_ROUGHNESS_M

        rows, cols = np.nonzero(candidates)
        if rows.size == 0:
            continue

        # Tile pixel -> UTM. Row 0 is the north edge, matching build_terrain.py.
        east = tile_e * 1000 + cols + 0.5
        north = tile_n * 1000 + (TILE_M - rows - 0.5)

        inside = (
            (east >= origin_e)
            & (east <= origin_e + width_m)
            & (north >= origin_n)
            & (north <= origin_n + depth_m)
        )
        east, north, rows, cols = east[inside], north[inside], rows[inside], cols[inside]
        if east.size == 0:
            continue

        # Drop anything sitting on a known building.
        if len(b_e):
            near = (
                (b_e >= east.min() - 60)
                & (b_e <= east.max() + 60)
                & (b_n >= north.min() - 60)
                & (b_n <= north.max() + 60)
            )
            if near.any():
                de = east[:, None] - b_e[near][None, :]
                dn = north[:, None] - b_n[near][None, :]
                hit = (de * de + dn * dn) <= (b_r[near][None, :] ** 2)
                keep = ~hit.any(axis=1)
                east, north, rows, cols = east[keep], north[keep], rows[keep], cols[keep]

        if east.size == 0:
            continue

        # Drop anything standing on open water. The building mask cannot catch these: a reservoir
        # has no footprint, and the nDOM over water is noise that clears the height threshold.
        if water is not None:
            dry = ~on_water(water, east, north)
            dropped_water += int((~dry).sum())
            east, north, rows, cols = east[dry], north[dry], rows[dry], cols[dry]

        if east.size == 0:
            continue

        xs.append(east - origin_e - width_m / 2)
        zs.append((origin_n + depth_m) - north - depth_m / 2)
        grounds.append(ground[rows, cols])
        heights.append(ndom[rows, cols])

        # Crown radius and shape, measured from the canopy around each top rather than assumed.
        tops = ndom[rows, cols]
        crown, shape = crown_from_profile(canopy_profile(ndom, rows, cols), tops)
        radii_out.append(crown)
        shapes.append(shape)

        if index % 25 == 0 or index == len(dgm_tiles):
            so_far = sum(a.size for a in xs)
            print(f"  {index}/{len(dgm_tiles)}  {so_far:,} trees so far")

    if skipped:
        print(f"  {skipped} tiles had no matching surface tile and were skipped")

    x = np.concatenate(xs)
    z = np.concatenate(zs)
    g = np.concatenate(grounds)
    h = np.concatenate(heights)
    radius = np.concatenate(radii_out)
    shape = np.concatenate(shapes)
    finite = np.isfinite(g) & np.isfinite(h) & np.isfinite(radius) & np.isfinite(shape)
    x, z, g, h = x[finite], z[finite], g[finite], h[finite]
    radius, shape = radius[finite], shape[finite]
    print(f"\n{len(x):,} trees")
    print(f"  height   {h.min():.1f} .. {h.max():.1f} m, median {np.median(h):.1f} m")
    print(f"  ground   {g.min():.1f} .. {g.max():.1f} m")

    # In a closed stand the canopy never falls to the crown-edge threshold, because the neighbours
    # hold it up, so the profile measurement saturates at the outermost ring. Where that happens
    # the honest crown width is the ground the tree actually has: half the distance to the nearest
    # other tree top. Both are measurements; this just takes whichever one is real.
    tree = cKDTree(np.column_stack([x, z]))
    neighbour = tree.query(np.column_stack([x, z]), k=2)[0][:, 1]
    saturated = radius >= RING_RADII[-1] - 1e-3
    radius = np.where(saturated, np.minimum(radius, neighbour * 0.5), radius)
    radius = np.clip(radius, 1.0, 12.0)

    conifer = shape < CONIFER_SHAPE_MAX
    print(f"  crown r  {radius.min():.1f} .. {radius.max():.1f} m, median {np.median(radius):.1f} m")
    print(f"    bounded by the neighbour rather than the canopy: {saturated.mean() * 100:.1f}%")
    print(f"  taper    {shape.min():.2f} .. {shape.max():.2f}, median {np.median(shape):.2f}")
    print(f"  conical (conifer-like)   {conifer.sum():,}  ({conifer.mean() * 100:.1f}%)")
    print(f"  rounded (broadleaf-like) {(~conifer).sum():,}  ({(~conifer).mean() * 100:.1f}%)")
    for cut in (0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75):
        print(f"    share below taper {cut:.2f}: {(shape < cut).mean() * 100:5.1f}%")

    args.out.mkdir(parents=True, exist_ok=True)
    source, attribution = survey_credit(args.out)
    if dropped_water:
        print(f"  dropped {dropped_water:,} candidates standing on open water")
    packed = bytearray()
    for i in range(len(x)):
        packed += struct.pack(
            "<hhHBBB",
            int(round(x[i])),
            int(round(z[i])),
            int(round(np.clip(g[i], 0, 6553) * 10)),
            int(round(np.clip(h[i], 0, 51) / 0.2)),
            int(round(np.clip(radius[i], 0, 25) * 10)),
            int(round(np.clip(shape[i], 0, 1) * 255)),
        )
    (args.out / "vegetation.bin").write_bytes(bytes(packed))

    meta = {
        "count": int(len(x)),
        "stride": 9,
        "encoding": "int16 x, int16 z (metres from AOI centre), uint16 ground (dm), "
        "uint8 height (0.2 m units), uint8 crownRadius (dm), uint8 crownShape (0-255)",
        "minHeightM": args.min_height,
        "spacingM": args.spacing,
        "coniferShapeMax": CONIFER_SHAPE_MAX,
        "conicalShare": round(float(conifer.mean()), 4),
        "source": source,
        "attribution": attribution
        + " · Gebäude- und Wassermaske © OpenStreetMap-Mitwirkende, ODbL",
        "note": "Position, height, crown radius and crown shape are all measured from the surface "
        "model. Crown shape is how high the canopy still stands half way out to the crown edge: "
        "low values are conical, high values rounded, which is what separates a conifer from a "
        "broadleaf. Nothing here is a drawing rule.",
    }
    (args.out / "vegetation.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"wrote {len(packed) / 1e6:.1f} MB to {args.out / 'vegetation.bin'}")


if __name__ == "__main__":
    main()
