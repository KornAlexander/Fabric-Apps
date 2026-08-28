"""Does `intake_store.py` speak the schema that `campus_intake.sql` actually creates?

    python tools\\tests\\test_warehouse_schema.py

⚠️ THIS IS THE TEST THAT A LIVE WAREHOUSE WOULD NOT REPLACE. Fabric Warehouse cannot enforce a
primary key, a foreign key, a CHECK constraint or a DEFAULT (all `NOT ENFORCED` or unsupported),
so the database will happily accept nonsense and will only reject an outright unknown column. That
makes the SQL text itself the last line of defence, and text drifts silently: rename a column in
the DDL, and the INSERT keeps compiling in Python and fails at 3am against real traffic.

So: stub the ODBC layer, run every warehouse function for real, and check what it emitted.

Three classes of bug are caught here, all of which have shipped in real projects:
  1. a column that does not exist (the `at` -> `occurredAt` rename, done 2026-08-21),
  2. a parameter-count mismatch, the classic pyodbc footgun, made non-obvious by
     `DATEADD(minute, ?, ?)` supplying two placeholders for one column,
  3. a table nobody created.
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

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

import intake_store  # noqa: E402

DDL_PATH = ROOT / "server" / "sql" / "campus_intake.sql"

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name} {detail}")
        FAILURES.append(name)


# ------------------------------------------------------------------------------------------------
# Read the schema out of the DDL.
# ------------------------------------------------------------------------------------------------

def parse_ddl(text: str) -> dict[str, set[str]]:
    """table name (lowercased, no dbo.) -> set of lowercased column names."""
    text = re.sub(r"--[^\n]*", "", text)  # comments would otherwise donate stray words
    tables: dict[str, set[str]] = {}
    # ⚠️ The CREATE is now guarded by `IF OBJECT_ID(...) IS NULL` and terminated by `);` on its own
    # line, so the opening pattern must tolerate the guard.
    for m in re.finditer(r"CREATE\s+TABLE\s+dbo\.(\w+)\s*\((.*?)\n\);", text, re.S | re.I):
        name, body = m.group(1).lower(), m.group(2)
        cols = set()
        for line in body.splitlines():
            line = line.strip()
            # ⚠️ WORD BOUNDARY, not startswith. `IntakePreview` has a column literally named
            # `constraints`, and `"constraints ...".startswith("CONSTRAINT")` is True, so a naive
            # prefix test silently drops a real column and then reports the working INSERT that
            # uses it as a schema violation. Found by this test on its first run, 2026-08-21.
            if not line or re.match(r"CONSTRAINT\s+\w+\s+PRIMARY", line, re.I):
                continue
            tok = re.match(r"(\w+)\s+(nvarchar|varchar|int|bit|datetime2|bigint|float|"
                           r"uniqueidentifier|decimal)", line, re.I)
            if tok:
                cols.add(tok.group(1).lower())
        tables[name] = cols
    return tables


# ------------------------------------------------------------------------------------------------
# A fake ODBC layer that records instead of connecting.
# ------------------------------------------------------------------------------------------------

STATEMENTS: list[tuple[str, tuple]] = []


class _Cursor:
    rowcount = 1

    def execute(self, sql, *params):
        STATEMENTS.append((sql, params))
        return self

    def fetchone(self):
        # `claim_preview_and_insert` reads the claimed preview back and JSON-decodes two columns.
        return ('[{"teacher": "T-1", "day": "Fr"}]', '{"affectedSessions": 2}', "7", None)

    def fetchall(self):
        return []


class _Conn:
    def cursor(self):
        return _Cursor()

    def commit(self):
        pass

    def rollback(self):
        # Required since `claim_preview_and_insert` rolls back when a claim fails or the insert
        # raises. A fake without it turns a correct rollback path into an AttributeError.
        pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


SQL_WORDS = {
    "select", "top", "from", "where", "and", "or", "insert", "into", "values", "update", "set",
    "order", "by", "desc", "asc", "as", "null", "not", "is", "dbo", "dateadd", "minute",
    "sysutcdatetime", "join", "on", "in", "delete", "case", "when", "then", "else", "end",
    "count", "cast", "int", "varchar", "distinct", "left", "inner", "group", "having",
}


def referenced(sql: str) -> tuple[set[str], set[str]]:
    """(tables, candidate column identifiers) mentioned by a statement."""
    stripped = re.sub(r"'[^']*'", "''", sql)              # literals are not identifiers
    tables = {t.lower() for t in re.findall(r"dbo\.(\w+)", stripped)}
    words = {w.lower() for w in re.findall(r"\b[A-Za-z_]\w*\b", stripped)}
    return tables, words - SQL_WORDS - tables


def exercise_every_function() -> None:
    """Call each public function once so its SQL is emitted and recorded."""
    intake_store._connect = lambda: _Conn()

    intake_store.resolve_identity("oid-1", "oth")
    intake_store.save_preview(
        site="oth", requested_by="p@uni.de",
        constraints=[{"teacher": "T-1", "day": "Fr"}], result={"affectedSessions": 2},
        plan_version="7", rule_version=None,
    )
    intake_store.take_preview("prev-1", requested_by="p@uni.de", plan_version="7")
    intake_store.insert_request({
        "site": "oth", "kind": "availability", "submittedByOid": "oid-1",
        "submittedByUpn": "p@uni.de",
        "submittedByName": "Prof", "teacherId": "T-1", "payload": {"day": "Fr"},
        "previewId": "prev-1",
        "sourceChannel": "copilot", "correlationId": "c1",
        "impactSessions": 2, "impactMoves": 2, "impactFeasible": True,
        "planVersion": "7", "ruleVersion": None, "role": "teacher",
    })
    # ⚠️ The submit path uses THIS, not `insert_request`, so its SQL must be checked too.
    intake_store.claim_preview_and_insert(
        "prev-1", owner_oid="oid-1", plan_version="7",
        row_of=lambda snap: {
            "site": "oth", "kind": "availability", "submittedByOid": "oid-1",
            "submittedByUpn": "p@uni.de", "teacherId": "T-1", "payload": {},
            "planVersion": "7", "role": "teacher",
        },
    )
    intake_store.list_queue("oth", status="pending")
    intake_store.decide(
        "req-1", decided_by_upn="plan@uni.de", decided_by_role="planner",
        accept=True, note="ok", applied_rows=1,
    )


def main() -> int:
    check("the DDL file exists", DDL_PATH.exists(), str(DDL_PATH))
    if not DDL_PATH.exists():
        return 1
    schema = parse_ddl(DDL_PATH.read_text(encoding="utf-8"))

    print("\n[1] the schema parses and holds the expected tables")
    expected = {"intakeidentity", "intakepreview", "intakerequest", "intakeevent"}
    check("all four tables are created", set(schema) == expected, sorted(schema))
    for t, cols in sorted(schema.items()):
        check(f"{t} has columns", len(cols) > 0, f"{len(cols)} cols")

    print("\n[2] ⚠️ there is no column that could hold ANY free text")
    for t, cols in schema.items():
        bad = cols & {"utterance", "utteranceredacted", "reason", "comment", "note"}
        # `decisionNote` is a planner's own note about their decision and is intentionally present;
        # what must not exist is anywhere for the REQUESTER's words to land.
        bad -= {"note"} if t == "intakerequest" else set()
        check(f"{t} has no requester free-text column", not bad, sorted(bad))
    ddl_text = DDL_PATH.read_text(encoding="utf-8")
    check("the DDL states why there is no such column",
          "THERE IS NO FREE-TEXT COLUMN" in ddl_text)
    check("ownership is stored as an oid, not a UPN",
          "submittedByOid" in ddl_text and "THE IMMUTABLE ENTRA" in ddl_text)

    print("\n[3] every statement intake_store.py emits fits the schema")
    exercise_every_function()
    check("statements were actually captured", len(STATEMENTS) >= 6, len(STATEMENTS))

    for sql, params in STATEMENTS:
        label = " ".join(sql.split())[:58]
        tables, words = referenced(sql)

        check(f"tables exist :: {label}", tables <= set(schema), tables - set(schema))

        known: set[str] = set()
        for t in tables:
            known |= schema.get(t, set())
        unknown = {w for w in words if w not in known}
        check(f"columns exist :: {label}", not unknown, f"unknown={sorted(unknown)}")

        check(f"placeholders match params :: {label}",
              sql.count("?") == len(params), f"{sql.count('?')} ? vs {len(params)} params")

    print("\n[4] the INSERT column count matches its VALUES list")
    for sql, _ in STATEMENTS:
        m = re.search(r"INSERT\s+INTO\s+dbo\.(\w+)\s*\((.*?)\)\s*VALUES\s*\((.*)\)", sql, re.S | re.I)
        if not m:
            continue
        table, cols_txt, vals_txt = m.group(1), m.group(2), m.group(3)
        n_cols = len([c for c in cols_txt.split(",") if c.strip()])

        # Split on TOP LEVEL commas only: DATEADD(minute, ?, ?) is ONE value, not three.
        depth, n_vals = 0, 1
        for ch in vals_txt:
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
            elif ch == "," and depth == 0:
                n_vals += 1
        check(f"{table}: {n_cols} columns, {n_vals} values", n_cols == n_vals)

    print("\n[5] the keyword landmine stays defused")
    all_sql = " ".join(s for s, _ in STATEMENTS)
    check("no bare 'at' column is written",
          not re.search(r"[(,]\s*at\s*[,)]", all_sql), "found a bare `at`")
    check("occurredAt is used instead", "occurredAt" in all_sql)

    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {', '.join(FAILURES)}")
        return 1
    print("warehouse SQL and campus_intake.sql agree")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
