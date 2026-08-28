"""One backend, many universities: does it answer as the RIGHT one, and refuse the wrong one?

The risk of merging three containers into one is not that it fails — it is that it succeeds with
the wrong university's data and nothing says so.
"""

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

import sys
from pathlib import Path

# ⚠️ RESOLVED FROM THIS FILE, NOT FROM THE WORKING DIRECTORY. This was `sys.path.insert(0,
# "server")`, so the test only loaded when it happened to be run from the repo root — anywhere
# else it died on `ModuleNotFoundError: No module named 'app'` before a single assertion ran.
# A test that cannot load is indistinguishable from one that passes unless somebody reads the
# summary, which is the same trap `theme.test.ts` documents on the TypeScript side. Sixteen of
# the eighteen guards here already resolve from `__file__`; this one now agrees with them.
#
# The three that legitimately still say "server" spawn a SUBPROCESS with `cwd=ROOT`, because
# `SCHEDULER_SITE` is read at import and each site needs its own process. Those are correct.
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

from fastapi.testclient import TestClient  # noqa: E402

import app as api  # noqa: E402
from schedule_store import _SYNTH_DIRS, known_sites  # noqa: E402

FAIL: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(("  ok    " if ok else "  FAIL  ") + name + (f" — {detail}" if detail else ""))
    if not ok:
        FAIL.append(name)


c = TestClient(api.app)
H = {"X-App-Key": api.APP_KEY} if api.APP_KEY else {}

print("one process, every university\n")

# ⚠️ ALL NINE, NOT THE FIRST THREE. This listed oth/lmu/tum and passed unchanged while five more
# universities were registered in `schedule_store.py` — so the very thing the file is named after
# was going untested for the majority of the sites the container serves. A registry test that only
# covers the sites it was written for is a habit rather than a gate, which is the same note
# `validate_dataset.py` makes about itself.
expected = {
    "oth": "OTH Regensburg",
    "oth-real": "OTH Regensburg (Echtdaten)",
    "lmu": "LMU München",
    "tum": "TUM Garching",
    "rwth": "RWTH Aachen",
    "koeln": "Universität zu Köln",
    "muenster": "Universität Münster",
    "fau": "FAU Erlangen-Nürnberg",
    "tuebingen": "Universität Tübingen",
    "tuberlin": "TU Berlin",
    "demo": "Beispiel-Universität",
}
check(
    "every registered site is covered by this test",
    sorted(expected) == sorted(known_sites()),
    ", ".join(sorted(set(known_sites()) ^ set(expected))) or "none",
)
summaries = {}
for site, label in expected.items():
    r = c.get(f"/api/plan/summary?site={site}", headers=H)
    d = r.json()
    summaries[site] = d
    check(
        f"{site}: summary is served as {label}",
        r.status_code == 200 and d.get("site") == site and d.get("siteLabel") == label,
        f"{d.get('site')} / {d.get('siteLabel')}",
    )

# The mirror: they must be genuinely DIFFERENT, or one store is being served nine times.
# ⚠️ `oth` and `oth-real` are the SAME university from two sources and may legitimately land on the
# same session count, so the comparison is over the generated sites that are meant to be distinct.
distinct = [s for s in expected if s != "oth-real"]
check(
    "the universities are not the same data",
    len({summaries[s]["sessions"] for s in distinct}) == len(distinct),
    ", ".join(f"{s}={summaries[s]['sessions']}" for s in distinct),
)

# Default: a request that names no site behaves exactly as the single-site deployment did.
d = c.get("/api/plan/summary", headers=H).json()
check("no site named falls back to the deployment default", d.get("site") == api.store.site, d.get("site"))

# An unknown university must be refused, not silently answered with the default.
r = c.get("/api/plan/summary?site=harvard", headers=H)
check("an unknown university is refused", r.status_code == 400, f"HTTP {r.status_code}")

# Suggestions and calendar must follow the same site.
r = c.get("/api/calendar/suggestions?scope=teacher&site=lmu", headers=H)
subs = r.json().get("subjects", [])
r2 = c.get("/api/calendar/suggestions?scope=teacher&site=oth", headers=H)
subs2 = r2.json().get("subjects", [])
check(
    "suggestions differ per university",
    bool(subs) and bool(subs2) and subs != subs2,
    f"lmu={len(subs)} oth={len(subs2)}",
)

# Drafts must be scoped: a draft made for one university must not appear for another.
import proposals  # noqa: E402
from schedule_store import store_for  # noqa: E402

pid = proposals.register([{"option": 1, "moves": [], "sessionsMoved": 0}], site="oth")
res = proposals.apply(store_for("oth"), pid, 1, "probe@example.com")
check("a draft can be created for oth", "draftId" in res, str(res)[:80])

oth_drafts = c.get("/api/drafts?site=oth", headers=H).json()["drafts"]
lmu_drafts = c.get("/api/drafts?site=lmu", headers=H).json()["drafts"]
check("the draft shows for oth", any(d["draftId"] == res.get("draftId") for d in oth_drafts))
check(
    "the draft does NOT show for lmu",
    not any(d["draftId"] == res.get("draftId") for d in lmu_drafts),
    f"lmu sees {len(lmu_drafts)}",
)

# And applying one university's proposal against another's plan is refused outright.
wrong = proposals.apply(store_for("lmu"), pid, 1, "probe@example.com")
check(
    "applying oth's proposal to lmu is refused",
    wrong.get("error") == "wrong_site",
    str(wrong)[:100],
)

print()
# ⚠️ THE IMAGE HAS TO CONTAIN THE DATA, AND NOTHING ABOVE ASKS WHETHER IT WILL. Every check in
# this file runs against the working tree, where all nine datasets are present, so the suite goes
# green for a site that cannot exist inside the container. `.dockerignore` is an ALLOWLIST (`*`
# then `!data/<dir>/`), it is the only list that decides what reaches the build context, and it
# has now drifted three separate times: once for LMU, once for TUM, and once for TU Berlin and the
# demo — each caught in production rather than here.
#
# ⚠️ AND THE OBVIOUS PROBE REPORTS SUCCESS. `/api/health?site=tuberlin` answers 200 to a client
# with no key, because health deliberately returns `{status, appKeyRequired}` to anyone and only
# reaches the store once a valid `X-App-Key` is presented. The deployed frontend holds that key,
# so the app saw 400 and "Der Planer antwortet nicht" while every unauthenticated check said the
# service was fine. Comparing the two lists is the only cheap way to know.
_dockerignore = (ROOT / ".dockerignore").read_text(encoding="utf-8")
_allowed = {
    line.strip().lstrip("!").rstrip("/")
    for line in _dockerignore.splitlines()
    if line.strip().startswith("!data/")
}
check(
    ".dockerignore allowlist is readable at all",
    len(_allowed) > 2,
    f"parsed {len(_allowed)} entries — has the format changed?",
)
for _site, _path in sorted(_SYNTH_DIRS.items()):
    _rel = f"data/{_path.name}"
    _ok = _rel in _allowed
    check(
        f"{_site}'s dataset reaches the image ({_rel})",
        _ok,
        "" if _ok else "MISSING from .dockerignore — the container will 400 on this site",
    )

print()
if FAIL:
    print(f"{len(FAIL)} failed: " + "; ".join(FAIL))
    raise SystemExit(1)
print("one backend serves each university as itself, and refuses the others")
