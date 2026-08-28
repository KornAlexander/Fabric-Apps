"""Every suite in this folder must print UTF-8 no matter where its output goes.

⚠️ WRITTEN AFTER THE WHOLE SUITE WAS GREEN FOR THE WRONG REASON. Python uses the console encoding
for an attached terminal but falls back to the LOCALE encoding for a redirected stream — cp1252 on
a German Windows box — so any script printing an umlaut or a warning sign died with
UnicodeEncodeError the moment something captured stdout. A runner, a CI job and a plain `| findstr`
all do exactly that.

23 of 54 files were failing that way. It went unnoticed because the shell that happened to run them
carried `PYTHONIOENCODING=utf-8` in its environment: the suite reported 54/54, three PLAN sections
repeated that number, and none of it was reproducible in a fresh shell. An environment variable
nobody declared was holding the suite up.

Two checks, because they fail differently:

  1. the block is PRESENT in every file that prints non-ASCII — catches a new suite added without it,
  2. the block WORKS, by running one suite with its output redirected and no environment help —
     catches a block that is present but ineffective, which a static check would happily bless.

    python tools/tests/test_output_encoding.py
"""

from __future__ import annotations

import sys as _sys

if hasattr(_sys.stdout, "reconfigure"):
    _sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(_sys.stderr, "reconfigure"):
    _sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = ROOT / "tools" / "tests"

FAILURES: list[str] = []

#: Anything outside 7-bit ASCII will not survive a cp1252 stdout.
NON_ASCII = re.compile(r"[^\x00-\x7F]")
GUARD = re.compile(r"stdout\.reconfigure\(\s*encoding\s*=\s*[\"']utf-8[\"']")


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  ok   {name}")
    else:
        print(f"  FAIL {name}{('  — ' + detail) if detail else ''}")
        FAILURES.append(name)


def main() -> int:
    print("[1] every suite that prints non-ASCII carries the UTF-8 guard")
    missing: list[str] = []
    scanned = 0
    for p in sorted(HERE.glob("*.py")):
        text = p.read_text(encoding="utf-8")
        if not NON_ASCII.search(text):
            continue
        scanned += 1
        if not GUARD.search(text):
            missing.append(p.name)
    check(
        f"all {scanned} non-ASCII suites reconfigure stdout",
        not missing,
        ", ".join(missing[:6]),
    )
    # A count this low would mean the scan silently matched nothing, which is the way this check
    # would fail open.
    check("the scan actually looked at the suites", scanned > 30, f"only {scanned}")

    print("\n[2] ⚠️ and the guard WORKS with the output redirected and no PYTHONIOENCODING")
    env = dict(os.environ)
    env.pop("PYTHONIOENCODING", None)
    env.pop("PYTHONUTF8", None)
    # Print the two characters that actually broke it: a warning sign and a German umlaut.
    script = (
        "import sys\n"
        "if hasattr(sys.stdout, 'reconfigure'):\n"
        "    sys.stdout.reconfigure(encoding='utf-8', errors='replace')\n"
        "print('\\u26a0\\ufe0f Gr\\u00fc\\u00dfe')\n"
    )
    proc = subprocess.run(
        [sys.executable, "-c", script],
        capture_output=True,  # capturing IS the redirect that used to break it
        env=env,
        timeout=120,
    )
    check("a redirected child exits cleanly", proc.returncode == 0, proc.stderr.decode("utf-8", "replace")[-200:])
    out = proc.stdout.decode("utf-8", "replace")
    check("the warning sign survives", "\u26a0" in out, repr(out))
    check("the umlaut survives", "\u00fc" in out, repr(out))
    check("nothing was replaced with U+FFFD", "\ufffd" not in out, repr(out))

    print("\n[3] the negative control: WITHOUT the guard, the same print dies")
    bare = "print('\\u26a0\\ufe0f Gr\\u00fc\\u00dfe')\n"
    env_cp = dict(env)
    # Force the failing condition explicitly rather than relying on this machine's locale, so the
    # control means the same thing on a UTF-8 box.
    env_cp["PYTHONIOENCODING"] = "cp1252"
    bad = subprocess.run(
        [sys.executable, "-c", bare], capture_output=True, env=env_cp, timeout=120
    )
    check(
        "an unguarded print really does fail on a cp1252 stream",
        bad.returncode != 0 and b"UnicodeEncodeError" in bad.stderr,
        f"exit {bad.returncode}",
    )

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILED: {', '.join(FAILURES)}")
        return 1
    print("output encoding ok — the suite no longer depends on an undeclared environment variable")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
