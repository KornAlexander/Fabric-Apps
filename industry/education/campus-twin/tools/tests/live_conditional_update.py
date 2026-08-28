"""Does a conditional UPDATE plus `rowcount` actually give mutual exclusion HERE? Live test.

    python tools\\tests\\live_conditional_update.py

⚠️ NOT PART OF THE OFFLINE SUITE. It needs the Fabric SQL Database and an Azure login, so it is
named `live_*` rather than `test_*` and is run deliberately. The endpoint comes from
`FABRIC_SQL_SERVER` / `FABRIC_SQL_DATABASE` via `tools/fabric/fabric_ids.py`, never from a literal
here: see that module for why one tenant's coordinates do not belong in a template.

It exists because `warehouse.claim_preview_and_insert` and `warehouse.decide` both stake their
correctness on one line:

    if cur.rowcount != 1: rollback; return None

That is SQL Server locking semantics, ASSUMED rather than measured. `tools/tests/test_warehouse_
schema.py` hardcodes `rowcount = 1`, so it proves the SQL parses, not that the guarantee holds. And
this database has **READ_COMMITTED_SNAPSHOT ON**, which is precisely the configuration where people
expect writers to stop blocking each other.

Two outcomes, both worth knowing:
  * exactly one winner  -> the guarantee is real, and `usedAt IS NULL` / `status = 'pending'`
    genuinely serialise. Duplicate requests and double decisions are impossible.
  * more than one       -> every claim in PLAN §41.17.4 about single-use previews is false against
    this engine, and the design needs a different mechanism.

Creates and DROPS one throwaway table. It touches no project data.
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

import struct
import subprocess
import sys
import threading
from pathlib import Path

import pyodbc

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "fabric"))

import fabric_ids  # noqa: E402

AZ = r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
PROBE = "dbo.zz_intake_concurrency_probe"

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name} {detail}")
        FAILURES.append(name)


def token_struct() -> bytes:
    tok = subprocess.run(
        [AZ, "account", "get-access-token", "--resource", "https://database.windows.net/",
         "--query", "accessToken", "-o", "tsv"],
        capture_output=True, text=True, check=True).stdout.strip()
    raw = tok.encode("utf-16-le")
    return struct.pack("<i", len(raw)) + raw


TOKEN = token_struct()
CS = (f"Driver={{ODBC Driver 18 for SQL Server}};Server={fabric_ids.sql_server()};"
      f"Database={fabric_ids.sql_database()};Encrypt=yes;TrustServerCertificate=no")


def connect():
    # ⚠️ `Connection Timeout=` is an ADO.NET keyword and ODBC rejects it as an invalid attribute,
    # which surfaces as a LOGIN TIMEOUT rather than as a bad-connection-string error. Use pyodbc's
    # own `timeout=`. That cost a confusing round of firewall debugging.
    return pyodbc.connect(CS, timeout=90, attrs_before={1256: TOKEN})


def race(fn, n: int):
    start = threading.Barrier(n)
    out: list = [None] * n
    err: list = [None] * n

    def worker(i):
        try:
            cx = connect()          # ⚠️ a connection EACH: one connection would serialise itself
            try:
                start.wait()
                out[i] = fn(cx, i)
            finally:
                cx.close()
        except Exception as e:      # noqa: BLE001
            err[i] = e

    ts = [threading.Thread(target=worker, args=(i,)) for i in range(n)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    return out, [e for e in err if e]


def main() -> int:
    N = 10
    admin = connect()
    cur = admin.cursor()
    print("connected as", cur.execute("SELECT SUSER_SNAME()").fetchone()[0])
    print("RCSI on     :", cur.execute(
        "SELECT is_read_committed_snapshot_on FROM sys.databases WHERE name=DB_NAME()").fetchone()[0])

    cur.execute(f"IF OBJECT_ID('{PROBE}') IS NOT NULL DROP TABLE {PROBE}")
    cur.execute(f"""CREATE TABLE {PROBE} (
        id       nvarchar(64)  NOT NULL PRIMARY KEY,
        status   nvarchar(16)  NOT NULL,
        usedAt   datetime2     NULL,
        winner   nvarchar(64)  NULL)""")
    admin.commit()
    print(f"created {PROBE}")

    try:
        print(f"\n[1] ⚠️ {N} threads claiming the same row via `WHERE status = 'pending'`")
        cur.execute(f"INSERT INTO {PROBE} (id, status) VALUES ('r1', 'pending')")
        admin.commit()

        def claim(cx, i):
            c = cx.cursor()
            c.execute(f"UPDATE {PROBE} SET status='accepted', winner=? "
                      f"WHERE id='r1' AND status='pending'", f"thread-{i}")
            rc = c.rowcount
            cx.commit()
            return rc

        results, errors = race(claim, N)
        print("   rowcounts returned:", results)
        check("no thread raised", not errors, [str(e)[:120] for e in errors][:2])
        check("no thread saw rowcount -1 (unknown)", all(r != -1 for r in results if r is not None),
              "rowcount is unreliable on this driver/engine, the guard cannot be used")
        winners = [r for r in results if r == 1]
        check(f"⚠️ EXACTLY ONE of {N} conditional updates reported rowcount 1",
              len(winners) == 1, f"{len(winners)} did: mutual exclusion does NOT hold")

        row = cur.execute(f"SELECT status, winner FROM {PROBE} WHERE id='r1'").fetchone()
        check("the row is accepted exactly once", row[0] == "accepted", row)
        print(f"   the winner was {row[1]}")

        print(f"\n[2] ⚠️ {N} threads claiming via `WHERE usedAt IS NULL` (the preview shape)")
        cur.execute(f"INSERT INTO {PROBE} (id, status) VALUES ('p1', 'pending')")
        admin.commit()

        def claim_preview(cx, i):
            c = cx.cursor()
            c.execute(f"UPDATE {PROBE} SET usedAt=SYSUTCDATETIME(), winner=? "
                      f"WHERE id='p1' AND usedAt IS NULL", f"thread-{i}")
            rc = c.rowcount
            cx.commit()
            return rc

        results, errors = race(claim_preview, N)
        print("   rowcounts returned:", results)
        check("no thread raised", not errors, [str(e)[:120] for e in errors][:2])
        check(f"⚠️ EXACTLY ONE of {N} preview claims won",
              len([r for r in results if r == 1]) == 1,
              f"{len([r for r in results if r == 1])} did: previews are NOT single use here")

        print("\n[3] a claim inside a transaction that then FAILS releases the row")
        cur.execute(f"INSERT INTO {PROBE} (id, status) VALUES ('t1', 'pending')")
        admin.commit()
        cx = connect()
        c = cx.cursor()
        c.execute(f"UPDATE {PROBE} SET status='accepted' WHERE id='t1' AND status='pending'")
        check("the claim succeeded inside the transaction", c.rowcount == 1, c.rowcount)
        cx.rollback()
        cx.close()
        still = cur.execute(f"SELECT status FROM {PROBE} WHERE id='t1'").fetchone()[0]
        check("after rollback the row is claimable again", still == "pending", still)

        print("\n[4] a second claim after a committed one is refused")
        again = cur.execute(
            f"UPDATE {PROBE} SET status='rejected' WHERE id='r1' AND status='pending'")
        check("re-deciding a decided row affects 0 rows", cur.rowcount == 0, cur.rowcount)
        admin.commit()

    finally:
        cur.execute(f"IF OBJECT_ID('{PROBE}') IS NOT NULL DROP TABLE {PROBE}")
        admin.commit()
        left = cur.execute(
            "SELECT COUNT(*) FROM sys.tables WHERE name='zz_intake_concurrency_probe'").fetchone()[0]
        print(f"\ndropped {PROBE} (remaining: {left})")
        admin.close()

    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {', '.join(FAILURES)}")
        return 1
    print("conditional UPDATE + rowcount DOES give mutual exclusion on this engine")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
