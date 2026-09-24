"""What a coordination-note token must carry before the author counts as verified.

⚠️ THE SIGNATURE IS THE EASY HALF. The SPA and the API are the same app registration, so an ID
token for this client already has the right issuer, audience, expiry and a valid Entra signature.
It authorises nothing. These tests pin the claim that actually separates "Entra minted this for
someone" from "this caller may write a note", because that distinction is invisible in a green
`/health` and would only surface as a forged author in the notes table.

Run: python -m unittest discover -s server -p "test_*.py"
"""

from __future__ import annotations

import os
import time
import unittest

# ⚠️ ENTRA READS ITS CONFIGURATION AT IMPORT TIME, so the environment has to be in place before
# the module is loaded. Setting it afterwards leaves `configured()` false and every test passes
# for the wrong reason.
TENANT = "99999999-8888-7777-6666-555555555555"
os.environ["ENTRA_TENANT_ID"] = TENANT
os.environ["ENTRA_API_AUDIENCE"] = "api://aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

import jwt  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402

import entra  # noqa: E402

_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


class _FakeJwks:
    """Stands in for the tenant's published keys so the tests need no network."""

    def __init__(self, public_key) -> None:
        self._public_key = public_key

    def get_signing_key_from_jwt(self, _token: str):
        return type("_Key", (), {"key": self._public_key})()


def _token(**overrides) -> str:
    now = int(time.time())
    claims = {
        "iss": f"https://login.microsoftonline.com/{TENANT}/v2.0",
        "aud": "api://aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        "iat": now,
        "exp": now + 3600,
        "preferred_username": "nutzer@example.onmicrosoft.com",
        "scp": "Notizen.Write",
    }
    claims.update(overrides)
    for key, value in list(claims.items()):
        if value is None:
            del claims[key]
    return jwt.encode(claims, _KEY, algorithm="RS256")


class VerifyTest(unittest.TestCase):
    def setUp(self) -> None:
        entra._client = _FakeJwks(_KEY.public_key())

    def test_accepts_a_delegated_token_carrying_the_scope(self) -> None:
        author, claims = entra.verify(f"Bearer {_token()}")
        self.assertEqual(author, "nutzer@example.onmicrosoft.com")
        self.assertIsNotNone(claims)

    def test_rejects_an_id_token(self) -> None:
        """⚠️ The case that made the check necessary: correct audience, no `scp` at all."""
        author, _ = entra.verify(f"Bearer {_token(scp=None)}")
        self.assertIsNone(author)

    def test_rejects_an_app_only_token(self) -> None:
        """App-only tokens carry `roles`. No user consented, so no note may bear a user's name."""
        author, _ = entra.verify(f"Bearer {_token(scp=None, roles=['Notizen.Write'])}")
        self.assertIsNone(author)

    def test_rejects_a_token_scoped_to_something_else(self) -> None:
        author, _ = entra.verify(f"Bearer {_token(scp='User.Read')}")
        self.assertIsNone(author)

    def test_matches_whole_scope_entries_not_substrings(self) -> None:
        """A substring test would accept this, and it is a different permission."""
        author, _ = entra.verify(f"Bearer {_token(scp='Notizen.WriteEverything')}")
        self.assertIsNone(author)

    def test_finds_the_scope_among_several(self) -> None:
        author, _ = entra.verify(f"Bearer {_token(scp='User.Read Notizen.Write profile')}")
        self.assertEqual(author, "nutzer@example.onmicrosoft.com")

    def test_rejects_an_expired_token(self) -> None:
        now = int(time.time())
        author, _ = entra.verify(f"Bearer {_token(iat=now - 7200, exp=now - 3600)}")
        self.assertIsNone(author)

    def test_rejects_a_foreign_audience(self) -> None:
        author, _ = entra.verify(f"Bearer {_token(aud='api://some-other-service')}")
        self.assertIsNone(author)

    def test_rejects_a_foreign_tenant(self) -> None:
        other = "11111111-2222-3333-4444-555555555555"
        author, _ = entra.verify(
            f"Bearer {_token(iss=f'https://login.microsoftonline.com/{other}/v2.0')}"
        )
        self.assertIsNone(author)

    def test_rejects_a_token_with_no_usable_name(self) -> None:
        """Without a name there is nothing to attribute, so it must not fall back to an id."""
        author, _ = entra.verify(f"Bearer {_token(preferred_username=None, oid='some-object-id')}")
        self.assertIsNone(author)

    def test_ignores_a_header_that_is_not_a_bearer_token(self) -> None:
        for header in (None, "", "Basic abc", "Bearer", "Bearer    "):
            with self.subTest(header=header):
                self.assertEqual(entra.verify(header), (None, None))

    def test_health_reveals_no_secret(self) -> None:
        text = repr(entra.health())
        self.assertNotIn(_token(), text)
        self.assertIn("Notizen.Write", text)


if __name__ == "__main__":
    unittest.main()
