#!/usr/bin/env python3
"""Build a review-ready submission bundle per app for the Fabric Apps Gallery.

One folder per app under `submissions/`, each containing everything a submission needs and
nothing it does not: the post text, the links, the thumbnail and the demo. Review a folder,
say go, and it can be submitted without hunting for assets.

Why a generated bundle rather than a hand-kept folder:
  * the post text already exists as a gallery draft, and duplicating it by hand is how the
    two copies drift;
  * the assets already exist in docs/previews and docs/media, and copying them by hand is
    how a submission goes out with last week's screenshot.

`submissions/` is gitignored on purpose. Copying 48 MB of media into per-app folders and
committing it would duplicate every GIF and break the commit-media-once rule the media
budget check enforces. Regenerate it whenever you need it - it takes a second.

  python tools/build_submissions.py              all apps that have a draft
  python tools/build_submissions.py pbi-fixer    one app
"""
from __future__ import annotations

import json
import re
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DRAFTS = REPO / "docs" / "gallery-posts"
OUT = REPO / "submissions"
GITHUB = "https://github.com/KornAlexander/Fabric-Apps"
SITE = "https://kornalexander.github.io/Fabric-Apps"


def front_matter(text: str) -> dict:
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        return {}
    fm: dict = {}
    key = None
    for line in m.group(1).splitlines():
        if line.startswith("  - ") and key:
            fm.setdefault(key, []).append(line[4:].strip())
        elif ":" in line:
            key, _, val = line.partition(":")
            key = key.strip()
            val = val.split("#")[0].strip()
            fm[key] = val if val else []
    return fm


def body_of(text: str) -> str:
    parts = text.split("---", 2)
    return (parts[2] if len(parts) > 2 else text).strip()


def app_meta(app_path: str) -> dict:
    pkg = REPO / app_path / "package.json"
    if not pkg.exists():
        return {}
    return json.loads(pkg.read_text(encoding="utf-8")).get("template") or {}


def build(slug: str, draft: Path) -> bool:
    text = draft.read_text(encoding="utf-8", errors="replace")
    fm = front_matter(text)
    app_path = str(fm.get("app") or "")
    meta = app_meta(app_path)

    folder = OUT / slug
    if folder.exists():
        shutil.rmtree(folder)
    folder.mkdir(parents=True)

    # --- assets, renamed to what they ARE so the submission form is obvious ----
    copied: list[str] = []
    preview = REPO / "docs" / "previews" / f"{slug}.webp"
    if preview.exists():
        shutil.copy2(preview, folder / "thumbnail.webp")
        copied.append("thumbnail.webp  (the tile image)")
    for kind in ("gif", "mp4"):
        src = REPO / "docs" / "media" / f"{slug}-demo.{kind}"
        if src.exists():
            shutil.copy2(src, folder / f"demo.{kind}")
            mb = src.stat().st_size / 1_048_576
            copied.append(f"demo.{kind:<3}       ({mb:.1f} MB)")

    # --- the post itself, with the embed rewritten to the local copy ----------
    post = body_of(text)
    post = re.sub(r"!\[([^\]]*)\]\(docs/media/[^)]*-demo\.gif\)", r"![\1](demo.gif)", post)
    post = re.sub(r"!\[([^\]]*)\]\(docs/previews/[^)]*\.webp\)", r"![\1](thumbnail.webp)", post)
    (folder / "post.md").write_bytes(post.encode("utf-8"))

    live = meta.get("liveUrl")
    title = str(fm.get("title", "")).strip('"')

    # --- the cover sheet: everything the form will ask for, in one place ------
    lines = [
        f"# Submission: {meta.get('displayName', slug)}",
        "",
        "Everything in this folder is generated from the repository. To change any of it,",
        "change the source and re-run `python tools/build_submissions.py`.",
        "",
        "## Paste into the form",
        "",
        "**Title**",
        "",
        f"    {title}",
        "",
        "**Short description**",
        "",
        f"    {meta.get('description', '')}",
        "",
        "**Body** - the full post is in `post.md`, ready to paste.",
        "",
        "## Links",
        "",
        f"- Source code: {GITHUB}/tree/main/{app_path}",
        f"- App page:    {SITE}/apps/{slug}/",
        f"- Gallery:     {SITE}",
    ]
    if live:
        lines.append(f"- Try it live: {live}")
    lines += [
        "",
        "## Files in this folder",
        "",
        *[f"- `{c}`" for c in copied],
        "- `post.md`        the post body",
        "",
        "## Before you give the go",
        "",
        "- [ ] The thumbnail shows the app, not a menu, an error or an empty state",
        "- [ ] The demo actually moves",
        "- [ ] Nothing in the pixels names a customer, a tenant or a workspace you would",
        "      not put on a billboard",
        "- [ ] The links above all resolve",
    ]
    if not any(c.startswith("demo") for c in copied):
        lines += [
            "",
            "> ⚠️ **No demo in this folder.** The gallery expects a video or GIF. This app",
            "> has none yet, so the post falls back to the thumbnail.",
        ]
    (folder / "SUBMISSION.md").write_bytes(("\n".join(lines) + "\n").encode("utf-8"))

    size = sum(f.stat().st_size for f in folder.rglob("*") if f.is_file())
    print(f"  {slug:<28} {len(list(folder.iterdir()))} files  {size/1_048_576:5.1f} MB"
          f"{'' if any(c.startswith('demo') for c in copied) else '   (no demo)'}")
    return True


def main() -> int:
    if not DRAFTS.exists():
        print("no gallery drafts yet")
        return 1
    wanted = sys.argv[1:]
    OUT.mkdir(exist_ok=True)

    made = 0
    for draft in sorted(DRAFTS.glob("*.md")):
        slug = draft.stem
        if wanted and slug not in wanted:
            continue
        made += build(slug, draft)

    print(f"\n{made} bundle(s) in {OUT.relative_to(REPO).as_posix()}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
