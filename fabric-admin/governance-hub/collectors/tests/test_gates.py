"""The write gates and the actuator framework, server side (PLAN.md §8.7, §14).

The gate cases come from `spec/write_gate_cases.json`, which the TypeScript suite
reads too. Neither implementation owns the specification — if the two ever
disagree, one of these suites fails, and that is the whole point: a governance
tool whose UI and enforcement disagree will eventually write something it
promised it would not.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from collectors import actuator, gates  # noqa: E402

NOW = datetime(2026, 8, 4, 12, 0, tzinfo=timezone.utc)

CASES = json.loads((ROOT / "spec" / "write_gate_cases.json").read_text(encoding="utf-8"))[
    "cases"
]


def _config(raw: dict) -> dict:
    return {
        "writes_enabled": raw["writesEnabled"],
        "armed_kinds": raw["armedKinds"],
        "scope_allowlist": raw["scopeAllowlist"],
        "enabled_modules": raw["enabledModules"],
    }


def _request(raw: dict) -> dict:
    return {
        "binding_kind": raw["bindingKind"],
        "module": raw["module"],
        "scope_id": raw["scopeId"],
        "role": raw.get("role"),
        "dry_run": raw["dryRun"],
        "writable": raw["writable"],
    }


def _dry_runs(raw: list[dict]) -> list[dict]:
    return [
        {
            "binding_kind": entry["bindingKind"],
            "scope_id": entry["scopeId"],
            "succeeded_at": NOW - timedelta(days=entry["agoDays"]),
        }
        for entry in raw
    ]


class TestSharedSpecification:
    def test_the_spec_is_not_empty(self):
        # Guards against a silently unreadable or renamed spec file making both
        # suites vacuously pass.
        assert len(CASES) >= 15

    @pytest.mark.parametrize("case", CASES, ids=lambda c: c["name"])
    def test_case(self, case):
        decision = gates.evaluate_write_gates(
            _request(case["request"]),
            _config(case["config"]),
            _dry_runs(case["dryRuns"]),
            now=NOW,
        )
        if case["expect"] == "allow":
            assert decision["allowed"] is True, decision
        else:
            assert decision["allowed"] is False, decision
            assert decision["failed_gate"] == case["expect"]


class TestGateDetails:
    def test_a_refusal_carries_a_detail_for_the_audit_row(self):
        decision = gates.evaluate_write_gates(
            {
                "binding_kind": "entra_group_member",
                "module": "entra",
                "scope_id": "ws-pilot",
                "dry_run": False,
                "writable": True,
            },
            {
                "writes_enabled": True,
                "armed_kinds": ["entra_group_member"],
                "scope_allowlist": ["*"],
                "enabled_modules": ["entra"],
            },
            [],
            now=NOW,
        )
        assert decision["failed_gate"] == "dryRun"
        assert "window=30d" in decision["detail"]

    def test_a_future_dry_run_is_a_clock_problem_not_an_approval(self):
        decision = gates.evaluate_write_gates(
            {
                "binding_kind": "k",
                "module": "entra",
                "scope_id": "s",
                "dry_run": False,
                "writable": True,
            },
            {
                "writes_enabled": True,
                "armed_kinds": ["k"],
                "scope_allowlist": ["*"],
                "enabled_modules": ["entra"],
            },
            [{"binding_kind": "k", "scope_id": "s", "succeeded_at": NOW + timedelta(days=1)}],
            now=NOW,
        )
        assert decision["failed_gate"] == "dryRun"

    def test_a_naive_timestamp_is_treated_as_utc_not_discarded(self):
        # Spark hands back naive timestamps; discarding them would silently
        # revoke gate-4 credit that was legitimately earned.
        decision = gates.evaluate_write_gates(
            {
                "binding_kind": "k",
                "module": "entra",
                "scope_id": "s",
                "dry_run": False,
                "writable": True,
            },
            {
                "writes_enabled": True,
                "armed_kinds": ["k"],
                "scope_allowlist": ["*"],
                "enabled_modules": ["entra"],
            },
            [{"binding_kind": "k", "scope_id": "s", "succeeded_at": datetime(2026, 8, 3, 12)}],
            now=NOW,
        )
        assert decision["allowed"] is True


ARMED_CONFIG = {
    "writes_enabled": True,
    "armed_kinds": ["entra_group_member"],
    "scope_allowlist": ["ws-pilot"],
    "enabled_modules": ["entra"],
}


def _binding(**over):
    base = {
        "kind": "entra_group_member",
        "module": "entra",
        "target_id": "ws-pilot",
        "target_type": "Workspace",
        "principal_id": "u1",
        "writable": True,
    }
    base.update(over)
    return base


def _request_envelope(dry_run=False, **over):
    return {
        "correlation_id": "c1",
        "request_id": "r1",
        "actor": "alkorn@example.com",
        "dry_run": dry_run,
        "binding": _binding(**over),
    }


class TestActuator:
    def test_the_exit_criterion_refused_and_audited(self):
        """An armed kind with no prior dry run is refused with `gate:dryRun`."""
        out = actuator.run_actuator(
            _request_envelope(),
            ARMED_CONFIG,
            [],
            {"entra_group_member": lambda b, d: {"ok": True}},
            now=NOW,
        )
        assert out["result"]["ok"] is False
        assert out["result"]["error"] == "gate:dryRun"
        # Refused, and recorded. A refusal nobody recorded is indistinguishable
        # from a write that never happened.
        assert out["audit"]["outcome"] == "Refused"
        assert "gate:dryRun" in out["audit"]["error"]
        assert out["audit"]["actor"] == "alkorn@example.com"
        assert out["dry_run_row"] is None

    def test_a_refused_call_never_reaches_the_executor(self):
        calls = []
        actuator.run_actuator(
            _request_envelope(),
            ARMED_CONFIG,
            [],
            {"entra_group_member": lambda b, d: calls.append(b) or {"ok": True}},
            now=NOW,
        )
        assert calls == []

    def test_a_successful_dry_run_earns_gate_four_credit(self):
        out = actuator.run_actuator(
            _request_envelope(dry_run=True),
            ARMED_CONFIG,
            [],
            {"entra_group_member": lambda b, d: {"ok": True, "after": {"planned": True}}},
            now=NOW,
        )
        assert out["result"]["ok"] is True
        assert out["audit"]["outcome"] == "Planned"
        assert out["dry_run_row"]["binding_kind"] == "entra_group_member"
        assert out["dry_run_row"]["scope_id"] == "ws-pilot"

    def test_a_failed_dry_run_earns_nothing(self):
        # Crediting an errored dry run would quietly hand back the safety gate 4
        # exists to buy.
        out = actuator.run_actuator(
            _request_envelope(dry_run=True),
            ARMED_CONFIG,
            [],
            {"entra_group_member": lambda b, d: {"ok": False, "error": "403"}},
            now=NOW,
        )
        assert out["dry_run_row"] is None
        assert out["audit"]["outcome"] == "Failed"

    def test_a_credited_dry_run_then_unlocks_the_real_write(self):
        first = actuator.run_actuator(
            _request_envelope(dry_run=True),
            ARMED_CONFIG,
            [],
            {"entra_group_member": lambda b, d: {"ok": True}},
            now=NOW,
        )
        second = actuator.run_actuator(
            _request_envelope(),
            ARMED_CONFIG,
            [first["dry_run_row"]],
            {"entra_group_member": lambda b, d: {"ok": True, "after": {"member": "u1"}}},
            now=NOW,
        )
        assert second["result"]["ok"] is True
        assert second["audit"]["outcome"] == "Success"
        assert json.loads(second["audit"]["after_json"]) == {"member": "u1"}

    def test_an_unregistered_binding_kind_fails_loudly(self):
        out = actuator.run_actuator(
            _request_envelope(dry_run=True),
            ARMED_CONFIG,
            [],
            {},
            now=NOW,
        )
        assert out["result"]["ok"] is False
        assert out["result"]["error"] == "executor:not-implemented"
        assert out["audit"]["outcome"] == "Failed"
        assert out["dry_run_row"] is None

    def test_an_exploding_executor_is_caught_and_audited(self):
        def boom(binding, dry_run):
            raise RuntimeError("the plane said no")

        out = actuator.run_actuator(
            _request_envelope(dry_run=True),
            ARMED_CONFIG,
            [],
            {"entra_group_member": boom},
            now=NOW,
        )
        assert out["result"]["error"] == "executor:failed"
        assert "the plane said no" in out["audit"]["error"]

    def test_an_elevated_role_is_refused_before_anything_else(self):
        out = actuator.run_actuator(
            _request_envelope(dry_run=True, role="Owner"),
            ARMED_CONFIG,
            [],
            {"entra_group_member": lambda b, d: {"ok": True}},
            now=NOW,
        )
        assert out["result"]["error"] == "gate:deniedRole"

    def test_the_action_distinguishes_a_dry_run_from_a_write(self):
        planned = actuator.run_actuator(
            _request_envelope(dry_run=True),
            ARMED_CONFIG,
            [],
            {"entra_group_member": lambda b, d: {"ok": True}},
            now=NOW,
        )
        assert planned["audit"]["action"] == "dryrun:entra_group_member"

    def test_every_path_produces_exactly_one_audit_row(self):
        scenarios = [
            (_request_envelope(), [], {}),
            (_request_envelope(dry_run=True), [], {}),
            (_request_envelope(dry_run=True), [], {"entra_group_member": lambda b, d: {"ok": True}}),
            (_request_envelope(role="Admin"), [], {}),
        ]
        for request, dry_runs, executors in scenarios:
            out = actuator.run_actuator(request, ARMED_CONFIG, dry_runs, executors, now=NOW)
            assert out["audit"]["audit_id"], "every outcome must be audited"
            assert out["audit"]["ts"] == NOW
