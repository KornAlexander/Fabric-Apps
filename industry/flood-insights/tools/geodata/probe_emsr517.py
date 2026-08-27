"""Probe the Copernicus EMS EMSR517 product catalogue and check which AOIs cover our focus places.

PLAN §4.3 flags this as a Phase 1 verification: if the AOIs do not cover Altenahr and Dernau, the
validation metric (§6.5) can only be computed for the places that are covered, and that limitation
has to be stated in the UI rather than quietly ignored.

Usage
  python tools/geodata/probe_emsr517.py --out data/raw/emsr517
"""

from __future__ import annotations

import argparse
import io
import json
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

from aoi import load_aoi

S3_BASE = "https://cems-mapping-website.s3.eu-west-1.amazonaws.com/static/activations"
ACTIVATION = "EMSR517"

# Product/type combinations seen in EMSR517. Delineation is the observed flood extent we validate
# against; Monitoring products show the evolution.
PRODUCT_CODES = ["DEL_PRODUCT", "DEL_MONIT01", "DEL_MONIT02", "GRA_PRODUCT", "GRA_MONIT01"]


def candidate_urls(aoi_number: int) -> list[str]:
    aoi = f"AOI{aoi_number:02d}"
    return [
        f"{S3_BASE}/{ACTIVATION}/{ACTIVATION}_{aoi}_{code}_r1_RTP01_v1_vector.zip"
        for code in PRODUCT_CODES
    ]


def head(url: str) -> int | None:
    """Return content length if the object exists, else None."""
    req = urllib.request.Request(url, method="HEAD")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310 - fixed https host
            return int(resp.headers.get("Content-Length", 0))
    except urllib.error.HTTPError:
        return None
    except urllib.error.URLError as exc:
        print(f"  network error for {url}: {exc}")
        return None


def download(url: str, target: Path) -> Path:
    target.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=180) as resp:  # noqa: S310 - fixed https host
        target.write_bytes(resp.read())
    return target


def shapefile_bounds(zip_bytes: bytes) -> dict[str, tuple[float, float, float, float]]:
    """Read bounding boxes straight out of the .shp headers — no geo library needed.

    A shapefile header stores the bbox as 4 little-endian doubles at byte offset 36.
    """
    import struct

    bounds: dict[str, tuple[float, float, float, float]] = {}
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        for name in zf.namelist():
            if not name.lower().endswith(".shp"):
                continue
            header = zf.read(name)[:100]
            xmin, ymin, xmax, ymax = struct.unpack("<4d", header[36:68])
            bounds[name] = (xmin, ymin, xmax, ymax)
    return bounds


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="ahrtal-2021", help="AOI config id")
    parser.add_argument("--out", type=Path, default=Path("data/raw/emsr517"))
    parser.add_argument("--max-aoi", type=int, default=21, help="EMSR517 has 21 AOIs")
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    print(f"AOI config: {cfg['id']}  bbox={cfg['bbox']['west']}..{cfg['bbox']['east']} E, "
          f"{cfg['bbox']['south']}..{cfg['bbox']['north']} N")
    print(f"focus places: {', '.join(p['name'] for p in cfg['focusPlaces'])}\n")

    found: list[dict] = []
    for n in range(1, args.max_aoi + 1):
        for url in candidate_urls(n):
            size = head(url)
            if size:
                label = url.rsplit("/", 1)[-1]
                print(f"  AOI{n:02d}  {label}  {size / 1024:.0f} KB")
                found.append({"aoi": n, "url": url, "bytes": size})

    if not found:
        print("\nNo products reachable with the assumed URL pattern.")
        print("The pattern in PLAN §4.3 may have changed — re-check the activation page.")

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "catalogue.json").write_text(
        json.dumps({"activation": ACTIVATION, "products": found}, indent=2), encoding="utf-8"
    )
    print(f"\nwrote {args.out / 'catalogue.json'} ({len(found)} products)")


if __name__ == "__main__":
    main()
