"""Does the publishable template still carry a superseded copy of the intake work?

⚠️ NAMED `check_`, NOT `test_`, ON PURPOSE. The offline runner picks up `test_*.py`; this one
inspects a DIFFERENT repository that may not be checked out, and whose state is somebody else's
work item (PLAN §46.5 item 2, the template push). Making it part of the suite would turn a
red light about another repo into a red light about this one.

Why it exists: `awesome-rayfin-campus/templates/campus-scheduler/server/` holds a hand-made
snapshot of `server/`, taken while the intake work was mid-flight. It captured:

  * `intake.py` with `redact_reason` and the `room_issue` / `move_request` kinds, both removed
    after review found the first was not a privacy boundary and the second was costed as an
    availability change,
  * `auth.py` from before the container bypass refusal,
  * `warehouse.py`, which is `intake_store.py` under its OLD NAME and still addressed at a
    `CampusIntake` Warehouse that was never created, because the data turned out to already exist
    in the Fabric SQL Database.

That template has a public remote. Publishing it would publish all three.
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

import hashlib
import sys
from pathlib import Path

# The sibling checkout that holds the gallery template, found relative to this file rather than
# named: `<repos>/Campus-Scheduler/tools/tests/` is three levels down from the checkout root.
REPOS = Path(__file__).resolve().parents[3]
SOURCE = REPOS / "Campus-Scheduler" / "server"
TEMPLATE = REPOS / "awesome-rayfin-campus" / "templates" / "campus-scheduler" / "server"

# Markers that were deliberately removed from the source. Their presence in the template is not
# drift, it is a known defect being carried.
REMOVED_MARKERS = {
    "redact_reason": "a redaction helper that review found was not a privacy boundary",
    "room_issue": "a kind that was accepted but costed as an availability change",
    "move_request": "a kind that was accepted but costed as an availability change",
    "CampusIntake": "a Warehouse that was never created; the data lives in Fabric SQL",
}

# Files the template holds that no longer exist upstream, with what replaced them.
RENAMED = {"warehouse.py": "intake_store.py"}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:12]


def main() -> int:
    if not TEMPLATE.is_dir():
        # ⚠️ Distinct exit code. "Not checked out" must never look like "checked and clean".
        print(f"TEMPLATE NOT PRESENT at {TEMPLATE}")
        print("nothing was checked; this is not a pass")
        return 2

    problems: list[str] = []
    print(f"source:   {SOURCE}")
    print(f"template: {TEMPLATE}\n")

    for path in sorted(TEMPLATE.glob("*.py")):
        counterpart = SOURCE / path.name
        if not counterpart.exists():
            replacement = RENAMED.get(path.name)
            note = f"renamed to {replacement} upstream" if replacement else "no longer exists upstream"
            problems.append(f"{path.name}: {note}")
            print(f"  ORPHAN  {path.name:<22} {note}")
            continue
        if digest(path) != digest(counterpart):
            problems.append(f"{path.name}: differs from server/{path.name}")
            print(f"  DRIFT   {path.name:<22} {digest(path)} vs {digest(counterpart)}")

    print()
    for path in sorted(TEMPLATE.glob("*.py")):
        text = path.read_text(encoding="utf-8", errors="replace")
        for marker, why in REMOVED_MARKERS.items():
            if marker in text:
                problems.append(f"{path.name}: still ships '{marker}'")
                print(f"  DEFECT  {path.name:<22} ships '{marker}' - {why}")

    print()
    if problems:
        print(f"TEMPLATE IS NOT PUBLISHABLE AS-IS: {len(problems)} finding(s)")
        print("Either re-copy server/ into the template, or drop the intake modules from it:")
        print("they are dead code there anyway, because the template's app.py does not mount the")
        print("router either.")
        return 1
    print("OK - the template carries no superseded copy of the intake work")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
