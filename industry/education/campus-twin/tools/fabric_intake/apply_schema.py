"""Apply server/sql/campus_intake.sql to the Fabric SQL Database, then verify what it created.

    $env:FABRIC_SQL_SERVER   = "<host>,1433"
    $env:FABRIC_SQL_DATABASE = "<database name>"
    python tools/fabric_intake/apply_schema.py [--drop]

Idempotent: every CREATE is guarded by `IF OBJECT_ID(...) IS NULL`, so re-running is a no-op.
⚠️ `--drop` removes ONLY the four dbo.Intake* tables. It cannot touch dbo.PlanAssignments,
dbo.TeacherAvailabilities, dbo.Teachers, dbo.PlanChanges or dbo.Users, and the list is hard coded
rather than derived so that a future edit cannot widen it by accident.

⚠️ THE ENDPOINT COMES FROM `tools/fabric/fabric_ids.py`, NOT FROM A LITERAL IN THIS FILE.
The first version of this script wrote one tenant's server host and database name into the source,
which `npm run check:publishable` caught. That module already exists precisely so no real endpoint
is written down, and a missing value raises instead of defaulting: a script that creates tables
must never guess which database it is creating them in.
"""

from __future__ import annotations

import re
import struct
import subprocess
import sys
from pathlib import Path

import pyodbc

ROOT = Path(__file__).resolve().parents[2]
DDL = ROOT / "server" / "sql" / "campus_intake.sql"
sys.path.insert(0, str(ROOT / "tools" / "fabric"))

import fabric_ids  # noqa: E402

AZ = r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"

#: ⚠️ Hard coded. The only tables this script is allowed to drop.
OURS = ["dbo.IntakeEvent", "dbo.IntakeRequest", "dbo.IntakePreview", "dbo.IntakeIdentity"]


def connect():
    tok = subprocess.run(
        [AZ, "account", "get-access-token", "--resource", "https://database.windows.net/",
         "--query", "accessToken", "-o", "tsv"],
        capture_output=True, text=True, check=True).stdout.strip()
    raw = tok.encode("utf-16-le")
    st = struct.pack("<i", len(raw)) + raw
    cs = (f"Driver={{ODBC Driver 18 for SQL Server}};Server={fabric_ids.sql_server()};"
          f"Database={fabric_ids.sql_database()};Encrypt=yes;TrustServerCertificate=no")
    # ⚠️ pyodbc's own `timeout=`, never `Connection Timeout=` in the string: that is an ADO.NET
    # keyword, ODBC calls it an invalid attribute, and the symptom is a login timeout 258.
    return pyodbc.connect(cs, timeout=90, attrs_before={1256: st})


def main() -> int:
    cx = connect()
    cur = cx.cursor()

    if "--drop" in sys.argv:
        for t in OURS:                     # child tables first: a real FK now exists
            cur.execute(f"IF OBJECT_ID('{t}') IS NOT NULL DROP TABLE {t}")
            print("dropped", t)
        cx.commit()
        cx.close()
        return 0

    sql = DDL.read_text(encoding="utf-8")
    batches = [b.strip() for b in re.split(r"^\s*GO\s*$", sql, flags=re.M | re.I) if b.strip()]
    print(f"{len(batches)} batches from {DDL.name}")
    for i, batch in enumerate(batches, 1):
        try:
            cur.execute(batch)
        except Exception as e:
            print(f"  batch {i} FAILED: {str(e)[:300]}")
            print("  ---\n" + "\n".join(batch.splitlines()[:6]))
            cx.rollback()
            return 1
    cx.commit()
    print("applied cleanly")

    print("\n-- what exists now --")
    for t in ("IntakeIdentity", "IntakePreview", "IntakeRequest", "IntakeEvent"):
        n = cur.execute(
            "SELECT COUNT(*) FROM sys.tables WHERE name = ? AND SCHEMA_NAME(schema_id)='dbo'", t
        ).fetchone()[0]
        cols = cur.execute(
            "SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID(?)", "dbo." + t
        ).fetchone()[0]
        print(f"  dbo.{t:<16} exists={bool(n)} cols={cols}")

    print("\n-- the constraints a Warehouse could not have --")
    for label, q in [
        ("enforced PKs", "SELECT COUNT(*) FROM sys.key_constraints k JOIN sys.tables t "
                         "ON t.object_id=k.parent_object_id WHERE t.name LIKE 'Intake%'"),
        ("CHECK       ", "SELECT COUNT(*) FROM sys.check_constraints c JOIN sys.tables t "
                         "ON t.object_id=c.parent_object_id WHERE t.name LIKE 'Intake%'"),
        ("DEFAULT     ", "SELECT COUNT(*) FROM sys.default_constraints d JOIN sys.tables t "
                         "ON t.object_id=d.parent_object_id WHERE t.name LIKE 'Intake%'"),
        ("FOREIGN KEY ", "SELECT COUNT(*) FROM sys.foreign_keys f JOIN sys.tables t "
                         "ON t.object_id=f.parent_object_id WHERE t.name LIKE 'Intake%'"),
        ("indexes     ", "SELECT COUNT(*) FROM sys.indexes i JOIN sys.tables t "
                         "ON t.object_id=i.object_id WHERE t.name LIKE 'Intake%' AND i.name IS NOT NULL"),
    ]:
        print(f"  {label} {cur.execute(q).fetchone()[0]}")

    print("\n-- ⚠️ the project's own tables, untouched --")
    for t in ("PlanAssignments", "TeacherAvailabilities", "Teachers", "PlanChanges", "Users"):
        print(f"  dbo.{t:<22} {cur.execute(f'SELECT COUNT(*) FROM dbo.[{t}]').fetchone()[0]} rows")

    cx.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
