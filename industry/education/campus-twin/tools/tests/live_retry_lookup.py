"""Does `request_for_preview` actually run on the real engine?

⚠️ The dev store cannot fail the way SQL fails. A wrong column name, `TOP (1)` in the wrong place
or a type the driver refuses are all invisible in JSON and fatal in Fabric SQL, and this query was
written straight into the 409 path where a failure becomes a 500 for a user who is only retrying.

Opt-in and live: needs FABRIC_SQL_SERVER, FABRIC_SQL_DATABASE and an Azure login. Writes only
synthetic ids, records row counts before and after, and cleans up BY EXACT ID in a `finally`,
children before parents.
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
import struct
import subprocess
import sys
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


def _token_connect():
    """Same access-token attachment the other live scripts use."""
    tok = subprocess.run(
        [AZ, "account", "get-access-token", "--resource", "https://database.windows.net/",
         "--query", "accessToken", "-o", "tsv"],
        capture_output=True, text=True, check=True).stdout.strip()
    raw = tok.encode("utf-16-le")
    return pyodbc.connect(os.environ["CAMPUS_INTAKE_ODBC"], timeout=90,
                          attrs_before={1256: struct.pack("<i", len(raw)) + raw})


intake_store._connect = _token_connect

FAILURES: list[str] = []
SITE = "oth"
PREVIEW_ID = str(uuid.uuid4())
REQUEST_ID = str(uuid.uuid4())
OWNER = f"live-retry-{uuid.uuid4().hex[:8]}"
OTHER = f"live-other-{uuid.uuid4().hex[:8]}"


def check(name: str, condition: bool, detail: object = "") -> None:
    print(f"  {'ok ' if condition else 'FAIL'} {name}" + (f"  [{detail}]" if detail else ""))
    if not condition:
        FAILURES.append(name)


def count(cx, table: str) -> int:
    return cx.cursor().execute(f"SELECT COUNT(*) FROM dbo.{table}").fetchone()[0]


def main() -> int:
    print(f"server:   {fabric_ids.sql_server().split('.')[0]}...")
    print(f"preview:  {PREVIEW_ID}")
    print(f"request:  {REQUEST_ID}\n")

    with intake_store._connect() as cx:
        before = count(cx, "IntakeRequest")
        print(f"IntakeRequest rows before: {before}\n")

    try:
        # [1] The query must survive a miss. This alone proves the SQL parses and the columns exist.
        missing = intake_store.request_for_preview(str(uuid.uuid4()), owner_oid=OWNER)
        check("the query runs and a miss returns None", missing is None, missing)

        # [2] Insert one synthetic request row so there is something to find.
        with intake_store._connect() as cx:
            cur = cx.cursor()
            cur.execute(
                """INSERT INTO dbo.IntakeRequest
                     (requestId, site, kind, status, submittedByOid, submittedByUpn,
                      submittedByName, teacherId, payload, previewId, sourceChannel,
                      correlationId, impactSessions, impactMoves, impactFeasible, planVersion)
                   VALUES (?, ?, 'availability', 'pending', ?, ?, ?, ?, '{}', ?, 'api',
                           NULL, 1, 1, 1, '1')""",
                REQUEST_ID, SITE, OWNER, f"{OWNER}@x.invalid", "Live Retry Probe",
                "LIVE-T001", PREVIEW_ID,
            )
            cx.commit()
        print("  inserted one synthetic request\n")

        # [3] The owner finds it.
        found = intake_store.request_for_preview(PREVIEW_ID, owner_oid=OWNER)
        check("the owner's retry finds the existing request", bool(found), found)
        check("it returns the right requestId",
              (found or {}).get("requestId") == REQUEST_ID, (found or {}).get("requestId"))
        check("it returns the status", (found or {}).get("status") == "pending",
              (found or {}).get("status"))
        # ⚠️ createdAt comes back as a datetime from the driver and is serialised into an HTTP
        # body, so it has to be something json can encode.
        import json
        try:
            json.dumps(found)
            encodable = True
        except TypeError as exc:
            encodable = False
            print(f"       {exc}")
        check("the result is JSON-serialisable, since it goes into a 409 body", encodable, found)

        # [4] ⚠️ The owner predicate, against the real query rather than a fake that honours it.
        stolen = intake_store.request_for_preview(PREVIEW_ID, owner_oid=OTHER)
        check("⚠️ a different oid finds NOTHING with the same preview id",
              stolen is None, stolen)

    finally:
        with intake_store._connect() as cx:
            cx.cursor().execute("DELETE FROM dbo.IntakeRequest WHERE requestId = ?", REQUEST_ID)
            cx.commit()
            after = count(cx, "IntakeRequest")
        print(f"\nIntakeRequest rows after cleanup: {after}")
        if after != before:
            print(f"⚠️ ROW COUNT DID NOT RETURN TO {before}")
            FAILURES.append("cleanup left rows behind")

    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {FAILURES}")
        return 1
    print("OK - the retry lookup works on the real engine and stays scoped to its owner")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
