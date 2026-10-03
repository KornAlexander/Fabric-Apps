"""Create and populate dbo.Skills: the DP-600 outline as a reportable dimension.

WHY A REAL SQL TABLE, and not a calculated table in the model:

`QuestionAttempts.topicId` is a slug (`dp600-3`). Without a dimension, every
skill axis in the report reads as a slug and there is no way at all to roll up
to the three exam domains, which is half of the page the user asked for.

The obvious alternative is a DAX calculated table. That is rejected because a
calculated table is an IMPORT table, and relating an import dimension to a
Direct Lake fact is the one join that forces the model out of Direct Lake. The
reference model in this same workspace only ever uses a calculated table
DISCONNECTED (its `Measure` table), which is exactly the shape that does not
need a relationship.

A real table in the app database mirrors into OneLake automatically (already
verified), so the join stays pure Direct Lake.

⚠️ This table is NOT declared in `rayfin/data/schema.ts`. It is reporting
reference data, not app data: the game never reads or writes it. The risk to
know about is that a future `rayfin up` owns the schema and could in principle
drop what it does not recognise. Re-running this script restores it exactly.
"""

import json
import struct
import subprocess

import pyodbc

import _config

AZ = r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
SERVER = _config.sql_server()
DB = _config.sql_database()
OUTLINE = _config.OUTLINE

DDL = """
IF OBJECT_ID('dbo.Skills', 'U') IS NULL
CREATE TABLE dbo.Skills (
    topicId         nvarchar(64)  NOT NULL PRIMARY KEY,
    skillNumber     int           NOT NULL,
    skillLabel      nvarchar(300) NOT NULL,
    clusterId       nvarchar(8)   NOT NULL,
    clusterLabel    nvarchar(200) NOT NULL,
    domainId        nvarchar(8)   NOT NULL,
    domainLabel     nvarchar(200) NOT NULL,
    domainDisplay   nvarchar(240) NOT NULL,
    domainWeightMin int           NOT NULL,
    domainWeightMax int           NOT NULL
);
"""


def rows() -> list[tuple]:
    o = json.loads(OUTLINE.read_text(encoding="utf-8"))
    out = []
    for b in o["branches"]:
        display = f"{b['id']}. {b['label']} ({b['weightMin']}-{b['weightMax']}%)"
        for c in b["clusters"]:
            for s in c["skills"]:
                out.append((
                    f"dp600-{s['id']}", int(s["id"]), s["label"],
                    c["id"], c["label"], b["id"], b["label"], display,
                    int(b["weightMin"]), int(b["weightMax"]),
                ))
    return out


def main() -> None:
    tok = subprocess.run(
        [AZ, "account", "get-access-token", "--resource", "https://database.windows.net/",
         "--query", "accessToken", "-o", "tsv"],
        capture_output=True, text=True, check=True).stdout.strip()
    raw = tok.encode("utf-16-le")
    cn = pyodbc.connect(
        f"Driver={{ODBC Driver 18 for SQL Server}};Server={SERVER};Database={DB};"
        "Encrypt=yes;TrustServerCertificate=no;Connection Timeout=60",
        attrs_before={1256: struct.pack(f"<I{len(raw)}s", len(raw), raw)},
    )
    cur = cn.cursor()
    cur.execute(DDL)
    cn.commit()

    data = rows()
    assert len(data) == 41, f"expected 41 skills, got {len(data)}"
    cur.execute("DELETE FROM dbo.Skills")
    cur.fast_executemany = True
    cur.executemany(
        "INSERT INTO dbo.Skills (topicId, skillNumber, skillLabel, clusterId, clusterLabel, "
        "domainId, domainLabel, domainDisplay, domainWeightMin, domainWeightMax) "
        "VALUES (?,?,?,?,?,?,?,?,?,?)", data)
    cn.commit()

    # Every topic the attempts reference must resolve, or the skill axis silently
    # drops rows. Checking here is cheaper than discovering it in a blank visual.
    cur.execute("""
        SELECT COUNT(DISTINCT a.topicId)
        FROM dbo.QuestionAttempts a
        LEFT JOIN dbo.Skills s ON s.topicId = a.topicId
        WHERE s.topicId IS NULL
    """)
    orphans = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM dbo.Skills")
    print(f"dbo.Skills rows: {cur.fetchone()[0]}")
    print(f"attempt topicIds with no matching skill: {orphans}")
    if orphans:
        raise SystemExit("orphan topicIds would break the skill axis")

    cur.execute("SELECT domainDisplay, COUNT(*) FROM dbo.Skills GROUP BY domainDisplay ORDER BY domainDisplay")
    for d, n in cur.fetchall():
        print(f"  {n:2} skills  {d}")
    cn.close()


if __name__ == "__main__":
    main()
