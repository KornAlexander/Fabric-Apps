"""Real signed tokens against the real validator. Nothing here is mocked except the key service.

    python tools\\tests\\test_auth_tokens.py

⚠️ UNTIL THIS FILE EXISTED, `validate_bearer` HAD NEVER RUN IN A TEST. Every other suite either set
`ENTRA_AUTH_DISABLED=1` or replaced the `require_user` dependency, which is convenient and means the
single most security-critical function in the feature was covered by nothing at all. Seven green
suites and the front door untested.

So: mint a real RSA key here, sign real RS256 JWTs with it, and hand the public key to the
validator the way Entra's JWKS endpoint would. Then attack it.

The attacks are not hypothetical; each is a documented way a JWT verifier is talked out of
verifying:
  * `alg: none` and HMAC confusion (signing with the PUBLIC key as an HMAC secret),
  * a token for the right user from the WRONG tenant,
  * a token minted for a DIFFERENT audience by an app the user also consented to,
  * an application-only token, which has `roles` and no human behind it,
  * a valid-looking token signed by a key that is not the tenant's.
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
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

import os  # noqa: E402

# ⚠️ BUILT, NOT WRITTEN. These are deliberately synthetic tenant ids, but a guid literal in source
# is indistinguishable from a real tenant id to any scanner, including this repository's own
# `verify_publishable.py`. Composing them from repeated digits keeps the bytes out of the file and
# avoids an allowlist exemption. That file's history is explicit that an exemption removed is worth
# more than an exemption justified: "the only state in which '0 not covered by the allowlist' means
# what it says".
def _fake_guid(digit: str) -> str:
    return "-".join(digit * n for n in (8, 4, 4, 4, 12))


TENANT = _fake_guid("1")
OTHER_TENANT = _fake_guid("9")
AUDIENCE = "api://campus-scheduler"

# ⚠️ Before importing auth: it reads its configuration at import time.
os.environ["ENTRA_TENANT_IDS"] = TENANT
os.environ["ENTRA_API_AUDIENCE"] = AUDIENCE
os.environ["ENTRA_REQUIRED_SCOPE"] = "access_as_user"
os.environ.pop("ENTRA_AUTH_DISABLED", None)
os.environ.pop("CONTAINER_APP_NAME", None)

import auth  # noqa: E402
import jwt  # noqa: E402
from cryptography.hazmat.primitives import serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402
from fastapi import HTTPException  # noqa: E402

FAILURES: list[str] = []
JWKS_CALLS: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name} {detail}")
        FAILURES.append(name)


KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
WRONG_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)

PRIV = KEY.private_bytes(serialization.Encoding.PEM,
                         serialization.PrivateFormat.PKCS8,
                         serialization.NoEncryption()).decode()
PUB = KEY.public_key().public_bytes(serialization.Encoding.PEM,
                                    serialization.PublicFormat.SubjectPublicKeyInfo).decode()
WRONG_PRIV = WRONG_KEY.private_bytes(serialization.Encoding.PEM,
                                     serialization.PrivateFormat.PKCS8,
                                     serialization.NoEncryption()).decode()


class _Key:
    key = PUB


class _JwksClient:
    def get_signing_key_from_jwt(self, token):
        return _Key()


def fake_jwks(tenant_id: str):
    """Stands in for Entra's key endpoint, and records that it was asked."""
    JWKS_CALLS.append(tenant_id)
    return _JwksClient()


auth._jwks_client = fake_jwks


def token(*, tid=TENANT, aud=AUDIENCE, scp="access_as_user", oid="oid-prof",
          exp_delta=3600, nbf_delta=-60, key=PRIV, alg="RS256", iss=None,
          extra=None, drop=()) -> str:
    now = int(time.time())
    claims = {
        "iss": iss or f"https://login.microsoftonline.com/{tid}/v2.0",
        "aud": aud, "tid": tid, "oid": oid, "sub": "subject-" + str(oid),
        "preferred_username": "prof@hs.de", "name": "Prof. Dr. Müller",
        "iat": now, "nbf": now + nbf_delta, "exp": now + exp_delta,
    }
    if scp is not None:
        claims["scp"] = scp
    claims.update(extra or {})
    for k in drop:
        claims.pop(k, None)
    return jwt.encode(claims, key, algorithm=alg)


def refuses(name: str, tok: str, expect: int = 401) -> None:
    try:
        p = auth.validate_bearer(tok)
        check(name, False, f"ACCEPTED as oid={p.oid} tid={p.tid}")
    except HTTPException as e:
        check(name, e.status_code == expect, f"got {e.status_code}, wanted {expect}")
    except Exception as e:
        check(name, False, f"{type(e).__name__}: {e}")


def main() -> int:
    print("\n[1] a correct token is accepted, and read correctly")
    p = auth.validate_bearer(token())
    check("a valid token yields a principal", p.oid == "oid-prof", p)
    check("the tenant is carried through", p.tid == TENANT, p.tid)
    check("the UPN comes from preferred_username", p.upn == "prof@hs.de", p.upn)
    check("umlauts in the display name survive", p.name == "Prof. Dr. Müller", p.name)
    check("scopes are parsed as a tuple", p.scopes == ("access_as_user",), p.scopes)

    print("\n[2] ⚠️ signature attacks")
    import base64
    import hashlib
    import hmac

    def b64(raw: bytes) -> str:
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    def b64j(d) -> str:
        return b64(json.dumps(d, separators=(",", ":")).encode())

    def claims_now(**over):
        c = {"iss": f"https://login.microsoftonline.com/{TENANT}/v2.0", "aud": AUDIENCE,
             "tid": TENANT, "oid": "attacker", "sub": "attacker", "scp": "access_as_user",
             "iat": int(time.time()), "exp": int(time.time()) + 600}
        c.update(over)
        return c

    refuses("a token signed by the WRONG key is refused", token(key=WRONG_PRIV))

    # ⚠️ FORGED BY HAND ON PURPOSE. PyJWT REFUSES to encode HS256 with a PEM key, which is a good
    # safety feature of the library and exactly why the attack has to be built manually: an
    # attacker is not using our library. The classic confusion is to take the server's PUBLIC key
    # (which is public) and use it as an HMAC secret, hoping the verifier picks the algorithm from
    # the token's own header instead of pinning it.
    head = b64j({"alg": "HS256", "typ": "JWT"})
    body = b64j(claims_now())
    sig = b64(hmac.new(PUB.encode(), f"{head}.{body}".encode(), hashlib.sha256).digest())
    refuses("an HS256 token signed with the PUBLIC key is refused", f"{head}.{body}.{sig}")

    refuses("an `alg: none` token is refused",
            b64j({"alg": "none", "typ": "JWT"}) + "." + b64j(claims_now()) + ".")
    refuses("a token with a stripped signature is refused",
            ".".join(token().split(".")[:2]) + ".")
    refuses("garbage is refused", "not.a.token")
    refuses("an empty string is refused", "")

    print("\n[3] ⚠️ the tenant allow-list, and the SSRF it prevents")
    JWKS_CALLS.clear()
    refuses("a token from an unlisted tenant is refused", token(tid=OTHER_TENANT))
    check("⚠️ NO key fetch was made for the unlisted tenant", JWKS_CALLS == [], JWKS_CALLS)
    JWKS_CALLS.clear()
    auth.validate_bearer(token())
    check("a listed tenant does fetch keys", JWKS_CALLS == [TENANT], JWKS_CALLS)

    print("\n[4] ⚠️ audience and issuer")
    refuses("a token for another API is refused", token(aud="api://some-other-app"))
    # ⚠️ The distinct case here is an `aud` that is a BARE CLIENT-ID GUID rather than an `api://`
    # URI, which is the shape Entra issues for many first-party resources and the shape somebody
    # accepts by mistake when they configure the audience from the client's registration. An
    # earlier version used Microsoft Graph's real well-known id; a synthetic id tests the same
    # thing without putting a real first-party identifier in the tree.
    refuses("a token whose audience is a bare client-id guid is refused", token(aud=_fake_guid("7")))
    refuses("a token whose issuer is not the tenant's v2 issuer is refused",
            token(iss="https://evil.example/v2.0"))
    refuses("an issuer for a DIFFERENT tenant than tid is refused",
            token(iss=f"https://login.microsoftonline.com/{OTHER_TENANT}/v2.0"))

    print("\n[5] ⚠️ time")
    refuses("an expired token is refused", token(exp_delta=-10))
    refuses("a token that is not yet valid is refused", token(nbf_delta=3600))

    print("\n[6] ⚠️ delegated vs application")
    refuses("an application-only token (roles, no scp) is refused",
            token(scp=None, extra={"roles": ["Campus.ReadWrite.All"]}))
    check("that is the case that would put an app name in the audit trail", True)
    refuses("a delegated token without the required scope is refused", token(scp="User.Read"))
    refuses("an empty scp is refused", token(scp=""))

    print("\n[7] required claims")
    refuses("a token with no exp is refused", token(drop=("exp",)))
    refuses("a token with no aud is refused", token(drop=("aud",)))
    refuses("a token with no iat is refused", token(drop=("iat",)))
    p = auth.validate_bearer(token(oid=None, drop=("oid",), extra={"sub": "subject-only"}))
    check("with no oid it falls back to sub", p.oid == "subject-only", p.oid)
    refuses("with neither oid nor sub it is refused",
            token(oid=None, drop=("oid", "sub")))

    print("\n[8] ⚠️ the error tells an attacker nothing")
    try:
        auth.validate_bearer(token(aud="api://wrong"))
    except HTTPException as e:
        check("the 401 detail is coarse", e.detail == "invalid token", e.detail)
        check("it does not name the audience", AUDIENCE not in json.dumps(e.detail))
        check("it carries WWW-Authenticate", "WWW-Authenticate" in (e.headers or {}), e.headers)

    print("\n[9] ⚠️ misconfiguration refuses, it does not admit")
    saved_aud, saved_ten = auth.API_AUDIENCE, auth.ALLOWED_TENANTS
    try:
        auth.API_AUDIENCE = ""
        refuses("with no audience configured, a VALID token is refused 503", token(), expect=503)
        auth.API_AUDIENCE, auth.ALLOWED_TENANTS = saved_aud, []
        refuses("with no tenants configured, a VALID token is refused 503", token(), expect=503)
    finally:
        auth.API_AUDIENCE, auth.ALLOWED_TENANTS = saved_aud, saved_ten
    check("configuration was restored", auth.validate_bearer(token()).oid == "oid-prof")

    print("\n[10] ⚠️ an identity-provider outage is a 503, not a 401")
    import httpx

    def broken(tenant_id):
        raise httpx.ConnectError("jwks unreachable")

    auth._jwks_client = broken
    refuses("a JWKS outage returns 503", token(), expect=503)
    auth._jwks_client = fake_jwks
    check("recovery after the outage", auth.validate_bearer(token()).oid == "oid-prof")

    print("\n[11] the bearer header itself")
    for label, bad in (("missing", None), ("empty", ""), ("Basic", "Basic abc"),
                       ("scheme only", "bearer"), ("wrong scheme", "Token " + token())):
        try:
            auth.require_user(bad)
            check(f"a {label} Authorization header is refused", False, "ACCEPTED")
        except HTTPException as e:
            check(f"a {label} Authorization header is refused", e.status_code == 401, e.status_code)
    got = auth.require_user("Bearer " + token())
    check("a correct Bearer header is accepted", got.oid == "oid-prof", got)
    got = auth.require_user("bearer " + token())
    check("the scheme is case-insensitive, per RFC 7235", got.oid == "oid-prof", got)

    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {', '.join(FAILURES)}")
        return 1
    print("validate_bearer holds against every attack tried here")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
