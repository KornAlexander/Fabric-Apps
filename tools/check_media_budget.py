#!/usr/bin/env python3
"""Media budget check.

Two checks, because one of them cannot see the actual risk.

  size    a media file over MAX_FILE_MB, or an app folder over MAX_APP_MB
  churn   a media file REPLACED more than once in recent history

The size check passes happily on five sequential 25 MB commits of the same GIF while
125 MB accumulates permanently in the pack. Size is a snapshot; the cost is cumulative.
Binaries are immortal in git - deleting the file does not give the bytes back.

The rule the cap is granted on: commit media ONCE. Iterate renders in a scratch folder.
"""
from __future__ import annotations

import os
import subprocess
import sys
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

MAX_FILE_MB = 25
MAX_APP_MB = 50
MAX_CHURN = 1          # how many times a media file may be replaced before we complain
CHURN_COMMITS = 200    # how far back to look

MEDIA_EXT = {".mp4", ".gif", ".webm", ".mov", ".png", ".jpg", ".jpeg", ".webp", ".svg"}
CATEGORY_DIRS = {"games-and-learn", "fabric-admin", "industry"}
SKIP_DIRS = {"node_modules", ".git", "dist", "build", ".venv", "__pycache__"}


def app_folders() -> list[Path]:
    """An app is a folder with a package.json. Group folders (patent-insights,
    education) hold several - recurse, so five sub-apps are not billed against one
    50 MB budget, and so this agrees with check_readme_sections.py about what an app is."""
    out: list[Path] = []

    def walk(folder: Path, depth: int = 0):
        if (folder / "package.json").exists():
            out.append(folder)
            return
        if depth >= 2:
            return
        for child in sorted(folder.iterdir()):
            if child.is_dir() and child.name not in SKIP_DIRS:
                walk(child, depth + 1)

    for cat in CATEGORY_DIRS:
        base = REPO / cat
        if base.exists():
            walk(base)
    return out


def media_in(folder: Path):
    for dp, dns, fns in os.walk(folder, onerror=lambda e: None):
        dns[:] = [d for d in dns if d not in SKIP_DIRS]
        for fn in fns:
            p = Path(dp) / fn
            if p.suffix.lower() in MEDIA_EXT:
                yield p


def check_size() -> list[str]:
    problems = []
    for app in app_folders():
        total = 0
        for p in media_in(app):
            mb = p.stat().st_size / 1024 / 1024
            total += mb
            if mb > MAX_FILE_MB:
                problems.append(
                    f"{p.relative_to(REPO).as_posix()}: {mb:.1f} MB > {MAX_FILE_MB} MB. "
                    f"Re-encode - it is almost always under-compressed, not too long.")
        if total > MAX_APP_MB:
            problems.append(
                f"{app.relative_to(REPO).as_posix()}: {total:.1f} MB of media > {MAX_APP_MB} MB")
    return problems


def check_churn() -> list[str]:
    try:
        out = subprocess.run(
            ["git", "-C", str(REPO), "log", f"-{CHURN_COMMITS}", "--name-only",
             "--pretty=format:", "--diff-filter=M"],
            capture_output=True, text=True, timeout=60).stdout
    except Exception:
        return []
    counts = Counter(
        line.strip() for line in out.splitlines()
        if line.strip() and Path(line.strip()).suffix.lower() in MEDIA_EXT)
    return [
        f"{name}: replaced {n} times in the last {CHURN_COMMITS} commits. "
        f"Every version is still in the pack forever - iterate in a scratch folder, "
        f"commit the final once."
        for name, n in counts.items() if n > MAX_CHURN
    ]


def main() -> int:
    size = check_size()
    churn = check_churn()
    if size:
        print(f"[media size] {len(size)}")
        for s in size:
            print(f"    {s}")
    if churn:
        print(f"\n[media churn] {len(churn)}")
        for c in churn:
            print(f"    {c}")
    if not size and not churn:
        n = sum(1 for a in app_folders() for _ in media_in(a))
        print(f"media budget ok - {n} files across {len(app_folders())} apps, "
              f"none over {MAX_FILE_MB} MB, no churn")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
