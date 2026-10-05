"""Raster helpers shared by the non-Bavarian geobasis fetchers.

Same toolchain lineage as the rest of this pipeline. Bavaria
publishes GeoTIFF tiles directly; Hamburg (LGV) and Baden-Wuerttemberg (LGL) publish their 1 m
terrain as ASCII XYZ, so both of their fetchers convert here into the GeoTIFF-with-tiepoint form
that `build_terrain.py` already reads. Only the survey authority and the download mechanics differ
between states; the XYZ format is a national convention, so the conversion lives somewhere neutral.
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image, TiffImagePlugin


def _infer_step(values: np.ndarray) -> float:
    """The sample spacing of one axis, inferred from the data.

    Taken from the coordinates rather than assumed to be 1 m, because "DGM1" names a product
    family, not a guaranteed posting, and a tile delivered at a different spacing must fail loudly
    rather than be silently squashed into a 1 m raster.
    """
    unique = np.unique(values)
    if unique.size < 2:
        return 1.0
    return float(np.min(np.diff(unique)))


def xyz_to_geotiff(payload: bytes, out_path: Path) -> tuple[int, int]:
    """Convert one ASCII XYZ elevation tile into a float32 GeoTIFF with a ModelTiepoint.

    The rows may arrive in any order, so the position of every sample is computed from its own
    coordinates rather than assumed from its line number. Hamburg writes them SOUTH to NORTH, LGL
    north to south.

    ⚠️ THE GRID REGISTRATION IS NOT THE SAME IN EVERY STATE, AND GETTING IT WRONG DOES NOT RAISE.
    LGL publishes sample coordinates as CELL CENTRES at `x.50` (verified 2026-10-05:
    `513000.50 5402999.50 251.79`); Hamburg publishes them on WHOLE METRES, node-registered. A
    version that hard-coded the `x.50` convention computed each column as
    `rint(easting - origin - 0.5)`; fed whole metres that lands on exact `.5` values, where numpy
    rounds half to EVEN, so two eastings shared each column and the GeoTIFF held a quarter of its
    samples in the wrong places, with no error anywhere. Both conventions are detected and handled.

    A tile clipped at a state boundary leaves NaN where it has no data; `build_terrain.py` treats
    NaN as "not measured" and fills it from the nearest measured neighbour, flagging the fill.

    Returns (width, height) in cells.
    """
    values = np.array(payload.split(), dtype=np.float64)
    if values.size % 3:
        raise ValueError(f"{out_path.name}: not a multiple of three columns")
    values = values.reshape(-1, 3)

    eastings, northings, heights = values[:, 0], values[:, 1], values[:, 2]

    step_e = _infer_step(eastings)
    step_n = _infer_step(northings)
    if not math.isclose(step_e, step_n, rel_tol=1e-6):
        raise ValueError(f"{out_path.name}: anisotropic sampling, {step_e} m by {step_n} m")
    step = step_e

    min_e, max_e = float(eastings.min()), float(eastings.max())
    min_n, max_n = float(northings.min()), float(northings.max())

    # Which registration is this? A centre-registered grid sits half a step off a whole multiple of
    # the step; a node-registered grid sits on one.
    remainder = min_e - math.floor(min_e / step) * step
    centre_registered = math.isclose(remainder, step / 2, abs_tol=step * 0.01)

    # The north-west PIXEL CORNER, which is what a GeoTIFF ModelTiepoint means.
    if centre_registered:
        origin_e = min_e - step / 2
        top_n = max_n + step / 2
    else:
        origin_e = min_e
        top_n = max_n + step

    width = int(round((max_e - min_e) / step)) + 1
    height = int(round((max_n - min_n) / step)) + 1

    grid = np.full((height, width), np.nan, dtype=np.float32)
    # Integer-valued by construction, so there is no half-way case for rounding to get wrong.
    cols = np.rint((eastings - min_e) / step).astype(np.int64)
    rows = np.rint((max_n - northings) / step).astype(np.int64)
    inside = (cols >= 0) & (cols < width) & (rows >= 0) & (rows < height)
    grid[rows[inside], cols[inside]] = heights[inside].astype(np.float32)

    placed = int(inside.sum())
    if placed < values.shape[0]:
        raise ValueError(
            f"{out_path.name}: {values.shape[0] - placed} of {values.shape[0]} samples fell "
            "outside the raster they define, which means the registration was misread"
        )

    image = Image.fromarray(grid, mode="F")
    tags = TiffImagePlugin.ImageFileDirectory_v2()
    # 33550 ModelPixelScale, 33922 ModelTiepoint: the pair `build_terrain.py` reads back.
    tags[33550] = (step, step, 0.0)
    tags[33922] = (0.0, 0.0, 0.0, origin_e, top_n, 0.0)
    tags.tagtype[33550] = 12  # DOUBLE
    tags.tagtype[33922] = 12
    image.save(out_path, format="TIFF", tiffinfo=tags)
    return width, height
