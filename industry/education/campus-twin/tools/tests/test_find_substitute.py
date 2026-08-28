"""`find_substitute` — is every name it returns actually able to take the session?

⚠️ THIS TEST DID NOT EXIST. Slice 1 (PLAN §40.4) was verified live and by a throwaway script, so
the tool's contract was pinned nowhere and the output shape could be changed by accident. It is the
one tool whose failure mode is a CONFIDENT WRONG NAME — proposing a lecturer who is already
teaching that hour is this repository's most expensive recurring bug wearing a helpful face — so
the feasibility claim is re-checked here against the store rather than trusted from the tool.

Properties:
  1. Every returned candidate is genuinely free, genuinely available, and not the incumbent.
  2. The candidate set is capped, ordered by score, and every name carries at least one reason.
  3. The counts add up: considered == returned + rejected.
  4. `rejectedByCode` mirrors `rejected` exactly (the UI reads codes, the assistant reads prose).
  5. The Deputat reason carries NUMBERS, so the panel can project the load without parsing German.
  6. An empty result explains itself instead of offering a least-bad name.
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

from schedule_store import ScheduleStore  # noqa: E402
import tools  # noqa: E402

fails = []


def check(label, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {label}{('  — ' + str(detail)) if detail else ''}")
    if not ok:
        fails.append(label)


store = ScheduleStore.load("lmu")
_room_slot, teacher_slot, _attendee = store.occupied()

# Sweep a broad sample rather than one lucky session: a single session can pass every property by
# accident (the degenerate-axis trap that has produced false-green guards here before).
sessions = [a["sessionId"] for a in store.assignments][:400]
results = [tools.find_substitute(store, sid) for sid in sessions]
usable = [r for r in results if "error" not in r]
check("the sample produced usable answers", len(usable) > 50, f"{len(usable)} of {len(sessions)}")

with_candidates = [r for r in usable if r["candidates"]]
check("some sessions actually have a substitute", len(with_candidates) > 0, len(with_candidates))

# ── 1. THE CLAIM WITH TEETH: re-check feasibility independently of the tool ──────────────────
infeasible = []
for r in usable:
    slot = r["slotId"]
    for c in r["candidates"]:
        tid = c["teacherId"]
        if tid == r["incumbent"]["id"]:
            infeasible.append((r["sessionId"], tid, "is the incumbent"))
        if (tid, slot) in store.unavailable:
            infeasible.append((r["sessionId"], tid, "stated unavailable"))
        if (tid, slot) in teacher_slot:
            infeasible.append((r["sessionId"], tid, "already teaching"))
        if not c.get("feasible"):
            infeasible.append((r["sessionId"], tid, "not flagged feasible"))
check("every returned candidate can really take the session", not infeasible, infeasible[:3])

# ⚠️ AND THE GUARD ABOVE MUST NOT BE VACUOUS. If nobody were ever rejected for already teaching,
# property 1 would pass on a population containing no violations to find — the "degenerate axis"
# failure this repo has hit before, where a guard is green because the case cannot arise. These
# counts prove the filter is doing work: remove it and those same people become candidates, which
# is exactly what the re-check above would then catch.
busy = sum(r["rejectedByCode"].get("alreadyTeaching", 0) for r in usable)
blocked = sum(r["rejectedByCode"].get("unavailable", 0) for r in usable)
check("the feasibility filter actually rejected people (so the check above has teeth)",
      busy > 0 and blocked > 0, f"{busy} already teaching, {blocked} unavailable")

# ── 2. shape ─────────────────────────────────────────────────────────────────────────────────
check("never more than k candidates", all(len(r["candidates"]) <= 5 for r in usable))
check("candidates are ordered by score, best first",
      all(all(a["score"] >= b["score"] for a, b in zip(r["candidates"], r["candidates"][1:]))
          for r in usable))
check("every candidate carries a reason",
      all(c["reasons"] for r in usable for c in r["candidates"]))

# ── 3. the arithmetic the answer states about itself ─────────────────────────────────────────
check("considered == returned + rejected",
      all(r["consideredCount"] == len(r["candidates"]) + sum(r["rejected"].values())
          for r in usable if len(r["candidates"]) < 5))

# ── 4. the two rejection vocabularies cannot drift ───────────────────────────────────────────
check("rejectedByCode totals match rejected",
      all(sum(r["rejectedByCode"].values()) == sum(r["rejected"].values()) for r in usable))
check("rejectedByCode uses stable codes, not German prose",
      set().union(*[set(r["rejectedByCode"]) for r in usable]) <= {
          "unavailable", "alreadyTeaching", "travelTooFar"},
      sorted(set().union(*[set(r["rejectedByCode"]) for r in usable])))

# ── 5. the Deputat reason must be machine-readable, or the panel cannot project it ───────────
dep = [rz for r in usable for c in r["candidates"] for rz in c["reasons"]
       if rz["code"] in ("deputatHeadroom", "deputatFull")]
check("the Deputat reason exists on this dataset", len(dep) > 0, len(dep))
check("it carries taught and contract as NUMBERS",
      all(isinstance(d.get("taught"), (int, float)) and isinstance(d.get("contract"), (int, float))
          for d in dep))
check("headroom is exactly contract minus taught (no rounding drift)",
      all(abs((d["contract"] - d["taught"]) - d["value"]) < 1e-9 for d in dep))
# ⚠️ Without this the panel would print "+undefined SWS" or, worse, invent a zero.
check("the session's own SWS is reported so the load can be projected",
      all("sessionSws" in r for r in usable))

# ── 6. an empty answer is an answer ──────────────────────────────────────────────────────────
empty = [r for r in usable if not r["candidates"]]
check("an empty candidate list explains itself",
      all(r.get("$emptyNote") for r in empty), f"{len(empty)} empty")

# ⚠️ The competence caveat must survive: Lehrbefähigung is approximated by faculty, and an answer
# that stops saying so is an answer that has started overclaiming.
check("every answer still states the competence approximation",
      all(r.get("$competenceNote") for r in usable))

print("\n" + ("find_substitute ok — every name returned is one the store agrees can take the session"
              if not fails else f"{len(fails)} FAILED: {', '.join(fails)}"))
sys.exit(1 if fails else 0)
