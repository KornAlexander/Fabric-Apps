"""Fetch the aerial-photo drape for an AOI from its own state's DOP WMS.

Ported from Gleitschirm-Insights' fetch_dop20.py, which learned the important part: DOP is not
worth downloading as source tiles. A WMS request names the exact extent AND the exact output
resolution, so instead of pulling gigabytes at 20 cm and throwing almost all of it away, this asks
once for the AOI at the size the browser will actually sample.

⚠️ EACH AOI USES ITS OWN AUTHORITY'S SERVICE, and they are not interchangeable. Rheinland-Pfalz
publishes DOP20 under dl-de/by-2-0, which requires attribution; North Rhine-Westphalia publishes
under dl-de/zero-2-0, which does not. Drawing one state's photograph over the other's terrain
would be both the wrong picture and the wrong licence, so the service is read from the AOI's
`geobasis.dop` block and never defaulted.

Resolution is a trade, not the source resolution. The terrain mesh underneath is at 4 m (Ahr) or
2 m (Steinbach) posting, so detail far finer than that has nothing to sit on and only costs
download. 8192 px on the long side stays inside the texture size WebGL2 guarantees.

Output (public/terrain/<aoi-id>/):
  drape.jpg     the mosaic, aligned to the heightmap grid exactly
  drape.json    extent, pixel size, attribution
"""

from __future__ import annotations

import argparse
import io
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from aoi import load_aoi, terrain_name  # noqa: E402
from utm import epsg_for_zone, zone_for_lon  # noqa: E402

#: Fallback cap on a single GetMap, used only when the service does not advertise its own.
#:
#: ⚠️ This was a flat constant, and services disagree about it by a factor of two. The German DOP
#: servers answer a 4000 px request happily; the Italian Geoportale rejects anything over 2048 with
#: "Image size out of range", which arrives as a 200 with an XML body rather than an HTTP error. A
#: WMS states its own limit in GetCapabilities, so the sensible thing is to ask rather than to
#: guess and then add a per-AOI override for every server that disagrees.
MAX_REQUEST_PX = 4000
#: Longest side of the finished drape. 8192 is the texture size WebGL2 guarantees.
LONG_SIDE_PX = 8192
USER_AGENT = "Flut-Insights/geodata (open geodata pipeline)"


def advertised_max_px(service: str, fallback: int) -> int:
    """The largest single GetMap this service admits to, from its own capabilities."""
    url = (
        service
        + ("&" if "?" in service else "?")
        + "SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0"
    )
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=120) as r:
            body = r.read().decode("utf-8", "replace")
    except Exception as exc:  # noqa: BLE001
        print(f"  capabilities unavailable ({type(exc).__name__}); using {fallback} px tiles")
        return fallback
    limits = [
        int(v)
        for tag in ("MaxWidth", "MaxHeight")
        for v in re.findall(rf"<{tag}>(\d+)</{tag}>", body)
    ]
    if not limits:
        print(f"  service states no MaxWidth/MaxHeight; using {fallback} px tiles")
        return fallback
    cap = min(min(limits), fallback)
    print(f"  service caps a single request at {min(limits)} px; using {cap} px tiles")
    return cap


def fetch_tile(service: str, layer: str, epsg: str, bbox: tuple[float, float, float, float],
               width: int, height: int, retries: int = 3) -> Image.Image:
    """One WMS GetMap. bbox is (minx, miny, maxx, maxy) in the projected CRS."""
    params = {
        "SERVICE": "WMS",
        "VERSION": "1.3.0",
        "REQUEST": "GetMap",
        "LAYERS": layer,
        "STYLES": "",
        # ⚠️ WMS 1.3.0 with a projected CRS takes the bbox in AXIS ORDER of that CRS, which for
        # EPSG:258xx is easting,northing — the same order as 1.1.1. Getting this backwards returns
        # a valid image of the wrong place rather than an error.
        "CRS": epsg,
        "BBOX": f"{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]}",
        "WIDTH": str(width),
        "HEIGHT": str(height),
        "FORMAT": "image/jpeg",
    }
    url = f"{service}{'&' if '?' in service else '?'}{urllib.parse.urlencode(params)}"
    last: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=180) as r:
                payload = r.read()
                kind = r.headers.get("Content-Type", "")
            if "image" not in kind:
                # Servers report GetMap errors as XML with a 200.
                raise RuntimeError(f"{kind}: {payload[:200].decode('utf-8', 'replace')}")
            return Image.open(io.BytesIO(payload)).convert("RGB")
        except Exception as exc:  # noqa: BLE001
            last = exc
            print(f"      attempt {attempt + 1} failed: {type(exc).__name__}")
            time.sleep(2 * (attempt + 1))
    raise SystemExit(f"WMS failed after {retries} attempts: {last}")


def acquisitions(service: str, info_layer: str, epsg: str,
                 origin_e: float, origin_n: float, width_m: float, height_m: float) -> list[dict]:
    """When each part of the AOI was flown, from the service's own metadata layer.

    🔴 An orthophoto product is a MOSAIC OF CAMPAIGNS, and where two of them meet the picture
    steps. The Ahr's box is covered by two flights of 2023 that meet on the tile column at
    E = 360 000, just west of Altenahr: measured on 1.5 km of comparable ground either side, the
    eastern flight is **20 % darker**, 14 % lower in contrast and measurably warmer. On the
    cartographic surface that was invisible; with the photograph as the whole surface it reads as
    two different datasets, which is what it was first reported as.

    There is nothing to fetch differently: the service publishes no TIME dimension and no per-year
    layers (checked). So the honest move is to record it. `rp_dop20_info` answers GetFeatureInfo in
    text/plain with an `erstellung` date per 2 km tile; this walks the AOI and reports the distinct
    dates with their share.

    Non-fatal by design — only the Rheinland-Pfalz service is known to publish this layer, and an
    AOI whose survey does not is not a broken AOI.
    """
    if not info_layer:
        return []
    step = 2000.0  # the DOP tile grid
    found: dict[str, int] = {}
    edges: dict[str, tuple[float, float]] = {}
    eastings = [e + step / 2 for e in _frange(origin_e, origin_e + width_m, step)]
    northings = [origin_n + height_m * f for f in (0.3, 0.55, 0.8)]
    for northing in northings:
        for easting in eastings:
            params = {
                "SERVICE": "WMS",
                "VERSION": "1.3.0",
                "REQUEST": "GetFeatureInfo",
                "LAYERS": info_layer,
                "QUERY_LAYERS": info_layer,
                "STYLES": "",
                "CRS": epsg,
                "BBOX": f"{easting - 100},{northing - 100},{easting + 100},{northing + 100}",
                "WIDTH": "101",
                "HEIGHT": "101",
                "I": "50",
                "J": "50",
                # ⚠️ text/plain, not JSON: the service answers application/json with an
                # InvalidFormat ServiceException carried inside an HTTP 200.
                "INFO_FORMAT": "text/plain",
                "FEATURE_COUNT": "1",
            }
            url = f"{service}{'&' if '?' in service else '?'}{urllib.parse.urlencode(params)}"
            try:
                req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(req, timeout=60) as r:
                    body = r.read().decode("utf-8", "replace")
            except Exception:  # noqa: BLE001
                continue
            match = re.search(r"erstellung = '([^']*)'", body)
            if not match or match.group(1) in ("", "n/a"):
                continue
            date = match.group(1)
            found[date] = found.get(date, 0) + 1
            lo, hi = edges.get(date, (easting, easting))
            edges[date] = (min(lo, easting), max(hi, easting))
            time.sleep(0.1)
    total = sum(found.values()) or 1
    return [
        {
            "acquired": date,
            "samplePct": round(100 * count / total, 1),
            "eastingRange": [round(edges[date][0]), round(edges[date][1])],
        }
        for date, count in sorted(found.items(), key=lambda kv: -kv[1])
    ]


def _frange(start: float, stop: float, step: float) -> list[float]:
    out: list[float] = []
    value = (start // step) * step
    while value < stop:
        out.append(value)
        value += step
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="ahrtal-2021")
    parser.add_argument("--long-side", type=int, default=LONG_SIDE_PX)
    parser.add_argument(
        "--max-request-px",
        type=int,
        default=MAX_REQUEST_PX,
        help="upper bound on one GetMap; the service's own advertised limit wins if lower",
    )
    parser.add_argument("--quality", type=int, default=82, help="JPEG quality")
    parser.add_argument(
        "--dates-only",
        action="store_true",
        help="refresh the acquisition dates in drape.json without refetching the imagery",
    )
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    dop = (cfg.get("geobasis") or {}).get("dop")
    if not dop:
        raise SystemExit(
            f"AOI '{args.aoi}' has no geobasis.dop block. Add the service and layer for THIS "
            f"AOI's own survey authority — another state's imagery is the wrong picture under the "
            f"wrong licence."
        )

    terrain_dir = Path("public/terrain") / cfg["id"]
    meta = json.loads((terrain_dir / f"{terrain_name(cfg)}.json").read_text(encoding="utf-8"))

    # ⚠️ Align to the HEIGHTMAP GRID, not to the config bbox. The grid is the projected envelope
    # the terrain was actually built on, and the drape is sampled in the shader by the same uv the
    # heightmap uses. A drape covering the config's geographic bbox would be a few hundred metres
    # out and every building would sit beside its own roof.
    origin_e = meta["origin"]["easting"]
    origin_n = meta["origin"]["northing"]
    width_m = meta["width"] * meta["resolutionM"]
    height_m = meta["height"] * meta["resolutionM"]
    b = cfg["bbox"]
    zone = int(meta.get("utmZone") or zone_for_lon((b["west"] + b["east"]) / 2))
    epsg = epsg_for_zone(zone)

    scale = args.long_side / max(width_m, height_m)
    out_w = max(1, round(width_m * scale))
    out_h = max(1, round(height_m * scale))

    # Which flights cover this box. Cheap, and it is the difference between "the map looks like two
    # datasets" being a mystery and being a documented property of the source.
    info_layer = dop.get("infoLayer") or f"{dop['layer']}_info"
    flights = acquisitions(
        dop["service"], info_layer, epsg, origin_e, origin_n, width_m, height_m
    )
    if flights:
        print(f"  flight campaigns covering the AOI ({info_layer}):")
        for f in flights:
            print(
                f"    {f['acquired']}  {f['samplePct']:5.1f} % of samples  "
                f"E {f['eastingRange'][0]}–{f['eastingRange'][1]}"
            )
        if len(flights) > 1:
            # Plain ASCII: this prints to a cp1252 console, where an emoji raises
            # UnicodeEncodeError and kills the run after the work is already done.
            print("    NOTE: more than one campaign - expect a visible seam where they meet")
    else:
        print(f"  no acquisition metadata from {info_layer} (not every survey publishes it)")

    if args.dates_only:
        path = terrain_dir / "drape.json"
        if not path.exists():
            raise SystemExit("no drape.json yet — run without --dates-only first")
        existing = json.loads(path.read_text(encoding="utf-8"))
        existing["acquisitions"] = flights
        path.write_text(
            json.dumps(existing, indent=1, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        print(f"\nupdated {path} with {len(flights)} campaign(s); imagery untouched")
        return

    print(f"AOI {cfg['id']}  {width_m / 1000:.1f} x {height_m / 1000:.1f} km  {epsg} (zone {zone})")
    print(f"  drape {out_w} x {out_h} px  =  {width_m / out_w:.2f} m/px")
    print(f"  source {dop['service']}  layer {dop['layer']}")

    tile_px = advertised_max_px(dop["service"], args.max_request_px)

    cols = -(-out_w // tile_px)
    rows = -(-out_h // tile_px)
    print(f"  mosaic {cols} x {rows} request(s)")

    mosaic = Image.new("RGB", (out_w, out_h))
    for ry in range(rows):
        for rx in range(cols):
            x0 = rx * out_w // cols
            x1 = (rx + 1) * out_w // cols
            y0 = ry * out_h // rows
            y1 = (ry + 1) * out_h // rows
            # Pixel row 0 is north, so northing runs the other way.
            tile_bbox = (
                origin_e + x0 / out_w * width_m,
                origin_n + (1 - y1 / out_h) * height_m,
                origin_e + x1 / out_w * width_m,
                origin_n + (1 - y0 / out_h) * height_m,
            )
            print(f"    tile {rx},{ry}  {x1 - x0} x {y1 - y0} px")
            tile = fetch_tile(dop["service"], dop["layer"], epsg, tile_bbox, x1 - x0, y1 - y0)
            mosaic.paste(tile, (x0, y0))

    out_path = terrain_dir / "drape.jpg"
    mosaic.save(out_path, "JPEG", quality=args.quality, optimize=True, progressive=True)
    size_mb = out_path.stat().st_size / 1024 / 1024

    (terrain_dir / "drape.json").write_text(
        json.dumps(
            {
                "file": "drape.jpg",
                "width": out_w,
                "height": out_h,
                "metresPerPixel": round(width_m / out_w, 3),
                "crs": epsg,
                "utmZone": zone,
                "origin": {"easting": origin_e, "northing": origin_n},
                "extentM": {"width": width_m, "height": height_m},
                "alignedTo": f"{terrain_name(cfg)}.json",
                "source": dop["service"],
                "layer": dop["layer"],
                "licence": (cfg.get("geobasis") or {}).get("licence", ""),
                "attribution": (cfg.get("geobasis") or {}).get("attribution", ""),
                # Which flights this mosaic is made of. More than one means a visible seam where
                # they meet, and that is the source's property, not the renderer's.
                "acquisitions": flights,
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"\nwrote {out_path} ({size_mb:.1f} MB) and drape.json")

    # ⚠️ Measure the exposure HERE, not as a step someone has to remember. The drape's brightness
    # is a property of the image just written, and a fresh fetch that dropped `renderGamma` would
    # send the Ahr back to rendering as a near-black mass — with nothing failing and nothing said.
    # The correction is derived from the file, so it belongs to whatever produces the file.
    try:
        from measure_drape_exposure import main as measure_exposure

        sys.argv = ["measure_drape_exposure", "--aoi", cfg["id"]]
        measure_exposure()
    except Exception as exc:  # noqa: BLE001
        print(f"⚠️  exposure not measured ({type(exc).__name__}: {exc})")
        print("   run tools/geodata/measure_drape_exposure.py before deploying, or the drape")
        print("   renders at whatever brightness it was flown at.")


if __name__ == "__main__":
    main()
