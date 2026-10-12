"""Is the English building report the German one in other words, and nothing else?

A site may have its report in a second language (`English` in tools/fabric/sites.py). It is a second
report over the SAME model, and the whole point of that design is that a figure cannot differ
between the two pages. Three properties, in order of how badly each would fail:

  1. ⚠️ BOTH LANGUAGES SHOW THE SAME MEASURES. If the English page used another measure for a number,
     the two pages could disagree about one building and each would look correct on its own.
  2. No German word is left on the English page as a header, a title or the footnote. A mixed page
     reads as unfinished, and nobody can tell which half to trust.
  3. ⚠️ A SITE WITHOUT AN ENGLISH REPORT IS REFUSED, NOT GIVEN THE GERMAN ONE. Generated under the
     German report's name it would be published over the German report.

Nothing here talks to Fabric. Run it directly: `python tools/tests/test_report_languages.py`.
"""

from __future__ import annotations

import sys as _sys

if hasattr(_sys.stdout, "reconfigure"):
    _sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(_sys.stderr, "reconfigure"):
    _sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "fabric"))

import build_report  # noqa: E402
from sites import SITES  # noqa: E402

FAILURES: list[str] = []


def check(ok: bool, what: str) -> None:
    print(f"  {'ok  ' if ok else 'FAIL'} {what}")
    if not ok:
        FAILURES.append(what)


def walk(node, found: dict[str, list[str]]) -> None:
    """Collect what a visual shows: the measures and columns it reads, and the words it prints."""
    if isinstance(node, dict):
        if "Measure" in node and isinstance(node["Measure"], dict) and "Property" in node["Measure"]:
            found["measures"].append(node["Measure"]["Property"])
        if "Column" in node and isinstance(node["Column"], dict) and "Property" in node["Column"]:
            found["columns"].append(node["Column"]["Property"])
        for key in ("displayName", "value"):
            if isinstance(node.get(key), str):
                found["words"].append(node[key])
        literal = node.get("Literal")
        if isinstance(literal, dict) and str(literal.get("Value", "")).startswith("'"):
            found["words"].append(str(literal["Value"]).strip("'"))
        for value in node.values():
            walk(value, found)
    elif isinstance(node, list):
        for value in node:
            walk(value, found)


def page(site: str, lang: str) -> dict[str, list[str]]:
    build_report.select(site, lang)
    found: dict[str, list[str]] = {"measures": [], "columns": [], "words": []}
    for path, raw in build_report.build(None).items():
        if path.endswith(".json"):
            walk(json.loads(raw), found)
    return found


def main() -> None:
    site = next((key for key, value in SITES.items() if value.english), None)
    if site is None:
        print("no site has an English report: nothing to compare")
        return
    german, english = page(site, "de"), page(site, "en")
    de, en = build_report.LABELS["de"], build_report.LABELS["en"]
    print(f"{site}: German and English report")

    # 1. The same numbers. The two text measures are the only ones that may differ.
    words_de = {de["title_measure"], de["stamp_measure"]}
    words_en = {en["title_measure"], en["stamp_measure"]}
    check(sorted(set(german["measures"]) - words_de) == sorted(set(english["measures"]) - words_en),
          "both languages read the same numeric measures")
    check(words_en <= set(english["measures"]) and not (words_de & set(english["measures"])),
          "the English page takes its title and its stamp from the English measures only")
    check(len(german["measures"]) == len(english["measures"]), "and reads them the same number of times")
    check(en["day_column"] in english["columns"] and de["day_column"] not in english["columns"],
          "the English week grid names its days in English")
    check(sorted(set(german["columns"]) - {de["day_column"]}) == sorted(set(english["columns"]) - {en["day_column"]}),
          "every other column is the same in both")

    # 2. No German left on the English page. Colours and sizes are literals too, and are not words.
    german_words = {w for key, w in de.items() if w and not key.endswith(("_measure", "_column")) and w != en[key]}
    german_words |= {SITES[site].footnote}
    printed = set(english["words"])
    check(not (german_words & printed), f"no German header or title on the English page {sorted(german_words & printed)}")
    check(SITES[site].english.footnote in printed, "the English footnote is the one on the page")
    # ⚠️ THE MIRROR. Without it, a page that printed no words at all would pass the check above.
    # The name column is only on the page where the site's rooms carry names.
    absent = set() if SITES[site].room_names else {"name"}
    expected = {w for key, w in en.items() if not key.endswith(("_measure", "_column")) and key not in absent}
    check(expected <= printed, f"every English label is on the page {sorted(expected - printed)}")
    check("ä" not in "".join(sorted(expected)) and "ß" not in "".join(sorted(expected)), "the English labels are English")

    # The measures and the weekday column a page reads must exist in the site's generated model.
    # ⚠️ A NAME THE MODEL DOES NOT HAVE IMPORTS CLEANLY AND RENDERS AN EMPTY TILE. Read from the
    # TMDL on disk, which `build_semantic_model.py --write-only` writes: the generator itself
    # reads its arguments on import and cannot be loaded here.
    tables = SITES[site].model_dir / "definition" / "tables"
    if (tables / "Measure.tmdl").exists():
        defined = set(re.findall(r"^\tmeasure '([^']+)'", (tables / "Measure.tmdl").read_text(encoding="utf-8"), re.M))
        slots = set(re.findall(r"^\tcolumn (\S+)", (tables / "Time Slot.tmdl").read_text(encoding="utf-8"), re.M))
        for lang, found in (("de", german), ("en", english)):
            missing = sorted(set(found["measures"]) - defined)
            check(not missing, f"{lang}: every measure on the page is in the model {missing}")
            check(build_report.LABELS[lang]["day_column"] in slots, f"{lang}: the weekday column is in the model")
    else:
        # Said out loud, so "all checks passed" is never read as "the model was looked at". A clone
        # that does not carry the generated `fabric/` folder has nothing to compare with.
        print(f"  ·    not checked against the model: {tables.relative_to(ROOT)} is not on disk "
              f"(build_semantic_model.py --site {site} --write-only writes it)")

    # 3. A site without an English report is refused, and the generator is left where it was.
    before = page(site, "en")
    for key, value in SITES.items():
        if value.english:
            continue
        try:
            build_report.select(key, "en")
        except SystemExit:
            check(True, f"{key}: an English report is refused")
        else:
            check(False, f"{key}: an English report is refused")
        check(value.languages == ("de",), f"{key}: offers German only")
        for lang in ("fr", "EN", ""):
            for ask in (value.report_name_in, value.report_dir_in):
                try:
                    ask(lang)
                except SystemExit:
                    continue
                check(False, f"{key}: {ask.__name__}({lang!r}) answered instead of refusing")
        # Still the site and the language chosen before the refusal, with nothing half-switched.
        check(build_report.SITE.key == site and build_report.T is en and build_report.TEXTS is SITES[site].english,
              f"{key}: a refusal leaves the generator on the report it was building")
        untouched: dict[str, list[str]] = {"measures": [], "columns": [], "words": []}
        for path, raw in build_report.build(None).items():
            if path.endswith(".json"):
                walk(json.loads(raw), untouched)
        check(untouched == before, f"{key}: and that report still comes out the same")

    # And the two reports cannot be published over each other.
    target = SITES[site]
    check(target.report_name_in("de") != target.report_name_in("en"), "the two reports have different names")
    check(target.report_dir_in("de") != target.report_dir_in("en"), "and are written to different folders")

    if FAILURES:
        print(f"\n{len(FAILURES)} check(s) failed")
        sys.exit(1)
    print("\nall checks passed")


if __name__ == "__main__":
    main()
