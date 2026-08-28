"""Do the two store backends actually return the same SHAPE?

⚠️ THIS EXISTS BECAUSE THEY DID NOT, AND NOBODY COULD HAVE NOTICED. `live_retry_lookup.py` found
that a `requestId` came back lowercase from the dev store and UPPERCASE from Fabric SQL, so every
offline test was asserting a spelling production never produces. That was one symptom. This
harness goes after the class: it runs the same logical sequence against BOTH backends and compares
the key sets and the value shapes of everything that reaches an HTTP response.

Value *shapes*, deliberately, not values. A synthetic id will obviously differ between two runs.
What must not differ is whether a field is present, whether a timestamp arrives as a string or a
`datetime` the JSON encoder will choke on, and whether an id is spelled the same way twice.

⚠️ The offline suite runs entirely on the dev store. Every guarantee it appears to give about
response shape is only a guarantee about JSON-on-disk unless something like this pins the two
together.

Opt-in and live. Synthetic ids only, row counts before and after, cleanup by exact id in
`finally`, children before parents.
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
import re
import struct
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Any

import pyodbc

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "fabric"))
sys.path.insert(0, str(ROOT / "server"))

import fabric_ids  # noqa: E402

DEV_FILE = Path(tempfile.gettempdir()) / f"campus_parity_{uuid.uuid4().hex[:8]}.json"
os.environ["CAMPUS_INTAKE_DEV_STORE"] = str(DEV_FILE)
os.environ["CAMPUS_INTAKE_ODBC"] = (
    f"Driver={{ODBC Driver 18 for SQL Server}};Server={fabric_ids.sql_server()};"
    f"Database={fabric_ids.sql_database()};Encrypt=yes;TrustServerCertificate=no"
)

import dev_store  # noqa: E402
import intake_store  # noqa: E402

AZ = r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
SITE = "oth"
OID = f"zz-parity-{uuid.uuid4().hex[:8]}"
TEACHER = "ZZ-PARITY-T1"

FAILURES: list[str] = []
GUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}")


def _token_connect():
    tok = subprocess.run(
        [AZ, "account", "get-access-token", "--resource", "https://database.windows.net/",
         "--query", "accessToken", "-o", "tsv"],
        capture_output=True, text=True, check=True).stdout.strip()
    raw = tok.encode("utf-16-le")
    return pyodbc.connect(os.environ["CAMPUS_INTAKE_ODBC"], timeout=90,
                          attrs_before={1256: struct.pack("<i", len(raw)) + raw})


intake_store._connect = _token_connect


def check(name: str, condition: bool, detail: object = "") -> None:
    print(f"  {'ok ' if condition else 'FAIL'} {name}" + (f"  [{detail}]" if detail else ""))
    if not condition:
        FAILURES.append(name)


def shape(value: Any) -> str:
    """A description of the value that survives the id being different every run."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, int):
        return "int"
    if isinstance(value, float):
        return "float"
    if isinstance(value, dict):
        return "object{" + ",".join(sorted(value)) + "}"
    if isinstance(value, list):
        return "array"
    if isinstance(value, str):
        if GUID.match(value):
            # ⚠️ The casing is part of the shape. This is the exact difference that shipped.
            return "guid-lower" if value == value.lower() else "guid-UPPER"
        if ISO.match(value):
            return "iso-datetime"
        return "text"
    # Anything else is a driver-native type that json.dumps will refuse.
    return f"NON-JSON:{type(value).__name__}"


def compare(label: str, dev: Any, sql: Any) -> None:
    if dev is None or sql is None:
        check(f"{label}: both backends returned a row", dev is not None and sql is not None,
              f"dev={dev is not None} sql={sql is not None}")
        return
    dev_keys, sql_keys = set(dev), set(sql)
    check(f"{label}: same keys", dev_keys == sql_keys,
          f"dev-only={sorted(dev_keys - sql_keys)} sql-only={sorted(sql_keys - dev_keys)}")
    for key in sorted(dev_keys & sql_keys):
        d, s = shape(dev[key]), shape(sql[key])
        check(f"{label}.{key}: same shape ({d})", d == s, f"dev={d} sql={s}")


def sql_setup(cx) -> None:
    cur = cx.cursor()
    cur.execute(
        """INSERT INTO dbo.IntakeIdentity (oid, site, upn, teacherId, role, provenance)
           VALUES (?, ?, ?, ?, 'teacher', 'parity-probe')""",
        OID, SITE, f"{OID}@x.invalid", TEACHER)
    cx.commit()


def main() -> int:
    print(f"dev file: {DEV_FILE.name}")
    print(f"oid:      {OID}\n")

    with intake_store._connect() as cx:
        before_ident = cx.cursor().execute("SELECT COUNT(*) FROM dbo.IntakeIdentity").fetchone()[0]
        before_prev = cx.cursor().execute("SELECT COUNT(*) FROM dbo.IntakePreview").fetchone()[0]
        before_req = cx.cursor().execute("SELECT COUNT(*) FROM dbo.IntakeRequest").fetchone()[0]
    print(f"rows before: identity={before_ident} preview={before_prev} request={before_req}\n")

    preview_sql = request_sql = None
    try:
        with intake_store._connect() as cx:
            sql_setup(cx)
        dev_store.seed_identity(oid=OID, site=SITE, teacher_id=TEACHER, role="teacher",
                                upn=f"{OID}@x.invalid", provenance="parity-probe")

        # ⚠️ `intake_store` dispatches on the env var at CALL time, so the SQL side is reached by
        # forcing `_dev()` false rather than by juggling the environment mid-run.
        dev_mode, intake_store._dev = intake_store._dev, lambda: False

        print("[1] resolve_identity")
        compare("resolve_identity",
                dev_store.resolve_identity(OID, SITE),
                intake_store.resolve_identity(OID, SITE))

        print("\n[2] save_preview then claim_preview_and_insert")
        args = dict(site=SITE, requested_by=OID,
                    constraints=[{"teacher": TEACHER, "day": "Fr"}],
                    result={"affectedSessions": 1, "wouldMove": 1, "feasible": True},
                    plan_version="1", rule_version=None)
        preview_dev = dev_store.save_preview(**args)
        preview_sql = intake_store.save_preview(**args)
        check("both backends return a preview id",
              bool(preview_dev) and bool(preview_sql))
        check("the preview id is spelled the same way by both",
              shape(preview_dev) == shape(preview_sql),
              f"dev={shape(preview_dev)} sql={shape(preview_sql)}")

        def row_of(snap, preview_id):
            return {
                "site": SITE, "kind": "availability", "submittedByOid": OID,
                "submittedByUpn": f"{OID}@x.invalid", "submittedByName": "Parity Probe",
                "teacherId": TEACHER, "role": "teacher",
                "payload": {"constraints": snap["constraints"]},
                "previewId": preview_id, "sourceChannel": "api", "correlationId": None,
                "impactSessions": 1, "impactMoves": 1, "impactFeasible": True,
                "planVersion": "1",
            }

        claim_dev = dev_store.claim_preview_and_insert(
            preview_dev, owner_oid=OID, plan_version="1",
            row_of=lambda snap: row_of(snap, preview_dev))
        claim_sql = intake_store.claim_preview_and_insert(
            preview_sql, owner_oid=OID, plan_version="1",
            row_of=lambda snap: row_of(snap, preview_sql))
        check("both backends claimed the preview", bool(claim_dev) and bool(claim_sql))
        request_dev, request_sql = claim_dev[0], claim_sql[0]
        check("⚠️ the requestId is spelled the same way by both",
              shape(request_dev) == shape(request_sql),
              f"dev={shape(request_dev)} sql={shape(request_sql)}")

        print("\n[3] request_for_preview, the retry lookup")
        compare("request_for_preview",
                dev_store.request_for_preview(preview_dev, owner_oid=OID),
                intake_store.request_for_preview(preview_sql, owner_oid=OID))

        print("\n[4] list_queue, which is what a planner and the agent both read")
        dev_rows = [r for r in dev_store.list_queue(SITE) if r["requestId"] == request_dev]
        sql_rows = [r for r in intake_store.list_queue(SITE) if r["requestId"] == request_sql]
        check("both backends list the request", bool(dev_rows) and bool(sql_rows),
              f"dev={len(dev_rows)} sql={len(sql_rows)}")
        if dev_rows and sql_rows:
            compare("list_queue", dev_rows[0], sql_rows[0])

        intake_store._dev = dev_mode

    finally:
        with intake_store._connect() as cx:
            cur = cx.cursor()
            # Children before parents: events reference the request.
            if request_sql:
                cur.execute("DELETE FROM dbo.IntakeEvent WHERE requestId = ?", request_sql)
                cur.execute("DELETE FROM dbo.IntakeRequest WHERE requestId = ?", request_sql)
            if preview_sql:
                cur.execute("DELETE FROM dbo.IntakePreview WHERE previewId = ?", preview_sql)
            cur.execute("DELETE FROM dbo.IntakeIdentity WHERE oid = ?", OID)
            cx.commit()
            after_ident = cur.execute("SELECT COUNT(*) FROM dbo.IntakeIdentity").fetchone()[0]
            after_prev = cur.execute("SELECT COUNT(*) FROM dbo.IntakePreview").fetchone()[0]
            after_req = cur.execute("SELECT COUNT(*) FROM dbo.IntakeRequest").fetchone()[0]
        print(f"\nrows after cleanup: identity={after_ident} preview={after_prev} "
              f"request={after_req}")
        if (after_ident, after_prev, after_req) != (before_ident, before_prev, before_req):
            print("⚠️ ROW COUNTS DID NOT RETURN TO THEIR STARTING VALUES")
            FAILURES.append("cleanup left rows behind")
        DEV_FILE.unlink(missing_ok=True)

    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s):")
        for f in FAILURES:
            print(f"  - {f}")
        return 1
    print("OK - both backends return the same shape, so the offline suite is testing "
          "something production actually produces")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
