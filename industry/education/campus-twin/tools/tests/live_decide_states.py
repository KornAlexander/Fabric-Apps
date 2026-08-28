"""Does the widened decide condition still give mutual exclusion on the real engine?

⚠️ `decide` used to be conditional on `status = 'pending'`. It is now `IN ('pending', 'failed')`,
so a request whose availability write did not land can be finished instead of being stranded
forever. That is a change to a concurrency guard, and "an IN clause is obviously as atomic as an
equality" is precisely the sort of reasoning this project keeps finding to be untested rather than
wrong.

`live_conditional_update.py` proves the pattern on a throwaway probe table. This proves the real
`intake_store.decide`, on the real `dbo.IntakeRequest`, under RCSI, for both open states:

  1. many planners deciding a `pending` request at once -> exactly one wins
  2. many planners retrying a `failed` request at once  -> exactly one wins
  3. a settled request (`accepted`) -> nobody wins, so widening did not reopen it

Synthetic ids only, row counts before and after, cleanup by exact id in `finally`.
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
from concurrent.futures import ThreadPoolExecutor
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
THREADS = 8
FAILURES: list[str] = []


def _token() -> bytes:
    tok = subprocess.run(
        [AZ, "account", "get-access-token", "--resource", "https://database.windows.net/",
         "--query", "accessToken", "-o", "tsv"],
        capture_output=True, text=True, check=True).stdout.strip()
    raw = tok.encode("utf-16-le")
    return struct.pack("<i", len(raw)) + raw


TOKEN = _token()
intake_store._connect = lambda: pyodbc.connect(
    os.environ["CAMPUS_INTAKE_ODBC"], timeout=90, attrs_before={1256: TOKEN})


def check(name: str, condition: bool, detail: object = "") -> None:
    print(f"  {'ok ' if condition else 'FAIL'} {name}" + (f"  [{detail}]" if detail else ""))
    if not condition:
        FAILURES.append(name)


def insert(request_id: str, status: str) -> None:
    with intake_store._connect() as cx:
        cx.cursor().execute(
            """INSERT INTO dbo.IntakeRequest
                 (requestId, site, kind, status, submittedByOid, submittedByUpn,
                  submittedByName, teacherId, payload, sourceChannel,
                  impactSessions, impactMoves, impactFeasible, planVersion)
               VALUES (?, ?, 'availability', ?, 'zz-states-probe', 'zz@x.invalid',
                       'States Probe', 'ZZ-T1', '{}', 'api', 1, 1, 1, '1')""",
            request_id, SITE, status)
        cx.commit()


def race(request_id: str) -> int:
    """How many of THREADS concurrent decisions reported that they won."""
    def one(n: int) -> bool:
        return intake_store.decide(
            request_id, decided_by_upn=f"p{n}@x.invalid", decided_by_role="planner",
            accept=False, note=None)

    with ThreadPoolExecutor(max_workers=THREADS) as pool:
        return sum(1 for won in pool.map(one, range(THREADS)) if won)


def status_of(request_id: str) -> str | None:
    with intake_store._connect() as cx:
        row = cx.cursor().execute(
            "SELECT status FROM dbo.IntakeRequest WHERE requestId = ?", request_id).fetchone()
    return row[0] if row else None


def main() -> int:
    ids = {state: str(uuid.uuid4()) for state in ("pending", "failed", "accepted")}
    with intake_store._connect() as cx:
        before = cx.cursor().execute("SELECT COUNT(*) FROM dbo.IntakeRequest").fetchone()[0]
    print(f"IntakeRequest rows before: {before}")
    print(f"threads per race: {THREADS}\n")

    try:
        for state, request_id in ids.items():
            insert(request_id, state)
        print("inserted one synthetic request in each state\n")

        winners = race(ids["pending"])
        check("a pending request: exactly one decision wins", winners == 1, winners)
        check("and it is settled afterwards", status_of(ids["pending"]) == "rejected",
              status_of(ids["pending"]))

        winners = race(ids["failed"])
        check("⚠️ a FAILED request: exactly one retry wins", winners == 1, winners)
        check("and it is settled afterwards", status_of(ids["failed"]) == "rejected",
              status_of(ids["failed"]))

        winners = race(ids["accepted"])
        check("⚠️ a settled request: NOBODY wins, widening did not reopen it",
              winners == 0, winners)
        check("and it is untouched", status_of(ids["accepted"]) == "accepted",
              status_of(ids["accepted"]))

    finally:
        with intake_store._connect() as cx:
            cur = cx.cursor()
            for request_id in ids.values():
                cur.execute("DELETE FROM dbo.IntakeEvent WHERE requestId = ?", request_id)
                cur.execute("DELETE FROM dbo.IntakeRequest WHERE requestId = ?", request_id)
            cx.commit()
            after = cur.execute("SELECT COUNT(*) FROM dbo.IntakeRequest").fetchone()[0]
        print(f"\nIntakeRequest rows after cleanup: {after}")
        if after != before:
            print(f"⚠️ ROW COUNT DID NOT RETURN TO {before}")
            FAILURES.append("cleanup left rows behind")

    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {FAILURES}")
        return 1
    print("OK - widening the condition to two open states kept mutual exclusion, and a settled "
          "request is still closed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
