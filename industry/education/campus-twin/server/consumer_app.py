"""A standalone ASGI app for the consumer surface alone.

    uvicorn consumer_app:app --app-dir server --port 8082

⚠️ THIS IS A SEPARATE PROCESS FROM `app.py` FOR A REASON THAT IS NOT TEMPORARY, unlike
`intake_app.py`, which exists mostly because `app.py` is being edited elsewhere. The two surfaces
have incompatible authentication contracts:

  * `app.py` accepts `X-App-Key`, a string compiled into a publicly served JavaScript bundle. Its
    own comment calls it "a speed bump, not auth".
  * Everything here requires `Authorization: Bearer` and a row in `dbo.IntakeIdentity`.

Mounting the consumer router inside `app.py` would put an authenticated surface behind a process
whose CORS policy, key check and error vocabulary were all designed for an unauthenticated one. The
merge should happen only when `app.py` itself requires a token, and at that point this file is what
the merge is FROM rather than a thing to delete quietly.

⚠️ THE CORS HEADER LIST IS THE POINT, not an afterthought. `app.py` allows
`["Content-Type", "X-App-Key"]`, and every endpoint here requires `Authorization`. A browser will
refuse to send a header the server did not name in its preflight response, so omitting it fails
from the cockpit while curl and every in-process test pass. `intake_app.py` learned this the
expensive way; this file inherits the lesson rather than re-earning it.
"""

from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import consumer
import intake_store
from auth import auth_status

ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]

#: Same reasoning as `app.py`: loopback on any port, because Vite moves when its port is taken.
ALLOWED_ORIGIN_REGEX = os.getenv("ALLOWED_ORIGIN_REGEX", r"http://(localhost|127\.0\.0\.1)(:\d+)?")

app = FastAPI(title="Campus-Scheduler consumer", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_methods=["GET", "POST", "OPTIONS"],
    # ⚠️ `Authorization` IS MANDATORY HERE. Removing it does not break a test; it breaks the
    # browser, silently, with a preflight the user never sees.
    allow_headers=["Content-Type", "Authorization"],
)

app.include_router(consumer.router)


@app.get("/api/health")
def health() -> dict[str, object]:
    """Anonymous, and deliberately so: a probe that needs a token cannot report a broken token.

    Reports the identity store's status because every 403 on this surface has the same two
    possible causes from the outside, "you are not mapped" and "the store is unreachable", and the
    first thing anyone does with a 403 is guess which.
    """
    return {
        "ok": True,
        "surface": "consumer",
        "auth": auth_status(),
        "identityStore": intake_store.warehouse_status(),
        "tools": sorted(consumer.CONSUMER_TOOLS),
    }
