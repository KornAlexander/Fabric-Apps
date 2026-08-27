"""Validate the simulated flood extent against the Copernicus EMS observation — PLAN §6.5.

Computes IoU, hit rate and false-alarm ratio between:
  simulated  = the level-set extent at the modelled peak (same maths as the browser shader)
  observed   = EMSR517 Delineation `observedEventA` polygons

Two honesty rules are enforced in the arithmetic, not just in the write-up:

1. **The comparison is clipped to the Copernicus AOI footprint.** Outside it, Copernicus did not
   map anything, so counting our water there as a false alarm would invent an error, and counting
   it as agreement would invent a success.
2. **Both caveats are emitted with the numbers** — the observation is post-peak satellite imagery,
   and our terrain was flown in 2024/25, after the flood and reconstruction (PLAN §4.1).

Usage
  python tools/geodata/validate_simulation.py
"""

from __future__ import annotations

import argparse
import gzip
import json
import struct
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from aoi import load_aoi, terrain_name
from utm import wgs84_to_utm32

NOT_CONNECTED = 0xFFFF


def read_polygons(shp_bytes: bytes) -> list[list[list[tuple[float, float]]]]:
    """Parse polygon rings out of a shapefile (type 5), without a geo library."""
    polygons: list[list[list[tuple[float, float]]]] = []
    offset = 100
    total = len(shp_bytes)
    while offset < total:
        _record, content_length = struct.unpack(">II", shp_bytes[offset : offset + 8])
        start = offset + 8
        shape_type = struct.unpack("<i", shp_bytes[start : start + 4])[0]
        if shape_type == 5:
            num_parts, num_points = struct.unpack("<II", shp_bytes[start + 36 : start + 44])
            parts_start = start + 44
            parts = struct.unpack(
                f"<{num_parts}I", shp_bytes[parts_start : parts_start + 4 * num_parts]
            )
            pts_start = parts_start + 4 * num_parts
            coords = struct.unpack(
                f"<{num_points * 2}d", shp_bytes[pts_start : pts_start + 16 * num_points]
            )
            pts = [(coords[i * 2], coords[i * 2 + 1]) for i in range(num_points)]
            rings = []
            for i, ring_start in enumerate(parts):
                ring_end = parts[i + 1] if i + 1 < len(parts) else num_points
                rings.append(pts[ring_start:ring_end])
            polygons.append(rings)
        offset = start + content_length * 2
    return polygons


def rasterise(
    polygons: list[list[list[tuple[float, float]]]],
    width: int,
    height: int,
    origin_e: float,
    top_n: float,
    resolution: int,
) -> np.ndarray:
    """Burn WGS84 polygons into a boolean raster on our UTM grid."""
    image = Image.new("1", (width, height), 0)
    draw = ImageDraw.Draw(image)
    for rings in polygons:
        for ring in rings:
            pixels = []
            for lon, lat in ring:
                e, n = wgs84_to_utm32(lon, lat)
                pixels.append(((e - origin_e) / resolution, (top_n - n) / resolution))
            if len(pixels) >= 3:
                draw.polygon(pixels, fill=1)
    return np.array(image, dtype=bool)


def domain_mask(footprint: np.ndarray) -> np.ndarray:
    return footprint


def stage_from_rating(flow: dict, discharge: np.ndarray) -> np.ndarray:
    """Interpolate the per-chainage rating table at a given discharge per chainage point."""
    levels = np.asarray(flow["ratingDischargeM3s"], dtype=np.float64)
    table = np.asarray(flow["ratingStageM"], dtype=np.float64)  # (chainage, levels)
    out = np.empty(table.shape[0])
    for i in range(table.shape[0]):
        out[i] = np.interp(discharge[i], levels, table[i])
    return out


def simulated_extent(terrain_dir: Path, flow: dict, terrain_meta: dict, peak_q: float) -> np.ndarray:
    """Reproduce the shader's level-set at the modelled peak, at FULL terrain resolution.

    The comparison runs at 4 m, not on the 16 m flow-field grid. The flow field downsamples
    elevation with `min` so the narrow channel survives, which means a 16 m cell counts as wet as
    soon as its lowest 4 m sub-cell is wet. That is right for connectivity and systematically
    over-states area, so measuring extent on it would flatter-then-penalise the model for a
    resolution artefact rather than its physics. The shader evaluates depth per fragment at terrain
    resolution anyway, so 4 m is also what the user actually sees.
    """
    raw = np.fromfile(terrain_dir / f"{terrain_meta['file']}", dtype="<u2")
    fine = raw.reshape(terrain_meta["height"], terrain_meta["width"]).astype(np.float32)
    fine = fine * terrain_meta["heightScale"] + terrain_meta["heightMinM"]

    h2, w2 = flow["height"], flow["width"]
    factor = flow["resolutionM"] // terrain_meta["resolutionM"]
    chain_coarse = np.fromfile(
        terrain_dir / f"flowfield_{flow['resolutionM']}m.u16", dtype="<u2"
    ).reshape(h2, w2)

    # Nearest-neighbour upsample of the chainage index and the connectivity to terrain resolution.
    chain = np.repeat(np.repeat(chain_coarse, factor, axis=0), factor, axis=1)
    chain = chain[: terrain_meta["height"], : terrain_meta["width"]]
    if chain.shape != fine.shape:
        padded = np.full(fine.shape, NOT_CONNECTED, dtype=chain.dtype)
        padded[: chain.shape[0], : chain.shape[1]] = chain
        chain = padded
    connected = chain != NOT_CONNECTED

    bed = np.asarray(flow["bedProfileM"], dtype=np.float64)
    n = len(bed)
    fraction = np.arange(n, dtype=np.float64) / max(n - 1, 1)
    # Discharge grows downstream as tributaries join (same 25 % gain as the front end).
    discharge = peak_q * (1 + 0.25 * fraction)
    wse = (bed + stage_from_rating(flow, discharge)).astype(np.float32)

    depth = wse[np.clip(chain, 0, n - 1)] - fine
    return connected & (depth > 0)


def depth_field(
    terrain_dir: Path, flow: dict, terrain_meta: dict, peak_q: float
) -> np.ndarray:
    """Simulated depth in metres per cell; -1 where the cell is not hydraulically connected.

    Same maths as `simulated_extent`, which is just this thresholded at zero. Kept separate so the
    diagnostics can ask *how deep* the disagreement is rather than only where it is.
    """
    raw = np.fromfile(terrain_dir / f"{terrain_meta['file']}", dtype="<u2")
    fine = raw.reshape(terrain_meta["height"], terrain_meta["width"]).astype(np.float32)
    fine = fine * terrain_meta["heightScale"] + terrain_meta["heightMinM"]

    h2, w2 = flow["height"], flow["width"]
    factor = flow["resolutionM"] // terrain_meta["resolutionM"]
    chain_coarse = np.fromfile(
        terrain_dir / f"flowfield_{flow['resolutionM']}m.u16", dtype="<u2"
    ).reshape(h2, w2)
    chain = np.repeat(np.repeat(chain_coarse, factor, axis=0), factor, axis=1)
    chain = chain[: terrain_meta["height"], : terrain_meta["width"]]
    if chain.shape != fine.shape:
        padded = np.full(fine.shape, NOT_CONNECTED, dtype=chain.dtype)
        padded[: chain.shape[0], : chain.shape[1]] = chain
        chain = padded
    connected = chain != NOT_CONNECTED

    bed = np.asarray(flow["bedProfileM"], dtype=np.float64)
    n = len(bed)
    fraction = np.arange(n, dtype=np.float64) / max(n - 1, 1)
    wse = (bed + stage_from_rating(flow, peak_q * (1 + 0.25 * fraction))).astype(np.float32)
    return np.where(connected, wse[np.clip(chain, 0, n - 1)] - fine, -1.0)


def disagreement_diagnostics(
    terrain_dir: Path,
    flow: dict,
    terrain_meta: dict,
    peak_q: float,
    obs: np.ndarray,
    domain: np.ndarray,
    res: int,
) -> dict:
    """Measure where the model and the observation disagree, and test two ways of closing the gap.

    The IoU on its own says the model is wrong without saying how. These figures say how, and they
    are computed here rather than written into the front end so they cannot drift away from the
    data they describe.

    ⚠️ Both routes tested below were *tried and rejected*, and the numbers are kept so nobody
    retries them hoping for a better answer:

    1. **Excluding built-up land**, on the theory that the delineation cannot see water under
       roofs and so scores flooded village centres as false alarms. Just over a third of the
       false-alarm area is indeed built up — but Copernicus mapped flooding inside built-up land
       too, so removing it drops the observed area as well and the IoU gets *worse*.
    2. **A minimum depth before a cell counts as flooded**, matching the model to what a satellite
       could actually detect. This is a detection threshold rather than a physical parameter, so
       it would not have been the forbidden kind of tuning. It does not help either: the metric is
       flat to about 0.10 m and falls away after that, because the disagreement is not a shallow
       rim. The median depth of the false-alarm area is well over a metre.
    """
    cell_km2 = (res * res) / 1e6
    depth = depth_field(terrain_dir, flow, terrain_meta, peak_q)
    sim = (depth > 0) & domain
    extra = sim & ~obs
    extra_depths = depth[extra]

    diagnostics: dict = {
        "falseAlarmKm2": round(float(extra.sum() * cell_km2), 3),
        # How much wider the model paints the flood than the satellite mapped it.
        "overStatementFactor": round(float(sim.sum() / max(int(obs.sum()), 1)), 3),
        "agreementMedianDepthM": round(float(np.median(depth[sim & obs])), 2) if (sim & obs).any() else 0.0,
    }

    if extra.any():
        diagnostics.update(
            {
                "falseAlarmMedianDepthM": round(float(np.median(extra_depths)), 2),
                "falseAlarmP75DepthM": round(float(np.percentile(extra_depths, 75)), 2),
                "falseAlarmShallowShare": round(float((extra_depths < 0.5).mean()), 3),
            }
        )

    # Route 1 — the reference's blind spot under roofs.
    try:
        land_meta = json.loads((terrain_dir / "landuse.json").read_text(encoding="utf-8"))
        raw = (terrain_dir / land_meta["file"]).read_bytes()
        if raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
        land = np.frombuffer(raw, dtype=np.uint8).reshape(land_meta["height"], land_meta["width"])
        step = int(round(res / land_meta["resolutionM"]))
        land = land[::step, ::step][: depth.shape[0], : depth.shape[1]]
        if land.shape == depth.shape:
            built = np.isin(land, [8, 9])  # residential, commercial
            fair_domain = domain & ~built
            o, s = obs & fair_domain, sim & fair_domain
            union = int((o | s).sum())
            diagnostics["builtUpShareOfFalseAlarm"] = round(
                float(int((extra & built).sum()) / max(int(extra.sum()), 1)), 3
            )
            diagnostics["iouExcludingBuiltUp"] = round(
                float(int((o & s).sum()) / union) if union else 0.0, 3
            )
    except (OSError, ValueError, KeyError):
        # Land cover is optional to the pipeline; the rest of the diagnostics stand without it.
        pass

    # Route 2 — a detection threshold.
    sweep = []
    for thr in (0.0, 0.1, 0.25, 0.5, 1.0):
        candidate = (depth > thr) & domain
        union = int((obs | candidate).sum())
        sweep.append(
            {
                "thresholdM": thr,
                "iou": round(float(int((obs & candidate).sum()) / union) if union else 0.0, 3),
            }
        )
    diagnostics["depthThresholdSweep"] = sweep

    print("\ndisagreement diagnostics:")
    for key, value in diagnostics.items():
        if key != "depthThresholdSweep":
            print(f"  {key}: {value}")
    print(f"  depthThresholdSweep: {[(s['thresholdM'], s['iou']) for s in sweep]}")
    return diagnostics


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="ahrtal-2021")
    parser.add_argument("--emsr", type=Path, default=Path("data/raw/emsr517"))
    parser.add_argument(
        "--product",
        default="EMSR517_AOI15_GRA_PRODUCT_r1_RTP01_v1_vector.zip",
        help="product whose observedEventA is used as the reference",
    )
    parser.add_argument(
        "--peak-discharge",
        type=float,
        default=1015.0,
        help="midpoint of the sourced 800-1230 m3/s range",
    )
    parser.add_argument(
        "--sweep",
        action="store_true",
        help="report sensitivity across the sourced peak-discharge range",
    )
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    terrain_dir = Path("public/terrain") / cfg["id"]
    terrain_meta = json.loads((terrain_dir / f"{terrain_name(cfg)}.json").read_text(encoding="utf-8"))
    flow = json.loads((terrain_dir / "flowfield_16m.json").read_text(encoding="utf-8"))

    res = terrain_meta["resolutionM"]
    origin_e = terrain_meta["origin"]["easting"]
    top_n = (
        terrain_meta["origin"]["northing"]
        + terrain_meta["height"] * terrain_meta["resolutionM"]
    )
    grid_w = terrain_meta["width"]
    grid_h = terrain_meta["height"]

    print(f"comparison grid {grid_w}x{grid_h} @ {res} m")

    with zipfile.ZipFile(args.emsr / args.product) as zf:
        names = zf.namelist()
        event_shp = next(n for n in names if n.endswith(".shp") and "observedEvent" in n)
        aoi_shp = next(n for n in names if n.endswith(".shp") and "areaOfInterest" in n)
        observed_polygons = read_polygons(zf.read(event_shp))
        footprint_polygons = read_polygons(zf.read(aoi_shp))
    print(f"observed: {len(observed_polygons)} flood polygons from {Path(event_shp).name}")
    print(
        "  reference includes 'Flood trace' as well as 'Flooded area'. Trace records the maximum\n"
        "  extent; 'Flooded area' is only the water still standing when the satellite passed, days\n"
        "  later. For AOI15 that is 4.51 km2 of trace against 0.29 km2 of standing water — comparing\n"
        "  a modelled PEAK against standing water would be comparing two different things."
    )

    observed = rasterise(observed_polygons, grid_w, grid_h, origin_e, top_n, res)
    footprint = rasterise(footprint_polygons, grid_w, grid_h, origin_e, top_n, res)
    simulated = simulated_extent(terrain_dir, flow, terrain_meta, args.peak_discharge)

    if args.sweep:
        # Sensitivity across the officially sourced discharge range. Reported, not hidden: the
        # honest statement is "the answer moves this much across the range the authority publishes",
        # not a single number chosen because it scored best.
        print("\nsensitivity across the sourced peak range:")
        print("  Q [m3/s]   IoU     hit    false alarm   simulated km2")
        for q in (800, 900, 1015, 1100, 1230):
            candidate = simulated_extent(terrain_dir, flow, terrain_meta, q) & domain_mask(
                footprint
            )
            obs_s = observed & footprint
            inter = int((obs_s & candidate).sum())
            uni = int((obs_s | candidate).sum())
            area = candidate.sum() * (res * res) / 1e6
            print(
                f"  {q:6d}    {inter / uni if uni else 0:.3f}   "
                f"{inter / max(int(obs_s.sum()), 1):.3f}   "
                f"{int((candidate & ~obs_s).sum()) / max(int(candidate.sum()), 1):.3f}         "
                f"{area:.2f}"
            )

    # Rule 1: only compare where Copernicus actually mapped.
    domain = footprint
    if not domain.any():
        raise SystemExit("Copernicus footprint does not overlap the AOI grid")
    print(f"comparison domain: {domain.sum()} cells ({domain.mean() * 100:.1f}% of the AOI)")

    obs = observed & domain
    sim = simulated & domain

    intersection = int((obs & sim).sum())
    union = int((obs | sim).sum())
    iou = intersection / union if union else 0.0
    hit_rate = intersection / int(obs.sum()) if obs.any() else 0.0
    false_alarm = int((sim & ~obs).sum()) / int(sim.sum()) if sim.any() else 0.0

    cell_area_km2 = (res * res) / 1e6
    print()
    print(f"observed flooded : {obs.sum() * cell_area_km2:8.3f} km²")
    print(f"simulated flooded: {sim.sum() * cell_area_km2:8.3f} km²")
    print(f"intersection     : {intersection * cell_area_km2:8.3f} km²")
    print()
    print(f"IoU              : {iou:.3f}   (target >= 0.70)")
    print(f"hit rate         : {hit_rate:.3f}")
    print(f"false-alarm ratio: {false_alarm:.3f}")

    diagnostics = disagreement_diagnostics(
        terrain_dir, flow, terrain_meta, args.peak_discharge, obs, domain, res
    )

    result = {
        "aoi": cfg["id"],
        "product": args.product,
        "gridResolutionM": res,
        "comparedAtTerrainResolution": True,
        "domainCells": int(domain.sum()),
        "observedKm2": round(float(obs.sum() * cell_area_km2), 3),
        "simulatedKm2": round(float(sim.sum() * cell_area_km2), 3),
        "intersectionKm2": round(float(intersection * cell_area_km2), 3),
        "iou": round(iou, 3),
        "hitRate": round(hit_rate, 3),
        "falseAlarmRatio": round(false_alarm, 3),
        "peakDischargeM3s": args.peak_discharge,
        "target": 0.70,
        "meetsTarget": iou >= 0.70,
        # Where the disagreement actually lives, so the panel can explain the number instead of
        # only reporting it. Every figure here is measured in this run, not written by hand.
        "diagnostics": diagnostics,
        "caveats": [
            "Referenz ist die von Copernicus kartierte maximale Ausdehnung (Flood trace), nicht das "
            "zum Aufnahmezeitpunkt noch stehende Wasser.",
            "Die Beobachtung stammt aus Satellitenbildern, die nach dem Scheitel aufgenommen "
            "wurden. Sie ist die beste verfügbare Beobachtung, aber keine Momentaufnahme des "
            "Maximums.",
            "Das Geländemodell wurde 2024/2025 erfasst, also nach Flut und Wiederaufbau. Ein Teil "
            "der Abweichung ist echte Geländeveränderung und kein Modellfehler.",
            "Der Vergleich ist auf das von Copernicus kartierte Gebiet beschränkt.",
        ],
        "attribution": "© European Union, Copernicus Emergency Management Service (EMSR517)",
    }

    out = terrain_dir / "validation.json"
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nwrote {out}")
    if not result["meetsTarget"]:
        print("\n! Below the §6.5 target. Do not tune quietly — report the number and the reason.")


if __name__ == "__main__":
    main()
