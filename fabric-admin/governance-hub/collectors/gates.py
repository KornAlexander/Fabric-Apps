"""The four write gates — server-side implementation (PLAN.md §8.7, §14).

**This is the enforcement point.** The TypeScript copy in `src/domain/writeGates.ts`
exists so the UI can explain a refusal before anyone clicks; it is a courtesy, not
a control. Every actuator re-decides here, from `gov_config` read inside the
notebook, because the SPA's opinion is never trusted.

Both implementations are checked against one shared specification —
`spec/write_gate_cases.json` — by both test suites. Two implementations of one
rule set drift silently, and here the drift would mean the tool writing something
it promised it would not.

Pure Python: no Spark, no network. Inlined verbatim into the actuator notebook.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

DRY_RUN_VALIDITY_DAYS = 30

#: Roles this tool must never grant, in any plane, under any configuration.
#: Compared case-insensitively after trimming.
DENIED_ROLES = frozenset(
    {
        "admin",
        "administrator",
        "owner",
        "system administrator",
        "global administrator",
        "power platform administrator",
    }
)

WILDCARD_SCOPE = "*"


def is_denied_role(role: Any) -> bool:
    if not role:
        return False
    return str(role).strip().lower() in DENIED_ROLES


def _has_recent_dry_run(
    binding_kind: str,
    scope_id: str,
    dry_runs: Iterable[dict],
    now: datetime,
) -> bool:
    """A successful dry run for this exact kind × scope, inside the window.

    Deliberately exact: a dry run against a lab workspace says nothing about
    production, and a dry run of a different binding kind says nothing at all.
    """
    cutoff = now - timedelta(days=DRY_RUN_VALIDITY_DAYS)
    for entry in dry_runs:
        if entry.get("binding_kind") != binding_kind:
            continue
        if entry.get("scope_id") != scope_id:
            continue
        succeeded_at = entry.get("succeeded_at")
        if not isinstance(succeeded_at, datetime):
            continue
        if succeeded_at.tzinfo is None:
            succeeded_at = succeeded_at.replace(tzinfo=timezone.utc)
        # A future timestamp is a clock problem, not an approval.
        if cutoff <= succeeded_at <= now:
            return True
    return False


def evaluate_write_gates(
    request: dict,
    config: dict,
    dry_runs: Iterable[dict] = (),
    now: datetime | None = None,
) -> dict:
    """Evaluate every gate. Returns `{"allowed": bool, "failed_gate": str|None, "detail": str|None}`.

    Order matters: the *first* refusal is what gets audited, so the unconditional
    invariants come first and the cheapest configuration checks follow. An audit
    row saying `gate:deniedRole` is a very different conversation from
    `gate:master`.
    """
    now = now or datetime.now(timezone.utc)
    dry_runs = list(dry_runs)

    binding_kind = request.get("binding_kind", "")
    module = request.get("module", "")
    scope_id = request.get("scope_id", "")
    role = request.get("role")
    is_dry_run = bool(request.get("dry_run", False))
    writable = bool(request.get("writable", False))

    def refuse(gate: str, detail: str | None = None) -> dict:
        return {"allowed": False, "failed_gate": gate, "detail": detail}

    # ── unconditional invariants — no configuration can override these ──────
    if is_denied_role(role):
        return refuse("deniedRole", f"role={role}")
    if module not in (config.get("enabled_modules") or []):
        return refuse("moduleOff", f"module={module}")
    if not writable:
        return refuse("notWritable", f"kind={binding_kind}")

    # ── the four gates ─────────────────────────────────────────────────────
    if not config.get("writes_enabled", False):
        return refuse("master", None)
    if binding_kind not in (config.get("armed_kinds") or []):
        return refuse("kind", f"kind={binding_kind}")

    # A dry run changes nothing, so it stops here. Requiring the scope
    # allow-list and a prior dry run of a dry run would make gate 4 unreachable
    # — you could never earn the dry run that unlocks the real write.
    if is_dry_run:
        return {"allowed": True, "failed_gate": None, "detail": None}

    allowlist = config.get("scope_allowlist") or []
    if WILDCARD_SCOPE not in allowlist and scope_id not in allowlist:
        return refuse("scope", f"scope={scope_id}")

    if not _has_recent_dry_run(binding_kind, scope_id, dry_runs, now):
        return refuse(
            "dryRun",
            f"kind={binding_kind} scope={scope_id} window={DRY_RUN_VALIDITY_DAYS}d",
        )

    return {"allowed": True, "failed_gate": None, "detail": None}
