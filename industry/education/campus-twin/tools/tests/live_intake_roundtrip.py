"""One request through the whole live system: submitted, decided, applied, audited, removed.

    $env:FABRIC_SQL_SERVER   = "<host>,1433"
    $env:FABRIC_SQL_DATABASE = "<database name>"
    python tools\\tests\\live_intake_roundtrip.py

⚠️ NOT PART OF THE OFFLINE SUITE. `live_*`, run deliberately.

Everything before this tested one layer at a time: the router with a fake store, the store with a
fake driver, the SQL with no router. This runs a request the way an operator would, against the
real database, and checks the thing those layer tests cannot see - that the layers agree.

⚠️ SAFETY, since this writes into tables holding real rows:
  * a synthetic teacher id, asserted absent first,
  * row counts of `dbo.TeacherAvailabilities` recorded before and compared after,
  * cleanup by exact id, children (`IntakeEvent`) before parents, in `finally`,
  * a real FK now exists, so a failure to clean up the events would be visible immediately.
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
import uuid
from pathlib import Path

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

import intake_cli  # noqa: E402
from availability_id import availability_id  # noqa: E402

AZ = r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
SITE = "oth"
TEACHER = "ZZ-ROUNDTRIP-PROBE"
DAY = "Fr"
DECIDER = "roundtrip@localhost.invalid"

FAILURES: list[str] = []


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


class Args:
    def __init__(self, **kw):
        self.__dict__.update(kw)


def main() -> int:
    import schedule_store
    slots = [s["slotId"] for s in schedule_store.store_for(SITE).slots if s.get("day") == DAY]
    ids = [availability_id(SITE, TEACHER, s) for s in slots]
    ph = ",".join("?" for _ in ids)
    request_id = str(uuid.uuid4())

    cx = connect()
    cur = cx.cursor()
    avail_before = cur.execute("SELECT COUNT(*) FROM dbo.TeacherAvailabilities").fetchone()[0]
    print(f"{DAY} has {len(slots)} slots at {SITE}; TeacherAvailabilities holds {avail_before} rows")

    check("the probe teacher has no availability rows",
          cur.execute("SELECT COUNT(*) FROM dbo.TeacherAvailabilities WHERE teacherId = ?",
                      TEACHER).fetchone()[0] == 0)

    try:
        print("\n[1] a professor's request arrives")
        cur.execute(
            """INSERT INTO dbo.IntakeRequest
               (requestId, site, kind, status, submittedByOid, submittedByUpn, submittedByName,
                teacherId, payload, sourceChannel, impactSessions, impactMoves, impactFeasible,
                planVersion)
               VALUES (?, ?, 'availability', 'pending', 'oid-roundtrip',
                       'probe@localhost.invalid', 'Probe', ?, ?, 'copilot', 3, 3, 1, '1')""",
            request_id, SITE, TEACHER,
            json.dumps({"constraints": [{"teacher": TEACHER, "day": DAY}]}),
        )
        cx.commit()
        check("it is pending", cur.execute(
            "SELECT status FROM dbo.IntakeRequest WHERE requestId = ?", request_id
        ).fetchone()[0] == "pending")

        print("\n[2] the planning office sees it")
        rc = intake_cli.cmd_queue(Args(site=SITE, status="pending"))
        check("the queue command succeeds", rc == 0, rc)

        print("\n[3] ⚠️ a whole day is accepted, and the absence is written")
        rc = intake_cli.cmd_decide(Args(request_id=request_id, site=SITE, accept=True,
                                        note="roundtrip", by=DECIDER))
        check("decide succeeded", rc == 0, rc)

        row = cur.execute(
            "SELECT status, appliedRows, decidedByUpn FROM dbo.IntakeRequest WHERE requestId = ?",
            request_id).fetchone()
        check("the request is accepted", row[0] == "accepted", row[0])
        check("it records how many rows it wrote", row[1] == len(slots), f"{row[1]} vs {len(slots)}")
        check("the decider is recorded", row[2] == DECIDER, row[2])

        written = cur.execute(
            f"""SELECT slotId, state, source, note, updatedBy FROM dbo.TeacherAvailabilities
                WHERE id IN ({ph}) ORDER BY slotId""", *ids).fetchall()
        check(f"one availability row per slot of {DAY}", len(written) == len(slots),
              f"{len(written)} vs {len(slots)}")
        check("all nicht_verfuegbar", all(r[1] == "nicht_verfuegbar" for r in written))
        check("source is 'intake', outside SEEDED_SOURCES",
              all(r[2] == "intake" for r in written), {r[2] for r in written})
        check("⚠️ note is empty everywhere", all(r[3] == "" for r in written))
        check("updatedBy is the planner who decided", all(r[4] == DECIDER for r in written))

        print("\n[4] ⚠️ the audit trail, which the first version of the CLI did not write")
        events = cur.execute(
            "SELECT action, actorUpn, actorRole, detail FROM dbo.IntakeEvent "
            "WHERE requestId = ? ORDER BY occurredAt", request_id).fetchall()
        check("both the decision and the application were recorded",
              [e[0] for e in events] == ["accepted", "applied"], [e[0] for e in events])
        check("the actor is the planner", all(e[1] == DECIDER for e in events))
        check("the role is stamped", all(e[2] == "planner" for e in events))
        check("the application says how much it did",
              str(len(slots)) in (events[-1][3] or ""), events[-1][3] if events else None)

        print("\n[5] a second decision is refused, not silently applied")
        rc = intake_cli.cmd_decide(Args(request_id=request_id, site=SITE, accept=False,
                                        note="again", by=DECIDER))
        check("the CLI refuses", rc == 1, rc)
        check("the first decision stands", cur.execute(
            "SELECT status FROM dbo.IntakeRequest WHERE requestId = ?", request_id
        ).fetchone()[0] == "accepted")

    finally:
        print("\n[6] cleanup, children before parents")
        cur.execute(f"DELETE FROM dbo.TeacherAvailabilities WHERE id IN ({ph})", *ids)
        n_avail = cur.rowcount
        cur.execute("DELETE FROM dbo.IntakeEvent WHERE requestId = ?", request_id)
        n_ev = cur.rowcount
        cur.execute("DELETE FROM dbo.IntakeRequest WHERE requestId = ?", request_id)
        n_req = cur.rowcount
        cx.commit()
        print(f"        removed {n_avail} availability, {n_ev} event, {n_req} request row(s)")
        avail_after = cur.execute("SELECT COUNT(*) FROM dbo.TeacherAvailabilities").fetchone()[0]
        check("⚠️ TeacherAvailabilities is exactly the size it was",
              avail_after == avail_before, f"{avail_before} -> {avail_after}")
        check("no probe request remains", cur.execute(
            "SELECT COUNT(*) FROM dbo.IntakeRequest WHERE teacherId = ?", TEACHER
        ).fetchone()[0] == 0)
        cx.close()

    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {', '.join(FAILURES)}")
        return 1
    print("a request goes in, a decision comes out, the absence is written and audited")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
