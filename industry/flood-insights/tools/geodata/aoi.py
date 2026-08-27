"""Load the area-of-interest configuration.

PLAN §14 Q2: Flut-Insights is a reusable vertical asset. No coordinate, place name, gauge id or
event date belongs in a source file — it all comes from config/aoi/<id>.json. Ahrtal 2021 is the
first instance of this app, not the app itself.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

CONFIG_DIR = Path(__file__).resolve().parents[2] / "config" / "aoi"


def load_aoi(aoi_id: str = "ahrtal-2021") -> dict[str, Any]:
    path = CONFIG_DIR / f"{aoi_id}.json"
    if not path.exists():
        available = ", ".join(sorted(p.stem for p in CONFIG_DIR.glob("*.json"))) or "none"
        raise FileNotFoundError(f"No AOI config '{aoi_id}'. Available: {available}")
    return json.loads(path.read_text(encoding="utf-8"))


def bbox_tuple(cfg: dict[str, Any]) -> tuple[float, float, float, float]:
    """Return (south, west, north, east) — the order Overpass expects."""
    b = cfg["bbox"]
    return (b["south"], b["west"], b["north"], b["east"])


def raw_dir(kind: str, aoi_id: str) -> Path:
    """`data/raw/<kind>/<aoi-id>` — where a downloaded dataset for one AOI lives.

    ⚠️ Every raw family used to be a single AOI-blind folder: `data/raw/osm`, `data/raw/lod2`,
    `data/raw/dgm1`, `data/raw/dom1`. Fetching a second AOI therefore overwrote the first in
    place, and that is a thing that happened rather than a thing that might: building Castel
    Bolognese replaced the Ahr's `river_chainage.json` with the Fiume Senio's, and the Ahr flow
    field then died seven steps later on `array of sample points is empty`.

    `load_osm_cache` below was the stop-gap — it makes the collision loud by checking the `aoi`
    stamp every writer already puts in the file. This is the actual fix: the AOI is in the path,
    so two AOIs cannot occupy the same file and both can exist at once. The guard stays, because
    a stamp that disagrees with its own directory means something else has gone wrong.
    """
    return Path("data/raw") / kind / aoi_id


def terrain_name(cfg: dict[str, Any]) -> str:
    """The heightmap basename for an AOI, e.g. `heightmap_4m` or `heightmap_2m`.

    ⚠️ `heightmap_4m` was written literally into seven builders. That was harmless while there was
    one AOI, and it stopped the Steinbach corridor dead: its box is a twentieth of the Ahr's area
    and is built at 2 m, so every consumer went looking for a file that does not exist. The
    resolution is a property of the AOI — it lives in `grids.terrainResolutionM` — so the name is
    derived from it here rather than repeated.

    `:g` so 2 formats as `2m` and not `2.0m`.
    """
    # ⚠️ No default. `4` used to be the fallback, which is the Ahr's resolution — so the one AOI
    # that never declared it got the right answer by coincidence, and the two that were built at
    # 5 m and 20 m silently went looking for heightmap_4m.json and died on FileNotFoundError deep
    # inside the flow-field builder. A default that is correct for exactly one caller is a trap,
    # not a convenience.
    grids = cfg.get("grids", {})
    metres = grids.get("terrainResolutionM")
    if metres is None:
        raise KeyError(
            f"AOI '{cfg.get('id', '?')}' does not declare grids.terrainResolutionM. "
            f"It has {sorted(grids)} — name the resolution the heightmap was actually BUILT at, "
            f"which is not necessarily the source or the render resolution."
        )
    return f"heightmap_{metres:g}m"


def load_osm_cache(path: Path, aoi_id: str) -> dict[str, Any]:
    """Load a file from the shared OSM cache, refusing one that belongs to another AOI.

    ⚠️ `data/raw/osm/` carries no AOI in its path, so fetching a second AOI overwrites the first
    in place. That is a real event, not a hypothetical: building Castel Bolognese replaced the
    Ahr's `river_chainage.json` with the Fiume Senio's, and the next Ahr flow-field build died
    seven steps later on `array of sample points is empty` — a message that says nothing about
    what actually went wrong. Worse, the cache went MIXED rather than wrong: buildings.json still
    held the Ahr while river_chainage.json held the Senio, so a build could have half-succeeded
    and produced a plausible, silently meaningless result.

    Every writer already stamps the file with its `aoi`. Nothing read it back. This does, which
    turns silent cross-AOI contamination into an immediate, specific error.

    The real fix is to put the AOI in the path; until then, this is the guard.
    """
    data = json.loads(path.read_text(encoding="utf-8"))
    owner = data.get("aoi")
    if owner is not None and owner != aoi_id:
        raise SystemExit(
            f"{path} was built for AOI '{owner}', but this run is for '{aoi_id}'.\n"
            f"The OSM cache is shared across AOIs, so it now holds the wrong region's data.\n"
            f"Re-fetch it for '{aoi_id}' before continuing, e.g.:\n"
            f"  python tools/geodata/fetch_osm.py --aoi {aoi_id}"
        )
    return data
