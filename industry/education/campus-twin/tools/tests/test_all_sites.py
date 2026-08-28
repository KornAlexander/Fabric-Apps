"""Does the intake path behave the same at all nine universities, or only at the one I tested?

⚠️ EVERY OTHER TEST IN THIS FOLDER USES `site="oth"`. That is one of nine, and the nine are not
copies of each other: `oth-real` has 42 slots including a **Saturday** that no other site has, and
`tum` has 55 slots on a different block grid (08:00-09:00 rather than 08:15-09:45). A path that
works at Regensburg and quietly misbehaves at Munich is exactly the defect a single-site test
suite cannot see.

The specific hazard this was written to catch: `preview` did not check that the requested day
exists at the requested site. Ask TUM to block Saturday and the solver is asked about a day with
no sessions, so it answers **"0 Termine betroffen"** - which reads like good news. The professor
confirms, the request is filed, and at apply time the whole-day expansion finds no slots and the
request is marked `failed`. A typo ("Freitag", "Fri") behaves identically.

⚠️ The valid days are read from EACH SITE'S OWN store, never from a hard-coded weekday list. A
list in this file would say `Sa` is invalid everywhere, which is wrong at `oth-real`, or valid
everywhere, which is wrong at the other eight.
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

STORE = Path(tempfile.gettempdir()) / "campus_intake_sites.json"
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


def teacher_and_busy_day(store) -> tuple[str | None, str | None]:
    """A teacherId that really teaches, and the day they teach on most.

    ⚠️ Picked from the data rather than assumed. A hard-coded teacher id or a hard-coded "Fr"
    would make the positive case vacuous at any site where that person or that day is idle, and a
    check that cannot fail is the thing this suite keeps catching. `schedule_store` carries the
    same warning on its own `busiest_teacher()`, which the UI once hard-coded to an OTH surname
    that does not exist at LMU.

    ⚠️ Read from `assignments`, not `sessions`: a session says WHO teaches it, an assignment says
    WHEN. Only the pairing answers "which day is this person actually in".
    """
    day_of = {s["slotId"]: s["day"] for s in store.slots if s.get("day")}
    counts: dict[tuple[str, str], int] = {}
    for a in getattr(store, "assignments", []) or []:
        teacher, day = a.get("teacherId"), day_of.get(a.get("slotId"))
        if teacher and day:
            counts[(teacher, day)] = counts.get((teacher, day), 0) + 1
    if not counts:
        return None, None
    (teacher, day), _ = max(counts.items(), key=lambda kv: kv[1])
    return teacher, day


def main() -> int:
    sites = schedule_store.known_sites()
    print(f"{len(sites)} sites: {sites}\n")

    for i, site in enumerate(sites):
        store = schedule_store.store_for(site)
        days = sorted({s["day"] for s in store.slots if s.get("day")})
        teacher, busy_day = teacher_and_busy_day(store)
        oid = f"oid-{site}"
        dev_store.seed_identity(oid=oid, upn=f"{oid}@x.invalid", site=site,
                                role="teacher", teacher_id=teacher or "T-000",
                                provenance="test")
        c = client(oid)

        print(f"[{i + 1}/{len(sites)}] {site}: {len(store.slots)} slots, days={days}, "
              f"teacher={teacher} busiest={busy_day}")

        if not teacher or not busy_day:
            check(f"{site}: has a teacher with sessions", False, "no teacher/day found")
            continue

        # 1. The day this person genuinely teaches on must cost something.
        # ⚠️ `site` IS SENT EXPLICITLY. Without it `_site(None)` resolves to the container's own
        # default site, so a request from a professor at any other university is answered with
        # "not mapped to a person at this site". That is its own finding, recorded separately;
        # here it would just mask the day-validation question this test exists to ask.
        r = c.post("/api/intake/preview",
                   json={"kind": "availability", "site": site, "day": busy_day})
        detail = r.json().get("detail") if r.status_code >= 400 else None
        detail = detail if isinstance(detail, dict) else {}

        if detail.get("code") == "teacher_attribution_not_published":
            # ⚠️ A REFUSAL IS THE CORRECT ANSWER HERE, not a failure of this test. `tum` publishes
            # real teaching with invented lecturers, so `tools.py` refuses on purpose rather than
            # reporting a fabricated professor's real timetable. What matters is that the refusal
            # arrives as a refusal: before this was handled, it arrived as `affectedSessions: 0`
            # and every professor at that university was told their absence costs nothing.
            check(f"{site}: attribution is unpublished, and it SAYS so", r.status_code == 409)
            check(f"{site}: and it does NOT report a number", "affectedSessions" not in r.text)
        else:
            ok = r.status_code == 200
            check(f"{site}: a real day is priced", ok, f"{r.status_code} {r.text[:100]}")
            if ok:
                body = r.json()
                check(f"{site}: and the price is not zero",
                      (body.get("affectedSessions") or 0) > 0, body.get("affectedSessions"))

        # 2. ⚠️ A day that does not exist AT THIS SITE must be refused, not priced at zero.
        absent = next((d for d in ("Sa", "So") if d not in days), None)
        if absent:
            r = c.post("/api/intake/preview",
                       json={"kind": "availability", "site": site, "day": absent})
            check(f"{site}: '{absent}' is refused rather than priced",
                  r.status_code == 400, f"{r.status_code} {str(r.json())[:110]}")
            if r.status_code == 400:
                check(f"{site}: and the refusal lists THIS site's days",
                      all(d in str(r.json()) for d in days), str(r.json())[:110])

        # 3. A German speaker writes the word. Since phase A that RESOLVES, and the resolution is
        # disclosed rather than applied behind their back.
        # ⚠️ This check used to assert the opposite, and it was right at the time. Policy changed
        # deliberately on 2026-08-22; a real near-miss is still refused, which is asserted next.
        r = c.post("/api/intake/preview",
                   json={"kind": "availability", "site": site, "day": "Freitag"})
        check(f"{site}: 'Freitag' resolves", r.status_code in (200, 409),
              f"{r.status_code} {str(r.json())[:90]}")
        if r.status_code == 200:
            check(f"{site}: and the server says it read it as 'Fr'",
                  r.json().get("interpretedDay") == "Fr", r.json().get("interpretedDay"))

        # 3b. ⚠️ A genuine near miss is still refused. Guessing at 'Freitg' would be the same
        # mistake `tools.py` refuses to make with a misspelled teacher name.
        r = c.post("/api/intake/preview",
                   json={"kind": "availability", "site": site, "day": "Freitg"})
        check(f"{site}: the near miss 'Freitg' is still refused", r.status_code == 400,
              f"{r.status_code} {str(r.json())[:90]}")

        # 4. A slot id from nowhere must be refused.
        r = c.post("/api/intake/preview",
                   json={"kind": "availability", "site": site, "slotIds": ["Zz-99"]})
        check(f"{site}: an unknown slotId is refused", r.status_code == 400,
              f"{r.status_code} {str(r.json())[:90]}")
        print()

    if STORE.exists():
        STORE.unlink()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s)")
        for f in FAILURES[:12]:
            print(f"  - {f}")
        return 1
    print(f"OK - all {len(sites)} universities behave the same way")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
