"""An unreachable database must be a 503, not a 500, and must not hide real defects.

⚠️ THE ORDINARY FAILURE, NOT AN EXOTIC ONE. These workspaces sit on Fabric capacities that are
deliberately paused when idle. A paused capacity mints a token perfectly well and then refuses the
connection, so `pyodbc` raised straight out of the route and the caller got a 500.

To an agent a 500 means nothing it can act on. It reports that something went wrong, and the
professor's reasonable next move is to reword the request and try again, which cannot possibly
help. A 503 that says the database is unreachable tells them two things a 500 cannot: wait rather
than rephrase, and **your request was never seen, not rejected**.

The second half of this test matters more than the first: a guard that catches too much is worse
than no guard, because "try again later" is a soothing message that hides a permanent bug. So a
`KeyError` from inside a handler must still come out as a 500.
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

STORE = Path(tempfile.gettempdir()) / "campus_intake_unavail.json"
if STORE.exists():
    STORE.unlink()
os.environ["CAMPUS_INTAKE_DEV_STORE"] = str(STORE)
os.environ["ENTRA_AUTH_DISABLED"] = "1"
os.environ.pop("CAMPUS_INTAKE_ODBC", None)

import dev_store  # noqa: E402
import intake  # noqa: E402
import intake_store  # noqa: E402
from auth import Principal, require_user  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: object = "") -> None:
    print(f"  {'ok ' if condition else 'FAIL'} {name}" + (f"  [{detail}]" if detail else ""))
    if not condition:
        FAILURES.append(name)


class _Store:
    site = "oth"
    plan_version = 11
    slots = [{"slotId": f"{d}-{b}", "day": d} for d in ("Mo", "Fr") for b in (1, 2)]


def client(oid: str = "oid-a", upn: str = "a@x.invalid") -> TestClient:
    app = FastAPI()
    app.include_router(intake.router)
    app.dependency_overrides[require_user] = lambda: Principal(
        oid=oid, tid="t", upn=upn, name="Test", scopes=("access_as_user",))
    return TestClient(app, raise_server_exceptions=False)


def main() -> int:
    intake.known_sites = lambda: ["oth"]
    intake.store_for = lambda site=None: _Store()
    dev_store.seed_identity(oid="oid-a", upn="a@x.invalid", site="oth",
                            role="planner", teacher_id="T-001", provenance="test")
    c = client()

    print("[0] the CONVERSION itself: a driver error becomes StoreUnavailable")
    # ⚠️ Everything below this section raises `StoreUnavailable` by hand, which proves the router
    # handles it and proves nothing about whether it is ever raised. `_connect` does `import
    # pyodbc` inside the function, so a stand-in module in `sys.modules` exercises the real
    # `except pyodbc.Error` clause with no driver, no credential and no network.
    class _FakeError(Exception):
        pass

    class _FakePyodbc:
        Error = _FakeError

        @staticmethod
        def connect(*args, **kwargs):
            raise _FakeError("[08001] [Microsoft][ODBC Driver 18] Login timeout expired\nline two")

    real_module = sys.modules.get("pyodbc")
    real_odbc, real_token = intake_store.INTAKE_ODBC, intake_store._token_struct
    sys.modules["pyodbc"] = _FakePyodbc  # type: ignore[assignment]
    intake_store.INTAKE_ODBC = "Driver={x};Server=nowhere"
    intake_store._token_struct = lambda: b""
    try:
        intake_store._connect()
        check("a driver failure raises StoreUnavailable", False, "no exception at all")
    except intake_store.StoreUnavailable as exc:
        check("a driver failure raises StoreUnavailable", True)
        check("the message keeps the driver's first line only",
              str(exc).startswith("[08001]") and "line two" not in str(exc), str(exc))
    except Exception as exc:  # noqa: BLE001
        check("a driver failure raises StoreUnavailable", False,
              f"{type(exc).__name__}: {exc}")
    finally:
        if real_module is not None:
            sys.modules["pyodbc"] = real_module
        else:
            sys.modules.pop("pyodbc", None)
        intake_store.INTAKE_ODBC, intake_store._token_struct = real_odbc, real_token

    print("\n[1] the routes work while the store is reachable")
    check("/api/me answers", c.get("/api/me").status_code == 200)

    print("\n[2] the store becomes unreachable, as a paused capacity makes it")
    real_resolve = intake_store.resolve_identity
    real_sites = intake_store.identity_sites

    def _unreachable(*_args, **_kwargs):
        raise intake_store.StoreUnavailable(
            "[08001] [Microsoft][ODBC Driver 18] TCP Provider: timeout expired")

    # ⚠️ BOTH ENTRY POINTS. The router calls `resolve_identity` when the caller names a site and
    # `identity_sites` when it has to work out which university they belong to. This test injected
    # the fault into the first one only, so once the routes learned to infer a site the requests
    # sailed past the fault and answered 200 - a test for an outage, quietly testing nothing.
    intake_store.resolve_identity = _unreachable
    intake_store.identity_sites = _unreachable

    for path in ("/api/me", "/api/intake/mine", "/api/intake/queue"):
        r = c.get(path)
        check(f"GET {path} is 503, not 500", r.status_code == 503, r.status_code)
        detail = r.json().get("detail")
        detail = detail if isinstance(detail, dict) else {}
        check(f"GET {path} says which kind of problem",
              detail.get("code") == "store_unavailable", detail.get("code"))

    r = c.post("/api/intake/preview", json={"kind": "availability", "day": "Fr"})
    check("POST preview is 503 too", r.status_code == 503, r.status_code)
    detail = r.json().get("detail", {})
    detail = detail if isinstance(detail, dict) else {}
    check("⚠️ it tells the agent the request was NOT seen, so it is not a refusal",
          "never got that far" in str(detail.get("message", "")), detail.get("message"))
    check("it tells the agent to wait rather than rephrase",
          "rather than" in str(detail.get("message", "")), detail.get("message"))
    check("it carries the driver's own first line for whoever debugs it",
          "08001" in str(detail.get("cause", "")), detail.get("cause"))

    print("\n[3] ⚠️ the guard must NOT swallow a real defect")
    # ⚠️ Both again, for the same reason as above: leaving `identity_sites` raising the outage
    # error from the previous section would make this check pass on the WRONG exception, and it
    # would look like proof that a bug still surfaces as a 500 when nothing of the sort was tested.
    def _bug(*_args, **_kwargs):
        raise KeyError("teacherId")

    intake_store.resolve_identity = _bug
    intake_store.identity_sites = _bug
    r = c.get("/api/me")
    check("a programming error is still a 500, not a soothing 503",
          r.status_code == 500, r.status_code)

    intake_store.resolve_identity = real_resolve
    intake_store.identity_sites = real_sites

    print("\n[4] the two 503s are distinguishable from each other")
    # "not configured" already answered 503 long before this change. An agent that cannot tell
    # them apart would tell a professor to wait for a deployment that is never coming.
    real_enabled = intake_store.intake_enabled
    intake_store.intake_enabled = lambda: False
    r = c.get("/api/me")
    check("an unconfigured store is also 503", r.status_code == 503, r.status_code)
    check("but it does NOT claim to be a transient outage",
          "store_unavailable" not in str(r.json().get("detail")), r.json().get("detail"))
    intake_store.intake_enabled = real_enabled

    print()
    if STORE.exists():
        STORE.unlink()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {FAILURES}")
        return 1
    print("OK - an unreachable database is an actionable 503, and a bug is still a 500")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
