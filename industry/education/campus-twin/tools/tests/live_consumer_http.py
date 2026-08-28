"""Start the consumer app on a real socket and talk to it over HTTP.

⚠️ EVERY TEST SO FAR RUNS THROUGH STARLETTE'S `TestClient`, WHICH IS IN-PROCESS. That proves the
router logic and proves nothing about whether the thing starts, binds, serialises over the wire and
answers a browser's preflight. `intake_app.py` carries the same warning for the same reason.

    python tools/tests/live_consumer_http.py
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

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name} {detail}")
        FAILURES.append(name)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def get(url: str, headers: dict[str, str] | None = None) -> tuple[int, dict, dict]:
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, dict(r.headers), json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            parsed = {"raw": body[:300]}
        return exc.code, dict(exc.headers), parsed


def options(url: str, request_headers: str) -> tuple[int, dict]:
    """A browser preflight, which is where a missing Authorization header shows up."""
    req = urllib.request.Request(url, method="OPTIONS", headers={
        "Origin": "http://localhost:5173",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": request_headers,
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, dict(r.headers)
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers)


def main() -> int:
    port = free_port()
    base = f"http://127.0.0.1:{port}"

    store_path = ROOT / "temp" / "consumer-probe-store.json"
    store_path.parent.mkdir(parents=True, exist_ok=True)
    if store_path.exists():
        store_path.unlink()

    # ⚠️ A POSITIVE CONTROL, AND THE FILE IS WRONG WITHOUT IT. Every other assertion below expects
    # a REFUSAL, so a server that answered 403 to absolutely everything -- a broken store, a typo
    # in the router prefix, an exception swallowed into a blanket deny -- would pass all of them
    # and look like proof that row-level security works. Seeding one real identity and requiring a
    # 200 with the right teacherId is what makes the refusals mean "refused" rather than "dead".
    os.environ["CAMPUS_INTAKE_DEV_STORE"] = str(store_path)
    sys.path.insert(0, str(ROOT / "server"))
    import dev_store  # noqa: PLC0415

    teachers = json.loads(
        (ROOT / "data" / "synthetic" / "teacher.json").read_text(encoding="utf-8"))
    known_teacher = teachers[0]["teacherId"]
    other_teacher = teachers[1]["teacherId"]
    dev_store.seed_identity("dev", "oth", known_teacher, "teacher",
                            upn="dev@localhost.invalid", is_primary=True)
    print(f"seeded oid=dev -> {known_teacher} at oth (colleague: {other_teacher})")

    env = dict(os.environ)
    env["ENTRA_AUTH_DISABLED"] = "1"
    env["CAMPUS_INTAKE_DEV_STORE"] = str(store_path)
    env["SCHEDULER_SITE"] = "oth"
    env["PYTHONIOENCODING"] = "utf-8"

    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "consumer_app:app",
         "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
        cwd=str(ROOT / "server"), env=env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    try:
        deadline = time.time() + 40
        ready = False
        while time.time() < deadline:
            if proc.poll() is not None:
                print("server exited early:\n" + (proc.stdout.read() if proc.stdout else ""))
                return 1
            try:
                status, _h, _b = get(f"{base}/api/health")
                ready = status == 200
                if ready:
                    break
            except Exception:  # noqa: BLE001
                time.sleep(0.4)
        if not ready:
            print("server never became ready")
            return 1

        print("\n=== it starts and binds ===")
        status, _headers, body = get(f"{base}/api/health")
        check("GET /api/health is 200 without a token", status == 200, str(body)[:160])
        check("health names the surface", body.get("surface") == "consumer", str(body))
        check("health lists exactly the two consumer tools",
              body.get("tools") == ["get_affected_sessions", "get_calendar"], str(body.get("tools")))

        print("\n=== CORS preflight ===")
        # ⚠️ THE HEADER LIST IS THE POINT. A browser refuses to send a header the server did not
        # name, so a missing `Authorization` here fails only from a real browser: curl and every
        # in-process test pass happily.
        code, headers = options(f"{base}/api/me", "authorization,content-type")
        allowed = (headers.get("access-control-allow-headers") or "").lower()
        check("preflight for Authorization is accepted", code in (200, 204), str(code))
        check("Access-Control-Allow-Headers includes authorization",
              "authorization" in allowed, allowed or "(absent)")

        print("\n=== positive control: a mapped person gets their OWN week ===")
        status, _h, body = get(f"{base}/api/me")
        check("GET /api/me is 200 for a seeded identity", status == 200, f"{status} {str(body)[:200]}")
        check("...and reports the seeded teacherId",
              body.get("teacherId") == known_teacher, str(body)[:200])
        check("...and declares scope 'self'", body.get("scope") == "self", str(body)[:200])

        status, _h, week = get(f"{base}/api/me/week")
        check("GET /api/me/week is 200", status == 200, f"{status} {str(week)[:200]}")
        subject_id = (week.get("subject") or {}).get("id") if isinstance(week, dict) else None
        check("...for the caller's own subject", subject_id == known_teacher, str(subject_id))
        entries = week.get("entries") if isinstance(week, dict) else None
        foreign = [e for e in (entries or []) if e.get("teacherId") not in (None, known_teacher)]
        check("...and every entry belongs to the caller",
              not foreign, f"{len(foreign)} foreign row(s)")

        print("\n=== the subject cannot be chosen by the caller ===")
        # ⚠️ THE INJECTED KEY NAMES A REAL COLLEAGUE, not a made-up id. An id that does not exist
        # would be refused by lookup rather than by authorisation, and the test would prove only
        # that the store rejects nonsense.
        status, _h, week2 = get(f"{base}/api/me/week?scope=teacher&key={other_teacher}&draftId=D1")
        check("GET /api/me/week with a REAL colleague's key is still 200",
              status == 200, f"{status} {str(week2)[:160]}")
        subject2 = (week2.get("subject") or {}).get("id") if isinstance(week2, dict) else None
        check("...and still answers about the caller, not the injected colleague",
              subject2 == known_teacher, f"got {subject2}, injected {other_teacher}")

        print("\n=== the planner's leaky route does not exist here ===")
        status, _h, _b = get(f"{base}/api/calendar?scope=teacher&key={other_teacher}")
        check("/api/calendar is not served by the consumer app", status == 404, str(status))

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()

    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {', '.join(FAILURES)}")
        return 1
    print("consumer HTTP: all checks pass")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
