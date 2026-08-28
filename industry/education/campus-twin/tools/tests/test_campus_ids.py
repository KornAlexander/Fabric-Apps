"""Campus ids must agree between what an AOI DECLARES and what the data USES.

⚠️ WRITTEN BECAUSE A RENAME IS PENDING AND NOTHING WOULD HAVE CAUGHT A BOTCHED ONE. PLAN §55
records that Tübingen's campus is called `altstadt`, a city district, and should be renamed.
`campusId` is a JOIN KEY: it sits on 3 280 buildings, on every assignment, and in the AOI. A rename
that lands in five files out of six leaves buildings tagged with the old id and sessions tagged
with the new one, and the result is a campus that renders with no rooms rather than an error.

Before this file, the whole suite passed in that state. `test_campus_travel.py` asserts how long it
takes to get BETWEEN campuses; nothing asserted that the campuses referred to actually exist.

The checks are deliberately about REFERENTIAL INTEGRITY rather than about any particular name, so
the file stays useful after the rename and for every site that gains a campus later.

    python tools/tests/test_campus_ids.py
"""

from __future__ import annotations

# ⚠️ UTF-8 REGARDLESS OF WHERE THE OUTPUT GOES. Python uses the console encoding for a terminal but
# the LOCALE encoding for a redirected stream (cp1252 on this machine), so printing a German name or
# a warning sign raised UnicodeEncodeError as soon as anything captured stdout — a runner, CI, or a
# pipe. The suite reported 54/54 for a while purely because the shell that ran it happened to carry
# PYTHONIOENCODING; without it, 23 of 54 files failed on output rather than on anything they test.
# Imported here rather than relied upon from below: this runs before the rest of the imports.
import sys as _sys

if hasattr(_sys.stdout, "reconfigure"):
    _sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(_sys.stderr, "reconfigure"):
    _sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name} {detail}")
        FAILURES.append(name)


def load(path: Path) -> object | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None


def rows_of(obj: object) -> list[dict]:
    if isinstance(obj, dict):
        for key in ("buildings", "rows", "items"):
            if isinstance(obj.get(key), list):
                return obj[key]
        return []
    return obj if isinstance(obj, list) else []


def declared_campuses(aoi_id: str) -> set[str] | None:
    aoi = load(ROOT / "config" / "aoi" / f"{aoi_id}.json")
    if not isinstance(aoi, dict):
        return None
    return {c["id"] for c in aoi.get("campuses", []) if c.get("id")}


def site_to_aoi() -> dict[str, str]:
    """Read the site registry without importing it, so a dirty registry cannot break the test."""
    import re
    src = (ROOT / "tools" / "data" / "sites.py").read_text(encoding="utf-8")
    out: dict[str, str] = {}
    for m in re.finditer(r'"(?P<sid>[a-z0-9\-]+)":\s*Site\((?P<body>.*?)\n\s*\),',
                         src, re.S):
        a = re.search(r'aoi_id="([^"]+)"', m.group("body"))
        s = re.search(r'id="([^"]+)"', m.group("body"))
        if a and s:
            out[s.group(1)] = a.group(1)
    return out


SITES = site_to_aoi()
print(f"site -> aoi: {SITES}\n")
check("the site registry was parsed", bool(SITES), "no sites found")

for site_id, aoi_id in sorted(SITES.items()):
    declared = declared_campuses(aoi_id)
    if declared is None:
        print(f"\n=== {site_id}: AOI {aoi_id}.json unreadable, skipped ===")
        continue

    # The dataset directory is the site's `synth` path; derive it the same way sites.py does.
    data_dir = ROOT / "data" / ("synthetic" if site_id == "oth" else
                                "tum" if site_id == "tum" else
                                "oth-real" if site_id == "oth-real" else
                                f"synthetic-{site_id}")
    buildings = rows_of(load(data_dir / "building.json"))
    assignments = rows_of(load(data_dir / "plan_assignment.json"))
    if not buildings:
        print(f"\n=== {site_id}: no built dataset at {data_dir.name}, skipped ===")
        continue

    print(f"\n=== {site_id} (aoi {aoi_id}) ===")
    print(f"  declared campuses: {sorted(declared)}")

    used_b = {b.get("campusId") for b in buildings if b.get("campusId")}
    used_a = {a.get("campusId") for a in assignments if a.get("campusId")}
    print(f"  used by buildings: {sorted(used_b)}")
    if used_a:
        print(f"  used by sessions : {sorted(used_a)}")

    # ⚠️ AN AOI THAT DECLARES NO CAMPUSES OPTS OUT OF THE REFERENTIAL CHECK, AND THAT IS A
    # COMPROMISE RATHER THAN A CLEAN RULE. `campuses` is optional in `AoiConfig`, and Garching is
    # the only AOI of nine that omits it while its data tags all 23 buildings and all 1 470
    # assignments `campusId: "garching"`. That id therefore points at nothing.
    #
    # It is reported, not failed, for two reasons. It is latent: nothing reads `aoi.campuses` for
    # TUM, so no behaviour is wrong today. And `src/config/__tests__/sites.test.ts` PINS the empty
    # list by id, deliberately, "so a third site is a deliberate edit here rather than a number
    # that quietly changed" - so declaring the campus is a decision that belongs in that file and
    # not a fix that can be smuggled in from a config. Recorded in PLAN §55.
    if not declared:
        print(f"  ⚠️ this AOI declares NO campuses, yet its data uses {sorted(used_b)}.")
        print("     Reported, not failed: the empty list is pinned in sites.test.ts on purpose.")
        print("     Declaring it is an edit to that pin, not to this config. See PLAN §55.")
        continue

    # 1. No dangling reference. This is the half-applied-rename detector.
    check(f"{site_id}: every building's campusId is declared",
          used_b <= declared, f"undeclared={sorted(used_b - declared)}")
    if assignments:
        check(f"{site_id}: every assignment's campusId is declared",
              used_a <= declared, f"undeclared={sorted(used_a - declared)}")

    # 2. ⚠️ THE FAILURE THAT LOOKS LIKE AN EMPTY PANEL RATHER THAN AN ERROR. Buildings and
    #    sessions must agree with EACH OTHER, not merely each with the AOI. A rename applied to
    #    the buildings file and not to the generated plan satisfies check 1 twice over and still
    #    produces a campus whose rooms nobody teaches in.
    if used_a:
        check(f"{site_id}: buildings and sessions use the same campus vocabulary",
              used_a <= used_b,
              f"sessions reference campuses no building has: {sorted(used_a - used_b)}")

    # 3. A declared campus with nothing in it is usually a leftover from a rename.
    empty = declared - used_b
    check(f"{site_id}: no declared campus is empty of buildings",
          not empty, f"empty={sorted(empty)}")

# ------------------------------------------------------------------------------------------------
# ⚠️ Negative control. Every assertion above passes today, so none of them has been seen to fail.
# ------------------------------------------------------------------------------------------------
print("\n=== negative control: a half-applied rename must be caught ===")
declared_fake = {"innenstadt"}
buildings_fake = {"altstadt"}          # the file that was NOT updated
sessions_fake = {"innenstadt"}         # the file that WAS
check("an undeclared building campusId is detected",
      not (buildings_fake <= declared_fake), "the check would have passed")
check("sessions referencing a campus no building has is detected",
      not (sessions_fake <= buildings_fake), "the check would have passed")
check("a declared-but-empty campus is detected",
      bool(declared_fake - buildings_fake), "the check would have passed")

print()
if FAILURES:
    print(f"FAILED: {len(FAILURES)} check(s): {', '.join(FAILURES)}")
    raise SystemExit(1)
print("campus ids: all checks pass")
