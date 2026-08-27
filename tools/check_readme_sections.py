#!/usr/bin/env python3
"""Every app README carries the same ten sections, in the same order.

Twenty drifting READMEs is a much more expensive problem than a template written up
front - so the template is enforced, not suggested.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# Headings in the wild carry decoration and qualifiers: "## 🙌 Credits — this is entirely
# Sander's work", "## Architecture (two-tier)". Anchoring to `^##\s+Credits\s*$` reports
# those as MISSING and pushes you to add a second, emptier section next to the good one.
# So: allow a leading emoji/symbol run, and allow trailing text.
def heading(*words: str) -> re.Pattern:
    alt = "|".join(words)
    return re.compile(rf"^##+\s+[^\w\n]*(?:{alt})\b", re.M | re.I)


SECTIONS = [
    ("title",        re.compile(r"^#\s+\S", re.M)),
    ("preview",      re.compile(r"!\[[^\]]*\]\([^)]+\.(?:webp|gif|png|mp4)\)", re.I)),
    ("what it does", heading("What it does")),
    ("architecture", heading("Architecture", "Fabric architecture")),
    ("getting started", heading("Getting started", "Quick start", "Quickstart")),
    ("project structure", heading("Project structure", "Repository structure", "Structure")),
    ("scripts",      heading("Scripts", "npm scripts")),
    ("data",         heading("Data", "Data sources")),
    ("credits",      heading("Credits", "Notice", "Attribution", "Acknowledgements",
                             "Acknowledgments")),
]

CATEGORY_DIRS = ["games-and-learn", "fabric-admin", "industry"]


def app_readmes() -> list[Path]:
    """An app is a folder with a package.json. Group folders (patent-insights,
    education) hold several, so recurse instead of assuming one level."""
    out: list[Path] = []

    def walk(folder: Path, depth: int = 0):
        if (folder / "package.json").exists():
            out.append(folder / "README.md")
            return
        if depth >= 2:
            return
        for child in sorted(folder.iterdir()):
            if child.is_dir() and child.name not in {"node_modules", "dist"}:
                walk(child, depth + 1)

    for cat in CATEGORY_DIRS:
        base = REPO / cat
        if base.exists():
            walk(base)
    return out


def main() -> int:
    readmes = app_readmes()
    if not readmes:
        print("no app folders yet - nothing to check")
        return 0

    bad = 0
    for rm in readmes:
        rel = rm.relative_to(REPO).as_posix()
        if not rm.exists():
            print(f"  MISSING  {rel}")
            bad += 1
            continue
        t = rm.read_text(encoding="utf-8", errors="replace")
        # ⚠️ Strip HTML comments first. A TODO that *shows* the markup it will one day use
        # ("<!-- once the file exists, replace this with ![App](docs/previews/x.webp) -->")
        # otherwise satisfies the preview rule, and the whole repo passes with no previews.
        t = re.sub(r"<!--.*?-->", "", t, flags=re.S)
        missing = [name for name, rx in SECTIONS if not rx.search(t)]
        wip = t.lstrip().splitlines()[1:4]
        is_wip = any("work in progress" in ln.lower() for ln in wip)
        if missing:
            print(f"  INCOMPLETE {rel}{'  [wip]' if is_wip else ''}")
            print(f"             missing: {', '.join(missing)}")
            bad += 1
        else:
            print(f"  ok        {rel}{'  [wip]' if is_wip else ''}")

    print(f"\n{len(readmes) - bad}/{len(readmes)} app READMEs complete")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
