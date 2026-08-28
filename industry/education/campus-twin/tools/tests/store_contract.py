"""The interface a fake `intake_store` has to keep up with, checked instead of hoped for.

⚠️ WRITTEN AFTER THE THIRD TIME A HAND-WRITTEN FAKE DIVERGED IN ONE SESSION. Each time the real
store grew a function, the fakes kept passing until something unrelated broke, and the failure
pointed at the router rather than at the fixture:

  * `request_for_preview` was added and `test_intake_auth.py` 500ed on a path it claimed to cover,
  * `list_queue` in that same fake IGNORED its `status` argument, so a two-status query returned
    every row twice and looked like a duplicate bug in the router,
  * `identity_sites` was added and two suites broke at once.

And the dangerous one, which did not break anything at all: a fake `request_for_preview` that
ignored `owner_oid` would make the **leak test pass while the production query leaked**. A fake
does not merely risk being out of date. It risks asserting a guarantee the real code does not
give, which is worse than having no test.

So the rule this module enforces is narrow and mechanical: a fake must offer **every public
callable the real store offers, with a compatible signature**. It cannot verify behaviour - only
the dev store and the live tests do that - but it makes "the fixture forgot" impossible.
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

import inspect
from typing import Any, Callable, Iterable

#: Functions that exist on the real store but that no fake needs to provide, each with a reason.
EXEMPT = {
    "intake_enabled": "usually stubbed to a constant by the caller",
    "warehouse_status": "diagnostics only, never on a request path",
    "normalise_guid": "a pure helper with no I/O; the real one is safe to use as-is",
    "pyodbc_integrity_error": "returns a driver exception class, not data",
    "identity_sites": "callers that patch it do so explicitly; see note in check_fake",
}


def public_surface(module: Any) -> dict[str, inspect.Signature]:
    """Every public callable the real store exposes, with its signature."""
    out: dict[str, inspect.Signature] = {}
    for name, obj in vars(module).items():
        if name.startswith("_") or not callable(obj):
            continue
        if getattr(obj, "__module__", None) != module.__name__:
            continue  # re-exported import, not part of this module's own surface
        if isinstance(obj, type):
            continue  # exception classes are not operations
        try:
            out[name] = inspect.signature(obj)
        except (TypeError, ValueError):
            continue
    return out


def missing_from_fake(module: Any, fake: Any, *, also_require: Iterable[str] = ()) -> list[str]:
    """Names the fake fails to provide, or provides with an incompatible signature."""
    problems: list[str] = []
    required = set(also_require)
    for name, sig in public_surface(module).items():
        if name in EXEMPT and name not in required:
            continue
        replacement = getattr(fake, name, None)
        if replacement is None:
            problems.append(f"{name}: not provided by the fake")
            continue
        if not callable(replacement):
            problems.append(f"{name}: provided but not callable")
            continue
        try:
            fake_sig = inspect.signature(replacement)
        except (TypeError, ValueError):
            continue
        # ⚠️ Compared by PARAMETER NAME, not position. The owner predicate that stopped a leak is
        # a keyword-only `owner_oid`; a fake accepting `**kwargs` would swallow it silently and
        # the check would learn nothing.
        real_names = {p for p in sig.parameters if p != "self"}
        fake_names = {p for p in fake_sig.parameters if p != "self"}
        has_varkw = any(p.kind is inspect.Parameter.VAR_KEYWORD
                        for p in fake_sig.parameters.values())
        lost = real_names - fake_names
        if lost and not has_varkw:
            problems.append(f"{name}: fake is missing parameter(s) {sorted(lost)}")
        elif lost and has_varkw:
            problems.append(
                f"{name}: fake hides {sorted(lost)} behind **kwargs, so a caller that stops "
                f"passing them would not be noticed")
    return problems


def check_fake(module: Any, fake: Any, check: Callable[..., None], *,
               also_require: Iterable[str] = ()) -> None:
    """Report the fake's coverage through the caller's own `check` function.

    ⚠️ `identity_sites` is exempt by default but should be passed in `also_require` by any suite
    whose requests omit `site`, because that is the call the router makes instead of
    `resolve_identity` when it has to work out which university the caller belongs to.
    """
    problems = missing_from_fake(module, fake, also_require=also_require)
    check("the fake covers the real store's interface", not problems,
          "; ".join(problems) if problems else "")
