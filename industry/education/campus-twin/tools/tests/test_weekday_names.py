"""Phase A: "Freitag" is what a German speaker types, and it used to be a dead end.

⚠️ The refusal was honest and it still stopped a professor mid-sentence. This maps the spellings a
German speaker actually uses onto whatever tokens the SITE uses, and reports back when it
understood something other than the literal input.

Three properties, and the third is the one that stops this being a bad idea:

  1. the words resolve, at every site,
  2. a site that does not teach on a day does not gain one just because the word is recognised,
  3. ⚠️ the correction is VISIBLE. `interpretedDay` comes back whenever the server read something
     other than what was typed, and the agent is instructed to say so before asking for
     confirmation. A silent correction removes the one moment where the person could say "no, I
     meant something else".
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
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))
sys.path.insert(0, str(ROOT / "tools" / "agent"))

STORE = Path(tempfile.gettempdir()) / "campus_intake_weekday.json"
if STORE.exists():
    STORE.unlink()
os.environ["CAMPUS_INTAKE_DEV_STORE"] = str(STORE)
os.environ["ENTRA_AUTH_DISABLED"] = "1"
os.environ.pop("CAMPUS_INTAKE_ODBC", None)

import dev_store  # noqa: E402
import intake  # noqa: E402
import schedule_store  # noqa: E402
from auth import Principal, require_user  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: object = "") -> None:
    print(f"  {'ok ' if condition else 'FAIL'} {name}" + (f"  [{detail}]" if detail else ""))
    if not condition:
        FAILURES.append(name)


def client(oid: str) -> TestClient:
    app = FastAPI()
    app.include_router(intake.router)
    app.dependency_overrides[require_user] = lambda: Principal(
        oid=oid, tid="t", upn=f"{oid}@x.invalid", name="Test", scopes=("access_as_user",))
    return TestClient(app, raise_server_exceptions=False)


def teacher_teaching_on(store, day: str) -> str | None:
    """A teacher with real sessions on THAT day.

    ⚠️ The first version took the busiest teacher overall and then asked about Friday, which was
    not their day, so the end-to-end check asserted a non-zero price and got zero. Choosing the
    subject and the day independently is how a positive case ends up describing nothing.
    """
    day_of = {s["slotId"]: s["day"] for s in store.slots if s.get("day")}
    counts: dict[str, int] = {}
    for a in getattr(store, "assignments", []) or []:
        if day_of.get(a.get("slotId")) == day and a.get("teacherId"):
            counts[a["teacherId"]] = counts.get(a["teacherId"], 0) + 1
    return max(counts.items(), key=lambda kv: kv[1])[0] if counts else None


def main() -> int:
    store = schedule_store.store_for("fau")
    teacher = teacher_teaching_on(store, "Fr")
    dev_store.seed_identity(oid="oid-w", upn="w@x.invalid", site="fau",
                            role="teacher", teacher_id=teacher, provenance="test")
    c = client("oid-w")
    print(f"subject: {teacher}, who really teaches on Fr at fau\n")

    print("[1] the unit: spellings resolve to the site's own tokens")
    for typed, expected in [("Freitag", "Fr"), ("freitag", "Fr"), ("FREITAG", "Fr"),
                            ("Montag", "Mo"), ("Mittwoch", "Mi"), ("Donnerstag", "Do"),
                            ("Dienstag", "Di"), ("Fr.", "Fr"), ("Fri", "Fr"), ("Fr", "Fr")]:
        got = intake._resolve_day(store, typed)
        check(f"'{typed}' -> {expected}", got == expected, got)

    print("\n[2] ⚠️ a site does not gain a teaching day just because the word is known")
    # `fau` teaches Mo-Fr. `oth-real` is the only site with Saturday.
    check("'Samstag' is NOT resolved at fau", intake._resolve_day(store, "Samstag") is None,
          intake._resolve_day(store, "Samstag"))
    real = schedule_store.store_for("oth-real")
    check("but IS resolved at oth-real, which teaches then",
          intake._resolve_day(real, "Samstag") == "Sa", intake._resolve_day(real, "Samstag"))

    print("\n[3] ⚠️ near misses are still refused, not guessed")
    for typo in ("Freitg", "Frday", "Xyz", "F"):
        check(f"'{typo}' is not resolved", intake._resolve_day(store, typo) is None,
              intake._resolve_day(store, typo))

    print("\n[4] end to end, and the correction is reported")
    r = c.post("/api/intake/preview", json={"kind": "availability", "site": "fau",
                                            "day": "Freitag"})
    check("the request now succeeds", r.status_code == 200, f"{r.status_code} {r.text[:110]}")
    body = r.json() if r.status_code == 200 else {}
    check("⚠️ the response says what it understood", body.get("interpretedDay") == "Fr",
          body.get("interpretedDay"))
    check("and what it understood it from", body.get("interpretedFrom") == "Freitag",
          body.get("interpretedFrom"))
    check("and it priced a real change", (body.get("affectedSessions") or 0) > 0,
          body.get("affectedSessions"))

    print("\n[5] no correction, no noise")
    r = c.post("/api/intake/preview", json={"kind": "availability", "site": "fau", "day": "Fr"})
    check("an exact token reports no interpretation",
          "interpretedDay" not in r.json(), r.json().get("interpretedDay"))

    print("\n[6] an impossible day is still a clean refusal")
    r = c.post("/api/intake/preview", json={"kind": "availability", "site": "fau",
                                            "day": "Samstag"})
    check("'Samstag' at fau is refused", r.status_code == 400, r.status_code)
    detail = r.json().get("detail", {})
    detail = detail if isinstance(detail, dict) else {}
    check("with the site's real days", "Fr" in (detail.get("knownDays") or []), detail)

    print("\n[7] the agent is told to disclose the correction")
    import build_agent_package as builder
    instructions = builder.declarative_agent()["instructions"]
    check("instructions mention interpretedDay", "interpretedDay" in instructions)
    check("and tell it to say so out loud", "AUSDRÜCKLICH" in instructions)

    print()
    if STORE.exists():
        STORE.unlink()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {FAILURES}")
        return 1
    print("OK - the words people type resolve, impossible days still do not, and nothing is "
          "corrected behind their back")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
