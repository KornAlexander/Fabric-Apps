"""The planning office's way in, until there is a UI.

    python tools/fabric_intake/intake_cli.py whoami
    python tools/fabric_intake/intake_cli.py identities --site oth
    python tools/fabric_intake/intake_cli.py grant --site oth --upn me@uni.de --role planner
    python tools/fabric_intake/intake_cli.py queue --site oth
    python tools/fabric_intake/intake_cli.py decide <requestId> --site oth --accept

⚠️ THIS EXISTS BECAUSE OF A FAILURE THAT LOOKS LIKE SUCCESS. `dbo.IntakeIdentity` starts empty, and
an empty identity table means `resolve_identity` returns None for everybody, and the router answers
a clean **403** to every caller including the planning office. Nothing is broken, nothing is logged,
and the queue simply appears to have no requests in it. `campus_intake.sql` carries the warning; a
warning in a comment is not a way to fix it, so this is.

⚠️ `grant` IS THE ONLY WAY A ROLE IS EVER CREATED, and it is deliberately manual. There is no rule
anywhere that promotes somebody to `planner`, because a rule that promotes is a rule that can be
tricked, and this role can read every request every professor has filed.

Connection comes from `FABRIC_SQL_SERVER` / `FABRIC_SQL_DATABASE` via `tools/fabric/fabric_ids.py`;
nothing here writes an endpoint down.
"""

from __future__ import annotations

import argparse
import json
import struct
import subprocess
import sys
from pathlib import Path

import pyodbc

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "fabric"))
sys.path.insert(0, str(ROOT / "server"))

import fabric_ids  # noqa: E402

AZ = r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"


def _az(*args: str) -> str:
    return subprocess.run([AZ, *args], capture_output=True, text=True, check=True).stdout.strip()


def connect():
    tok = _az("account", "get-access-token", "--resource", "https://database.windows.net/",
              "--query", "accessToken", "-o", "tsv")
    raw = tok.encode("utf-16-le")
    st = struct.pack("<i", len(raw)) + raw
    cs = (f"Driver={{ODBC Driver 18 for SQL Server}};Server={fabric_ids.sql_server()};"
          f"Database={fabric_ids.sql_database()};Encrypt=yes;TrustServerCertificate=no")
    # ⚠️ pyodbc's `timeout=`, never `Connection Timeout=` in the string: ODBC rejects that as an
    # invalid attribute and reports it as a login timeout, which reads like a firewall problem.
    return pyodbc.connect(cs, timeout=90, attrs_before={1256: st})


def cmd_whoami(args) -> int:
    """The signed-in identity, as the API would see it.

    ⚠️ `oid` IS THE ANSWER, not the UPN. `IntakeIdentity` is keyed on the object id precisely
    because a UPN can be renamed and a renamed professor must not become a different person.
    """
    me = json.loads(_az("ad", "signed-in-user", "show", "-o", "json"))
    print(f"  displayName  {me.get('displayName')}")
    print(f"  upn          {me.get('userPrincipalName')}")
    print(f"  oid          {me.get('id')}   <- this is what a role is granted to")
    return 0


def cmd_identities(args) -> int:
    with connect() as cx:
        rows = cx.cursor().execute(
            """SELECT oid, site, upn, teacherId, role, provenance, createdAt
               FROM dbo.IntakeIdentity WHERE (? IS NULL OR site = ?) ORDER BY site, role, upn""",
            args.site, args.site,
        ).fetchall()
    if not rows:
        print("  (none)")
        print("  ⚠️ With no rows here every caller gets 403, including the planning office, and")
        print("     the queue looks empty rather than unreachable. Use `grant` to add somebody.")
        return 0
    for oid, site, upn, tid, role, prov, created in rows:
        print(f"  {site:<10} {role:<8} {upn or '(no upn)':<34} teacher={tid or '-':<12} "
              f"{prov or '-':<18} {created:%Y-%m-%d}")
    planners = sum(1 for r in rows if r[4] == "planner")
    print(f"\n  {len(rows)} identity/ies, {planners} planner(s)")
    if not planners:
        print("  ⚠️ NO PLANNER. Every request will sit pending forever and nobody can see them.")
    return 0


def cmd_grant(args) -> int:
    oid = args.oid
    upn = args.upn
    if not oid:
        # Resolve by UPN so the operator does not have to know a guid, but store the guid.
        try:
            user = json.loads(_az("ad", "user", "show", "--id", upn, "-o", "json"))
        except subprocess.CalledProcessError:
            print(f"  ⚠️ No directory user matches {upn!r}. Refusing to invent an id: a row keyed")
            print("     on a guessed oid grants access to nobody and hides the mistake.")
            return 1
        oid = user["id"]
        upn = user.get("userPrincipalName", upn)

    with connect() as cx:
        cur = cx.cursor()
        # ⚠️ CLEARED EVERYWHERE ELSE FIRST, in the same transaction. "Primary" only means anything
        # if exactly one row carries it: with two, the router cannot tell which campus was meant
        # and goes back to asking, so a second primary silently undoes the first one's benefit
        # rather than announcing itself.
        if args.primary:
            cur.execute(
                "UPDATE dbo.IntakeIdentity SET isPrimary = 0 WHERE oid = ? AND site <> ?",
                oid, args.site)
        cur.execute(
            """UPDATE dbo.IntakeIdentity
               SET upn = ?, teacherId = ?, role = ?, provenance = 'cli-grant', isPrimary = ?
               WHERE oid = ? AND site = ?""",
            upn, args.teacher, args.role, 1 if args.primary else 0, oid, args.site,
        )
        if cur.rowcount == 1:
            action = "updated"
        else:
            cur.execute(
                """INSERT INTO dbo.IntakeIdentity
                     (oid, site, upn, teacherId, role, provenance, isPrimary)
                   VALUES (?, ?, ?, ?, ?, 'cli-grant', ?)""",
                oid, args.site, upn, args.teacher, args.role, 1 if args.primary else 0,
            )
            action = "created"
        cx.commit()
    print(f"  {action}: {upn} is now '{args.role}' at {args.site}")
    if args.primary:
        print(f"  ⚠️ {args.site} is now their MAIN campus: requests that name no site land here.")
    print(f"  oid {oid}")
    if args.role == "planner":
        print("  ⚠️ This person can now read EVERY request filed at this site, and decide them.")
    return 0


def cmd_revoke(args) -> int:
    with connect() as cx:
        cur = cx.cursor()
        cur.execute("DELETE FROM dbo.IntakeIdentity WHERE oid = ? AND site = ?", args.oid, args.site)
        n = cur.rowcount
        cx.commit()
    print(f"  removed {n} identity row(s)")
    return 0


def cmd_queue(args) -> int:
    # ⚠️ Imported here rather than at module scope, matching `cmd_decide`: `sys.path` only gains
    # `server/` after the header runs, so a top-level import would fail on a bare checkout.
    import intake_store

    with connect() as cx:
        rows = cx.cursor().execute(
            """SELECT requestId, kind, status, submittedByUpn, teacherId, impactSessions,
                      impactMoves, impactFeasible, planVersion, createdAt, payload
               FROM dbo.IntakeRequest WHERE site = ? AND status = ?
               ORDER BY createdAt DESC""",
            args.site, args.status,
        ).fetchall()
    if not rows:
        print(f"  no '{args.status}' requests at {args.site}")
    else:
        for r in rows:
            payload = json.loads(r[10]) if r[10] else {}
            days = sorted({c.get("day") for c in payload.get("constraints", []) if c.get("day")})
            slots = sorted({c.get("slotId") for c in payload.get("constraints", [])
                            if c.get("slotId")})
            # ⚠️ Normalised. SQL Server returns a `uniqueidentifier` UPPERCASE, so this printed
            # `7C746192-...` for the request the API calls `7c746192-...`. The database does not
            # care, every human comparing the two does.
            print(f"\n  {intake_store.normalise_guid(r[0])}")
            print(f"    {r[1]} / {r[2]}   von {r[3]}   (teacher {r[4]})")
            print(f"    blockiert: {', '.join(days or slots) or '-'}")
            # ⚠️ Labelled as at-submit, always. §41.7 property 2: these numbers are history the
            # moment they are written, and a three-week-old "4 Termine" read as current is the
            # whole hazard.
            feasible = "ja" if r[7] else ("nein" if r[7] is not None else "?")
            print(f"    Auswirkung BEI EINREICHUNG: {r[5]} Termine, {r[6]} Verschiebungen, "
                  f"machbar={feasible}, planVersion={r[8]}")
            print(f"    eingereicht {r[9]:%Y-%m-%d %H:%M} UTC")
        print(f"\n  {len(rows)} request(s)")

    # ⚠️ ALWAYS, whatever was asked for, because the DEFAULT filter is the one that hides this.
    # `failed` means the decision was taken and the availability write did not land, so nothing
    # changed in the timetable. Listing only `pending` showed the planner exactly the requests
    # that did NOT need them. The API grew the same signal as `needsAttention`; this is the only
    # tool a planner actually has, so it needed it more.
    if args.status != "failed":
        with connect() as cx:
            stuck = cx.cursor().execute(
                """SELECT requestId, submittedByUpn, failureReason FROM dbo.IntakeRequest
                   WHERE site = ? AND status = 'failed' ORDER BY createdAt DESC""",
                args.site,
            ).fetchall()
        if stuck:
            print(f"\n  ⚠️ {len(stuck)} ANLIEGEN BRAUCHEN AUFMERKSAMKEIT")
            print("     Angenommen, aber die Änderung ist NICHT im Plan gelandet.")
            print("     'decide --accept' wiederholt den Schreibvorgang; das ist sicher.")
            for s in stuck:
                print(f"       {intake_store.normalise_guid(s[0])}  von {s[1]}")
                if s[2]:
                    print(f"         Grund: {str(s[2])[:120]}")
    return 0


def cmd_decide(args) -> int:
    """Claim, act, record - the same three steps and the same order as the API.

    ⚠️ IT GOES THROUGH `intake_store`, NOT THROUGH HAND-WRITTEN SQL. The first version of this
    function did its own UPDATE, which worked and wrote **no `IntakeEvent` row at all**: a decision
    with no audit trail, taken from a command line, which is the last place a decision should be
    untraceable. `intake_store.decide` and `record_application` already carry the conditional
    guard AND the event writes, so using them is both shorter and correct.

    ⚠️ `failed` IS DECIDABLE, `accepted` AND `rejected` ARE NOT. This used to refuse anything that
    was not `pending`, which stranded exactly the requests that most needed a human: the decision
    had been taken and the availability write had not landed, so the timetable was unchanged and
    the only tool a planner has refused to touch it. Retrying is safe because
    `apply_accepted_availability` converges rather than doubling up.
    """
    import intake_store

    with connect() as cx:
        row = cx.cursor().execute(
            """SELECT teacherId, payload, status FROM dbo.IntakeRequest
               WHERE requestId = ? AND site = ?""",
            args.request_id, args.site,
        ).fetchone()
    if not row:
        print("  no such request at this site")
        return 1
    if row[2] not in ("pending", "failed"):
        print(f"  ⚠️ already '{row[2]}'. Refusing rather than overwriting somebody's decision.")
        return 1
    if row[2] == "failed":
        print("  ⚠️ dieses Anliegen wurde bereits angenommen, aber der Schreibvorgang ist "
              "fehlgeschlagen. Wiederholung.")
    teacher_id, payload_json = row[0], row[1]

    if not intake_store.decide(args.request_id, decided_by_upn=args.by,
                               decided_by_role="planner", accept=args.accept, note=args.note):
        print("  somebody decided it first")
        return 1
    status = "accepted" if args.accept else "rejected"
    print(f"  {args.request_id} -> {status}")

    if not args.accept:
        return 0

    payload = json.loads(payload_json) if payload_json else {}
    slots = [c["slotId"] for c in payload.get("constraints", []) if c.get("slotId")]
    days = [c["day"] for c in payload.get("constraints", []) if c.get("day")]
    if days and not slots:
        import schedule_store
        wanted = set(days)
        # The store's own `day` field, never a split of the slot id.
        slots = [s["slotId"] for s in schedule_store.store_for(args.site).slots
                 if s.get("day") in wanted]

    try:
        if not slots:
            raise ValueError("die Anfrage nennt keine Zeitfenster")
        applied = intake_store.apply_accepted_availability(
            site=args.site, teacher_id=teacher_id, slot_ids=slots,
            state="nicht_verfuegbar", updated_by=args.by,
        )
        intake_store.record_application(
            args.request_id, applied_rows=applied["inserted"] + applied["updated"],
            failure_reason=None, actor_upn=args.by, actor_role="planner")
    except Exception as exc:  # noqa: BLE001 - recorded, never swallowed
        # ⚠️ The request becomes `failed`, not `accepted`. A green tick over an unchanged week is
        # worse than a refusal (§13.7).
        intake_store.record_application(
            args.request_id, applied_rows=0, failure_reason=str(exc)[:900],
            actor_upn=args.by, actor_role="planner")
        print(f"  ⚠️ angenommen, aber NICHT angewendet: {exc}")
        print("     Der Request steht jetzt auf 'failed'.")
        return 1

    print(f"  applied: {applied['inserted']} neu, {applied['updated']} aktualisiert "
          f"({len(slots)} Zeitfenster)")
    print("  ⚠️ The absence is recorded. The PLAN is unchanged: publishing stays in the cockpit.")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("whoami").set_defaults(fn=cmd_whoami)

    p = sub.add_parser("identities")
    p.add_argument("--site", default=None)
    p.set_defaults(fn=cmd_identities)

    p = sub.add_parser("grant")
    p.add_argument("--site", required=True)
    p.add_argument("--upn")
    p.add_argument("--oid")
    p.add_argument("--teacher", default=None, help="teacherId from dbo.Teachers, if they teach")
    p.add_argument("--role", choices=["teacher", "planner"], required=True)
    p.add_argument("--primary", action="store_true",
                   help="this is their main campus; used when a request names no site")
    p.set_defaults(fn=cmd_grant)

    p = sub.add_parser("revoke")
    p.add_argument("--site", required=True)
    p.add_argument("--oid", required=True)
    p.set_defaults(fn=cmd_revoke)

    p = sub.add_parser("queue")
    p.add_argument("--site", required=True)
    p.add_argument("--status", default="pending")
    p.set_defaults(fn=cmd_queue)

    p = sub.add_parser("decide")
    p.add_argument("request_id")
    p.add_argument("--site", required=True)
    p.add_argument("--accept", action="store_true")
    p.add_argument("--reject", dest="accept", action="store_false")
    p.add_argument("--note", default=None)
    p.add_argument("--by", required=True, help="the deciding planner's UPN, for the audit trail")
    p.set_defaults(fn=cmd_decide)

    args = ap.parse_args(argv)
    if args.cmd == "grant" and not (args.upn or args.oid):
        ap.error("grant needs --upn or --oid")
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
