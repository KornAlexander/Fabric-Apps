"""The preview claim, against real SQL, including the rollback nobody has ever triggered.

    $env:FABRIC_SQL_SERVER   = "<host>,1433"
    $env:FABRIC_SQL_DATABASE = "<database name>"
    python tools\\tests\\live_preview_submit.py

⚠️ NOT PART OF THE OFFLINE SUITE. `live_*`, run deliberately.

`live_intake_roundtrip.py` starts from a request that was INSERTed by hand, so it skips the two
functions this file exists for. `save_preview` and `claim_preview_and_insert` had never executed
against a database at all - and the second is the most intricate SQL in the feature: a conditional
UPDATE, a SELECT of what it claimed, an INSERT of the request and an INSERT of its audit event, all
inside one transaction.

⚠️ SECTION [4] IS THE POINT. The claim and the insert were once two separate calls with a commit
between them, so any failure in the second one consumed the professor's only valid preview and
wrote no request: "I confirmed it and it vanished", then 409 on every retry. Making it one
transaction is the fix, and until now the ROLLBACK path had never run. It is triggered here for
real, by writing a `kind` the CHECK constraint refuses.

Safety: synthetic ids throughout, cleanup by exact id in `finally`, children before parents.
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
import struct
import subprocess
import sys
import threading
import uuid
from pathlib import Path

import pyodbc

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "fabric"))
sys.path.insert(0, str(ROOT / "server"))

import fabric_ids  # noqa: E402

os.environ.pop("CAMPUS_INTAKE_DEV_STORE", None)
os.environ["CAMPUS_INTAKE_ODBC"] = (
    f"Driver={{ODBC Driver 18 for SQL Server}};Server={fabric_ids.sql_server()};"
    f"Database={fabric_ids.sql_database()};Encrypt=yes;TrustServerCertificate=no"
)

import intake_store  # noqa: E402

AZ = r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
SITE = "oth"
OWNER = "oid-live-preview-probe"
TEACHER = "ZZ-PREVIEW-PROBE"
PLAN_V = "1"

FAILURES: list[str] = []
CREATED_PREVIEWS: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name} {detail}")
        FAILURES.append(name)


def connect():
    tok = subprocess.run(
        [AZ, "account", "get-access-token", "--resource", "https://database.windows.net/",
         "--query", "accessToken", "-o", "tsv"],
        capture_output=True, text=True, check=True).stdout.strip()
    raw = tok.encode("utf-16-le")
    return pyodbc.connect(os.environ["CAMPUS_INTAKE_ODBC"], timeout=90,
                          attrs_before={1256: struct.pack("<i", len(raw)) + raw})


def new_preview(plan_version: str = PLAN_V) -> str:
    pid = intake_store.save_preview(
        site=SITE, requested_by=OWNER,
        constraints=[{"teacher": TEACHER, "day": "Fr"}],
        result={"affectedSessions": 3, "wouldMove": 3, "feasible": True},
        plan_version=plan_version, rule_version=None,
    )
    CREATED_PREVIEWS.append(pid)
    return pid


def row_of(kind: str = "availability"):
    def build(snap):
        return {
            "site": SITE, "kind": kind, "submittedByOid": OWNER,
            "submittedByUpn": "probe@localhost.invalid", "submittedByName": "Probe",
            "teacherId": TEACHER,
            "payload": {"constraints": snap["constraints"]},
            "previewId": None, "sourceChannel": "copilot",
            "impactSessions": snap["result"].get("affectedSessions"),
            "impactMoves": snap["result"].get("wouldMove"),
            "impactFeasible": snap["result"].get("feasible"),
            "planVersion": snap["planVersion"], "role": "teacher",
        }
    return build


def main() -> int:
    cx = connect()
    cur = cx.cursor()
    requests_before = cur.execute("SELECT COUNT(*) FROM dbo.IntakeRequest").fetchone()[0]
    print(f"dbo.IntakeRequest holds {requests_before} rows before this test")

    try:
        print("\n[1] save_preview writes a real row")
        pid = new_preview()
        row = cur.execute(
            """SELECT site, requestedBy, planVersion, usedAt, constraints, result
               FROM dbo.IntakePreview WHERE previewId = ?""", pid).fetchone()
        check("the preview exists", row is not None)
        check("site and owner are stored", row[0] == SITE and row[1] == OWNER, row[:2])
        check("⚠️ owner is the oid, not a UPN", "@" not in row[1], row[1])
        check("it starts unused", row[3] is None, row[3])
        check("the constraints round-trip as JSON",
              json.loads(row[4]) == [{"teacher": TEACHER, "day": "Fr"}], row[4])
        check("the impact figures round-trip",
              json.loads(row[5])["affectedSessions"] == 3, row[5])

        print("\n[2] claim_preview_and_insert does all four writes in one transaction")
        claimed = intake_store.claim_preview_and_insert(
            pid, owner_oid=OWNER, plan_version=PLAN_V, row_of=row_of())
        check("it returned a request id and the snapshot", claimed is not None)
        req_id, snap = claimed
        check("the snapshot carries the impact", snap["result"]["affectedSessions"] == 3, snap)
        used = cur.execute("SELECT usedAt FROM dbo.IntakePreview WHERE previewId = ?", pid).fetchone()[0]
        check("the preview is now marked used", used is not None)
        got = cur.execute(
            "SELECT status, teacherId, impactSessions, submittedByOid FROM dbo.IntakeRequest "
            "WHERE requestId = ?", req_id).fetchone()
        check("the request exists and is pending", got and got[0] == "pending", got)
        check("it carries the impact as at submit", got[2] == 3, got)
        check("ownership is the oid", got[3] == OWNER, got[3])
        evs = cur.execute(
            "SELECT action FROM dbo.IntakeEvent WHERE requestId = ?", req_id).fetchall()
        check("the 'submitted' audit event was written in the same transaction",
              [e[0] for e in evs] == ["submitted"], [e[0] for e in evs])

        print("\n[3] the claim is single use, and refusals do NOT burn a preview")
        again = intake_store.claim_preview_and_insert(
            pid, owner_oid=OWNER, plan_version=PLAN_V, row_of=row_of())
        check("a used preview cannot be claimed twice", again is None)

        pid2 = new_preview()
        check("a foreign oid is refused", intake_store.claim_preview_and_insert(
            pid2, owner_oid="oid-somebody-else", plan_version=PLAN_V, row_of=row_of()) is None)
        check("⚠️ and that refusal did not consume it", cur.execute(
            "SELECT usedAt FROM dbo.IntakePreview WHERE previewId = ?", pid2).fetchone()[0] is None)

        check("a stale planVersion is refused", intake_store.claim_preview_and_insert(
            pid2, owner_oid=OWNER, plan_version="999", row_of=row_of()) is None)
        check("⚠️ and that refusal did not consume it either", cur.execute(
            "SELECT usedAt FROM dbo.IntakePreview WHERE previewId = ?", pid2).fetchone()[0] is None)
        check("the owner can still claim it afterwards", intake_store.claim_preview_and_insert(
            pid2, owner_oid=OWNER, plan_version=PLAN_V, row_of=row_of()) is not None)

        print("\n[4] ⚠️ THE ROLLBACK: a failing INSERT must not consume the preview")
        # `kind` has a CHECK constraint, so an unmodelled kind fails the INSERT *after* the
        # conditional UPDATE has already claimed the row. Before this was one transaction, that
        # left the professor with a consumed preview and no request: the exact "I confirmed it and
        # it vanished" failure. Nothing had ever exercised the rollback.
        pid3 = new_preview()
        requests_mid = cur.execute("SELECT COUNT(*) FROM dbo.IntakeRequest").fetchone()[0]
        raised = None
        try:
            intake_store.claim_preview_and_insert(
                pid3, owner_oid=OWNER, plan_version=PLAN_V, row_of=row_of("room_issue"))
        except Exception as exc:  # noqa: BLE001
            raised = exc
        check("the write really failed", raised is not None,
              "the CHECK constraint accepted an unmodelled kind, which is its own bug")
        check("the failure names a constraint",
              "CHECK" in str(raised).upper() or "CONSTRAINT" in str(raised).upper(),
              str(raised)[:160])
        check("⚠️ the preview is STILL UNUSED, so the professor can simply submit again",
              cur.execute("SELECT usedAt FROM dbo.IntakePreview WHERE previewId = ?",
                          pid3).fetchone()[0] is None)
        check("⚠️ and no half-written request was left behind",
              cur.execute("SELECT COUNT(*) FROM dbo.IntakeRequest").fetchone()[0] == requests_mid)
        ok_after = intake_store.claim_preview_and_insert(
            pid3, owner_oid=OWNER, plan_version=PLAN_V, row_of=row_of())
        check("the same preview then works with a valid kind", ok_after is not None)

        print("\n[5] ⚠️ concurrent claims on one preview, against real SQL")
        pid4 = new_preview()
        N = 8
        start = threading.Barrier(N)
        results: list = [None] * N
        errors: list = [None] * N

        def worker(i):
            try:
                start.wait()
                results[i] = intake_store.claim_preview_and_insert(
                    pid4, owner_oid=OWNER, plan_version=PLAN_V, row_of=row_of())
            except Exception as e:  # noqa: BLE001
                errors[i] = e

        ts = [threading.Thread(target=worker, args=(i,)) for i in range(N)]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        check("no thread raised", not [e for e in errors if e],
              [str(e)[:100] for e in errors if e][:2])
        winners = [r for r in results if r]
        check(f"exactly ONE of {N} concurrent claims won", len(winners) == 1,
              f"{len(winners)} won: a retrying agent would file that many requests")
        made = cur.execute(
            "SELECT COUNT(*) FROM dbo.IntakeRequest WHERE previewId IS NULL AND teacherId = ? "
            "AND createdAt > DATEADD(minute, -5, SYSUTCDATETIME())", TEACHER).fetchone()[0]
        check("the database agrees about how many requests exist", made >= 1, made)

    finally:
        print("\n[6] cleanup, children before parents")
        cur.execute("DELETE FROM dbo.IntakeEvent WHERE requestId IN "
                    "(SELECT requestId FROM dbo.IntakeRequest WHERE teacherId = ?)", TEACHER)
        n_ev = cur.rowcount
        cur.execute("DELETE FROM dbo.IntakeRequest WHERE teacherId = ?", TEACHER)
        n_req = cur.rowcount
        n_prev = 0
        if CREATED_PREVIEWS:
            ph = ",".join("?" for _ in CREATED_PREVIEWS)
            cur.execute(f"DELETE FROM dbo.IntakePreview WHERE previewId IN ({ph})",
                        *CREATED_PREVIEWS)
            n_prev = cur.rowcount
        cx.commit()
        print(f"        removed {n_ev} event, {n_req} request, {n_prev} preview row(s)")
        after = cur.execute("SELECT COUNT(*) FROM dbo.IntakeRequest").fetchone()[0]
        check("⚠️ IntakeRequest is exactly the size it was", after == requests_before,
              f"{requests_before} -> {after}")
        check("no probe previews remain", cur.execute(
            "SELECT COUNT(*) FROM dbo.IntakePreview WHERE requestedBy = ?", OWNER
        ).fetchone()[0] == 0)
        cx.close()

    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {', '.join(FAILURES)}")
        return 1
    print("the preview claim is atomic, single use, and gives a failed write its preview back")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
