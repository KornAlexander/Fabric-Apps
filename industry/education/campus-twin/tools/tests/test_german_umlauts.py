"""The German the professor reads must be German, not its ASCII transliteration.

⚠️ The standing rule is real umlauts and Eszett in German text, and the whole agent package was
written in transliteration: "Verfuegbarkeiten melden", "Planungsbuero", "ausschliesslich". That is
the description a German professor sees in Copilot, and it reads like a 1990s fax.

It was an oversight rather than a constraint, which the pipeline itself gives away: the package is
written with `ensure_ascii=False`, `encoding="utf-8"` and `allow_unicode=True`. Every one of those
is a deliberate choice to carry Unicode, made by somebody who then wrote no Unicode.

⚠️ THE FORBIDDEN LIST IS DELIBERATELY NARROW. `ue`, `oe` and `ae` occur constantly in correct
German ("neue", "Gruppe", "Datum"), so a blanket search would be noise. These entries are strings
that are never a correct German word in this domain, so a hit is always a real defect.

⚠️ AND ONE SPELLING IS PROTECTED. `nicht_verfuegbar` is a DATA VALUE in
`dbo.TeacherAvailabilities`, matched against rows the deployed app already wrote. Correcting it
would mint a second, incompatible state and silently stop matching every existing row. It is
asserted PRESENT here, so a future tidy-up cannot quietly "fix" it.
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

import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "agent"))

FAILURES: list[str] = []

#: Never a correct German word. A hit is a transliteration, not a false positive.
FORBIDDEN = [
    "Verfuegbar", "Planungsbuero", "ausschliesslich", "veroeffentlich", "Familiengruende",
    "zurueckgibt", "zusaetzlich", "veraendert", "Benoetigt", "Aenderung", "geaendert",
    "GRUENDEN", "erklaere", "aelteren", "groesser", "moeglich", "gehoert", "pruefen",
    "Aendert", "dafuer", "wuerde",
]

#: The data value that must NOT be "corrected". See the module docstring.
PROTECTED = "nicht_verfuegbar"


def check(name: str, condition: bool, detail: object = "") -> None:
    print(f"  {'ok ' if condition else 'FAIL'} {name}" + (f"  [{detail}]" if detail else ""))
    if not condition:
        FAILURES.append(name)


def main() -> int:
    import build_agent_package as builder

    # Every German string the package publishes, gathered from the built objects rather than the
    # source, so this checks what is actually shipped.
    published = json.dumps(
        {
            "agent": builder.declarative_agent(),
            "plugin": builder.ai_plugin(),
            "manifest": builder.manifest(),
        },
        ensure_ascii=False,
    )

    print(f"published German text: {len(published)} chars\n")

    for token in FORBIDDEN:
        check(f"no transliteration of '{token}'", token not in published)

    print()
    check("real umlauts really are present", any(c in published for c in "äöüÄÖÜ"),
          "".join(sorted({c for c in published if c in "äöüÄÖÜß"})))

    # ⚠️ The characters have to survive the round trip into the files, not just exist in memory.
    # `ensure_ascii=True` would still be valid JSON and would still render correctly, but the
    # YAML and the zip are where a mojibake would actually appear.
    builder.main() if hasattr(builder, "main") else builder.build()
    agent_json = (Path(builder.OUT_DIR) / "declarativeAgent.json").read_text(encoding="utf-8")
    check("the written file carries the characters, not escapes",
          "ü" in agent_json or "ä" in agent_json or "Ä" in agent_json)
    check("and it is still valid JSON", isinstance(json.loads(agent_json), dict))

    zip_path = Path(str(builder.OUT_DIR) + ".zip")
    with zipfile.ZipFile(zip_path) as zf:
        from_zip = zf.read("declarativeAgent.json").decode("utf-8")
    check("the zip round-trips them too", "ü" in from_zip or "ä" in from_zip)

    print()
    server = (ROOT / "server" / "intake.py").read_text(encoding="utf-8")
    check(f"⚠️ the data value '{PROTECTED}' was NOT 'corrected'", PROTECTED in server)

    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {FAILURES}")
        return 1
    print("OK - the German is spelled the way a German reader expects, and the data value is safe")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
