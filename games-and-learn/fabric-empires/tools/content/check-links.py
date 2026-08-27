"""Check that every documentation link in the question bank resolves.

A study aid that cites a dead page is worse than one that cites nothing: the
learner assumes the fault is theirs. This is deliberately NOT part of `npm run
verify`, because it needs the network and would make an offline build fail for
a reason that has nothing to do with the code. Run it after authoring.

    python tools/content/check-links.py
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "learn" / "content" / "dp-600" / "questions" / "src"

# Microsoft Learn redirects to a locale, so a redirect is a pass. Only a 4xx
# means the page is genuinely gone.
def status_of(url: str) -> int:
    request = urllib.request.Request(
        url,
        method="GET",
        headers={"User-Agent": "fabric-empires-link-check/1.0"},
    )
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code
    except Exception as error:  # noqa: BLE001 - report and keep going
        print(f"  network error: {error}")
        return 0


def main() -> int:
    urls: dict[str, list[str]] = {}
    for path in sorted(SRC.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        for question in data["questions"]:
            for field in ("learnUrl", "sourceLearnUrl"):
                url = question[field]
                urls.setdefault(url, []).append(f"{question['id']}.{field}")

    print(f"{len(urls)} distinct links across {SRC.name}/*.json\n")
    bad: list[tuple[str, int, list[str]]] = []

    for url, users in sorted(urls.items()):
        code = status_of(url)
        ok = 200 <= code < 400
        print(f"{'ok  ' if ok else 'FAIL'} {code:>3}  {url}")
        if not ok:
            bad.append((url, code, users))

    if bad:
        print(f"\n{len(bad)} broken link(s):")
        for url, code, users in bad:
            print(f"  {code} {url}")
            for user in users:
                print(f"      cited by {user}")
        return 1

    print("\nevery link resolves")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
