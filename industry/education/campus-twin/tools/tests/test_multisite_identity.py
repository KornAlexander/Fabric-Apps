"""Can a professor who is not at the container's default university use this at all?

⚠️ BEFORE THIS, NO. `_site(None)` falls back to the site the container was started with, so a
request from anywhere else was answered "this account is not mapped to a person at this site". The
statement is true and useless: nothing tells the caller which site they ARE at. The agent cannot
work around it either, because `getMyIdentity` needs a site in order to resolve an identity, and
the identity is the only thing that knows the site. Eight of the nine universities were unreachable
unless the caller already knew the answer to the question they were asking.

The three properties this pins, in order of how badly each would fail:

  1. ⚠️ A caller who NAMES a site gets that site. Inference must never override an explicit
     request, or somebody gets a real, correct-looking answer about a university they did not ask
     about. That is the `_site` fallback bug with a friendlier face.
  2. A caller who names nothing is found at whichever single site they are mapped to.
  3. ⚠️ A caller mapped to SEVERAL sites is ASKED, never chosen for. Somebody really can teach at
     two campuses, and filing an absence against the wrong one produces numbers that are all real.
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

STORE = Path(tempfile.gettempdir()) / "campus_intake_multisite.json"
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


def main() -> int:
    sites = schedule_store.known_sites()
    default_site = intake.store_for(None).site
    # ⚠️ Deliberately somewhere that is NOT the container's default, or the whole test passes for
    # the wrong reason: the old code would have worked fine for anybody at the default site.
    elsewhere = next(s for s in sites if s != default_site)
    third = next(s for s in sites if s not in (default_site, elsewhere))
    print(f"container default: {default_site}")
    print(f"testing a professor at: {elsewhere}\n")

    dev_store.seed_identity(oid="oid-away", upn="away@x.invalid", site=elsewhere,
                            role="teacher", teacher_id="T-AWAY", provenance="test")
    away = client("oid-away")

    print("[1] a professor at a non-default university, naming no site")
    r = away.get("/api/me")
    check("⚠️ they are found at all", r.status_code == 200, f"{r.status_code} {r.text[:110]}")
    if r.status_code == 200:
        check(f"and they are placed at '{elsewhere}', not '{default_site}'",
              r.json().get("site") == elsewhere, r.json().get("site"))
        check("with their own teacherId", r.json().get("teacherId") == "T-AWAY", r.json())

    print("\n[2] an explicit site still wins, even when it is the wrong one for them")
    r = away.get(f"/api/me?site={default_site}")
    check("⚠️ naming a site is NOT overridden by inference", r.status_code == 403,
          f"{r.status_code} {r.text[:110]}")

    print("\n[3] somebody who teaches at two campuses is asked, not chosen for")
    dev_store.seed_identity(oid="oid-both", upn="both@x.invalid", site=elsewhere,
                            role="teacher", teacher_id="T-A", provenance="test")
    dev_store.seed_identity(oid="oid-both", upn="both@x.invalid", site=third,
                            role="teacher", teacher_id="T-B", provenance="test")
    both = client("oid-both")
    r = both.get("/api/me")
    check("⚠️ ambiguity is refused, not guessed", r.status_code == 409,
          f"{r.status_code} {r.text[:110]}")
    detail = r.json().get("detail") if r.status_code == 409 else {}
    detail = detail if isinstance(detail, dict) else {}
    check("it says which kind of problem", detail.get("code") == "site_ambiguous",
          detail.get("code"))
    check("and lists both campuses so the agent can ask",
          sorted(detail.get("sites") or []) == sorted([elsewhere, third]), detail.get("sites"))

    print("\n[4] naming one of them resolves it")
    r = both.get(f"/api/me?site={third}")
    check("the named campus is used", r.status_code == 200 and r.json().get("site") == third,
          f"{r.status_code} {r.text[:110]}")
    check("with THAT campus's teacherId", r.json().get("teacherId") == "T-B", r.json())

    print("\n[4b] a recorded main campus answers the question instead of asking it")
    dev_store.seed_identity(oid="oid-both", upn="both@x.invalid", site=third,
                            role="teacher", teacher_id="T-B", provenance="test",
                            is_primary=True)
    r = both.get("/api/me")
    check("⚠️ a single primary is used without asking",
          r.status_code == 200 and r.json().get("site") == third, f"{r.status_code} {r.text[:90]}")
    check("and it is the campus that was flagged, not the alphabetical first",
          r.json().get("teacherId") == "T-B", r.json())

    print("\n[4c] ⚠️ but TWO primaries must go back to asking")
    # A second flag means somebody set it carelessly. Picking either would be a guess wearing the
    # costume of a decision, which is worse than the question.
    dev_store.seed_identity(oid="oid-both", upn="both@x.invalid", site=elsewhere,
                            role="teacher", teacher_id="T-A", provenance="test",
                            is_primary=True)
    r = both.get("/api/me")
    check("two primaries are refused, not silently resolved", r.status_code == 409,
          f"{r.status_code} {r.text[:110]}")
    detail = r.json().get("detail") if r.status_code == 409 else {}
    detail = detail if isinstance(detail, dict) else {}
    check("and the message says a main campus is missing or unclear",
          "Hauptstandort" in str(detail.get("message", "")), detail.get("message"))
    # Put it back so the later sections describe the state they claim to.
    dev_store.seed_identity(oid="oid-both", upn="both@x.invalid", site=elsewhere,
                            role="teacher", teacher_id="T-A", provenance="test")

    print("\n[5] somebody mapped nowhere is still refused")
    r = client("oid-nobody").get("/api/me")
    check("an unmapped account gets 403", r.status_code == 403, r.status_code)
    check("and the message no longer says 'this site', which was misleading",
          "any site" in r.text, r.text[:110])

    print("\n[6] the inference reaches every route, not just getMyIdentity")
    r = away.post("/api/intake/preview", json={"kind": "availability", "day": "Fr"})
    # T-AWAY is not a real teacher at that site, so the honest outcomes are the solver's own
    # refusals. What must NOT happen is a 403 about the wrong university.
    check("preview no longer 403s a non-default professor", r.status_code != 403,
          f"{r.status_code} {r.text[:110]}")
    r = away.get("/api/intake/mine")
    check("listMyIntakeRequests works without a site", r.status_code == 200,
          f"{r.status_code} {r.text[:110]}")
    check("and it reports the right campus", r.json().get("site") == elsewhere, r.json())

    print()
    if STORE.exists():
        STORE.unlink()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {FAILURES}")
        return 1
    print("OK - a professor at any of the nine can be found, and nobody is placed by guesswork")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
