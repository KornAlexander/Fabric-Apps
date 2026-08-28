"""A stated absence must reach the AVAILABILITY table, not just the solver.

PLAN §40 / Alexander 2026-08-20: *"if I say Aubinger not available on a Thursday then it should also
reflect and propose to change his availability, not just change the schedule."*

Until now "X kann donnerstags nicht" was consumed as a one-off `forbid`, the plan was repaired, and
the constraint the plan is JUDGED against learnt nothing — ask again tomorrow and the app has no
idea. `_availability_proposal` turns the parsed absence into something the client can offer.

The properties worth pinning are the refusals and the honesty, not the happy path:

  1. Naming a day yields a proposal covering exactly that day's slots.
  2. ⚠️ Naming NO day yields NOTHING. `get_affected_sessions` without a day considers the whole
     week, and proposing that would offer to block a lecturer's entire timetable because somebody
     asked what they teach.
  3. It is marked `recurring`, because availability carries no date and this blocks every Thursday.
  4. An error result (unknown teacher, invented attribution) never produces a proposal.
  5. The state is the dataset's own spelling, which is what the solver compares against.
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
os.environ["SCHEDULER_SITE"] = "lmu"

import foundry  # noqa: E402
import tools  # noqa: E402
from schedule_store import ScheduleStore  # noqa: E402

fails = []


def check(label, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {label}{('  — ' + str(detail)) if detail else ''}")
    if not ok:
        fails.append(label)


store = ScheduleStore.load("lmu")

# A lecturer who actually teaches on a Thursday, so the case is real rather than vacuous.
thursday = set(store.slots_of_day("Do"))
teacher_id = next(
    (a["teacherId"] for a in store.assignments if a["slotId"] in thursday and a.get("teacherId")),
    None,
)
check("found a lecturer teaching on a Thursday", bool(teacher_id), teacher_id)
name = store.teacher_by_id[teacher_id]["name"]

# ── 1. the case Alexander described ──────────────────────────────────────────────────────────
args = {"teacher": name, "day": "Do"}
result = tools.get_affected_sessions(store, **args)
proposal = foundry._availability_proposal(result, args)
check("naming a day produces an availability proposal", proposal is not None)
check("it names the right lecturer", proposal and proposal["teacherId"] == teacher_id,
      proposal and proposal.get("teacher"))
check("it covers exactly that day's slots",
      proposal and set(proposal["slotIds"]) == thursday,
      proposal and len(proposal["slotIds"]))
check("the state is the dataset's spelling, not a display word",
      proposal and proposal["state"] == "nicht_verfuegbar", proposal and proposal.get("state"))

# ── 3. honesty about what the data model can express ─────────────────────────────────────────
# ⚠️ Availability is keyed on `Do-3` — a day and a block, with no date. So this blocks EVERY
# Thursday, and a UI that implied "just this week" would be lying about the model.
check("it is flagged recurring, because availability has no dates",
      proposal and proposal.get("recurring") is True)
check("no slot carries a date", all("-" in s and not any(ch.isdigit() for ch in s.split("-")[0])
                                    for s in (proposal or {}).get("slotIds", [])),
      (proposal or {}).get("slotIds", [])[:3])

# ── 2. THE GUARD WITH TEETH: a question with no time must offer nothing ──────────────────────
open_args = {"teacher": name}
open_result = tools.get_affected_sessions(store, **open_args)
open_proposal = foundry._availability_proposal(open_result, open_args)
check("asking WITHOUT a day proposes nothing at all", open_proposal is None,
      f"considered {len(open_result.get('slotsConsidered', []))} slots")
# And prove the guard is not vacuous — that call really did consider the whole week.
check("(and that call really did span the whole week, so the guard matters)",
      len(open_result.get("slotsConsidered", [])) == len(store.slots),
      f"{len(open_result.get('slotsConsidered', []))} of {len(store.slots)}")

# ── 4. errors never become proposals ─────────────────────────────────────────────────────────
bad = tools.get_affected_sessions(store, teacher="Nichtexistent Person", day="Do")
check("an unresolvable lecturer proposes nothing",
      foundry._availability_proposal(bad, {"teacher": "Nichtexistent Person", "day": "Do"}) is None,
      bad.get("error"))

# ── 5. specific slots work too, not only whole days ──────────────────────────────────────────
some = sorted(thursday)[:2]
slot_args = {"teacher": name, "slot_ids": some}
slot_proposal = foundry._availability_proposal(
    tools.get_affected_sessions(store, **slot_args), slot_args
)
check("naming individual slots also proposes",
      slot_proposal is not None and set(slot_proposal["slotIds"]) == set(some),
      slot_proposal and slot_proposal["slotIds"])

print("\n" + ("availability proposal ok — a stated absence reaches the constraint, and only when timed"
              if not fails else f"{len(fails)} FAILED: {', '.join(fails)}"))
sys.exit(1 if fails else 0)
