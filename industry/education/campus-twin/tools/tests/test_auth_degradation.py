"""What happens when `pyjwt` and `pyodbc` are simply not installed?

    python tools\\tests\\test_auth_degradation.py

⚠️ THIS IS THE TEST FOR A FAILURE THAT HAS ALREADY HAPPENED ONCE HERE. The Dockerfile carries the
scar: a mismatch between what the image contained and what the code needed arrived as "a startup
probe failing 1 400 times with no replica left alive to read a log from".

`server/requirements.txt` currently lists neither `pyjwt[crypto]` nor `pyodbc`. The intake feature
needs both. So there is a window, and it is not hypothetical: it opens the moment somebody adds one
`app.include_router(intake.router)` line to `app.py` before updating the image.

The required behaviour in that window is precise, and two of the three obvious implementations are
wrong:

    crash the process        -> WRONG. Takes the timetable, the solver and the cockpit down with
                                it, for every university sharing the image, to disable one feature.
    allow the request        -> CATASTROPHIC. An auth module that passes when its crypto library is
                                missing is not an auth module.
    503 with a named cause   -> CORRECT. One feature off, a sentence saying which package is
                                missing, everything else serving.

The subprocess below really does hide the modules from the import system, rather than mocking
something and hoping the mock resembles reality.
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

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PY = sys.executable

CHILD = r'''
import sys, types, json

# A real import blocker: `jwt` and `pyodbc` cease to exist for this interpreter.
class Blocker:
    BLOCKED = {"jwt", "pyodbc"}
    def find_module(self, name, path=None):
        return self if name.split(".")[0] in self.BLOCKED else None
    def find_spec(self, name, path=None, target=None):
        if name.split(".")[0] in self.BLOCKED:
            raise ImportError(f"blocked for test: {name}")
        return None

sys.meta_path.insert(0, Blocker())
for mod in [m for m in list(sys.modules) if m.split(".")[0] in {"jwt", "pyodbc"}]:
    del sys.modules[mod]

sys.path.insert(0, r"%SERVER%")

import os
for k in ("ENTRA_AUTH_DISABLED",):
    os.environ.pop(k, None)
os.environ["ENTRA_TENANT_IDS"] = "-".join("1" * n for n in (8, 4, 4, 4, 12))
os.environ["ENTRA_API_AUDIENCE"] = "api://campus"

out = {}

try:
    import jwt
    out["jwt_really_blocked"] = False
except ImportError:
    out["jwt_really_blocked"] = True

import auth
out["auth_imported"] = True
out["JWT_AVAILABLE"] = auth.JWT_AVAILABLE
out["status"] = auth.auth_status()

from fastapi import HTTPException
try:
    auth.validate_bearer("any.token.here")
    out["validate_result"] = "RETURNED A PRINCIPAL"
except HTTPException as e:
    out["validate_status"] = e.status_code
    out["validate_detail"] = str(e.detail)
except Exception as e:
    out["validate_result"] = f"{type(e).__name__}: {e}"

import intake_store
out["warehouse_imported"] = True
out["intake_enabled"] = intake_store.intake_enabled()

import intake
out["intake_imported"] = True

from fastapi import FastAPI
from fastapi.testclient import TestClient
app = FastAPI()
app.include_router(intake.router)
c = TestClient(app, raise_server_exceptions=False)
r = c.get("/api/me", headers={"Authorization": "Bearer any.token.here"})
out["me_status"] = r.status_code
out["me_body"] = r.text[:160]
r2 = c.get("/api/me")
out["me_no_header_status"] = r2.status_code

print("JSON_START" + json.dumps(out) + "JSON_END")
'''.replace("%SERVER%", str(ROOT / "server"))

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name} {detail}")
        FAILURES.append(name)


def main() -> int:
    proc = subprocess.run([PY, "-c", CHILD], capture_output=True, text=True, cwd=str(ROOT))

    print("\n[1] the server survives the missing dependency at all")
    crashed = proc.returncode != 0
    check("the child process did not crash", not crashed,
          f"rc={proc.returncode}\n{proc.stderr[-1200:]}")
    if crashed:
        print("\n⚠️ THIS IS THE OUTAGE. Importing the intake path without pyjwt killed the process.")
        return 1

    import json
    raw = proc.stdout
    out = json.loads(raw.split("JSON_START")[1].split("JSON_END")[0])

    check("pyjwt really was hidden from the interpreter", out.get("jwt_really_blocked") is True)
    check("auth.py still imports", out.get("auth_imported") is True)
    check("intake_store.py still imports without pyodbc", out.get("warehouse_imported") is True)
    check("intake.py still imports", out.get("intake_imported") is True)

    print("\n[2] it reports the truth about itself")
    check("JWT_AVAILABLE is False", out.get("JWT_AVAILABLE") is False)
    check("auth_status says libraryPresent=False", out["status"].get("libraryPresent") is False)
    check("auth_status still says configured=True",
          out["status"].get("configured") is True,
          "the confusing case: configured but unusable, which is exactly why the flag exists")
    check("the intake Warehouse reports itself disabled", out.get("intake_enabled") is False)

    print("\n[3] ⚠️ it refuses, and refuses with the RIGHT code")
    check("validate_bearer did NOT return a principal", "validate_result" not in out,
          out.get("validate_result"))
    check("validate_bearer raised 503, not 401", out.get("validate_status") == 503,
          out.get("validate_status"))
    check("the 503 names the missing package",
          "pyjwt" in str(out.get("validate_detail", "")).lower(), out.get("validate_detail"))

    print("\n[4] and the same is true through a real HTTP request")
    check("GET /api/me with a token returns 503", out.get("me_status") == 503, out.get("me_status"))
    check("the response body names the cause",
          "pyjwt" in out.get("me_body", "").lower(), out.get("me_body"))
    check("GET /api/me with NO token is still refused",
          out.get("me_no_header_status") in (401, 403, 503), out.get("me_no_header_status"))
    check("no route answered 200 while unable to verify anything",
          out.get("me_status") != 200 and out.get("me_no_header_status") != 200)

    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {', '.join(FAILURES)}")
        return 1
    print("a missing crypto library disables the feature, not the server, and never opens the door")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
