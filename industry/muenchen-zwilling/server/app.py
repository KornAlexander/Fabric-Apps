"""HTTP surface for the München Zwilling agent and coordination notes.

⚠️ THE SAME SECURITY POSTURE AS `relay/server.mjs`, AND FOR THE SAME REASONS. A fixed origin
allow-list of exact strings, a shared app key that is a cost and abuse limiter rather than a
secret, and a per-address rate limit. This service is reachable from the public internet because
the Fabric App's browser has to call it; none of the above is authentication, and nothing here
pretends otherwise.

⚠️ WRITES ARE NOT AUTHENTICATED BY THIS SERVICE, AND THAT IS STATED RATHER THAN HIDDEN. Rayfin's
browser auth yields a Rayfin session, not an access token for this API's audience, so the author
name arrives as a client-reported string. The note table names that column `autorGemeldet` and the
UI labels it as reported. Anything that needs real provenance needs a real token first.
"""

from __future__ import annotations

import json
import os
import time
from collections import deque
from typing import Any, Iterator

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

import entra
import foundry
import notes_store
import sources
import tools

#: ⚠️ EXACT STRINGS, NEVER A SUFFIX TEST. `endswith('.fabricapps.net')` also accepts
#: `evil-fabricapps.net`, which is the classic way an origin allow-list becomes no allow-list.
ALLOWED_ORIGINS = [
    o.strip() for o in os.getenv(
        "ALLOWED_ORIGINS",
        "",
    ).split(",") if o.strip()
]

APP_KEY = os.getenv("BACKEND_APP_KEY", "").strip()

RATE_LIMIT = int(os.getenv("AGENT_CALLS_PER_HOUR", "120"))
_WINDOW_SECONDS = 3600
_calls: dict[str, deque[float]] = {}
MAX_TRACKED = 5000

app = FastAPI(title="München Zwilling Agent", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-App-Key", "X-Autor", "Authorization"],
)


def _caller(request: Request) -> str:
    """⚠️ THE RIGHTMOST X-Forwarded-For VALUE. Container Apps ingress APPENDS the observed client
    address to whatever the caller sent, so the trustworthy entry is the last one. Reading the
    first lets the caller pick it, and a limiter keyed on attacker-supplied text is not a limiter.
    """
    forwarded = request.headers.get("x-forwarded-for", "")
    parts = [p.strip() for p in forwarded.split(",") if p.strip()]
    if parts:
        return parts[-1]
    return request.client.host if request.client else "unknown"


def _check_key(x_app_key: str | None) -> None:
    if not APP_KEY:
        return
    if x_app_key != APP_KEY:
        raise HTTPException(status_code=401, detail="app key missing or wrong")


def _check_rate(request: Request) -> None:
    now = time.monotonic()
    key = _caller(request)
    bucket = _calls.setdefault(key, deque())
    while bucket and now - bucket[0] > _WINDOW_SECONDS:
        bucket.popleft()
    if len(bucket) >= RATE_LIMIT:
        raise HTTPException(status_code=429, detail="rate limit")
    bucket.append(now)
    # ⚠️ EVICTS BY AGE, NOT BY EMPTINESS. The previous version looked for empty buckets to drop,
    # and a bucket is only emptied when its own owner comes back — so under a spray of distinct
    # addresses there were never any empty ones and the map grew without bound. Dropping the
    # oldest entries is what actually holds the ceiling.
    if len(_calls) > MAX_TRACKED:
        stale = sorted(_calls, key=lambda k: _calls[k][-1] if _calls[k] else 0.0)
        for address in stale[: len(_calls) - MAX_TRACKED + 500]:
            _calls.pop(address, None)


def _autor(header: str | None) -> str | None:
    """The signed-in user as REPORTED BY THE CLIENT. Trimmed and bounded, never trusted."""
    text = (header or "").strip()
    return text[:256] or None


def _resolve_autor(authorization: str | None, x_autor: str | None) -> tuple[str | None, bool]:
    """Return (author, verified) for a write.

    A verified Entra token always wins over the client-supplied header, so a caller cannot claim
    somebody else's name simply by also sending one. When enforcement is on, an unverified write
    is refused outright rather than silently downgraded.
    """
    verified_author, _claims = entra.verify(authorization)
    if verified_author:
        return verified_author, True
    if entra.REQUIRE_AUTH:
        raise HTTPException(
            status_code=401,
            detail="Anmeldung erforderlich. Bitte in der Anwendung anmelden und erneut speichern.",
        )
    return _autor(x_autor), False


@app.get("/health")
def health() -> dict[str, Any]:
    """Deliberately independent of every upstream, so it answers while sources are down."""
    return {
        "status": "ok",
        "foundry": foundry.configured(),
        "notizen": notes_store.enabled(),
        "anmeldung": entra.health(),
        "werkzeuge": sorted(tools.REGISTRY),
    }


@app.post("/api/assistant/stream")
async def assistant_stream(request: Request, x_app_key: str | None = Header(default=None)):
    _check_key(x_app_key)
    _check_rate(request)
    body = await request.json()
    prompt = str((body or {}).get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt fehlt")
    if len(prompt) > 4000:
        raise HTTPException(status_code=400, detail="prompt zu lang")

    def events() -> Iterator[bytes]:
        yield _line({"type": "status", "message": "Frage wird anhand der Quellen geprüft ..."})
        for event in foundry.stream_with_tools(prompt, tools.run):
            yield _line(event)

    return StreamingResponse(events(), media_type="application/x-ndjson")


def _line(event: dict[str, Any]) -> bytes:
    return (json.dumps(event, ensure_ascii=False) + "\n").encode("utf-8")


@app.post("/api/tools/{name}")
def run_tool(name: str, request: Request, payload: dict | None = None,
             x_app_key: str | None = Header(default=None)):
    """Every tool, callable without the agent.

    ⚠️ THIS IS THE POINT, NOT A DEBUG LEFTOVER. Somebody who does not believe what the chat said
    can press a button and get the same numbers from the same function. An assistant whose claims
    cannot be checked independently is not usable in front of the organisations that own the data.

    ⚠️ `def`, NOT `async def`, AND THE DIFFERENCE IS THE WHOLE SERVICE. The work below is
    synchronous HTTP and ODBC. Inside an `async` handler that runs ON the event loop, so one cold
    air-quality call — measured at up to 75 seconds against the Umweltbundesamt catalogue — would
    freeze every other request, health probes included, on a single-replica container. Declaring
    the handler sync makes Starlette run it in a threadpool instead.
    """
    _check_key(x_app_key)
    _check_rate(request)
    if name not in tools.REGISTRY:
        raise HTTPException(status_code=404, detail="unbekanntes Werkzeug")
    return JSONResponse(tools.run(name, payload or {}))


@app.get("/api/notizen")
def list_notes(
    request: Request,
    baustelle_id: str | None = None,
    limit: int = 100,
    x_app_key: str | None = Header(default=None),
):
    # Sync for the same reason as the tool route: ODBC blocks.
    _check_key(x_app_key)
    _check_rate(request)
    if not notes_store.enabled():
        return JSONResponse({"eintraege": [], "verfuegbar": False})
    try:
        rows = notes_store.list_notes(baustelle_id=baustelle_id, limit=limit)
    except notes_store.StoreUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"Notizspeicher nicht erreichbar: {exc}")
    return JSONResponse({"eintraege": rows, "verfuegbar": True})


@app.post("/api/notizen")
def create_note(
    request: Request,
    payload: dict,
    x_app_key: str | None = Header(default=None),
    x_autor: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
):
    """A note the user composed in the app."""
    _check_key(x_app_key)
    _check_rate(request)
    if not notes_store.enabled():
        raise HTTPException(status_code=503, detail="Notizspeicher ist nicht konfiguriert")
    autor, verified = _resolve_autor(authorization, x_autor)
    body = payload or {}
    try:
        result = notes_store.create_note(
            baustelle_id=str(body.get("baustelleId") or ""),
            ort=str(body.get("ort") or ""),
            easting=body.get("easting"),
            northing=body.get("northing"),
            kategorie=str(body.get("kategorie") or ""),
            text=str(body.get("text") or ""),
            autor_gemeldet=autor,
            zeitraum_von=body.get("zeitraumVon"),
            zeitraum_bis=body.get("zeitraumBis"),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except notes_store.StoreUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"Notizspeicher nicht erreichbar: {exc}")
    result["autorGeprueft"] = verified
    return JSONResponse(result)


@app.post("/api/notizen/entwurf/{entwurf_id}/speichern")
def publish_draft(
    entwurf_id: str,
    request: Request,
    x_app_key: str | None = Header(default=None),
    x_autor: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
):
    """Turn an agent draft into a stored note.

    ⚠️ THE ONLY PATH FROM A MODEL SUGGESTION TO A STORED ROW, and it is reached exclusively by a
    person clicking. The agent cannot call it: it is not in the tool registry.
    """
    _check_key(x_app_key)
    _check_rate(request)
    if not notes_store.enabled():
        raise HTTPException(status_code=503, detail="Notizspeicher ist nicht konfiguriert")
    autor, verified = _resolve_autor(authorization, x_autor)
    try:
        result = notes_store.publish_draft(entwurf_id, autor)
    except notes_store.StoreUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"Notizspeicher nicht erreichbar: {exc}")
    if not result.get("ok"):
        raise HTTPException(status_code=409, detail=result.get("grund", "Entwurf nicht gültig"))
    result["autorGeprueft"] = verified
    return JSONResponse(result)


@app.post("/api/notizen/{notiz_id}/zurueckziehen")
def withdraw_note(
    notiz_id: str,
    request: Request,
    x_app_key: str | None = Header(default=None),
    x_autor: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
):
    _check_key(x_app_key)
    _check_rate(request)
    if not notes_store.enabled():
        raise HTTPException(status_code=503, detail="Notizspeicher ist nicht konfiguriert")
    autor, _verified = _resolve_autor(authorization, x_autor)
    try:
        result = notes_store.withdraw_note(notiz_id, autor)
    except notes_store.StoreUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"Notizspeicher nicht erreichbar: {exc}")
    # ⚠️ A REFUSED WITHDRAWAL IS A 403, NOT A QUIET "ok": false. Returning 200 for "you may not
    # remove somebody else's note" reads to the client exactly like success.
    if not result.get("ok") and result.get("grund") == "fremde_notiz":
        raise HTTPException(status_code=403, detail="Nur die anlegende Person kann diese Notiz zurückziehen.")
    return JSONResponse(result)


@app.on_event("startup")
def _startup() -> None:
    """Apply the schema once, and say plainly when the store is absent.

    ⚠️ A FAILURE HERE MUST NOT KILL THE PROCESS. The agent half is useful without the notes half,
    and a container that refuses to start because a database is paused takes the whole assistant
    down with it.
    """
    if not notes_store.enabled():
        print("notes store: not configured (ZWILLING_NOTES_ODBC unset)", flush=True)
        return
    try:
        notes_store.ensure_schema()
        print("notes store: schema ready", flush=True)
    except Exception as exc:  # noqa: BLE001
        print(f"notes store: schema not applied ({exc})", flush=True)
