"""A retried submit must be distinguishable from a refused one.

⚠️ WHY THIS IS NOT A THEORETICAL CASE. Agents retry. So does every HTTP client with a timeout.
If the first submit succeeded and the response was lost on the wire, the retry hits an
already-claimed preview. Before this, that answered the same opaque 409 as "your preview is stale"
and "that preview is not yours", so the model told the professor it had failed. The professor then
filed the same absence again through a fresh preview, and the planning office received it twice.
The 409 exists to prevent a duplicate; undifferentiated, it manufactures one.

The check is deliberately about what an AGENT can act on, not about status codes: both cases are
409, so the status alone is useless. What matters is whether the body names the difference and
hands back the request id that already exists.
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

STORE = Path(tempfile.gettempdir()) / "campus_intake_retry.json"
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
    plan_version = 11
    slots = [{"slotId": f"{d}-{b}", "day": d} for d in ("Mo", "Di", "Fr") for b in (1, 2, 3, 4)]


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
    dev_store.seed_identity(oid="oid-a", upn="a@x.invalid", site="oth",
                            role="teacher", teacher_id="T-001", provenance="test")
    dev_store.seed_identity(oid="oid-b", upn="b@x.invalid", site="oth",
                            role="teacher", teacher_id="T-002", provenance="test")
    a, b = client("oid-a", "a@x.invalid"), client("oid-b", "b@x.invalid")

    print("[1] the happy path, once")
    preview = a.post("/api/intake/preview", json={"kind": "availability", "day": "Fr"}).json()
    first = a.post("/api/intake/submit",
                   json={"kind": "availability", "previewId": preview["previewId"]})
    check("the first submit succeeds", first.status_code == 200, first.status_code)
    request_id = first.json().get("requestId")

    print("\n[2] the same call again, as a timed-out client would send it")
    retry = a.post("/api/intake/submit",
                   json={"kind": "availability", "previewId": preview["previewId"]})
    check("still refused, so no duplicate is filed", retry.status_code == 409, retry.status_code)
    detail = retry.json().get("detail")
    check("the refusal is machine-readable", isinstance(detail, dict), type(detail).__name__)
    detail = detail if isinstance(detail, dict) else {}
    check("it says WHICH kind of conflict this is",
          detail.get("code") == "already_submitted", detail.get("code"))
    check("⚠️ it hands back the request that already exists",
          detail.get("requestId") == request_id, detail.get("requestId"))
    check("it reports that request's status", detail.get("status") == "pending", detail.get("status"))
    check("the message tells the agent NOT to try again",
          "not submit it again" in str(detail.get("message", "")), detail.get("message"))

    print("\n[3] exactly one request exists, which is the point of the 409")
    mine = a.get("/api/intake/mine").json().get("requests", [])
    check("still one request, not two", len(mine) == 1, len(mine))

    print("\n[4] a genuinely unusable preview must NOT look like a retry")
    bad = a.post("/api/intake/submit",
                 json={"kind": "availability", "previewId": "00000000-0000-0000-0000-000000000000"})
    check("an unknown preview is refused", bad.status_code == 409, bad.status_code)
    bad_detail = bad.json().get("detail")
    bad_detail = bad_detail if isinstance(bad_detail, dict) else {}
    check("it carries the OTHER code", bad_detail.get("code") == "preview_unusable",
          bad_detail.get("code"))
    check("it does not invent a requestId", "requestId" not in bad_detail, bad_detail)

    print("\n[5] the lookup must not become an oracle for other people's requests")
    # ⚠️ B knows A's preview id (say it was logged, or guessed). B must learn nothing.
    stolen = b.post("/api/intake/submit",
                    json={"kind": "availability", "previewId": preview["previewId"]})
    check("a foreign caller is still refused", stolen.status_code == 409, stolen.status_code)
    stolen_detail = stolen.json().get("detail")
    stolen_detail = stolen_detail if isinstance(stolen_detail, dict) else {}
    check("⚠️ it does NOT leak the owner's requestId",
          "requestId" not in stolen_detail, stolen_detail)
    check("it looks like an unusable preview, not like a retry",
          stolen_detail.get("code") == "preview_unusable", stolen_detail.get("code"))

    print()
    if STORE.exists():
        STORE.unlink()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {FAILURES}")
        return 1
    print("OK - a retry is told apart from a refusal, and the distinction leaks nothing")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
