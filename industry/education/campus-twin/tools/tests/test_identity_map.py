"""The identity join, tested on the cases that produce a WRONG row rather than no row.

    python tools\\tests\\test_identity_map.py

⚠️ A MISSING ROW IS AN INCONVENIENCE. A WRONG ROW IS AN INCIDENT. Nobody notices a wrong identity
mapping by looking at it: the request goes through, the audit trail agrees with itself, and the
only symptom is a professor's Friday being blocked because a colleague with the same surname asked.

Every case below is drawn from real data in this repository or from real German name handling.
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
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "identity"))
sys.path.insert(0, str(ROOT / "server"))

import build_identity_map as bim  # noqa: E402

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name} {detail}")
        FAILURES.append(name)


class FakeStore:
    def __init__(self, teachers, invented=False):
        self.teachers = teachers
        self.teacher_attribution_invented = invented


def with_store(teachers, invented=False):
    """Swap the real dataset for a controlled one, keeping the real matching logic."""
    bim.__dict__["_fake"] = FakeStore(teachers, invented)
    import schedule_store
    schedule_store.store_for = lambda site=None: bim.__dict__["_fake"]
    schedule_store.known_sites = lambda: ["oth"]


def person(oid, upn, name):
    return {"oid": oid, "upn": upn, "displayName": name}


def main() -> int:
    print("\n[1] German names survive transliteration")
    for timetable, upn in [
        ("Prof. Dr. M. Müller", "mueller@hs.de"),
        ("Prof. Dr. A. Weiß", "weiss@hs.de"),
        ("Prof. Dr. J. Schröder", "schroeder@hs.de"),
        ("Prof. Dr. K. Öztürk", "oeztuerk@hs.de"),
    ]:
        with_store([{"teacherId": "T1", "name": timetable}])
        r = bim.build("oth", [person("o1", upn, "")], [], False)
        check(f"{timetable.split()[-1]} matches {upn}", len(r["identities"]) == 1,
              f"unmatched={r['unmatched']}")

    print("\n[2] ⚠️ two people with the same surname produce NO row")
    with_store([{"teacherId": "T1", "name": "Prof. Dr. M. Müller"}])
    r = bim.build("oth", [person("o1", "m.mueller@hs.de", "Maria Müller"),
                          person("o2", "t.mueller@hs.de", "Thomas Müller")], [], False)
    check("no identity was invented", len(r["identities"]) == 0, r["identities"])
    check("it is reported as ambiguous", len(r["ambiguous"]) == 1, r["ambiguous"])
    check("both candidates are named for review",
          len(r["ambiguous"][0]["candidates"]) == 2, r["ambiguous"])

    print("\n[3] ⚠️ one human cannot become two teachers")
    with_store([{"teacherId": "T1", "name": "Prof. Dr. A. Bauer"},
                {"teacherId": "T2", "name": "Dr. Bauer"}])
    r = bim.build("oth", [person("o1", "bauer@hs.de", "Anna Bauer")], [], False)
    check("only the first mapping is kept", len(r["identities"]) == 1, r["identities"])
    check("the collision is reported, not dropped", len(r["ambiguous"]) == 1, r["ambiguous"])
    check("the report says which teacher already holds the oid",
          "already mapped" in r["ambiguous"][0].get("note", ""), r["ambiguous"])

    print("\n[4] ⚠️ the unnamed teacher from oth-real is reported, not skipped")
    with_store([{"teacherId": "T1", "name": "?"}, {"teacherId": "T2", "name": ""},
                {"teacherId": "T3", "name": "Prof. Dr. Q. Quirin"}])
    r = bim.build("oth", [person("o1", "quirin@hs.de", "")], [], False)
    check("unnamed teachers are listed", sorted(r["unnamed"]) == ["T1", "T2"], r["unnamed"])
    check("the named one still matches", len(r["identities"]) == 1, r["identities"])

    print("\n[5] ⚠️ nobody becomes a planner by accident")
    with_store([{"teacherId": "T1", "name": "Prof. Dr. Q. Quirin"},
                {"teacherId": "T2", "name": "Prof. Dr. D. Dekan"}])
    dirlist = [person("o1", "quirin@hs.de", ""), person("o2", "dekan@hs.de", "")]
    r = bim.build("oth", dirlist, [], False)
    check("with no --planners, every role is teacher",
          all(i["role"] == "teacher" for i in r["identities"]), r["identities"])

    r = bim.build("oth", dirlist, ["dekan@hs.de"], False)
    roles = {i["upn"]: i["role"] for i in r["identities"]}
    check("only the named UPN is a planner", roles == {"quirin@hs.de": "teacher", "dekan@hs.de": "planner"}, roles)

    print("\n[6] a planner who teaches nothing still gets a row")
    with_store([{"teacherId": "T1", "name": "Prof. Dr. Q. Quirin"}])
    r = bim.build("oth", [person("o1", "quirin@hs.de", ""), person("o9", "office@hs.de", "Frau Office")],
                  ["office@hs.de"], False)
    planners = [i for i in r["identities"] if i["role"] == "planner"]
    check("the office has a row", len(planners) == 1, r["identities"])
    check("its provenance says it was explicit",
          planners[0]["provenance"] == "explicit-planner", planners[0])

    print("\n[7] ⚠️ a planner UPN that is not in the directory is refused")
    try:
        bim.build("oth", [person("o1", "quirin@hs.de", "")], ["ghost@hs.de"], False)
        check("refuses a nonexistent planner", False, "it silently continued")
    except SystemExit as e:
        check("refuses a nonexistent planner", True)
        check("the message names the UPN", "ghost@hs.de" in str(e), str(e))

    print("\n[8] ⚠️ invented teaching load cannot be pinned on a real person")
    with_store([{"teacherId": "T1", "name": "Prof. Dr. W. Forstner"}], invented=True)
    try:
        bim.build("oth", [person("o1", "forstner@hs.de", "")], [], False)
        check("refuses invented attribution by default", False, "it produced rows anyway")
    except SystemExit as e:
        check("refuses invented attribution by default", True)
        check("the refusal explains why", "fictional" in str(e).lower(), str(e))

    r = bim.build("oth", [person("o1", "forstner@hs.de", "")], [], True)
    check("with the explicit flag it proceeds", len(r["identities"]) == 1)
    check("and every row is stamped as such",
          all(i["provenance"] == "invented-attribution" for i in r["identities"]), r["identities"])

    print("\n[9] the SQL is reviewable and carries the warnings")
    with_store([{"teacherId": "T1", "name": "Prof. Dr. M. Müller"},
                {"teacherId": "T2", "name": "Prof. Dr. X. Unknown"}])
    r = bim.build("oth", [person("o1", "mueller@hs.de", "")], [], False)
    sql = bim.to_sql(r)
    check("one INSERT per matched identity", sql.count("INSERT INTO dbo.TeacherIdentity") == 1, sql.count("INSERT"))
    check("the unmatched teacher is NOT inserted", "Unknown" not in sql)
    check("the header states the counts", "unmatched=1" in sql, sql.splitlines()[1])
    check("it warns that gaps are deliberate", "DELIBERATELY ABSENT" in sql)

    print("\n[10] SQL injection through a display name cannot break out")
    with_store([{"teacherId": "T1", "name": "Prof. Dr. O'Brien"}])
    r = bim.build("oth", [person("o1", "o'brien@hs.de", "")], [], False)
    sql = bim.to_sql(r)
    check("the apostrophe is escaped", "''" in sql, sql)
    check("no stray statement terminator was introduced",
          sql.count(";") == len([l for l in sql.splitlines() if l.startswith("INSERT")]))

    print("\n[10b] ⚠️ Untis pool codes are never bound to a person")
    # Real records from oth-real: _PBW01, _PBW02, _PBW04 are pooled department capacity.
    with_store([{"teacherId": "P1", "name": "_PBW01"},
                {"teacherId": "P2", "name": "PMWE"},
                {"teacherId": "P3", "name": "Prof. Dr. Q. Quirin"}])
    r = bim.build("oth", [person("o1", "pbw01@hs.de", ""), person("o2", "quirin@hs.de", "")], [], False)
    check("pool codes are classified as placeholders",
          sorted(p["teacherId"] for p in r["placeholders"]) == ["P1", "P2"], r["placeholders"])
    check("a matching directory entry does NOT rescue a pool code",
          all(i["teacherId"] != "P1" for i in r["identities"]), r["identities"])
    check("the real professor is still mapped", len(r["identities"]) == 1, r["identities"])
    check("a SINGLE pool code is still refused (no ambiguity to save it)",
          not r["ambiguous"], r["ambiguous"])
    check("a real surname is not mistaken for a code", bim.is_placeholder("Müller") is False)
    check("a bare initial is not mistaken for a code", bim.is_placeholder("A") is False)

    print("\n[11] it runs against the REAL dataset")
    import importlib

    import schedule_store
    importlib.reload(schedule_store)   # undo the monkeypatched store from the cases above
    real = schedule_store.store_for("oth")
    names = [t.get("name", "") for t in real.teachers]
    surnames = [bim.surname_of(n) for n in names]
    check("a surname is extracted for every real teacher at oth",
          all(s for s in surnames), [n for n, s in zip(names, surnames) if not s][:5])
    check("titles are stripped", all("prof" not in (s or "").lower() for s in surnames))
    check("bare initials are never taken as the surname",
          all(len(s) > 1 for s in surnames if s), [s for s in surnames if s and len(s) <= 1])

    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {', '.join(FAILURES)}")
        return 1
    print("the identity join refuses to guess, and says what it refused")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
