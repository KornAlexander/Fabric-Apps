"""Serve the intake app with uvicorn and talk to it over a real socket.

⚠️ Every other test in this folder uses `TestClient`, which calls the ASGI app in-process. That is
fine for logic and blind to everything around it: the server never starts, no HTTP is parsed, no
CORS preflight is answered by the middleware stack in the order a browser triggers it, and a
start-up failure looks like an import error rather than a container that crash-loops.

This one boots `uvicorn` in a subprocess on an ephemeral port and uses stdlib `urllib`, so it adds
no dependency and cannot accidentally share state with the app under test.

The four things it settles, all of which are shapes the deployed container will really be in:

  1. `/api/health` answers ANONYMOUSLY. If it needed a token, every liveness probe would fail and
     Container Apps would restart a healthy revision forever.
  2. The CORS preflight allows `Authorization`. ⚠️ This is the failure described in §47.2 item 4:
     `curl` stays green while every browser call dies, because curl does not preflight.
  3. No token is 401, not 500 and not 200.
  4. A garbage token is 401 with a COARSE message, so the endpoint is not an oracle telling an
     attacker which part of their token was wrong.
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
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SERVER = ROOT / "server"

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: object = "") -> None:
    print(f"  {'ok ' if condition else 'FAIL'} {name}" + (f"  [{detail}]" if detail else ""))
    if not condition:
        FAILURES.append(name)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def request(url: str, *, method: str = "GET", headers: dict[str, str] | None = None):
    req = urllib.request.Request(url, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, dict(resp.headers), resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers), exc.read().decode("utf-8", "replace")


def main() -> int:
    port = free_port()
    base = f"http://127.0.0.1:{port}"

    env = dict(os.environ)
    # Configured, so a rejected token is a 401 about the token and not a 503 about the server.
    #
    # ⚠️ THIS GUID IS DELIBERATELY SYNTHETIC AND MUST STAY THAT WAY. It used to be a real
    # demo tenant's id, which tools/verify_publishable.py correctly failed the build over: the
    # test needs the server to believe it is CONFIGURED, and any well-formed guid does that.
    # Nothing here authenticates against anything, no token is ever issued for this tenant, and
    # the assertions below are all about a token being REJECTED. A real identifier bought the
    # test nothing and put a live tenant id in a repository that ships as a template.
    env["ENTRA_TENANT_IDS"] = "11111111-2222-3333-4444-555555555555"
    env["ENTRA_API_AUDIENCE"] = "api://campus-scheduler-test/access"
    env["CAMPUS_INTAKE_DEV_STORE"] = str(ROOT / "temp" / "http-probe-store.json")
    env["PYTHONIOENCODING"] = "utf-8"
    env.pop("ENTRA_AUTH_DISABLED", None)

    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "intake_app:app",
         "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
        cwd=str(SERVER), env=env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )

    try:
        # Poll for readiness rather than sleeping a guessed amount.
        ready = False
        deadline = time.time() + 30
        while time.time() < deadline:
            if proc.poll() is not None:
                print("server exited before it was ready:")
                print(proc.stdout.read() if proc.stdout else "(no output)")
                return 1
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                    ready = True
                    break
            except OSError:
                time.sleep(0.2)
        check("uvicorn actually starts and binds", ready)
        if not ready:
            return 1

        print()
        status, _, body = request(f"{base}/api/health")
        check("/api/health answers anonymously", status == 200, status)
        try:
            health = json.loads(body)
        except json.JSONDecodeError:
            health = {}
            check("/api/health returns JSON", False, body[:120])
        check("health reports the auth and intake subsystems",
              {"auth", "intake"} <= set(health), sorted(health))

        # 2. The preflight a browser sends before any authenticated call.
        # ⚠️ The origin must be one the app really allows. The first version of this test used
        # `https://example.invalid` and read the resulting 400 as a bug in the app. It is not:
        # Starlette refuses an unknown origin and STILL returns the computed allow-headers, so the
        # header assertions passed while the preflight itself had failed. Both directions are
        # checked now, because "allows the right origin" and "refuses the wrong one" are two
        # different promises and only one of them was being made.
        good_origin = "http://localhost:5173"
        status, headers, _ = request(
            f"{base}/api/intake/preview",
            method="OPTIONS",
            headers={
                "Origin": good_origin,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )
        allowed = headers.get("access-control-allow-headers", "").lower()
        check("the CORS preflight succeeds for an allowed origin", status in (200, 204), status)
        check("the preflight echoes the allowed origin",
              headers.get("access-control-allow-origin") == good_origin,
              headers.get("access-control-allow-origin"))
        check("the preflight allows Authorization", "authorization" in allowed, allowed or "(none)")
        check("the preflight allows Content-Type", "content-type" in allowed, allowed or "(none)")
        check("the preflight allows POST",
              "post" in headers.get("access-control-allow-methods", "").lower(),
              headers.get("access-control-allow-methods"))

        status, headers, _ = request(
            f"{base}/api/intake/preview",
            method="OPTIONS",
            headers={
                "Origin": "https://not-our-app.invalid",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization",
            },
        )
        check("an unknown origin is refused", status == 400, status)
        check("an unknown origin gets no allow-origin header",
              "access-control-allow-origin" not in {k.lower() for k in headers},
              headers.get("access-control-allow-origin"))

        # 3 and 4. Authentication over real HTTP.
        status, _, body = request(f"{base}/api/me")
        check("no token is 401, not 500 and not 200", status == 401, status)

        status, _, body = request(
            f"{base}/api/me", headers={"Authorization": "Bearer not.a.token"}
        )
        check("a malformed token is 401", status == 401, status)
        detail = json.loads(body).get("detail", "") if body.startswith("{") else body
        check("the 401 does not explain WHICH check failed",
              not any(w in str(detail).lower()
                      for w in ("signature", "audience", "issuer", "expired", "tenant", "scope")),
              detail)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        store = ROOT / "temp" / "http-probe-store.json"
        if store.exists():
            store.unlink()

    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {FAILURES}")
        return 1
    print("OK - the app serves over real HTTP, survives a browser preflight, and refuses "
          "unauthenticated callers")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
