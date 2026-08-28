"""Phase B: a requester can finally see what was DECIDED, not only what is still waiting.

⚠️ Until now `listMyIntakeRequests` returned `pending` and `failed` only. So a professor could
watch a request leave and never learn the answer to the question they actually have: "did they
accept my Friday?" The outcome existed in the database and was visible to the planner, and was
unreachable by the one person most affected by it.

The history is bounded by COUNT rather than by date. A date cutoff sounds friendlier and behaves
worse: somebody who filed nothing this term would get an empty list and conclude the system had
forgotten them, while somebody in a bad month could still receive dozens. `decidedTotal` is
reported alongside so nobody has to guess whether the list was trimmed.
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

STORE = Path(tempfile.gettempdir()) / "campus_intake_history.json"
if STORE.exists():
    STORE.unlink()
os.environ["CAMPUS_INTAKE_DEV_STORE"] = str(STORE)
os.environ["ENTRA_AUTH_DISABLED"] = "1"
os.environ.pop("CAMPUS_INTAKE_ODBC", None)

import dev_store  # noqa: E402
import intake  # noqa: E402
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
    plan_version = 3
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


def client(oid: str) -> TestClient:
    app = FastAPI()
    app.include_router(intake.router)
    app.dependency_overrides[require_user] = lambda: Principal(
        oid=oid, tid="t", upn=f"{oid}@x.invalid", name="Test", scopes=("access_as_user",))
    return TestClient(app, raise_server_exceptions=False)


def file_and_decide(teacher: TestClient, planner: TestClient, accept: bool) -> str:
    pv = teacher.post("/api/intake/preview",
                      json={"kind": "availability", "day": "Fr"}).json()
    rid = teacher.post("/api/intake/submit",
                       json={"kind": "availability",
                             "previewId": pv["previewId"]}).json()["requestId"]
    planner.post(f"/api/intake/{rid}/decide", json={"accept": accept})
    return rid


def main() -> int:
    stub_solver()
    dev_store.seed_identity(oid="oid-t", upn="t@x.invalid", site="oth",
                            role="teacher", teacher_id="T-001", provenance="test")
    dev_store.seed_identity(oid="oid-p", upn="p@x.invalid", site="oth",
                            role="planner", teacher_id="", provenance="test")
    dev_store.seed_identity(oid="oid-other", upn="o@x.invalid", site="oth",
                            role="teacher", teacher_id="T-002", provenance="test")
    teacher, planner = client("oid-t"), client("oid-p")
    other = client("oid-other")

    print("[1] nothing filed yet")
    body = teacher.get("/api/intake/mine").json()
    check("the shape is there even when empty",
          {"requests", "decided", "decidedTotal"} <= set(body), sorted(body))
    check("and it is honestly empty", body["decidedTotal"] == 0, body["decidedTotal"])

    print("\n[2] one accepted, one rejected")
    accepted_id = file_and_decide(teacher, planner, accept=True)
    rejected_id = file_and_decide(teacher, planner, accept=False)
    body = teacher.get("/api/intake/mine").json()
    ids = {r["requestId"]: r.get("status") for r in body["decided"]}
    check("⚠️ the accepted one is visible to the person who filed it",
          ids.get(accepted_id) == "accepted", ids)
    check("and the rejected one too", ids.get(rejected_id) == "rejected", ids)
    check("neither is in the in-flight list",
          not ({accepted_id, rejected_id} & {r["requestId"] for r in body["requests"]}))

    print("\n[3] ⚠️ somebody else's outcomes stay theirs")
    body = other.get("/api/intake/mine").json()
    check("a different teacher sees none of it",
          not body["decided"] and body["decidedTotal"] == 0, body["decidedTotal"])

    print("\n[4] the history is bounded, and says so")
    for _ in range(intake.DECIDED_HISTORY_LIMIT + 3):
        file_and_decide(teacher, planner, accept=False)
    body = teacher.get("/api/intake/mine").json()
    check(f"at most {intake.DECIDED_HISTORY_LIMIT} are returned",
          len(body["decided"]) == intake.DECIDED_HISTORY_LIMIT, len(body["decided"]))
    check("⚠️ but the true total is reported, so nobody guesses whether it was trimmed",
          body["decidedTotal"] == intake.DECIDED_HISTORY_LIMIT + 5, body["decidedTotal"])
    check("and the count shown matches the list",
          body["decidedShown"] == len(body["decided"]), body["decidedShown"])

    print("\n[5] the newest are the ones kept")
    newest = file_and_decide(teacher, planner, accept=True)
    body = teacher.get("/api/intake/mine").json()
    check("the most recent decision is in the window",
          newest in {r["requestId"] for r in body["decided"]}, body["decidedShown"])

    print()
    if STORE.exists():
        STORE.unlink()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {FAILURES}")
        return 1
    print("OK - a requester can see the answer, not just the wait, and only their own")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
