"""Load the area-of-interest configuration.


The AOI has two tiers (PLAN §4.1), and every helper here takes the tier as an argument rather than
assuming one:

  core   the photoreal box — LDBV DGM1, buildings, trees, land cover
  shell  the coarse horizon — Copernicus DEM, terrain only, crosses into Austria
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any, Literal

import utm

CONFIG_DIR = Path(__file__).resolve().parents[2] / "config" / "aoi"

Tier = Literal["core", "shell"]

# Which config key holds each tier's bounding box. The core keeps the plain name `bbox` because it
# is what almost every step wants; only the terrain build ever asks for the shell.
_BBOX_KEY: dict[str, str] = {"core": "bbox", "shell": "shell"}


def load_aoi(aoi_id: str = "munich") -> dict[str, Any]:
    path = CONFIG_DIR / f"{aoi_id}.json"
    if not path.exists():
        available = ", ".join(sorted(p.stem for p in CONFIG_DIR.glob("*.json"))) or "none"
        raise FileNotFoundError(f"No AOI config '{aoi_id}'. Available: {available}")
    cfg: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    _bind_utm_zone(cfg)
    return cfg


def _bind_utm_zone(cfg: dict[str, Any]) -> None:
    """Point the UTM helpers at this AOI's working CRS.

    ⚠️ THIS IS DELIBERATELY A SIDE EFFECT OF LOADING THE CONFIG, and the reason is that it is the
    only way to make it impossible to forget. Every pipeline step obtains its AOI through
    `load_aoi`, so binding here means no step can project a coordinate before the zone is known.
    The alternative — threading a `zone` argument through twenty scripts — has the property that
    the ONE call site somebody misses keeps working and returns coordinates that are wrong by
    metres, silently. See the module docstring in `utm.py`.

    """
    crs = cfg.get("workingCrs")
    if not crs:
        raise KeyError(
            f"AOI '{cfg.get('id')}' has no 'workingCrs' — it decides which UTM zone every "
            "coordinate in this build is projected into, so there is no safe default."
        )
    zone = utm.crs_to_zone(str(crs))
    _check_zone_is_usable(cfg, zone, str(crs))
    utm.set_active_zone(zone)


def _check_zone_is_usable(cfg: dict[str, Any], zone: int, crs: str) -> None:
    """Reject a `workingCrs` that the AOI's own geometry cannot tolerate.


    What is actually worth checking is the thing that breaks: whether projecting THIS box into
    THIS zone distorts lengths by more than the registration gate downstream is willing to accept.
    A Berlin box left on EPSG:25832 after a copy-paste fails here, on the first line of the first
    step, instead of producing a build that is quietly a few metres out everywhere.
    """
    box = cfg.get("bbox") or {}
    if not {"west", "east", "south", "north"} <= box.keys():
        return

    centre_lat = (float(box["south"]) + float(box["north"])) / 2
    # The worst corner, not the centre: the error grows away from the central meridian, so a box
    # whose centre is comfortable can still have an edge that is not.
    worst = max(
        abs(utm.scale_error_m_per_km(float(box[side]), centre_lat, zone)) for side in ("west", "east")
    )

    span_km = max(
        _bbox_diagonal_km(box),
        float(((cfg.get("siteSeparation") or {}).get("straightLineKm")) or 0.0),
    )
    tolerance_m = float((cfg.get("verification") or {}).get("toleranceM") or 3.0)
    error_m = worst * span_km

    if error_m > tolerance_m:
        nominal = utm.zone_for_lon((float(box["west"]) + float(box["east"])) / 2)
        raise ValueError(
            f"AOI '{cfg.get('id')}' declares {crs} (UTM zone {zone}), but projecting its own "
            f"{span_km:.1f} km extent into that zone distorts lengths by {error_m:.1f} m "
            f"({worst:.2f} m/km), over the {tolerance_m:.1f} m tolerance in its verification "
            f"block. Zone {nominal} (EPSG:{25800 + nominal}) is the nominal zone here."
        )


def _bbox_diagonal_km(box: dict[str, Any]) -> float:
    """Rough great-circle diagonal of a small geographic box, in kilometres."""
    centre_lat = math.radians((float(box["south"]) + float(box["north"])) / 2)
    dx = math.radians(float(box["east"]) - float(box["west"])) * 6371.0 * math.cos(centre_lat)
    dy = math.radians(float(box["north"]) - float(box["south"])) * 6371.0
    return math.hypot(dx, dy)


def bbox(cfg: dict[str, Any], tier: Tier = "core") -> dict[str, float]:
    """Return the raw bbox mapping for a tier."""
    key = _BBOX_KEY[tier]
    if key not in cfg:
        raise KeyError(f"AOI '{cfg.get('id')}' has no '{key}' bbox — required for tier '{tier}'")
    return cfg[key]


def bbox_tuple(cfg: dict[str, Any], tier: Tier = "core") -> tuple[float, float, float, float]:
    """Return (south, west, north, east) — the order Overpass expects."""
    b = bbox(cfg, tier)
    return (b["south"], b["west"], b["north"], b["east"])


def bbox_wsen(cfg: dict[str, Any], tier: Tier = "core") -> tuple[float, float, float, float]:
    """Return (west, south, east, north) — the order the UTM helpers expect."""
    b = bbox(cfg, tier)
    return (b["west"], b["south"], b["east"], b["north"])


def grids(cfg: dict[str, Any], tier: Tier = "core") -> dict[str, Any]:
    """Return the grid settings for a tier."""
    return cfg["grids"] if tier == "core" else cfg["shellGrids"]


def terrain_dir(cfg: dict[str, Any]) -> Path:
    """Where generated browser assets for this AOI are written."""
    return Path(__file__).resolve().parents[2] / "public" / "terrain" / cfg["id"]


def cache_dir(*parts: str) -> Path:
    """Where downloaded source tiles are cached. Gitignored, and safe to delete."""
    path = Path(__file__).resolve().parents[2] / "data" / Path(*parts)
    path.mkdir(parents=True, exist_ok=True)
    return path


def bind_cache(directory: Path, identity: dict[str, Any], expected: set[str], suffix: str) -> None:
    """Refuse a tile cache that was filled from a different source, or holds stray tiles.

    ⚠️ THE BUILD STEPS MOSAIC EVERY TILE IN THE FOLDER. Pointing an AOI at a newer archive used to
    keep the old tiles: same-named ones were treated as cached, differently named ones (LGL puts
    the survey year in the name) were mosaicked next to the new ones. Nothing failed; the terrain
    was simply two surveys at once (review 2026-10-05). So the folder records which source filled
    it, and any tile this run would not have written stops the build. The identity carries every
    selected member's CRC and size, so a re-published archive with the same member names is a
    different source too.
    """
    stamp = directory / "source.json"
    if stamp.exists():
        recorded = json.loads(stamp.read_text(encoding="utf-8"))
        if recorded != identity:
            raise SystemExit(
                f"{directory} was filled from a different source or vintage than this run's "
                f"({identity.get('provider')}, {len(identity.get('members', []))} members). "
                "Delete the folder and run again; mixing survey vintages is not a cache hit."
            )
    elif any(directory.glob(f"*{suffix}")):
        # Tiles with no record of where they came from cannot be told apart from another vintage.
        raise SystemExit(f"{directory} holds tiles without a source record. Delete the folder and run again.")
    stray = sorted(p.name for p in directory.glob(f"*{suffix}") if p.name not in expected)
    if stray:
        raise SystemExit(
            f"{directory} holds {len(stray)} tile(s) this source would not write "
            f"(e.g. {stray[:3]}). Delete the folder and run again."
        )
    stamp.write_text(json.dumps(identity, indent=2), encoding="utf-8")
