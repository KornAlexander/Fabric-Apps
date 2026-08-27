#!/usr/bin/env python3
"""Check that every relative link in the repo's markdown actually resolves.

This exists because dropping per-app SECURITY.md / CONTRIBUTING.md at import time was the
right call for duplication, and instantly wrong for the READMEs that linked to them. The
files vanished; the links did not. Nothing failed - a broken link is invisible to every
other check in this repo, and a gallery visitor finds it before you do.

Only relative links are checked. External URLs are left alone: a network check makes CI
flaky and would fail on anything rate-limited.
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote

REPO = Path(__file__).resolve().parent.parent

LINK = re.compile(r"(?<!\!)\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
IMAGE = re.compile(r"!\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
SKIP_PREFIX = ("http://", "https://", "mailto:", "#", "data:", "{{", "<http")


# Assets Phase 1e has not produced yet. They are already gated by check_gallery_drafts.py
# via `assetsReady`, so failing here too would report one problem as two and train people
# to run this check with their eyes closed.
PENDING_ASSET = re.compile(r"docs/previews/[^/]+\.(webp|png)$|/media/[^/]+-demo\.(gif|mp4|webm)$")

# The README template is a template. Its example paths (`docs/previews/app-slug.webp`) are
# there to be copied and edited, not to resolve.
SKIP_FILES = {"docs/app-README-template.md"}


def is_external(target: str) -> bool:
    """⚠️ Angle-bracket autolinks break the naive parser. A Wikimedia filename containing
    a bracket - `<https://commons.wikimedia.org/wiki/File:Ruby_Langford_(01).jpg>` - ends
    the markdown link early, so the checker saw `<https://...(01` and called it a broken
    relative path. Five perfectly good attribution links were reported as broken."""
    t = target.lstrip("<")
    return t.startswith(SKIP_PREFIX) or t.startswith(("http://", "https://"))


def tracked_markdown() -> list[Path]:
    try:
        r = subprocess.run(
            ["git", "-C", str(REPO), "ls-files", "-z", "--cached", "--others",
             "--exclude-standard", "*.md"],
            capture_output=True, timeout=60)
        names = [n.decode("utf-8", "replace") for n in r.stdout.split(b"\x00") if n]
        if names:
            return [REPO / n for n in names if (REPO / n).is_file()]
    except Exception:
        pass
    return [p for p in REPO.rglob("*.md") if "node_modules" not in p.parts]


def main() -> int:
    broken: list[tuple[str, str, str]] = []
    pending: list[tuple[str, str, str]] = []
    checked = 0
    files = tracked_markdown()

    for f in files:
        rel = f.relative_to(REPO).as_posix()
        if rel in SKIP_FILES:
            continue
        try:
            text = f.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for rx, kind in ((LINK, "link"), (IMAGE, "image")):
            for m in rx.finditer(text):
                target = m.group(1).strip()
                if is_external(target):
                    continue
                path_part = unquote(target.split("#")[0])
                if not path_part:
                    continue
                checked += 1
                resolved = (f.parent / path_part).resolve()
                if not resolved.exists():
                    if PENDING_ASSET.search(path_part):
                        pending.append((rel, kind, target))
                    else:
                        broken.append((rel, kind, target))

    print(f"check_links: {checked} relative links in {len(files)} markdown files")
    if pending:
        print(f"  {len(pending)} reference assets Phase 1e has not produced yet "
              f"(gated by check_gallery_drafts.py, not failed here)")
    if not broken:
        print("all resolvable links resolve")
        return 0

    print()
    by_file: dict[str, list] = {}
    for rel, kind, target in broken:
        by_file.setdefault(rel, []).append((kind, target))
    for rel in sorted(by_file):
        print(f"  {rel}")
        for kind, target in by_file[rel]:
            print(f"      broken {kind}: {target}")
    print(f"\n{len(broken)} broken link(s).")
    return 1


if __name__ == "__main__":
    sys.exit(main())
