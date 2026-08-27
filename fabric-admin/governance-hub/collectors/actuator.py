"""The actuator framework (PLAN.md §14).

Every privileged write in this product goes through `run_actuator`. It is pure:
gates in, decision + audit row out. The notebook around it does the IO — read
`gov_config`, read `gov_dry_runs`, call the plane, append `gov_audit`.

That split is deliberate. The risky part of an actuator is not the HTTP call, it
is the *decision* to make it, and a decision that only exists inside a Spark
notebook cannot be tested. So the decision lives here, offline-testable, and is
inlined verbatim into the notebook.

Three rules the framework enforces for every plane, so no individual actuator
can forget one:

  * **Gates first.** All four, server-side, before anything is touched.
  * **Always audit — especially refusals.** A refusal nobody recorded is
    indistinguishable from a write that never happened.
  * **A dry run is only credited when it actually succeeded.** Gate 4 is what
    turns "we tested it" into a machine fact; crediting an errored dry run would
    quietly hand back the safety it buys.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any, Callable

try:
    from .gates import evaluate_write_gates
except ImportError:  # pragma: no cover - flat-file layout inside the notebook
    from gates import evaluate_write_gates

#: Executors are registered per binding kind by the plane modules in later
#: phases. A kind with no executor is refused, loudly — never silently treated
#: as a success.
Executor = Callable[[dict, bool], dict]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_json(value: Any) -> str | None:
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)


def build_audit_row(
    *,
    actor: str,
    actor_type: str,
    action: str,
    plane: str,
    target_type: str,
    target_id: str,
    outcome: str,
    request_id: str = "",
    correlation_id: str = "",
    before: Any = None,
    after: Any = None,
    error: str | None = None,
    ts: datetime | None = None,
) -> dict:
    """One `gov_audit` row. Append-only; this table is the real deliverable."""
    return {
        "audit_id": str(uuid.uuid4()),
        "ts": ts or _utcnow(),
        "actor": actor,
        "actor_type": actor_type,
        "action": action,
        "plane": plane,
        "target_type": target_type,
        "target_id": target_id,
        "before_json": _as_json(before),
        "after_json": _as_json(after),
        "request_id": request_id,
        "correlation_id": correlation_id,
        "outcome": outcome,
        "error": error,
    }


def result(
    *,
    ok: bool,
    dry_run: bool,
    before: Any = None,
    after: Any = None,
    verified: bool = False,
    verify_after_s: int = 0,
    detail: str = "",
    error: str | None = None,
) -> dict:
    """The actuator `exitValue` contract (PLAN.md §14)."""
    return {
        "ok": ok,
        "dry_run": dry_run,
        "before": before,
        "after": after,
        "verified": verified,
        "verify_after_s": verify_after_s,
        "detail": detail,
        "error": error,
    }


def run_actuator(
    request: dict,
    config: dict,
    dry_runs: list[dict],
    executors: dict[str, Executor],
    *,
    now: datetime | None = None,
) -> dict:
    """Decide, execute, and produce everything the notebook must persist.

    Returns `{"result": …, "audit": row, "dry_run_row": row|None}`. The caller
    writes `audit` unconditionally — that is the point of returning it rather
    than writing it here.
    """
    now = now or _utcnow()
    binding = request.get("binding") or {}
    binding_kind = binding.get("kind", "")
    scope_id = binding.get("target_id", "")
    is_dry_run = bool(request.get("dry_run", True))
    actor = request.get("actor") or "unknown"
    action = f"{'dryrun' if is_dry_run else 'write'}:{binding_kind}"
    plane = binding.get("module", "")

    audit = lambda outcome, error=None, before=None, after=None: build_audit_row(  # noqa: E731
        actor=actor,
        actor_type=request.get("actor_type", "User"),
        action=action,
        plane=plane,
        target_type=binding.get("target_type", "Scope"),
        target_id=scope_id,
        outcome=outcome,
        request_id=request.get("request_id", ""),
        correlation_id=request.get("correlation_id", ""),
        before=before,
        after=after,
        error=error,
        ts=now,
    )

    decision = evaluate_write_gates(
        {
            "binding_kind": binding_kind,
            "module": plane,
            "scope_id": scope_id,
            "role": binding.get("role"),
            "dry_run": is_dry_run,
            "writable": bool(binding.get("writable", False)),
        },
        config,
        dry_runs,
        now=now,
    )

    if not decision["allowed"]:
        gate = decision["failed_gate"]
        return {
            "result": result(
                ok=False,
                dry_run=is_dry_run,
                detail=decision.get("detail") or "",
                error=f"gate:{gate}",
            ),
            "audit": audit("Refused", error=f"gate:{gate} {decision.get('detail') or ''}".strip()),
            "dry_run_row": None,
        }

    executor = executors.get(binding_kind)
    if executor is None:
        # Honest failure. A binding kind with no executor is a plane this build
        # cannot write to yet — returning ok would claim a grant that does not
        # exist, and the drift engine would then report the *platform* as wrong.
        return {
            "result": result(
                ok=False,
                dry_run=is_dry_run,
                detail=f"no executor registered for {binding_kind}",
                error="executor:not-implemented",
            ),
            "audit": audit("Failed", error=f"executor:not-implemented kind={binding_kind}"),
            "dry_run_row": None,
        }

    try:
        outcome = executor(binding, is_dry_run) or {}
    except Exception as exc:  # noqa: BLE001 — the audit row is the whole point
        return {
            "result": result(
                ok=False,
                dry_run=is_dry_run,
                detail=f"{type(exc).__name__}: {exc}",
                error="executor:failed",
            ),
            "audit": audit("Failed", error=f"{type(exc).__name__}: {exc}"),
            "dry_run_row": None,
        }

    ok = bool(outcome.get("ok", True))
    before = outcome.get("before")
    after = outcome.get("after")
    detail = outcome.get("detail", "")

    # Only a *successful* dry run earns gate-4 credit.
    dry_run_row = None
    if ok and is_dry_run:
        dry_run_row = {
            "binding_kind": binding_kind,
            "scope_id": scope_id,
            "succeeded_at": now,
            "actor": actor,
            "correlation_id": request.get("correlation_id", ""),
        }

    return {
        "result": result(
            ok=ok,
            dry_run=is_dry_run,
            before=before,
            after=after,
            verified=bool(outcome.get("verified", False)),
            verify_after_s=int(outcome.get("verify_after_s", 0)),
            detail=detail,
            error=outcome.get("error"),
        ),
        "audit": audit(
            "Planned" if is_dry_run and ok else ("Success" if ok else "Failed"),
            error=outcome.get("error"),
            before=before,
            after=after,
        ),
        "dry_run_row": dry_run_row,
    }
