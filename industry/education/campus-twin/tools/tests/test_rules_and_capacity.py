"""Does the rule catalogue actually reach the solver, and does a capacity edit say what it breaks?

Two properties, both of which would be silently absent if the refactor merely compiled:
  1. Reordering the soft costs changes the WEIGHTS the solver uses.
  2. Changing breakMin changes what the travel rule permits.
  3. A capacity edit reports the sessions it just put over capacity, rather than "saved".
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

import rules  # noqa: E402
from schedule_store import ScheduleStore  # noqa: E402
import tools  # noqa: E402

fails = []


def check(label, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {label}{('  — ' + str(detail)) if detail else ''}")
    if not ok:
        fails.append(label)


# ── 1. defaults reproduce the old literals exactly ──────────────────────────────────────────
w = rules.weights("lmu")
check("the shipped ranking reproduces the old costs 3/6/8/10",
      (w["room"], w["slot"], w["desirability"], w["campus"]) == (3, 6, 8, 10), w)
check("breakMin still defaults to the constant", rules.break_min("lmu") == tools.BREAK_MIN)

# ── 2. reordering really moves the weights ──────────────────────────────────────────────────
rules.apply({"order": ["slot", "room", "desirability", "campus"]}, "lmu")
w2 = rules.weights("lmu")
check("ranking time first makes the ROOM the cheap change",
      w2["slot"] == 3 and w2["room"] == 6, w2)

# ⚠️ The property that matters: the SOLVER must see it, not just the catalogue.
check("the solver reads the catalogue, not a literal",
      "rules.weights()" in (ROOT / "server" / "tools.py").read_text(encoding="utf-8"))

# ── 3. an incoherent ranking is refused, not completed ──────────────────────────────────────
bad = rules.apply({"order": ["room", "room"]}, "lmu")
check("a ranking missing a term is refused", any(r["field"] == "order" for r in bad["refused"]),
      bad["refused"])
out_of_range = rules.apply({"breakMin": 999}, "lmu")
check("an out-of-range number is refused with its bounds",
      any(r["field"] == "breakMin" for r in out_of_range["refused"]), out_of_range["refused"])

rules.reset("lmu")
check("reset restores the shipped ranking", rules.weights("lmu")["room"] == 3)

# ── 4. breakMin actually changes what the travel rule permits ───────────────────────────────
# ⚠️ `conflicts` is a COUNT, not a list — measured, after the first version of this test called
# len() on an int.
#
# ⚠️⚠️ AND THE POLARITY IS THE OPPOSITE OF WHAT THE NAME SUGGESTS. `BREAK_MIN` is the break the
# TIMETABLE PROVIDES between consecutive blocks, and the rule is `travel < break` — a pair is a
# conflict when the journey does NOT fit in the gap. So a BIGGER value is MORE permissive:
# measured here, break 0 gives 401 conflicts and break 60 gives none. The first version of this
# test asserted the reverse and was wrong about the product, not the other way round.
#
# ⚠️ This matters beyond the test: PLAN §39.6 replaces this with `travel + 5 (walk) | + 15 (bus)`,
# which is a REQUIRED BUFFER — the opposite polarity. Implementing it by raising this number would
# loosen the rule it is meant to tighten.
store = ScheduleStore.load("lmu")
rules.apply({"breakMin": 60}, "lmu")
generous_n = tools.detect_conflicts(store)["conflicts"]
rules.apply({"breakMin": 0}, "lmu")
none_n = tools.detect_conflicts(store)["conflicts"]
rules.reset("lmu")
check("a longer available break permits MORE, not less",
      generous_n < none_n, f"break 60 -> {generous_n} conflicts, break 0 -> {none_n}")
check("and the shipped value leaves the generated week conflict-free",
      tools.detect_conflicts(store)["conflicts"] == 0)

# ── 5. a capacity edit says what it breaks ──────────────────────────────────────────────────
booked = {}
for a in store.assignments:
    booked.setdefault(a.get("roomId"), []).append(a["sessionId"])
room_id = next(r for r, s in booked.items() if r and len(s) > 0)
before = store.room_by_id[room_id].get("capacity")

res = store.set_room_capacity(room_id, 1, changed_by="test")
check("shrinking a booked room reports the sessions now over capacity",
      len(res["nowOverCapacity"]) > 0, f"{room_id}: {len(res['nowOverCapacity'])} sessions")
check("the write reports where it came from and where it went",
      res["from"] == before and res["to"] == 1)
check("provenance follows the number", store.room_by_id[room_id]["capacityProvenance"] == "planner")

cleared = store.set_room_capacity(room_id, None)
check("clearing a capacity is allowed and means 'nobody measured this'",
      cleared["to"] is None and store.room_by_id[room_id]["capacityProvenance"] is None)
check("an unknown capacity breaks nothing, because it cannot be checked",
      cleared["nowOverCapacity"] == [])
check("an unknown room is refused by name",
      store.set_room_capacity("does-not-exist", 10).get("error") == "room_not_found")
check("a negative capacity is refused",
      store.set_room_capacity(room_id, -5).get("error") == "capacity_negative")

store.set_room_capacity(room_id, before)

# ── 5. no IT jargon in text the SERVER puts on a planner's screen ────────────────────────────
# ⚠️ THE GAP THIS CLOSES. `src/i18n/__tests__/catalogue.test.ts` bans these words, but it reads the
# i18n JSON only — it cannot see a label or note that the backend serves. The word "Solver" reached
# the Regelwerk on 20.08 through exactly this hole, in `META[...]["note"]`, and the frontend test
# stayed green. Same list, applied to the other half of the surface.
JARGON = (
    "solver", "backend", "frontend", "endpoint", "payload", "cache",
    "constraint", "uuid", "deterministisch",
)
served = [(f"ORDER_LABELS.{k}", v) for k, v in rules.ORDER_LABELS.items()]
served += [(f"META.{k}.note", m["note"]) for k, m in rules.META.items()]
offences = [f"{where}: {word}" for where, text in served
            for word in JARGON if word in text.lower()]
check("nothing the server renders speaks IT jargon", not offences, offences)

print("\n" + ("rules + capacity ok — the catalogue reaches the solver and a write says what it breaks"
              if not fails else f"{len(fails)} check(s) failed: " + "; ".join(fails)))
raise SystemExit(1 if fails else 0)
