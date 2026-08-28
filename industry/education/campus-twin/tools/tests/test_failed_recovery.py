"""Can a planner recover when the write fails half-way, or is the request wedged?

⚠️ THE SCENARIO IS NOW THE ORDINARY ONE, not a corner case. `decide` wins the race, marks the
request decided, and only then applies the availability rows. If that write fails, the request is
recorded as `failed` rather than `accepted`, which is right: a green tick over an unchanged week is
worse than an honest refusal.

But `decide` is conditional on `status = 'pending'`, and a `failed` request is not pending. So the
question this test exists to answer is what the planner does next. If the answer is "nothing", then
a paused capacity, an expired token or a dropped connection during the apply permanently strands a
professor's absence, and the only route back is to ask them to file it all over again.

⚠️ Retrying is SAFE, which is what makes stranding it inexcusable rather than merely unfortunate.
`apply_accepted_availability` does UPDATE-then-INSERT per slot, and the live test already measured
a second run as `{"inserted": 0, "updated": 4}`. Re-applying converges; it does not double-book.
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

STORE = Path(tempfile.gettempdir()) / "campus_intake_recover.json"
if STORE.exists():
    STORE.unlink()
os.environ["CAMPUS_INTAKE_DEV_STORE"] = str(STORE)
os.environ["ENTRA_AUTH_DISABLED"] = "1"
os.environ.pop("CAMPUS_INTAKE_ODBC", None)

import dev_store  # noqa: E402
import intake  # noqa: E402
import intake_store  # noqa: E402
from auth import Principal, require_user  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: object = "") -> None:
    print(f"  {'ok ' if condition else 'FAIL'} {name}" + (f"  [{detail}]" if detail else ""))
    if not condition:
        FAILURES.append(name)


class _Store:
    site = "oth"
    plan_version = 11
    slots = [{"slotId": f"{d}-{b}", "day": d} for d in ("Mo", "Fr") for b in (1, 2)]


def stub_solver() -> None:
    intake.known_sites = lambda: ["oth"]
    intake.store_for = lambda site=None: _Store()
    intake.get_affected_sessions = lambda store, teacher, day=None, slot_ids=None: {
        "sessions": [{"sessionId": "S1", "cohortId": "C1"}]
    }
    intake.propose_repairs = lambda store, session_ids, k=3, forbid=None, time_limit_s=5.0: {
        "options": [{"sessionsMoved": 1}], "optimalityProven": True,
    }


def client(oid: str, upn: str) -> TestClient:
    app = FastAPI()
    app.include_router(intake.router)
    app.dependency_overrides[require_user] = lambda: Principal(
        oid=oid, tid="t", upn=upn, name="Test", scopes=("access_as_user",))
    return TestClient(app, raise_server_exceptions=False)


def file_one(teacher: TestClient) -> str:
    preview = teacher.post("/api/intake/preview",
                           json={"kind": "availability", "day": "Fr"}).json()
    return teacher.post("/api/intake/submit",
                        json={"kind": "availability",
                              "previewId": preview["previewId"]}).json()["requestId"]


def main() -> int:
    stub_solver()
    dev_store.seed_identity(oid="oid-t", upn="t@x.invalid", site="oth",
                            role="teacher", teacher_id="T-001", provenance="test")
    dev_store.seed_identity(oid="oid-p", upn="p@x.invalid", site="oth",
                            role="planner", teacher_id="", provenance="test")
    teacher, planner = client("oid-t", "t@x.invalid"), client("oid-p", "p@x.invalid")

    request_id = file_one(teacher)
    print(f"filed {request_id}\n")

    print("[1] the availability write fails, as a paused capacity makes it")
    real_apply = intake_store.apply_accepted_availability
    intake_store.apply_accepted_availability = lambda **kw: (_ for _ in ()).throw(
        intake_store.StoreUnavailable("[08001] TCP Provider: timeout expired"))
    first = planner.post(f"/api/intake/{request_id}/decide", json={"accept": True})
    check("the planner is told it did not take effect", first.status_code >= 400,
          first.status_code)

    rows = {r["requestId"]: r for r in dev_store.list_queue("oth", status="failed")}
    check("the request is recorded as failed, not accepted", request_id in rows,
          sorted(rows))
    check("the failure reason is kept",
          bool(rows.get(request_id, {}).get("failureReason")
               or dev_store._load()["requests"][request_id].get("failureReason")))

    print("\n[2] the store comes back. Can the planner finish the job?")
    intake_store.apply_accepted_availability = real_apply

    still_pending = [r["requestId"] for r in planner.get("/api/intake/queue").json()["requests"]]
    check("⚠️ the request is NOT in the pending queue any more",
          request_id not in still_pending, still_pending)

    retry = planner.post(f"/api/intake/{request_id}/decide", json={"accept": True})
    check("⚠️ THE PLANNER CAN RETRY A FAILED APPLICATION", retry.status_code == 200,
          f"{retry.status_code} {retry.text[:160]}")

    if retry.status_code == 200:
        check("the retry reports what it applied",
              (retry.json().get("applied") or {}).get("inserted", 0)
              + (retry.json().get("applied") or {}).get("updated", 0) > 0,
              retry.json())
        after = {r["requestId"] for r in dev_store.list_queue("oth", status="accepted")}
        check("and the request is accepted afterwards", request_id in after, sorted(after))

    print("\n[3] a request that already SUCCEEDED still cannot be decided twice")
    second_id = file_one(teacher)
    ok = planner.post(f"/api/intake/{second_id}/decide", json={"accept": False})
    check("a rejection succeeds", ok.status_code == 200, ok.status_code)
    again = planner.post(f"/api/intake/{second_id}/decide", json={"accept": True})
    check("⚠️ but a settled request is still refused", again.status_code == 409,
          again.status_code)

    print()
    if STORE.exists():
        STORE.unlink()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {FAILURES}")
        return 1
    print("OK - a half-applied request can be finished, and a settled one still cannot be reopened")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
