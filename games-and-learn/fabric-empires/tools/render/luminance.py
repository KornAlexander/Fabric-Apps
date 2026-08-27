"""Measure exposure and colour of rendered frames.

Written during the 3D conversion, and kept because it repeatedly found what
looking at screenshots could not. Five separate lighting faults in that pass
all produced the same appearance, a dull grey-blue landmass, and each time
the thing that separated them was a number rather than an opinion.

Usage:
    python tools/render/luminance.py <folder-of-pngs>

What the columns mean, and what good looks like for this game:

    mean      average luminance, 0..1. Roughly 0.40 to 0.55 for a daylit
              frame. Below 0.25 the scene is underexposed and reads as dusk.
    clipped   fraction of pixels at or near pure white. Above about 5 percent
              means detail has been thrown away and cannot be recovered.
              An early build of the 3D world sat at 55 percent.
    dark      fraction crushed to black. The same argument at the other end.
    sat       mean chroma. This is the one that matters most here: a frame
              can have perfect brightness and still be wrong, because ambient
              fill light is untinted by definition and every unit of it
              removes colour. Dropping the hemisphere light from 2.2 to 0.55
              moved this from 0.15 to 0.28 with no change in brightness.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image


def report(path: Path) -> None:
    image = Image.open(path).convert("RGB")
    pixels = list(image.getdata())
    total = len(pixels)

    luminance = [(0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 for r, g, b in pixels]
    mean = sum(luminance) / total
    clipped = sum(1 for v in luminance if v > 0.98) / total
    dark = sum(1 for v in luminance if v < 0.06) / total
    saturation = sum((max(p) - min(p)) / 255 for p in pixels) / total

    print(
        f"{path.name:30s} mean={mean:.3f} clipped={clipped:6.2%} "
        f"dark={dark:6.2%} sat={saturation:.3f}"
    )


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1

    target = Path(sys.argv[1])
    paths = sorted(target.glob("*.png")) if target.is_dir() else [target]
    if not paths:
        print(f"no PNGs found in {target}")
        return 1

    for path in paths:
        report(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
