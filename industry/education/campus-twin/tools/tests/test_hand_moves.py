"""Hand-dragged moves can reach a draft — and only when they are genuinely clean.

PLAN §13.7. `/api/draft/apply` takes a `proposalId`, and until now only the SOLVER minted one, so a
move a planner made by hand could be checked and then not kept. `/api/moves/propose` closes that,
without widening the confirm gate: it mints an id, and a human still confirms.

The properties worth pinning are the refusals, not the happy path:

  1. A clean move registers, previews, and can be confirmed into a draft.
  2. The proposal does NOT claim to be a solver optimum.
  3. A move onto an occupied room+slot is refused.
  4. ⚠️ TWO MOVES THAT ARE EACH LEGAL ALONE BUT COLLIDE WITH EACH OTHER are refused. This is the
     whole reason the set is checked together rather than one at a time, and it is the failure a
     per-move check cannot see.
  5. An unknown session is named, never silently dropped.
  6. The published plan is untouched throughout.
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
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

from fastapi.testclient import TestClient  # noqa: E402

import app as a  # noqa: E402

c = TestClient(a.app)
store = a.store
fails: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  — {detail}' if detail else ''}")
    if not ok:
        fails.append(name)


published_before = {x["sessionId"]: (x["slotId"], x["roomId"]) for x in store.assignments}
occupied = {(x["slotId"], x["roomId"]) for x in store.assignments}


def free_slot_for(session_id: str) -> str | None:
    """A slot where this session's room is free — so the move is clean for a reason we chose."""
    row = store.assignment_by_session[session_id]
    for s in store.slots:
        if s["slotId"] == row["slotId"]:
            continue
        if (s["slotId"], row["roomId"]) in occupied:
            continue
        # The teacher and the cohort must be free there too, or the move is legal-looking but not.
        busy = any(
            o["slotId"] == s["slotId"]
            and (o.get("teacherId") == row.get("teacherId") or o.get("cohortId") == row.get("cohortId"))
            for o in store.assignments
        )
        if not busy and (row.get("teacherId"), s["slotId"]) not in store.unavailable:
            return s["slotId"]
    return None


# Pick two sessions that can each move cleanly, and that share a room — so we can also build the
# pair that only collides with ITSELF.
candidates = []
for row in store.assignments:
    target = free_slot_for(row["sessionId"])
    if target:
        candidates.append((row["sessionId"], row["roomId"], target))
    if len(candidates) >= 60:
        break
check("found sessions that can move cleanly", len(candidates) >= 2, f"{len(candidates)} candidates")

sid, room, to_slot = candidates[0]

# ── 1 + 2. a clean move registers, and does not overclaim ────────────────────────────────────
r = c.post("/api/moves/propose", json={"moves": [{"sessionId": sid, "slotId": to_slot}]}).json()
check("a clean hand move is accepted", "error" not in r, r.get("error", ""))
check("it comes back as a previewable proposal", bool(r.get("proposalId")) and r.get("sessionsMoved") == 1,
      f"{r.get('proposalId')} / {r.get('sessionsMoved')} moved")
# ⚠️ The preview bar renders this flag. A hand move badged as a proven optimum would be a lie the
# UI tells on the solver's behalf.
check("it does NOT claim to be a proven optimum", r.get("optimalityProven") in (False, None),
      str(r.get("optimalityProven")))
check("the preview names the destination",
      bool(r["changes"]) and r["changes"][0]["to"]["slotId"] == to_slot,
      r["changes"][0]["to"] if r.get("changes") else "-")

# ── the confirm gate still owns the write ────────────────────────────────────────────────────
applied = c.post("/api/draft/apply", json={"proposalId": r["proposalId"], "option": 1,
                                           "confirmedBy": "Planer:in (Test)"}).json()
check("confirming it produces a draft", bool(applied.get("draftId")), applied.get("error", ""))
check("an unconfirmed apply is still refused",
      c.post("/api/draft/apply", json={"proposalId": r["proposalId"], "option": 1,
                                       "confirmedBy": ""}).status_code == 400)

# ── 3. a move onto an occupied room+slot is refused ──────────────────────────────────────────
clash = next(
    ((x["sessionId"], y["slotId"], y["roomId"])
     for x in store.assignments for y in store.assignments
     if x["sessionId"] != y["sessionId"] and x["slotId"] != y["slotId"]),
    None,
)
if clash:
    csid, cslot, croom = clash
    r2 = c.post("/api/moves/propose",
                json={"moves": [{"sessionId": csid, "slotId": cslot, "roomId": croom}]}).json()
    check("a move onto an occupied room is refused", r2.get("error") == "would_conflict",
          f"{r2.get('error')} ({len(r2.get('caused', []))} caused)")

# ── 4. THE BATCH PROPERTY: two clean moves that collide with each other ──────────────────────
# Both are individually legal — the drag bar would show each of them green — and together they put
# two sessions in one room at one hour.
pair = None
for i in range(len(candidates)):
    for j in range(i + 1, len(candidates)):
        sid_a, room_a, slot_a = candidates[i]
        sid_b, room_b, _slot_b = candidates[j]
        if room_a == room_b:
            pair = (sid_a, sid_b, room_a, slot_a)
            break
    if pair:
        break

if pair:
    a_id, b_id, shared_room, shared_slot = pair
    solo_a = c.post("/api/moves/propose",
                    json={"moves": [{"sessionId": a_id, "slotId": shared_slot, "roomId": shared_room}]}).json()
    solo_b = c.post("/api/moves/propose",
                    json={"moves": [{"sessionId": b_id, "slotId": shared_slot, "roomId": shared_room}]}).json()
    both = c.post("/api/moves/propose", json={"moves": [
        {"sessionId": a_id, "slotId": shared_slot, "roomId": shared_room},
        {"sessionId": b_id, "slotId": shared_slot, "roomId": shared_room},
    ]}).json()
    # ⚠️ The guard is only meaningful if the halves really are individually acceptable — otherwise
    # "the pair was refused" proves nothing about set-checking.
    check("each half of the pair is acceptable on its own",
          "error" not in solo_a and "error" not in solo_b,
          f"a={solo_a.get('error', 'ok')} b={solo_b.get('error', 'ok')}")
    check("but TOGETHER they are refused (the set is checked, not each move)",
          both.get("error") == "would_conflict", both.get("error", "accepted!"))
else:
    check("found a pair sharing a room to test set-checking", False, "no pair found")

# ── 5. an unknown session is named ───────────────────────────────────────────────────────────
r3 = c.post("/api/moves/propose", json={"moves": [{"sessionId": "does-not-exist", "slotId": to_slot}]}).json()
check("an unknown session is reported, not skipped", r3.get("error") == "unknown_session",
      str(r3.get("sessions")))

# ── a no-op is not an error, but it is not a proposal either ─────────────────────────────────
row = store.assignment_by_session[sid]
r4 = c.post("/api/moves/propose",
            json={"moves": [{"sessionId": sid, "slotId": row["slotId"], "roomId": row["roomId"]}]}).json()
check("dragging a session back where it started is 'no change'", r4.get("error") == "no_change",
      r4.get("error", ""))

# ── 6. nothing above touched the published plan ──────────────────────────────────────────────
published_after = {x["sessionId"]: (x["slotId"], x["roomId"]) for x in store.assignments}
check("the published plan is untouched", published_after == published_before,
      f"{sum(1 for k in published_before if published_before[k] != published_after.get(k))} rows differ")

print("\n" + ("hand moves ok — a clean drag reaches the gate, a dirty one never does"
              if not fails else f"{len(fails)} FAILED: {', '.join(fails)}"))
sys.exit(1 if fails else 0)
