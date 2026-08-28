"""Row-level security on the consumer surface, including the case where it is removed.

⚠️ THE POINT OF THIS FILE IS THE SABOTAGE CASES, NOT THE HAPPY PATH. A test that asks for its own
week and receives its own week passes just as happily against a router with no access control at
all, because there is only one person in the fixture. Every check below that matters asks for
SOMEBODY ELSE and asserts a refusal, and `test_clamp_is_load_bearing` deletes the clamp and asserts
the leak reappears - because a guard whose absence changes nothing was never a guard.

This repository has already paid for that lesson once: `test_store_unavailable.py` injected its
fault into `resolve_identity` only, so once the routers learned to infer a site the requests sailed
straight past the injected failure and answered 200. The test still passed. It was testing nothing.

    python tools/tests/test_consumer_rls.py
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
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

# Must be set BEFORE importing auth, which reads config at import time.
os.environ.setdefault("ENTRA_AUTH_DISABLED", "1")

from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import consumer  # noqa: E402
from auth import Principal, require_user  # noqa: E402

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name} {detail}")
        FAILURES.append(name)


# ------------------------------------------------------------------------------------------------
# Fixture: two lecturers at one site, which is the minimum that can express a leak.
# ------------------------------------------------------------------------------------------------

ME = "IM-T007"
OTHER = "IM-T042"


class _Store:
    site = "oth"
    label = "OTH Regensburg"
    teacher_by_id = {
        ME: {"teacherId": ME, "name": "Prof. Dr. Lengfelder"},
        OTHER: {"teacherId": OTHER, "name": "Prof. Dr. Achleitner"},
    }
    slots = [{"slotId": f"{d}-{b}", "day": d} for d in ("Mo", "Fr") for b in (1, 2, 3)]

    def find_teacher(self, text: str) -> dict[str, Any] | None:
        """Resolve by id OR by name, exactly as the real store does.

        ⚠️ THE NAME PATH IS WHY THIS FIXTURE HAS TO RESOLVE AT ALL. A clamp that compares raw
        strings refuses "Prof. Dr. Lengfelder" for Lengfelder himself, and the user experiences
        their own timetable as forbidden. That bug is invisible to an id-only fixture.
        """
        text = (text or "").strip()
        for t in self.teacher_by_id.values():
            if text in (t["teacherId"], t["name"]):
                return t
        return None


IDENTITIES = {
    "oid-me": {"teacherId": ME, "role": "teacher"},
    "oid-planner-no-teacher": {"teacherId": None, "role": "planner"},
}

CALENDAR_CALLS: list[tuple[str, str]] = []


def _fake_calendar_view(store, scope, key, assignments=None, draft_id=None):  # noqa: ANN001
    CALENDAR_CALLS.append((scope, key))
    return {"scope": scope, "key": key, "entries": [], "draftId": draft_id}


def _fake_resolve_caller(user: Principal, requested: str | None):
    ident = IDENTITIES.get(user.oid)
    if ident is None:
        raise HTTPException(403, "this account is not mapped to a person at any site here")
    return "oth", dict(ident)


class _FakeProposals:
    @staticmethod
    def assignments_for(store, draft_id):  # noqa: ANN001
        return []


consumer.store_for = lambda site=None: _Store()  # type: ignore[assignment]
consumer.calendar_view = _fake_calendar_view  # type: ignore[assignment]
consumer.resolve_caller = _fake_resolve_caller  # type: ignore[assignment]
consumer.proposals = _FakeProposals  # type: ignore[assignment]


def _client(oid: str) -> TestClient:
    app = FastAPI()
    app.include_router(consumer.router)
    app.dependency_overrides[require_user] = lambda: Principal(
        oid=oid, tid="dev", upn=f"{oid}@example.invalid", name="Test User",
        scopes=("access_as_user",)
    )
    return TestClient(app, raise_server_exceptions=False)


# ------------------------------------------------------------------------------------------------
# 1. Identity and the subject binding.
# ------------------------------------------------------------------------------------------------

print("\n=== identity ===")
r = _client("oid-me").get("/api/me")
check("GET /api/me returns 200 for a mapped lecturer", r.status_code == 200, r.text[:160])
body = r.json() if r.status_code == 200 else {}
check("reports the caller's own teacherId", body.get("teacherId") == ME, str(body))
check("resolves the display name from the store",
      body.get("displayName") == "Prof. Dr. Lengfelder", str(body.get("displayName")))
check("declares scope 'self'", body.get("scope") == "self", str(body.get("scope")))

r = _client("oid-unknown").get("/api/me")
check("an unmapped account is refused, not given a guest view", r.status_code == 403, r.text[:160])

r = _client("oid-planner-no-teacher").get("/api/me")
check("an identity with no teacherId is refused rather than shown an empty week",
      r.status_code == 403, r.text[:160])

# ------------------------------------------------------------------------------------------------
# 2. The week, and the query parameters that must NOT work.
# ------------------------------------------------------------------------------------------------

print("\n=== /api/me/week takes its subject from the token ===")
CALENDAR_CALLS.clear()
r = _client("oid-me").get("/api/me/week")
check("GET /api/me/week returns 200", r.status_code == 200, r.text[:160])
check("calendar_view was asked for the caller's own row",
      CALENDAR_CALLS == [("teacher", ME)], str(CALENDAR_CALLS))

# ⚠️ The real test: pass the planner API's own parameters and confirm they do nothing.
CALENDAR_CALLS.clear()
r = _client("oid-me").get(f"/api/me/week?scope=teacher&key={OTHER}&draftId=D123")
check("scope/key/draftId in the query are ignored", r.status_code == 200, r.text[:160])
check("...and the subject is still the caller, not the injected key",
      CALENDAR_CALLS == [("teacher", ME)], str(CALENDAR_CALLS))

# ------------------------------------------------------------------------------------------------
# 3. Tool-argument clamping. This is where an unclamped chat leaks what the endpoint protects.
# ------------------------------------------------------------------------------------------------

print("\n=== tool clamping ===")
execute = consumer._executor(_Store(), ME)

res = execute("get_calendar", {"scope": "teacher", "key": OTHER})
check("get_calendar for ANOTHER lecturer is refused",
      res.get("error") == "other_person_not_visible", str(res))

res = execute("get_affected_sessions", {"teacher": OTHER})
check("get_affected_sessions for ANOTHER lecturer is refused",
      res.get("error") == "other_person_not_visible", str(res))

res = execute("get_affected_sessions", {"teacher": "Prof. Dr. Achleitner"})
check("...and refused when the colleague is named rather than keyed",
      res.get("error") == "other_person_not_visible", str(res))

res = execute("get_calendar", {"scope": "room", "key": "K 001"})
check("a non-teacher scope is refused", res.get("error") == "scope_not_available", str(res))

for blocked in ("find_substitute", "propose_repairs", "detect_conflicts", "get_plan_overview"):
    res = execute(blocked, {"teacher": ME})
    check(f"{blocked} is not reachable from the consumer surface",
          res.get("error") == "tool_not_available", str(res))

# The caller's OWN data must still work, by id, by name, and by omission.
seen: list[dict[str, Any]] = []
consumer.CONSUMER_TOOLS["get_calendar"] = lambda store, **kw: (seen.append(kw) or {"ok": True})
consumer.CONSUMER_TOOLS["get_affected_sessions"] = lambda store, **kw: (seen.append(kw) or {"ok": True})
execute = consumer._executor(_Store(), ME)

seen.clear()
res = execute("get_calendar", {"scope": "teacher", "key": ME})
check("own week by id is allowed", res.get("ok") is True and seen == [{"scope": "teacher", "key": ME}],
      str((res, seen)))

seen.clear()
res = execute("get_calendar", {"scope": "teacher", "key": "Prof. Dr. Lengfelder"})
check("own week by DISPLAY NAME is allowed and normalised to the id",
      res.get("ok") is True and seen == [{"scope": "teacher", "key": ME}], str((res, seen)))

seen.clear()
res = execute("get_affected_sessions", {"day": "Fr"})
check("an omitted subject is filled in with the caller, not refused",
      res.get("ok") is True and seen == [{"day": "Fr", "teacher": ME}], str((res, seen)))

# ------------------------------------------------------------------------------------------------
# 4. ⚠️ The negative control: prove the clamp is what stops the leak.
# ------------------------------------------------------------------------------------------------

print("\n=== negative control: remove the clamp and the leak must reappear ===")
original_clamp = consumer._clamp
try:
    consumer._clamp = lambda name, args, store, teacher_id: dict(args)  # type: ignore[assignment]
    leaky = consumer._executor(_Store(), ME)
    seen.clear()
    res = leaky("get_calendar", {"scope": "teacher", "key": OTHER})
    leaked = res.get("ok") is True and seen == [{"scope": "teacher", "key": OTHER}]
    check("without _clamp, a colleague's week IS reachable (so the clamp is load-bearing)",
          leaked, str((res, seen)))
finally:
    consumer._clamp = original_clamp  # type: ignore[assignment]

# And confirm the restore worked, so a later reader cannot be fooled by a stale patch.
seen.clear()
res = consumer._executor(_Store(), ME)("get_calendar", {"scope": "teacher", "key": OTHER})
check("clamp restored after the control", res.get("error") == "other_person_not_visible", str(res))

# ------------------------------------------------------------------------------------------------
# 5. The allow-list is a decision, so assert its exact contents.
# ------------------------------------------------------------------------------------------------

print("\n=== allow-list ===")
check("exactly two tools are exposed",
      sorted(consumer.CONSUMER_TOOLS) == ["get_affected_sessions", "get_calendar"],
      str(sorted(consumer.CONSUMER_TOOLS)))

print()
if FAILURES:
    print(f"FAILED: {len(FAILURES)} check(s): {', '.join(FAILURES)}")
    raise SystemExit(1)
print("consumer RLS: all checks pass")
