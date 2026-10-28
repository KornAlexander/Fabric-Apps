"""Bake the Berlin DGM1 into terrarium terrain tiles for MapLibre (PLAN D21, decided 2026-10-27).

Two layers of one source, so the city and the sites never disagree:

  * **city**, zoom 8-13 (about 12 m per pixel at zoom 13), from an 8 m block-mean mosaic
    of every DGM1 tile. Pixels outside the survey (it reaches ~250 m into Brandenburg)
    are filled from the AWS terrarium tile of the same address, so the edge of the city
    does not drop into a hole.
  * **sites**, zoom 14-16 (about 1.5 m per pixel at zoom 16), straight from the 1 m grid,
    only for the tiles that touch a photo-textured site patch (aerial.json).

Everything else the browser asks for is made in the app (src/terrain/demProtocol.ts):
deeper tiles inside Berlin are resampled from the nearest baked ancestor at zoom >= 13,
tiles outside Berlin come from AWS. Heights are quantised to 1/16 m (DGM1 itself is
stated to +-0.15 m) because the finer fraction is noise that costs 40 % in file size.

Output
  public/data/terrain/<z>/<x>/<y>.webp   lossless WebP, terrarium RGB (h = R*256 + G + B/256 - 32768)
  public/data/terrain.json               tile lists per zoom, provenance, fill counts

  python tools/bake_terrain.py
"""
from __future__ import annotations

import io
import json
import math
import shutil
import warnings

import numpy as np
from PIL import Image
from pyproj import Transformer
from scipy import ndimage

import dgm
from bake_common import CACHE, DL_DE_ZERO, OUT, get

CITY_ZOOMS = range(8, 14)
SITE_ZOOMS = range(14, 17)
CITY_RES = 8  # metres per cell of the city mosaic
QUANT = 16  # 1/16 m
TILE = 256
AWS = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
TERRAIN = OUT / "terrain"

_TO_UTM = Transformer.from_crs("EPSG:4326", "EPSG:25833", always_xy=True)
_TO_WGS = Transformer.from_crs("EPSG:25833", "EPSG:4326", always_xy=True)


def tile_pixels(z: int, x: int, y: int) -> tuple[np.ndarray, np.ndarray]:
    """UTM (e, n) of the 256 x 256 pixel centres of a web-mercator tile, row 0 = north."""
    n = TILE * 2**z
    i = np.arange(TILE) + 0.5
    px = x * TILE + i
    py = y * TILE + i
    lon = px / n * 360.0 - 180.0
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * py / n))))
    lon2, lat2 = np.meshgrid(lon, lat)
    e, nn = _TO_UTM.transform(lon2, lat2)
    return np.asarray(e), np.asarray(nn)


def tile_range(z: int, west: float, south: float, east: float, north: float) -> tuple[range, range]:
    def tx(lon: float) -> int:
        return int((lon + 180) / 360 * 2**z)

    def ty(lat: float) -> int:
        r = math.radians(lat)
        return int((1 - math.asinh(math.tan(r)) / math.pi) / 2 * 2**z)

    return range(tx(west), tx(east) + 1), range(ty(north), ty(south) + 1)


def metres_per_pixel(z: int, lat: float = 52.5) -> float:
    return 156543.03392 * math.cos(math.radians(lat)) / 2**z


def encode(h: np.ndarray) -> Image.Image:
    v = np.round(h.astype(np.float64) * QUANT) / QUANT + 32768.0
    whole = np.floor(v)
    r = np.floor(whole / 256)
    g = whole - r * 256
    b = np.round((v - whole) * 256)
    rgb = np.stack([r, g, b], axis=-1).clip(0, 255).astype(np.uint8)
    return Image.fromarray(rgb, "RGB")


def decode(img: Image.Image) -> np.ndarray:
    a = np.asarray(img.convert("RGB")).astype(np.float64)
    return a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768


def aws_heights(z: int, x: int, y: int) -> np.ndarray:
    """AWS terrarium heights for a tile (cached), zoom capped at 15 by upsampling the parent."""
    if z > 15:
        d = z - 15
        parent = aws_heights(15, x >> d, y >> d)
        k = 2**d
        ox, oy = (x - ((x >> d) << d)) * TILE / k, (y - ((y >> d) << d)) * TILE / k
        jj, ii = np.meshgrid(ox + (np.arange(TILE) + 0.5) / k - 0.5, oy + (np.arange(TILE) + 0.5) / k - 0.5)
        return ndimage.map_coordinates(parent, [ii, jj], order=1, mode="nearest")
    p = CACHE / "aws_terrarium" / f"{z}_{x}_{y}.png"
    if not p.exists():
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(get(AWS.format(z=z, x=x, y=y)))
    return decode(Image.open(p))


def save(z: int, x: int, y: int, h: np.ndarray) -> int:
    path = TERRAIN / str(z) / str(x) / f"{y}.webp"
    path.parent.mkdir(parents=True, exist_ok=True)
    buf = io.BytesIO()
    # method 6 is 50x slower for 20 % fewer bytes (measured 2.6 s vs 0.05 s per tile)
    encode(h).save(buf, "WEBP", lossless=True, quality=100, method=4)
    path.write_bytes(buf.getvalue())
    return len(buf.getvalue())


def city_mosaic() -> tuple[np.ndarray, np.ndarray, float, float]:
    """8 m block-mean mosaic of all tiles, nearest-filled, plus each cell's distance to survey (cells)."""
    keys = dgm.tile_keys()
    e0 = min(k[0] for k in keys)
    n0 = min(k[1] for k in keys)
    e1 = max(k[0] for k in keys) + dgm.TILE_M
    n1 = max(k[1] for k in keys) + dgm.TILE_M
    b = dgm.TILE_M // CITY_RES
    city = np.full(((n1 - n0) // CITY_RES, (e1 - e0) // CITY_RES), np.nan, dtype=np.float32)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN blocks outside the survey
        for e, n in keys:
            t = np.load(dgm.DIR / f"{e // 1000}_{n // 1000}.npy").astype(np.float32) / 100
            t[t == 0] = np.nan
            blocks = np.nanmean(t.reshape(b, CITY_RES, b, CITY_RES), axis=(1, 3))
            r = (n1 - n - dgm.TILE_M) // CITY_RES
            c = (e - e0) // CITY_RES
            city[r : r + b, c : c + b] = blocks
    missing = np.isnan(city)
    dist, (ri, ci) = ndimage.distance_transform_edt(missing, return_indices=True)
    filled = city[ri, ci]
    print(f"city mosaic {city.shape[1]} x {city.shape[0]} cells of {CITY_RES} m, {100 * (1 - missing.mean()):.0f} % surveyed")
    return filled, dist.astype(np.float32), float(e0), float(n1)


def bake_city(manifest: dict) -> None:
    filled, dist, e0, n1 = city_mosaic()
    h_cells, w_cells = filled.shape
    lon_w, lat_s = _TO_WGS.transform(e0, n1 - h_cells * CITY_RES)
    lon_e, lat_n = _TO_WGS.transform(e0 + w_cells * CITY_RES, n1)
    for z in CITY_ZOOMS:
        size = max(1, round(metres_per_pixel(z) / CITY_RES))
        smooth = ndimage.uniform_filter(filled, size=size, mode="nearest") if size > 1 else filled
        xs, ys = tile_range(z, lon_w, lat_s, lon_e, lat_n)
        done = []
        for x in xs:
            for y in ys:
                e, n = tile_pixels(z, x, y)
                col = (e - e0) / CITY_RES - 0.5
                row = (n1 - n) / CITY_RES - 0.5
                inside = (col >= 0) & (col <= w_cells - 1) & (row >= 0) & (row <= h_cells - 1)
                near = np.zeros(inside.shape, dtype=bool)
                ri = np.clip(np.round(row).astype(int), 0, h_cells - 1)
                ci = np.clip(np.round(col).astype(int), 0, w_cells - 1)
                near[inside] = dist[ri[inside], ci[inside]] <= 1
                if not near.any():
                    continue
                h = ndimage.map_coordinates(smooth, [row, col], order=1, mode="nearest")
                if not near.all():
                    h = np.where(near, h, aws_heights(z, x, y))
                    manifest["fill"]["awsPixels"] += int((~near).sum())
                manifest["bytes"] += save(z, x, y, h)
                done.append(f"{x}/{y}")
        manifest["tiles"][str(z)] = done
        print(f"z{z}: {len(done)} city tiles", flush=True)
    manifest["city"] = {"zooms": [CITY_ZOOMS.start, CITY_ZOOMS.stop - 1], "mosaicM": CITY_RES}
    # Kept for the deeper site tiles' rare gaps.
    bake_city.mosaic = (filled, e0, n1)  # type: ignore[attr-defined]


def bake_sites(manifest: dict) -> None:
    aerial = json.loads((OUT / "aerial.json").read_text(encoding="utf-8"))["patches"]
    sites = [p for p in aerial if not p.get("imageryOnly")]
    filled, ce0, cn1 = bake_city.mosaic  # type: ignore[attr-defined]
    for z in SITE_ZOOMS:
        wanted: set[tuple[int, int]] = set()
        for p in sites:
            b = p["bounds"]
            xs, ys = tile_range(z, b["west"], b["south"], b["east"], b["north"])
            wanted |= {(x, y) for x in xs for y in ys}
        size = max(1, round(metres_per_pixel(z)))
        done = []
        for x, y in sorted(wanted):
            e, n = tile_pixels(z, x, y)
            win, w0, wn = dgm.window(e.min() - 8, n.min() - 8, e.max() + 8, n.max() + 8)
            missing = np.isnan(win)
            if missing.all():
                continue
            dist, (ri, ci) = ndimage.distance_transform_edt(missing, return_indices=True)
            fw = win[ri, ci]
            if size > 1:
                fw = ndimage.uniform_filter(fw, size=size, mode="nearest")
            col = e - w0 - 0.5
            row = wn - n - 0.5
            h = ndimage.map_coordinates(fw, [row, col], order=1, mode="nearest")
            gap = dist[np.clip(np.round(row).astype(int), 0, win.shape[0] - 1), np.clip(np.round(col).astype(int), 0, win.shape[1] - 1)] > 2
            if gap.any():
                cc = (e - ce0) / CITY_RES - 0.5
                cr = (cn1 - n) / CITY_RES - 0.5
                h = np.where(gap, ndimage.map_coordinates(filled, [cr, cc], order=1, mode="nearest"), h)
                manifest["fill"]["cityPixels"] += int(gap.sum())
            manifest["bytes"] += save(z, x, y, h)
            done.append(f"{x}/{y}")
        manifest["tiles"][str(z)] = done
        print(f"z{z}: {len(done)} site tiles", flush=True)
    manifest["sites"] = {"zooms": [SITE_ZOOMS.start, SITE_ZOOMS.stop - 1], "patches": [p["id"] for p in sites]}


def verify(manifest: dict) -> dict:
    """Decode written tiles and compare them with the 1 m survey under the same pixels.

    Site tiles must match to a few decimetres (the pixel is 1.5 m and smoothed, so
    embankment edges differ most); city tiles are 12 m block means and are only
    checked for gross offsets.
    """
    report = {}
    for z in (13, 16):
        diffs = []
        for key in manifest["tiles"][str(z)][:: max(1, len(manifest["tiles"][str(z)]) // 12)]:
            x, y = map(int, key.split("/"))
            h = decode(Image.open(TERRAIN / str(z) / str(x) / f"{y}.webp"))
            e, n = tile_pixels(z, x, y)
            ref = dgm.sample(e[::8, ::8], n[::8, ::8])
            d = (h[::8, ::8] - ref)[~np.isnan(ref)]
            if d.size:
                diffs.append(d)
        d = np.abs(np.concatenate(diffs))
        report[str(z)] = {"medianAbsM": round(float(np.median(d)), 3), "p95AbsM": round(float(np.percentile(d, 95)), 3)}
    if report["16"]["medianAbsM"] > 0.3 or report["13"]["medianAbsM"] > 1.5:
        raise SystemExit(f"terrain tiles disagree with the DGM1: {report}")
    return report


def main() -> None:
    if not dgm.tile_keys():
        raise SystemExit("no DGM1 in cache, run tools/fetch_dgm1.py first")
    if TERRAIN.exists():
        shutil.rmtree(TERRAIN)
    manifest = {
        "source": "Geoportal Berlin, ATKIS DGM (1 m Rasterweite), Atom feed gdi.berlin.de/data/dgm1",
        "attribution": "Geoportal Berlin / ATKIS DGM1",
        **DL_DE_ZERO,
        "fillSource": "AWS Terrain Tiles (terrarium) outside the survey",
        "encoding": "terrarium",
        "format": "webp",
        "tileSize": TILE,
        "quantisationM": 1 / QUANT,
        "minzoom": CITY_ZOOMS.start,
        "maxzoom": SITE_ZOOMS.stop - 1,
        "tiles": {},
        "fill": {"awsPixels": 0, "cityPixels": 0},
        "bytes": 0,
    }
    bake_city(manifest)
    bake_sites(manifest)
    manifest["check"] = verify(manifest)
    (OUT / "terrain.json").write_text(json.dumps(manifest, separators=(",", ":")), encoding="utf-8")
    total = sum(len(v) for v in manifest["tiles"].values())
    print(f"{total} tiles, {manifest['bytes'] / 1e6:.1f} MB, fill {manifest['fill']}, check {manifest['check']}")


if __name__ == "__main__":
    main()
