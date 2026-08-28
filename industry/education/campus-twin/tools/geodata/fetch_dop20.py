"""Fetch the DOP20 orthophoto drape for the AOI core, via the LDBV WMS.

PLAN §7 phase 1 step 9 — the last terrain layer, and the one that makes the map photoreal rather
than cartographic.

⚠️ **This replaces the tile-download plan in §5.1, and the saving is large.** The plan assumed
DOP20 had to be pulled as 1 km GeoTIFF tiles — roughly 6 GB raw for this AOI — and mitigated that
with a streaming fetcher that downsampled and deleted each tile as it went. It turns out DOP20 is
not published as addressable tiles at all: the catalogue offers it by municipality, by district, or
as a **WMS**. A WMS is strictly better for a drape, because the request specifies the exact extent
*and the exact output resolution*. So instead of downloading 6 GB at 20 cm and throwing 97 % of it
away, this asks for the AOI once at the resolution the browser will actually use, and gets about
ten megabytes.

Resolution is a deliberate trade, not the source resolution:

  * 20 cm over a large core would be gigapixels, which no browser will hold and no GPU will sample.
  * The terrain mesh underneath is at 4 m posting. Detail far finer than that has nothing to sit
    on and only costs download.
  * The long side is capped so the browser can build a full mipmap chain for it — see the note in
    `main()`. This is a rendering limit, not a limit of the imagery.

The WMS caps a single request at 6500 px, so the mosaic is stitched from a few requests.

Output (public/terrain/<aoi-id>/):
  drape.jpg    the mosaic
  drape.json   extent, resolution, attribution

⚠️ **`--extent shell` renders the SAME imagery over the coarse outer tier**, and it is the reason
the horizon stopped being a lie. The shell was painted by a hypsometric ramp — pasture green
low, rock white high — which on the Isar gravel plain is 60 m of relief over 20 km, i.e. one flat
pale-green sheet where Munich, the Isar, the Forstenrieder Park and the airport all render as the
same colour. Ten kilometres of invented land around a photographed campus reads as a model on a
table. The same orthophoto at a coarser sampling makes the boundary invisible instead, because
both tiers then show the SAME ground at two sharpnesses.

⚠️ **Size the shell mosaic to the SCREEN, not to the source.** One texel per screen pixel when the
whole shell is in frame is the most that can ever be seen: 21.8 km across a 1600 px viewport is
13.6 m per pixel. Asking for more costs texture memory — the number that decides whether the app
runs — and buys nothing at any camera this app allows.

Usage
  python tools/geodata/fetch_dop20.py
  python tools/geodata/fetch_dop20.py --max-px 4096      # a lighter drape
  python tools/geodata/fetch_dop20.py --extent shell --max-px 1600
"""

from __future__ import annotations

import argparse
import io
import json
import time
import urllib.parse
import urllib.request

from PIL import Image

from aoi import bbox_wsen, load_aoi, terrain_dir
from utm import active_zone, bbox_to_utm

WMS = "https://geoservices.bayern.de/od/wms/dop/v1/dop20"

#: Verified 2026-07-29 against the service's GetCapabilities. `by_dop20c` is the true-colour
#: layer; the generic names the catalogue text suggests (`DOP20`, `dop20`) answer with a small
#: placeholder rather than imagery, which is exactly the failure that looks like success.
LAYER = "by_dop20c"

#: The service's advertised per-request limit.
MAX_REQUEST_PX = 6500

USER_AGENT = "Gleitschirm-Insights/0.1 (open geodata pipeline; +https://geodaten.bayern.de)"


def get_map(bbox: tuple[float, float, float, float], width: int, height: int) -> Image.Image:
    """One WMS GetMap, in the AOI's own UTM zone.

    WMS 1.3.0 uses each CRS's own axis order. EPSG:258xx is easting-then-northing, so the bbox goes
    out as minE,minN,maxE,maxN — the same order everything else in this pipeline uses. (For a
    geographic CRS such as EPSG:4326 it would be latitude first, which is the classic WMS 1.3.0
    trap and the reason this stays in UTM throughout.)

    ⚠️ THE CRS IS DERIVED, NOT WRITTEN DOWN. It was `EPSG:25832` until TU Berlin, which is
    EPSG:25833. `load_aoi` binds the zone from the AOI's `workingCrs` before this is ever called,
    and the bbox handed in here was projected into that same zone — so asking the WMS for a
    different one would fetch a photograph of somewhere several hundred kilometres away and fit it
    neatly over the campus. Deriving it from the same source as the coordinates makes the two
    unable to disagree.
    """
    params = {
        "SERVICE": "WMS",
        "REQUEST": "GetMap",
        "VERSION": "1.3.0",
        "LAYERS": LAYER,
        "STYLES": "",
        "CRS": f"EPSG:258{active_zone()}",
        "BBOX": f"{bbox[0]:.2f},{bbox[1]:.2f},{bbox[2]:.2f},{bbox[3]:.2f}",
        "WIDTH": str(width),
        "HEIGHT": str(height),
        "FORMAT": "image/jpeg",
    }
    url = f"{WMS}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=300) as response:
        blob = response.read()
        content_type = response.headers.get("Content-Type", "")

    # A WMS reports failure as a 200 with an XML service exception. Saving that as .jpg and
    # carrying on is how a drape ends up as a grey rectangle three steps later.
    if "xml" in content_type or blob[:5] == b"<?xml":
        raise RuntimeError(f"WMS service exception: {blob[:400].decode('utf-8', 'replace')}")

    return Image.open(io.BytesIO(blob)).convert("RGB")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="oth-regensburg")
    parser.add_argument(
        "--max-px",
        type=int,
        default=None,
        help="long side of the mosaic (default: the AOI's drape.maxPx, else 4096)",
    )
    parser.add_argument("--quality", type=int, default=84, help="output JPEG quality")
    parser.add_argument(
        "--extent",
        choices=("core", "shell"),
        default="core",
        help="which tier to photograph (default: core)",
    )
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    # ⚠️ **Long side, and it is a rendering constraint rather than a photographic one.**
    #
    # This defaulted to 8192 px on the reasoning that WebGL2 guarantees an 8192 texture limit.
    # That is true and it is not the binding constraint: the drape is uploaded WITH MIPMAPS, and
    # an 8192 x 6788 RGBA mipmap chain is roughly 300 MB. Chromium accepted the texture, silently
    # failed to complete the mipmap chain, and every sample came back BLACK — a campus rendered as
    # a black lozenge under correctly-lit buildings, with no error anywhere.
    #
    # 4096 px keeps the chain near 75 MB, which uploads reliably. For a 2.5 km core that is about
    # 0.6 m per pixel: still far finer than the 4 m terrain mesh underneath it, and sharp enough to
    # read road markings. Mipmaps are worth more than the extra pixels, because the drape is almost
    # always viewed at a grazing angle where the missing ones shimmer.
    max_px = args.max_px or int(cfg.get("drape", {}).get("maxPx", 4096))
    shell_tier = args.extent == "shell"
    if shell_tier and args.max_px is None:
        # See the module note: one texel per screen pixel at the widest shot, and no more.
        max_px = int(cfg.get("shellDrape", {}).get("maxPx", 1600))
    out_dir = terrain_dir(cfg)
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = "shell-drape" if shell_tier else "drape"
    image_path = out_dir / f"{stem}.jpg"
    meta_path = out_dir / f"{stem}.json"
    if image_path.exists() and meta_path.exists() and not args.force:
        print(f"cached: {image_path} (use --force to re-fetch)")
        return

    # ⚠️ The drape has to line up with the heightmap exactly, so its extent is read from the
    # terrain metadata rather than recomputed from the bbox. build_terrain.py snaps the grid origin
    # to a whole multiple of the resolution; recomputing here would land a few metres off and slide
    # the whole photograph sideways across the mountain.
    #
    # ⚠️ The same argument applies to the shell, against `shell.json` — and it matters MORE there,
    # because the shell mesh is positioned from that origin while the core is the world origin. An
    # extent recomputed from the bbox would slide the photograph across the shell by whatever
    # build_shell.py's own snapping moved it.
    terrain_meta_path = out_dir / ("shell.json" if shell_tier else "heightmap.json")
    if terrain_meta_path.exists():
        terrain = json.loads(terrain_meta_path.read_text(encoding="utf-8"))
        min_e = float(terrain["origin"]["easting"])
        min_n = float(terrain["origin"]["northing"])
        max_e = min_e + terrain["width"] * terrain["resolutionM"]
        max_n = min_n + terrain["height"] * terrain["resolutionM"]
        print(f"extent taken from the generated {terrain_meta_path.name}")
    else:
        min_e, min_n, max_e, max_n = bbox_to_utm(*bbox_wsen(cfg, args.extent))
        print("⚠️ no heightmap yet — extent derived from the AOI bbox, which may not match")

    span_e = max_e - min_e
    span_n = max_n - min_n
    print(f"{args.extent}: {span_e / 1000:.2f} x {span_n / 1000:.2f} km from {min_e:.0f}/{min_n:.0f}")

    if span_e >= span_n:
        width = max_px
        height = int(round(max_px * span_n / span_e))
    else:
        height = max_px
        width = int(round(max_px * span_e / span_n))

    print(f"mosaic: {width} x {height} px, {span_e / width:.2f} m per pixel")

    # How many requests each axis needs to stay inside the service's limit.
    cols = -(-width // MAX_REQUEST_PX)
    rows = -(-height // MAX_REQUEST_PX)
    print(f"requests: {cols} x {rows}")

    mosaic = Image.new("RGB", (width, height))
    started = time.time()
    done = 0

    for row in range(rows):
        # Pixel bounds of this patch. Computing them by rounding the fractional split keeps the
        # patches exactly adjacent — deriving each patch's size independently leaves one-pixel
        # seams that show up as a grid across the finished drape.
        y0 = round(row * height / rows)
        y1 = round((row + 1) * height / rows)
        for col in range(cols):
            x0 = round(col * width / cols)
            x1 = round((col + 1) * width / cols)

            # Pixel bounds back to ground coordinates. Row 0 is the NORTH edge, so northing
            # decreases as the row index grows.
            patch_bbox = (
                min_e + span_e * x0 / width,
                max_n - span_n * y1 / height,
                min_e + span_e * x1 / width,
                max_n - span_n * y0 / height,
            )
            patch = get_map(patch_bbox, x1 - x0, y1 - y0)
            mosaic.paste(patch, (x0, y0))
            done += 1
            print(f"  [{done}/{cols * rows}] {x1 - x0} x {y1 - y0} px, {time.time() - started:.0f}s")

    mosaic.save(image_path, "JPEG", quality=args.quality, optimize=True, progressive=True)

    meta = {
        "aoi": cfg["id"],
        "file": image_path.name,
        "width": width,
        "height": height,
        "resolutionM": round(span_e / width, 4),
        "crs": "EPSG:25832",
        "origin": {"easting": min_e, "northing": min_n},
        "spanM": {"east": span_e, "north": span_n},
        "encoding": "JPEG, row 0 = north — same orientation as the heightmap",
        "source": "Digitale Orthophotos DOP20, Bayerische Vermessungsverwaltung (LDBV)",
        "service": WMS,
        "layer": LAYER,
        "licence": "CC BY 4.0",
        "attribution": (
            "Datenquelle: Bayerische Vermessungsverwaltung – www.geodaten.bayern.de "
            "[Daten bearbeitet]"
        ),
        "resolutionNote": (
            "The source is 20 cm. This drape is resampled by the WMS to about "
            f"{span_e / width:.1f} m per pixel, because the terrain mesh beneath it is at 16 m "
            "posting and a 2-gigapixel texture is neither loadable nor useful. It is a "
            "photograph of the ground, not a measurement, and nothing is derived from it."
        ),
        "acquisition": "LDBV Bayernbefliegung; the flight date varies by tile and is not per-pixel",
    }
    meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"\nwrote {image_path} ({image_path.stat().st_size / 1e6:.1f} MB)")
    print(f"wrote {meta_path}")


if __name__ == "__main__":
    main()
