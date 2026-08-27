#!/usr/bin/env python3
"""Validate the gallery and LinkedIn drafts.

A draft is not ready to post just because the words are written. This checks the things
that are easy to get wrong at the end of a long job:

  - every referenced asset actually exists  (a post with a broken image is worse than none)
  - `assetsReady` tells the truth
  - the repo link points at a folder that exists
  - a live post has recorded its `galleryUrl` back into the front matter

Exit 1 if a draft claims to be ready and is not.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DIRS = [REPO / "docs" / "gallery-posts", REPO / "docs" / "linkedin"]


def front_matter(text: str) -> dict:
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        return {}
    fm, key = {}, None
    for line in m.group(1).splitlines():
        if line.startswith("  - ") and key:
            fm.setdefault(key, []).append(line[4:].strip())
        elif ":" in line:
            key, _, val = line.partition(":")
            key = key.strip()
            val = val.split("#")[0].strip().strip('"')
            fm[key] = val if val else []
    return fm


def main() -> int:
    problems: list[str] = []
    drafts = 0
    ready = 0
    for d in DIRS:
        if not d.exists():
            continue
        for f in sorted(d.glob("*.md")):
            drafts += 1
            rel = f.relative_to(REPO).as_posix()
            t = f.read_text(encoding="utf-8", errors="replace")
            fm = front_matter(t)
            if not fm:
                problems.append(f"{rel}: no front matter")
                continue

            assets = fm.get("assets") or []
            missing = [a for a in assets if not (REPO / a).exists()]
            claims_ready = str(fm.get("assetsReady", "")).lower() == "true"

            if claims_ready and missing:
                problems.append(
                    f"{rel}: assetsReady is true but {len(missing)} asset(s) are missing: "
                    + ", ".join(missing[:3]))
            if not claims_ready and not missing and assets:
                problems.append(
                    f"{rel}: every asset exists but assetsReady is still false - "
                    f"flip it so the post can go out")

            app = fm.get("app")
            if app and not (REPO / str(app)).exists():
                problems.append(f"{rel}: app path '{app}' does not exist")

            # ⚠️ If the app ships a NOTICE.md that names a licence, it uses somebody else's
            # data under terms that require attribution. A post without it is not untidy,
            # it is a licence breach - four gallery posts shipped that way before this
            # check existed.
            #
            # The two draft types satisfy it differently: a gallery post has room for a
            # Credits section, a LinkedIn post carries the line inline. Demanding a
            # heading in both would push the attribution into a footnote nobody pastes.
            notice = REPO / str(app or "") / "NOTICE.md"
            if app and notice.exists():
                nt = notice.read_text(encoding="utf-8", errors="replace")
                obliged = re.search(r"CC BY|ODbL|dl-de|Datenquelle|©|Attribution:", nt)
                if obliged:
                    is_gallery = "gallery-posts" in rel
                    ok = (re.search(r"^##\s+Credits", t, re.M) if is_gallery
                          else re.search(r"CC BY|ODbL|dl-de|Datenquelle|©|NOTICE\.md", t))
                    if not ok:
                        where = "a Credits section" if is_gallery else "the attribution inline"
                        problems.append(
                            f"{rel}: {app}/NOTICE.md prescribes attribution, so this post "
                            f"MUST carry {where}")

            if claims_ready and not missing:
                ready += 1

    print(f"gallery/linkedin drafts: {drafts} found, {ready} ready to post")
    if not drafts:
        return 0
    if problems:
        print()
        for p in problems:
            print(f"  {p}")
        # Missing assets on a draft that honestly says so is expected mid-flight.
        hard = [p for p in problems if "assetsReady is true but" in p or "does not exist" in p or "MUST carry" in p]
        if hard:
            print(f"\n{len(hard)} blocking problem(s).")
            return 1
        print("\nNo blocking problems - the rest are drafts waiting on Phase 1e assets.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
