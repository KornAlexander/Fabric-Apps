"""Download EMSR517 vector products and report which ones actually cover the AOI focus places.

Answers the PLAN §4.3 open question: are Altenahr and Dernau inside a Copernicus AOI, or can the
validation metric (§6.5) only be computed for part of the valley?

Reads bounding boxes directly out of the shapefile headers, so no GDAL/geopandas dependency.

Usage
  python tools/geodata/check_emsr517_coverage.py --out data/raw/emsr517
"""

from __future__ import annotations

import argparse
import io
import json
import struct
import urllib.request
import zipfile
from pathlib import Path

from aoi import load_aoi


def fetch(url: str, cache: Path) -> bytes:
    cache.parent.mkdir(parents=True, exist_ok=True)
    if cache.exists():
        return cache.read_bytes()
    with urllib.request.urlopen(url, timeout=300) as resp:  # noqa: S310 - fixed https host
        data = resp.read()
    cache.write_bytes(data)
    return data


def read_layers(zip_bytes: bytes) -> list[dict]:
    """Return one entry per .shp: name, bbox from the header, and the .prj text if present."""
    layers: list[dict] = []
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        names = zf.namelist()
        for name in names:
            if not name.lower().endswith(".shp"):
                continue
            header = zf.read(name)[:100]
            xmin, ymin, xmax, ymax = struct.unpack("<4d", header[36:68])
            prj_name = name[:-4] + ".prj"
            prj = zf.read(prj_name).decode("utf-8", "replace") if prj_name in names else ""
            layers.append(
                {
                    "layer": Path(name).name,
                    "bbox": [xmin, ymin, xmax, ymax],
                    "crs": prj.split('"')[1] if '"' in prj else prj[:60],
                }
            )
    return layers


def covers(bbox: list[float], lon: float, lat: float) -> bool:
    """Only meaningful for geographic bboxes — projected layers are reported, not tested."""
    xmin, ymin, xmax, ymax = bbox
    return xmin <= lon <= xmax and ymin <= lat <= ymax


def looks_geographic(bbox: list[float]) -> bool:
    return all(abs(v) <= 180 for v in bbox)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="ahrtal-2021")
    parser.add_argument("--out", type=Path, default=Path("data/raw/emsr517"))
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    places = cfg["focusPlaces"]
    catalogue = json.loads((args.out / "catalogue.json").read_text(encoding="utf-8"))

    results = []
    for product in catalogue["products"]:
        url = product["url"]
        filename = url.rsplit("/", 1)[-1]
        print(f"\n{filename}")
        try:
            data = fetch(url, args.out / filename)
        except Exception as exc:  # noqa: BLE001 - report and continue over 20 products
            print(f"  download failed: {exc}")
            continue

        layers = read_layers(data)
        if not layers:
            print("  no shapefiles inside")
            continue

        # One representative bbox per product — layers within a product share an extent.
        bbox = layers[0]["bbox"]
        crs = layers[0]["crs"]
        print(f"  crs={crs}")
        print(f"  bbox={[round(v, 4) for v in bbox]}")

        entry = {"product": filename, "aoi": product["aoi"], "crs": crs, "bbox": bbox}
        if looks_geographic(bbox):
            hits = [p["name"] for p in places if covers(bbox, p["lon"], p["lat"])]
            entry["covers"] = hits
            print(f"  covers: {', '.join(hits) if hits else '— none of the focus places'}")
        else:
            entry["covers"] = None
            print("  projected CRS — reproject before testing coverage")
        results.append(entry)

    out_file = args.out / "coverage.json"
    out_file.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"\nwrote {out_file}")

    covering = [r for r in results if r.get("covers")]
    if covering:
        print("\nProducts covering focus places:")
        for r in covering:
            print(f"  {r['product']} -> {', '.join(r['covers'])}")
    else:
        print("\nNo product bbox contains a focus place in geographic coordinates.")


if __name__ == "__main__":
    main()
