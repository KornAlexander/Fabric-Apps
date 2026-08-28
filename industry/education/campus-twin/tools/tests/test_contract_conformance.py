"""Can an agent finish the job using ONLY what the published contract advertises?

⚠️ Every other test hands the API payloads a HUMAN wrote, with whatever fields turned out to be
needed. That proves the server works. It does not prove the CONTRACT works, and those are
different claims: a field the handler requires but `ai-plugin.json` never mentions is a field the
model cannot know to send, so the task is impossible no matter how correct the server is. The
failure looks like the agent being stupid.

So this test throws away the human's knowledge. Every request body is assembled from the published
schema alone, and any key not advertised is dropped before the call goes out. If the flow still
completes, the contract is sufficient. If it does not, the contract is a lie and the exact missing
field is named.

It also checks the reverse direction, which is the subtler one: the plugin descriptions tell the
model to carry `previewId` from one call to the next, so the response really has to contain it.
An instruction referring to a field the API does not return is the same bug wearing a hat.
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

import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))
sys.path.insert(0, str(ROOT / "tools" / "agent"))

STORE = Path(tempfile.gettempdir()) / "campus_intake_contract.json"
if STORE.exists():
    STORE.unlink()
os.environ["CAMPUS_INTAKE_DEV_STORE"] = str(STORE)
os.environ["ENTRA_AUTH_DISABLED"] = "1"
os.environ.pop("CAMPUS_INTAKE_ODBC", None)

import build_agent_package as builder  # noqa: E402
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
    slots = [{"slotId": f"{d}-{b}", "day": d} for d in ("Mo", "Di", "Fr") for b in (1, 2, 3, 4)]


def stub_solver() -> None:
    intake.known_sites = lambda: ["oth"]
    intake.store_for = lambda site=None: _Store()
    intake.get_affected_sessions = lambda store, teacher, day=None, slot_ids=None: {
        "sessions": [{"sessionId": "S1", "cohortId": "C1"}, {"sessionId": "S2", "cohortId": "C1"}]
    }
    intake.propose_repairs = lambda store, session_ids, k=3, forbid=None, time_limit_s=5.0: {
        "options": [{"sessionsMoved": 2}], "optimalityProven": True,
    }


def client(oid: str, upn: str) -> TestClient:
    app = FastAPI()
    app.include_router(intake.router)
    app.dependency_overrides[require_user] = lambda: Principal(
        oid=oid, tid="t", upn=upn, name="Test", scopes=("access_as_user",))
    return TestClient(app, raise_server_exceptions=False)


def advertised_properties(spec: dict[str, Any], operation_id: str) -> tuple[str, str, set[str]]:
    """(path, method, the request-body property names the contract exposes) for an operation."""
    for path, item in spec["paths"].items():
        for method, op in item.items():
            if not isinstance(op, dict) or op.get("operationId") != operation_id:
                continue
            body = op.get("requestBody") or {}
            schema = body.get("content", {}).get("application/json", {}).get("schema", {})
            return path, method, set(schema.get("properties", {}))
    raise AssertionError(f"operation not in the spec: {operation_id}")


def main() -> int:
    stub_solver()

    spec = builder.build_openapi()

    # Seed identities directly; granting access is an operator action, not an agent one.
    dev_store.seed_identity(oid="oid-prof", upn="prof@x.invalid", site="oth",
                            role="teacher", teacher_id="T-042", provenance="test")
    dev_store.seed_identity(oid="oid-plan", upn="plan@x.invalid", site="oth",
                            role="planner", teacher_id="", provenance="test")

    prof = client("oid-prof", "prof@x.invalid")
    planner = client("oid-plan", "plan@x.invalid")

    print("[1] the agent asks who it is speaking for")
    me = prof.get("/api/me")
    check("getMyIdentity succeeds", me.status_code == 200, me.status_code)
    check("it reveals the teacherId the agent must NOT be asked for",
          me.json().get("teacherId") == "T-042", me.json())

    print("\n[2] preview, using only fields the contract advertises")
    path, method, props = advertised_properties(spec, "previewAvailabilityChange")
    print(f"    contract offers: {sorted(props)}")
    # ⚠️ Everything the agent could plausibly want to say, then filtered to what is advertised.
    intent = {"kind": "availability", "day": "Fr", "teacherId": "T-042", "reason": "krank"}
    payload = {k: v for k, v in intent.items() if k in props}
    dropped = sorted(set(intent) - set(payload))
    check("the contract does NOT let a caller name a teacher", "teacherId" in dropped, dropped)
    check("the contract offers nowhere to type a reason", "reason" in dropped, dropped)

    pv = prof.post(path, json=payload)
    check("preview succeeds on advertised fields alone", pv.status_code == 200,
          f"{pv.status_code} {pv.text[:160]}")
    preview = pv.json() if pv.status_code == 200 else {}
    for field in ("previewId", "affectedSessions", "wouldMove", "planVersion"):
        check(f"the response carries '{field}', which the agent is told to use",
              field in preview, sorted(preview))

    print("\n[3] submit, carrying only what the previous response handed over")
    path, method, props = advertised_properties(spec, "submitIntakeRequest")
    print(f"    contract offers: {sorted(props)}")
    intent = {"kind": "availability", "previewId": preview.get("previewId"),
              "planVersion": preview.get("planVersion")}
    payload = {k: v for k, v in intent.items() if k in props}
    sub = prof.post(path, json=payload)
    check("submit succeeds on advertised fields alone", sub.status_code == 200,
          f"{sub.status_code} {sub.text[:160]}")
    submitted = sub.json() if sub.status_code == 200 else {}
    check("the response carries 'requestId'", "requestId" in submitted, sorted(submitted))
    check("the response says it is pending", submitted.get("status") == "pending", submitted)

    print("\n[4] the agent can show the user what it filed")
    mine = prof.get("/api/intake/mine")
    check("listMyIntakeRequests succeeds", mine.status_code == 200, mine.status_code)
    rows = mine.json().get("requests", mine.json() if isinstance(mine.json(), list) else [])
    check("the request the agent just filed is listed",
          any(r.get("requestId") == submitted.get("requestId") for r in rows), rows)

    print("\n[5] the planner decides, again on advertised fields alone")
    path, method, props = advertised_properties(spec, "decideIntakeRequest")
    print(f"    contract offers: {sorted(props)}")
    queue = planner.get("/api/intake/queue")
    check("listIntakeQueue succeeds for a planner", queue.status_code == 200, queue.status_code)
    # ⚠️ `accept: bool`, NOT `decision: "rejected"`. My first attempt guessed the latter and got a
    # 422, which is the test working: an agent that guesses field names fails, and the contract is
    # the only thing that tells it the truth. `note` is deliberately NOT sent, see the audit below.
    intent = {"accept": False, "decision": "rejected", "note": "nope"}
    payload = {k: v for k, v in intent.items() if k in props and k != "note"}
    decided = planner.post(
        f"/api/intake/{submitted.get('requestId')}/decide", json=payload)
    check("decide succeeds on advertised fields alone", decided.status_code == 200,
          f"{decided.status_code} {decided.text[:160]}")
    check("the decision is reflected back",
          decided.json().get("status") == "rejected", decided.json())
    check("decide states plainly that nothing was published",
          decided.json().get("published") is False, decided.json())

    print("\n[6] audit: every free-text field the WHOLE contract exposes")
    # ⚠️ This is the check `test_agent_package.py` was named after but never performed: it read
    # `submit` only. A free-text field anywhere is a place a model can write a sentence about a
    # named person, which is the exact harm `redact_reason` was deleted for.
    FREE_TEXT_NAMES = {"utterance", "reason", "note", "comment", "text", "message", "description"}
    # Fields tolerated, each with the reason. Anything not on this list fails the test.
    JUSTIFIED = {
        ("decideIntakeRequest", "note"):
            "the planner's own words explaining a decision to the requester. Refusing a request "
            "with no explanation is worse. ⚠️ RESIDUAL RISK: it is agent-reachable, so a model "
            "can restate the requester's reason through it and land the same sentence in storage "
            "by a different door. Kept knowingly, not overlooked.",
    }
    found: list[tuple[str, str]] = []
    for p, item in spec["paths"].items():
        for m, op in item.items():
            if not isinstance(op, dict) or "operationId" not in op:
                continue
            schema = (op.get("requestBody") or {}).get("content", {}) \
                .get("application/json", {}).get("schema", {})
            for prop in schema.get("properties", {}):
                if prop in FREE_TEXT_NAMES:
                    found.append((op["operationId"], prop))
    for op_id, prop in sorted(found):
        why = JUSTIFIED.get((op_id, prop))
        print(f"    {op_id}.{prop}: {'justified' if why else 'UNJUSTIFIED'}")
        if why:
            print(f"      {why}")
    check("every free-text field in the contract is one somebody justified",
          all((op_id, prop) in JUSTIFIED for op_id, prop in found),
          sorted(set(found) - set(JUSTIFIED)))

    print()
    if STORE.exists():
        STORE.unlink()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {FAILURES}")
        return 1
    print("OK - the whole task is reachable using only the fields the contract publishes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
