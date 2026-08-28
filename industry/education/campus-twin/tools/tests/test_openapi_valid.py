"""The generated OpenAPI document must survive a REAL parser, not just a string search.

⚠️ This exists because `test_agent_package.py` checked the spec by searching its text, and the
document it was happily approving was **invalid OpenAPI 3.0**. Copilot rejects an invalid plugin
at import time, which is the one step nobody has been able to reach yet, so the failure would have
looked like "the agent does not work" with nothing pointing at the spec.

The specific defect, kept as a named regression below: `downgrade_to_30` handled `examples` (3.1,
a list) to `example` (3.0, a single value), but the `anyOf` merge above it **returned early**.
Every optional field takes that early return, and all four fields carrying examples are optional,
so every last one survived. Nothing was left half-converted to make it obvious.
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
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "agent"))
sys.path.insert(0, str(ROOT / "server"))

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: object = "") -> None:
    print(f"  {'ok ' if condition else 'FAIL'} {name}" + (f"  [{detail}]" if detail else ""))
    if not condition:
        FAILURES.append(name)


def walk(node: object):
    """Every dict in the document, so a check cannot miss one by looking at the top level only."""
    if isinstance(node, dict):
        yield node
        for value in node.values():
            yield from walk(value)
    elif isinstance(node, list):
        for value in node:
            yield from walk(value)


def main() -> int:
    try:
        from openapi_spec_validator import validate
    except ImportError:
        # ⚠️ Deliberately a FAILURE, not a skip. A test that quietly turns green when its
        # validator is missing is worse than no test: it reports success for a document nobody
        # checked. Same rule the server follows for a missing crypto library.
        print("FAIL: openapi-spec-validator is not installed")
        print("      pip install -r tools/requirements.txt")
        return 1

    import build_agent_package as builder

    spec = builder.build_openapi()
    print(f"built spec: openapi={spec.get('openapi')}, {len(spec.get('paths', {}))} paths\n")

    try:
        validate(spec)
        check("the document is valid OpenAPI 3.0", True)
    except Exception as exc:  # noqa: BLE001 - any failure kind is a failure
        check("the document is valid OpenAPI 3.0", False, f"{type(exc).__name__}: {str(exc)[:200]}")

    # --- named regressions -----------------------------------------------------------------
    # ⚠️ `examples` is JSON Schema 2020-12 / OpenAPI 3.1. A 3.0 Schema Object may carry `example`
    # (singular) and nothing else. This is the bug that shipped, so it gets its own assertion
    # rather than relying on the validator to keep catching it.
    plural = [n for n in walk(spec) if "examples" in n]
    check("no 3.1 'examples' survives anywhere", not plural, f"{len(plural)} node(s)")

    # The early return was in the optional-field path specifically, so prove that path converted.
    body = spec["paths"]["/api/intake/preview"]["post"]["requestBody"]
    props = body["content"]["application/json"]["schema"]["properties"]
    optional_with_example = {
        name: schema for name, schema in props.items() if "example" in schema
    }
    check(
        "optional fields kept their example, converted to the 3.0 spelling",
        optional_with_example and all(s.get("nullable") for s in optional_with_example.values()),
        sorted(optional_with_example),
    )

    check("no 3.1 'const' survives", not [n for n in walk(spec) if "const" in n])
    check("no unresolved $ref survives", not [n for n in walk(spec) if "$ref" in n])

    # --- the contract must not advertise what the server refuses ---------------------------
    # ⚠️ The description used to read "availability | room_issue | move_request" long after the
    # other two kinds were removed, so the agent was invited to send a kind the handler answers
    # 400 to. It is derived from the constant now; this proves the derivation is wired up.
    import intake

    kind_description = props["kind"]["description"]
    for gone in ("room_issue", "move_request"):
        check(
            f"the contract does not offer the removed kind '{gone}'",
            gone not in json.dumps(spec),
        )
    check(
        "the kind description matches ACCEPTED_KINDS exactly",
        all(k in kind_description for k in intake.ACCEPTED_KINDS)
        and kind_description.count("|") == len(intake.ACCEPTED_KINDS) - 1,
        kind_description,
    )

    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {FAILURES}")
        return 1
    print("OK - the spec Copilot will import parses as OpenAPI 3.0 and describes only what the "
          "server accepts")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
