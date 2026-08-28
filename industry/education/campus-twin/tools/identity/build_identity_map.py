"""Propose the `TeacherIdentity` rows that decide who may do what.

    python tools/identity/build_identity_map.py --site oth \\
        --directory people.json --planners dekanat@hs.de --out out/

⚠️ THIS IS THE MOST DANGEROUS JOIN IN THE FEATURE, and it is dangerous in a quiet way. The
timetable knows "Prof. Dr. M. Müller". Entra knows an object id. Everything downstream, who may
block a Friday, whose name lands in the audit trail, who can read the whole planning queue, hangs
off matching those two. A wrong row does not error: Professor A simply submits as Professor B, the
audit trail agrees, and nobody notices until a timetable changes for a reason nobody can explain.

So this tool PROPOSES and never decides:

  * it emits SQL for a human to read, it does not write to the Warehouse,
  * an ambiguous surname produces NO row, never a best guess,
  * `planner` is only ever granted from an explicit list on the command line,
  * every row records HOW it was matched, in `provenance`, so a later argument about a decision
    can be settled by looking rather than remembering.

Three real hazards found in this repository's own data, each now an interlock:

  1. `tum` has `teacher_attribution_invented = True`: 127 teachers whose teaching load is
     FICTIONAL. Attaching a real human to that is a false statement about a real person's job.
     Refused unless explicitly acknowledged, and then stamped as such in `provenance`.
  2. `oth-real` contains a teacher whose name is literally "?". Unnamed staff cannot be matched
     and must be REPORTED, because silently dropping them is how somebody ends up with no access
     and no explanation.
  3. German names transliterate: "Müller" in the timetable, "mueller@" in the UPN. Both sides are
     folded (ü->ue, ß->ss) before comparison, or half a faculty goes unmatched.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

#: Academic decoration. Stripped before the surname is read out of a display name.
_TITLES = {
    "prof", "dr", "pd", "priv", "doz", "jun", "hc", "h.c", "mult", "habil",
    "dipl", "ing", "mag", "msc", "bsc", "med", "rer", "nat", "phil", "techn",
}


def fold(text: str) -> str:
    """Compare German names without losing half of them to spelling.

    ⚠️ ORDER MATTERS. The umlaut pairs must be replaced BEFORE `unicodedata` strips the combining
    marks, or "Müller" decomposes to "Muller" and never meets "mueller@hs.de". `ß` has no decomposed
    form at all and must be handled explicitly.
    """
    lowered = text.lower()
    for src, dst in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        lowered = lowered.replace(src, dst)
    stripped = "".join(c for c in unicodedata.normalize("NFKD", lowered)
                       if not unicodedata.combining(c))
    return re.sub(r"[^a-z]", "", stripped)


def is_placeholder(name: str) -> bool:
    """Is this a room/pool/department code rather than a human?

    ⚠️ FOUND IN THE REAL DATA, NOT IMAGINED. `oth-real` (the university's own Untis export, 414
    records) contains entries like `_PBW01`, `_PBW02`, `_PBW04`: pooled teaching capacity for a
    department, with no person behind it. 19 of them.

    They were already being rejected before this function existed, but only BY ACCIDENT: their
    invented surnames collided with each other and tripped the ambiguity check. Relying on that is
    relying on there being at least two of each, and the day a department has exactly one pool
    entry, a real professor gets silently bound to it. Naming the case is the fix.
    """
    stripped = name.strip()
    if not stripped:
        return False
    if stripped.startswith("_"):
        return True
    # An all-caps token with digits and no lowercase is a code, not a name: PBW01, LB-3, EDV.
    return bool(re.fullmatch(r"[A-Z][A-Z0-9_\-]{1,}", stripped))


def surname_of(display_name: str) -> str | None:
    """"Prof. Dr. V. Vestenbergsgreuth" -> "Vestenbergsgreuth". None if there is no name."""
    if not display_name or not display_name.strip(" ?-"):
        return None                                  # ⚠️ oth-real really contains "?"
    parts = [p.strip(".,") for p in display_name.replace(",", " ").split()]
    keep = [
        p for p in parts
        if p and p.strip(".").lower() not in _TITLES
        and not re.fullmatch(r"[A-Za-zÄÖÜäöü]\.?", p)   # a bare initial
    ]
    return keep[-1] if keep else None


def directory_keys(person: dict[str, Any]) -> set[str]:
    """Every folded token a directory entry could plausibly be matched on."""
    keys: set[str] = set()
    upn = person.get("upn", "")
    local = upn.split("@")[0]
    for token in re.split(r"[._\-]", local):
        if len(token) > 2:
            keys.add(fold(token))
    sn = surname_of(person.get("displayName", ""))
    if sn:
        keys.add(fold(sn))
    if person.get("surname"):
        keys.add(fold(person["surname"]))
    return {k for k in keys if k}


def build(site: str, directory: list[dict[str, Any]], planner_upns: list[str],
          allow_invented: bool) -> dict[str, Any]:
    from schedule_store import known_sites, store_for

    if site not in known_sites():
        raise SystemExit(f"unknown site '{site}' - known: {', '.join(known_sites())}")
    store = store_for(site)

    invented = bool(getattr(store, "teacher_attribution_invented", False))
    if invented and not allow_invented:
        raise SystemExit(
            f"⚠️ REFUSING: '{site}' has teacher_attribution_invented = True. Its teaching load is\n"
            f"   fictional, so mapping it to real people would attach real humans to invented\n"
            f"   commitments. Re-run with --allow-invented-attribution if this is a demo tenant;\n"
            f"   every row will be stamped provenance='invented-attribution'."
        )

    by_upn = {p["upn"].lower(): p for p in directory}
    missing_planners = [u for u in planner_upns if u.lower() not in by_upn]
    if missing_planners:
        # ⚠️ Refuse rather than skip. A silently dropped planner means an empty queue that looks
        # like "no requests yet" instead of "nobody can see them".
        raise SystemExit(f"planner UPNs not present in the directory: {', '.join(missing_planners)}")

    index: dict[str, list[dict[str, Any]]] = {}
    for person in directory:
        for key in directory_keys(person):
            index.setdefault(key, []).append(person)

    matched: list[dict[str, Any]] = []
    unnamed: list[str] = []
    placeholders: list[dict[str, str]] = []
    unmatched: list[dict[str, str]] = []
    ambiguous: list[dict[str, Any]] = []
    used_oids: dict[str, str] = {}

    for teacher in store.teachers:
        tid, name = teacher["teacherId"], teacher.get("name", "")
        if is_placeholder(name):
            # ⚠️ Never mapped to anybody. A pooled department slot is not a person, and giving it
            # an owner would let one professor act for a whole department's capacity.
            placeholders.append({"teacherId": tid, "name": name})
            continue
        sn = surname_of(name)
        if not sn:
            unnamed.append(tid)
            continue
        hits = index.get(fold(sn), [])
        if not hits:
            unmatched.append({"teacherId": tid, "name": name})
            continue
        if len(hits) > 1:
            # ⚠️ NO ROW. Two Müllers is exactly the case where a guess is worse than a gap.
            ambiguous.append({"teacherId": tid, "name": name,
                              "candidates": [h["upn"] for h in hits]})
            continue
        person = hits[0]
        if person["oid"] in used_oids:
            # One human cannot be two teachers; that is a data error, not a mapping.
            ambiguous.append({"teacherId": tid, "name": name,
                              "candidates": [person["upn"]],
                              "note": f"oid already mapped to {used_oids[person['oid']]}"})
            continue
        used_oids[person["oid"]] = tid
        matched.append({
            "oid": person["oid"], "site": site, "upn": person["upn"], "teacherId": tid,
            # ⚠️ EVERYONE IS A TEACHER unless named on the command line. There is no rule that
            # promotes anybody, because a rule that promotes is a rule that can be tricked.
            "role": "planner" if person["upn"].lower() in {u.lower() for u in planner_upns} else "teacher",
            "provenance": "invented-attribution" if invented else "surname-unique",
        })

    granted = {m["upn"].lower() for m in matched if m["role"] == "planner"}
    for upn in planner_upns:
        if upn.lower() not in granted:
            # A planner who teaches nothing still needs a row, or the office cannot see the queue.
            person = by_upn[upn.lower()]
            matched.append({
                "oid": person["oid"], "site": site, "upn": person["upn"],
                "teacherId": f"PLANNER-{person['upn'].split('@')[0]}",
                "role": "planner", "provenance": "explicit-planner",
            })

    return {"site": site, "inventedAttribution": invented, "identities": matched,
            "unnamed": unnamed, "placeholders": placeholders,
            "unmatched": unmatched, "ambiguous": ambiguous}


def to_sql(result: dict[str, Any]) -> str:
    lines = [
        "-- Proposed TeacherIdentity rows. REVIEW BEFORE RUNNING.",
        f"-- site={result['site']}  matched={len(result['identities'])}"
        f"  unmatched={len(result['unmatched'])}  ambiguous={len(result['ambiguous'])}"
        f"  unnamed={len(result['unnamed'])}",
        "-- ⚠️ Ambiguous and unmatched teachers are DELIBERATELY ABSENT. Adding them by hand means"
        "\n--    deciding, by hand, that one specific human is one specific timetable entry.",
        "",
    ]
    if result["inventedAttribution"]:
        lines.insert(0, "-- ⚠️ THIS SITE'S TEACHER ATTRIBUTION IS INVENTED. Demo tenants only.\n")
    for row in result["identities"]:
        esc = lambda v: "NULL" if v is None else "'" + str(v).replace("'", "''") + "'"  # noqa: E731
        lines.append(
            "INSERT INTO dbo.TeacherIdentity (oid, site, upn, teacherId, role, provenance, createdAt) "
            f"VALUES ({esc(row['oid'])}, {esc(row['site'])}, {esc(row['upn'])}, "
            f"{esc(row['teacherId'])}, {esc(row['role'])}, {esc(row['provenance'])}, SYSUTCDATETIME());"
        )
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--site", required=True)
    ap.add_argument("--directory", required=True, help="JSON list of {oid, upn, displayName}")
    ap.add_argument("--planners", default="", help="comma separated UPNs granted the planner role")
    ap.add_argument("--out", default=str(ROOT / "out" / "identity"))
    ap.add_argument("--allow-invented-attribution", action="store_true")
    args = ap.parse_args(argv)

    directory = json.loads(Path(args.directory).read_text(encoding="utf-8"))
    planners = [p.strip() for p in args.planners.split(",") if p.strip()]
    result = build(args.site, directory, planners, args.allow_invented_attribution)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / f"identities-{args.site}.json").write_text(
        json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    (out / f"identities-{args.site}.sql").write_text(to_sql(result), encoding="utf-8")

    print(f"site           {result['site']}")
    print(f"matched        {len(result['identities'])}")
    print(f"planners       {sum(1 for r in result['identities'] if r['role'] == 'planner')}")
    print(f"⚠️ ambiguous    {len(result['ambiguous'])}  (no row written for any of these)")
    print(f"⚠️ unmatched    {len(result['unmatched'])}")
    print(f"⚠️ unnamed      {len(result['unnamed'])}")
    print(f"   placeholders {len(result['placeholders'])}  (pool/department codes, never mapped)")
    for a in result["ambiguous"][:10]:
        print(f"   ambiguous: {a['name']} -> {', '.join(a['candidates'])}")
    print(f"\nwrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
