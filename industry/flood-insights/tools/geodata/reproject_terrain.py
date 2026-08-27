"""Resample a geographic heightmap onto a projected UTM grid, in place.

Why this exists
---------------
`fetch_wcs_terrain.py` writes EPSG:4326 rasters: a grid of degrees. Everything downstream —
chainage, the flow field, Manning cross-sections, building and canopy placement — works in metres,
because a cross-section solved in degrees is not a cross-section. So Horta Sud and Castel Bolognese
had terrain and could never have had a flood.

Nothing is re-fetched. The elevations already on disk are resampled onto a metre grid in the AOI's
OWN UTM zone, which for Valencia is zone 30 and not the 32 the rest of this project was built on.

A degree of longitude is about 78 km at Valencia and 71 km at the Ahr, while a degree of latitude
is ~111 km everywhere, so a geographic grid has non-square cells that vary with latitude. That is
the distortion this removes, and it is why the output cell count is not the input cell count.

Usage
  python tools/geodata/reproject_terrain.py --aoi hortasud-2024
  python tools/geodata/reproject_terrain.py --aoi castelbolognese-2023
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from aoi import load_aoi, terrain_name  # noqa: E402
from utm import (  # noqa: E402
    _A_BAR,
    _BETA,
    _DELTA,
    _FALSE_EASTING,
    _FALSE_NORTHING,
    _K0,
    _lon_origin,
    bbox_to_utm,
    epsg_for_zone,
    utm_to_wgs84,
    wgs84_to_utm,
    zone_for_lon,
)


def utm_to_wgs84_grid(
    easting: np.ndarray, northing: np.ndarray, zone: int
) -> tuple[np.ndarray, np.ndarray]:
    """Vectorised inverse projection — the scalar one would be 16 million Python calls.

    Same Krüger series as utm.utm_to_wgs84; checked against it in main() rather than trusted.
    """
    xi = (northing - _FALSE_NORTHING) / (_K0 * _A_BAR)
    eta = (easting - _FALSE_EASTING) / (_K0 * _A_BAR)

    xi_p = xi.copy()
    eta_p = eta.copy()
    for j, beta in enumerate(_BETA, start=1):
        xi_p -= beta * np.sin(2 * j * xi) * np.cosh(2 * j * eta)
        eta_p -= beta * np.cos(2 * j * xi) * np.sinh(2 * j * eta)

    chi = np.arcsin(np.sin(xi_p) / np.cosh(eta_p))
    phi = chi.copy()
    for j, delta in enumerate(_DELTA, start=1):
        phi += delta * np.sin(2 * j * chi)

    lam = np.arctan(np.sinh(eta_p) / np.cos(xi_p))
    return np.degrees(lam + _lon_origin(zone)), np.degrees(phi)


def rebuild_mask(cfg: dict, name: str, out_dir: Path, meta: dict) -> None:
    """Recompute the nodata mask for a terrain that has already been reprojected.

    A gap is not a property of the elevations, it is a property of the geometry: reprojecting a
    lat/lon rectangle into a metre grid gives an envelope whose corners lie outside the source box,
    and those cells were filled from their nearest neighbour for appearance. So the mask is exactly
    "does this cell's centre, unprojected, fall inside the source's geographic bounds" — which
    needs the sidecar and nothing else.

    This exists because the first version of this script counted the gaps and never wrote them.
    The sidecar then advertised nodata cells and named no mask, and build_flowfield.py refuses to
    run in that state rather than flood invented ground.
    """
    zone = int(meta["utmZone"])
    w, h, res = meta["width"], meta["height"], meta["resolutionM"]
    e0 = meta["origin"]["easting"]
    n0 = meta["origin"]["northing"]

    # The SOURCE box is the AOI's configured bbox: that is what was asked of the WCS.
    b = cfg["bbox"]
    cols = e0 + (np.arange(w, dtype=np.float64) + 0.5) * res
    rows = n0 + (h - np.arange(h, dtype=np.float64) - 0.5) * res  # row 0 = north
    egrid, ngrid = np.meshgrid(cols, rows)
    lon, lat = utm_to_wgs84_grid(egrid, ngrid, zone)
    inside = (
        (lon >= b["west"]) & (lon <= b["east"]) & (lat >= b["south"]) & (lat <= b["north"])
    )
    gaps = ~inside

    derived_dir = Path("data/derived") / cfg["id"]
    derived_dir.mkdir(parents=True, exist_ok=True)
    nodata_path = derived_dir / f"{name}_nodata.u8"
    nodata_path.write_bytes((gaps * 255).astype(np.uint8).tobytes())
    meta["nodataCells"] = int(gaps.sum())
    meta["coveragePct"] = round(float(inside.mean() * 100), 2)
    meta["nodataFile"] = str(nodata_path).replace("\\", "/")
    (out_dir / f"{name}.json").write_text(
        json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(
        f"{cfg['id']}: {int(gaps.sum()):,} nodata cells of {gaps.size:,} "
        f"({meta['coveragePct']:.2f}% covered) -> {nodata_path}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", required=True)
    parser.add_argument(
        "--resolution",
        type=int,
        default=None,
        help="output grid spacing in metres; defaults to the AOI's declared terrain resolution",
    )
    parser.add_argument(
        "--mask-only",
        action="store_true",
        help=(
            "recompute the nodata mask for an already-projected terrain and exit. The mask is a "
            "pure function of the grid, the source's geographic box and the zone, so it does not "
            "need the source raster back"
        ),
    )
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    name = terrain_name(cfg)
    out_dir = Path("public/terrain") / cfg["id"]
    meta = json.loads((out_dir / f"{name}.json").read_text(encoding="utf-8"))

    if args.mask_only:
        rebuild_mask(cfg, name, out_dir, meta)
        return

    # Running this twice would resample an already-projected grid through a projection that no
    # longer applies to it, and the result would look entirely reasonable.
    if meta.get("crs") != "EPSG:4326":
        raise SystemExit(
            f"{name}.json is already {meta.get('crs')}, not EPSG:4326. Nothing to reproject — "
            f"re-run fetch_wcs_terrain.py first if you meant to rebuild it. To recompute only the "
            f"nodata mask, use --mask-only."
        )

    res = args.resolution or meta["resolutionM"]
    src_w, src_h = meta["width"], meta["height"]
    b = meta["boundsWgs84"]
    src = np.fromfile(out_dir / meta["file"], dtype="<u2").reshape(src_h, src_w)
    src_z = meta["heightMinM"] + src.astype(np.float64) * meta["heightScale"]

    zone = zone_for_lon((b["west"] + b["east"]) / 2)
    e0, n0, e1, n1 = bbox_to_utm(b["west"], b["south"], b["east"], b["north"], zone)
    # Snap the origin to the grid so the raster lines up with anything else built at this spacing.
    e0, n0 = math.floor(e0 / res) * res, math.floor(n0 / res) * res
    w = int(math.ceil((e1 - e0) / res))
    h = int(math.ceil((n1 - n0) / res))
    print(f"{cfg['id']}: {src_w}x{src_h} degrees grid -> {w}x{h} @ {res} m, {epsg_for_zone(zone)}")

    # Output cell centres, row 0 = north, then straight back to lon/lat to sample the source.
    ee = e0 + (np.arange(w) + 0.5) * res
    nn = n0 + h * res - (np.arange(h) + 0.5) * res
    egrid, ngrid = np.meshgrid(ee, nn)
    lon, lat = utm_to_wgs84_grid(egrid, ngrid, zone)

    # Cross-check the vectorised inverse against the scalar one it duplicates.
    worst = 0.0
    for r, c in ((0, 0), (h // 2, w // 2), (h - 1, w - 1), (0, w - 1), (h - 1, 0)):
        lo, la = utm_to_wgs84(float(egrid[r, c]), float(ngrid[r, c]), zone)
        worst = max(worst, abs(lo - lon[r, c]), abs(la - lat[r, c]))
    print(f"  vectorised inverse agrees with the scalar one to {worst * 111_000 * 100:.6f} cm")
    if worst > 1e-9:
        raise SystemExit("vectorised inverse projection disagrees with utm.py — refusing to write")

    # Bilinear sample of the source raster. Source row 0 = north, matching the sidecar's encoding.
    fx = (lon - b["west"]) / (b["east"] - b["west"]) * src_w - 0.5
    fy = (b["north"] - lat) / (b["north"] - b["south"]) * src_h - 0.5
    inside = (fx >= -0.5) & (fx <= src_w - 0.5) & (fy >= -0.5) & (fy <= src_h - 0.5)

    x0 = np.clip(np.floor(fx).astype(int), 0, src_w - 1)
    y0 = np.clip(np.floor(fy).astype(int), 0, src_h - 1)
    x1 = np.clip(x0 + 1, 0, src_w - 1)
    y1 = np.clip(y0 + 1, 0, src_h - 1)
    tx = np.clip(fx - x0, 0.0, 1.0)
    ty = np.clip(fy - y0, 0.0, 1.0)
    top = src_z[y0, x0] * (1 - tx) + src_z[y0, x1] * tx
    bottom = src_z[y1, x0] * (1 - tx) + src_z[y1, x1] * tx
    z = top * (1 - ty) + bottom * ty

    # The UTM envelope of a geographic box is larger than the box, so its corners fall outside the
    # source. Filled from the nearest valid cell for appearance and flagged so they never flood —
    # the same contract build_terrain.py has.
    gaps = ~inside
    if gaps.any():
        from scipy import ndimage

        idx = ndimage.distance_transform_edt(gaps, return_distances=False, return_indices=True)
        z = z[tuple(idx)]
    coverage = float(inside.mean() * 100)
    print(f"  coverage {coverage:.2f}%  ({int(gaps.sum()):,} cells filled from the nearest valid)")

    z_min, z_max = float(z.min()), float(z.max())
    scale = (z_max - z_min) / 65535 if z_max > z_min else 1.0
    quantised = np.clip(np.round((z - z_min) / scale), 0, 65535).astype("<u2")

    places = []
    for place in cfg.get("focusPlaces", []) or []:
        pe, pn = wgs84_to_utm(place["lon"], place["lat"], zone)
        u = (pe - e0) / (w * res)
        v = (n0 + h * res - pn) / (h * res)
        row = int(np.clip(v * h, 0, h - 1))
        col = int(np.clip(u * w, 0, w - 1))
        places.append(
            {
                "id": place["id"],
                "name": place["name"],
                "u": round(float(u), 5),
                "v": round(float(v), 5),
                "groundM": round(float(z[row, col]), 2),
            }
        )
        print(f"    {place['name']}: u={u:.3f} v={v:.3f} ground={z[row, col]:.1f} m")

    lon_w, lat_s = utm_to_wgs84(e0, n0, zone)
    lon_e, lat_n = utm_to_wgs84(e0 + w * res, n0 + h * res, zone)

    out = dict(meta)
    out.update(
        {
            "width": w,
            "height": h,
            "resolutionM": res,
            "crs": epsg_for_zone(zone),
            "utmZone": zone,
            "origin": {"easting": e0, "northing": n0},
            "heightMinM": round(z_min, 3),
            "heightMaxM": round(z_max, 3),
            "heightScale": scale,
            "encoding": "uint16-le, row-major, row 0 = north",
            "boundsWgs84": {
                "west": round(lon_w, 6),
                "south": round(lat_s, 6),
                "east": round(lon_e, 6),
                "north": round(lat_n, 6),
            },
            "coveragePct": round(coverage, 2),
            "focusPlaces": places,
            "nodataFill": "nearest",
            "nodataCells": int(gaps.sum()),
            "nodataNote": (
                "Reprojected from the source EPSG:4326 raster. The UTM envelope of a geographic "
                "box is larger than the box, so its corners have no source data; they are filled "
                "from the nearest valid cell for appearance and must never be inundated."
            ),
            "reprojectedFrom": "EPSG:4326",
            "file": f"{name}.u16",
        }
    )

    # ⚠️ Write the mask, do not just count the gaps.
    #
    # This popped `nodataFile` and wrote nothing, so the sidecar advertised tens of thousands of
    # nodata cells and named no mask — and build_flowfield.py refuses to run in exactly that state,
    # correctly: the corners are filled from the nearest valid cell for appearance, so without a
    # mask that invented ground is eligible for flooding and the twin would put water on terrain
    # that was never measured. Reprojecting a geographic box into a metre grid guarantees these
    # gaps, because the UTM envelope of a lat/lon rectangle is not a rectangle.
    #
    # Under data/derived/, never next to the heightmap: build_flowfield.py is its only reader and
    # keeping it in public/ would deploy a byte per cell to every visitor for nothing.
    derived_dir = Path("data/derived") / cfg["id"]
    derived_dir.mkdir(parents=True, exist_ok=True)
    nodata_path = derived_dir / f"{name}_nodata.u8"
    if gaps.any():
        nodata_path.write_bytes((gaps * 255).astype(np.uint8).tobytes())
        out["nodataFile"] = str(nodata_path).replace("\\", "/")
        print(f"  wrote {nodata_path} ({int(gaps.sum()):,} cells, build artefact, not deployed)")
    else:
        out.pop("nodataFile", None)
        if nodata_path.exists():
            nodata_path.unlink()

    # An older build may have left a copy under public/, which is deployed and unread.
    stale = out_dir / f"{name}_nodata.u8"
    if stale.exists():
        stale.unlink()
        print(f"  removed stale {stale} from the deployed folder")

    (out_dir / f"{name}.u16").write_bytes(quantised.tobytes())
    (out_dir / f"{name}.json").write_text(
        json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"  wrote {name}.u16 / .json  ({z_min:.1f}..{z_max:.1f} m)")


if __name__ == "__main__":
    main()
