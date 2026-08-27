"""Build a stage-discharge rating per chainage point from the real valley cross-sections.

Why this exists
---------------
The first validation run scored IoU 0.078: hit rate 1.00, false-alarm ratio 0.92. The simulation
covered everything Copernicus observed and then a great deal more — 8.9 km² against 0.69 km².

The cause was a modelling error, not a tuning problem. The sourced peak stage of 980 cm is the
stage **at the Altenahr gauge**, which sits in a narrow gorge. Applying that same 9.8 m along the
whole reach floods the wide downstream basins at Bad Neuenahr far beyond anything that happened.
Stage is not a property of the flood; it is a property of the flood *and the cross-section*.

So instead of one stage, this derives a rating curve per chainage point by cutting an actual
cross-section out of the DGM1 and solving Manning's equation for the water level that conveys a
given discharge:

    Q = (1/n) · A · R^(2/3) · S^(1/2),   R = A / P

A(h) and P(h) come from the measured cross-section, S from the local bed slope. Solved by bisection
for a set of discharges; the browser interpolates between them.

This is still a 1D approximation — no momentum, no backwater, no unsteady routing (PLAN §6.1). But
it responds to valley width, which is the first-order effect the constant-stage model was missing.

Output: rating table added to flowfield_<res>m.json
  ratingDischargeM3s : [q0 .. qN]                 (shared discharge levels)
  ratingStageM       : [[h0 .. hN] per chainage]  (stage above bed)

Usage
  python tools/geodata/build_rating.py
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from aoi import load_aoi, load_osm_cache, raw_dir, terrain_name
from utm import wgs84_to_utm32

# Manning roughness for a natural channel with a vegetated, obstructed floodplain. The Ahr valley
# in 2021 was full of trees, cars, buildings and debris, so a smooth-channel value would be wrong.
MANNING_N = 0.055

# Discharge levels the rating is tabulated at, spanning base flow to well beyond the 2021 peak.
DISCHARGES = [1, 5, 10, 25, 50, 100, 175, 250, 350, 500, 700, 900, 1100, 1300, 1600, 2000]

HALF_WIDTH_M = 700.0  # how far either side of the centreline to cut the cross-section
SAMPLE_STEP_M = 4.0


def load_elevation(terrain_dir: Path, meta: dict) -> np.ndarray:
    raw = np.fromfile(terrain_dir / meta["file"], dtype="<u2")
    grid = raw.reshape(meta["height"], meta["width"]).astype(np.float32)
    return grid * meta["heightScale"] + meta["heightMinM"]


def sample_bilinear(grid: np.ndarray, col: np.ndarray, row: np.ndarray) -> np.ndarray:
    h, w = grid.shape
    col = np.clip(col, 0, w - 1.001)
    row = np.clip(row, 0, h - 1.001)
    c0 = col.astype(np.int32)
    r0 = row.astype(np.int32)
    fc = col - c0
    fr = row - r0
    c1 = np.minimum(c0 + 1, w - 1)
    r1 = np.minimum(r0 + 1, h - 1)
    top = grid[r0, c0] * (1 - fc) + grid[r0, c1] * fc
    bottom = grid[r1, c0] * (1 - fc) + grid[r1, c1] * fc
    return top * (1 - fr) + bottom * fr


def conveyance(profile: np.ndarray, centre: int, level: float, step: float) -> tuple[float, float]:
    """Wetted area and perimeter at a water level, for the region connected to the channel.

    Only the contiguous run of below-water samples containing the channel counts. Without that,
    a puddle on the far side of a ridge would be added to the conveyance of the main channel.
    """
    wet = profile <= level
    if not wet[centre]:
        return 0.0, 0.0

    left = centre
    while left > 0 and wet[left - 1]:
        left -= 1
    right = centre
    while right < len(profile) - 1 and wet[right + 1]:
        right += 1

    depths = level - profile[left : right + 1]
    area = float(depths.sum() * step)
    # Perimeter along the bed, following the terrain rather than assuming a flat bottom.
    bed = profile[left : right + 1]
    perimeter = float(np.sum(np.hypot(np.diff(bed), step)) + step)
    return area, perimeter


def solve_stage(
    profile: np.ndarray,
    centre: int,
    bed_z: float,
    slope: float,
    discharge: float,
    step: float,
    manning_n: float,
) -> float:
    """Bisect for the water level that conveys `discharge`."""
    if discharge <= 0:
        return 0.0
    slope = max(slope, 1e-4)  # a flat or negative local slope would give infinite stage

    low, high = 0.0, 40.0
    for _ in range(48):
        mid = (low + high) / 2
        area, perimeter = conveyance(profile, centre, bed_z + mid, step)
        if area <= 0 or perimeter <= 0:
            low = mid
            continue
        radius = area / perimeter
        q = (1.0 / manning_n) * area * radius ** (2 / 3) * slope**0.5
        if q < discharge:
            low = mid
        else:
            high = mid
    return (low + high) / 2


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="ahrtal-2021")
    parser.add_argument("--resolution", type=int, default=16, help="flow-field resolution")
    parser.add_argument(
        "--manning-n",
        type=float,
        default=MANNING_N,
        help="Manning roughness; the one genuinely uncertain parameter here",
    )
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    terrain_dir = Path("public/terrain") / cfg["id"]
    terrain_meta = json.loads((terrain_dir / f"{terrain_name(cfg)}.json").read_text(encoding="utf-8"))
    flow_path = terrain_dir / f"flowfield_{args.resolution}m.json"
    flow = json.loads(flow_path.read_text(encoding="utf-8"))

    elevation = load_elevation(terrain_dir, terrain_meta)
    cell = terrain_meta["resolutionM"]
    origin_e = terrain_meta["origin"]["easting"]
    top_n = terrain_meta["origin"]["northing"] + terrain_meta["height"] * cell

    chain = load_osm_cache(raw_dir("osm", cfg["id"]) / "river_chainage.json", cfg["id"])
    points = chain["points"]
    n_points = len(points)

    # Chainage points in grid pixel coordinates.
    px = np.zeros(n_points)
    py = np.zeros(n_points)
    for i, p in enumerate(points):
        e, n = wgs84_to_utm32(p["lon"], p["lat"])
        px[i] = (e - origin_e) / cell
        py[i] = (top_n - n) / cell

    bed = np.asarray(flow["bedProfileM"], dtype=np.float64)
    step_m = float(chain["stepM"])

    # Local bed slope, smoothed: point-to-point differences on a monotonic profile are noisy and
    # frequently zero, which would blow the rating up.
    window = 40  # +/- 1 km at 25 m spacing
    slope = np.zeros(n_points)
    for i in range(n_points):
        lo = max(0, i - window)
        hi = min(n_points - 1, i + window)
        drop = bed[lo] - bed[hi]
        run = (hi - lo) * step_m
        slope[i] = drop / run if run > 0 else 0.0
    slope = np.clip(slope, 3e-4, 0.05)

    half_samples = int(HALF_WIDTH_M / SAMPLE_STEP_M)
    offsets = np.arange(-half_samples, half_samples + 1) * SAMPLE_STEP_M
    centre_index = half_samples

    stages = np.zeros((n_points, len(DISCHARGES)), dtype=np.float32)
    widths = np.zeros(n_points, dtype=np.float32)

    print(f"building rating for {n_points} chainage points, {len(DISCHARGES)} discharge levels")
    print(f"  Manning n = {args.manning_n}")
    for i in range(n_points):
        # Direction along the river, from neighbours; the normal is perpendicular to it.
        j0 = max(0, i - 2)
        j1 = min(n_points - 1, i + 2)
        dx = px[j1] - px[j0]
        dy = py[j1] - py[j0]
        length = np.hypot(dx, dy)
        if length == 0:
            dx, dy, length = 1.0, 0.0, 1.0
        nx, ny = -dy / length, dx / length

        cols = px[i] + nx * offsets / cell
        rows = py[i] + ny * offsets / cell
        profile = sample_bilinear(elevation, cols, rows).astype(np.float64)

        # Anchor on the true low point near the centre, not the exact centreline pixel — the OSM
        # line is not perfectly on the thalweg.
        search = slice(centre_index - 12, centre_index + 13)
        local_min_offset = int(np.argmin(profile[search]))
        centre = centre_index - 12 + local_min_offset
        bed_z = float(profile[centre])

        for k, q in enumerate(DISCHARGES):
            stages[i, k] = solve_stage(
                profile, centre, bed_z, slope[i], q, SAMPLE_STEP_M, args.manning_n
            )

        area, _ = conveyance(profile, centre, bed_z + float(stages[i, -4]), SAMPLE_STEP_M)
        widths[i] = area / max(float(stages[i, -4]), 0.01)

        if (i + 1) % 200 == 0:
            print(f"  {i + 1}/{n_points}")

    peak_index = DISCHARGES.index(1100)
    print("\nstage at 1100 m3/s (near the sourced peak):")
    print(f"  min {stages[:, peak_index].min():.2f} m")
    print(f"  median {np.median(stages[:, peak_index]):.2f} m")
    print(f"  max {stages[:, peak_index].max():.2f} m")
    print(f"valley width at that stage: median {np.median(widths):.0f} m")

    flow["ratingDischargeM3s"] = DISCHARGES
    flow["ratingStageM"] = [[round(float(v), 3) for v in row] for row in stages]
    flow["manningN"] = args.manning_n
    flow["ratingNote"] = (
        "Stage per chainage point solved from the DGM1 cross-section with Manning's equation. "
        "Replaces a constant peak stage, which over-flooded the wide downstream valley. "
        "1D approximation: no momentum, no backwater, no unsteady routing."
    )
    flow_path.write_text(json.dumps(flow, ensure_ascii=False, indent=2), encoding="utf-8")
    size_kb = flow_path.stat().st_size / 1024
    print(f"\nwrote {flow_path} ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
