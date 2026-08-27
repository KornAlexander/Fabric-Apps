"""Fetch high-resolution aerial detail tiles, one small window per focus place.

`fetch_drape.py` gets one photograph for the whole AOI, and it is as sharp as one photograph for
the whole AOI can be. The Ahr's box is 23.6 x 8.0 km and WebGL2 guarantees only 8192 px on a
texture side, so the drape lands at **2.878 m/px** — while the source, Rheinland-Pfalz's DOP20, is
flown at **0.20 m**. Fourteen times the detail exists and is free; it simply has nowhere to sit in
a single texture.

So this fetches the missing sharpness the only way it fits: as small windows, centred on the
places the camera actually goes, loaded one at a time and only when the viewer asks for them.

🔴 THE SIZE IS SET BY THE HOST, NOT BY TASTE. Rayfin static hosting refuses a package over
**100 MB compressed**, and the rest of this app already takes 71.9 MB of that. Photographs do not
compress, so the tiles cost their file size: a first cut at 0.25 m/px and 0.50 m/px over two tiers
came to 154 MB, the package to 226.4 MB, and the deploy failed outright. One tier of
**1024 m at 2048 px = 0.50 m/px** costs about 1.2 MB a village, ~24 MB for the valley, and fits
with room to spare. That is still **5.8x** the base drape, and finer than a screen pixel at any
range where the window is on screen at all.

The tier list is data, not a constant to argue with — add one back if the host's limit ever moves,
or if the tiles are ever served from somewhere that is not the app package.

⚠️ The window is expressed in the SAME uv the heightmap and the base drape are sampled by, taken
from the terrain sidecar's own `focusPlaces`. It is not derived from the config bbox: the grid is
the projected envelope the terrain was actually built on, and a rect a few hundred metres out
would put every roof beside its own building — the failure mode `fetch_drape.py` warns about, at
eleven times the resolution and therefore eleven times as obvious.

⚠️ Exposure is INHERITED from the base drape, and that is the opposite of what it first did.
Measuring each tile against an absolute target looked more rigorous and was wrong: the window is
blended into the base photograph, so what it has to match is not a constant, it is the brightness
of the drape AT THAT PLACE. Correcting a tile to a target of its own made every window render
darker than the ground it sat in — measured at 1.77x on a rendered frame — and would have put a
visible halo on the feathered edge. The tile's own mean is still measured, as a CHECK: the same
ground photographed twice must have the same brightness, and a tile that disagrees is a tile of
somewhere else.

Output (public/terrain/<aoi-id>/):
  drape_detail/<place>_<tier>.jpg   the windows
  drape_detail.json                 tiers, rects, exposure, provenance

Usage
  python tools/geodata/fetch_drape_detail.py --aoi ahrtal-2021
  python tools/geodata/fetch_drape_detail.py --aoi ahrtal-2021 --places altenahr,dernau
  python tools/geodata/fetch_drape_detail.py --aoi ahrtal-2021 --tier near --force
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from aoi import load_aoi, terrain_name  # noqa: E402
from fetch_drape import advertised_max_px, fetch_tile  # noqa: E402
from measure_drape_exposure import mean_ground_luma  # noqa: E402
from utm import epsg_for_zone, zone_for_lon  # noqa: E402

#: The window sizes, coarsest last. `spanM` is the side of the square on the ground.
#:
#: 🔴 One tier, and 2048 px rather than 4096, because the host caps the deployed package at 100 MB
#: compressed — see the module docstring. 2048 is also a power of two, so the mipmap chain the
#: renderer builds for grazing angles is exact, and one resident tile is ~17 MB of texture memory.
TIERS: tuple[dict[str, int | str], ...] = (
    {"id": "near", "spanM": 1024, "px": 2048},
)


#: How far a tile's mean brightness may sit from the base drape's over the same ground.
#:
#: They are the same survey photographed at two resolutions, so they should agree closely — the
#: forty Ahr tiles agree to within 0.003. A larger gap means the crop is not where the rect says it
#: is, which is the one failure a sharp, plausible photograph would otherwise hide.
BRIGHTNESS_TOLERANCE = 0.05


def fetch_window(
    service: str,
    layer: str,
    epsg: str,
    centre_e: float,
    centre_n: float,
    span_m: float,
    px: int,
    tile_px: int,
) -> Image.Image:
    """One square window, stitched from as many GetMap requests as the service will allow."""
    steps = -(-px // tile_px)
    out = Image.new("RGB", (px, px))
    half = span_m / 2
    for ry in range(steps):
        for rx in range(steps):
            x0, x1 = rx * px // steps, (rx + 1) * px // steps
            y0, y1 = ry * px // steps, (ry + 1) * px // steps
            # Pixel row 0 is north, so northing runs the other way.
            bbox = (
                centre_e - half + x0 / px * span_m,
                centre_n + half - y1 / px * span_m,
                centre_e - half + x1 / px * span_m,
                centre_n + half - y0 / px * span_m,
            )
            out.paste(fetch_tile(service, layer, epsg, bbox, x1 - x0, y1 - y0), (x0, y0))
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--aoi", default="ahrtal-2021")
    ap.add_argument("--places", default=None, help="comma-separated focus place ids; default all")
    ap.add_argument("--tier", default=None, help="one tier id; default every tier")
    ap.add_argument("--quality", type=int, default=82, help="JPEG quality")
    ap.add_argument("--max-request-px", type=int, default=4000)
    ap.add_argument("--force", action="store_true", help="refetch tiles that already exist")
    args = ap.parse_args()

    cfg = load_aoi(args.aoi)
    dop = (cfg.get("geobasis") or {}).get("dop")
    if not dop:
        raise SystemExit(
            f"AOI '{args.aoi}' has no geobasis.dop block. Detail tiles come from the same service "
            f"as the base drape and from no other — another state's imagery is the wrong picture "
            f"under the wrong licence."
        )

    terrain_dir = Path("public/terrain") / cfg["id"]
    meta = json.loads((terrain_dir / f"{terrain_name(cfg)}.json").read_text(encoding="utf-8"))

    # The base drape is the reference for BOTH exposure and position: the windows are blended into
    # it, so a tile that disagrees with it about either is wrong even if it is a perfect photograph.
    base_meta_path = terrain_dir / "drape.json"
    if not base_meta_path.exists():
        raise SystemExit(
            "No base drape for this AOI. Run tools/geodata/fetch_drape.py first — the detail "
            "windows are a refinement of that photograph, not a replacement for it."
        )
    base_meta = json.loads(base_meta_path.read_text(encoding="utf-8"))
    base_gamma = float(base_meta.get("renderGamma", 1.0))
    Image.MAX_IMAGE_PIXELS = None
    base_image = Image.open(terrain_dir / base_meta["file"])

    origin_e = meta["origin"]["easting"]
    origin_n = meta["origin"]["northing"]
    width_m = meta["width"] * meta["resolutionM"]
    height_m = meta["height"] * meta["resolutionM"]
    b = cfg["bbox"]
    zone = int(meta.get("utmZone") or zone_for_lon((b["west"] + b["east"]) / 2))
    epsg = epsg_for_zone(zone)

    places = meta.get("focusPlaces") or []
    if args.places:
        wanted = {p.strip() for p in args.places.split(",") if p.strip()}
        missing = wanted - {p["id"] for p in places}
        if missing:
            raise SystemExit(f"unknown focus place(s): {', '.join(sorted(missing))}")
        places = [p for p in places if p["id"] in wanted]
    tiers = [t for t in TIERS if args.tier in (None, t["id"])]
    if not tiers:
        raise SystemExit(f"unknown tier '{args.tier}'; have {[t['id'] for t in TIERS]}")

    out_dir = terrain_dir / "drape_detail"
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = terrain_dir / "drape_detail.json"

    print(f"AOI {cfg['id']}  grid {width_m / 1000:.1f} x {height_m / 1000:.1f} km  {epsg}")
    print(f"  source {dop['service']}  layer {dop['layer']}")
    print(f"  base drape {base_meta['metresPerPixel']} m/px, render gamma {base_gamma} (inherited)")
    tile_px = advertised_max_px(dop["service"], args.max_request_px)

    entries: list[dict] = []
    total_bytes = 0
    worst_gap = 0.0
    for place in places:
        tiles: dict[str, dict] = {}
        for tier in tiers:
            span_m = float(tier["spanM"])
            px = int(tier["px"])
            name = f"{place['id']}_{tier['id']}.jpg"
            path = out_dir / name

            # Keep the whole window inside the grid. A place near the edge would otherwise get a
            # rect running past the terrain, and the shader would blend the photograph into ground
            # that has no elevation under it.
            half_u = span_m / width_m / 2
            half_v = span_m / height_m / 2
            cu = min(max(float(place["u"]), half_u), 1 - half_u)
            cv = min(max(float(place["v"]), half_v), 1 - half_v)
            centre_e = origin_e + cu * width_m
            centre_n = origin_n + (1 - cv) * height_m

            # Only the DOWNLOAD is skipped when a tile is already on disk. The measurements below
            # are recomputed every run and are cheap next to 4 MB over the wire — so the manifest
            # can be corrected, or a new check added, without refetching 154 MB from a public
            # service that has no obligation to serve it twice.
            reused = path.exists() and not args.force
            print(f"  {place['id']:<16} {tier['id']:<5} {span_m:.0f} m @ {px} px", end="", flush=True)
            if reused:
                image = Image.open(path).convert("RGB")
            else:
                image = fetch_window(
                    dop["service"], dop["layer"], epsg, centre_e, centre_n, span_m, px, tile_px
                )
                image.save(path, "JPEG", quality=args.quality, optimize=True, progressive=True)

            # The same ground, out of the photograph that is already known to be aligned.
            bw, bh = base_image.size
            rect = (cu - half_u, cv - half_v, cu + half_u, cv + half_v)
            crop = base_image.crop(
                (
                    round(rect[0] * bw),
                    round(rect[1] * bh),
                    round(rect[2] * bw),
                    round(rect[3] * bh),
                )
            )
            luma, _ = mean_ground_luma(image)
            base_luma, _ = mean_ground_luma(crop)
            gap = abs(luma - base_luma)
            worst_gap = max(worst_gap, gap)
            flag = "  ⚠ OFF THE BASE DRAPE" if gap > BRIGHTNESS_TOLERANCE else ""
            size = path.stat().st_size
            total_bytes += size
            print(
                f"  = {span_m / px:.3f} m/px  {size / 1e6:.2f} MB  "
                f"luma {luma:.3f} vs base {base_luma:.3f}{flag}{'  [on disk]' if reused else ''}"
            )

            tiles[str(tier["id"])] = {
                "file": f"drape_detail/{name}",
                "px": px,
                "spanM": span_m,
                "metresPerPixel": round(span_m / px, 4),
                "bytes": size,
                # Inherited on purpose — see the module docstring. The window has to disappear into
                # the photograph around it, and that photograph is corrected AOI-wide.
                "renderGamma": base_gamma,
                "meanGroundLuma": round(luma, 4),
                "baseGroundLuma": round(base_luma, 4),
                # The window in the uv the heightmap, the base drape and the buildings all share.
                "rect": {
                    "u0": round(cu - half_u, 8),
                    "v0": round(cv - half_v, 8),
                    "u1": round(cu + half_u, 8),
                    "v1": round(cv + half_v, 8),
                },
                "centre": {"easting": round(centre_e, 2), "northing": round(centre_n, 2)},
            }

        if tiles:
            entries.append({"id": place["id"], "name": place["name"], "tiles": tiles})

    manifest_path.write_text(
        json.dumps(
            {
                "alignedTo": f"{terrain_name(cfg)}.json",
                "crs": epsg,
                "utmZone": zone,
                "tiers": [
                    {
                        "id": t["id"],
                        "spanM": t["spanM"],
                        "px": t["px"],
                        "metresPerPixel": round(float(t["spanM"]) / int(t["px"]), 4),
                    }
                    for t in TIERS
                ],
                "source": dop["service"],
                "layer": dop["layer"],
                "licence": (cfg.get("geobasis") or {}).get("licence", ""),
                "attribution": (cfg.get("geobasis") or {}).get("attribution", ""),
                # ⚠️ Same standing caveat as the base drape, and it matters more here: at 25 cm you
                # can see individual rebuilt houses. This is the CURRENT flight, not July 2021.
                "acquisitionNote": (
                    "Aktuelles DOP20, kein Zustand von 2021. Die Befliegung fand nach Flut und "
                    "Wiederaufbau statt."
                ),
                "places": entries,
            },
            ensure_ascii=False,
            indent=1,
        )
        + "\n",
        encoding="utf-8",
    )
    print(
        f"\nwrote {manifest_path} — {len(entries)} place(s), "
        f"{sum(len(e['tiles']) for e in entries)} tile(s), {total_bytes / 1e6:.1f} MB on disk"
    )
    print(f"  worst brightness gap against the base drape: {worst_gap:.3f}")
    print("  (lazy: a visitor downloads at most one tile per tier, and only in photoreal mode)")


if __name__ == "__main__":
    main()
