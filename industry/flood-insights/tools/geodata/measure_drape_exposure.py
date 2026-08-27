"""Measure how bright each drape actually is, and record the correction beside it.

The Ahr's orthophoto renders far darker than the others and it is not the shader's doing: the
hillshade over a photo is already gentle (0.80–1.00). The photograph itself is dark — a narrow,
steeply wooded valley flown under dense canopy — and at a mean luma near 0.33 it reads as a black
mass on screen where Horta Sud's near 0.51 reads as ground.

So each drape carries its own correction, measured from its own pixels rather than dialled in by
eye, and the shader applies it. A GAMMA rather than a gain: a linear multiplier bright enough to
lift the Ahr would clip every pale roof and gravel bar to white, whereas gamma maps the mean to
the target and leaves 1.0 at 1.0.

⚠️ Nodata is excluded. An orthophoto mosaic pads with WHITE, not transparency — the Ahr's box
crosses out of Rheinland-Pfalz and a good part of the image is blank sheet. Averaging that in
would report the drape as far brighter than its ground is and under-correct exactly the darkest
AOI, which is the one this exists for.

Usage
  python tools/geodata/measure_drape_exposure.py            # every AOI that has a drape
  python tools/geodata/measure_drape_exposure.py --aoi ahrtal-2021
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image

#: Where a drape's ground should sit. Horta Sud already measures 0.513 and reads correctly, so the
#: target is set below it: this is meant to rescue dark imagery, not to impose one look on all.
TARGET_LUMA = 0.46

#: Only ever brighten. A drape that is already at or above the target is left exactly alone — the
#: complaint was darkness, and silently darkening an AOI nobody complained about to satisfy a
#: constant would be the pipeline choosing a look over a measurement.
MIN_GAMMA = 0.60
MAX_GAMMA = 1.00

#: Above this in all three channels a pixel is mosaic padding, not ground. Same threshold the
#: shader uses for coverage, so the two agree about what counts as data.
NODATA_LEVEL = 0.93


def mean_ground_luma(image: Image.Image) -> tuple[float, float]:
    """Mean luma of the drape's actual ground, and the fraction of it that is ground."""
    small = image.convert("RGB").resize((320, 320), Image.BILINEAR)
    total = 0.0
    ground = 0
    for r, g, b in small.getdata():
        rf, gf, bf = r / 255, g / 255, b / 255
        if min(rf, gf, bf) > NODATA_LEVEL:
            continue
        total += 0.2126 * rf + 0.7152 * gf + 0.0722 * bf
        ground += 1
    if not ground:
        return 0.0, 0.0
    return total / ground, ground / (320 * 320)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--aoi", default=None)
    args = ap.parse_args()

    Image.MAX_IMAGE_PIXELS = None
    roots = sorted(Path("public/terrain").glob(args.aoi or "*"))
    for root in roots:
        meta_path = root / "drape.json"
        if not meta_path.exists():
            continue
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        image = Image.open(root / meta["file"])
        luma, ground_share = mean_ground_luma(image)
        if luma <= 0.0:
            print(f"{root.name}: no ground pixels found — left alone")
            continue

        # gamma such that luma ** gamma == TARGET_LUMA
        import math

        gamma = math.log(TARGET_LUMA) / math.log(luma)
        clamped = min(max(gamma, MIN_GAMMA), MAX_GAMMA)
        meta["meanGroundLuma"] = round(luma, 4)
        meta["groundSharePct"] = round(100 * ground_share, 1)
        meta["renderGamma"] = round(clamped, 4)
        meta["renderGammaNote"] = (
            "Belichtungskorrektur, aus dem Bild selbst gemessen: "
            f"mittlere Helligkeit {luma:.3f} -> Ziel {TARGET_LUMA:.2f}. "
            "Gamma, damit helle Flaechen nicht ausbrennen. Nur Aufhellung."
        )
        meta_path.write_text(
            json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8"
        )
        flag = "" if clamped == gamma else f"  (clamped from {gamma:.3f})"
        print(
            f"{root.name:<24} luma {luma:.3f}  ground {100 * ground_share:5.1f}%  "
            f"gamma {clamped:.3f}{flag}  -> {luma ** clamped:.3f}"
        )


if __name__ == "__main__":
    main()
