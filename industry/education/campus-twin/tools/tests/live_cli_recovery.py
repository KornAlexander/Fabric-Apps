"""Drive the operator CLI through a failed-write recovery, against the real database.

⚠️ THE CLI IS THE ONLY TOOL A PLANNER HAS. PLAN §47.2 item 5 says so explicitly: the queue has no
UI, and `intake_cli.py` "exists precisely so this does not block use". So a gap fixed in the API
and not in the CLI is a gap that is still, in practice, total.

Both halves were still broken here two rounds after the API was fixed:

  * `queue` filtered on one status and defaulted to `pending`, so a planner saw exactly the
    requests that did NOT need them and none of the ones that did,
  * `decide` refused anything that was not `pending`, so the request whose availability write had
    not landed was untouchable from the only place a human could reach it.

Opt-in and live. Synthetic ids only, row counts before and after for BOTH tables it touches, and
cleanup by exact id in a `finally`, children before parents.
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

import contextlib
import io
import os
import struct
import subprocess
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace

import pyodbc

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "fabric"))
sys.path.insert(0, str(ROOT / "tools" / "fabric_intake"))
sys.path.insert(0, str(ROOT / "server"))

import fabric_ids  # noqa: E402

os.environ.pop("CAMPUS_INTAKE_DEV_STORE", None)
os.environ["CAMPUS_INTAKE_ODBC"] = (
    f"Driver={{ODBC Driver 18 for SQL Server}};Server={fabric_ids.sql_server()};"
    f"Database={fabric_ids.sql_database()};Encrypt=yes;TrustServerCertificate=no"
)

AZ = r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
SITE = "oth"
REQUEST_ID = str(uuid.uuid4())
# ⚠️ A teacher id no real row uses, so the availability write cannot touch anybody's timetable.
TEACHER = f"ZZ-CLI-{uuid.uuid4().hex[:6].upper()}"
SLOT = "Fr-1"

FAILURES: list[str] = []


def _token() -> bytes:
    tok = subprocess.run(
        [AZ, "account", "get-access-token", "--resource", "https://database.windows.net/",
         "--query", "accessToken", "-o", "tsv"],
        capture_output=True, text=True, check=True).stdout.strip()
    raw = tok.encode("utf-16-le")
    return struct.pack("<i", len(raw)) + raw


TOKEN = _token()


def connect():
    return pyodbc.connect(os.environ["CAMPUS_INTAKE_ODBC"], timeout=90,
                          attrs_before={1256: TOKEN})


import intake_cli  # noqa: E402
import intake_store  # noqa: E402

intake_cli.connect = connect
intake_store._connect = connect


def check(name: str, condition: bool, detail: object = "") -> None:
    print(f"  {'ok ' if condition else 'FAIL'} {name}" + (f"  [{detail}]" if detail else ""))
    if not condition:
        FAILURES.append(name)


def counts() -> tuple[int, int]:
    with connect() as cx:
        cur = cx.cursor()
        a = cur.execute("SELECT COUNT(*) FROM dbo.IntakeRequest").fetchone()[0]
        b = cur.execute("SELECT COUNT(*) FROM dbo.TeacherAvailabilities").fetchone()[0]
    return a, b


def status_of() -> str | None:
    with connect() as cx:
        row = cx.cursor().execute(
            "SELECT status FROM dbo.IntakeRequest WHERE requestId = ?", REQUEST_ID).fetchone()
    return row[0] if row else None


def run_cli(fn, **kw) -> str:
    """Call a CLI command and capture what the planner would actually read."""
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        fn(SimpleNamespace(**kw))
    return buf.getvalue()


def main() -> int:
    before_req, before_avail = counts()
    print(f"rows before: IntakeRequest={before_req} TeacherAvailabilities={before_avail}")
    print(f"request: {REQUEST_ID}\nteacher: {TEACHER}\n")

    try:
        with connect() as cx:
            cx.cursor().execute(
                """INSERT INTO dbo.IntakeRequest
                     (requestId, site, kind, status, submittedByOid, submittedByUpn,
                      submittedByName, teacherId, payload, sourceChannel,
                      impactSessions, impactMoves, impactFeasible, planVersion, failureReason)
                   VALUES (?, ?, 'availability', 'failed', 'zz-cli-probe', 'zz@x.invalid',
                           'CLI Probe', ?, ?, 'api', 1, 1, 1, '1',
                           '[08001] TCP Provider: timeout expired')""",
                REQUEST_ID, SITE, TEACHER,
                '{"constraints": [{"teacher": "%s", "slotId": "%s"}]}' % (TEACHER, SLOT))
            cx.commit()
        print("inserted one request in the 'failed' state\n")

        print("[1] the planner runs the default queue view")
        out = run_cli(intake_cli.cmd_queue, site=SITE, status="pending")
        check("⚠️ it tells them something needs attention",
              "BRAUCHEN AUFMERKSAMKEIT" in out, out.strip().splitlines()[-1:])
        check("and names the request", REQUEST_ID in out)
        check("and says the change did NOT land", "NICHT im Plan gelandet" in out)
        check("and says a retry is safe", "wiederholt" in out and "sicher" in out)
        check("and shows the failure reason", "08001" in out)

        print("\n[2] the planner retries it, from the only tool they have")
        out = run_cli(intake_cli.cmd_decide, site=SITE, request_id=REQUEST_ID,
                      accept=True, by="planner@x.invalid", note=None)
        check("⚠️ the CLI accepts a failed request instead of refusing it",
              "Refusing" not in out, out.strip()[:120])
        check("it says plainly that it is a retry", "Wiederholung" in out, out.strip()[:120])
        check("the request is accepted afterwards", status_of() == "accepted", status_of())

        with connect() as cx:
            applied = cx.cursor().execute(
                "SELECT COUNT(*) FROM dbo.TeacherAvailabilities WHERE teacherId = ?",
                TEACHER).fetchone()[0]
        check("and the availability row really landed this time", applied == 1, applied)

        print("\n[3] a settled request is still refused")
        out = run_cli(intake_cli.cmd_decide, site=SITE, request_id=REQUEST_ID,
                      accept=True, by="planner@x.invalid", note=None)
        check("⚠️ deciding it twice is refused", "Refusing" in out, out.strip()[:120])

        print("\n[4] and the attention banner clears")
        out = run_cli(intake_cli.cmd_queue, site=SITE, status="pending")
        check("nothing needs attention any more", "BRAUCHEN AUFMERKSAMKEIT" not in out)

    finally:
        with connect() as cx:
            cur = cx.cursor()
            cur.execute("DELETE FROM dbo.TeacherAvailabilities WHERE teacherId = ?", TEACHER)
            cur.execute("DELETE FROM dbo.IntakeEvent WHERE requestId = ?", REQUEST_ID)
            cur.execute("DELETE FROM dbo.IntakeRequest WHERE requestId = ?", REQUEST_ID)
            cx.commit()
        after_req, after_avail = counts()
        print(f"\nrows after cleanup: IntakeRequest={after_req} "
              f"TeacherAvailabilities={after_avail}")
        if (after_req, after_avail) != (before_req, before_avail):
            print("⚠️ ROW COUNTS DID NOT RETURN TO THEIR STARTING VALUES")
            FAILURES.append("cleanup left rows behind")

    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {FAILURES}")
        return 1
    print("OK - the only tool a planner has can now see and finish a half-applied request")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
