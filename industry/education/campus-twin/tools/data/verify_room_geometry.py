"""Check the built twin against the dataset it claims to describe — a gate, not a report.

⚠️ WHY THIS EXISTS. Both faults it catches were LIVE on the deployed app on 2026-08-18, and no
test in the repository could see either, because `public/terrain/` is gitignored: the assets are
generated, never committed, and therefore never reviewed.

1. **A stale occupancy grid.** `occupancy.bin` is read off the timetable at build time. Regenerating
   the timetable does not rebuild it, and the standing rule to re-run this builder afterwards was
   simply not followed. The deployed OTH twin coloured its rooms from **1 962** booked hours while
   the dataset the backend serves has **1 856** — so a room could show as busy at an hour the
   calendar says is free. A rule that is not followed needs a check, not a louder rule.

2. **A provenance line naming the wrong university.** The plan-source sentence used to be
   hard-coded, so LMU's twin credited another institution with LMU's own 686 floor-plan rooms. The
   generator was fixed; the built file was not rebuilt, so the wrong sentence stayed deployed. A
   provenance field that lies is worse than none, because it is the field a reader trusts.

⚠️ IT RECOMPUTES RATHER THAN RE-READS. The occupancy grid is derived here from `plan_assignment`
and `time_slot` directly, sharing no code with the builder. A checker that imported the builder's
own function would agree with it about everything, including its mistakes.

    python tools/data/verify_room_geometry.py            # every site that has a built twin
    python tools/data/verify_room_geometry.py --site lmu
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import sites  # noqa: E402

#: Mirrors the builder's grid, deliberately restated rather than imported.
DAYS = ["Mo", "Di", "Mi", "Do", "Fr"]
FIRST_HOUR = 8
HOURS = 12
SLOTS = len(DAYS) * HOURS


def expected_grid(site) -> dict[str, list[int]]:
    """The occupancy the dataset implies, derived from the plan and the block scheme."""
    folder = Path(site.synth)
    load = lambda n: json.loads((folder / f"{n}.json").read_text(encoding="utf-8"))  # noqa: E731
    slots = {s["slotId"]: s for s in load("time_slot")}

    grid: dict[str, list[int]] = defaultdict(lambda: [0] * SLOTS)
    for a in load("plan_assignment"):
        slot = slots.get(a.get("slotId"))
        if not slot or not a.get("roomId"):
            continue
        day_i = DAYS.index(slot["day"]) if slot["day"] in DAYS else 0
        start_h = int(slot["startTime"].split(":")[0])
        end_h, end_min = (int(x) for x in slot["endTime"].split(":")[:2])
        last = end_h if end_min > 0 else end_h - 1
        for hour in range(start_h, last + 1):
            if 0 <= hour - FIRST_HOUR < HOURS:
                grid[a["roomId"]][day_i * HOURS + (hour - FIRST_HOUR)] = 1
    return grid


def check(site_key: str) -> list[str]:
    site = sites.SITES[site_key]
    built = site.terrain_dir()
    meta_path = built / "rooms.json"
    if not meta_path.exists():
        return [f"{site_key}: no built twin at {meta_path} — run build_room_geometry.py --site {site_key}"]

    problems: list[str] = []
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    rows = (built / "occupancy.bin").read_bytes()

    # ── 1. the grid the file ships against the grid the dataset implies ──────────────────
    #
    # ⚠️ GENERATED SITES ONLY, AND THAT IS A SCOPE DECISION, NOT A GAP. On a site whose timetable
    # is real, the twin is built by `build_rooms.py` from published bookings and a byte of
    # `occupancy.bin` counts SEMESTER WEEKS, not "busy that hour" — so comparing it against a
    # one-week plan reports every room as wrong. My first version did exactly that and produced
    # 241 confident false findings about TUM. Applying a check where it does not apply fabricates
    # defects just as surely as skipping one hides them; the site is declared out of scope, aloud.
    #
    # ⚠️ THE ROW POINTER IS `occupancy`, AND THE ROOM KEY IS `code`. My first version read
    # `occupancyRow` and `id`, neither of which exists on these records, so it compared **zero
    # rows on every site** and reported OK — a vacuous pass, caught only because the sabotage
    # script counted the rows being compared before trusting the verdict. Hence the refusals
    # below: a check that cannot be performed is not a check that passed.
    if not site.is_generated:
        print(f"   {site_key}: occupancy not compared — this twin is built from published "
              f"bookings, where a byte counts semester weeks rather than one planned week")
    else:
        want = expected_grid(site)
        booked_rooms = {k for k, v in want.items() if any(v)}
        with_occ = [r for r in meta["rooms"] if r.get("occupancy") is not None]

        if not with_occ:
            problems.append(
                f"{site_key}: no room in the built twin points at a row of occupancy.bin, so the "
                f"grid could not be compared at all. Either the twin is broken or this checker "
                f"is reading the wrong field."
            )
        elif not booked_rooms:
            problems.append(
                f"{site_key}: the dataset implies no bookings anywhere, so there is nothing to "
                f"compare. That is never true of a site with a timetable."
            )
        else:
            compared = [r for r in with_occ if r["code"] in want]
            if not compared:
                problems.append(
                    f"{site_key}: none of the {len(with_occ)} rooms carrying an occupancy row "
                    f"could be matched to a room in the plan by `code`. The comparison did not "
                    f"happen; do not read this as agreement."
                )
            else:
                mismatched = [
                    r["code"] for r in compared
                    if list(rows[r["occupancy"] * SLOTS:(r["occupancy"] + 1) * SLOTS])
                    != want[r["code"]]
                ]
                shipped_hours = sum(1 for b in rows if b)
                want_hours = sum(sum(v) for v in want.values())
                if mismatched:
                    problems.append(
                        f"{site_key}: {len(mismatched)} of {len(compared)} compared room rows "
                        f"disagree with the dataset ({shipped_hours} booked hours shipped, "
                        f"{want_hours} in the plan) — e.g. {', '.join(mismatched[:4])}. The twin "
                        f"is older than the timetable; re-run "
                        f"`python tools/data/build_room_geometry.py --site {site_key}`."
                    )

    # ── 2. the plan-source sentence must name THIS university's own source ──────────────
    prov = meta.get("provenance", {})
    line = prov.get("outlines (Bauplan)", "")
    plan_file = getattr(site, "plan_rooms", None)
    if plan_file:
        declared = json.loads(Path(plan_file).read_text(encoding="utf-8")).get("source", "")
        if declared and not line.startswith(declared):
            problems.append(
                f"{site_key}: the interior provenance does not come from this site's own plan "
                f"file.\n    shipped : {line[:140]}\n    declared: {declared[:140]}"
            )
    return problems


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify the built twin against its dataset.")
    parser.add_argument("--site", choices=sorted(sites.SITES), help="only this site")
    args = parser.parse_args()

    keys = [args.site] if args.site else sorted(sites.SITES)
    problems: list[str] = []
    for key in keys:
        built = sites.SITES[key].terrain_dir() / "rooms.json"
        if not built.exists():
            print(f"·  {key}: no built twin on this machine — skipped")
            continue
        found = check(key)
        print(("✗  " if found else "ok ") + f"{key}")
        problems += found

    for p in problems:
        print(f"\n  {p}")
    print(f"\n{'FAIL' if problems else 'OK'} — {len(problems)} problem(s)")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
