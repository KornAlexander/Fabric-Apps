"""Does `apply_accepted_availability` actually work against the real table? Live test.

    $env:FABRIC_SQL_SERVER   = "<host>,1433"
    $env:FABRIC_SQL_DATABASE = "<database name>"
    python tools\\tests\\live_apply_availability.py

⚠️ NOT PART OF THE OFFLINE SUITE. `live_*`, not `test_*`, and run deliberately.

It exists because `test_intake_e2e.py` proves the CONTRACT and not the SQL. Everything it exercises
goes through `dev_store`, so the INSERT and UPDATE text in `intake_store.py` has never run: a wrong
column name, a NOT NULL nobody filled, or a broken token handshake would all pass every offline
suite and fail on the first real acceptance.

⚠️ IT WRITES INTO A TABLE WITH THOUSANDS OF REAL ROWS, so every safeguard here is deliberate:

  * one synthetic teacher id, `ZZ-INTAKE-PROBE`, asserted ABSENT before anything is written,
  * the total row count is recorded before and compared after,
  * cleanup deletes BY THE THREE EXACT IDS it created, never by teacher, site or a LIKE,
  * the delete runs in `finally`, so a failed assertion still cleans up.

It also exercises the real `_connect()` and `_token_struct()`, which is the other half nobody has
tested: the UTF-16-LE length-prefixed token blob is the kind of thing that fails with a generic
login error and sends you looking at firewalls.
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
from pathlib import Path

import pyodbc

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "fabric"))
sys.path.insert(0, str(ROOT / "server"))

import fabric_ids  # noqa: E402

AZ = r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
PROBE_TEACHER = "ZZ-INTAKE-PROBE"
PROBE_SITE = "oth"
PROBE_SLOTS = ["Fr-1", "Fr-2", "Fr-3"]

# ⚠️ BEFORE importing intake_store: it reads its connection string at import time, and
# `dev_store` must be off or the SQL path is not the thing under test.
os.environ.pop("CAMPUS_INTAKE_DEV_STORE", None)
os.environ["CAMPUS_INTAKE_ODBC"] = (
    f"Driver={{ODBC Driver 18 for SQL Server}};Server={fabric_ids.sql_server()};"
    f"Database={fabric_ids.sql_database()};Encrypt=yes;TrustServerCertificate=no"
)

import intake_store  # noqa: E402
from availability_id import availability_id  # noqa: E402

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name} {detail}")
        FAILURES.append(name)


def admin_connect():
    tok = subprocess.run(
        [AZ, "account", "get-access-token", "--resource", "https://database.windows.net/",
         "--query", "accessToken", "-o", "tsv"],
        capture_output=True, text=True, check=True).stdout.strip()
    raw = tok.encode("utf-16-le")
    st = struct.pack("<i", len(raw)) + raw
    return pyodbc.connect(os.environ["CAMPUS_INTAKE_ODBC"], timeout=90, attrs_before={1256: st})


def main() -> int:
    ids = [availability_id(PROBE_SITE, PROBE_TEACHER, s) for s in PROBE_SLOTS]
    placeholders = ",".join("?" for _ in ids)

    cx = admin_connect()
    cur = cx.cursor()
    print("connected as", cur.execute("SELECT SUSER_SNAME()").fetchone()[0])

    total_before = cur.execute("SELECT COUNT(*) FROM dbo.TeacherAvailabilities").fetchone()[0]
    print(f"dbo.TeacherAvailabilities holds {total_before} rows before this test")

    print("\n[1] ⚠️ the probe teacher does not exist, so nothing real can be touched")
    existing = cur.execute(
        "SELECT COUNT(*) FROM dbo.TeacherAvailabilities WHERE teacherId = ?", PROBE_TEACHER
    ).fetchone()[0]
    check("no rows for the probe teacher", existing == 0, existing)
    clash = cur.execute(
        f"SELECT COUNT(*) FROM dbo.TeacherAvailabilities WHERE id IN ({placeholders})", *ids
    ).fetchone()[0]
    check("none of the three ids is already in use", clash == 0, clash)

    try:
        print("\n[2] the REAL SQL path, including the managed-identity token")
        first = intake_store.apply_accepted_availability(
            site=PROBE_SITE, teacher_id=PROBE_TEACHER, slot_ids=PROBE_SLOTS,
            state="nicht_verfuegbar", updated_by="live-test@localhost.invalid",
        )
        check("three rows inserted, none updated", first == {"inserted": 3, "updated": 0}, first)

        print("\n[3] what actually landed in the table")
        rows = cur.execute(
            f"""SELECT id, site, teacherId, slotId, state, source, note, updatedBy, updatedAt
                FROM dbo.TeacherAvailabilities WHERE id IN ({placeholders}) ORDER BY slotId""",
            *ids,
        ).fetchall()
        check("all three rows are there", len(rows) == 3, len(rows))
        if len(rows) == 3:
            check("the ids are the deterministic ones",
                  sorted(r[0].lower() for r in rows) == sorted(i.lower() for i in ids))
            check("site and teacher are right",
                  all(r[1] == PROBE_SITE and r[2] == PROBE_TEACHER for r in rows))
            check("slots are the three asked for",
                  sorted(r[3] for r in rows) == sorted(PROBE_SLOTS), [r[3] for r in rows])
            check("state is nicht_verfuegbar", all(r[4] == "nicht_verfuegbar" for r in rows))
            # ⚠️ Outside SEEDED_SOURCES, so the seeder can never overwrite or prune it.
            check("source is 'intake'", all(r[5] == "intake" for r in rows), {r[5] for r in rows})
            check("⚠️ note is empty, since no free text exists anywhere in this path",
                  all(r[6] == "" for r in rows), {r[6] for r in rows})
            check("updatedBy is the deciding planner", all(r[7] == "live-test@localhost.invalid" for r in rows))
            check("updatedAt was filled by the server", all(r[8] is not None for r in rows))

        print("\n[4] applying the same acceptance again UPDATES, it does not duplicate")
        second = intake_store.apply_accepted_availability(
            site=PROBE_SITE, teacher_id=PROBE_TEACHER, slot_ids=PROBE_SLOTS,
            state="eingeschraenkt", updated_by="live-test-2@localhost.invalid",
        )
        check("nothing inserted, three updated", second == {"inserted": 0, "updated": 3}, second)
        after = cur.execute(
            f"SELECT COUNT(*), MIN(state), MIN(updatedBy) FROM dbo.TeacherAvailabilities "
            f"WHERE id IN ({placeholders})", *ids,
        ).fetchone()
        check("still exactly three rows", after[0] == 3, after[0])
        check("the state was changed in place", after[1] == "eingeschraenkt", after[1])
        check("the new decider is recorded", after[2] == "live-test-2@localhost.invalid", after[2])

        print("\n[5] a partial slot list only touches its own rows")
        third = intake_store.apply_accepted_availability(
            site=PROBE_SITE, teacher_id=PROBE_TEACHER, slot_ids=[PROBE_SLOTS[0]],
            state="nicht_verfuegbar", updated_by="live-test-3@localhost.invalid",
        )
        check("one row updated", third == {"inserted": 0, "updated": 1}, third)
        states = dict(cur.execute(
            f"SELECT slotId, state FROM dbo.TeacherAvailabilities WHERE id IN ({placeholders})",
            *ids).fetchall())
        check("only the named slot changed",
              states[PROBE_SLOTS[0]] == "nicht_verfuegbar"
              and states[PROBE_SLOTS[1]] == "eingeschraenkt", states)

    finally:
        print("\n[6] cleanup, by exact id")
        cur.execute(
            f"DELETE FROM dbo.TeacherAvailabilities WHERE id IN ({placeholders})", *ids)
        deleted = cur.rowcount
        cx.commit()
        print(f"        deleted {deleted} probe row(s)")
        left = cur.execute(
            "SELECT COUNT(*) FROM dbo.TeacherAvailabilities WHERE teacherId = ?", PROBE_TEACHER
        ).fetchone()[0]
        total_after = cur.execute("SELECT COUNT(*) FROM dbo.TeacherAvailabilities").fetchone()[0]
        check("no probe rows remain", left == 0, left)
        check("⚠️ the table is exactly the size it was before",
              total_after == total_before, f"{total_before} -> {total_after}")
        cx.close()

    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {', '.join(FAILURES)}")
        return 1
    print("the intake path writes real availability rows correctly, and cleans up after itself")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
