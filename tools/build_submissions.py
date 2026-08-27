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


RAW = "https://raw.githubusercontent.com/KornAlexander/Fabric-Apps/main"


def to_html(md: str, slug: str) -> str:
    """Markdown draft -> the HTML the gallery's source-code view expects.

    Deliberately small: this handles the shapes the drafts actually use (h2/h3, bullet
    lists, fenced code, bold, links, the demo embed) and nothing else. A general markdown
    library would be more dependency for the same result on a file we generate ourselves.
    """
    out: list[str] = []
    in_list = False
    in_code = False
    code: list[str] = []

    # ⚠️ Strip HTML comments FIRST, across lines. Skipping only lines that start with
    # "<!--" left the continuation of a multi-line drafting note in the output, so every
    # generated post carried a stray "makes someone open the post rather than scroll past
    # it. -->" as a visible paragraph.
    md = re.sub(r"<!--.*?-->", "", md, flags=re.S)

    def esc(s: str) -> str:
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    def inline(s: str) -> str:
        s = esc(s)
        s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
        s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
        s = re.sub(r"\[([^\]]+)\]\((https?://[^)]+)\)",
                   r'<a href="\2" target="_blank" rel="noopener">\1</a>', s)
        # bare urls
        s = re.sub(r"(?<!\">)(?<!\()\b(https?://[^\s<]+)", r'<a href="\1" target="_blank" rel="noopener">\1</a>', s)
        return s

    def close_list():
        nonlocal in_list
        if in_list:
            out.append("</ul>")
            in_list = False

    for raw in md.splitlines():
        line = raw.rstrip()

        if line.startswith("```"):
            if in_code:
                out.append("<pre>" + esc("\n".join(code)) + "</pre>")
                code = []
            in_code = not in_code
            continue
        if in_code:
            code.append(line)
            continue

        if re.match(r"^<!--", line) or line.strip() in {"", "---"}:
            close_list()
            continue

        # the demo embed, pointed at raw GitHub so it plays inside the post
        m = re.match(r"^!\[[^\]]*\]\((?:demo\.gif|thumbnail\.\w+)\)$", line.strip())
        if m:
            close_list()
            src = f"{RAW}/docs/media/{slug}-demo.gif" if "demo.gif" in line \
                else f"{RAW}/docs/previews/{slug}.webp"
            out.append(f'<p><img src="{src}" alt="{slug} demo" width="900" /></p>')
            continue

        h = re.match(r"^(#{1,6})\s+(.*)$", line)
        if h:
            close_list()
            # the post title lives in the form's subject field, so h1 is dropped
            if len(h.group(1)) > 1:
                out.append(f"<h3>{inline(h.group(2))}</h3>")
            continue

        b = re.match(r"^\s*[-*]\s+(.*)$", line)
        if b:
            if not in_list:
                out.append("<ul>")
                in_list = True
            out.append(f"<li>{inline(b.group(1))}</li>")
            continue

        close_list()
        out.append(f"<p>{inline(line)}</p>")

    close_list()
    if in_code and code:
        out.append("<pre>" + esc("\n".join(code)) + "</pre>")
    return "\n".join(out) + "\n"


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
    #
    # ⚠️ The gallery's uploader accepts ONLY .jpg, .gif, .pdf and .wmv, with a 50 MB cap
    # and at most 3 files. Found by opening the real form, not from any documentation.
    # That rules out both of the repo's native formats: previews are .webp and demos are
    # .mp4. So the thumbnail is converted to JPG here, and the MP4 is deliberately left
    # out of the bundle - it cannot be uploaded, and shipping a file that will be rejected
    # wastes the reviewer's time.
    copied: list[str] = []
    preview = REPO / "docs" / "previews" / f"{slug}.webp"
    if preview.exists():
        from PIL import Image
        Image.open(preview).convert("RGB").save(folder / "thumbnail.jpg", "JPEG",
                                                quality=88, optimize=True)
        kb = (folder / "thumbnail.jpg").stat().st_size / 1024
        copied.append(f"thumbnail.jpg  ({kb:.0f} KB, the tile image)")
    gif = REPO / "docs" / "media" / f"{slug}-demo.gif"
    if gif.exists():
        shutil.copy2(gif, folder / "demo.gif")
        copied.append(f"demo.gif       ({gif.stat().st_size/1_048_576:.1f} MB)")

    # --- the post itself, with the embed rewritten to the local copy ----------
    post = body_of(text)
    post = re.sub(r"!\[([^\]]*)\]\(docs/media/[^)]*-demo\.gif\)", r"![\1](demo.gif)", post)
    post = re.sub(r"!\[([^\]]*)\]\(docs/previews/[^)]*\.webp\)", r"![\1](thumbnail.webp)", post)
    (folder / "post.md").write_bytes(post.encode("utf-8"))

    # --- and a paste-ready version -------------------------------------------
    # ⚠️ The gallery's editor is RICH TEXT, not markdown. Pasting post.md leaves "##" and
    # "![demo](demo.gif)" sitting in the published post as literal characters. Images go
    # in as attachments, so the embeds are dropped rather than converted.
    plain = post
    plain = re.sub(r"<!--.*?-->", "", plain, flags=re.S)      # drafting notes
    plain = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", plain)         # embeds -> attachments
    plain = re.sub(r"^#{1,6}\s*", "", plain, flags=re.M)       # heading marks
    plain = re.sub(r"```[a-z]*\n", "", plain)                  # fence open
    plain = plain.replace("```", "")
    plain = re.sub(r"\*\*([^*]+)\*\*", r"\1", plain)           # bold
    plain = re.sub(r"^\s*-\s+", "\u2022 ", plain, flags=re.M)  # bullets survive as text
    plain = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1: \2", plain)  # links -> label: url
    plain = re.sub(r"^-{3,}$", "", plain, flags=re.M)          # rules
    plain = re.sub(r"\n{3,}", "\n\n", plain).strip()
    (folder / "post-plain.txt").write_bytes((plain + "\n").encode("utf-8"))

    # --- and the version that is actually worth pasting ----------------------
    # The editor hides a "Source code" button in its toolbar overflow. Pasting HTML there
    # is the only way to get real headings, bold and bullet lists - typing plain text
    # produces a wall of <p> tags with literal bullet characters, which is what the first
    # attempt published and it looked exactly as bad as that sounds.
    #
    # The demo is embedded from its raw GitHub URL rather than the attachment, so it plays
    # inside the post body instead of sitting underneath it as a file.
    (folder / "body.html").write_bytes(to_html(post, slug).encode("utf-8"))

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
        "",
        "## Form facts, checked against the live form",
        "",
        "- Attachments: **.jpg, .gif, .pdf, .wmv only**. No .webp, no .mp4.",
        "- Max 3 attachments, 50 MB each.",
        "- The body editor is **rich text, not markdown** - paste `post-plain.txt`,",
        "  not `post.md`, or the `##` and `![]()` show up as literal characters.",
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
