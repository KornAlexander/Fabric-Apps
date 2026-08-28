"""§41.17.7 — the tests that decide whether the intake path is a boundary or a suggestion.

Run as a plain script, like the rest of `tools/tests`:

    python tools\\tests\\test_intake_auth.py

⚠️ NO LIVE WAREHOUSE, NO NETWORK, NO TOKENS. Every dependency is stubbed, because a test that
only passes when a Fabric Warehouse happens to be reachable is a test nobody runs, and an
unrun test is worse than no test: it looks like coverage.

What is deliberately being tested is the set of things that would each, on their own, turn this
feature into an incident:
  - a professor submitting on a colleague's behalf,
  - a professor reading the planning queue,
  - a submit whose impact figures nobody ever saw,
  - a submit costed against a plan that has since changed,
  - anything at all publishing a plan,
  - a health reason landing in a Warehouse column.
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
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

# Must be set BEFORE importing auth, which reads config at import time.
os.environ.setdefault("ENTRA_AUTH_DISABLED", "1")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import intake  # noqa: E402
import intake_store  # noqa: E402
from auth import Principal, require_user  # noqa: E402

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name} {detail}")
        FAILURES.append(name)


# ------------------------------------------------------------------------------------------------
# Stubs.
# ------------------------------------------------------------------------------------------------

PLAN_VERSION = "7"


class _Store:
    site = "oth"
    plan_version = 7
    # ⚠️ The store's own `day` FIELD is what a whole-day block expands through, so the fake has to
    # carry it. Deriving the day from the slot id would let a router bug pass here.
    #
    # ⚠️ SIX BLOCKS, NOT THREE. The solver-contract test below asks about `Fr-5` and `Fr-6`, which
    # this fixture did not contain: it was asserting the shape of a constraint built from slot ids
    # that do not exist in its own store. Nothing noticed until the router started refusing a slot
    # the site does not have, which is the check working. A fixture that disagrees with the
    # request it is asked about can only ever test the parts that do not look at the data.
    slots = [{"slotId": f"{d}-{b}", "day": d} for d in ("Mo", "Fr") for b in (1, 2, 3, 4, 5, 6)]


#: Every call the router makes into the solver, recorded so the SHAPE can be asserted.
CALLS: dict[str, list] = {"propose_repairs": [], "insert_request": [], "decide": []}

#: oid -> identity. Two people at one site, one of each role, plus an unmapped stranger.
PEOPLE = {
    "oid-prof": {"teacherId": "T-042", "role": "teacher", "provenance": "upn_match"},
    "oid-plan": {"teacherId": "T-001", "role": "planner", "provenance": "upn_match"},
}

PREVIEWS: dict[str, dict] = {}


def _install_stubs() -> None:
    intake.known_sites = lambda: ["oth"]
    intake.store_for = lambda site=None: _Store()
    intake.get_affected_sessions = lambda store, teacher, day=None, slot_ids=None: {
        "sessions": [{"sessionId": "S1", "cohortId": "C1"}, {"sessionId": "S2", "cohortId": "C2"}]
    }

    def _propose(store, session_ids, k=3, forbid=None, time_limit_s=5.0):
        CALLS["propose_repairs"].append({"session_ids": session_ids, "forbid": forbid})
        return {"options": [{"sessionsMoved": 2}], "optimalityProven": True}

    intake.propose_repairs = _propose

    intake_store.intake_enabled = lambda: True
    intake_store.resolve_identity = lambda oid, site: PEOPLE.get(oid)

    def _save_preview(site, requested_by, constraints, result, plan_version, rule_version=None):
        pid = f"prev-{len(PREVIEWS) + 1}"
        PREVIEWS[pid] = {"owner": requested_by, "constraints": constraints,
                         "result": result, "planVersion": plan_version, "used": False}
        return pid

    def _take_preview(preview_id, requested_by, plan_version):
        snap = PREVIEWS.get(preview_id)
        if not snap:
            return None
        if snap["owner"] != requested_by:          # not yours
            return None
        if snap["planVersion"] != plan_version:    # stale
            return None
        return snap

    def _insert_request(row):
        CALLS["insert_request"].append(row)
        return "req-1"

    def _claim_and_insert(preview_id, *, owner_oid, plan_version, row_of):
        """Mirrors the real atomic claim: validate, then build and record the row."""
        snap = PREVIEWS.get(preview_id)
        if not snap or snap["owner"] != owner_oid or snap["planVersion"] != plan_version:
            return None
        if snap.get("used"):
            return None
        snap["used"] = True
        row = row_of(snap)
        CALLS["insert_request"].append(row)
        return "req-1", snap

    intake_store.claim_preview_and_insert = _claim_and_insert

    def _request_for_preview(preview_id, *, owner_oid):
        """⚠️ Mirrors the OWNER PREDICATE, not just the lookup.

        Added when `submit` began telling a retry apart from a refusal. The point of the real
        query is that it is scoped to the caller, so a preview id cannot be turned into somebody
        else's request id. A fake that ignored `owner_oid` would make the leak test pass while the
        production query leaked, which is the precise failure mode a hand-written fake exists to
        create. This test file is also why the whole suite went red the moment the interface grew
        a method: a fake is a promise to keep two things in step by hand.
        """
        for row in CALLS["insert_request"]:
            if row.get("previewId") == preview_id and row.get("submittedByOid") == owner_oid:
                return {"requestId": "req-1", "status": "pending", "createdAt": None}
        return None

    intake_store.request_for_preview = _request_for_preview

    def _identity_sites(oid):
        """Which sites this oid is mapped to.

        ⚠️ The router calls THIS, not `resolve_identity`, whenever the caller omits `site` - which
        is how a professor at a non-default university is found at all. A fake without it made
        two suites fail at once on a path they both thought they covered.
        """
        person = PEOPLE.get(oid)
        if not person:
            return []
        return [{"site": _Store.site, "teacherId": person["teacherId"],
                 "role": person["role"], "provenance": person.get("provenance")}]

    intake_store.identity_sites = _identity_sites

    def _decide(request_id, decided_by_upn, decided_by_role, accept, note=None, applied_rows=None):
        CALLS["decide"].append(request_id)
        return request_id != "req-already-decided"

    intake_store.save_preview = _save_preview
    intake_store.take_preview = _take_preview
    intake_store.insert_request = _insert_request
    intake_store.decide = _decide

    # ⚠️ THIS FAKE USED TO IGNORE `status` ENTIRELY and hand back the same two rows whatever was
    # asked for. That is not a harmless shortcut: the moment `/mine` started asking for `pending`
    # and then `failed` (so a request whose write did not land stops vanishing from its owner's
    # list), the fake returned every row twice and the duplicate looked like a router bug.
    #
    # The real `list_queue` filters on status in both backends, so two filtered calls are disjoint
    # by construction. A fake that does not filter is asserting something about this router that
    # production would never put to the test.
    _QUEUE_ROWS = [
        {"requestId": "req-1", "status": "pending",
         "submittedByOid": "oid-prof", "submittedByUpn": "prof@uni.de",
         "teacherId": "T-042", "payload": {"constraints": [{"teacher": "T-042", "day": "Fr"}]}},
        {"requestId": "req-2", "status": "pending",
         "submittedByOid": "oid-other", "submittedByUpn": "other@uni.de",
         "teacherId": "T-099", "payload": {"constraints": [{"teacher": "T-099", "day": "Mo"}]}},
    ]
    intake_store.list_queue = lambda site, status="pending", limit=200: [
        dict(r) for r in _QUEUE_ROWS if r["status"] == status
    ]

    CALLS["applied"] = []

    def _apply(site, teacher_id, slot_ids, state, updated_by):
        CALLS["applied"].append({"site": site, "teacherId": teacher_id, "slotIds": slot_ids,
                                 "state": state, "updatedBy": updated_by})
        return {"inserted": len(slot_ids), "updated": 0}

    intake_store.apply_accepted_availability = _apply
    intake_store.record_application = lambda rid, applied_rows, failure_reason, actor_upn, actor_role: None


def _client(oid: str, upn: str) -> TestClient:
    app = FastAPI()
    app.include_router(intake.router)
    app.dependency_overrides[require_user] = lambda: Principal(
        oid=oid, tid="tid", upn=upn, name="Test Person", scopes=("access_as_user",)
    )
    return TestClient(app, raise_server_exceptions=False)


# ------------------------------------------------------------------------------------------------
# 1. Redaction. The only defence that has to work on text nobody reviewed.
# ------------------------------------------------------------------------------------------------

def test_redaction() -> None:
    print("\n[1] ⚠️ free text cannot be submitted AT ALL")
    # There used to be a `redact_reason()` here, tested against a list of German causal markers.
    # It passed every one of those and was still not a privacy boundary: it could only remove what
    # somebody had thought of. The sentences below are the counter-examples that broke it, and the
    # test now asserts the property that actually holds, which is that there is nowhere to put them.
    check("the redaction function is gone entirely",
          not hasattr(intake, "redact_reason"),
          "a filter is back; a filter is not a boundary")

    fields = set(intake.SubmitRequest.model_fields)
    check("SubmitRequest has no free-text field",
          not (fields & {"utterance", "reason", "note", "comment", "text"}), sorted(fields))

    CALLS["insert_request"].clear()
    c = _client("oid-prof", "prof@uni.de")
    pid = c.post("/api/intake/preview", json={"kind": "availability", "day": "Fr"}).json()["previewId"]

    sensitive = [
        "Meine Tochter ist krank",                   # third party health, NO causal marker
        "Ich habe freitags Chemotherapie",           # Art. 9 DSGVO, NO causal marker
        "Personalratssitzung am Freitag",            # works council activity
        "my child is sick",                          # not German: no marker could ever match
        "Freitags nicht, weil ich pflege",           # the only shape the old filter caught
    ]
    for text in sensitive:
        c.post("/api/intake/submit", json={
            "kind": "availability", "previewId": pid, "day": "Fr", "utterance": text,
        })

    written = json.dumps(CALLS["insert_request"], ensure_ascii=False).lower()
    for text in sensitive:
        # ⚠️ The LONGEST word, not `split()[1]`. That picked "am" out of "Personalratssitzung am
        # Freitag", which occurs inside unrelated JSON and failed a passing implementation. A probe
        # that is not distinctive tests the haystack, not the needle.
        probe = max(text.replace(",", " ").split(), key=len).lower()
        check(f"nothing reached storage from: {text[:34]!r}", probe not in written, probe)
    check("no row carries any free-text key",
          all(not ({"utterance", "utteranceRedacted"} & set(r)) for r in CALLS["insert_request"]),
          [sorted(r) for r in CALLS["insert_request"]][:1])


# ------------------------------------------------------------------------------------------------
# 2. Identity. The subject of a request is the token, not the body.
# ------------------------------------------------------------------------------------------------

def test_identity() -> None:
    print("\n[2] identity comes from the token")
    CALLS["propose_repairs"].clear()
    c = _client("oid-prof", "prof@uni.de")

    me = c.get("/api/me").json()
    check("/api/me resolves the mapped person", me["teacherId"] == "T-042" and me["role"] == "teacher", me)

    # The attack: claim to be someone else in the body.
    c.post("/api/intake/preview", json={"kind": "availability", "day": "Fr", "teacherId": "T-999"})
    forbid = CALLS["propose_repairs"][-1]["forbid"]
    check("teacherId in the body is IGNORED",
          all(f.get("teacher") == "T-042" for f in forbid), forbid)

    stranger = _client("oid-nobody", "stranger@uni.de").get("/api/me")
    check("an unmapped account is refused, not treated as ordinary", stranger.status_code == 403,
          stranger.status_code)


# ------------------------------------------------------------------------------------------------
# 3. Roles. Enforced here, not in the agent's instructions.
# ------------------------------------------------------------------------------------------------

def test_roles() -> None:
    print("\n[3] roles are enforced server side")
    prof = _client("oid-prof", "prof@uni.de")
    plan = _client("oid-plan", "planner@uni.de")

    check("teacher is refused the queue", prof.get("/api/intake/queue").status_code == 403)
    check("planner may read the queue", plan.get("/api/intake/queue").status_code == 200)
    check("teacher may not decide",
          prof.post("/api/intake/req-1/decide", json={"accept": True}).status_code == 403)

    mine = prof.get("/api/intake/mine").json()["requests"]
    check("/mine returns only the caller's own rows",
          [r["requestId"] for r in mine] == ["req-1"], mine)


# ------------------------------------------------------------------------------------------------
# 4. Preview before submit, and the preview must still be valid.
# ------------------------------------------------------------------------------------------------

def test_preview_gate() -> None:
    print("\n[4] preview before submit")
    prof = _client("oid-prof", "prof@uni.de")

    r = prof.post("/api/intake/submit", json={"kind": "availability", "day": "Fr"})
    check("submit without previewId is refused", r.status_code == 400, r.status_code)

    pid = prof.post("/api/intake/preview", json={"kind": "availability", "day": "Fr"}).json()["previewId"]

    other = _client("oid-plan", "planner@uni.de")
    r = other.post("/api/intake/submit", json={"kind": "availability", "previewId": pid})
    check("someone else's previewId is refused", r.status_code == 409, r.status_code)

    r = prof.post("/api/intake/submit", json={"kind": "availability", "previewId": "prev-does-not-exist"})
    check("an unknown previewId is refused", r.status_code == 409, r.status_code)

    # The plan moves underneath a valid preview.
    PREVIEWS[pid]["planVersion"] = "6"
    r = prof.post("/api/intake/submit", json={"kind": "availability", "previewId": pid})
    check("a preview costed against an older plan is refused", r.status_code == 409, r.status_code)


# ------------------------------------------------------------------------------------------------
# 5. The solver is actually asked the question. §26.1's failure, in test form.
# ------------------------------------------------------------------------------------------------

def test_solver_contract() -> None:
    print("\n[5] the constraint really reaches the solver")
    CALLS["propose_repairs"].clear()
    prof = _client("oid-prof", "prof@uni.de")

    prof.post("/api/intake/preview", json={"kind": "availability", "day": "Fr"})
    forbid = CALLS["propose_repairs"][-1]["forbid"]
    check("forbid uses the documented {teacher, day} shape",
          forbid == [{"teacher": "T-042", "day": "Fr"}], forbid)

    CALLS["propose_repairs"].clear()
    prof.post("/api/intake/preview", json={"kind": "availability", "slotIds": ["Fr-5", "Fr-6"]})
    forbid = CALLS["propose_repairs"][-1]["forbid"]
    check("slotIds become one forbid entry each",
          forbid == [{"teacher": "T-042", "slotId": "Fr-5"}, {"teacher": "T-042", "slotId": "Fr-6"}],
          forbid)

    r = prof.post("/api/intake/preview", json={"kind": "availability"})
    check("a preview that constrains nothing is refused, not silently empty",
          r.status_code == 400, r.status_code)

    body = prof.post("/api/intake/preview", json={"kind": "availability", "day": "Fr"}).json()
    check("the impact figures come back with the preview",
          body["affectedSessions"] == 2 and body["wouldMove"] == 2 and body["feasible"] is True, body)


# ------------------------------------------------------------------------------------------------
# 6. Scope. What this path must NOT be able to do.
# ------------------------------------------------------------------------------------------------

def test_scope() -> None:
    print("\n[6] nothing here publishes, and unsupported kinds are refused")
    prof = _client("oid-prof", "prof@uni.de")
    plan = _client("oid-plan", "planner@uni.de")

    for kind in ("rule_request", "publish", "delete_everything", None):
        r = prof.post("/api/intake/preview", json={"kind": kind, "day": "Fr"})
        check(f"kind '{kind}' is refused at preview", r.status_code == 400, r.status_code)

    body = plan.post("/api/intake/req-1/decide", json={"accept": True}).json()
    check("accepting reports published=False (§26.5)", body.get("published") is False, body)
    check("accepting reports the new status", body.get("status") == "accepted", body)

    r = plan.post("/api/intake/req-already-decided/decide", json={"accept": True})
    check("deciding an already-decided request is a 409, not a silent overwrite",
          r.status_code == 409, r.status_code)

    paths = {getattr(r, "path", "") for r in intake.router.routes}
    check("no route mentions publish", not any("publish" in p for p in paths), paths)


def main() -> int:
    _install_stubs()
    test_redaction()
    test_identity()
    test_roles()
    test_preview_gate()
    test_solver_contract()
    test_scope()

    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {', '.join(FAILURES)}")
        return 1
    print("all intake auth checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
