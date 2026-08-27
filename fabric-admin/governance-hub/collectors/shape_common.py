"""Shared collector primitives (PLAN.md §15).

Pure Python: no Spark, no network, no Fabric runtime. Everything in this package
is unit-tested offline, then **inlined verbatim** into the collector notebooks by
`bootstrap/build_ipynb.py`. That is deliberate — the risky part of a collector is
not the HTTP call, it is the shaping: which fields become which columns, what
counts as a gap, and which flags a governance decision later depends on.

Resilience rules every collector inherits (from the Data Catalog scanner):
  * per-object try/except; one bad workspace or environment never sinks a run
  * every run appends a `gov_runs` row, including failures
  * incremental where the source supports it
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Iterable, Sequence


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_run_id() -> str:
    return str(uuid.uuid4())


def as_str(value: Any) -> str | None:
    """Normalise an API scalar to a string, preserving a real absence as None.

    Collector tables are all-string on purpose: every plane has its own id
    format, and coercing them into typed columns is how a join silently starts
    returning nothing.
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def as_json(value: Any) -> str | None:
    """Stable JSON for a blob column. Sorted keys so diffs are meaningful."""
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)


def stamp(rows: Iterable[dict], run_id: str, scanned_at: datetime | None = None) -> list[dict]:
    """Attach the run provenance every `gov_actual_*` row carries."""
    when = scanned_at or utcnow()
    out = []
    for row in rows:
        enriched = dict(row)
        enriched["run_id"] = run_id
        enriched["scanned_at"] = when
        out.append(enriched)
    return out


class RunLedger:
    """Accumulates what a collector did, for the `gov_runs` row and the app.

    Errors are first-class: a collector that quietly drops an unreadable object
    produces a governance report that is wrong in the most dangerous direction —
    it under-reports access.
    """

    def __init__(self, collector: str, module: str, tier: str) -> None:
        self.run_id = new_run_id()
        self.collector = collector
        self.module = module
        self.tier = tier
        self.started_at = utcnow()
        self.finished_at: datetime | None = None
        self.errors: list[dict[str, str]] = []
        self.counts: dict[str, int] = {}

    def count(self, table: str, n: int) -> None:
        self.counts[table] = self.counts.get(table, 0) + n

    def error(self, scope: str, exc: BaseException | str) -> None:
        self.errors.append(
            {
                "scope": scope,
                "type": type(exc).__name__ if isinstance(exc, BaseException) else "Error",
                "message": str(exc),
            }
        )

    def finish(self) -> dict:
        self.finished_at = utcnow()
        return {
            "run_id": self.run_id,
            "collector": self.collector,
            "module": self.module,
            "tier": self.tier,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "n_objects": sum(self.counts.values()),
            "n_errors": len(self.errors),
            "error_json": as_json(self.errors) if self.errors else None,
            "duration_s": (self.finished_at - self.started_at).total_seconds(),
        }

    def exit_value(self, *, dry_run: bool) -> dict:
        """Actuator-contract-shaped result (PLAN.md §14) for the app to parse."""
        return {
            "ok": True,
            "dry_run": dry_run,
            "run_id": self.run_id,
            "collector": self.collector,
            "module": self.module,
            "tier": self.tier,
            "counts": dict(self.counts),
            "n_errors": len(self.errors),
            "errors": self.errors[:20],
            "finished_at": (self.finished_at or utcnow()).isoformat(),
        }


def safe_each(
    items: Sequence[Any],
    fn: Callable[[Any], list[dict]],
    ledger: RunLedger,
    scope_of: Callable[[Any], str],
) -> list[dict]:
    """Map `fn` over `items`, recording per-item failures instead of raising."""
    rows: list[dict] = []
    for item in items:
        try:
            rows.extend(fn(item))
        except Exception as exc:  # noqa: BLE001 — a collector must never hard-fail
            ledger.error(scope_of(item), exc)
    return rows
