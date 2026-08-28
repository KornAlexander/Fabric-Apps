"""Which files belong to which university.

Campus-Scheduler started as a single-customer tool for OTH Regensburg, and the phase-0 data
scripts each opened `config/aoi/oth-regensburg.json` and `config/buildings-oth.json` by name. That
is the trap `src/config/aoi.ts` warns about in its module note — "components had simply imported
the one JSON file by name" — and it was live on the Python side too. This registry closes it: a
second university is an ENTRY here, not a copied script.

⚠️ OTH keeps its original, unprefixed paths on purpose. Renaming `data/synthetic/` to
`data/synthetic/oth/` would be tidier and would also rewrite files that the running backend and a
parallel piece of work both read. Tidiness is not worth a moving target, so the legacy layout is
recorded rather than corrected, and only new sites get the systematic naming.

Usage
    from sites import SITES, load_site
    site = load_site("lmu")
    aoi = site.aoi()
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / "config"

# ⚠️ The zone binding lives in `tools/geodata/aoi.py` and is imported rather than reimplemented, so
# the two doors into an AOI config cannot drift apart. `tools/data/` scripts already put
# `tools/geodata` on `sys.path` (they import `utm` from there); this makes that dependency explicit.
sys.path.insert(0, str(ROOT / "tools" / "geodata"))
from aoi import _bind_utm_zone  # noqa: E402


@dataclass(frozen=True)
class Site:
    """Everything that is site-specific about the data pipeline, in one place."""

    id: str
    aoi_id: str
    label: str
    theme: str
    buildings: Path
    """Real buildings fetched from OSM — written by fetch_buildings.py."""
    letters: Path
    """Published building designations, if the university publishes any. May not exist."""
    osm_rooms: Path
    """Surveyed indoor rooms, if OSM has any. May not exist."""
    academic: Path
    """Faculties, programmes, subjects, block scheme — the invented half of the dataset.

    ⚠️ May not exist. TUM does not have one, because TUM does not need one: its timetable is real,
    so there is no curriculum to invent a timetable from. `academic_or_none()` is how a caller asks
    for it without assuming every university is generated.
    """
    synth: Path
    """Where the generated timetable is written."""
    plan_rooms: Path | None = None
    """Rooms read off the university's own published floor plans — written by build_plan_rooms.py.

    ⚠️ BETTER EVIDENCE THAN THE OSM SURVEY, and it was previously used for GEOMETRY ONLY. These
    outlines are the architect's, and the refs are the numbers on the door: `P 001A` is what OTH
    calls that room. Feeding them only to `build_room_geometry.py` meant the shapes could be drawn
    but the ROOM did not exist in the timetable, so nothing could ever be scheduled into it — the
    `planRooms` test calls that decoration, correctly. Declared here so the generator can treat a
    published plan as a room source, exactly as it already treats the survey.

    Last field on purpose: it is the only optional one, and a defaulted field may not precede a
    required one.
    """

    def aoi(self) -> dict[str, Any]:
        """This site's AOI config, with the UTM zone bound before anything projects a coordinate.

        ⚠️ THIS USED TO BE A BARE `json.loads`, AND THAT WAS A SECOND, UNGUARDED DOOR INTO THE AOI.
        `tools/geodata/aoi.py::load_aoi` binds the working UTM zone as a side effect precisely so a
        pipeline step cannot forget it — but every script under `tools/data/` reaches its AOI
        through HERE instead, so none of them were binding anything and all of them silently used
        the zone-32 default.

        It was invisible for as long as every site really was zone 32. TU Berlin is EPSG:25833, and
        the symptom was `fetch_buildings.py` writing the Hauptgebäude at easting 793 609 — a
        perfectly well-formed coordinate about 400 km west of Berlin, in a file whose own key is
        called `polygonUtm32`. Nothing raised; the buildings would simply not have been where the
        terrain was.

        ⚠️ AND THE KEY NAME `polygonUtm32` IS NOW HISTORICAL. It means "projected into this AOI's
        working zone", which is 32 for the eight German sites that predate TU Berlin and 33 for
        this one. It is deliberately NOT renamed: the name appears in eight tools and in every
        committed `config/buildings-*.json`, so renaming it would rewrite working data for eight
        sites to fix a label. Read it as `polygonUtm`.
        """
        cfg: dict[str, Any] = json.loads(
            (CONFIG / "aoi" / f"{self.aoi_id}.json").read_text(encoding="utf-8")
        )
        _bind_utm_zone(cfg)
        return cfg

    def terrain_dir(self) -> Path:
        """Where THIS site's generated browser assets are written."""
        return ROOT / "public" / "terrain" / self.aoi_id

    def asset_dir(self) -> Path:
        """Where this site's shared GROUND assets are read from.

        ⚠️ THE SAME SPLIT AS `assetAoi` IN `scene.ts`, and it has to be, or the two sides disagree
        about which folder a file is in. The heightmap, drape, LoD2 mesh and vegetation describe a
        PLACE, so a site whose AOI declares `assetsFrom` reads them from that other site's folder.
        Rooms, occupancy, plan quality and staffing describe a WEEK and are written to
        `terrain_dir()` — this site's own — because they come from this site's own timetable.

        For every site except the generic demo the two are the same directory.
        """
        source = self.aoi().get("assetsFrom") or self.aoi_id
        return ROOT / "public" / "terrain" / source

    def read_json(self, path: Path, default: Any = None) -> Any:
        """Read an optional site file. Absence is a fact, not an error — LMU publishes no
        building letters and OTH has almost no surveyed indoor rooms, and both have to work."""
        if not path.exists():
            return default
        return json.loads(path.read_text(encoding="utf-8"))

    def buildings_payload(self, default: Any = None) -> Any:
        """This site's buildings file, with the borrowed site's vocabulary translated out of it.

        ⚠️ THIS EXISTS FOR THE GENERIC DEMO AND FOR NOTHING ELSE, and without it the demo gives
        itself away twice over. `campus-demo` renders a real place through `assetsFrom`, so it also
        reads that place's buildings file — and that file carries the REFERENCE site's campus ids
        AND its building names.

        Neither is private. Campus ids appear in the generated `building.json`, in every API
        response that groups by campus, and in the validator's own "sessions per campus" line.
        Building names are worse: they reach the screen, in the room list and the building drawer.
        A demo whose data says `wedding-tib`, or whose room list offers `Telefunken-Hochhaus`, is
        not a generic demo.

        Both maps live in the AOI beside the `assetsFrom` that creates the problem. A site without
        them is unaffected — every site except the demo returns the payload untouched.

        ⚠️ THE NAME MAP IS COUPLED TO THE ACADEMIC PROFILE. Ownership rules match on building name
        (`nameIs`), so renaming a building here without moving its rule leaves the rule matching
        nothing — and a rule that matches nothing does not fail, it silently sends the building to
        `other`. That is how an earlier attempt put 0 of 1367 sessions at the second campus and
        reported success.
        """
        payload = self.read_json(self.buildings, default)
        if not payload:
            return payload
        aoi = self.aoi()
        campus_map = aoi.get("campusIdMap") or {}
        name_map = aoi.get("buildingNameMap") or {}
        if not campus_map and not name_map:
            return payload
        for building in payload.get("buildings", []):
            campus = building.get("campusId")
            if campus in campus_map:
                building["campusId"] = campus_map[campus]
            name = building.get("name")
            if name in name_map:
                building["name"] = name_map[name]
        return payload

    @property
    def is_generated(self) -> bool:
        """Is this university's TIMETABLE invented, or is it the real published one?

        ⚠️ THE DIFFERENCE MATTERS EVERYWHERE DOWNSTREAM. OTH and LMU have no published timetable
        to obtain, so theirs is generated from an academic profile and placed by the solver, and
        every session carries `provenance: generated`. TUM Garching publishes its real bookings via
        TUMonline, so its sessions are `measured` and no solver runs at build time. A caller that
        assumes "dataset" means "generated" will badge real data as invented, which is the one
        mistake this project cannot afford to make.
        """
        return self.academic.exists()


SITES: dict[str, Site] = {
    "oth": Site(
        id="oth",
        aoi_id="oth-regensburg",
        label="OTH Regensburg",
        theme="oth",
        buildings=CONFIG / "buildings-oth.json",
        letters=CONFIG / "oth-building-letters.json",
        osm_rooms=CONFIG / "rooms-osm.json",
        plan_rooms=CONFIG / "rooms-plan.json",
        academic=CONFIG / "academic" / "oth.json",
        synth=ROOT / "data" / "synthetic",
    ),
    "lmu": Site(
        id="lmu",
        aoi_id="lmu-muenchen",
        label="LMU München",
        theme="lmu",
        buildings=CONFIG / "buildings-lmu.json",
        letters=CONFIG / "lmu-building-letters.json",
        osm_rooms=CONFIG / "rooms-osm-lmu.json",
        plan_rooms=CONFIG / "rooms-plan-lmu.json",
        academic=CONFIG / "academic" / "lmu.json",
        synth=ROOT / "data" / "synthetic-lmu",
    ),
    # ⚠️ THE ODD ONE OUT, AND DELIBERATELY SO. TUM is the only site whose timetable is REAL —
    # 24 063 teaching bookings published by TUMonline, reshaped by `build_tum_dataset.py` rather
    # than invented by `generate_timetable.py`. It therefore has no academic profile and no
    # published floor plans; its rooms come from NavigaTUM's survey, which is already the richest
    # of the three (3 921 rooms with real seat counts). `synth` still names the output directory
    # even though almost nothing in it is synthetic — the word is the layout's, not a claim.
    "tum": Site(
        id="tum",
        aoi_id="garching",
        label="TUM Garching",
        theme="tum",
        buildings=CONFIG / "campus-garching.json",
        letters=CONFIG / "tum-building-letters.json",  # not published; absence handled
        osm_rooms=CONFIG / "rooms-osm-tum.json",       # NavigaTUM supplies these instead
        academic=CONFIG / "academic" / "tum.json",     # intentionally absent — see is_generated
        synth=ROOT / "data" / "tum",
    ),
    # ── The five twins that had terrain and nothing else ──────────────────────────────────────
    #
    # Each of these already rendered: DGM1 terrain, LoD2 buildings, an orthophoto drape and a
    # Copernicus shell, generated months before this entry existed. What none of them had was a
    # SCHEDULER — no buildings file, no academic profile, no timetable, no rooms, and therefore an
    # empty `lenses` array and no `schedulerSite`. They were twins you could look at and not ask a
    # question of.
    #
    # ⚠️ NONE OF THESE FIVE PUBLISHES A TIMETABLE THIS PROJECT CAN READ, so every one of them is
    # `is_generated` — the OTH/LMU path, not the TUM one. That is a claim about what is available,
    # not about what is true, and `data/synthetic-<id>/provenance.json` says so for each.
    #
    # ⚠️ AND NONE OF THEM PUBLISHES FLOOR PLANS EITHER, so `plan_rooms` is omitted throughout.
    # OTH and LMU are the exceptions in this repository, not the rule: their interiors exist
    # because those two universities happen to publish a Raumfinder. Everywhere else the interior
    # is generated inside the real footprint at the real storey count and badged as generated.
    "rwth": Site(
        id="rwth",
        aoi_id="aachen",
        label="RWTH Aachen",
        theme="rwth",
        buildings=CONFIG / "buildings-rwth.json",
        letters=CONFIG / "rwth-building-letters.json",  # not published; absence handled
        osm_rooms=CONFIG / "rooms-osm-rwth.json",
        academic=CONFIG / "academic" / "rwth.json",
        synth=ROOT / "data" / "synthetic-rwth",
    ),
    "koeln": Site(
        id="koeln",
        aoi_id="koeln",
        label="Universität zu Köln",
        theme="koeln",
        buildings=CONFIG / "buildings-koeln.json",
        letters=CONFIG / "koeln-building-letters.json",
        osm_rooms=CONFIG / "rooms-osm-koeln.json",
        academic=CONFIG / "academic" / "koeln.json",
        synth=ROOT / "data" / "synthetic-koeln",
    ),
    "muenster": Site(
        id="muenster",
        aoi_id="muenster",
        label="Universität Münster",
        theme="muenster",
        buildings=CONFIG / "buildings-muenster.json",
        letters=CONFIG / "muenster-building-letters.json",
        osm_rooms=CONFIG / "rooms-osm-muenster.json",
        academic=CONFIG / "academic" / "muenster.json",
        synth=ROOT / "data" / "synthetic-muenster",
    ),
    "fau": Site(
        id="fau",
        aoi_id="fau-erlangen",
        label="FAU Erlangen-Nürnberg",
        theme="fau",
        buildings=CONFIG / "buildings-fau.json",
        letters=CONFIG / "fau-building-letters.json",
        osm_rooms=CONFIG / "rooms-osm-fau.json",
        academic=CONFIG / "academic" / "fau.json",
        synth=ROOT / "data" / "synthetic-fau",
    ),
    "tuebingen": Site(
        id="tuebingen",
        aoi_id="tuebingen",
        label="Universität Tübingen",
        theme="tuebingen",
        buildings=CONFIG / "buildings-tuebingen.json",
        letters=CONFIG / "tuebingen-building-letters.json",
        osm_rooms=CONFIG / "rooms-osm-tuebingen.json",
        academic=CONFIG / "academic" / "tuebingen.json",
        synth=ROOT / "data" / "synthetic-tuebingen",
    ),
    "tuberlin": Site(
        id="tuberlin",
        aoi_id="tu-berlin",
        label="TU Berlin",
        theme="tuberlin",
        buildings=CONFIG / "buildings-tuberlin.json",
        letters=CONFIG / "tuberlin-building-letters.json",
        osm_rooms=CONFIG / "rooms-osm-tuberlin.json",
        academic=CONFIG / "academic" / "tuberlin.json",
        synth=ROOT / "data" / "synthetic-tuberlin",
    ),
    # ⚠️ THE GENERIC SITE, AND THE ONLY ONE THAT SHARES ANOTHER SITE'S BUILDINGS. Beispiel-
    # Universität is the reference build's ground under an invented institution, so it points at
    # the SAME `buildings-tuberlin.json` and the SAME letters file on purpose: those describe real
    # polygons in a real orthophoto, and a second copy could only drift from them. What is its own
    # is the academic profile and therefore the whole week — different faculties, different
    # programmes, different timetable, written to its own `data/synthetic-demo`.
    "demo": Site(
        id="demo",
        aoi_id="campus-demo",
        label="Beispiel-Universität",
        theme="demo",
        buildings=CONFIG / "buildings-tuberlin.json",
        # ⚠️ ITS OWN CODES, THOUGH THE BUILDINGS ARE BORROWED. Geometry can be shared without
        # embarrassment; vocabulary cannot. The reference build's letters carry MAR, TIB, HFT-FT,
        # EMH and BEL, which name a Berlin street and a Berlin technology park and are readable
        # straight off any room list. See config/demo-building-letters.json.
        letters=CONFIG / "demo-building-letters.json",
        osm_rooms=CONFIG / "rooms-osm-tuberlin.json",
        academic=CONFIG / "academic" / "demo.json",
        synth=ROOT / "data" / "synthetic-demo",
    ),
}

DEFAULT_SITE = "oth"


def load_site(site_id: str = DEFAULT_SITE) -> Site:
    if site_id not in SITES:
        raise SystemExit(f"Unknown site '{site_id}'. Known: {', '.join(sorted(SITES))}")
    return SITES[site_id]


def add_site_argument(parser) -> None:  # noqa: ANN001 - argparse.ArgumentParser
    parser.add_argument(
        "--site",
        default=DEFAULT_SITE,
        choices=sorted(SITES),
        help="Which university to build. Defaults to the first customer.",
    )


def is_university_building(row: dict[str, Any]) -> bool:
    """Does this OSM building belong to the university?

    ⚠️ TWO KEYS, ONE QUESTION. The OTH fetcher wrote `insideOthOutline`, which names the FIRST
    of the three signals it ended up using rather than the answer it was giving. The site-agnostic
    fetcher writes `isUniversityBuilding`. Both files are real and in use, so this is the one
    place that knows about the older name — nothing downstream should ever test either key
    directly.
    """
    if "isUniversityBuilding" in row:
        return bool(row["isUniversityBuilding"])
    return bool(row.get("insideOthOutline"))
