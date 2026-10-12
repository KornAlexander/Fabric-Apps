"""Prove the app and the semantic model agree.

PLAN Phase 4 exit criterion: *a KPI in the 3D panel and the same KPI in a DAX query agree to the
decimal.*

This is a gate, not a report. Two implementations of the same question are computed independently
and compared:

  * **app side** — Python, reading the very assets the browser downloads
    (`public/terrain/<aoi>/rooms.json` and `occupancy.bin`), re-implementing what
    `src/twin3d/rooms.ts` and the occupancy panel do
  * **model side** — DAX, over Direct Lake tables in Fabric

They share no code. If a measure is defined differently from the app — and the obvious way to
define utilisation, total booked hours over total available hours, IS different from what the app
does — this is what catches it.

Usage
  python tools/fabric/verify_model_agreement.py
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

from fabric_ids import tenant_id, workspace_id
from provenance import problem_with, source_hash, source_semantics
from sites import site_from_cli

SITE = site_from_cli("Prove the app and one site's semantic model agree.")
AOI = SITE.aoi
WORKSPACE_ID = workspace_id()
MODEL_NAME = SITE.model_name
#: The site's teaching week, from the rooms file: 70 hours at Garching, 60 at the demo site.
WEEK_SLOTS = int(json.loads((SITE.terrain / "rooms.json").read_text(encoding="utf-8"))["occupancyGrid"]["slots"])
#: A building to compare on its own, so an error that cancels out over the campus still shows.
HERO = SITE.hero_building()

#: Absolute tolerance. Counts must match exactly; shares are compared at four decimals, which is
#: far tighter than anything the UI displays.
TOLERANCE = 1e-4

AZ = shutil.which("az") or "az"

TEACHING = (
    "hörsaal", "seminarraum", "unterrichtsraum", "übungsraum",
    "zeichensaal", "praktikumsraum", "studentenarbeitsraum", "lesesaal",
)


def token(resource: str) -> str:
    command = [AZ, "account", "get-access-token", "--resource", resource, "--query", "accessToken", "-o", "tsv"]
    if tenant_id():
        command += ["--tenant", tenant_id()]
    out = subprocess.run(command, capture_output=True, text=True, check=True)  # noqa: S603
    return out.stdout.strip()


def model_id() -> str:
    headers = {"Authorization": f"Bearer {token('https://api.fabric.microsoft.com')}"}
    listing = json.loads(
        urllib.request.urlopen(  # noqa: S310
            urllib.request.Request(
                f"https://api.fabric.microsoft.com/v1/workspaces/{WORKSPACE_ID}/semanticModels",
                headers=headers,
            ),
            timeout=120,
        ).read()
    )
    match = next((m for m in listing.get("value", []) if m["displayName"] == MODEL_NAME), None)
    if not match:
        raise SystemExit(f"no semantic model named {MODEL_NAME} — run build_semantic_model.py")
    return match["id"]


def dax(dataset: str, query: str) -> list[dict]:
    body = json.dumps(
        {"queries": [{"query": query}], "serializerSettings": {"includeNulls": True}}
    ).encode("utf-8")
    request = urllib.request.Request(
        f"https://api.powerbi.com/v1.0/myorg/datasets/{dataset}/executeQueries",
        data=body,
        headers={
            "Authorization": f"Bearer {token('https://analysis.windows.net/powerbi/api')}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:  # noqa: S310
            return json.loads(response.read())["results"][0]["tables"][0]["rows"]
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"DAX failed: {exc.code}\n{exc.read().decode('utf-8', 'replace')[:1200]}")


def is_teaching(usage: str | None) -> bool:
    return bool(usage) and any(hint in usage.lower() for hint in TEACHING)


def from_app() -> dict[str, float]:
    """The figures as the browser computes them, from the assets the browser loads.

    Everything is counted per distinct room CODE, because that is what a room is. `rooms.json`
    holds POLYGONS, and one room on this campus (5532.Z1.003) is drawn as two of them.
    """
    meta = json.loads((ROOT / "public" / "terrain" / AOI / "rooms.json").read_text(encoding="utf-8"))
    occupancy = (ROOT / "public" / "terrain" / AOI / "occupancy.bin").read_bytes()
    slots = int(meta["occupancyGrid"]["slots"])

    by_code: dict[str, dict] = {}
    for polygon in meta["rooms"]:
        room = by_code.get(polygon["code"])
        if room is None:
            by_code[polygon["code"]] = {
                "building": polygon["building"],
                "usage": polygon["usage"],
                "areaM2": float(polygon["areaM2"]),
                "occupancy": polygon.get("occupancy"),
            }
            continue
        room["areaM2"] += float(polygon["areaM2"])
        if room["occupancy"] is None:
            room["occupancy"] = polygon.get("occupancy")

    def booked(room: dict) -> int:
        base = room["occupancy"] * slots
        return sum(1 for s in range(slots) if occupancy[base + s])

    rooms = list(by_code.values())
    with_calendar = [(r, booked(r)) for r in rooms if r["occupancy"] is not None]
    teaching_with_calendar = [(r, b) for r, b in with_calendar if is_teaching(r["usage"])]

    utilisation = [b / WEEK_SLOTS for _, b in with_calendar]
    teaching_utilisation = [b / WEEK_SLOTS for _, b in teaching_with_calendar]
    hero = [b / WEEK_SLOTS for r, b in teaching_with_calendar if r["building"] == HERO]

    return {
        "Räume": len(rooms),
        "Gebäude": len({r["building"] for r in rooms}),
        "Räume mit Kalender": len(with_calendar),
        "Lehrräume": sum(1 for r in rooms if is_teaching(r["usage"])),
        "Fläche m2": round(sum(r["areaM2"] for r in rooms), 1),
        "Belegte Stunden": sum(b for _, b in with_calendar),
        "Zeitliche Auslastung %": sum(utilisation) / len(utilisation) if utilisation else 0.0,
        "Zeitliche Auslastung Lehrräume %": (
            sum(teaching_utilisation) / len(teaching_utilisation) if teaching_utilisation else 0.0
        ),
        "Räume ohne Belegung": sum(1 for _, b in with_calendar if b == 0),
        f"{HERO} Lehrräume %": sum(hero) / len(hero) if hero else None,
        # The building report's own measures. Over the whole week and every room they must come
        # out as the figures above; if one stops doing so, the report and the app have parted.
        "Belegung im Zeitfenster %": sum(utilisation) / len(utilisation) if utilisation else 0.0,
        "Belegte Stunden (Kalender)": sum(b for _, b in with_calendar),
        **known_zero(rooms),
    }


#: Suffix of the key for the "known zero" spot check; the building code is in front of it.
KNOWN_ZERO = " Lehrräume im Filter"


def known_zero(rooms: list[dict]) -> dict[str, float]:
    """A building that has rooms and no teaching room, if the site has one: its tile must read 0.

    ⚠️ FOUND IN THE DATA, NOT NAMED. The datasets are regenerated, and a building pinned here by
    code would fail the day it gains a seminar room. Where no such building exists there is nothing
    to check, and the row is simply absent.
    """
    teaching: dict[str, int] = {}
    for room in rooms:
        teaching[room["building"]] = teaching.get(room["building"], 0) + (1 if is_teaching(room["usage"]) else 0)
    without = sorted(code for code, count in teaching.items() if count == 0)
    return {f"{without[0]}{KNOWN_ZERO}": 0.0} if without else {}


def from_model(dataset: str, zero_building: str | None) -> dict[str, float]:
    rows = dax(
        dataset,
        """
        EVALUATE ROW(
            "Räume", [Räume],
            "Gebäude", [Gebäude],
            "Räume mit Kalender", [Räume mit Kalender],
            "Lehrräume", [Lehrräume],
            "Fläche m2", [Fläche m2],
            "Belegte Stunden", [Belegte Stunden],
            "Zeitliche Auslastung %", [Zeitliche Auslastung %],
            "Zeitliche Auslastung Lehrräume %", [Zeitliche Auslastung Lehrräume %],
            "Räume ohne Belegung", [Räume ohne Belegung],
            "Belegung im Zeitfenster %", [Belegung im Zeitfenster %],
            "Belegte Stunden (Kalender)", [Belegte Stunden (Kalender)]
        )
        """,
    )
    values = {key.strip("[]"): value for key, value in rows[0].items()}

    hero = dax(
        dataset,
        f"""
        EVALUATE
        CALCULATETABLE(
            ROW("v", [Zeitliche Auslastung Lehrräume %]),
            'Building'[building_code] = "{HERO}"
        )
        """,
    )
    values[f"{HERO} Lehrräume %"] = list(hero[0].values())[0]
    if zero_building is not None:
        zero = dax(
            dataset,
            f"""
            EVALUATE
            CALCULATETABLE(
                ROW("v", [Lehrräume im Filter]),
                'Building'[building_code] = "{zero_building}"
            )
            """,
        )
        values[f"{zero_building}{KNOWN_ZERO}"] = list(zero[0].values())[0]
    return values


def stamp_problems(dataset: str) -> list[str]:
    """Is the model the load of THIS rooms file, and may that file be in a model at all?

    ⚠️ THE FIGURES BELOW CANNOT ANSWER THIS. They prove the model equals the rooms file the last
    time it was loaded; a rooms file rebuilt since (real swapped for synthetic, or back) usually
    still has the same room count and a plausible utilisation. The hash is what notices, and the
    posture check is what stops a report from showing a data state the app claims to withhold.
    """
    folder = ROOT / "public" / "terrain" / AOI
    missing = [name for name in ("rooms.json", "occupancy.bin") if not (folder / name).exists()]
    if missing:
        return [f"{folder} lacks {' and '.join(missing)}: run tools/geodata/build_rooms.py first"]
    raw = (folder / "rooms.json").read_bytes()
    occupancy = (folder / "occupancy.bin").read_bytes()
    local = source_semantics(SITE, json.loads(raw.decode("utf-8")))
    rows = dax(dataset, "EVALUATE 'Data Load'")
    if len(rows) != 1:
        return [f"'Data Load' holds {len(rows)} rows, expected exactly one: rerun build_lakehouse_tables.py"]
    stamp = {key.split("[")[-1].rstrip("]"): value for key, value in rows[0].items()}
    print(f"stamp: {stamp.get('semantics')}, semester {stamp.get('semester')}, loaded {stamp.get('loaded_at_utc')}")

    problems: list[str] = []
    if stamp.get("source_sha256") != source_hash(raw, occupancy):
        problems.append(
            "the model was loaded from a different rooms.json or occupancy.bin than the ones on disk: "
            "rerun build_lakehouse_tables.py"
        )
    if stamp.get("semantics") != local:
        problems.append(f"the model is stamped {stamp.get('semantics')!r}, the rooms file on disk is {local!r}")
    if stamp.get("aoi") != AOI:
        problems.append(f"the model is a load of {stamp.get('aoi')!r}, not of {AOI!r}: wrong lakehouse behind this model")
    posture = problem_with(SITE, str(stamp.get("semantics")))
    if posture:
        problems.append(f"the model must not carry this load: {posture}")
    problems += served_problems(str(stamp.get("source_sha256")))
    return problems


def production_env(name: str) -> str:
    """A build-time setting: the shell first, then `.env.production`, exactly as `vite build` reads it."""
    if os.getenv(name):
        return os.environ[name].strip()
    path = ROOT / ".env.production"
    if not path.exists():
        return ""
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith(f"{name}="):
            return line.split("=", 1)[1].strip().strip("'\"")
    return ""


def served_problems(stamped_hash: str) -> list[str]:
    """Is the model the load of the files the DEPLOYED app is actually served?

    ⚠️ THE FILES ON THIS DISK ARE NOT THE FILES A VISITOR GETS. `public/terrain/` is gitignored and
    the production build loads it from a separate map server (`VITE_TERRAIN_BASE`), which is
    deployed on its own. So the lakehouse can be loaded from a rooms file rebuilt here this morning
    while the map server still serves last week's: every local check passes, and the report in the
    window shows other bookings than the scene behind it. Comparing the stamp with what the map
    server hands out is the only check that looks at both ends.
    """
    base = production_env("VITE_TERRAIN_BASE").rstrip("/")
    if not base.lower().startswith("http"):
        print("served files: not checked (no remote VITE_TERRAIN_BASE; the app ships public/terrain itself)")
        return []
    version = production_env("VITE_TERRAIN_VERSION")
    if version and all(ch.isalnum() or ch in "._-" for ch in version):
        scheme, rest = base.split("://", 1)
        host, _, path = rest.partition("/")
        base = f"{scheme}://{host}/_v/{version}/{path}".rstrip("/")
    try:
        served = [
            urllib.request.urlopen(f"{base}/{AOI}/{name}", timeout=180).read()  # noqa: S310
            for name in ("rooms.json", "occupancy.bin")
        ]
    except (urllib.error.URLError, OSError) as exc:
        return [f"could not fetch {AOI}'s rooms from the map server ({exc}): the served state is unknown"]
    if source_hash(served[0], served[1]) != stamped_hash:
        return [
            "the map server serves a different rooms.json or occupancy.bin than the model was loaded "
            "from: publish the map assets, or reload the lakehouse from what is served"
        ]
    print("served files: the map server serves exactly what the model was loaded from")
    return []


def main() -> None:
    dataset = model_id()
    print(f"model: {dataset}\n")

    failures: list[str] = stamp_problems(dataset)
    app = from_app()
    zero_building = next((key[: -len(KNOWN_ZERO)] for key in app if key.endswith(KNOWN_ZERO)), None)
    model = from_model(dataset, zero_building)

    print(f"\n{'measure':<36} {'app':>14} {'model':>14}   verdict")
    print("-" * 84)
    for key, expected in app.items():
        actual = model.get(key)
        if expected is None:
            # Nothing to average on the app side (no calendared teaching room): the model must say
            # "unknown" too, which in DAX is blank. A number here would be an invented one.
            ok = actual is None
            if not ok:
                failures.append(f"{key}: the app has no value, the model says {actual}")
            print(f"{key:<36} {'(none)':>14} {str(actual if actual is not None else '(blank)'):>14}   {'ok' if ok else 'MISMATCH'}")
            continue
        if actual is None:
            failures.append(f"{key}: the model returned nothing")
            print(f"{key:<36} {expected:>14.4f} {'—':>14}   MISSING")
            continue
        ok = abs(float(actual) - float(expected)) <= TOLERANCE
        if not ok:
            failures.append(f"{key}: app {expected} vs model {actual}")
        print(f"{key:<36} {expected:>14.4f} {float(actual):>14.4f}   {'ok' if ok else 'MISMATCH'}")

    print()
    if failures:
        print(f"AGREEMENT FAILED ({len(failures)}):\n")
        for problem in failures:
            print(f"  - {problem}")
        print(
            "\nThe app and the model are computing different things. Fix the measure or the app,\n"
            "not this test."
        )
        sys.exit(1)

    print(f"app and model agree on all {len(app)} figures, to {TOLERANCE:g}")


if __name__ == "__main__":
    main()
