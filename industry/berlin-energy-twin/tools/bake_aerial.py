"""Bake the TrueDOP Summer 2025 orthophoto patches (PLAN §7 Phase 2, D26).

Output: public/data/aerial-<id>.jpg (shipped, at most `shipPx` on the long side)
and public/data/aerial.json (the manifest EnergyMap reads); the full-resolution
mosaic goes to cache/aerial/ for measuring roof colours in build_buildings.py.

Why the WMS and not the 2 x 2 km Atom tiles: the WMS answers in EPSG:3857
directly (probed 2026-10-27). A Web Mercator image is linear in MapLibre's own
space, so the same JPEG is the ground under the map AND the texture the roofs
sample by position - no reprojection here, no per-vertex UVs in the payload.
TrueDOP rather than DOP: true orthophotos have no leaning buildings, so a roof's
photo sits exactly on its LoD2 outline.

Usage: python tools/bake_aerial.py [--only marienfelde]
"""
from __future__ import annotations

import argparse
import io
import json
import math
import sys
import time
import urllib.parse
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).parent))
from aoi import Patch, load_aoi  # noqa: E402
from bake_common import CACHE, DL_DE_ZERO, OUT, get  # noqa: E402

Image.MAX_IMAGE_PIXELS = None

WMS = "https://gdi.berlin.de/services/wms/truedop_2025_sommer"
LAYER = "truedop_2025_sommer_rgb"
CHUNK = 2048
R = 6378137.0
SOURCE = "Geoportal Berlin, Digitale farbige TrueOrthophotos Sommer 2025 (TrueDOP20RGB), WMS truedop_2025_sommer"
ATTRIBUTION = "Geoportal Berlin / TrueDOP Sommer 2025"


def merc(lon: float, lat: float) -> tuple[float, float]:
    return math.radians(lon) * R, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R


def fetch_chunk(x0: float, y0: float, x1: float, y1: float, w: int, h: int) -> Image.Image:
    q = urllib.parse.urlencode({
        "SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetMap", "LAYERS": LAYER, "STYLES": "",
        "CRS": "EPSG:3857", "BBOX": f"{x0:.3f},{y0:.3f},{x1:.3f},{y1:.3f}",
        "WIDTH": w, "HEIGHT": h, "FORMAT": "image/jpeg",
    })
    # GeoServer answers a busy render as an XML exception with HTTP 200; the same
    # request a moment later returns the image (seen on the first full bake).
    for attempt in range(4):
        data = get(f"{WMS}?{q}", timeout=180)
        try:
            return Image.open(io.BytesIO(data)).convert("RGB")
        except Exception:
            # A request with no granule at all (the base box's corners lie outside
            # Berlin) is not busy, it is empty. The server fills uncovered ground
            # white elsewhere, so the same white keeps the mosaic seamless.
            if b"Unable to create this mosaic" in data:
                return Image.new("RGB", (w, h), (255, 255, 255))
            print(f"  WMS exception, retry {attempt + 1}: {data[-300:]!r}", flush=True)
            time.sleep(5 * 2**attempt)
    raise RuntimeError(f"WMS did not return an image: {data[:300]!r}")


def bake_patch(p: Patch) -> dict:
    x0, y0 = merc(p.west, p.south)
    x1, y1 = merc(p.east, p.north)
    lat_c = (p.south + p.north) / 2
    merc_per_px = p.source_m / math.cos(math.radians(lat_c))
    full_w = math.ceil((x1 - x0) / merc_per_px)
    full_h = math.ceil((y1 - y0) / merc_per_px)
    sx, sy = (x1 - x0) / full_w, (y1 - y0) / full_h

    mosaic = Image.new("RGB", (full_w, full_h))
    total = math.ceil(full_w / CHUNK) * math.ceil(full_h / CHUNK)
    done = 0
    for py in range(0, full_h, CHUNK):
        for px in range(0, full_w, CHUNK):
            w, h = min(CHUNK, full_w - px), min(CHUNK, full_h - py)
            # Image rows run north to south; mercator y runs south to north.
            img = fetch_chunk(x0 + px * sx, y1 - (py + h) * sy, x0 + (px + w) * sx, y1 - py * sy, w, h)
            mosaic.paste(img, (px, py))
            done += 1
            print(f"  {p.id}: {done}/{total}", flush=True)

    (CACHE / "aerial").mkdir(parents=True, exist_ok=True)
    mosaic.save(CACHE / "aerial" / f"mosaic_{p.id}.jpg", quality=92)
    return ship_patch(p, mosaic, done, total)


WEBP_QUALITY = 75


def nodata_mask(img: Image.Image) -> np.ndarray:
    """True where the photo has no data: the server's white fill outside Berlin.

    Only white connected to the image edge counts. A sun-bleached white roof in
    the middle of a site is photo, not a hole, and must stay opaque.
    """
    a = np.asarray(img)
    white = (a >= 250).all(axis=2)
    labels, _ = ndimage.label(white)
    edge = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    mask = np.isin(labels, edge[edge > 0])
    # JPEG rings leave a 1-2 px pale seam along the border of the hole.
    return ndimage.binary_dilation(mask, iterations=2)


def ship_patch(p: Patch, mosaic: Image.Image, done: int, total: int) -> dict:
    """Write the shipped WebP with the no-data area transparent, and its manifest entry.

    WebP rather than JPEG for the alpha: Gropiusstadt, Marzahn and the city base
    reach past the city limit, and a white hole there read as a render fault
    where the base map should simply show through.
    """
    full_w, full_h = mosaic.size
    scale = min(1.0, p.ship_px / max(full_w, full_h))
    ship = mosaic.resize((round(full_w * scale), round(full_h * scale)), Image.LANCZOS) if scale < 1 else mosaic
    hole = nodata_mask(ship)
    rgba = ship.convert("RGBA")
    if hole.any():
        rgba.putalpha(Image.fromarray(np.where(hole, 0, 255).astype(np.uint8)))
    name = f"aerial-{p.id}.webp"
    # D59: quality 75, not 85. The Fabric static deploy is ONE zip POST that times out after ~100 s;
    # at 85 the 52 MB of aerials alone pushed it past that on a home upload. 75 is 31 % smaller,
    # 32.5 dB PSNR against the source, and side by side at 1.5x the two cannot be told apart.
    rgba.save(OUT / name, quality=WEBP_QUALITY, method=6)
    stale = OUT / f"aerial-{p.id}.jpg"
    if stale.exists():
        stale.unlink()
    print(f"  {p.id}: full {full_w}x{full_h}, shipped {ship.size[0]}x{ship.size[1]}, {(OUT / name).stat().st_size / 1e6:.1f} MB, no-data {hole.mean():.1%}")
    return {
        "id": p.id,
        "file": name,
        "bounds": {"west": p.west, "east": p.east, "south": p.south, "north": p.north},
        "zoom": p.zoom,
        "fullPx": [full_w, full_h],
        "shippedPx": list(ship.size),
        "sourceMetresPerPixel": p.source_m,
        "metresPerPixel": round(p.source_m / scale, 3),
        "imageryOnly": p.imagery_only,
        "tiles": {"ok": done, "total": total},
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="re-bake one patch and keep the others' manifest entries")
    ap.add_argument("--reship", action="store_true", help="rewrite the shipped files from the cached mosaics")
    args = ap.parse_args()
    aoi = load_aoi()
    OUT.mkdir(parents=True, exist_ok=True)
    manifest_path = OUT / "aerial.json"
    old = {e["id"]: e for e in json.loads(manifest_path.read_text(encoding="utf-8"))["patches"]} if manifest_path.exists() else {}
    entries = []
    for p in aoi.patches:  # config order is draw order: base first, sharpest last
        mosaic = CACHE / "aerial" / f"mosaic_{p.id}.jpg"
        done = p.id in old and (OUT / old[p.id]["file"]).exists() and mosaic.exists()
        if args.reship and mosaic.exists():  # new shipping format, no new download
            t = old.get(p.id, {}).get("tiles", {"ok": 0, "total": 0})
            entries.append(ship_patch(p, Image.open(mosaic).convert("RGB"), t["ok"], t["total"]))
        elif args.only:
            entries.append(bake_patch(p) if p.id == args.only else old[p.id])
        else:  # resumable: a patch already baked is kept, --only re-bakes one
            entries.append(old[p.id] if done else bake_patch(p))
    manifest = {"source": SOURCE, "attribution": ATTRIBUTION, **DL_DE_ZERO, "patches": entries}
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {manifest_path.relative_to(OUT.parents[1])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
