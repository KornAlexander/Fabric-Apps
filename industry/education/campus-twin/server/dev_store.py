"""A file-backed stand-in for the CampusIntake Warehouse, for local runs and tests.

⚠️ THIS IS NOT A PRODUCTION BACKEND AND MUST NEVER BECOME ONE. §41.17.4's whole point is that a
preview has to survive a process restart AND be visible to the other replica; §24.4 already runs
`maxReplicas: 2`. A JSON file on a container's local filesystem satisfies neither. It is here for
exactly one reason:

    Every test written so far stubs `warehouse` with a HAND WRITTEN fake. A fake that does not
    match the real contract does not fail; it passes, and the passing is the problem. This module
    lets preview -> submit -> queue -> decide run through the real router, the real redaction, the
    real role checks and the real preview gate, so the only mocked thing left is the disk.

Because of that, it enforces **exactly** the rules the SQL path enforces, including the ones that
would be convenient to skip:

  * `take_preview` checks owner, expiry AND planVersion,
  * `decide` is conditional on `status = 'pending'` and returns False on the second caller,
  * `IntakeEvent` is append only and stamps the role as it was at that moment.

A relaxed dev backend would make the tests green and the guarantees imaginary.

Enabled only by an explicit environment variable. There is no autodetect, because the failure mode
of guessing here is a university running on a JSON file without knowing it.
"""

from __future__ import annotations

import json
import os
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

#: Path to the JSON file. Empty means the dev store is off.
DEV_STORE_PATH = os.getenv("CAMPUS_INTAKE_DEV_STORE", "").strip()

#: ⚠️ Azure Container Apps sets this. Its presence means "this is not a laptop".
IN_CONTAINER_APPS = bool(os.getenv("CONTAINER_APP_NAME") or os.getenv("CONTAINER_APP_REVISION"))

#: Set when the dev store was asked for somewhere it must not run, so health can say so.
REFUSED_IN_PRODUCTION = bool(DEV_STORE_PATH) and IN_CONTAINER_APPS

_EMPTY: dict[str, Any] = {"identities": {}, "previews": {}, "requests": {}, "events": [],
                          "availabilities": {}}


def dev_enabled() -> bool:
    """Whether the JSON stand-in is active.

    ⚠️ REFUSES INSIDE CONTAINER APPS, whatever the environment says. §24.4 runs `maxReplicas: 2`
    and each replica has its own filesystem, so a preview written by one replica does not exist for
    the other. The symptom is not an error: it is a professor confirming a change and being told
    the preview is unknown, roughly half the time, with the other half working perfectly. That is
    among the worst bugs to receive a report about, so the configuration is refused at the source
    rather than trusted to be set correctly.
    """
    return bool(DEV_STORE_PATH) and not IN_CONTAINER_APPS


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _load() -> dict[str, Any]:
    p = Path(DEV_STORE_PATH)
    if not p.exists():
        return json.loads(json.dumps(_EMPTY))
    # ⚠️ THE READ RETRIES TOO, and for the mirror image of the reason `_save` does. On Windows a
    # file cannot be opened while `os.replace` is swapping it, so a reader that arrives at exactly
    # the wrong moment gets PermissionError rather than data. Measured: a reader looping alongside
    # 60 writes hit it. Atomic replacement removes torn reads; it does not remove this window.
    deadline = time.monotonic() + 2.0
    while True:
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except (PermissionError, json.JSONDecodeError):
            if time.monotonic() > deadline:
                raise
            time.sleep(0.005)


def _save(data: dict[str, Any]) -> None:
    """Replace the file atomically.

    ⚠️ WRITE THEN RENAME, NEVER WRITE IN PLACE. `write_text` truncates first, so any reader that
    arrives during the write sees an empty or half-written document. Measured, not theorised:
    before this, a reader looping alongside 60 writes hit `JSONDecodeError: Expecting value` within
    a few iterations. `os.replace` is atomic on the same volume on both Windows and POSIX.
    """
    p = Path(DEV_STORE_PATH)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(f"{p.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    # ⚠️ UTF-8 explicitly. German names go through here and a cp1252 round trip mangles them.
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

    # ⚠️ WINDOWS: `os.replace` FAILS WHILE A READER HAS THE TARGET OPEN.
    # Python's `open()` does not request FILE_SHARE_DELETE, so a concurrent reader (another
    # process, or a person with the file open in an editor to see what the demo stored) makes the
    # rename raise PermissionError / ERROR_ACCESS_DENIED. Measured here: a reader looping alongside
    # writes killed a write within ~60 iterations. POSIX does not behave this way, so this is
    # exactly the class of bug that passes on a build agent and fails on the machine doing the demo.
    #
    # The replace stays atomic; it just may have to wait for its moment.
    deadline = time.monotonic() + 2.0
    while True:
        try:
            os.replace(tmp, p)
            return
        except PermissionError:
            if time.monotonic() > deadline:
                tmp.unlink(missing_ok=True)
                raise
            time.sleep(0.01)


#: Serialises threads inside one process. The lock file below serialises processes; neither alone
#: is sufficient, because a dev run can be several uvicorn workers AND several threads per worker.
_PROCESS_LOCK = threading.RLock()

_LOCK_TIMEOUT_S = 10.0


@contextmanager
def _transaction():
    """Load, modify, save, with nobody else in between.

    ⚠️ THE WHOLE SINGLE-USE GUARANTEE LIVES HERE. Without it, `claim_preview_and_insert` is a
    load, a check of `usedAt`, and a save, and twelve concurrent callers all read `usedAt = None`
    before any of them writes. Measured before this existed: **9 of 12 claims on the same preview
    succeeded**. The professor asks once, an agent retries a timed-out call, and the planning office
    receives a pile of identical requests with no way to know how many were meant.

    Sequential tests cannot see any of this, which is exactly why they were not enough.
    """
    with _PROCESS_LOCK:
        lock_path = Path(DEV_STORE_PATH + ".lock")
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        fd = None
        deadline = time.monotonic() + _LOCK_TIMEOUT_S
        while fd is None:
            try:
                fd = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_RDWR)
            except FileExistsError:
                if time.monotonic() > deadline:
                    # A holder died without releasing. Breaking the lock is the lesser evil: the
                    # alternative is a dev store that is permanently wedged after one crash.
                    try:
                        lock_path.unlink()
                    except OSError:
                        pass
                    deadline = time.monotonic() + _LOCK_TIMEOUT_S
                time.sleep(0.002)
        try:
            data = _load()
            yield data
            _save(data)
        finally:
            os.close(fd)
            try:
                lock_path.unlink()
            except OSError:
                pass


def seed_identity(oid: str, site: str, teacher_id: str, role: str,
                  upn: str | None = None, provenance: str = "dev-seed",
                  is_primary: bool = False) -> None:
    """Put one person in the store.

    ⚠️ WITHOUT AT LEAST ONE PLANNER, NOTHING IS EVER DECIDED and the failure is silent: the queue
    endpoint returns a clean 403 and looks like it is working correctly. The DDL carries the same
    warning for the real table.
    """
    with _transaction() as data:
        data["identities"][f"{oid}|{site}"] = {
            "teacherId": teacher_id, "role": role, "upn": upn, "provenance": provenance,
            "isPrimary": bool(is_primary),
        }

# ------------------------------------------------------------------------------------------------
# The same seven operations, same signatures, same rules.
# ------------------------------------------------------------------------------------------------


def resolve_identity(oid: str, site: str) -> dict[str, Any] | None:
    row = _load()["identities"].get(f"{oid}|{site}")
    if not row:
        return None
    return {"teacherId": row["teacherId"], "role": row["role"], "provenance": row.get("provenance")}


def save_preview(*, site: str, requested_by: str, constraints: list[dict[str, Any]],
                 result: dict[str, Any], plan_version: str, rule_version: str | None,
                 ttl_minutes: int = 30) -> str:
    preview_id = str(uuid.uuid4())
    with _transaction() as data:
        data["previews"][preview_id] = {
            "site": site, "requestedBy": requested_by,
            "constraints": constraints, "result": result,
            "planVersion": plan_version, "ruleVersion": rule_version,
            "createdAt": _now().isoformat(),
            "expiresAt": (_now() + timedelta(minutes=ttl_minutes)).isoformat(),
        }
    return preview_id


def take_preview(preview_id: str, *, requested_by: str, plan_version: str) -> dict[str, Any] | None:
    with _transaction() as data:
        snap = data["previews"].get(preview_id)
        if not snap:
            return None
        if snap["requestedBy"] != requested_by:
            return None                               # not yours
        if datetime.fromisoformat(snap["expiresAt"]) <= _now():
            return None                               # expired
        if snap["planVersion"] != plan_version:
            return None                               # the plan moved underneath it
        if snap.get("usedAt"):
            return None                               # ⚠️ already claimed: it is called *take*
        snap["usedAt"] = _now().isoformat()
        return {
            "constraints": snap["constraints"], "result": snap["result"],
            "planVersion": snap["planVersion"], "ruleVersion": snap.get("ruleVersion"),
        }


def claim_preview_and_insert(preview_id: str, *, owner_oid: str, plan_version: str,
                             row_of) -> tuple[str, dict[str, Any]] | None:
    """Claim and insert inside ONE locked transaction, so the pair cannot come apart."""
    with _transaction() as data:
        snap = data["previews"].get(preview_id)
        if not snap:
            return None
        if snap["requestedBy"] != owner_oid:
            return None                               # not yours (matched on the immutable oid)
        if datetime.fromisoformat(snap["expiresAt"]) <= _now():
            return None                               # expired
        if snap["planVersion"] != plan_version:
            return None                               # the plan moved underneath it
        if snap.get("usedAt"):
            return None                               # already claimed

        result = {"constraints": snap["constraints"], "result": snap["result"],
                  "planVersion": snap["planVersion"], "ruleVersion": snap.get("ruleVersion")}
        row = row_of(result)
        request_id = row.get("requestId") or str(uuid.uuid4())

        snap["usedAt"] = _now().isoformat()
        stored = {k: v for k, v in row.items() if k != "role"}
        stored.update({"requestId": request_id, "status": "pending",
                       "createdAt": _now().isoformat()})
        stored.pop("utterance", None)
        stored.pop("utteranceRedacted", None)
        data["requests"][request_id] = stored
        data["events"].append({
            "eventId": str(uuid.uuid4()), "requestId": request_id,
            "occurredAt": _now().isoformat(), "actorUpn": row["submittedByUpn"],
            "actorRole": row.get("role", "unknown"), "action": "submitted", "detail": None,
        })
    return request_id, result


def insert_request(row: dict[str, Any]) -> str:
    request_id = row.get("requestId") or str(uuid.uuid4())
    with _transaction() as data:
        stored = {k: v for k, v in row.items() if k != "role"}
        stored.update({"requestId": request_id, "status": "pending",
                       "createdAt": _now().isoformat()})
        # ⚠️ Mirrors the DDL: there is NO free-text column at all. If a caller ever passes one, it
        # is dropped here too, so the dev store cannot become the place a reason quietly survives.
        stored.pop("utterance", None)
        stored.pop("utteranceRedacted", None)
        data["requests"][request_id] = stored
        data["events"].append({
            "eventId": str(uuid.uuid4()), "requestId": request_id,
            "occurredAt": _now().isoformat(), "actorUpn": row["submittedByUpn"],
            "actorRole": row.get("role", "unknown"), "action": "submitted", "detail": None,
        })
    return request_id


def request_for_preview(preview_id: str, *, owner_oid: str) -> dict[str, Any] | None:
    """Mirror of the SQL path, including the owner predicate. See `intake_store` for why."""
    data = _load()
    matches = [
        r for r in data["requests"].values()
        if r.get("previewId") == preview_id and r.get("submittedByOid") == owner_oid
    ]
    if not matches:
        return None
    matches.sort(key=lambda r: r.get("createdAt", ""), reverse=True)
    row = matches[0]
    return {"requestId": row["requestId"], "status": row.get("status"),
            "createdAt": row.get("createdAt")}


def identity_sites(oid: str) -> list[dict[str, Any]]:
    """Mirror of the SQL path. See `intake_store.identity_sites` for why it returns every match.

    ⚠️ The oid and the site are in the KEY here (`f"{oid}|{site}"`), not in the row, which the
    SQL table has as real columns. A first version of this filtered on `row["oid"]` and silently
    returned nothing at all, which would have looked exactly like "this person is not mapped
    anywhere" - the very answer this function exists to stop being wrong. Split from the right:
    the site never contains a pipe, an oid conceivably could.
    """
    out = []
    for key, row in _load().get("identities", {}).items():
        row_oid, _, row_site = key.rpartition("|")
        if row_oid != oid:
            continue
        out.append({"site": row_site, "teacherId": row.get("teacherId"),
                    "role": row.get("role"), "provenance": row.get("provenance"),
                    "isPrimary": bool(row.get("isPrimary"))})
    return sorted(out, key=lambda r: r.get("site") or "")


def list_queue(site: str, *, status: str = "pending", limit: int = 200) -> list[dict[str, Any]]:
    data = _load()
    rows = [r for r in data["requests"].values() if r.get("site") == site and r.get("status") == status]
    rows.sort(key=lambda r: r.get("createdAt", ""), reverse=True)
    out = []
    for r in rows[:limit]:
        out.append({
            "requestId": r["requestId"], "kind": r.get("kind"), "status": r.get("status"),
            "submittedByOid": r.get("submittedByOid"),
            "submittedByUpn": r.get("submittedByUpn"), "submittedByName": r.get("submittedByName"),
            "teacherId": r.get("teacherId"), "payload": r.get("payload", {}),
            # ⚠️ Same key as the SQL path: `impactAtSubmit`, never `impact`. The name is the only
            # thing stopping a panel rendering a three week old number as current.
            "impactAtSubmit": {"sessions": r.get("impactSessions"), "moves": r.get("impactMoves"),
                               "feasible": r.get("impactFeasible")},
            "planVersionAtSubmit": r.get("planVersion"), "createdAt": r.get("createdAt"),
        })
    return out


def decide(request_id: str, *, decided_by_upn: str, decided_by_role: str, accept: bool,
           note: str | None, applied_rows: int | None = None,
           failure_reason: str | None = None) -> bool:
    with _transaction() as data:
        row = data["requests"].get(request_id)
        if not row or row.get("status") not in ("pending", "failed"):
            # ⚠️ `failed` counts as still open. See `intake_store.decide` for why: a request whose
            # availability write did not land was otherwise unreachable forever.
            return False                              # already settled, or never existed
        status = "accepted" if accept else "rejected"
        row.update({"status": status, "decidedByUpn": decided_by_upn,
                    "decidedAt": _now().isoformat(), "decisionNote": note,
                    "appliedRows": applied_rows, "failureReason": failure_reason})
        data["events"].append({
            "eventId": str(uuid.uuid4()), "requestId": request_id,
            "occurredAt": _now().isoformat(), "actorUpn": decided_by_upn,
            "actorRole": decided_by_role, "action": status, "detail": note,
        })
    return True


def apply_accepted_availability(*, site: str, teacher_id: str, slot_ids: list[str],
                                state: str, updated_by: str) -> dict[str, int]:
    """Same contract as the SQL path, including the deterministic id, so drift is visible."""
    from availability_id import availability_id

    inserted = updated = 0
    with _transaction() as data:
        rows = data.setdefault("availabilities", {})
        for slot_id in slot_ids:
            row_id = availability_id(site, teacher_id, slot_id)
            existing = rows.get(row_id)
            rows[row_id] = {
                "id": row_id, "site": site, "teacherId": teacher_id, "slotId": slot_id,
                "state": state, "source": "intake", "note": "",
                "updatedBy": updated_by, "updatedAt": _now().isoformat(),
            }
            if existing:
                updated += 1
            else:
                inserted += 1
    return {"inserted": inserted, "updated": updated}


def record_application(request_id: str, *, applied_rows: int | None,
                       failure_reason: str | None, actor_upn: str, actor_role: str) -> None:
    with _transaction() as data:
        row = data["requests"].get(request_id)
        if not row:
            return
        row["appliedRows"] = applied_rows
        row["failureReason"] = failure_reason
        if failure_reason:
            row["status"] = "failed"
        data["events"].append({
            "eventId": str(uuid.uuid4()), "requestId": request_id,
            "occurredAt": _now().isoformat(), "actorUpn": actor_upn, "actorRole": actor_role,
            "action": "failed" if failure_reason else "applied",
            "detail": failure_reason or f"{applied_rows} Zeile(n)",
        })


def availabilities_for(site: str) -> list[dict[str, Any]]:
    """Read what was applied. Test and debugging affordance; no endpoint exposes this."""
    return [r for r in _load().get("availabilities", {}).values() if r["site"] == site]


def events_for(request_id: str) -> list[dict[str, Any]]:
    """Read the audit trail. Test and debugging affordance; no endpoint exposes this."""
    return [e for e in _load()["events"] if e["requestId"] == request_id]


__all__ = [
    "dev_enabled", "seed_identity", "events_for", "REFUSED_IN_PRODUCTION",
    "resolve_identity", "save_preview", "take_preview", "claim_preview_and_insert",
    "insert_request", "list_queue", "decide",
    "apply_accepted_availability", "availabilities_for", "record_application",
]
