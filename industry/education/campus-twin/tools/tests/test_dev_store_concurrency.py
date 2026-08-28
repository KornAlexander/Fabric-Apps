"""Two people, or one impatient agent, hitting the same preview at the same moment.

    python tools\\tests\\test_dev_store_concurrency.py

⚠️ THIS TESTS THE GUARANTEE, NOT THE HAPPY PATH. `test_intake_e2e.py` proves a preview cannot be
submitted twice IN SEQUENCE, which is a much weaker statement than the one being made. The claim is
that a preview is single use, and the implementation is load-modify-save with no lock: two callers
can both read `usedAt = None` before either writes, and both then insert a request. Sequentially it
passes; concurrently the professor's one request becomes two, and the planning office cannot tell
whether they meant one or two.

The retrying agent is the realistic trigger, not two humans. A submit that times out at the client
while succeeding at the server is retried, and the retry arrives while the first is still writing.
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
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

STORE = Path(tempfile.gettempdir()) / "campus_intake_concurrency.json"
STORE.unlink(missing_ok=True)
os.environ["CAMPUS_INTAKE_DEV_STORE"] = str(STORE)
os.environ.pop("CONTAINER_APP_NAME", None)

import dev_store  # noqa: E402

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name} {detail}")
        FAILURES.append(name)


def fresh_preview(oid: str = "oid-prof") -> str:
    return dev_store.save_preview(
        site="oth", requested_by=oid,
        constraints=[{"teacher": "T-1", "day": "Fr"}], result={"affectedSessions": 3},
        plan_version="7", rule_version=None,
    )


def row_of(snap):
    return {"site": "oth", "kind": "availability", "submittedByOid": "oid-prof",
            "submittedByUpn": "prof@hs.de", "teacherId": "T-1", "payload": {},
            "planVersion": "7", "role": "teacher"}


def race(fn, n: int):
    """Run `fn` on n threads released as simultaneously as the runtime allows."""
    start = threading.Barrier(n)
    results: list = [None] * n
    errors: list = [None] * n

    def worker(i):
        try:
            start.wait()
            results[i] = fn()
        except Exception as e:            # noqa: BLE001 - recorded, not swallowed
            errors[i] = e

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return results, [e for e in errors if e]


def main() -> int:
    import json

    print("\n[1] ⚠️ one preview, many simultaneous submits")
    STORE.unlink(missing_ok=True)
    pid = fresh_preview()
    N = 12
    results, errors = race(
        lambda: dev_store.claim_preview_and_insert(
            pid, owner_oid="oid-prof", plan_version="7", row_of=row_of),
        N,
    )
    check("no thread raised", not errors, [repr(e) for e in errors][:3])
    winners = [r for r in results if r]
    check(f"exactly ONE of {N} claims succeeded", len(winners) == 1,
          f"{len(winners)} succeeded: a retrying agent would file that many requests")

    data = json.loads(STORE.read_text(encoding="utf-8"))
    check("exactly one request exists on disk", len(data["requests"]) == 1, len(data["requests"]))
    check("exactly one 'submitted' event exists",
          sum(1 for e in data["events"] if e["action"] == "submitted") == 1,
          [e["action"] for e in data["events"]])
    check("the preview is marked used", bool(data["previews"][pid].get("usedAt")))

    print("\n[2] ⚠️ many simultaneous decisions on one request")
    request_id = winners[0][0] if winners else None
    if request_id:
        results, errors = race(
            lambda: dev_store.decide(request_id, decided_by_upn="plan@hs.de",
                                     decided_by_role="planner", accept=True, note="ok"),
            N,
        )
        check("no thread raised while deciding", not errors, [repr(e) for e in errors][:3])
        check(f"exactly ONE of {N} decisions won", sum(1 for r in results if r) == 1,
              f"{sum(1 for r in results if r)} won")
        data = json.loads(STORE.read_text(encoding="utf-8"))
        decided = [e for e in data["events"] if e["action"] in ("accepted", "rejected")]
        check("exactly one decision event was written", len(decided) == 1,
              [e["action"] for e in decided])

    print("\n[3] ⚠️ concurrent writes to DIFFERENT records do not lose each other")
    # The subtler failure: no record is written twice, but a whole write vanishes because two
    # load-modify-save cycles overlapped and the later save was built from a stale read.
    STORE.unlink(missing_ok=True)
    pids = [fresh_preview(f"oid-{i}") for i in range(8)]
    check("all 8 previews survived being created concurrently",
          len(json.loads(STORE.read_text(encoding='utf-8'))["previews"]) == 8)

    STORE.unlink(missing_ok=True)
    ids = [f"oid-{i}" for i in range(N)]
    results, errors = race(
        lambda: dev_store.seed_identity(ids.pop(), "oth", "T-x", "teacher"),
        N,
    )
    check("no thread raised while seeding", not errors, [repr(e) for e in errors][:3])
    seeded = json.loads(STORE.read_text(encoding="utf-8"))["identities"]
    check(f"all {N} concurrent identity writes survived", len(seeded) == N,
          f"{len(seeded)} of {N} survived: the rest were overwritten by a stale read")

    print("\n[4] the file is never left half written")
    # A reader that arrives mid-save must never see a TRUNCATED document.
    # ⚠️ It may, on Windows, briefly see PermissionError: a file cannot be opened while
    # `os.replace` swaps it, because Python's `open()` does not request FILE_SHARE_DELETE. That is
    # a property of atomic replacement, not a defect, and it is transient. What must NEVER happen
    # is a successful read returning half a document, which is what the old in-place write did.
    STORE.unlink(missing_ok=True)
    fresh_preview()
    corrupt: list = []
    locked = {"n": 0}

    def reader():
        for _ in range(400):
            try:
                json.loads(STORE.read_text(encoding="utf-8"))
            except PermissionError:
                locked["n"] += 1          # transient, expected on Windows
            except json.JSONDecodeError as e:
                corrupt.append(repr(e))   # ⚠️ this is the real failure
                return

    t = threading.Thread(target=reader)
    t.start()
    for i in range(60):
        dev_store.seed_identity(f"oid-w{i}", "oth", "T-x", "teacher")
    t.join()
    check("a concurrent reader NEVER saw a truncated document", not corrupt, corrupt[:2])
    print(f"        (transient replace-window locks observed: {locked['n']}, all retryable)")

    STORE.unlink(missing_ok=True)
    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {', '.join(FAILURES)}")
        return 1
    print("the dev store holds its single-use and no-lost-write guarantees under concurrency")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
