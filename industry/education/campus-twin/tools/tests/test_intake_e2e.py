"""End to end, through the real warehouse code rather than a hand written fake.

    python tools\\tests\\test_intake_e2e.py

⚠️ THIS TEST EXISTS BECAUSE THE OTHER ONES CANNOT CATCH THIS CLASS OF BUG. `test_intake_auth.py`
replaces `warehouse` with a fake written by the same hand that wrote the router, so the two agree by
construction. If `take_preview` really returned `plan_version` where the router reads `planVersion`,
every one of those 42 checks would still pass and the first real submit would 500.

So here the router, `intake_store.py`, the redaction and the role checks are all REAL, and only the
solver is stubbed: CP-SAT is covered elsewhere, and running it here would make this slow and
dependent on which university's dataset happens to be on the machine.

The dev store enforces the same rules as the SQL path on purpose (see `server/dev_store.py`). A
relaxed stand-in would make this file green and the guarantees imaginary.
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

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

# ⚠️ BEFORE the imports. Both modules read their configuration at import time, so setting these
# afterwards would silently leave the SQL path selected and the test would fail confusingly.
STORE = Path(tempfile.gettempdir()) / "campus_intake_e2e.json"
if STORE.exists():
    STORE.unlink()
os.environ["CAMPUS_INTAKE_DEV_STORE"] = str(STORE)
os.environ["ENTRA_AUTH_DISABLED"] = "1"
os.environ.pop("CAMPUS_INTAKE_ODBC", None)

import dev_store  # noqa: E402
import intake  # noqa: E402
import intake_store  # noqa: E402
from auth import Principal, require_user  # noqa: E402
from availability_id import availability_id as avail_id  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name} {detail}")
        FAILURES.append(name)


class _Store:
    site = "oth"
    plan_version = 11
    slots = [{"slotId": f"{d}-{b}", "day": d} for d in ("Mo", "Di", "Fr") for b in (1, 2, 3, 4)]


def stub_solver() -> None:
    """Only the solver. Everything below the router stays real."""
    intake.known_sites = lambda: ["oth"]
    intake.store_for = lambda site=None: _Store()
    intake.get_affected_sessions = lambda store, teacher, day=None, slot_ids=None: {
        "sessions": [{"sessionId": "S1", "cohortId": "C1"}, {"sessionId": "S2", "cohortId": "C1"},
                     {"sessionId": "S3", "cohortId": "C2"}]
    }
    intake.propose_repairs = lambda store, session_ids, k=3, forbid=None, time_limit_s=5.0: {
        "options": [{"sessionsMoved": 3}], "optimalityProven": True,
    }


def client(oid: str, upn: str) -> TestClient:
    app = FastAPI()
    app.include_router(intake.router)
    app.dependency_overrides[require_user] = lambda: Principal(
        oid=oid, tid="t", upn=upn, name="Test", scopes=("access_as_user",))
    return TestClient(app, raise_server_exceptions=False)


def main() -> int:
    stub_solver()

    print("\n[1] the dev backend is selected, and says so")
    check("intake reports itself enabled", intake_store.intake_enabled() is True)
    status = intake_store.warehouse_status()
    check("status names the backend as dev-file", status.get("backend") == "dev-file", status)

    print("\n[2] an unseeded tenant refuses everyone, including the planner")
    prof = client("oid-prof", "prof@hs.de")
    check("unmapped account is refused", prof.get("/api/me").status_code == 403)

    dev_store.seed_identity("oid-prof", "oth", "T-042", "teacher", "prof@hs.de")
    dev_store.seed_identity("oid-plan", "oth", "T-001", "planner", "plan@hs.de")
    planner = client("oid-plan", "plan@hs.de")

    me = prof.get("/api/me").json()
    check("a seeded teacher resolves", me.get("teacherId") == "T-042" and me.get("role") == "teacher", me)
    check("a seeded planner resolves", planner.get("/api/me").json().get("role") == "planner")

    print("\n[3] preview -> submit, through real persistence")
    pv = prof.post("/api/intake/preview", json={"kind": "availability", "day": "Fr"})
    check("preview succeeds", pv.status_code == 200, pv.text[:200])
    body = pv.json()
    check("a real previewId came back", bool(body.get("previewId")), body)
    check("impact figures are present", body.get("affectedSessions") == 3 and body.get("wouldMove") == 3, body)
    check("the plan version is reported", body.get("planVersion") == "11", body)

    sub = prof.post("/api/intake/submit", json={
        "kind": "availability", "previewId": body["previewId"], "day": "Fr",
        "utterance": "Freitags leider nicht mehr, weil ich meine Mutter pflege",
    })
    check("submit succeeds", sub.status_code == 200, sub.text[:200])
    req_id = sub.json().get("requestId")
    check("a requestId came back", bool(req_id))
    check("status is pending", sub.json().get("status") == "pending")

    print("\n[4] ⚠️ what actually reached the disk")
    import json
    raw = json.loads(STORE.read_text(encoding="utf-8"))
    stored = raw["requests"][req_id]
    check("no free-text key on disk",
          not ({"utterance", "utteranceRedacted"} & set(stored)), sorted(stored))
    whole = STORE.read_text(encoding="utf-8").lower()
    for word in ("pflege", "mutter", "leider"):
        check(f"the word {word!r} is nowhere in the file", word not in whole)
    check("ownership was recorded as the oid", stored.get("submittedByOid") == "oid-prof", stored.get("submittedByOid"))

    print("\n[5] the preview cannot be replayed or reused")
    again = prof.post("/api/intake/submit", json={"kind": "availability", "previewId": body["previewId"]})
    check("⚠️ the SAME preview cannot be submitted twice", again.status_code == 409,
          f"{again.status_code}: a retrying agent would file a duplicate request")
    stale = prof.post("/api/intake/submit", json={"kind": "availability", "previewId": "nope"})
    check("an unknown previewId is refused", stale.status_code == 409, stale.status_code)

    pv2 = prof.post("/api/intake/preview", json={"kind": "availability", "day": "Fr"}).json()
    _Store.plan_version = 12  # the plan is published underneath the outstanding preview
    moved = prof.post("/api/intake/submit", json={"kind": "availability", "previewId": pv2["previewId"]})
    check("a preview costed against the OLD plan is refused", moved.status_code == 409, moved.status_code)
    _Store.plan_version = 11
    check("and a refused claim did NOT burn the preview",
          prof.post("/api/intake/submit",
                    json={"kind": "availability", "previewId": pv2["previewId"]}).status_code == 200,
          "a stale-plan rejection must not consume it")

    print("\n[6] the queue, and who may see it")
    check("the teacher still cannot read the queue", prof.get("/api/intake/queue").status_code == 403)
    q = planner.get("/api/intake/queue")
    check("the planner can", q.status_code == 200, q.text[:200])
    rows = q.json()["requests"]
    check("the submitted request is in the queue", any(r["requestId"] == req_id for r in rows), len(rows))
    row = next(r for r in rows if r["requestId"] == req_id)
    check("impact is labelled as at-submit, not current", "impactAtSubmit" in row, sorted(row))
    check("the queue carries no verbatim reason",
          "pflege" not in json.dumps(row).lower())

    mine = prof.get("/api/intake/mine").json()["requests"]
    check("the teacher sees their own request", any(r["requestId"] == req_id for r in mine))

    print("\n[7] deciding, once and only once")
    d1 = planner.post(f"/api/intake/{req_id}/decide", json={"accept": True, "note": "ok"})
    check("the planner can decide", d1.status_code == 200, d1.text[:200])
    check("⚠️ accepting did NOT publish", d1.json().get("published") is False, d1.json())
    check("status is accepted", d1.json().get("status") == "accepted")

    d2 = planner.post(f"/api/intake/{req_id}/decide", json={"accept": False, "note": "changed my mind"})
    check("a second decision is refused, not silently applied", d2.status_code == 409, d2.status_code)

    after = json.loads(STORE.read_text(encoding="utf-8"))["requests"][req_id]
    check("the first decision stands", after["status"] == "accepted", after["status"])
    check("no publishedAt was invented anywhere", "publishedAt" not in json.dumps(after))

    print("\n[8] the audit trail")
    events = dev_store.events_for(req_id)
    # ⚠️ THREE events now, not two. Accepting also APPLIES the absence, and that write is a
    # separate recorded act: `decide` wins the race, the availability is written, then the outcome
    # is recorded. A crash in between leaves `accepted` with `appliedRows` NULL, which is visibly
    # incomplete rather than quietly wrong.
    check("submit, decision and application were all recorded",
          [e["action"] for e in events] == ["submitted", "accepted", "applied"],
          [e["action"] for e in events])
    check("the role is stamped as it was at the time",
          [e["actorRole"] for e in events] == ["teacher", "planner", "planner"],
          [e["actorRole"] for e in events])
    check("the actors are the real UPNs",
          [e["actorUpn"] for e in events] == ["prof@hs.de", "plan@hs.de", "plan@hs.de"],
          [e["actorUpn"] for e in events])
    check("events use occurredAt, matching the DDL", all("occurredAt" in e for e in events))

    print("\n[8b] ⚠️ what the acceptance actually wrote into the availability table")
    rows = dev_store.availabilities_for("oth")
    check("one row per slot of the blocked day", len(rows) == 4, len(rows))
    check("every row is for the requesting teacher",
          all(r["teacherId"] == "T-042" for r in rows), {r["teacherId"] for r in rows})
    check("every row is on the day that was blocked",
          all(r["slotId"].startswith("Fr-") for r in rows), sorted(r["slotId"] for r in rows))
    check("the state is nicht_verfuegbar",
          all(r["state"] == "nicht_verfuegbar" for r in rows), {r["state"] for r in rows})
    # ⚠️ `intake`, not `ui`. It is outside SEEDED_SOURCES so the seeder can never overwrite or
    # prune it, and it does not claim somebody used the cockpit.
    check("the source names the door it came through",
          all(r["source"] == "intake" for r in rows), {r["source"] for r in rows})
    check("updatedBy is the deciding PLANNER, not the requester",
          all(r["updatedBy"] == "plan@hs.de" for r in rows), {r["updatedBy"] for r in rows})
    check("⚠️ the note is empty, since there is no free text anywhere in this path",
          all(r["note"] == "" for r in rows), {r["note"] for r in rows})
    check("ids are the deterministic ones the app itself computes",
          all(r["id"] == avail_id("oth", "T-042", r["slotId"]) for r in rows))
    check("the request records how many rows it wrote",
          json.loads(STORE.read_text(encoding="utf-8"))["requests"][req_id]["appliedRows"] == 4)

    print("\n[8c] applying the same acceptance twice updates, it does not duplicate")
    again = dev_store.apply_accepted_availability(
        site="oth", teacher_id="T-042", slot_ids=[r["slotId"] for r in rows],
        state="nicht_verfuegbar", updated_by="plan@hs.de")
    check("the second write updated every row", again == {"inserted": 0, "updated": 4}, again)
    check("still one row per slot", len(dev_store.availabilities_for("oth")) == 4)

    print("\n[9] the two backends cannot drift apart")
    import inspect
    for name in ("resolve_identity", "save_preview", "take_preview",
                 "insert_request", "list_queue", "decide"):
        a = inspect.signature(getattr(intake_store, name))
        b = inspect.signature(getattr(dev_store, name))
        check(f"{name} has an identical signature in both backends", a == b, f"{a}  vs  {b}")

    print("\n[10] configuring both backends is refused, not resolved by precedence")
    intake_store.INTAKE_ODBC = "Driver={x};Server=y"
    try:
        intake_store.resolve_identity("oid-prof", "oth")
        check("both-configured raises", False, "it silently picked one")
    except RuntimeError as e:
        check("both-configured raises", True)
        check("the error says to unset one", "unset one" in str(e).lower(), str(e))
    finally:
        intake_store.INTAKE_ODBC = ""

    STORE.unlink(missing_ok=True)

    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {', '.join(FAILURES)}")
        return 1
    print("preview -> submit -> queue -> decide works through real persistence")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
