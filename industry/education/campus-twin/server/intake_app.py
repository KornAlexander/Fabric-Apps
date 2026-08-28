"""A standalone ASGI app for the intake path alone.

    uvicorn intake_app:app --app-dir server --port 8081

⚠️ THIS IS NOT A SECOND PRODUCTION SURFACE. The intake router belongs in `app.py` alongside the
timetable and the solver, and it will move there. This exists for two reasons that both expire:

  1. `server/app.py` is being edited by other work right now, so `include_router` cannot be added
     without stepping on it.
  2. Everything tested so far runs through Starlette's `TestClient`, which is in-process. A real
     uvicorn on a real socket is the only way to find out whether the thing actually starts, binds,
     serialises over the wire and answers a browser preflight correctly.

⚠️ THE CORS HEADER LIST IS THE POINT, not an afterthought. `app.py` currently allows
`["Content-Type", "X-App-Key"]`, and every endpoint here requires `Authorization: Bearer`. A
browser will refuse to send a header the server did not name in the preflight response, so the
whole feature fails from the cockpit while curl and every in-process test pass. `tools/tests/
test_intake_server.py` carries a tripwire that fires if the router is ever mounted in `app.py`
while that list is still missing `Authorization`.
"""

from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import intake
import intake_store
from auth import auth_status

ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]

#: Same reasoning as `app.py`: loopback on any port, because Vite moves when its port is taken.
ALLOWED_ORIGIN_REGEX = os.getenv("ALLOWED_ORIGIN_REGEX", r"http://(localhost|127\.0\.0\.1)(:\d+)?")

app = FastAPI(title="Campus-Scheduler intake", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_methods=["GET", "POST", "OPTIONS"],
    # ⚠️ `Authorization` IS MANDATORY HERE. Removing it does not break a test; it breaks the
    # browser, silently, with a preflight the user never sees.
    allow_headers=["Content-Type", "Authorization"],
)

app.include_router(intake.router)


@app.get("/api/health")
def health() -> dict[str, object]:
    """Booleans only (§44.4 row 9), but enough to tell why the feature is refusing.

    ⚠️ Anonymous, and deliberately so: the three reasons intake returns 503 (no crypto library, no
    tenant configured, no store) are otherwise indistinguishable from the outside, and the first
    thing anyone does with a 503 is guess.
    """
    return {"ok": True, "auth": auth_status(), "intake": intake_store.warehouse_status()}
