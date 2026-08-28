"""The router, the real solver and the real database, together. The last untested combination.

    $env:FABRIC_SQL_SERVER   = "<host>,1433"
    $env:FABRIC_SQL_DATABASE = "<database name>"
    python tools\\tests\\live_router_identity.py

⚠️ NOT PART OF THE OFFLINE SUITE. `live_*`, run deliberately.

Every router test so far replaced the store: `test_intake_auth.py` with hand-written fakes,
`test_intake_e2e.py` and `test_intake_server.py` with the JSON dev store. So the ROUTER has never
once talked to SQL, and the pieces that only exist there have never been exercised together:

  * `_identity()` resolving a role out of `dbo.IntakeIdentity` rather than out of a dict,
  * the `SELECT TOP (2)` duplicate guard against a table with a REAL primary key,
  * `list_queue`'s SQL behind the role check,
  * a preview that runs CP-SAT over the real dataset and writes a real row.

⚠️ Auth is bypassed by overriding the FastAPI dependency, not by `ENTRA_AUTH_DISABLED`: that flag
collapses every caller into one principal, and the whole point here is to be two different people.

Safety: one temporary identity, previews deleted by exact id, cleanup in `finally`.
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
from pathlib import Path

import pyodbc

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "fabric"))
sys.path.insert(0, str(ROOT / "server"))

import fabric_ids  # noqa: E402

os.environ.pop("CAMPUS_INTAKE_DEV_STORE", None)
os.environ.pop("ENTRA_AUTH_DISABLED", None)
os.environ["CAMPUS_INTAKE_ODBC"] = (
    f"Driver={{ODBC Driver 18 for SQL Server}};Server={fabric_ids.sql_server()};"
    f"Database={fabric_ids.sql_database()};Encrypt=yes;TrustServerCertificate=no"
)

import intake  # noqa: E402
import intake_store  # noqa: E402
import schedule_store  # noqa: E402
from auth import Principal, require_user  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

AZ = r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
SITE = "oth"
TEACHER_OID = "zz-oid-router-probe"
UNMAPPED_OID = "zz-oid-nobody-at-all"

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


def client_for(oid: str, upn: str) -> TestClient:
    app = FastAPI()
    app.include_router(intake.router)
    app.dependency_overrides[require_user] = lambda: Principal(
        oid=oid, tid="live", upn=upn, name="Live Probe", scopes=("access_as_user",))
    return TestClient(app, raise_server_exceptions=False)


def main() -> int:
    cx = connect()
    cur = cx.cursor()

    planner = cur.execute(
        "SELECT TOP (1) oid, upn FROM dbo.IntakeIdentity WHERE site = ? AND role = 'planner'",
        SITE).fetchone()
    if not planner:
        print("  ⚠️ No planner exists at this site. Run:")
        print("     python tools/fabric_intake/intake_cli.py grant --site oth --upn <you> "
              "--role planner")
        return 1
    planner_oid, planner_upn = planner
    print(f"planner on record: {planner_upn}")

    real_teacher = schedule_store.store_for(SITE).teachers[0]["teacherId"]
    print(f"probe will act as teacher {real_teacher}")
    previews: list[str] = []

    try:
        print("\n[1] ⚠️ an account with no identity row is refused, not treated as ordinary")
        nobody = client_for(UNMAPPED_OID, "nobody@localhost.invalid")
        r = nobody.get(f"/api/me?site={SITE}")
        check("GET /api/me is 403", r.status_code == 403, f"{r.status_code} {r.text[:120]}")
        check("and so is the queue", nobody.get(f"/api/intake/queue?site={SITE}").status_code == 403)
        check("and so is a preview", nobody.post(
            "/api/intake/preview", json={"kind": "availability", "day": "Fr", "site": SITE}
        ).status_code == 403)

        print("\n[2] the role is read out of dbo.IntakeIdentity, not out of a fixture")
        cur.execute(
            """INSERT INTO dbo.IntakeIdentity (oid, site, upn, teacherId, role, provenance)
               VALUES (?, ?, 'router-probe@localhost.invalid', ?, 'teacher', 'live-test')""",
            TEACHER_OID, SITE, real_teacher)
        cx.commit()
        teacher = client_for(TEACHER_OID, "router-probe@localhost.invalid")
        me = teacher.get(f"/api/me?site={SITE}")
        check("GET /api/me now succeeds", me.status_code == 200, me.text[:160])
        body = me.json()
        check("it returns the teacherId from the database", body.get("teacherId") == real_teacher, body)
        check("and the role", body.get("role") == "teacher", body)
        check("and the provenance", body.get("identityProvenance") == "live-test", body)

        print("\n[3] ⚠️ role enforcement, against real rows")
        check("a teacher is refused the queue",
              teacher.get(f"/api/intake/queue?site={SITE}").status_code == 403)
        planner_c = client_for(planner_oid, planner_upn)
        q = planner_c.get(f"/api/intake/queue?site={SITE}")
        check("the planner is allowed", q.status_code == 200, q.text[:160])
        check("the queue is a list", isinstance(q.json().get("requests"), list), q.text[:120])
        mine = teacher.get(f"/api/intake/mine?site={SITE}")
        check("a teacher can read their own requests", mine.status_code == 200, mine.text[:160])

        print("\n[4] ⚠️ the enforced PRIMARY KEY makes a duplicate identity IMPOSSIBLE")
        # `resolve_identity` reads TOP (2) and refuses when it sees two, a defence written when this
        # was a Fabric Warehouse where no key could be enforced. On this engine the database itself
        # refuses, so the defence is now belt and braces rather than the only thing standing there.
        dup = None
        try:
            cur.execute(
                """INSERT INTO dbo.IntakeIdentity (oid, site, upn, teacherId, role, provenance)
                   VALUES (?, ?, 'dup@localhost.invalid', ?, 'planner', 'live-test-dup')""",
                TEACHER_OID, SITE, real_teacher)
            cx.commit()
        except Exception as exc:  # noqa: BLE001
            dup = exc
            cx.rollback()
        check("a second row for the same (oid, site) is rejected", dup is not None,
              "the PK did not hold, and a professor could silently become a planner")
        check("the error names a key violation",
              "PRIMARY KEY" in str(dup).upper() or "DUPLICATE" in str(dup).upper(), str(dup)[:160])
        check("the original row is untouched",
              teacher.get(f"/api/me?site={SITE}").json().get("role") == "teacher")

        print("\n[5] ⚠️ a preview: the router, CP-SAT over the real dataset, and a real row")
        pv = teacher.post("/api/intake/preview",
                          json={"kind": "availability", "day": "Fr", "site": SITE})
        check("preview succeeds", pv.status_code == 200, pv.text[:250])
        if pv.status_code == 200:
            data = pv.json()
            previews.append(data["previewId"])
            check("a previewId came back", bool(data.get("previewId")), data)
            check("the plan version is reported", bool(data.get("planVersion")), data)
            # ⚠️ The numbers come from the solver, not from a fixture. Whatever they are, they must
            # be self-consistent: you cannot move more sessions than are affected.
            aff, moved = data.get("affectedSessions"), data.get("wouldMove")
            print(f"        solver says: {aff} affected, {moved} would move, "
                  f"feasible={data.get('feasible')}")
            check("affectedSessions is a number", isinstance(aff, int), aff)
            check("wouldMove never exceeds affectedSessions",
                  moved is None or moved <= aff, f"{moved} > {aff}")
            stored = cur.execute(
                "SELECT requestedBy, planVersion, usedAt FROM dbo.IntakePreview WHERE previewId = ?",
                data["previewId"]).fetchone()
            check("the preview really landed in SQL", stored is not None)
            check("⚠️ owned by the OID, not the UPN", stored[0] == TEACHER_OID, stored[0])
            check("and it is unused until submitted", stored[2] is None)

    finally:
        print("\n[6] cleanup")
        if previews:
            ph = ",".join("?" for _ in previews)
            cur.execute(f"DELETE FROM dbo.IntakePreview WHERE previewId IN ({ph})", *previews)
            print(f"        removed {cur.rowcount} preview row(s)")
        cur.execute("DELETE FROM dbo.IntakeIdentity WHERE oid = ?", TEACHER_OID)
        print(f"        removed {cur.rowcount} identity row(s)")
        cx.commit()
        check("the probe identity is gone", cur.execute(
            "SELECT COUNT(*) FROM dbo.IntakeIdentity WHERE oid = ?", TEACHER_OID).fetchone()[0] == 0)
        check("⚠️ the planner grant is still there",
              cur.execute("SELECT COUNT(*) FROM dbo.IntakeIdentity WHERE oid = ?",
                          planner_oid).fetchone()[0] == 1)
        cx.close()

    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {', '.join(FAILURES)}")
        return 1
    print("the router reads roles from the real database and enforces them")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
