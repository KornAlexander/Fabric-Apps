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
import gzip
import hashlib
import io
import os
import re
import subprocess
import sys
import zlib
from pathlib import Path, PurePosixPath

REPO = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------- restricted paths
# Files that must never exist in this tree at all, whatever they contain.
# ⚠️ CASE-INSENSITIVE: `plan.md` on a case-insensitive disk is the same file as `PLAN.md`, and a
# rule that only knows one spelling is a rule a rename defeats (review 2026-10-05).
RESTRICTED_PATHS = [
    (re.compile(r"(^|/)rayfin/\.deployments\.json$", re.I),
     "written by `rayfin up`: tenant id, workspace id, capacity host, hosting url"),
    # `.env.example` / `.env.sample` / `.env.template` are documentation, not secrets -
    # they are the standard way to tell someone which variables an app needs. Every other
    # `.env` variant is local configuration, including multi-part ones (`.env.production.local`).
    (re.compile(r"(^|/)\.env(?!\.(?:example|sample|template)$)(?:\.[^/]*)?$", re.I),
     "local secrets"),
    # Private planning and provenance documents. They name customer repositories by design and
    # live outside this repo; an exact name here is the second line of defence after the marker
    # check below (`campus-twin/docs/plan-umplanen-*.md` is a public doc and must stay allowed).
    (re.compile(r"(^|/)(PLAN|PLAN-draft|PROVENANCE)\.md$", re.I), "private plan or provenance document"),
    (re.compile(r"(^|/)(provenance\.json|build_provenance\.py)$", re.I), "private provenance manifest"),
    (re.compile(r"(^|/)rayfin\.config\.json$", re.I), "written by `rayfin up`: tenant, workspace and item ids"),
]

# Text that private documents carry on purpose so they cannot be published by accident.
# Assembled from fragments, or this file would carry the marker itself.
# ⚠️ JOINED AT RUNTIME, NOT WITH `+`. The compiler folds `b"PRIV" + b"ATE"` into one constant, so
# the tracked tools/__pycache__/*.pyc carried the whole marker and failed the binary marker check.
_join = b"".join
PRIVATE_MARKER = re.compile(_join((
    rb"This file is ", rb"PRIV", rb"ATE|PRIV", rb"ATE: this folder",
    rb"|Do not copy\s+into the public|must never be copied into\s+the public")))

# ---------------------------------------------------------------- classes
# SHAPE-matched. A live Fabric SQL endpoint once survived every green run because its
# host was in no line of an enumerated list.
INTERNAL = re.compile(
    rb"[A-Za-z0-9-]+\.webapp(?:\.msit)?\.fabricapps\.net"
    rb"|[0-9a-fA-F]{32}\.pbidedicated\.windows\.net"
    rb"|[A-Za-z0-9-]+\.database\.fabric\.microsoft\.com"
    # Eventhouse / KQL clusters and Warehouse endpoints. Added after a real cluster URI of the
    # shape "trd-<random>.<zone>.kusto.fabric.microsoft.com" sat in an app's parameter.yml
    # through a green run - its host was in no line of the list above.
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
    # Container Apps hosts (<app>.<env>.<region>.azurecontainerapps.io). Added 2026-10-02
    # after a plan review found a relay origin hard-coded in a private source repo that
    # was about to be ported: the shape list above had no line for it.
    rb"|[A-Za-z0-9.-]+\.azurecontainerapps\.io"
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
# Organisations and people whose relationship must not surface. Single words AND two-word
# names: an organisation is often two ordinary words that are only a name together.
# Three-letter acronyms count too - the first tokenizer ({4,}) could never match one.
BLOCKED_NAME_DIGESTS: set[str] = {   # add with --hash "Name" or --hash "Two Words"
    "d4523fe3e3d7056b", "2c225e010f8f1af9", "e6ebf78c90b7c14c", "97dd62571e531251",
    "5e38d0addcc047e2", "a2a0278cae4ffe64", "7b06918ff5b7fb82", "9e27566bcc238e5a",
    "63c9627c2ca9ebb9", "dc94109b9de0bc16",
}
WORD = re.compile(r"[A-Za-z\u00c0-\u024f]{3,}")
# Base64 (lockfile integrity hashes, inline PNGs) contains random letter runs; a 3-letter
# run there is noise, not a name. Measured: two lockfiles and a notebook PNG fired on a
# 3-letter acronym. Only words INSIDE an encoded run are skipped, and a run counts as encoded
# only in a context that SAYS it is encoded: right after an integrity prefix (sha512-) or a
# data-URI marker (base64,), or starting with an image file's own base64 signature. Character
# statistics alone were not enough: a digit rule hid "tiles/<name>/data", a length rule hid long
# paths, and a letter-case rule still hid mixed-case paths such as "Exports/2024/ACME/<name>"
# (three successive reviews).
B64_RUN = re.compile(r"[A-Za-z0-9+/=]{32,}")
B64_CONTEXT = re.compile(r"(?:sha(?:1|256|384|512)-|base64,)$")
B64_SIGNATURE = ("iVBORw0KGgo", "/9j/", "R0lGOD", "UklGR")  # PNG, JPEG, GIF, WebP


def _looks_encoded(text: str, start: int, run: str) -> bool:
    if not any(c.isdigit() for c in run):
        return False
    return bool(B64_CONTEXT.search(text[max(0, start - 8):start])) or run.startswith(B64_SIGNATURE)


def digest(name: str) -> str:
    return hashlib.sha256(f"{NAME_SALT}:{' '.join(name.lower().split())}".encode()).hexdigest()[:16]


def _words(text: str) -> list[str]:
    encoded = [m.span() for m in B64_RUN.finditer(text) if _looks_encoded(text, m.start(), m.group())]
    out = []
    for m in WORD.finditer(text):
        if any(lo <= m.start() and m.end() <= hi for lo, hi in encoded):
            continue
        out.append(m.group().lower())
    return out


def scan_names(text: str) -> bool:
    """True if any word or adjacent word pair matches a blocked digest."""
    words = _words(text)
    if any(digest(w) in BLOCKED_NAME_DIGESTS for w in set(words)):
        return True
    return any(digest(f"{a} {b}") in BLOCKED_NAME_DIGESTS for a, b in set(zip(words, words[1:])))


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
    "tools/verify_publishable.py": ({"disclosure", "internal", "tenant_guid", "upn"},
        'the check quotes its own patterns, controls and allowlist examples: '
        'control_dirty = "The university sent its timetable export privately for an '
        'evaluation." and "pageId": "52351348-e3fe-4e25-a4c7-20102b0f1ba6", and the '
        'allowlist reason quoting the fake test address "nutzer@example.onmicrosoft.com"'),
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
    "games-and-learn/fabric-empires/tools/fabric/_config.py": ({"tenant_guid"},
        'a uuid5 NAMESPACE constant invented for the app, not an address: "The namespace '
        'every `lineageTag`, `logicalId` and relationship name in the generated definitions '
        'is derived from, via uuid5." LINEAGE_NS = uuid.UUID(\'6f2b1c44-1f7d-4a52-9b0e-7c1d5c2f0a11\')'),

    # --- campus-twin. ⚠️ THIS APP'S OWN GATE MISSED THINGS THIS ONE CAUGHT, which is the
    # argument for keeping two checks with different shapes. Found and FIXED, not excused:
    # a deployed host in rayfin.yml (`epic-lava-…-swedencentral.webapp.fabricapps.net`),
    # and `tools/fabric/seed_teacher_availability.py`, whose ID_ORACLE spelled out real
    # lecturer short codes ("IM-T007", "M-T029") - deleted, along with the test importing it.
    "industry/education/campus-twin/tools/verify_publishable.py":
        ({"disclosure", "internal", "tenant_guid"},
        'that app\'s own gate, which has to spell its patterns out: EXPLICIT contains '
        '"\\bsent us\\b|...|\\bunder (?:an )?NDA\\b" and it documents the failure it was '
        'written for - "a named university had sent us their timetable privately for an '
        'evaluation"'),
    "industry/education/campus-twin/README.md": ({"german"},
        'place names only, in the sites table and its captions: "University of Münster", '
        '"University of Tübingen - Old Town, Neckar, castle", "FAU Erlangen-Nürnberg" and '
        'the survey authority "LGL Baden-Württemberg". No German prose'),
    "industry/education/campus-twin/src/__tests__/deployGuard.test.ts": ({"tenant_guid"},
        'two RootActivityIds quoted inside a simulated CLI failure line, '
        '"RootActivityId: 045cd29c-db09-4300-bf1e-64f299d5f82e... FAILED (15.6s)" - a '
        'request correlation id from a deploy that failed, which addresses nothing'),
    "industry/education/campus-twin/src/api/__tests__/assignmentId.test.ts": ({"tenant_guid"},
        'deterministic uuid5 test vectors, keyed by GENERATED module codes rather than any '
        'timetable: "\'oth:IM-DATA-1-C1-ALL-S1\': \'ac548a6f-d190-4b2c-8acc-8d5d703f6162\'". '
        'The ids are outputs of the algorithm under test, not addresses'),
    "industry/education/campus-twin/tools/fabric/build_semantic_model.py": ({"tenant_guid"},
        'a uuid5 NAMESPACE constant, not an address: "#: Deterministic lineage tags, so '
        'republishing does not churn the definition. NAMESPACE = '
        'uuid.UUID(\'6f1d1c4e-9f1a-4b7c-9c0e-2f7a5a1b8d33\')"'),
    "industry/education/campus-twin/tools/tests/test_intake_http.py": ({"tenant_guid"},
        'a deliberately fake tenant id, and the file says why: "A real identifier bought '
        'the test nothing and put a live tenant id in a repository that ships as a '
        'template. env[\'ENTRA_TENANT_IDS\'] = \'11111111-2222-3333-4444-555555555555\'"'),

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

    # --- city-utility-twin (added 2026-10-02). Successor of the retired muenchen-zwilling app
    # (removed 2026-10-05); its test fixtures came along unchanged. Quotes re-read in the copies.
    "industry/city-utility-twin/server/test_entra.py": ({"tenant_guid", "upn"},
        'fake token claims for the Entra check: "99999999-8888-7777-6666-555555555555", '
        '"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "11111111-2222-3333-4444-555555555555" '
        'and "nutzer@example.onmicrosoft.com"'),
    "industry/city-utility-twin/tests/map.test.mjs": ({"tenant_guid", "internal"},
        'guard controls: "11111111-2222-3333-4444-555555555555" must be flagged, '
        '"https://test-map-swedencentral.webapp.fabricapps.net" is a made-up redirect host and '
        '"ca-something-else.example-env.northeurope.azurecontainerapps.io" a made-up foreign origin'),
    "industry/city-utility-twin/tools/verify-local-hosts.mjs": ({"tenant_guid", "internal"},
        'a guard control: "11111111-2222-3333-4444-555555555555", and two made-up hosts the '
        'guard must tell apart: "twin-sample.northeurope.azurecontainerapps.io" and '
        '"other.northeurope.azurecontainerapps.io"'),
    "industry/city-utility-twin/tools/map-assets.mjs": ({"tenant_guid"},
        'two public Microsoft constants also in the MSAL sources: '
        '"9188040d-6c67-4c5b-b112-36a304b66dad" (consumer-account tenant) and '
        '"53ee284d-920a-4b59-9d30-a60315b26836"'),
    "industry/city-utility-twin/tools/deploy-agent.ps1": ({"internal"},
        'a documentation placeholder, not a host: "registry.azurecr.io"; the real registry '
        'comes from $env:ACR_NAME'),
    "industry/city-utility-twin/tools/deploy-relay.ps1": ({"internal"},
        'the same placeholder: "registry.azurecr.io"'),

    # OpenStreetMap building tags, not a relationship: the "operator" key on six campus-area
    # buildings names the municipal utility that runs them (public OSM data, ODbL).
    "industry/education/campus-twin/config/buildings-lmu.json": ({"customer_people"},
        'OSM tag values of the form "operator": "<utility name>" on six buildings, copied '
        'verbatim from OpenStreetMap'),
    "industry/maritime-insights/src/auth/fabricAuth.test.ts": ({"internal"},
        'a made-up host in the deployed shape for the fail-closed test: '
        '"https://example-app-host-swedencentral.webapp.fabricapps.net/" - no real deployment uses it'),
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
            ".env", ".ipynb", ".xml", ".svg", ".csv", ".tsv", ".geojson", ".toml",
            ".ini", ".cfg", ".kql", ".gz"}
# Same cap as check_media_budget.py's per-file limit. The old 4 MB cap silently skipped
# large generated JSON/CSV, which is exactly where generator prose leaks.
MAX_SCAN_BYTES = 25_000_000
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


def _git(*args: str) -> bytes:
    return subprocess.run(["git", "-C", str(REPO), *args], check=True, capture_output=True,
                          timeout=600).stdout


class _BlobReader:
    """Every blob through ONE `git cat-file --batch` process.

    A process per blob was fine while only text files were read; once every file is read for the
    private marker, a staged scan of this repo took 220 s, nearly all of it process start-up.
    """

    def __init__(self) -> None:
        self.proc: subprocess.Popen | None = None

    def read(self, sha: str) -> bytes:
        if self.proc is None:
            self.proc = subprocess.Popen(["git", "-C", str(REPO), "cat-file", "--batch"],
                                         stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        assert self.proc.stdin and self.proc.stdout
        self.proc.stdin.write(sha.encode() + b"\n")
        self.proc.stdin.flush()
        header = self.proc.stdout.readline().split()
        if len(header) != 3 or header[1] != b"blob":
            raise OSError(f"git has no blob {sha}")
        size = int(header[2])
        data = self.proc.stdout.read(size)
        # ⚠️ A git that dies mid-object leaves a SHORT read at EOF, which `read` returns without
        # complaint. Short bytes would be scanned as if complete; the stream is unusable after it.
        if len(data) != size or self.proc.stdout.read(1) != b"\n":
            self.proc.kill()
            self.proc = None
            raise OSError(f"git cat-file returned a truncated blob {sha}")
        return data


_BLOBS = _BlobReader()


def _blob(sha: str):
    return lambda: _BLOBS.read(sha)


def _raise(error: OSError):
    raise error


# Generated pages embed text as JSON with ASCII escaped (`\u003c`, `\u0026`, and anything else a
# serialiser chooses). Undo every ASCII-range escape before matching: "\u003cyour-app-host\u003e"
# otherwise reads as a host named "u003e", and `\u0050RIVATE` would hide a marker.
_ASCII_ESCAPE = re.compile(rb"\\u00([0-7][0-9a-fA-F])")


def normalise(raw: bytes) -> bytes:
    """The bytes a reader would see: UTF-16 re-encoded as UTF-8, ASCII \\u escapes undone."""
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        raw = raw.decode("utf-16", "replace").encode("utf-8")
    return _ASCII_ESCAPE.sub(lambda m: bytes([int(m.group(1), 16)]), raw)


def iter_sources(args):
    """Yield (rel, label, read) for everything the chosen mode would publish.

    ⚠️ THE WORKING TREE IS NOT WHAT GETS PUSHED (review 2026-10-05). A leak that is staged and
    then scrubbed only in the working copy passes a tree scan and still lands in the commit; a
    leak committed and removed again in a later local commit is still in the pushed history.
    So the gate can also read the index (`--staged`), every blob that any commit in a range
    added or changed (`--commits A..B`), and generated output that never enters git at all
    (`--dir site/out`, the GitHub Pages artifact).
    `rel` is always the repo-relative path, so allowlist entries apply unchanged; `label` adds
    where the bytes came from. A `read` of None means a symbolic link in generated output.
    """
    if args.dir:
        # ⚠️ FAIL CLOSED, AND NEVER FOLLOW A LINK THE UPLOADER WOULD (review 2026-10-05). The Pages
        # artifact is a `tar --dereference`, so a symlinked file or folder publishes its TARGET,
        # which this walk would never have read. A missing folder or a read error is not "clean".
        base = (REPO / args.dir).resolve()
        if not base.is_dir():
            raise SystemExit(f"verify_publishable: --dir {args.dir} does not exist or is not a directory")
        for dp, dns, fns in os.walk(base, onerror=_raise):
            for name in dns + fns:
                fp = Path(dp) / name
                if fp.is_symlink():
                    rel = fp.relative_to(REPO).as_posix()
                    yield rel, rel, None
            dns[:] = [d for d in dns if not (Path(dp) / d).is_symlink()]
            for fn in fns:
                fp = Path(dp) / fn
                if fp.is_symlink():
                    continue
                rel = fp.relative_to(REPO).as_posix()
                yield rel, rel, fp.read_bytes
        return
    if args.staged:
        out = _git("ls-files", "--stage", "-z", "--", args.path)
        for entry in out.split(b"\x00"):
            if not entry:
                continue
            meta, path = entry.split(b"\t", 1)
            mode, sha, _stage = meta.decode().split()
            if mode == "160000":  # submodule pointer, no blob
                continue
            rel = path.decode("utf-8", "replace")
            yield rel, f"{rel} (staged)", _blob(sha)
        return
    if args.commits:
        # ⚠️ EVERY (PATH, BLOB) PAIR, AND MERGES TOO (review 2026-10-05). Deduplicating by blob alone
        # let a forbidden PLAN.md through when a later commit renamed the same bytes to an allowed
        # name: the allowed path was seen first, and the verdict depends on the path. And
        # `diff-tree` without -m prints nothing for a merge, so a leak typed into a conflict
        # resolution and removed afterwards was never read. -m diffs a merge against each parent.
        seen: set[tuple[str, str]] = set()
        for commit in _git("rev-list", args.commits).decode().split():
            raw = _git("diff-tree", "-r", "-m", "-z", "--no-commit-id", "--root", "--no-renames",
                       "--diff-filter=AMT", commit, "--", args.path).split(b"\x00")
            for meta, path in zip(raw[0::2], raw[1::2]):
                if not meta:
                    continue
                fields = meta.decode().split()
                mode, sha = fields[1], fields[3]
                if mode == "160000":  # submodule pointer, no blob
                    continue
                rel = path.decode("utf-8", "replace")
                if (rel, sha) in seen:
                    continue
                seen.add((rel, sha))
                yield rel, f"{rel} (commit {commit[:7]})", _blob(sha)
        return
    for fp in iter_files((REPO / args.path).resolve()):
        rel = fp.relative_to(REPO).as_posix()
        yield rel, rel, fp.read_bytes


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
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--staged", action="store_true", help="scan the index (what the next commit holds)")
    mode.add_argument("--commits", metavar="RANGE",
                      help="scan every blob added or changed by the commits in RANGE, e.g. origin/main..HEAD")
    mode.add_argument("--dir", help="scan a generated output directory, e.g. site/out")
    ap.add_argument("--no-allowlist", action="store_true",
                    help="ignore every allowlist entry. Run this before trusting a CLEAN "
                         "run: an entry excuses a whole class for a file, so it can hide "
                         "something its reason never mentioned.")
    args = ap.parse_args()

    if args.hash:
        print(f'    "{digest(args.hash)}",   # add to BLOCKED_NAME_DIGESTS')
        return 0

    findings: list[tuple[str, str, str]] = []   # (class, path, detail)
    allowed_used: set[str] = set()
    scanned = 0

    for rel, label, read in iter_sources(args):
        if read is None:
            findings.append(("restricted_path", label,
                             "symbolic link in generated output: the upload follows it, the scan does not"))
            continue
        for rx, why in RESTRICTED_PATHS:
            if rx.search(rel):
                findings.append(("restricted_path", label, why))

        suffix = PurePosixPath(rel).suffix.lower()
        if suffix not in TEXT_EXT:
            # The private-document marker is checked in EVERY file, whatever its extension: a
            # plan renamed to `.bak` or pasted into a `.log` is still the plan. The other classes
            # stay on text files, where a match means text and not random bytes.
            try:
                raw = read()
            except (OSError, subprocess.CalledProcessError):
                findings.append(("unscanned", label, "unreadable, not scanned"))
                continue
            if len(raw) > MAX_SCAN_BYTES:
                findings.append(("unscanned", label, f"over {MAX_SCAN_BYTES // 1_000_000} MB, not scanned"))
            elif PRIVATE_MARKER.search(normalise(raw)):
                findings.append(("restricted_path", label, "carries a private-document marker"))
            continue
        try:
            raw = read()
            if len(raw) > MAX_SCAN_BYTES:
                findings.append(("unscanned", label, f"over {MAX_SCAN_BYTES // 1_000_000} MB, not scanned"))
                continue
            if suffix == ".gz":
                # Compressed JSON/CSV is still text that ships. Binary payloads (terrain
                # heights) decode to noise and match nothing, which is fine.
                with gzip.GzipFile(fileobj=io.BytesIO(raw)) as gz:
                    raw = gz.read(MAX_SCAN_BYTES + 1)
                if len(raw) > MAX_SCAN_BYTES:
                    findings.append(("unscanned", label, "decompresses past the scan cap"))
                    continue
        except (OSError, EOFError, gzip.BadGzipFile, zlib.error, subprocess.CalledProcessError):
            findings.append(("unscanned", label, "unreadable or corrupt, not scanned"))
            continue
        scanned += 1
        raw = normalise(raw)

        if PRIVATE_MARKER.search(raw):
            findings.append(("restricted_path", label, "carries a private-document marker"))

        excused, reason = allowed_classes(rel)
        if args.no_allowlist:
            excused, reason = set(), None
        if reason:
            allowed_used.add(rel)
        fp_name = PurePosixPath(rel).name
        rel = label

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

        if "customer_people" not in excused and scan_names(raw.decode("utf-8", "replace")):
            findings.append(("customer_people", rel, "a blocked name (digest match)"))

        text = raw.decode("utf-8", "replace")
        if "disclosure" not in excused:
            for h in scan_disclosure(text):
                findings.append(("disclosure", rel, h))

        if fp_name == "README.md" and "german" not in excused:
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
    # Name digests, both directions. The planted name is assembled from fragments so this
    # file never spells it; the innocent line uses the same two words apart.
    name_dirty = "Planning with " + "Ham" + "burg Was" + "ser in the pilot."
    name_clean = "Hamburg publishes water levels; Wasser means water."
    if not scan_names(name_dirty):
        print("GATE BROKEN: the name digests no longer catch the planted two-word name.")
        return 2
    # A name in a path segment or after "=" must still be caught (the base64 skip once hid both).
    for planted in ("tiles/" + "Pat" + "ris/data.json", "owner=" + "Pat" + "ris",
                    "a" * 32 + "/2024/" + "Pat" + "ris/terrain/data",
                    "Exports/2024/ACME/PROJECT/" + "Pat" + "ris/terrain/data"):
        if not scan_names(planted):
            print(f"GATE BROKEN: the name digests miss a planted name in: {planted[:6]}...")
            return 2
    if scan_names(name_clean):
        print("GATE BROKEN: the name digests fire on an innocent line.")
        return 2
    if not PRIVATE_MARKER.search(_join((b"Status: draft. This file is ", b"PRIV", b"ATE (it names source repos)."))):
        print("GATE BROKEN: the private-document marker no longer fires.")
        return 2
    # Escaped and UTF-16 copies of the marker must still be found once normalised.
    for disguised in (_join((b"This file is \\u0050RIV", b"ATE")),
                      _join((b"This file is ", b"PRIV", b"ATE")).decode().encode("utf-16")):
        if not PRIVATE_MARKER.search(normalise(disguised)):
            print("GATE BROKEN: an escaped or UTF-16 private marker is no longer recognised.")
            return 2
    restricted = lambda p: any(rx.search(p) for rx, _ in RESTRICTED_PATHS)  # noqa: E731
    if not all(restricted(p) for p in ("industry/x/PLAN.md", "industry/x/plan.md", "x/Provenance.json",
                                       "app/.env", "app/.env.local", "app/.env.production.local")) \
            or any(restricted(p) for p in ("industry/education/campus-twin/docs/plan-umplanen.md",
                                           "app/.env.example", "app/.env.sample", "app/.env.template")):
        print("GATE BROKEN: the restricted path rules no longer discriminate.")
        return 2

    by_class: dict[str, list] = {}
    for cls, rel, detail in findings:
        by_class.setdefault(cls, []).append((rel, detail))

    print(f"verify_publishable: {scanned} files scanned under {args.path}")
    print(f"controls ok - {len(controls_clean)} innocent lines quiet, planted line caught, "
          f"name digests discriminate\n")

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
