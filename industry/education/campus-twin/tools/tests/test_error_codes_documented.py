"""Every error code the router can emit must be one the agent has been told how to read.

⚠️ THE CODES WERE INVENTED AND NOBODY TOLD THE AGENT. Three machine-readable `code` values were
added in one session to fix real defects, and the declarative agent's instructions still described
a world containing none of them. The dangerous one is `already_submitted`: it means the caller
**already succeeded**, so a model reading it as a plain failure apologises to a professor whose
request is sitting in the planner's queue, and the professor files it again.

This closes the loop in both directions, because either half alone rots:

  * a code the router can raise but `ERROR_CODES` does not describe -> the agent meets a failure
    it has no instruction for, and falls back to guessing,
  * a code described in `ERROR_CODES` that never reaches the published instructions -> the map
    looks maintained and changes nothing about what the model actually sees.

The router's codes are read out of the SOURCE rather than by calling every failing path, because a
code that only appears on a path nobody thought to test is precisely the one that would be missed.
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

import ast
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))
sys.path.insert(0, str(ROOT / "tools" / "agent"))

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: object = "") -> None:
    print(f"  {'ok ' if condition else 'FAIL'} {name}" + (f"  [{detail}]" if detail else ""))
    if not condition:
        FAILURES.append(name)


def codes_in_source() -> set[str]:
    """Every literal `"code": "..."` the router builds, found by walking the AST.

    ⚠️ AST, not a regex over the text: a regex also matches the word inside a comment or a
    docstring, and this check is only worth having if it counts what the code really constructs.
    """
    tree = ast.parse((ROOT / "server" / "intake.py").read_text(encoding="utf-8"))
    found: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Dict):
            continue
        for key, value in zip(node.keys, node.values):
            if (isinstance(key, ast.Constant) and key.value == "code"
                    and isinstance(value, ast.Constant) and isinstance(value.value, str)):
                found.add(value.value)
    return found


def main() -> int:
    import intake

    raised = codes_in_source()
    described = set(intake.ERROR_CODES)
    print(f"codes the router builds:  {sorted(raised)}")
    print(f"codes with guidance:      {sorted(described)}\n")

    check("every code the router raises has guidance", raised <= described,
          f"undocumented: {sorted(raised - described)}")
    check("no guidance describes a code that does not exist", described <= raised,
          f"stale: {sorted(described - raised)}")

    # ⚠️ The guidance has to survive the trip into the package, not merely exist in a dict.
    import build_agent_package as builder

    agent = builder.declarative_agent()
    instructions = agent["instructions"]
    for code, text in sorted(intake.ERROR_CODES.items()):
        check(f"the agent is told about '{code}'", code in instructions)
        # A first clause is enough: the whole sentence is reflowed when rendered.
        opening = text.split(".")[0][:40]
        check(f"  and told what to do about it", opening in instructions, opening)

    print()
    # The one that would quietly undo the recovery work if it were dropped.
    check("the agent is told what needsAttention means", "needsAttention" in instructions)
    check("and that it means the change did NOT land",
          "NICHT im Plan gelandet" in instructions)

    check("the instructions still fit the 8000-character limit",
          len(instructions) <= 8000, len(instructions))

    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {FAILURES}")
        return 1
    print(f"OK - {len(described)} codes, all raised, all described, all published "
          f"({len(instructions)} chars)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
