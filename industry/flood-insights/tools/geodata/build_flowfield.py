"""Precompute the flow field the water shader needs: chainage index + connectivity mask.

PLAN §6.2/§6.3. The browser never simulates hydraulics. Per frame it receives a small
water-surface-elevation (WSE) profile indexed by river chainage, and each fragment resolves

    depth = WSE[chainIndex(uv)] - terrainZ(uv)   masked by connectivity

Both lookups are static for a given AOI, so they are computed once here.

Resolution: the flow field is built at a coarser grid than the terrain (default 16 m). Chainage and
connectivity vary smoothly, unlike elevation, so a coarse field costs ~1 MB instead of ~15 MB while
the depth calculation itself still runs at full terrain resolution.

Outputs (public/terrain/<aoi>/):
  flowfield_<res>m.u16   chainage index per cell, uint16 LE (0xFFFF = not connected / no river)
  flowfield_<res>m.u8    connectivity mask, 0 or 255
  flowfield_<res>m.json  metadata

Usage
  python tools/geodata/build_flowfield.py
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from scipy import ndimage

from aoi import load_aoi, load_osm_cache, raw_dir, terrain_name
from utm import wgs84_to_utm, zone_for_lon

NOT_CONNECTED = 0xFFFF


def load_heightmap(terrain_dir: Path, name: str) -> tuple[np.ndarray, dict]:
    meta = json.loads((terrain_dir / f"{name}.json").read_text(encoding="utf-8"))
    raw = np.fromfile(terrain_dir / f"{name}.u16", dtype="<u2")
    grid = raw.reshape(meta["height"], meta["width"]).astype(np.float32)
    elevation = grid * meta["heightScale"] + meta["heightMinM"]
    return elevation, meta


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="ahrtal-2021")
    parser.add_argument("--terrain-name", default=None)
    parser.add_argument("--resolution", type=int, default=16, help="flow-field grid spacing (m)")
    parser.add_argument(
        "--max-stage",
        type=float,
        default=12.0,
        help="metres above the river bed to consider reachable when building connectivity",
    )
    parser.add_argument(
        "--max-drop",
        type=float,
        default=1.0,
        help=(
            "metres BELOW the assigned reach's bed still counted as that reach's floodplain. "
            "`bed` is the LOWEST terrain in the channel at that chainage, so genuine cells are at "
            "or above it by construction and this only absorbs 16 m-vs-2 m resampling noise. It "
            "is not a floodplain allowance: at 3 m, chainage points that the front had not yet "
            "reached showed standing water, because ground below the bed is wet even at stage 0"
        ),
    )
    parser.add_argument(
        "--max-offset",
        type=float,
        default=1000.0,
        help=(
            "metres from the centreline a cell may sit and still take that reach's water. The "
            "rating solves cross-sections around 90 m wide, so a surface kilometres away is "
            "outside the geometry that produced it"
        ),
    )
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    args.terrain_name = args.terrain_name or terrain_name(cfg)
    terrain_dir = Path("public/terrain") / cfg["id"]
    elevation, meta = load_heightmap(terrain_dir, args.terrain_name)

    # ⚠️ int(), because `//` on a float yields a float: 20 // 10.0 is 2.0, and the reshape below
    # then gets fractional slice bounds and raises "slice indices must be integers" from inside
    # numpy, which says nothing about resolutions. The German AOIs never hit it because their
    # sidecars carry integer resolutions; the reprojected ones write 10.0.
    factor = int(args.resolution // meta["resolutionM"])
    if factor < 1:
        raise SystemExit("flow-field resolution must be >= terrain resolution")
    # ⚠️ And an exact multiple of it. The downsample reshapes the terrain into (h2, factor, w2,
    # factor) blocks, so a fractional factor makes the slice indices fractional and numpy raises
    # "slice indices must be integers" from deep inside the reshape — which says nothing about
    # resolutions. 16 m over a 10 m terrain is the case that found this.
    if args.resolution % meta["resolutionM"]:
        raise SystemExit(
            f"flow-field resolution {args.resolution} m is not a whole multiple of the terrain's "
            f"{meta['resolutionM']} m. Pick one of "
            f"{[meta['resolutionM'] * k for k in (1, 2, 3, 4)]} — the downsample works in blocks."
        )

    # Minimum, not mean, when downsampling: the river channel is narrow and we must not lose it
    # into the surrounding banks.
    h, w = elevation.shape
    h2, w2 = h // factor, w // factor
    coarse = elevation[: h2 * factor, : w2 * factor].reshape(h2, factor, w2, factor).min(axis=(1, 3))
    print(f"terrain {w}x{h} @ {meta['resolutionM']} m -> flow field {w2}x{h2} @ {args.resolution} m")

    # --- chainage index -------------------------------------------------------------------
    chain = load_osm_cache(raw_dir("osm", cfg["id"]) / "river_chainage.json", cfg["id"])
    points = chain["points"]
    print(f"river: {chain.get('river', 'river')} — {len(points)} chainage points, {chain['lengthKm']} km")

    origin_e = meta["origin"]["easting"]
    origin_n = meta["origin"]["northing"]
    grid_top_n = origin_n + h * meta["resolutionM"]

    # ⚠️ The chainage MUST be projected in the same zone the heightmap grid was built in, or it
    # lands hundreds of kilometres off it — and silently, because the arithmetic stays finite and
    # the resulting chainage raster is simply all-nodata. The terrain sidecar records the zone it
    # was built in, so that is the authority; deriving from the bbox is only the fallback for the
    # AOIs that predate the field, and the two are cross-checked rather than trusted in turn.
    b = cfg["bbox"]
    derived = zone_for_lon((b["west"] + b["east"]) / 2)
    zone = int(meta.get("utmZone") or derived)
    if zone != derived:
        raise SystemExit(
            f"terrain for {cfg['id']} was built in UTM zone {zone}, but its bbox centre "
            f"({(b['west'] + b['east']) / 2:.3f}°) falls in zone {derived}. One of them is wrong; "
            f"projecting the river in the other zone would put it off the grid entirely."
        )

    px, py = [], []
    for p in points:
        e, n = wgs84_to_utm(p["lon"], p["lat"], zone)
        px.append((e - origin_e) / args.resolution)
        py.append((grid_top_n - n) / args.resolution)  # row 0 = north
    px = np.asarray(px, dtype=np.float32)
    py = np.asarray(py, dtype=np.float32)

    ys, xs = np.mgrid[0:h2, 0:w2].astype(np.float32)
    nearest = np.zeros((h2, w2), dtype=np.uint16)
    best = np.full((h2, w2), np.inf, dtype=np.float32)

    # Chunk over chainage points to keep peak memory sane.
    chunk = 64
    for start in range(0, len(px), chunk):
        stop = min(start + chunk, len(px))
        dx = xs[None, :, :] - px[start:stop, None, None]
        dy = ys[None, :, :] - py[start:stop, None, None]
        d2 = dx * dx + dy * dy
        local_idx = d2.argmin(axis=0)
        local_min = np.take_along_axis(d2, local_idx[None], axis=0)[0]
        improved = local_min < best
        nearest[improved] = (local_idx[improved] + start).astype(np.uint16)
        best[improved] = local_min[improved]
    print("  chainage index built")

    # --- connectivity ---------------------------------------------------------------------
    # River cells: those within ~1 flow-field cell of the centreline.
    river_dist_cells = np.sqrt(best)
    river_seed = river_dist_cells <= 1.5

    # Bed elevation per chainage point = lowest terrain among that point's river cells. This is
    # what "12 m above the bed" is measured from, so the threshold follows the valley downhill
    # rather than being one flat number across a 100 m drop.
    bed = np.full(len(px), np.nan, dtype=np.float32)
    seeded = nearest[river_seed]
    seeded_z = coarse[river_seed]
    for idx in np.unique(seeded):
        bed[idx] = seeded_z[seeded == idx].min()
    # Fill any chainage point with no seed cell by interpolating along the river.
    valid = np.isfinite(bed)
    bed = np.interp(np.arange(len(bed)), np.flatnonzero(valid), bed[valid])
    # Enforce monotonic downstream fall so a noisy cell cannot create an uphill step.
    bed = np.minimum.accumulate(bed)

    # A cell belongs to a reach if the water there could plausibly be THAT reach's water. Three
    # conditions, and the first was the only one there before.
    #
    # ⚠️ The ceiling alone is not enough, and the Steinbach corridor is where that showed. Chainage
    # is assigned by nearest centreline point, so ground in a NEIGHBOURING valley gets attributed
    # to whichever reach happens to be closest across the watershed. With only an upper bound, any
    # such ground below `bed + max_stage` was flooded to the river's own surface: the corridor
    # rendered 725 ha wet at 13 minutes with a maximum depth of 44.8 m, against a largest solved
    # stage anywhere in its rating of 8.3 m. One chainage point alone flooded 156 ha while
    # standing at stage 0.00 — the depth was not water, it was the drop from the river's bed to
    # the floor of the Swist lowlands 3.8 km away.
    #
    # The floor fixes the vertical mis-assignment: ground far BELOW the bed of the reach it was
    # given is not that reach's floodplain, it is a different drainage. `bed` is the LOWEST terrain
    # in the channel there, so real cells sit at or above it and the tolerance only has to absorb
    # resampling noise between the 2 m terrain and this 16 m grid. Measured at 3 m it was already
    # too generous in a way that showed: chainage points the front had not yet reached rendered
    # standing water, because ground below the bed is wet even when the stage is 0.00.
    #
    # The offset fixes the lateral one: build_rating solves cross-sections about 89 m wide at the
    # median, so a water surface kilometres from the centreline is outside the geometry that
    # produced it.
    ceiling = bed[nearest] + args.max_stage
    floor = bed[nearest] - args.max_drop
    offset_m = np.sqrt(best) * args.resolution
    reachable = (coarse <= ceiling) & (coarse >= floor) & (offset_m <= args.max_offset)

    # Cells with no source DGM1 data were filled from their nearest neighbour for appearance, but
    # they carry no real elevation, so they must never be flooded.
    #
    # The mask lives under data/derived/, not next to the heightmap: this is its only reader, and
    # keeping it in public/ meant deploying it to every visitor. The terrain metadata records
    # whether there are any gaps, so a missing file is an error rather than a silent skip — the
    # previous `if exists()` would have quietly dropped the guarantee if the path ever moved.
    nodata_path = Path(meta["nodataFile"]) if meta.get("nodataFile") else None
    gap_cells = meta.get("nodataCells", 0)
    if gap_cells:
        if nodata_path is None or not nodata_path.exists():
            raise SystemExit(
                f"terrain reports {gap_cells} nodata cells but the mask is missing at "
                f"{nodata_path}. Re-run build_terrain.py; without it, invented ground would be "
                "eligible for flooding."
            )
        nodata_fine = np.frombuffer(nodata_path.read_bytes(), dtype=np.uint8).reshape(h, w) > 0
        nodata_coarse = (
            nodata_fine[: h2 * factor, : w2 * factor]
            .reshape(h2, factor, w2, factor)
            .any(axis=(1, 3))
        )
        removed = int((reachable & nodata_coarse).sum())
        reachable &= ~nodata_coarse
        # Report what the mask actually did. For the Ahr this is 0: the lowest filled cell sits at
        # 280.3 m and the highest water surface the model can produce anywhere is 183.0 m, so the
        # elevation test above has already excluded every one of them. Worth printing rather than
        # assuming — on an AOI whose gaps sit in the valley this number will not be 0.
        band = meta.get("nodataElevRangeM")
        ceiling = float(bed.max() + args.max_stage)
        print(
            f"  nodata mask removed {removed} of {int(nodata_coarse.sum())} cells from the "
            f"reachable area (gaps at {band[0]:.1f}..{band[1]:.1f} m, highest possible water "
            f"{ceiling:.1f} m)"
            if band
            else f"  nodata mask removed {removed} cells from the reachable area"
        )

    labels, count = ndimage.label(reachable)
    print(f"  {count} reachable components; keeping those touching the river")
    river_labels = set(np.unique(labels[river_seed])) - {0}
    connected = np.isin(labels, list(river_labels))
    print(f"  connected area: {connected.mean() * 100:.1f}% of the AOI")

    chain_out = np.where(connected, nearest, NOT_CONNECTED).astype("<u2")
    mask_out = (connected * 255).astype(np.uint8)

    # Where the river actually is, as a fraction of the grid. The camera frames the valley from
    # this rather than from a hard-coded viewpoint, so a different AOI needs no code change
    # (PLAN §14 Q2).
    river_rows, river_cols = np.where(river_seed)
    river_centroid = {
        "u": round(float(river_cols.mean() / w2), 4),
        "v": round(float(river_rows.mean() / h2), 4),
        "uMin": round(float(river_cols.min() / w2), 4),
        "uMax": round(float(river_cols.max() / w2), 4),
        "vMin": round(float(river_rows.min() / h2), 4),
        "vMax": round(float(river_rows.max() / h2), 4),
    }
    print(f"  river centroid (u,v): {river_centroid['u']}, {river_centroid['v']}")

    base = f"flowfield_{args.resolution}m"

    # Where the water enters, when that is not the top of the line.
    #
    # ⚠️ The Ahr's flood arrives from upstream, so chainage 0 is the release point and there is
    # nothing to record. A dam break is not like that: the Steinbach's chainage starts 1.8 km ABOVE
    # the wall, in the stream that FEEDS the reservoir, and the dam sits about a quarter of the way
    # down the line. Releasing at chainage 0 would start the flood up the inflow and run it through
    # the reservoir — visibly wrong, and wrong in a direction that still looks like a flood.
    release: dict | None = None
    release_id = cfg["river"].get("releasePlaceId")
    if release_id:
        place = next((p for p in cfg.get("focusPlaces", []) if p["id"] == release_id), None)
        if place is None:
            raise SystemExit(
                f"river.releasePlaceId '{release_id}' is not in focusPlaces for {cfg['id']}."
            )
        pe, pn = wgs84_to_utm(place["lon"], place["lat"], zone)
        # px/py are in flow-field cells with row 0 = north, so the release point goes into the
        # same space before the distances mean anything.
        rx = (pe - origin_e) / args.resolution
        ry = (grid_top_n - pn) / args.resolution
        d_cells = np.hypot(px - rx, py - ry)
        idx = int(np.argmin(d_cells))
        release = {
            "placeId": release_id,
            "chainageIndex": idx,
            "chainageM": round(idx * float(chain["stepM"]), 1),
            "offsetM": round(float(d_cells[idx]) * args.resolution, 1),
            "bedM": round(float(bed[idx]), 2),
        }
        print(
            f"  release at '{release_id}': chainage index {idx} of {len(px)} "
            f"({release['chainageM']} m along, {release['offsetM']} m off the line, "
            f"bed {release['bedM']} m)"
        )

    (terrain_dir / f"{base}.u16").write_bytes(chain_out.tobytes())
    (terrain_dir / f"{base}.u8").write_bytes(mask_out.tobytes())
    (terrain_dir / f"{base}.json").write_text(
        json.dumps(
            {
                "width": w2,
                "height": h2,
                "resolutionM": args.resolution,
                "chainagePoints": len(px),
                "chainageStepM": chain["stepM"],
                "riverLengthKm": chain["lengthKm"],
                "notConnected": NOT_CONNECTED,
                "maxStageM": args.max_stage,
                "bedProfileM": [round(float(b), 2) for b in bed],
                "connectedPct": round(float(connected.mean() * 100), 2),
                "riverCentroid": river_centroid,
                "release": release,
                "terrain": f"{args.terrain_name}.json",
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\nwrote {base}.u16 / .u8 / .json into {terrain_dir}")
    print(f"  bed profile: {bed[0]:.1f} m -> {bed[-1]:.1f} m over {chain['lengthKm']} km")


if __name__ == "__main__":
    main()
