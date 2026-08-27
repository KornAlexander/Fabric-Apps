"""Copernicus EMS activation catalogue — any activation, not just EMSR517.

`probe_emsr517.py` walks a fixed S3 path that only exists for older activations:

    .../static/activations/EMSR517/EMSR517_AOI15_GRA_PRODUCT_r1_RTP01_v1_vector.zip

That returns 404 for everything recent. Copernicus now serves the catalogue from a
dashboard API, and the products either as one archive per activation or as public vector
tiles per layer. This asks the API instead, so a new area of interest starts from the
footprints Copernicus actually published rather than from a guessed AOI number.

Usage
  python tools/geodata/fetch_copernicus.py --activation EMSR773 --list
  python tools/geodata/fetch_copernicus.py --activation EMSR659 --out data/raw/emsr659 --download
"""

from __future__ import annotations

import argparse
import json
import re
import urllib.error
import urllib.request
from pathlib import Path

DASHBOARD = (
    "https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api/public-activations/?code="
)
VIEWER_BUCKET = "https://rapidmapping-viewer.s3.eu-west-1.amazonaws.com"
UA = {"User-Agent": "flut-insights/1.0 (+https://github.com/KornAlexander/Flut-Insights)"}

# Layers worth having. `observedEventA` is the extent the Ahr validation compares against;
# `floodDepthA` is newer and richer, and not published for every activation.
LAYERS = ("observedEventA", "maximumFloodExtentA", "floodDepthA")


class ActivationNotPublic(RuntimeError):
    """The API answered, but not with an activation — usually restricted or withdrawn."""


def bbox_from_wkt(wkt: str | None) -> tuple[float, float, float, float] | None:
    """West, south, east, north from a POLYGON/POINT WKT, without a geometry library.

    The API returns axis-aligned envelopes, so pulling the coordinate pairs out and taking
    the extremes is exact rather than an approximation.
    """
    if not wkt:
        return None
    nums = [float(v) for v in re.findall(r"-?\d+(?:\.\d+)?", wkt)]
    if len(nums) < 2:
        return None
    xs, ys = nums[0::2], nums[1::2]
    return (min(xs), min(ys), max(xs), max(ys))


def approx_span_km(box: tuple[float, float, float, float]) -> tuple[float, float]:
    """Rough width and height in kilometres, for judging whether an AOI is a usable size."""
    import math

    west, south, east, north = box
    mid = math.radians((south + north) / 2)
    return ((east - west) * 111.32 * math.cos(mid), (north - south) * 110.57)


def fetch_activation(code: str) -> dict:
    req = urllib.request.Request(DASHBOARD + code, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310 - fixed https host
            payload = json.loads(resp.read())
    except urllib.error.HTTPError as err:
        # Older activations predate this API and answer 403. EMSR517, the Ahr valley, is one of
        # them: it is served only from the legacy S3 layout that probe_emsr517.py walks. Saying so
        # is more use than a traceback, because the answer is "use the other tool", not "retry".
        if err.code in (403, 404):
            raise ActivationNotPublic(
                f"{code}: not in the rapid-mapping API (HTTP {err.code}). Activations from "
                f"roughly 2022 and earlier are only on the legacy S3 layout — use "
                f"probe_emsr517.py for those."
            ) from err
        raise
    items = payload if isinstance(payload, list) else payload.get("results", [payload])
    if not items or not isinstance(items[0], dict) or not items[0].get("code"):
        raise ActivationNotPublic(f"{code}: no public activation record")
    return items[0]


def summarise(activation: dict) -> dict:
    """The bits an AOI definition needs, and nothing else."""
    aois = []
    for aoi in activation.get("aois") or []:
        box = bbox_from_wkt(aoi.get("extent"))
        products = sorted(
            {p.get("type", "") if isinstance(p, dict) else str(p) for p in (aoi.get("products") or [])}
        )
        aois.append(
            {
                "number": aoi.get("number"),
                "name": aoi.get("name"),
                "bbox": box,
                "spanKm": [round(v, 1) for v in approx_span_km(box)] if box else None,
                "products": products,
            }
        )
    return {
        "code": activation.get("code"),
        "name": activation.get("name"),
        "category": activation.get("category"),
        "subCategory": activation.get("subCategory"),
        "countries": [c.get("name") for c in (activation.get("countries") or [])],
        "eventTimeUtc": activation.get("eventTime"),
        "activationTimeUtc": activation.get("activationTime"),
        "extent": bbox_from_wkt(activation.get("extent")),
        "productsPath": activation.get("productsPath"),
        "viewerBucket": activation.get("aws_bucket") or VIEWER_BUCKET,
        "aois": aois,
    }


def vector_tile_base(code: str, aoi_number: int, product: str, layer: str) -> str:
    """Where the public vector tiles for one layer live.

    Used when the bulk archive is restricted — the tiles stay public even then.
    """
    aoi = f"AOI{aoi_number:02d}"
    return f"{VIEWER_BUCKET}/{code}/{aoi}/{product}/{code}_{aoi}_{product}_{layer}_v1_VT"


def download_products(summary: dict, out: Path) -> Path | None:
    """Fetch the one-archive-per-activation bundle, if Copernicus publishes it.

    Not every activation has one. A 403 here is a fact about the archive, not a bug, so it
    is reported with the tile route rather than raised.
    """
    url = summary.get("productsPath")
    if not url:
        print("   no productsPath on this activation")
        return None
    out.mkdir(parents=True, exist_ok=True)
    target = out / f"{summary['code']}_products.zip"
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=1800) as resp:  # noqa: S310 - fixed https host
            target.write_bytes(resp.read())
    except urllib.error.HTTPError as err:
        print(f"   archive not available ({err.code}). Vector tiles are still public, e.g.")
        first = next((a for a in summary["aois"] if a.get("number")), None)
        if first:
            print("     " + vector_tile_base(summary["code"], first["number"], "DEL_PRODUCT", LAYERS[0]))
        return None
    print(f"   {target}  {target.stat().st_size / 1048576:.1f} MB")
    return target


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--activation", required=True, help="e.g. EMSR773")
    parser.add_argument("--out", type=Path, help="write the manifest (and archive) here")
    parser.add_argument("--list", action="store_true", help="print the AOIs")
    parser.add_argument("--download", action="store_true", help="also fetch the products archive")
    parser.add_argument("--min-span-km", type=float, default=0.0,
                        help="only list AOIs at least this wide, to skip pinpoint products")
    args = parser.parse_args()

    try:
        summary = summarise(fetch_activation(args.activation))
    except ActivationNotPublic as err:
        raise SystemExit(str(err)) from err

    print(f"{summary['code']} — {summary['name']}")
    print(f"  {summary['category']} / {summary['subCategory']}  ·  "
          f"{', '.join(summary['countries'])}  ·  event {(summary['eventTimeUtc'] or '')[:16]}")
    print(f"  extent {summary['extent']}")
    print(f"  {len(summary['aois'])} AOIs")

    if args.list:
        for aoi in summary["aois"]:
            span = aoi["spanKm"]
            if span and args.min_span_km and max(span) < args.min_span_km:
                continue
            size = f"{span[0]:6.1f} x {span[1]:5.1f} km" if span else " " * 18
            print(f"    AOI{aoi['number']:02d}  {aoi['name']:<22} {size}  {','.join(aoi['products'])}")

    if args.out:
        args.out.mkdir(parents=True, exist_ok=True)
        manifest = args.out / f"{summary['code']}_manifest.json"
        manifest.write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"  manifest -> {manifest}")
        if args.download:
            download_products(summary, args.out)


if __name__ == "__main__":
    main()
