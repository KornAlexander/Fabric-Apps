"""`get_plan_overview` must survive a dataset that publishes no room capacities — and say so.

⚠️ THIS CRASHED IN PRODUCTION ON THE ONLY REAL DATASET. OTH's Untis export carries no headcount for
**122 of its 148 rooms**, and `entry["seats"] += r["capacity"]` raised
`TypeError: unsupported operand type(s) for +=: 'int' and 'NoneType'`. So the most ordinary question
a planner can ask — "how many lecture halls do we have?" — returned `tool_failed` on the dataset the
customer would recognise as their own.

The repair is not "default it to 0". A zero would have been answered aloud as "der Hörsaal hat 0
Plätze", which a planner would act on. The rule this project already follows elsewhere applies: a
check that cannot be performed is not a check that passed, and the gap is reported as a gap.

  1. It does not crash on oth-real.
  2. Unknown capacities are COUNTED, not guessed.
  3. A room type where nobody published anything reports `seats: null`, never 0.
  4. The sum only ever includes published capacities.
  5. The answer carries its own caveat, so the model cannot quote the figure without it.
  6. The sites that DO publish capacities are unaffected.
"""

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
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

from schedule_store import ScheduleStore  # noqa: E402
import tools  # noqa: E402

fails = []


def check(label, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {label}{('  — ' + str(detail)) if detail else ''}")
    if not ok:
        fails.append(label)


# ── the dataset that broke it ────────────────────────────────────────────────────────────────
os.environ["SCHEDULER_SITE"] = "oth-real"
real = ScheduleStore.load("oth-real")
missing = [r for r in real.rooms if r.get("capacity") is None]
check("oth-real really does lack capacities (the guard is not vacuous)",
      len(missing) > 100, f"{len(missing)} of {len(real.rooms)} rooms")

try:
    o = tools.get_plan_overview(real)
    crashed = None
except Exception as exc:  # noqa: BLE001 - the whole point of the test
    o, crashed = None, f"{type(exc).__name__}: {exc}"
check("it no longer crashes on oth-real", crashed is None, crashed or "")

if o:
    teaching_unknown = sum(e["seatsUnknown"] for e in o["roomTypes"].values())
    check("unknown capacities are counted, not guessed",
          o["seatsUnknown"] == teaching_unknown and o["seatsUnknown"] > 0, o["seatsUnknown"])

    # ⚠️ The distinction the whole fix turns on.
    blank = [k for k, e in o["roomTypes"].items() if e["seats"] is None]
    zero = [k for k, e in o["roomTypes"].items() if e["seats"] == 0]
    check("a type with nothing published reports null, never 0",
          not zero, f"null: {blank} / zero: {zero}")

    # The sum must be reachable from the known rooms alone.
    known_total = sum(r["capacity"] for r in real.rooms
                      if r.get("schedulable") and r.get("capacity") is not None)
    summed = sum(e["seats"] or 0 for e in o["roomTypes"].values())
    check("the sum contains only published capacities", summed == known_total,
          f"{summed} vs {known_total}")

    check("the answer carries its own caveat", bool(o.get("$seatsNote")),
          (o.get("$seatsNote") or "")[:80])
    check("min/max never come from an unpublished room",
          all(e["capacityMin"] is None or e["capacityMin"] > 0 for e in o["roomTypes"].values()))

    # ── the untyped bucket ───────────────────────────────────────────────────────────────────
    # ⚠️ A `None` key serialised to the JSON key "null", so the assistant read it as the NAME of a
    # room type. Worse, the `room_type` filter below did `k.lower()` on it.
    check("no room-type key is null", all(isinstance(k, str) for k in o["roomTypes"]),
          list(o["roomTypes"])[:4])
    check("untyped rooms are a named bucket, and the answer says it is not a room type",
          o.get("untypedRooms", 0) > 0 and bool(o.get("$typesNote")),
          f"{o.get('untypedRooms')} untyped")

    # ⚠️ THE SECOND CRASH: "Wie viele Hörsäle gibt es?" is the question this tool was added for,
    # and with a filter it raised AttributeError on the only real dataset.
    try:
        filtered = tools.get_plan_overview(real, room_type="Hörsaal")
        check("filtering by room type does not crash", True, list(filtered["roomTypes"]))
    except Exception as exc:  # noqa: BLE001
        check("filtering by room type does not crash", False, f"{type(exc).__name__}: {exc}")
    try:
        tools.get_plan_overview(real, room_type="gibtesnicht")
        check("an unknown room type is empty, not an error", True)
    except Exception as exc:  # noqa: BLE001
        check("an unknown room type is empty, not an error", False, str(exc))

# ── the sites that DO publish capacities must be untouched ───────────────────────────────────
for site in ("oth", "lmu", "tum"):
    os.environ["SCHEDULER_SITE"] = site
    s = ScheduleStore.load(site)
    ov = tools.get_plan_overview(s)
    known = sum(r["capacity"] for r in s.rooms
                if r.get("schedulable") and r.get("capacity") is not None)
    summed = sum(e["seats"] or 0 for e in ov["roomTypes"].values())
    check(f"{site}: totals unchanged and no caveat invented",
          summed == known and (ov["seatsUnknown"] > 0) == bool(ov.get("$seatsNote")),
          f"{summed} seats, {ov['seatsUnknown']} unknown")

print("\n" + ("plan overview ok — it counts what was published and says what was not"
              if not fails else f"{len(fails)} FAILED: {', '.join(fails)}"))
sys.exit(1 if fails else 0)
