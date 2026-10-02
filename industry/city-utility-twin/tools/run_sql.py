"""Run a small T-SQL script against the Fabric SQL Database with an Entra access token.

⚠️ A HELPER FOR SETUP, NOT PART OF THE SERVICE. The container writes with its own managed
identity; this runs once, as a person, to create the database principal for that identity.

⚠️ THE TOKEN ARRIVES THROUGH THE ENVIRONMENT AND IS NEVER PRINTED. It is a bearer credential for
the SQL endpoint, so it must not reach a log, a transcript or a shell history.
"""

from __future__ import annotations

import os
import struct
import sys

try:
    import pyodbc
except ImportError:  # pragma: no cover - a setup problem, reported plainly
    sys.exit("pyodbc is not installed in this interpreter: pip install pyodbc")

_SQL_COPT_SS_ACCESS_TOKEN = 1256


def main() -> int:
    token = os.environ.get("ZWILLING_SQL_TOKEN", "")
    server = os.environ.get("ZWILLING_SQL_SERVER", "")
    database = os.environ.get("ZWILLING_SQL_DATABASE", "")
    script = os.environ.get("ZWILLING_SQL_SCRIPT", "")
    if not all([token, server, database, script]):
        return int(bool(sys.stderr.write("missing ZWILLING_SQL_* environment values\n"))) or 2

    drivers = [d for d in pyodbc.drivers() if "SQL Server" in d]
    if not drivers:
        return int(bool(sys.stderr.write(f"no SQL Server ODBC driver found: {pyodbc.drivers()}\n"))) or 3
    driver = "ODBC Driver 18 for SQL Server" if "ODBC Driver 18 for SQL Server" in drivers else drivers[0]

    connection_string = (
        f"Driver={{{driver}}};Server=tcp:{server},1433;Database={database};"
        "Encrypt=yes;TrustServerCertificate=no;Connection Timeout=60;"
    )
    raw = token.encode("utf-16-le")
    # ⚠️ UTF-16-LE, LENGTH-PREFIXED. A raw string fails authentication with a generic login error.
    packed = struct.pack("<i", len(raw)) + raw

    print(f"driver   : {driver}")
    with pyodbc.connect(connection_string, attrs_before={_SQL_COPT_SS_ACCESS_TOKEN: packed}) as conn:
        conn.autocommit = True
        cursor = conn.cursor()
        # ⚠️ Split on GO, because the ODBC driver executes one batch at a time and `CREATE USER`
        # has to be its own batch before a later statement can reference the principal.
        for batch in [b.strip() for b in script.split("\nGO\n")]:
            if not batch:
                continue
            cursor.execute(batch)
            while True:
                if cursor.description:
                    for row in cursor.fetchall():
                        print("  ", *row)
                if not cursor.nextset():
                    break
    print("granted")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
