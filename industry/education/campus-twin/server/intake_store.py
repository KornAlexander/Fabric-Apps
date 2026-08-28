"""Fabric Warehouse access for the intake path (PLAN §41.7, §43.7).

⚠️ THE LAKEHOUSE CANNOT BE WRITTEN TO. Its SQL analytics endpoint is read only, which is the single
fact that dictates this module's existence (§41.4). `CampusIntake` is a Warehouse beside the
Lakehouse, and it is deliberately NOT the plan of record: it holds what people asked for, while
`PlanAssignment` stays what is true.

    from intake_store import intake_enabled, insert_request, list_queue

⚠️ FAILS LOUD, NOT SILENT. If the connection string is unset, this module says so and the caller
returns a 503. It never pretends a write succeeded. §13.7's whole lesson is that a UI which reports
success for a write that did not land is worse than one that refuses.

⚠️ Singleton INSERTs are correct here and the standard Fabric guidance against them does not apply.
That guidance targets ingestion loops. The measured volume is a few hundred rows per semester at OTH
scale, typed by humans one sentence at a time (§41.4). Do not "optimise" this into a batch pipeline
and lose the interactivity.
"""

from __future__ import annotations

import json
import os
import struct
import uuid
from datetime import datetime, timezone
from typing import Any

#: ODBC connection string for the intake SQL endpoint, without credentials.
#: ⚠️ NO EXAMPLE HOST. An earlier version of this comment carried a sample Warehouse endpoint,
#: which `npm run check:publishable` flagged and which had ALSO become factually wrong when this
#: module was re-pointed at a Fabric SQL Database. The shape is documented in
#: `tools/fabric/fabric_ids.py`, which is the one place a real endpoint is described.
INTAKE_ODBC = os.getenv("CAMPUS_INTAKE_ODBC", "").strip()

#: The Entra scope for the Fabric SQL endpoint. Token is acquired with the container's managed
#: identity, matching the `AZURE_OPENAI_USE_MANAGED_IDENTITY` pattern already used for Foundry.
_SQL_SCOPE = "https://database.windows.net/.default"

#: SQL_COPT_SS_ACCESS_TOKEN. Undocumented-looking but it is the documented way to pass an AAD
#: access token through pyodbc, and the encoding below is not optional.
_SQL_COPT_SS_ACCESS_TOKEN = 1256

import dev_store  # noqa: E402  (kept next to the dispatch it serves)
from availability_id import availability_id  # noqa: E402


def _dev() -> bool:
    """Whether this process is talking to the local JSON stand-in instead of Fabric.

    ⚠️ REFUSES WHEN BOTH ARE SET. "Which store did that write land in" is not a question anyone
    should have to answer from memory at the end of a demo, and a silent precedence rule is how a
    real request quietly goes into a file nobody reads.
    """
    if dev_store.dev_enabled() and INTAKE_ODBC:
        raise RuntimeError(
            "both CAMPUS_INTAKE_ODBC and CAMPUS_INTAKE_DEV_STORE are set: refusing to guess "
            "which store to write to. Unset one."
        )
    return dev_store.dev_enabled()


def intake_enabled() -> bool:
    """Whether this deployment has an intake store configured at all."""
    return bool(INTAKE_ODBC) or dev_store.dev_enabled()


def _token_struct() -> bytes:
    """Managed-identity token in the shape the ODBC driver expects.

    ⚠️ UTF-16-LE, LENGTH-PREFIXED. Passing the raw string silently fails to authenticate and the
    driver reports a generic login error, which sends you looking at firewall rules instead.
    """
    from azure.identity import DefaultAzureCredential

    token = DefaultAzureCredential().get_token(_SQL_SCOPE).token
    raw = token.encode("utf-16-le")
    return struct.pack("<i", len(raw)) + raw


class StoreUnavailable(RuntimeError):
    """The store is configured correctly and cannot be reached right now.

    ⚠️ THIS IS A DIFFERENT ANSWER FROM "YOUR REQUEST WAS WRONG", and the difference is the whole
    reason the class exists. Before it, a paused Fabric capacity, an expired token or a dropped
    connection came out of the route as an unhandled `pyodbc.OperationalError`, so the caller got
    a 500. To an agent a 500 means nothing actionable: it reports that something went wrong, and
    the professor's sensible response is to reword the request and try again, which cannot help.
    A 503 that says the timetable database is temporarily unreachable tells them to wait, and
    tells them their request was never seen rather than rejected.

    Paused capacity is the ordinary case here, not the exotic one: these workspaces sit on
    capacities that are deliberately paused when idle.
    """


def _connect():
    if not INTAKE_ODBC:
        raise RuntimeError("CAMPUS_INTAKE_ODBC is not set: the intake Warehouse is not configured")
    import pyodbc

    try:
        return pyodbc.connect(INTAKE_ODBC,
                              attrs_before={_SQL_COPT_SS_ACCESS_TOKEN: _token_struct()})
    except pyodbc.Error as exc:
        # ⚠️ ONLY the driver's own errors, and only from CONNECTING. A broad `except Exception`
        # here would turn a genuine bug in `_token_struct` into a soothing "try again later",
        # which is how a permanent failure gets mistaken for a transient one for a week.
        #
        # ⚠️ A credential failure is deliberately NOT caught. It looks like the same thing and it
        # is not: a paused capacity still mints a token perfectly well and then fails to connect,
        # so pyodbc covers the ordinary case. Catching `ClientAuthenticationError` would also mean
        # importing `azure.core` at module scope, which breaks the lazy import that lets this
        # module load in a container with no driver at all.
        raise StoreUnavailable(str(exc).split("\n")[0][:200]) from exc


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ------------------------------------------------------------------------------------------------
# Identity. §41.7's TeacherIdentity, keyed on the token's immutable object id rather than the UPN.
# ------------------------------------------------------------------------------------------------


def resolve_identity(oid: str, site: str) -> dict[str, Any] | None:
    """Map a signed-in principal to a `teacherId` and a role, or None if unknown.

    ⚠️ Returning None must NOT be treated as "ordinary user". An unmapped caller has no role, and
    the router refuses rather than defaulting, for the same reason `_store()` refuses an unknown
    site instead of falling back to the default one.
    """
    if _dev():
        return dev_store.resolve_identity(oid, site)
    with _connect() as cx:
        rows = cx.cursor().execute(
            "SELECT TOP (2) teacherId, role, provenance FROM dbo.IntakeIdentity "
            "WHERE oid = ? AND site = ?",
            oid,
            site,
        ).fetchall()
    # ⚠️ TWO ROWS MEANS REFUSE, NOT "TAKE THE FIRST". Fabric Warehouse cannot enforce a primary
    # key (everything is NOT ENFORCED), so running the seed SQL twice, or a manual correction that
    # inserts rather than updates, silently produces two identities for one person. `fetchone()`
    # would then hand back whichever row the engine felt like, and the symptom is a professor
    # intermittently acting as a different teacher, or intermittently holding planner rights, with
    # an audit trail that looks perfectly consistent with itself.
    if len(rows) != 1:
        return None
    row = rows[0]
    return {"teacherId": row[0], "role": row[1], "provenance": row[2]}


# ------------------------------------------------------------------------------------------------
# Preview. §41.17.4: durable, because "the same conversation" is not something the server can verify
# on a container that scales to zero.
# ------------------------------------------------------------------------------------------------


def save_preview(
    *,
    site: str,
    requested_by: str,
    constraints: list[dict[str, Any]],
    result: dict[str, Any],
    plan_version: str,
    rule_version: str | None,
    ttl_minutes: int = 30,
) -> str:
    if _dev():
        return dev_store.save_preview(
            site=site, requested_by=requested_by, constraints=constraints, result=result,
            plan_version=plan_version, rule_version=rule_version, ttl_minutes=ttl_minutes,
        )
    preview_id = str(uuid.uuid4())
    now = _now()
    with _connect() as cx:
        cx.cursor().execute(
            """INSERT INTO dbo.IntakePreview
               (previewId, site, requestedBy, constraints, result, planVersion, ruleVersion,
                createdAt, expiresAt)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, DATEADD(minute, ?, ?))""",
            preview_id, site, requested_by,
            json.dumps(constraints, ensure_ascii=False),
            json.dumps(result, ensure_ascii=False),
            plan_version, rule_version, now, ttl_minutes, now,
        )
        cx.commit()
    return preview_id


def claim_preview_and_insert(preview_id: str, *, owner_oid: str, plan_version: str,
                             row_of) -> tuple[str, dict[str, Any]] | None:
    """Claim a preview and write its request in ONE transaction, or do neither.

    ⚠️ THIS REPLACED A TWO-CALL SEQUENCE THAT COULD EAT A USER'S ONLY VALID PREVIEW. `take_preview`
    committed `usedAt`, then `insert_request` ran separately. Any failure in between (a value too
    long for its column, a dropped connection, a serialisation error) left the preview consumed and
    no request written, and there was no state the user could recover from: retrying returned 409
    "already used", and the planning office had nothing. The two writes have to be one.

    `row_of` is a callable taking the preview snapshot and returning the row to insert, because the
    row's impact figures come FROM the snapshot and the snapshot is not known until it is claimed.

    Returns `(requestId, snapshot)`, or None if the preview could not be claimed.
    """
    if _dev():
        return dev_store.claim_preview_and_insert(
            preview_id, owner_oid=owner_oid, plan_version=plan_version, row_of=row_of)

    with _connect() as cx:
        cur = cx.cursor()
        try:
            cur.execute(
                """UPDATE dbo.IntakePreview
                   SET usedAt = ?
                   WHERE previewId = ? AND requestedBy = ? AND planVersion = ?
                     AND usedAt IS NULL AND expiresAt > SYSUTCDATETIME()""",
                _now(), preview_id, owner_oid, plan_version,
            )
            if cur.rowcount != 1:
                cx.rollback()
                return None
            got = cur.execute(
                """SELECT constraints, result, planVersion, ruleVersion
                   FROM dbo.IntakePreview WHERE previewId = ?""",
                preview_id,
            ).fetchone()
            if not got:
                cx.rollback()
                return None
            snap = {"constraints": json.loads(got[0]), "result": json.loads(got[1]),
                    "planVersion": got[2], "ruleVersion": got[3]}
            row = row_of(snap)
            request_id = _insert_request_rows(cur, row)
            cx.commit()
        except Exception:
            # The preview stays unused, so the user can simply submit again.
            cx.rollback()
            raise
    return request_id, snap


def take_preview(preview_id: str, *, requested_by: str, plan_version: str) -> dict[str, Any] | None:
    """CLAIM a preview if it is still valid FOR THIS CALLER and THIS PLAN. Single use.

    ⚠️ Four checks, and none is redundant:
      * owner, or one professor's preview could be used to submit as another
      * expiry, or a stale impact number is presented as current
      * `planVersion`, which is §24's `stale_draft` rule applied one step earlier. A preview
        computed against a plan that has since been published is not evidence about the plan now.
      * `usedAt IS NULL`, because the function is called *take*. A replayable preview means a
        retrying agent files the same request twice and nobody can tell it was one request.

    All four live in a SINGLE conditional UPDATE, so two concurrent submits cannot both win: the
    claim is the atomic step, and the read afterwards is just fetching what was claimed.
    """
    if _dev():
        return dev_store.take_preview(preview_id, requested_by=requested_by, plan_version=plan_version)
    with _connect() as cx:
        cur = cx.cursor()
        cur.execute(
            """UPDATE dbo.IntakePreview
               SET usedAt = ?
               WHERE previewId = ? AND requestedBy = ? AND planVersion = ?
                 AND usedAt IS NULL AND expiresAt > SYSUTCDATETIME()""",
            _now(), preview_id, requested_by, plan_version,
        )
        if cur.rowcount != 1:
            cx.rollback()
            return None
        row = cur.execute(
            """SELECT constraints, result, planVersion, ruleVersion
               FROM dbo.IntakePreview WHERE previewId = ?""",
            preview_id,
        ).fetchone()
        cx.commit()
    if not row:
        return None
    return {
        "constraints": json.loads(row[0]),
        "result": json.loads(row[1]),
        "planVersion": row[2],
        "ruleVersion": row[3],
    }


# ------------------------------------------------------------------------------------------------
# Requests and their audit trail.
# ------------------------------------------------------------------------------------------------


def insert_request(row: dict[str, Any]) -> str:
    """Write one intake request on its own. Returns its id.

    ⚠️ The submit path does NOT use this: it uses `claim_preview_and_insert`, so that consuming the
    preview and writing the request cannot come apart. This remains for writes that have no preview
    behind them (a cockpit-originated row).

    ⚠️ THERE IS NO FREE-TEXT COLUMN. An earlier version stored `utteranceRedacted`, produced by a
    German causal-marker blocklist. That was not a privacy boundary: "Meine Tochter ist krank"
    contains no marker and is third-party health data. The field, the parameter and the column are
    all gone, because §9.1 item 11 asks for the reason to be UNSTORABLE, not filtered.
    """
    if _dev():
        return dev_store.insert_request(row)
    with _connect() as cx:
        cur = cx.cursor()
        request_id = _insert_request_rows(cur, row)
        cx.commit()
    return request_id


def _insert_request_rows(cur, row: dict[str, Any]) -> str:
    """The INSERT plus its audit event, on a caller-supplied cursor so it can join a transaction."""
    request_id = row.get("requestId") or str(uuid.uuid4())
    cur.execute(
        """INSERT INTO dbo.IntakeRequest
           (requestId, site, kind, status, submittedByOid, submittedByUpn, submittedByName,
            teacherId, payload, previewId, sourceChannel, correlationId,
            impactSessions, impactMoves, impactFeasible, planVersion, ruleVersion,
            createdAt, expiresAt)
           VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        request_id, row["site"], row["kind"], row.get("submittedByOid"), row["submittedByUpn"],
        row.get("submittedByName"), row.get("teacherId"),
        json.dumps(row.get("payload", {}), ensure_ascii=False),
        row.get("previewId"), row.get("sourceChannel", "api"),
        row.get("correlationId"), row.get("impactSessions"), row.get("impactMoves"),
        row.get("impactFeasible"), row.get("planVersion"), row.get("ruleVersion"),
        _now(), row.get("expiresAt"),
    )
    _append_event(cur, request_id, row["submittedByUpn"], row.get("role", "unknown"), "submitted", None)
    return request_id


def _append_event(cursor, request_id: str, actor_upn: str, actor_role: str, action: str, detail: str | None) -> None:
    """One append-only row per thing that happened. §41.17.5.

    ⚠️ `actorRole` is stamped AS IT WAS AT THAT MOMENT. Reading the role live at display time would
    let a later change to `TeacherIdentity` silently rewrite who was allowed to do what.
    """
    # ⚠️ `occurredAt`, not `at`. `AT` collides with T-SQL's `AT TIME ZONE` and only survives
    # unbracketed by luck of the parser version. A column name should not depend on luck.
    cursor.execute(
        """INSERT INTO dbo.IntakeEvent (eventId, requestId, occurredAt, actorUpn, actorRole, action, detail)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        str(uuid.uuid4()), request_id, _now(), actor_upn, actor_role, action, detail,
    )


def apply_accepted_availability(*, site: str, teacher_id: str, slot_ids: list[str],
                                state: str, updated_by: str) -> dict[str, int]:
    """Write an accepted absence into `dbo.TeacherAvailabilities`. Returns {inserted, updated}.

    ⚠️ THIS IS THE DURABLE HALF NOBODY ELSE CAN GUARANTEE. `schedule_store.set_availability` is
    in-process only and the container scales to zero (`server/rules.py` says so in as many words),
    and the cockpit's own write is explicitly best effort: `PlannerChat.applyAvailability` notes
    that "Fabric SSO resolves only inside the hosted app, so on a laptop the write lands in the
    running plan and not in the database". The backend has a managed identity and no such problem.

    ⚠️ THE ID IS NOT OURS TO CHOOSE. `availability_id` reproduces what the app and the seeder both
    compute, so writing the same cell twice updates one row instead of creating a second. A wrong
    id does not error: it shows the lecturer as both available and not.

    ⚠️ `source = 'intake'`, AND THAT VALUE IS LOAD BEARING IN TWO DIRECTIONS.
      * It is NOT in the seeder's SEEDED_SOURCES ('dataset', 'gpu016',
        'stvp_excel'), so the seeder's MERGE and its PRUNE will never overwrite or delete an
        accepted request. That rail already exists; this value is on the protected side of it.
      * It is not `'ui'` either, which would be a lie: nobody touched the cockpit. This project
        tracks provenance everywhere (`nameProvenance`, `source`, `provenance`) and an accepted
        Copilot request is a distinguishable door.

    ⚠️ IT OVERWRITES A CELL SOMEBODY SET BY HAND, and that is a deliberate choice rather than an
    oversight: a planner ACCEPTED this request, which is exactly the human decision the seeder's
    rail exists to protect. What it must not do is overwrite SILENTLY, so the counts come back and
    the audit event records them.
    """
    if _dev():
        return dev_store.apply_accepted_availability(
            site=site, teacher_id=teacher_id, slot_ids=slot_ids, state=state, updated_by=updated_by)

    inserted = updated = 0
    with _connect() as cx:
        cur = cx.cursor()
        for slot_id in slot_ids:
            row_id = availability_id(site, teacher_id, slot_id)
            # UPDATE first, INSERT only if it matched nothing. Measured on this engine: a
            # conditional UPDATE reports rowcount 1 for exactly one caller (§46 / 2026-08-21).
            cur.execute(
                """UPDATE dbo.TeacherAvailabilities
                   SET state = ?, source = 'intake', note = '', updatedBy = ?,
                       updatedAt = SYSUTCDATETIME()
                   WHERE id = ?""",
                state, updated_by, row_id,
            )
            if cur.rowcount == 1:
                updated += 1
                continue
            try:
                cur.execute(
                    """INSERT INTO dbo.TeacherAvailabilities
                       (id, site, teacherId, slotId, state, source, note, updatedBy, updatedAt)
                       VALUES (?, ?, ?, ?, ?, 'intake', '', ?, SYSUTCDATETIME())""",
                    row_id, site, teacher_id, slot_id, state, updated_by,
                )
                inserted += 1
            except pyodbc_integrity_error():
                # Somebody inserted the same deterministic id between the UPDATE and the INSERT.
                # The row now exists, so the UPDATE that failed a moment ago will succeed.
                cur.execute(
                    """UPDATE dbo.TeacherAvailabilities
                       SET state = ?, source = 'intake', note = '', updatedBy = ?,
                           updatedAt = SYSUTCDATETIME()
                       WHERE id = ?""",
                    state, updated_by, row_id,
                )
                updated += 1
        cx.commit()
    return {"inserted": inserted, "updated": updated}


def pyodbc_integrity_error():
    """pyodbc's IntegrityError, imported lazily so this module still loads without the driver."""
    import pyodbc

    return pyodbc.IntegrityError


def record_application(request_id: str, *, applied_rows: int | None,
                       failure_reason: str | None, actor_upn: str, actor_role: str) -> None:
    """Note what the acceptance actually did. Separate call, and separate on purpose.

    ⚠️ `decide` IS CONDITIONAL ON `status = 'pending'` and that guard must not be weakened, so it
    cannot also carry the result of work that happens after it wins. Doing the write first and
    deciding afterwards would be worse: a caller who then LOST the race would already have changed
    a lecturer's availability for a request somebody else rejected.

    So: claim, act, then record. A crash between the second and third steps leaves a request that
    says accepted with `appliedRows` NULL, which is visibly incomplete rather than quietly wrong.
    """
    if _dev():
        return dev_store.record_application(
            request_id, applied_rows=applied_rows, failure_reason=failure_reason,
            actor_upn=actor_upn, actor_role=actor_role)
    with _connect() as cx:
        cur = cx.cursor()
        cur.execute(
            """UPDATE dbo.IntakeRequest
               SET appliedRows = ?, failureReason = ?,
                   status = CASE WHEN ? IS NULL THEN status ELSE 'failed' END
               WHERE requestId = ?""",
            applied_rows, failure_reason, failure_reason, request_id,
        )
        _append_event(cur, request_id, actor_upn, actor_role,
                      "failed" if failure_reason else "applied",
                      failure_reason or f"{applied_rows} Zeile(n)")
        cx.commit()


def normalise_guid(value: Any) -> str | None:
    """One spelling for an id, whichever side of the wire it came from.

    ⚠️ SQL Server hands back a `uniqueidentifier` in UPPERCASE, and Python's `uuid4()` string is
    lowercase. So the same request had two spellings depending on which call you got it from:
    `submit` answered `0df6e09f-...` and `listMyIntakeRequests` answered `0DF6E09F-...` for that
    one row. The database does not care, because `uniqueidentifier` comparisons are not string
    comparisons; every consumer that does care is a client, and an agent comparing the id it was
    just given against the id in the list would conclude they are different requests.

    ⚠️ It also meant the dev store and SQL DISAGREED ON THE FORMAT OF AN IDENTIFIER, so a test
    that passed against JSON was asserting a spelling production never produces. Found by
    `tools/tests/live_retry_lookup.py`, which is the first thing that ever compared an id written
    by Python against the same id read back out of Fabric SQL.

    ⚠️ PUBLIC because it has a second caller. `tools/fabric_intake/intake_cli.py` runs its own
    SQL and printed the raw uppercase id, so the only tool a planner has displayed a different
    string from the one the API returns for the same request. Two spellings of one identifier is
    a support ticket waiting to happen, and a second private copy of this rule would be worse.
    """
    return str(value).lower() if value is not None else None


def request_for_preview(preview_id: str, *, owner_oid: str) -> dict[str, Any] | None:
    """The request this person already filed from this preview, if there is one.

    ⚠️ EXISTS SO A RETRY CAN BE TOLD APART FROM A REFUSAL. `submit` answers 409 for five
    different reasons, one of which is "you already did this successfully". An agent that retries
    after a network timeout gets that 409 and reports failure, so the user files the same absence
    again through a fresh preview and the planner sees it twice. The duplicate the 409 was written
    to prevent arrives anyway, by the front door.

    ⚠️ KEYED ON THE OWNER, and that is not decoration. Without the `submittedByOid` predicate this
    turns a preview id into a lookup for somebody else's request id, from an endpoint any
    authenticated user can reach.
    """
    if _dev():
        return dev_store.request_for_preview(preview_id, owner_oid=owner_oid)
    with _connect() as cx:
        row = cx.cursor().execute(
            """SELECT TOP (1) requestId, status, createdAt
                 FROM dbo.IntakeRequest
                WHERE previewId = ? AND submittedByOid = ?
                ORDER BY createdAt DESC""",
            preview_id, owner_oid,
        ).fetchone()
    if not row:
        return None
    return {"requestId": normalise_guid(row[0]), "status": row[1],
            "createdAt": row[2].isoformat() if hasattr(row[2], "isoformat") else row[2]}


def identity_sites(oid: str) -> list[dict[str, Any]]:
    """Every site this principal is mapped to, so a caller need not already know their own.

    ⚠️ WITHOUT THIS, EIGHT OF THE NINE UNIVERSITIES ARE UNREACHABLE. `_site(None)` falls back to
    the container's own default site, so a professor anywhere else was answered "this account is
    not mapped to a person at this site" - a 403 that is technically true and completely
    unactionable. The agent cannot work around it either: `getMyIdentity` needs a site to resolve
    an identity, and the identity is the only thing that knows the site.

    ⚠️ ONE QUERY, NOT ONE PER SITE. The obvious implementation loops `resolve_identity` over
    `known_sites()`, which is nine round trips on every single call, on an endpoint the agent hits
    first in every conversation.

    Returns every match rather than picking one. A person really can teach at two campuses, and
    choosing for them is the same mistake as auto-resolving a near-miss teacher name: the answer
    would be real data about the wrong place, with nothing on screen to reveal it.
    """
    if _dev():
        return dev_store.identity_sites(oid)
    with _connect() as cx:
        rows = cx.cursor().execute(
            """SELECT site, teacherId, role, provenance, isPrimary FROM dbo.IntakeIdentity
                WHERE oid = ? ORDER BY site""",
            oid,
        ).fetchall()
    return [{"site": r[0], "teacherId": r[1], "role": r[2], "provenance": r[3],
             "isPrimary": bool(r[4])} for r in rows]


def list_queue(site: str, *, status: str = "pending", limit: int = 200) -> list[dict[str, Any]]:
    """The planning office's inbox. Read only; deciding is a separate call."""
    if _dev():
        return dev_store.list_queue(site, status=status, limit=limit)
    with _connect() as cx:
        rows = cx.cursor().execute(
            """SELECT TOP (?) requestId, kind, status, submittedByOid, submittedByUpn,
                      submittedByName, teacherId, payload, impactSessions, impactMoves,
                      impactFeasible, planVersion, createdAt
               FROM dbo.IntakeRequest
               WHERE site = ? AND status = ?
               ORDER BY createdAt DESC""",
            limit, site, status,
        ).fetchall()
    out = []
    for r in rows:
        out.append({
            # ⚠️ Normalised, so this agrees with the id `submit` handed the caller. See
            # `normalise_guid`.
            "requestId": normalise_guid(r[0]), "kind": r[1], "status": r[2],
            "submittedByOid": r[3], "submittedByUpn": r[4], "submittedByName": r[5],
            "teacherId": r[6],
            "payload": json.loads(r[7]) if r[7] else {},
            # ⚠️ Labelled as captured-at-submit, per §41.7 property 2. The panel MUST show it as
            # historical, or a three-week-old "4 Termine" reads as current.
            "impactAtSubmit": {"sessions": r[8], "moves": r[9],
                               "feasible": bool(r[10]) if r[10] is not None else None},
            "planVersionAtSubmit": r[11],
            "createdAt": r[12].isoformat() if r[12] else None,
        })
    return out


def decide(
    request_id: str,
    *,
    decided_by_upn: str,
    decided_by_role: str,
    accept: bool,
    note: str | None,
    applied_rows: int | None = None,
    failure_reason: str | None = None,
) -> bool:
    """Record a planner's decision. Returns False if the request was not open for decision.

    ⚠️ CONDITIONAL, so two planners deciding at once cannot both win. The second one gets False
    and the UI says so, rather than the first decision being silently overwritten.

    ⚠️ THE CONDITION IS `pending` OR `failed`, AND THAT IS NOT A WEAKENING OF THE GUARD. It used
    to be `pending` alone, which stranded every request whose availability write did not land:
    `decide` marks the row decided and applies the rows afterwards, so a paused capacity or a
    dropped connection mid-apply leaves `failed`, out of the pending queue and refused by
    `decide`. The professor's absence was then unreachable and the only route back was asking them
    to file the whole thing again.

    The guard's actual invariant is "exactly one decision transition wins per round", and a
    conditional UPDATE over two open states preserves it exactly as well as over one: concurrent
    retries still produce a single rowcount of 1. What changes is only which states count as
    still-open. `accepted` and `rejected` remain settled and are still refused.

    Retrying is safe to offer because `apply_accepted_availability` converges: it does
    UPDATE-then-INSERT per slot, and a second live run measured `{"inserted": 0, "updated": 4}`.
    """
    if _dev():
        return dev_store.decide(
            request_id, decided_by_upn=decided_by_upn, decided_by_role=decided_by_role,
            accept=accept, note=note, applied_rows=applied_rows, failure_reason=failure_reason,
        )
    status = "accepted" if accept else "rejected"
    with _connect() as cx:
        cur = cx.cursor()
        cur.execute(
            """UPDATE dbo.IntakeRequest
               SET status = ?, decidedByUpn = ?, decidedAt = ?, decisionNote = ?,
                   appliedRows = ?, failureReason = ?
               WHERE requestId = ? AND status IN ('pending', 'failed')""",
            status, decided_by_upn, _now(), note, applied_rows, failure_reason, request_id,
        )
        if cur.rowcount != 1:
            cx.rollback()
            return False
        _append_event(cur, request_id, decided_by_upn, decided_by_role, status, note)
        cx.commit()
    return True


def warehouse_status() -> dict[str, Any]:
    """For `/api/health`. Booleans only, per §44.4 row 9.

    ⚠️ `backend` IS REPORTED. It is not a secret, and "why did my request vanish" has exactly one
    common answer: it went into a dev JSON file on a container that has since been replaced.
    """
    return {
        "configured": intake_enabled(),
        "backend": "dev-file" if dev_store.dev_enabled() else ("fabric" if INTAKE_ODBC else "none"),
    }


__all__ = [
    "intake_enabled", "resolve_identity", "save_preview", "take_preview",
    "insert_request", "list_queue", "decide", "warehouse_status",
]
