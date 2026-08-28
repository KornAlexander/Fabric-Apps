"""Delegated Entra ID token validation for the Campus-Scheduler backend.

PLAN §44 item 1, and the specification in §41.8. §15.1 decided on 2026-08-02 to "put the backend
behind Entra" and the sentence has been written down twice since without being built; this is the
build.

⚠️ THIS IS NOT THE APP KEY, AND IT DOES NOT REPLACE IT IN THIS FILE. `X-App-Key` stays where it is
in `app.py` as a crude per-caller throttle. What this module adds is the thing the app key cannot
be: a verified identity. §15.1's own argument is the point — an audit row is only worth writing if
the name in it was not typed by the thing being audited.

    from auth import Principal, require_user
    @router.get("/api/me")
    def me(user: Principal = Depends(require_user)) -> dict: ...

⚠️ FAILS CLOSED. An unconfigured deployment refuses every request rather than waving them through.
That is the opposite of the app-key gate above it, which defaults open so local development works,
and the difference is deliberate: a missing throttle is an inconvenience, a missing identity check
on a write endpoint is the defect §44 exists to record.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Any

import httpx
from fastapi import Depends, Header, HTTPException

# ⚠️ PyJWT IS IMPORTED DEFENSIVELY, AND THIS IS NOT DEFENSIVE PROGRAMMING FOR ITS OWN SAKE.
# `pyjwt[crypto]` is not yet in `server/requirements.txt`. A plain module-level `import jwt` means
# that the moment someone adds `app.include_router(intake.router)` to `app.py`, the ENTIRE backend
# fails at import time: no timetable, no solver, no cockpit, for every university on the image.
# The Dockerfile records what that looks like from outside: "a startup probe failing 1 400 times
# with no replica left alive to read a log from".
#
# A missing dependency must therefore disable THIS FEATURE, not the server. Every auth-requiring
# route then answers 503 with a sentence naming the missing package, which is a diagnosable
# afternoon instead of an outage. ⚠️ Note what this does NOT do: it never falls through to
# allowing the request. Absent crypto means no requests, not free requests.
try:
    import jwt
    from jwt import PyJWKClient

    JWT_AVAILABLE = True
except ImportError:  # pragma: no cover - exercised by test_auth_degradation.py
    jwt = None  # type: ignore[assignment]
    PyJWKClient = None  # type: ignore[assignment]
    JWT_AVAILABLE = False

# --------------------------------------------------------------------------------------------
# Configuration. §15.1: "Building the token check as configuration (tenant, audience) rather than
# as a constant is the difference between doing this once and doing it twice." OTH and LMU will
# eventually authenticate against different tenants, and §41.5 route C may put the Copilot users
# in a third one while the backend stays where it is.
# --------------------------------------------------------------------------------------------

#: Tenants whose tokens this deployment accepts. Comma separated GUIDs. Empty means none.
ALLOWED_TENANTS = [t.strip().lower() for t in os.getenv("ENTRA_TENANT_IDS", "").split(",") if t.strip()]

#: The audience THIS API expects. ⚠️ The API's own app ID URI or client id, never the client's.
#: Accepting the client's audience would accept any token that client can obtain for anything,
#: which is the single most common way this check is written wrongly.
API_AUDIENCE = os.getenv("ENTRA_API_AUDIENCE", "").strip()

#: The delegated scope the caller must carry, e.g. "access_as_user".
REQUIRED_SCOPE = os.getenv("ENTRA_REQUIRED_SCOPE", "access_as_user").strip()

#: ⚠️ Azure Container Apps sets these. Their presence means this is not somebody's laptop.
IN_CONTAINER_APPS = bool(os.getenv("CONTAINER_APP_NAME") or os.getenv("CONTAINER_APP_REVISION"))

#: ⚠️ The only way to turn the check off, and it has to be said out loud in the environment.
#: There is no "if unconfigured then allow" branch anywhere in this file.
_AUTH_DISABLED_REQUESTED = os.getenv("ENTRA_AUTH_DISABLED", "").lower() in {"1", "true", "yes"}

#: ⚠️ AND IT IS IGNORED IN A DEPLOYED CONTAINER, WHATEVER THE ENVIRONMENT SAYS.
#: With the flag honoured, `require_user` returns a fixed `Principal(oid="dev")` and no bearer
#: token is required at all. If `TeacherIdentity` happens to hold a `dev` row, an anonymous caller
#: from the internet becomes that person; if that row is a planner, they can read the whole queue
#: and decide requests. Every audit row would then name `dev@localhost.invalid`, which is to say
#: the audit trail would be worthless precisely when it mattered.
#:
#: One mistyped environment variable on one revision should not be able to do that, so the flag is
#: refused here rather than trusted to be set correctly. ⚠️ REFUSED, NOT FATAL: crashing the process
#: would take the timetable, the solver and the cockpit down to disable one feature, which is the
#: same mistake as the `import jwt` crash loop. Auth simply switches back on.
AUTH_DISABLED = _AUTH_DISABLED_REQUESTED and not IN_CONTAINER_APPS

#: True when someone asked for the bypass somewhere it cannot be granted. Surfaced by
#: `auth_status()` so a confused deployment can be diagnosed by looking instead of guessing.
AUTH_BYPASS_REFUSED = _AUTH_DISABLED_REQUESTED and IN_CONTAINER_APPS

#: Identity used when the check is explicitly disabled, so local development has a principal to
#: attribute writes to. It is deliberately obviously fake.
DEV_PRINCIPAL_UPN = os.getenv("ENTRA_DEV_UPN", "dev@localhost.invalid")

_JWKS_TTL_SECONDS = 3600
_jwks_clients: dict[str, tuple[float, Any]] = {}


@dataclass(frozen=True)
class Principal:
    """Who the caller is, according to a signature rather than according to the caller."""

    #: Immutable per-user-per-tenant object id. ⚠️ Key `TeacherIdentity` on THIS, not on the UPN:
    #: a UPN can be renamed, and a renamed professor must not silently become a different person.
    oid: str
    tid: str
    upn: str
    name: str
    scopes: tuple[str, ...]

    @property
    def is_dev(self) -> bool:
        return self.tid == "dev"


def _issuer(tenant_id: str) -> str:
    return f"https://login.microsoftonline.com/{tenant_id}/v2.0"


def _jwks_client(tenant_id: str) -> Any:
    """Signing keys for one tenant, cached for an hour.

    Cached because a JWKS fetch per request would put a network round trip in front of every call,
    and rotated on a TTL because Entra rolls its signing keys and a permanently cached key set
    turns into a total outage on the day it happens.
    """
    now = time.time()
    hit = _jwks_clients.get(tenant_id)
    if hit and now - hit[0] < _JWKS_TTL_SECONDS:
        return hit[1]
    client = PyJWKClient(
        f"https://login.microsoftonline.com/{tenant_id}/discovery/v2.0/keys",
        cache_keys=True,
    )
    _jwks_clients[tenant_id] = (now, client)
    return client


def _unauthorised(reason: str) -> HTTPException:
    """401 with a reason that is useful in a log and useless to an attacker.

    ⚠️ The reason is deliberately coarse. "bad audience" tells a caller which of their several
    tokens to try next; "invalid token" does not.
    """
    return HTTPException(status_code=401, detail="invalid token", headers={"WWW-Authenticate": "Bearer"})


def validate_bearer(token: str) -> Principal:
    """Verify one bearer token and return who it belongs to. Raises 401 otherwise.

    The checks, in the order §41.8 lists them:

    1. signature, against the issuing tenant's published JWKS
    2. `aud` equals this API's audience
    3. `iss` is the v2.0 issuer for the tenant in the token
    4. `tid` is in the allow-list
    5. `exp` and `nbf` (PyJWT enforces these when decoding)
    6. ⚠️ the token is DELEGATED, not application-only
    7. the required delegated scope is present
    """
    if not JWT_AVAILABLE:
        # ⚠️ 503, NOT 401 AND NOT A PASS. The caller's token may be perfectly good; this server
        # cannot check it. Saying 401 would send a professor off to re-authenticate against a
        # problem that is ours, and the detail names the fix so it is not a mystery.
        raise HTTPException(
            status_code=503,
            detail="token validation unavailable: pyjwt[crypto] is not installed on this server",
        )

    if not API_AUDIENCE or not ALLOWED_TENANTS:
        # ⚠️ Refuse rather than accept. A deployment that forgot to configure this is not a
        # deployment that meant "let everyone in".
        raise HTTPException(status_code=503, detail="authentication is not configured")

    try:
        unverified = jwt.get_unverified_header(token)
        claims_peek: dict[str, Any] = jwt.decode(token, options={"verify_signature": False})
    except Exception:
        raise _unauthorised("unparseable") from None

    tid = str(claims_peek.get("tid", "")).lower()
    if tid not in ALLOWED_TENANTS:
        # Checked before fetching keys, so an unknown tenant cannot make this process issue a
        # network request to an attacker-chosen discovery endpoint.
        raise _unauthorised("tenant not allowed")

    if unverified.get("alg") != "RS256":
        # Pinned. `alg: none` and HMAC confusion are the two classic ways a verifier is talked out
        # of verifying, and neither is a thing Entra legitimately does.
        raise _unauthorised("unexpected algorithm")

    try:
        signing_key = _jwks_client(tid).get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=API_AUDIENCE,
            issuer=_issuer(tid),
            options={"require": ["exp", "iat", "aud", "iss", "sub"]},
        )
    except jwt.PyJWTError:
        raise _unauthorised("failed verification") from None
    except httpx.HTTPError:
        # A JWKS outage is not the caller's fault, and answering 401 would send them off to
        # re-authenticate against a problem that is not theirs.
        raise HTTPException(status_code=503, detail="cannot reach the identity provider") from None

    scopes = tuple(str(claims.get("scp", "")).split())
    if not scopes:
        # ⚠️ NO `scp` MEANS AN APPLICATION TOKEN, AND THIS API DOES NOT ACCEPT ONE. §15.1's whole
        # argument is that `confirmedBy` must be a verified human. An app-only token has `roles`
        # and no user behind it, so every audit row it produced would name the application.
        raise _unauthorised("application-only token")
    if REQUIRED_SCOPE and REQUIRED_SCOPE not in scopes:
        raise _unauthorised("missing scope")

    oid = str(claims.get("oid") or claims.get("sub") or "")
    if not oid:
        raise _unauthorised("no subject")

    return Principal(
        oid=oid,
        tid=tid,
        upn=str(claims.get("preferred_username") or claims.get("upn") or ""),
        name=str(claims.get("name") or ""),
        scopes=scopes,
    )


def require_user(authorization: str | None = Header(default=None)) -> Principal:
    """FastAPI dependency. Every endpoint that writes takes this."""
    if AUTH_DISABLED:
        return Principal(oid="dev", tid="dev", upn=DEV_PRINCIPAL_UPN, name="Local development", scopes=())
    if not authorization or not authorization.lower().startswith("bearer "):
        raise _unauthorised("no bearer")
    return validate_bearer(authorization.split(" ", 1)[1].strip())


def auth_status() -> dict[str, Any]:
    """What `/api/health` should say about this, without leaking the audience to anonymous callers.

    ⚠️ Booleans only. §44.4 row 9 records that this backend already publishes more about itself
    than it needs to; the fix is not to add another endpoint that does the same.
    """
    return {
        "configured": bool(API_AUDIENCE and ALLOWED_TENANTS),
        "disabled": AUTH_DISABLED,
        "tenantCount": len(ALLOWED_TENANTS),
        # ⚠️ Surfaced because "configured: true" while the library is absent is the confusing
        # case: the deployment looks right and every call still 503s. One boolean turns that
        # from a debugging session into a glance.
        "libraryPresent": JWT_AVAILABLE,
        # ⚠️ True means somebody shipped ENTRA_AUTH_DISABLED to a real container and it was
        # ignored. Nothing is broken, but somebody believes something false about this deployment.
        "bypassRefused": AUTH_BYPASS_REFUSED,
    }


__all__ = ["Principal", "require_user", "validate_bearer", "auth_status", "Depends"]
