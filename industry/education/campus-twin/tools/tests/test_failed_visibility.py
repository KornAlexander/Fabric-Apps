"""A request that failed to apply must be VISIBLE to somebody, or it is stranded in practice.

⚠️ THIS IS A GAP I CREATED. Making `failed` recoverable (`decide` now accepts `pending` or
`failed`) was worth nothing on its own, because nothing tells anybody a failed request exists:

  * `listIntakeQueue` defaults to `status="pending"`, so a planner opening the queue sees exactly
    the requests that do NOT need their attention, and none of the ones that do.
  * `listMyIntakeRequests` filters to pending too, so the professor's request **disappears from
    their own list** without ever being accepted or rejected. From where they sit it was simply
    swallowed.

A recovery path nobody can find is not a recovery path. Both of those are worse than the original
stranding in one specific way: the system now looks tidy. The pending queue is empty, everyone's
list is clean, and a lecture still has a lecturer who told you they cannot teach it.
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

STORE = Path(tempfile.gettempdir()) / "campus_intake_visible.json"
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


def main() -> int:
    stub_solver()
    dev_store.seed_identity(oid="oid-t", upn="t@x.invalid", site="oth",
                            role="teacher", teacher_id="T-001", provenance="test")
    dev_store.seed_identity(oid="oid-p", upn="p@x.invalid", site="oth",
                            role="planner", teacher_id="", provenance="test")
    teacher, planner = client("oid-t", "t@x.invalid"), client("oid-p", "p@x.invalid")

    preview = teacher.post("/api/intake/preview",
                           json={"kind": "availability", "day": "Fr"}).json()
    request_id = teacher.post(
        "/api/intake/submit",
        json={"kind": "availability", "previewId": preview["previewId"]}).json()["requestId"]

    print("[1] while pending, everybody can see it")
    check("the professor sees it in their own list",
          any(r["requestId"] == request_id
              for r in teacher.get("/api/intake/mine").json()["requests"]))
    check("the planner sees it in the queue",
          any(r["requestId"] == request_id
              for r in planner.get("/api/intake/queue").json()["requests"]))

    print("\n[2] the availability write fails")
    real_apply = intake_store.apply_accepted_availability
    intake_store.apply_accepted_availability = lambda **kw: (_ for _ in ()).throw(
        intake_store.StoreUnavailable("[08001] TCP Provider: timeout expired"))
    planner.post(f"/api/intake/{request_id}/decide", json={"accept": True})
    intake_store.apply_accepted_availability = real_apply
    check("the request is now failed",
          request_id in {r["requestId"] for r in dev_store.list_queue("oth", status="failed")})

    print("\n[3] can anybody still see it?")
    mine = teacher.get("/api/intake/mine").json()
    mine_ids = {r["requestId"] for r in mine["requests"]}
    check("⚠️ the professor can still find their own request", request_id in mine_ids,
          sorted(mine_ids))
    row = next((r for r in mine["requests"] if r["requestId"] == request_id), {})
    check("and it does not still claim to be pending", row.get("status") != "pending",
          row.get("status"))

    q = planner.get("/api/intake/queue").json()
    check("⚠️ the DEFAULT queue tells the planner something needs attention",
          q.get("needsAttention", {}).get("count", 0) == 1, q.get("needsAttention"))
    check("and names the request, so they can act on it",
          request_id in (q.get("needsAttention", {}).get("requestIds") or []),
          q.get("needsAttention"))

    print("\n[4] the signal must not cry wolf")
    after = planner.post(f"/api/intake/{request_id}/decide", json={"accept": True})
    check("the planner retries successfully", after.status_code == 200, after.status_code)
    q2 = planner.get("/api/intake/queue").json()
    check("⚠️ and the attention flag clears once it is dealt with",
          q2.get("needsAttention", {}).get("count", 0) == 0, q2.get("needsAttention"))

    print("\n[5] visibility must not leak across people")
    other = client("oid-x", "x@x.invalid")
    dev_store.seed_identity(oid="oid-x", upn="x@x.invalid", site="oth",
                            role="teacher", teacher_id="T-002", provenance="test")
    ids = {r["requestId"] for r in other.get("/api/intake/mine").json()["requests"]}
    check("a different teacher sees none of it", request_id not in ids, sorted(ids))

    print()
    if STORE.exists():
        STORE.unlink()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {FAILURES}")
        return 1
    print("OK - a failed request is visible to the two people who can do something about it")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
