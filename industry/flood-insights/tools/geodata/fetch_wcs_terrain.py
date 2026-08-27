"""Fetch terrain for any area of interest that names a WCS in its config.

The Ahr downloads 1 m DGM1 as Metalink tiles from a Rheinland-Pfalz catalogue. That route
exists in exactly one German state. Everywhere else so far serves elevation through a WCS
instead, which suits this project better anyway: you ask for the resolution you want
rather than downloading a metre grid and discarding 24 cells in every 25.

Three services, one shape. All describe their coverages in EPSG:4326 with axis labels
`lat` and `long`, so a subset is written the same way for each:

  Spain    servicios.idee.es        Elevacion4258_5   5 m
  Italy    wms.pcn.minambiente.it   EL.DTM.20M       20 m
  Germany  wcs.nrw.de               nw_dgm           native, requested coarse

⚠️ Servers cap a single response — the Spanish one at 4096 px per side. Asking for a
coarser grid to fit would throw away the resolution that made the service worth using, so
the request is tiled and the pieces are stitched. Writes the same uint16 raster plus JSON
sidecar the twin already loads.

Usage
  python tools/geodata/fetch_wcs_terrain.py --aoi hortasud-2024
  python tools/geodata/fetch_wcs_terrain.py --aoi castelbolognese-2023
"""

from __future__ import annotations

import argparse
import json
import math
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from aoi import load_aoi  # noqa: E402  - local module, path set above

UA = {"User-Agent": "flut-insights/1.0 (+https://github.com/KornAlexander/Flut-Insights)"}

# Under every server cap seen so far (the Spanish one is 4096) with room for rounding.
MAX_TILE_PX = 3800

# Hosts whose certificate chain does not validate from here. Named individually and on
# purpose: disabling verification globally, or silently, would be a different thing entirely.
TLS_EXCEPTIONS = {"wms.pcn.minambiente.it"}

# Servers signal "no data" with a large negative sentinel rather than NaN.
NODATA_BELOW = -1000.0


def context_for(url: str) -> ssl.SSLContext | None:
    host = urllib.parse.urlsplit(url).hostname or ""
    if host not in TLS_EXCEPTIONS:
        return None
    lax = ssl.create_default_context()
    lax.check_hostname = False
    lax.verify_mode = ssl.CERT_NONE
    return lax


def degrees_per_metre(latitude: float) -> tuple[float, float]:
    """Degrees of longitude and latitude spanned by one metre at this latitude."""
    return 1.0 / (111_320.0 * math.cos(math.radians(latitude))), 1.0 / 110_570.0


def fetch_tile(service, coverage, south, north, west, east, cols, rows, ctx, version):
    """One GetCoverage request, in whichever WCS version the service actually honours.

    ⚠️ Version is not cosmetic here. The Italian MapServer advertises 2.0.1 and answers every
    2.0.1 request with a 1x1 image — no error, no warning, just a single cell. Only the 1.0.0
    bbox/width/height form returns data. The Spanish and German services want 2.0.1 subsets.
    """
    joiner = "&" if "?" in service else "?"
    if version.startswith("1."):
        query = (
            f"{service}{joiner}service=WCS&version={version}&request=GetCoverage"
            f"&coverage={coverage}"
            f"&bbox={west},{south},{east},{north}"
            f"&crs=EPSG:4326&width={cols}&height={rows}&format=GEOTIFF"
        )
    else:
        query = (
            f"{service}{joiner}service=WCS&version={version}&request=GetCoverage"
            f"&coverageId={coverage}"
            f"&subset=lat({south},{north})&subset=long({west},{east})"
            f"&scaleSize=long({cols}),lat({rows})"
            f"&format=image/tiff"
        )
    req = urllib.request.Request(query, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=600, context=ctx) as resp:
            payload = resp.read()
    except urllib.error.HTTPError as err:
        raise SystemExit(
            f"  WCS returned {err.code}\n  {err.read().decode('utf-8', 'replace')[:700]}"
        ) from err
    if payload[:2] not in (b"II", b"MM"):
        raise SystemExit(f"  expected a GeoTIFF:\n  {payload[:700].decode('utf-8', 'replace')}")
    with Image.open(BytesIO(payload)) as img:
        return np.asarray(img, dtype=np.float32)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", required=True)
    parser.add_argument("--resolution", type=float,
                        help="metres per cell; defaults to the AOI's sourceResolutionM")
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    geo = cfg.get("geobasis") or {}
    service, coverage = geo.get("service"), geo.get("coverage")
    version = geo.get("wcsVersion", "2.0.1")
    if not service or not coverage:
        raise SystemExit(
            f"{args.aoi}: no geobasis.service / geobasis.coverage. The Ahr uses tiled DGM1 "
            f"and is fetched by fetch_dgm1.py instead."
        )

    box = cfg["bbox"]
    resolution = args.resolution or cfg["grids"]["sourceResolutionM"]
    mid_lat = (box["south"] + box["north"]) / 2
    lon_deg, lat_deg = degrees_per_metre(mid_lat)

    width_m = (box["east"] - box["west"]) / lon_deg
    height_m = (box["north"] - box["south"]) / lat_deg
    cols = int(round(width_m / resolution))
    rows = int(round(height_m / resolution))

    nx = math.ceil(cols / MAX_TILE_PX)
    ny = math.ceil(rows / MAX_TILE_PX)

    print(f"{args.aoi}: {width_m / 1000:.1f} x {height_m / 1000:.1f} km")
    print(f"  {geo.get('authority', service)}")
    print(f"  coverage {coverage} at {resolution:g} m -> {cols} x {rows} cells  (WCS {version})")
    ctx = context_for(service)
    if ctx is not None:
        print(f"  WARNING {urllib.parse.urlsplit(service).hostname} presents an incomplete "
              f"certificate chain; verification disabled for this host only")
    if nx * ny > 1:
        print(f"  server caps a response at ~{MAX_TILE_PX} px, so fetching {nx} x {ny} tiles")

    grid = np.empty((rows, cols), dtype=np.float32)
    for iy in range(ny):
        r0, r1 = iy * rows // ny, (iy + 1) * rows // ny
        # Row 0 is north, so the first tile row takes the northern slice of latitude.
        tile_north = box["north"] - (box["north"] - box["south"]) * r0 / rows
        tile_south = box["north"] - (box["north"] - box["south"]) * r1 / rows
        for ix in range(nx):
            c0, c1 = ix * cols // nx, (ix + 1) * cols // nx
            tile_west = box["west"] + (box["east"] - box["west"]) * c0 / cols
            tile_east = box["west"] + (box["east"] - box["west"]) * c1 / cols
            piece = fetch_tile(service, coverage, tile_south, tile_north,
                               tile_west, tile_east, c1 - c0, r1 - r0, ctx, version)
            if piece.shape != (r1 - r0, c1 - c0):
                raise SystemExit(
                    f"  tile {ix},{iy} came back {piece.shape}, expected {(r1 - r0, c1 - c0)} — "
                    f"stitching it would misplace every cell to its east"
                )
            grid[r0:r1, c0:c1] = piece
            print(f"    tile {ix + 1},{iy + 1}  {c1 - c0} x {r1 - r0}  "
                  f"{float(piece.min()):.0f}..{float(piece.max()):.0f} m")

    valid = np.isfinite(grid) & (grid > NODATA_BELOW)
    if not valid.all():
        from scipy.ndimage import distance_transform_edt

        print(f"  {(~valid).sum():,} cells without data, filled from the nearest valid neighbour")
        idx = distance_transform_edt(~valid, return_distances=False, return_indices=True)
        grid = grid[tuple(idx)]

    lo, hi = float(grid.min()), float(grid.max())
    scale = (hi - lo) / 65535.0 if hi > lo else 1.0
    packed = np.clip(np.round((grid - lo) / scale), 0, 65535).astype("<u2")

    out = Path("public/terrain") / args.aoi
    out.mkdir(parents=True, exist_ok=True)
    stem = f"heightmap_{resolution:g}m"
    (out / f"{stem}.u16").write_bytes(packed.tobytes())

    # The mask is a build input for build_flowfield.py, never a runtime asset, so it goes to
    # data/derived/. Horta Sud's was 15.3 MB of zeros under public/ — full coverage, nothing to
    # mask, and deployed anyway. Write it only when the service actually left a gap.
    gaps = int((~valid).sum())
    nodata_rel = None
    if gaps:
        derived = Path("data/derived") / args.aoi
        derived.mkdir(parents=True, exist_ok=True)
        (derived / f"{stem}_nodata.u8").write_bytes((~valid).astype(np.uint8).tobytes())
        nodata_rel = f"data/derived/{args.aoi}/{stem}_nodata.u8"
        print(f"  {gaps} nodata cells -> {nodata_rel} (build artefact, not deployed)")
    stale = out / f"{stem}_nodata.u8"
    if stale.exists():
        size_mb = stale.stat().st_size / 1024 / 1024
        stale.unlink()
        print(f"  removed deployed {stale.name} ({size_mb:.1f} MB) — no runtime reader")

    meta = {
        "width": cols,
        "height": rows,
        "resolutionM": resolution,
        "crs": "EPSG:4326",
        "verticalDatum": cfg.get("verticalDatum", "unknown"),
        "boundsWgs84": {k: box[k] for k in ("west", "south", "east", "north")},
        "heightMinM": round(lo, 2),
        "heightMaxM": round(hi, 2),
        "heightScale": scale,
        "encoding": "uint16-le, row-major, row 0 = north",
        "coveragePct": round(100.0 * float(valid.mean()), 2),
        "nodataFill": "nearest",
        "nodataCells": gaps,
        "nodataNote": (
            "Cells outside the service's coverage are filled from the nearest valid cell for "
            "appearance and flagged in the mask so they are never inundated. The mask is a build "
            "artefact under data/derived/, read only by build_flowfield.py."
            if gaps
            else "The service covers this AOI completely, so there are no gaps and no mask."
        ),
        "source": f"{geo.get('authority', '')} - {coverage}",
        "sourceService": service,
        "licence": geo.get("licence"),
        "attribution": geo.get("attribution"),
        "file": f"{stem}.u16",
    }
    if nodata_rel:
        meta["nodataFile"] = nodata_rel
    (out / f"{stem}.json").write_text(
        json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    size_kb = (out / f"{stem}.u16").stat().st_size / 1024
    print(f"  wrote {out / stem}.u16  {size_kb:,.0f} KB")
    print(f"  elevation {lo:.1f} .. {hi:.1f} m, {meta['coveragePct']:.1f} % real data")


if __name__ == "__main__":
    main()
