"""Verify Microsoft Entra access tokens for coordination-note writes.

⚠️ WHY THIS EXISTS AT ALL. Until now the author of a note was whatever the browser put in an
`X-Autor` header, and `src/agent/identity.ts` said so plainly: the Rayfin session yields no token
minted for this service's audience, so there was nothing to check. Measured on 2026-09-21, that
was worse than documented: opened on its own host the app resolved NO identity even with a live
Fabric portal session, and its sign-in button led to the corporate tenant rather than the demo
tenant. A dedicated app registration in the demo tenant gives this service an audience of its
own, which is the smallest change that turns "reported" into "verified".

⚠️ THIS MODULE MUST NEVER BE ABLE TO TAKE THE SERVICE DOWN. Every failure path returns "not
verified" rather than raising, and the decision about what to do with that lives in the route.
Reading notes, the map and the assistant keep working with no token at all.
"""

from __future__ import annotations

import os
import threading
import time
from typing import Any

import httpx
import jwt
from jwt import PyJWKClient

TENANT_ID = os.getenv("ENTRA_TENANT_ID", "").strip()
API_AUDIENCE = os.getenv("ENTRA_API_AUDIENCE", "").strip()

#: When true, a write without a verified token is refused.
#:
#: ⚠️ DEFAULTS TO OFF ON PURPOSE. Turning enforcement on is a one-line environment change, but
#: doing it before sign-in has been proven end to end in the demo tenant would break the exact
#: step this feature is meant to strengthen. Prove it, then flip it.
REQUIRE_AUTH = os.getenv("REQUIRE_AUTH", "").strip().lower() == "true"

#: The delegated permission a write must actually carry.
#:
#: ⚠️ WITHOUT THIS CHECK AN ID TOKEN WOULD PASS. The SPA and the API are the SAME registration,
#: so an ID token issued to this client has the right audience, issuer, signature and expiry. It
#: authorises nothing. Only a delegated ACCESS token carries `scp`, and only one obtained for
#: this scope carries this value; app-only tokens carry `roles` and no `scp` at all.
REQUIRED_SCOPE = "Notizen.Write"

_ISSUERS = (
    f"https://login.microsoftonline.com/{TENANT_ID}/v2.0",
    f"https://sts.windows.net/{TENANT_ID}/",
)
_JWKS_URL = f"https://login.microsoftonline.com/{TENANT_ID}/discovery/v2.0/keys"

_lock = threading.Lock()
_client: PyJWKClient | None = None


def configured() -> bool:
    return bool(TENANT_ID and API_AUDIENCE)


def _jwks() -> PyJWKClient | None:
    """One cached JWKS client. PyJWKClient caches keys and refetches on an unknown kid."""
    global _client
    if _client is not None:
        return _client
    with _lock:
        if _client is None:
            try:
                _client = PyJWKClient(_JWKS_URL, cache_keys=True, lifespan=3600)
            except Exception:  # noqa: BLE001 - absence of keys must not break the service
                return None
    return _client


def _audiences() -> list[str]:
    """Accept both spellings Entra may put in `aud` for the same API."""
    values = [API_AUDIENCE]
    if API_AUDIENCE.startswith("api://"):
        values.append(API_AUDIENCE[len("api://"):])
    else:
        values.append(f"api://{API_AUDIENCE}")
    return [v for v in values if v]


def verify(authorization: str | None) -> tuple[str | None, dict[str, Any] | None]:
    """Return (author, claims) for a valid bearer token, else (None, None).

    The author is the human-readable name the note should carry. `preferred_username` is present
    because the registration requests access-token version 2; the others are fallbacks.
    """
    if not configured() or not authorization:
        return None, None
    parts = authorization.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None, None
    token = parts[1].strip()
    if not token:
        return None, None

    client = _jwks()
    if client is None:
        return None, None

    try:
        key = client.get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            audience=_audiences(),
            issuer=list(_ISSUERS),
            options={"require": ["exp", "iat", "aud", "iss"]},
            leeway=60,
        )
    except Exception:  # noqa: BLE001 - an invalid token is simply "not verified"
        return None, None

    # ⚠️ SCOPE IS PART OF THE AUTHORISATION, NOT A FORMALITY. A signature only proves who minted
    # the token, not what it may do. `scp` is a space-separated list and must be compared as
    # whole entries: a substring test would accept "Notizen.WriteSomethingElse".
    scopes = claims.get("scp")
    if not isinstance(scopes, str) or REQUIRED_SCOPE not in scopes.split():
        return None, None

    author = (
        claims.get("preferred_username")
        or claims.get("upn")
        or claims.get("email")
        or claims.get("name")
    )
    if not isinstance(author, str) or not author.strip():
        return None, None
    return author.strip()[:256], claims


def health() -> dict[str, Any]:
    """Non-secret status for /health. Never returns keys, tokens or claims."""
    return {
        "configured": configured(),
        "tenant": TENANT_ID[:8] + "..." if TENANT_ID else None,
        "audienceSet": bool(API_AUDIENCE),
        "scope": REQUIRED_SCOPE,
        "enforced": REQUIRE_AUTH,
    }
