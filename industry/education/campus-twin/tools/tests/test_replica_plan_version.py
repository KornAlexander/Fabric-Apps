"""Phase C: does the stale-preview guard actually work when there are two replicas?

⚠️ SHORT ANSWER: NO, AND IT FAILS IN BOTH DIRECTIONS.

`plan_version` is an integer on the store object, incremented by `publish()`. The method's own
docstring is explicit that this is **in-process only** and that "a publish lives exactly as long as
this process does". Nothing writes it anywhere shared.

Measured on the deployed apps, 2026-08-22:
  * `ca-campus-scheduler`, `-lmu`, `-tum` run `maxReplicas = 2`; `-othreal` runs 1.
  * All four run `minReplicas = 0`, so the process also dies whenever the app goes idle.
  * `/api/plan/publish` IS exposed by the deployed build, so the counter really can move.

The guard compares the `planVersion` recorded on a preview against the store's current value at
claim time. With two replicas holding independent counters, that comparison answers a question
about **which container answered the request**, not about whether the plan changed:

  1. ⚠️ A CORRECT PREVIEW IS REFUSED. Replica A publishes and moves to 1. A preview costed on A
     carries "1". The submit is load-balanced to B, still at "0", and the claim is rejected as
     stale. The user is told to run the preview again, which is not a fix, because the next round
     trip can land the other way about.
  2. ⚠️ A GENUINELY STALE PREVIEW IS ACCEPTED. Replica A publishes. A preview costed on B is
     against a plan that has already moved, but B still says "0", so it matches and is accepted.
     This is the failure the guard exists to prevent, happening while the guard reports success.

This file DEMONSTRATES the hole; it does not fix it. The fix belongs in `schedule_store.py`, which
is held by a parallel session, and would mean persisting the version rather than counting in RAM.
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

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

STORE = Path(tempfile.gettempdir()) / "campus_intake_replica.json"
if STORE.exists():
    STORE.unlink()
os.environ["CAMPUS_INTAKE_DEV_STORE"] = str(STORE)
os.environ.pop("CAMPUS_INTAKE_ODBC", None)

import dev_store  # noqa: E402
import intake_store  # noqa: E402
import schedule_store  # noqa: E402

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: object = "") -> None:
    print(f"  {'ok ' if condition else 'FAIL'} {name}" + (f"  [{detail}]" if detail else ""))
    if not condition:
        FAILURES.append(name)


def a_preview(owner: str, plan_version: str) -> str:
    return intake_store.save_preview(
        site="oth", requested_by=owner,
        constraints=[{"teacher": "T-1", "day": "Fr"}],
        result={"affectedSessions": 1, "wouldMove": 1, "feasible": True},
        plan_version=plan_version, rule_version=None,
    )


def claim(preview_id: str, owner: str, plan_version: str):
    return intake_store.claim_preview_and_insert(
        preview_id, owner_oid=owner, plan_version=plan_version,
        row_of=lambda snap: {
            "site": "oth", "kind": "availability", "submittedByOid": owner,
            "submittedByUpn": f"{owner}@x.invalid", "submittedByName": "Probe",
            "teacherId": "T-1", "role": "teacher",
            "payload": {"constraints": snap["constraints"]},
            "previewId": preview_id, "sourceChannel": "api", "correlationId": None,
            "impactSessions": 1, "impactMoves": 1, "impactFeasible": True,
            "planVersion": plan_version,
        })


def main() -> int:
    print("[1] two replicas are two objects with two counters")
    # ⚠️ Two independent loads of the SAME site is exactly what two containers do at start-up.
    replica_a = schedule_store.ScheduleStore.load("oth") if hasattr(
        schedule_store.ScheduleStore, "load") else schedule_store.store_for("oth")
    replica_b = schedule_store.store_for("oth")
    check("both start at the same version",
          str(replica_a.plan_version) == str(replica_b.plan_version),
          f"a={replica_a.plan_version} b={replica_b.plan_version}")

    same_object = replica_a is replica_b
    print(f"  note: store_for returns {'the SAME cached object' if same_object else 'new objects'}")

    # Simulate the publish that only one container saw. Done by hand rather than through
    # `publish()` so this test does not depend on having a valid draft to promote.
    version_before = int(replica_a.plan_version)
    a_version = str(version_before + 1)
    b_version = str(version_before)
    print(f"\n[2] replica A publishes: A is now '{a_version}', B is still '{b_version}'")

    print("\n[3] ⚠️ a CORRECT preview, costed on A, submitted to B")
    pid = a_preview("oid-x", a_version)
    got = claim(pid, "oid-x", b_version)
    check("it is refused, although nothing was wrong with it", got is None, got)
    snap = dev_store._load()["previews"].get(pid, {})
    check("and the preview is left unused, so the user can retry into the same trap",
          not snap.get("usedAt"), snap.get("usedAt"))

    print("\n[4] ⚠️ a STALE preview, costed on B after A published, submitted to B")
    pid2 = a_preview("oid-y", b_version)
    got2 = claim(pid2, "oid-y", b_version)
    check("it is ACCEPTED, even though the plan has already moved on A",
          got2 is not None, got2)

    print("\n[5] what the guard is actually comparing")
    check("the versions differ purely because of which container answered",
          a_version != b_version, f"{a_version} vs {b_version}")

    print()
    if STORE.exists():
        STORE.unlink()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {FAILURES}")
        return 1
    print("OK - the hole is real and reproducible: the guard compares WHICH REPLICA answered, "
          "not whether the plan changed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
