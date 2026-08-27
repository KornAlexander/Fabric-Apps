#!/usr/bin/env python3
"""Publication gate for Fabric-Apps.

Answers one question: *would anything in this tree tell a reader something about a
tenant, a customer, or a relationship with one?*

Five classes, deliberately overlapping - the overlap is the point, not redundancy.
An enumerated list only knows what somebody thought to enumerate; a shape matches
what nobody has seen yet.

  internal      hosts matched by SHAPE (not by a list of the ones already noticed)
  tenant_guid   ANY guid, paid for by a short allowlist that says why each survivor
                is not an address
  customer_people  salted digests, never literal names - a name blocklist publishes
                the names it blocks
  disclosure    does this tree describe a confidential RELATIONSHIP? survives the
                data being perfectly withheld
  german        a public README opens in English and stays in English

Usage
  python tools/verify_publishable.py                 scan the whole repo
  python tools/verify_publishable.py --path industry/airport-iq
  python tools/verify_publishable.py --hash "Surname"    add a name without writing it
"""
from __future__ import annotations

import argparse
import hashlib
import os
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------- restricted paths
# Files that must never exist in this tree at all, whatever they contain.
RESTRICTED_PATHS = [
    (re.compile(r"(^|/)rayfin/\.deployments\.json$"),
     "written by `rayfin up`: tenant id, workspace id, capacity host, hosting url"),
    # `.env.example` / `.env.sample` / `.env.template` are documentation, not secrets -
    # they are the standard way to tell someone which variables an app needs.
    (re.compile(r"(^|/)\.env(?:\.[A-Za-z]+)?$(?<!\.example)(?<!\.sample)(?<!\.template)"),
     "local secrets"),
]

# ---------------------------------------------------------------- classes
# SHAPE-matched. A live Fabric SQL endpoint once survived every green run because its
# host was in no line of an enumerated list.
INTERNAL = re.compile(
    rb"[A-Za-z0-9-]+\.webapp(?:\.msit)?\.fabricapps\.net"
    rb"|[0-9a-fA-F]{32}\.pbidedicated\.windows\.net"
    rb"|[A-Za-z0-9-]+\.database\.fabric\.microsoft\.com"
    # Eventhouse / KQL clusters and Warehouse endpoints. Added after a real cluster URI,
    # "trd-1u2v2sxv19k32hbdcc.z4.kusto.fabric.microsoft.com", sat in harbour-pulse's
    # parameter.yml through a green run - its host was in no line of the list above.
    # The lesson repeats every time: match the SHAPE, not the hosts you happened to see.
    rb"|[A-Za-z0-9.-]+\.dfs\.fabric\.microsoft\.com"
    rb"|[A-Za-z0-9.-]+\.kusto\.windows\.net"
    rb"|[A-Za-z0-9.-]+\.kusto\.fabric\.microsoft\.com"
    rb"|[A-Za-z0-9.-]+\.datawarehouse\.fabric\.microsoft\.com"
    rb"|[A-Za-z0-9-]+\.openai\.azure\.com"
    rb"|[A-Za-z0-9-]+\.vault\.azure\.net"
    rb"|[A-Za-z0-9-]+\.azurecr\.io"
    rb"|[A-Za-z0-9-]+\.servicebus\.windows\.net"
    rb"|[A-Za-z0-9-]+\.blob\.core\.windows\.net"
)

# Endpoints that are the SAME STRING in every tenant. They match the shape above because
# the shape is deliberately greedy, but they address nothing of ours:
#   onelake.dfs.fabric.microsoft.com   OneLake puts the workspace in the PATH, not the host
#   kusto.kusto.windows.net            an OAuth resource/audience constant
# Filtered here rather than with a negative lookahead - `(?!onelake\.)[A-Za-z0-9.-]+\.dfs`
# excludes nothing; it just starts matching one character later and reports
# "nelake.dfs.fabric.microsoft.com".
GLOBAL_ENDPOINTS = {
    "onelake.dfs.fabric.microsoft.com",
    "kusto.kusto.windows.net",
    "api.fabric.microsoft.com",
    "api.powerbi.com",
}

TENANT_GUID = re.compile(
    rb"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b"
)

UPN = re.compile(rb"[A-Za-z0-9._%+-]+@(?:microsoft\.com|[A-Za-z0-9-]+\.onmicrosoft\.com)")

USERPATH = re.compile(rb"[Cc]:\\+Users\\+[A-Za-z]")

GERMAN = re.compile(r"[\u00e4\u00f6\u00fc\u00c4\u00d6\u00dc\u00df]")
# ⚠️ Umlauts alone do not find German. "Demonstrations- und Schulungszweck. Keine
# Flugvorbereitung, keine Wetterberatung" sat in a public README through a CLEAN run
# because it happens to contain none. Function words are what actually mark the language.
# Two hits required, so an English sentence quoting one German term does not fire.
GERMAN_WORDS = re.compile(
    r"\b(und|nicht|keine|kein|oder|aber|auch|wird|werden|sind|eine|einer|einem|für|"
    r"mit|von|dem|den|des|das|die|der|auf|aus|bei|nach|über|zwischen|durch)\b")

# ---------------------------------------------------------------- customer_people
# Salted digests. A literal blocklist would make this file the one place in the repo
# that spells the names out.
NAME_SALT = "fabric-apps-publication-gate"
BLOCKED_NAME_DIGESTS: set[str] = set()   # add with --hash "Surname"
WORD = re.compile(r"[A-Za-z\u00c0-\u024f]{4,}")


def digest(name: str) -> str:
    return hashlib.sha256(f"{NAME_SALT}:{name.lower()}".encode()).hexdigest()[:16]


# ---------------------------------------------------------------- disclosure
# v3: windowed conjunction. ACTOR and TRANSFER-VERB and DATA-OBJECT within ~120 chars,
# any order, across line breaks.
#   v1 knew only "sent us" and missed "<institution> sent", the dominant form.
#   v2 widened to actor+verb and flagged innocent lines about shared shader uniforms.
ACTOR = re.compile(
    r"\b(OTH|LMU|TUM|EPO|the university|the customer|the institution|"
    r"the operator|the partner)\b", re.I)
# NOT "the client" - in a web app that is the browser, and it flagged
# "Trails are sent whole on the snapshot ... the client already has the history".
# Same failure direction as "they"/"we": too common to carry any signal.
# NOT "shared" - that is a building-ownership term here ("owner": "shared"). Its
# disclosure sense always carries a preposition, so it lives in EXPLICIT instead.
VERB = re.compile(r"\b(sent|supplied|provided|gave|handed|forwarded)\b", re.I)
# NOT "plans" - floor plans are published drawings.
OBJECT = re.compile(
    r"\b(export|extract|dataset|data|files|timetable|workbook|snapshot|Untis|"
    r"schedule|roster)\b", re.I)
# NOT a bare "confidential". It is a Microsoft Purview SENSITIVITY LABEL NAME, so it
# appears in every governance app's classification enum and in DP-600 quiz questions:
#   DLP_CLASSIFICATIONS = ("General", "Confidential", "Blocked")
# Those are vocabulary, not disclosure. Keep the phrasings that only occur when someone
# is describing how they came by something.
EXPLICIT = re.compile(
    r"\b(sent us|sent privately|privately for|for an evaluation|under NDA|"
    r"non-disclosure|strictly confidential|treated as confidential|"
    r"commercially confidential|not for publication|shared with us|shared privately)\b",
    re.I)

WINDOW = 120

# ---------------------------------------------------------------- allowlist
# ONE LINE PER FILE, SCOPED TO A CLASS. A blanket entry is a decision not to look, and a
# file excused for one class must still be scanned for the other four.
# A reason must QUOTE the offending text. If you cannot quote it, you have not read it.
ALLOWLIST: dict[str, tuple[set[str], str]] = {
    "tools/verify_publishable.py": ({"disclosure", "internal", "tenant_guid"},
        'the check quotes its own patterns, controls and allowlist examples: '
        'control_dirty = "The university sent its timetable export privately for an '
        'evaluation." and "pageId": "52351348-e3fe-4e25-a4c7-20102b0f1ba6"'),
    "CONTRIBUTING.md": ({"disclosure"},
        'explains the class by example: "The university sent its export privately for an '
        'evaluation" leaks the engagement while leaking zero rows'),
    "industry/helsinki-public-transport/src/cesium/helsinkiOpenData.ts": ({"tenant_guid"},
        'City of Helsinki OPEN DATA tileset ids on a public service: '
        '`${BASE}/3d/datasource-data/e5e7158a-52df-45a1-9be0-1be8f2828abd/tileset.json` '
        '- third-party public identifiers, nothing of ours'),
    "industry/harbour-pulse/scripts/provision-environment.ps1": ({"tenant_guid"},
        'the literal placeholder "11111111-1111-1111-1111-111111111111" shown as the '
        'shape of the value a user must supply'),

    # --- german: proper nouns only. Each reason quotes the surviving text so the next
    # reader can judge it without re-opening the file. Prose was translated, not excused.
    # ⚠️ These entries excuse the WHOLE class for the file, which is how a German
    # disclaimer ("Demonstrations- und Schulungszweck. Keine Flugvorbereitung...") rode
    # along in paragliding-insights under a reason that only justified "Allgäu". It was
    # found by re-running with the allowlist emptied. Do that before trusting a CLEAN run.
    "games-and-learn/paragliding-insights/README.md": ({"german"},
        'the mountain range, twice: "renders 9 x 8 km of the Allgäu Alps at true scale" '
        'and "The Allgäu is" - the only correct form of the place name'),
    "industry/airport-iq/README.md": ({"german"},
        'a city name: "repositioned onto Düsseldorf OSM geometry (real gates)"'),
    "industry/dwd-klimaspirale/README.md": ({"german"},
        '"clipped to the Bundesländer outline" - the German federal states, the term the '
        'DWD dataset itself uses for the boundary layer'),
    "industry/education/hochschul-race/README.md": ({"german"},
        'report page names and a legal term from the source data: "Home · Übersicht · '
        'Studenten" and "Trägerhochschule in the Hochschule dimension"'),
    "industry/flood-insights/tools/report/README.md": ({"german"},
        'a Power BI visual name that had to be shortened: "hence `visP2Sockel`, not '
        '`visP2Sockelhöhe`" - the identifier is the thing being discussed'),
    "industry/maritime-insights/README.md": ({"german"},
        'a bay name with its English gloss: "On the Kiel Fjord (*Kieler Förde*, AOI id '
        '`kieler-foerde`)"'),
    "industry/maritime-insights/server/assistant/README.md": ({"german"},
        'the same bay name plus "Förde" in an example question the assistant answers'),
}

# Whole-directory allowances need a shape-level justification, not a purpose.
ALLOWLIST_DIRS: list[tuple[re.Pattern, set[str], str]] = [
    (re.compile(r"(^|/)fabric/[^/]+\.(Report|SemanticModel)/"), {"tenant_guid"},
     'generated PBIR/TMDL item ids, e.g. "name": "e4b7a226-..." on a visual container - '
     'created locally by Power BI Desktop, they address nothing in a tenant'),
    (re.compile(r"(^|/)CustomVisuals/"), {"tenant_guid"},
     'the bundled visual\'s own package id, e.g. the folder '
     '"ibcsMultiTierBarECA4F65BFFB141198B7A6391AFFC946A" and the matching guid inside '
     'its pbiviz.json - it identifies the visual, not a tenant object'),
    (re.compile(r"(^|/)fabric/semantic-model/"), {"tenant_guid"},
     'TMDL lineage tags, e.g. "lineageTag: 9d0d5f84-bbd5-4579-8074-79115d759417" on a '
     'column - generated per object by the modelling tool, they address nothing remote'),
    (re.compile(r"\.KQLDashboard"), {"tenant_guid"},
     'dashboard layout ids, e.g. "pageId": "52351348-e3fe-4e25-a4c7-20102b0f1ba6" and '
     '"queryId": "a22c0c69-87a4-4fed-8c1b-540d13152f4c" - they identify tiles within the '
     'file itself. A real cluster URI in the same file would still be caught by the '
     '`internal` class, which is not excused here.'),
    (re.compile(r"\.(Eventstream|KQLQueryset|KQLDatabase|Notebook)(/|$)"), {"tenant_guid"},
     'Fabric item definition ids written by the service on export, e.g. the "id" of a '
     'stream node. Hosts and cluster URIs in these files stay in scope - only the '
     '`tenant_guid` class is excused.'),
    (re.compile(r"(^|/)fabric/eventhouse/RealTimeDashboard\.json$"), {"tenant_guid"},
     'the same dashboard layout ids as a .KQLDashboard folder, just exported to a single '
     'file: "pageId", "queryId" and tile "id". The cluster URI in the same file is NOT '
     'excused and is caught by the `internal` class.'),
]

TEXT_EXT = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".yml", ".yaml",
            ".py", ".html", ".css", ".txt", ".ps1", ".sh", ".sql", ".tmdl", ".pbir",
            ".env", ".ipynb", ".xml", ".svg"}
SKIP_DIRS = {"node_modules", ".git", "dist", "build", ".venv", "__pycache__",
             "coverage", ".vite", ".turbo"}


def iter_files(root: Path):
    """What would actually be published: tracked + untracked-but-not-ignored.

    ⚠️ Walking the filesystem is wrong. Running `npm run build` once inside the repo made
    a `prebuild` hook write `.env.local` into three apps; they are gitignored and contain
    nothing but two comment lines, yet the gate reported three `restricted_path`
    findings. Phantom findings are worse than none - they teach people to skim the class
    that is supposed to stop a real leak.
    Falls back to a plain walk when there is no git repository yet.
    """
    try:
        r = subprocess.run(
            ["git", "-C", str(REPO), "ls-files", "-z", "--cached", "--others",
             "--exclude-standard", str(root)],
            capture_output=True, timeout=120)
        names = [n.decode("utf-8", "replace") for n in r.stdout.split(b"\x00") if n]
        if names:
            for n in names:
                p = REPO / n
                if p.is_file():
                    yield p
            return
    except Exception:
        pass
    for dp, dns, fns in os.walk(root, onerror=lambda e: None):
        dns[:] = [d for d in dns if d not in SKIP_DIRS]
        for fn in fns:
            yield Path(dp) / fn


def allowed_classes(rel: str) -> tuple[set[str], str | None]:
    entry = ALLOWLIST.get(rel)
    if entry:
        return entry[0], entry[1]
    for rx, classes, reason in ALLOWLIST_DIRS:
        if rx.search(rel):
            return classes, reason
    return set(), None


def scan_disclosure(text: str) -> list[str]:
    hits = []
    flat = re.sub(r"\s+", " ", text)
    for m in EXPLICIT.finditer(flat):
        s = max(0, m.start() - 60)
        hits.append(f"explicit: ...{flat[s:m.end() + 60].strip()}...")
    for m in ACTOR.finditer(flat):
        lo, hi = max(0, m.start() - WINDOW), min(len(flat), m.end() + WINDOW)
        w = flat[lo:hi]
        if VERB.search(w) and OBJECT.search(w):
            hits.append(f"conjunction: ...{w.strip()}...")
    return hits


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--path", default=".", help="subtree to scan")
    ap.add_argument("--hash", help="print the salted digest for a surname and exit")
    ap.add_argument("--quiet", action="store_true")
    ap.add_argument("--no-allowlist", action="store_true",
                    help="ignore every allowlist entry. Run this before trusting a CLEAN "
                         "run: an entry excuses a whole class for a file, so it can hide "
                         "something its reason never mentioned.")
    args = ap.parse_args()

    if args.hash:
        print(f'    "{digest(args.hash)}",   # add to BLOCKED_NAME_DIGESTS')
        return 0

    root = (REPO / args.path).resolve()
    findings: list[tuple[str, str, str]] = []   # (class, path, detail)
    allowed_used: set[str] = set()
    scanned = 0

    for fp in iter_files(root):
        rel = fp.relative_to(REPO).as_posix()

        for rx, why in RESTRICTED_PATHS:
            if rx.search(rel):
                findings.append(("restricted_path", rel, why))

        if fp.suffix.lower() not in TEXT_EXT:
            continue
        try:
            if fp.stat().st_size > 4_000_000:
                continue
            raw = fp.read_bytes()
        except OSError:
            continue
        scanned += 1

        excused, reason = allowed_classes(rel)
        if args.no_allowlist:
            excused, reason = set(), None
        if reason:
            allowed_used.add(rel)

        if "internal" not in excused:
            for m in sorted({m.decode() for m in INTERNAL.findall(raw)}):
                if m in GLOBAL_ENDPOINTS:
                    continue
                findings.append(("internal", rel, m))
        if "upn" not in excused:
            for m in sorted({m.decode() for m in UPN.findall(raw)}):
                findings.append(("upn", rel, m))
        if "userpath" not in excused and USERPATH.search(raw):
            findings.append(("userpath", rel, r"a literal C:\Users\... path"))

        if "tenant_guid" not in excused:
            for m in sorted({m.decode() for m in TENANT_GUID.findall(raw)}):
                if m.lower() != "00000000-0000-0000-0000-000000000000":
                    findings.append(("tenant_guid", rel, m))

        if BLOCKED_NAME_DIGESTS:
            for w in {w.lower() for w in WORD.findall(raw.decode("utf-8", "replace"))}:
                if digest(w) in BLOCKED_NAME_DIGESTS:
                    findings.append(("customer_people", rel, "a blocked surname (digest match)"))

        text = raw.decode("utf-8", "replace")
        if "disclosure" not in excused:
            for h in scan_disclosure(text):
                findings.append(("disclosure", rel, h))

        if fp.name == "README.md" and "german" not in excused:
            if GERMAN.search(text):
                hits = sorted(set(GERMAN.findall(text)))
                findings.append(("german", rel,
                                 f"umlaut/eszett in a public README: {' '.join(hits)}"))
            words = GERMAN_WORDS.findall(text)
            if len(words) >= 2:
                findings.append(("german", rel,
                                 f"German function words in a public README: "
                                 f"{' '.join(sorted(set(words))[:8])}"))

    # ---- negative controls: the check has to still discriminate, in both directions.
    controls_clean = [
        "The shared lecture halls are owned by the campus, not by one faculty.",
        # A sensitivity-label vocabulary is not a disclosure.
        'DLP_CLASSIFICATIONS = ("General", "Confidential", "Blocked")',
        # A web client receiving its own payload is not a customer handing over data.
        "Trails are sent whole on the snapshot; the client already has the history.",
    ]
    control_dirty = "The university sent its timetable export privately for an evaluation."
    for c in controls_clean:
        if scan_disclosure(c):
            print(f"GATE BROKEN: the disclosure check fires on an innocent control: {c}")
            return 2
    if not scan_disclosure(control_dirty):
        print("GATE BROKEN: the disclosure check no longer fires on its positive control.")
        return 2

    by_class: dict[str, list] = {}
    for cls, rel, detail in findings:
        by_class.setdefault(cls, []).append((rel, detail))

    print(f"verify_publishable: {scanned} files scanned under {args.path}")
    print(f"controls ok - {len(controls_clean)} innocent lines quiet, planted line caught\n")

    if not findings:
        print(f"CLEAN. {len(allowed_used)} files covered by an allowlist reason.")
        return 0

    for cls in sorted(by_class):
        rows = by_class[cls]
        print(f"[{cls}] {len(rows)}")
        for rel, detail in rows[:40] if args.quiet else rows:
            print(f"    {rel}: {detail}")
        if args.quiet and len(rows) > 40:
            print(f"    ... and {len(rows) - 40} more")
        print()

    print(f"{len(findings)} findings. Fix them, or add a one-line allowlist entry that "
          f"QUOTES the offending text.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
