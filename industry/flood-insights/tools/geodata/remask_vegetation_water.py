"""Apply the water mask (and the corrected credit) to a vegetation build already on disk.

⚠️ This exists because `build_vegetation.py` cannot be re-run for every AOI. It derives trees from
DOM1 minus DGM1, and the Steinbach surface tiles are no longer in `data/raw/` — only the Ahr's
`_rp_` tiles remain. Re-downloading NRW's models to delete 290 trees would be the wrong trade, and
leaving 290 trees standing in the reservoir of a dam-break scene would be worse.

So the mask is applied to the built file instead. It is the SAME mask: `water_mask` and `on_water`
are imported from the builder rather than reimplemented, so the two cannot drift apart, and a fresh
build already excludes these trees at source. Running this on a freshly built AOI is a no-op, which
is the check that they agree.

Usage
  python tools/geodata/remask_vegetation_water.py --aoi steinbach-2021
  python tools/geodata/remask_vegetation_water.py            # every AOI with vegetation
"""

from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path

import numpy as np

from build_vegetation import on_water, survey_credit, water_mask

STRIDE = 9


def remask(root: Path) -> None:
    meta_path = root / "vegetation.json"
    bin_path = root / "vegetation.bin"
    if not (meta_path.exists() and bin_path.exists()):
        return
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    mask = water_mask(root)
    if mask is None:
        print(f"{root.name}: no landuse.json — skipped")
        return

    raw = bin_path.read_bytes()
    stride = meta.get("stride", STRIDE)
    count = min(meta["count"], len(raw) // stride)

    records = [raw[i * stride : (i + 1) * stride] for i in range(count)]
    xs = np.empty(count)
    zs = np.empty(count)
    for i, rec in enumerate(records):
        x, z = struct.unpack_from("<hh", rec)
        xs[i] = x
        zs[i] = z

    east = xs + mask["origin_e"] + mask["width_m"] / 2
    north = (mask["origin_n"] + mask["depth_m"]) - (zs + mask["depth_m"] / 2)
    wet = on_water(mask, east, north)
    keep = ~wet

    if not wet.any():
        print(f"{root.name}: {count:,} trees, none on water — already clean")
    else:
        bin_path.write_bytes(b"".join(r for r, k in zip(records, keep) if k))
        print(
            f"{root.name}: dropped {int(wet.sum()):,} of {count:,} trees standing on open water "
            f"({100 * wet.mean():.2f}%)"
        )

    source, attribution = survey_credit(root)
    meta["count"] = int(keep.sum())
    meta["source"] = source
    meta["attribution"] = attribution + " · Gebäude- und Wassermaske © OpenStreetMap-Mitwirkende, ODbL"
    meta["waterMask"] = (
        "Bäume auf offenem Wasser (OSM natural=water) entfernt. Das nDOM kann über Wasser keine "
        "Krone von Rauschen unterscheiden."
    )
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"  credit: {attribution[:72]}...")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--aoi", default=None)
    args = ap.parse_args()
    for root in sorted(Path("public/terrain").glob(args.aoi or "*")):
        if root.is_dir():
            remask(root)


if __name__ == "__main__":
    main()
