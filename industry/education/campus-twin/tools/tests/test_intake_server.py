"""Over a real socket, in a real server process. Everything else has been in-process.

    python tools\\tests\\test_intake_server.py

⚠️ `TestClient` IS NOT A SERVER. It calls the ASGI app directly, which means six passing suites
still say nothing about whether the process starts, whether the port binds, whether responses
serialise over the wire, or whether a browser is allowed to send the one header the entire feature
depends on. Those are exactly the failures that only appear in front of a user.

The CORS check is the reason this file exists. `app.py` allows `["Content-Type", "X-App-Key"]`.
Every intake endpoint requires `Authorization: Bearer`. A browser will not send a header the
server did not name in its preflight response, so the cockpit would get nothing while curl and
every in-process test stayed green. Section [4] is a tripwire for that.
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
import re
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PY = sys.executable

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
        return s.getsockname()[1]


def request(method: str, url: str, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, dict(r.headers), r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode()


def main() -> int:
    store = Path(tempfile.gettempdir()) / "campus_intake_server.json"
    store.unlink(missing_ok=True)

    # Seed identities BEFORE the server starts.
    # ⚠️ THE OID MUST BE "dev". With `ENTRA_AUTH_DISABLED=1`, `auth.require_user` returns a fixed
    # `Principal(oid="dev", tid="dev", ...)`, so EVERY caller collapses into one identity. Seeding
    # "oid-prof" produced a 403 and looked like a broken router. That collapse is the whole reason
    # the flag must never be set in production, and section [1] now asserts health admits to it.
    sys.path.insert(0, str(ROOT / "server"))
    os.environ["CAMPUS_INTAKE_DEV_STORE"] = str(store)
    import dev_store
    # ⚠️ A teacher who REALLY EXISTS at `oth`, and `Fr` is genuinely their busiest day. This used
    # to seed `T-042`, which looks like `M-T042` with the faculty prefix dropped, and no such
    # person is in the OTH dataset. `get_affected_sessions` answered `teacher_not_found`, the
    # router read only the `sessions` key and priced the change at **zero**, and this test then
    # asserted a successful preview whose number was about nobody. It was green for as long as
    # both bugs existed. Found 2026-08-22 when the router started refusing that refusal.
    dev_store.seed_identity("dev", "oth", "M-T042", "teacher", "prof.müller@hs.de")

    port = free_port()
    env = {
        **os.environ,
        "CAMPUS_INTAKE_DEV_STORE": str(store),
        "ENTRA_AUTH_DISABLED": "1",           # a real token flow needs a real tenant
        # ⚠️ The umlaut has to ride on the PRINCIPAL, not on the seeded identity row: the queue
        # returns `submittedByUpn` from the token, and the identity table's own `upn` column is
        # never sent anywhere. Asserting on the seeded value tested nothing that crossed the wire.
        "ENTRA_DEV_UPN": "prof.müller@hs.de",
        "PYTHONUNBUFFERED": "1",
        "PYTHONIOENCODING": "utf-8",
    }
    proc = subprocess.Popen(
        [PY, "-m", "uvicorn", "intake_app:app", "--app-dir", "server",
         "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
        cwd=str(ROOT), env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    base = f"http://127.0.0.1:{port}"

    try:
        print("\n[1] the process actually starts and binds")
        started = False
        for _ in range(60):
            if proc.poll() is not None:
                break
            try:
                if request("GET", f"{base}/api/health")[0] == 200:
                    started = True
                    break
            except Exception:
                time.sleep(0.25)
        if not started:
            out = proc.stdout.read() if proc.stdout else ""
            check("uvicorn serves /api/health", False, f"rc={proc.poll()}\n{out[-1500:]}")
            return 1
        check("uvicorn serves /api/health", True)

        status, _, body = request("GET", f"{base}/api/health")
        health = json.loads(body)
        check("health says the intake store is configured",
              health["intake"]["configured"] is True, health)
        check("health names the backend, so a vanished write is explainable",
              health["intake"]["backend"] == "dev-file", health)
        check("health reports whether the crypto library is present",
              "libraryPresent" in health["auth"], health)
        check("⚠️ health admits that auth is disabled, since that collapses every user into one",
              health["auth"]["disabled"] is True, health["auth"])
        check("⚠️ health leaks no audience or tenant id",
              not re.search(r"api://|[0-9a-f]{8}-[0-9a-f]{4}", body), body)

        print("\n[2] the flow works over the wire, not just in-process")
        s, _, b = request("POST", f"{base}/api/intake/preview",
                          {"kind": "availability", "day": "Fr"})
        check("preview returns 200 over HTTP", s == 200, f"{s} {b[:200]}")
        pv = json.loads(b)
        check("the JSON survived serialisation", isinstance(pv.get("previewId"), str), pv)

        s, _, b = request("POST", f"{base}/api/intake/submit",
                          {"kind": "availability", "previewId": pv["previewId"],
                           "utterance": "Freitag nicht, weil ich pflegen muss"})
        check("submit returns 200 over HTTP", s == 200, f"{s} {b[:200]}")
        req_id = json.loads(b).get("requestId")

        disk = store.read_text(encoding="utf-8")
        check("⚠️ the free text did not reach the disk via the real server",
              "pflegen" not in disk.lower(), "the field is dropped at the model boundary")

        print("\n[3] German text survives the round trip")
        # ⚠️ A UTF-8 mistake in the response encoding shows up here and nowhere else: TestClient
        # hands back Python objects, so mojibake has no opportunity to appear.
        #
        # ⚠️ DO NOT ASSERT `charset=utf-8` ON THE CONTENT TYPE. `application/json` is UTF-8 by
        # definition (RFC 8259) and the charset parameter is obsolete for it, so Starlette omits it
        # correctly. An earlier version of this test demanded it and failed the server for being
        # right. Prove the encoding with bytes instead of with a header.
        s, _, b = request("POST", f"{base}/api/intake/preview",
                          {"kind": "availability", "day": "Fr"})
        pv2 = json.loads(b)
        request("POST", f"{base}/api/intake/submit",
                {"kind": "availability", "previewId": pv2["previewId"]})

        s, hdrs, b = request("GET", f"{base}/api/intake/mine")
        check("mine returns 200", s == 200, f"{s} {b[:160]}")
        check("the content type is application/json",
              "application/json" in hdrs.get("content-type", "").lower(), hdrs.get("content-type"))
        # The seeded UPN carries an umlaut, so this is real data crossing the wire.
        check("real umlauts survive the wire, not as mojibake",
              "müller" in b.lower() and "Ã" not in b, b[:260])
        check("the second request is listed too", b.count("requestId") >= 2, b[:200])
        print("\n[4] ⚠️ CORS: can a browser send the header the feature requires?")
        s, hdrs, _ = request("OPTIONS", f"{base}/api/intake/preview", None, {
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        })
        allowed = hdrs.get("access-control-allow-headers", "").lower()
        check("preflight is answered", s in (200, 204), s)
        check("Authorization is allowed by THIS app", "authorization" in allowed, allowed)
        check("the origin is echoed back",
              hdrs.get("access-control-allow-origin") == "http://localhost:5173",
              hdrs.get("access-control-allow-origin"))

        # The tripwire. Today `app.py` does not mount the router, so this passes and only warns.
        # The day somebody adds `include_router` without adding the header, it goes red and says
        # exactly what to change, instead of the cockpit silently receiving nothing.
        app_py = (ROOT / "server" / "app.py").read_text(encoding="utf-8")
        mounted = "intake.router" in app_py or "intake_router" in app_py
        m = re.search(r"allow_headers\s*=\s*\[([^\]]*)\]", app_py)
        app_allows_auth = bool(m and "authorization" in m.group(1).lower())
        if mounted:
            check("⚠️ app.py mounts intake AND allows Authorization", app_allows_auth,
                  "add \"Authorization\" to allow_headers in server/app.py, or every browser "
                  "call to /api/intake/* fails the CORS preflight")
        else:
            check("app.py does not mount intake yet, so its CORS list is not yet load bearing", True)
            if not app_allows_auth:
                print("        NOTE: server/app.py allow_headers = "
                      f"[{(m.group(1).strip() if m else '?')}]")
                print("              It has no `Authorization`. Add it in the SAME change that")
                print("              adds include_router(intake.router), or the cockpit gets")
                print("              nothing while curl and every in-process test stay green.")

        print("\n[5] refusals still refuse over HTTP")
        s, _, b = request("POST", f"{base}/api/intake/submit", {"kind": "availability"})
        check("submit without a previewId is 400", s == 400, f"{s} {b[:160]}")
        s, _, _ = request("POST", f"{base}/api/intake/submit",
                          {"kind": "availability", "previewId": pv["previewId"]})
        check("the used preview cannot be replayed over HTTP", s == 409, s)
        s, _, _ = request("GET", f"{base}/api/intake/queue")
        check("a teacher is refused the queue over HTTP", s == 403, s)

        # Promote the SAME principal and re-check: this proves the role gate reads the store per
        # request rather than caching a decision made at start-up.
        dev_store.seed_identity("dev", "oth", "T-001", "planner", "prof@hs.de")
        s, _, b = request("GET", f"{base}/api/intake/queue")
        check("after promotion the same caller may read the queue", s == 200, f"{s} {b[:160]}")
        check("the queue really contains the submitted request", req_id in b, b[:200])

        s, _, b = request("POST", f"{base}/api/intake/{req_id}/decide", {"accept": True})
        check("the planner can decide over HTTP", s == 200, f"{s} {b[:160]}")
        check("⚠️ accepting still reports published=false",
              json.loads(b).get("published") is False, b[:160])

        s, _, _ = request("GET", f"{base}/api/does-not-exist")
        check("an unknown route is 404, not a stack trace", s == 404, s)
        check("a request was really recorded", bool(req_id))

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        store.unlink(missing_ok=True)

    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {', '.join(FAILURES)}")
        return 1
    print("the intake path runs as a real server and a browser may talk to it")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
