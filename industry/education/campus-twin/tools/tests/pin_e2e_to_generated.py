"""Point every e2e navigation at the GENERATED OTH dataset explicitly.

⚠️ THE DEFAULT MOVED UNDER THE TESTS. `config/aoi/oth-regensburg.json` now serves OTH's REAL Untis
timetable, because that is the stronger demo (user decision, 2026-08-06). Every existing e2e spec
pins the GENERATED plan — the demo lecturer, the room join, the subject list — so leaving them on
the default would fail them all and, worse, would look like the real data is broken.

So the specs say which dataset they mean. `?scheduler=oth` is the override added in `aoi.ts`, and
naming it here is the point: a test that depends on a particular timetable should say so rather
than inherit whatever the app happens to default to this month.
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

import io
import re
from pathlib import Path

E2E = Path(__file__).resolve().parents[2] / "e2e"
if not E2E.is_dir():                       # ⚠️ a rewrite that finds no files must not report success
    raise SystemExit(f"e2e directory not found at {E2E} — nothing was rewritten")

# Any goto whose URL selects OTH (explicitly or by default) and does not already name a scheduler.
PATTERNS = [
    # '/?aoi=oth-regensburg'  and  `/?aoi=oth-regensburg&...`
    (re.compile(r"(['\"`])/\?aoi=oth-regensburg(?=['\"`&])"), r"\1/?scheduler=oth&aoi=oth-regensburg"),
    # a bare '/' or '/?x=y' navigation lands on the default AOI, which is OTH
    (re.compile(r"page\.goto\((['\"`])/(['\"`])\)"), r"page.goto(\1/?scheduler=oth\2)"),
    (re.compile(r"page\.goto\((['\"`])/\?(?!scheduler=|aoi=)"), r"page.goto(\1/?scheduler=oth&"),
]


def main() -> None:
    changed: list[tuple[str, int]] = []
    for path in sorted(E2E.glob("*.ts")):
        src = io.open(path, encoding="utf-8").read()
        out = src
        for pat, repl in PATTERNS:
            out = pat.sub(repl, out)
        if out != src:
            n = sum(1 for a, b in zip(src.splitlines(), out.splitlines()) if a != b)
            io.open(path, "w", encoding="utf-8", newline="\n").write(out)
            changed.append((path.name, n))

    total = sum(n for _, n in changed)
    for name, n in changed:
        print(f"   {name:<28} {n} line(s)")
    print(f"\n{len(changed)} file(s), {total} navigation(s) pinned to ?scheduler=oth")

    left = []
    for path in sorted(E2E.glob("*.ts")):
        for i, line in enumerate(io.open(path, encoding="utf-8"), 1):
            if "page.goto(" in line and "scheduler=" not in line and "aoi=" in line:
                if "oth-regensburg" in line:
                    left.append(f"{path.name}:{i}: {line.strip()[:90]}")
    if left:
        print("\n⚠️ still unpinned and OTH-bound:")
        for line in left:
            print("   " + line)
    else:
        print("no OTH-bound navigation left unpinned")


if __name__ == "__main__":
    main()
