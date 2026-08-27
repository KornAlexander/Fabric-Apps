"""The first two plane executors (PLAN.md §14, Phase 9).

The HTTP callable is injected, so every path — including the ones that only
happen in a tenant, like "the principal is already a member" — is exercised
offline against a fake.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from collectors import executors  # noqa: E402


class FakeHttp:
    """Records every call and replays canned GET responses."""

    def __init__(self, responses: dict | None = None):
        self.responses = responses or {}
        self.calls: list[tuple[str, str, dict | None]] = []

    def __call__(self, method: str, url: str, body: dict | None):
        self.calls.append((method, url, body))
        if method == "GET":
            for key, value in self.responses.items():
                if key in url:
                    return value
            return {"value": []}
        return {}

    @property
    def writes(self):
        return [c for c in self.calls if c[0] != "GET"]


class TestEntraGroupMember:
    def test_adds_a_principal_that_is_not_yet_a_member(self):
        http = FakeHttp({"/members": {"value": [{"id": "someone-else"}]}})
        out = executors.entra_group_member(http)({"target_id": "g1", "principal_id": "u1"}, False)

        assert out["ok"] is True
        assert out["detail"] == "created"
        method, url, body = http.writes[0]
        assert method == "POST"
        assert url.endswith("/groups/g1/members/$ref")
        assert body["@odata.id"].endswith("/directoryObjects/u1")

    def test_is_a_no_op_when_the_principal_is_already_a_member(self):
        # Graph returns 400 "object references already exist" for a duplicate,
        # which is indistinguishable from a real failure at the call site — so
        # the executor reads first rather than relying on the error text.
        http = FakeHttp({"/members": {"value": [{"id": "u1"}]}})
        out = executors.entra_group_member(http)({"target_id": "g1", "principal_id": "u1"}, False)

        assert out["ok"] is True
        assert out["detail"] == "already_present"
        assert http.writes == []

    def test_already_present_is_genuinely_verified(self):
        # This is the one case where synchronous verification is honest: we
        # just read the membership back.
        http = FakeHttp({"/members": {"value": [{"id": "u1"}]}})
        out = executors.entra_group_member(http)({"target_id": "g1", "principal_id": "u1"}, False)
        assert out["verified"] is True

    def test_a_fresh_write_is_never_claimed_as_verified(self):
        http = FakeHttp()
        out = executors.entra_group_member(http)({"target_id": "g1", "principal_id": "u1"}, False)
        assert out["verified"] is False
        assert out["verify_after_s"] > 0

    def test_a_dry_run_reads_but_never_writes(self):
        http = FakeHttp()
        out = executors.entra_group_member(http)({"target_id": "g1", "principal_id": "u1"}, True)

        assert out["ok"] is True
        assert http.writes == []
        # The preview shows the exact call that would be made (PLAN.md §13 UX).
        assert "POST" in out["detail"] and "/groups/g1/members/$ref" in out["detail"]

    def test_a_binding_without_a_principal_is_rejected(self):
        with pytest.raises(ValueError, match="principal_id"):
            executors.entra_group_member(FakeHttp())({"target_id": "g1"}, True)


ROLE_URL = "/roleAssignments"


class TestFabricWorkspaceRole:
    def test_creates_a_role_assignment(self):
        http = FakeHttp({ROLE_URL: {"value": []}})
        out = executors.fabric_workspace_role(http)(
            {"target_id": "ws1", "principal_id": "g1", "role": "Contributor"}, False
        )

        assert out["detail"] == "created"
        method, url, body = http.writes[0]
        assert method == "POST"
        assert body == {"principal": {"id": "g1", "type": "Group"}, "role": "Contributor"}

    def test_patches_an_existing_assignment_instead_of_posting_again(self):
        # A principal holds one role per workspace; POSTing again is a conflict.
        http = FakeHttp(
            {ROLE_URL: {"value": [{"id": "ra1", "principal": {"id": "g1"}, "role": "Viewer"}]}}
        )
        out = executors.fabric_workspace_role(http)(
            {"target_id": "ws1", "principal_id": "g1", "role": "Contributor"}, False
        )

        assert out["detail"] == "changed"
        assert out["before"] == {"role": "Viewer"}
        method, url, body = http.writes[0]
        assert method == "PATCH"
        assert url.endswith("/roleAssignments/ra1")

    def test_is_a_no_op_when_the_role_already_matches(self):
        http = FakeHttp(
            {ROLE_URL: {"value": [{"id": "ra1", "principal": {"id": "g1"}, "role": "Member"}]}}
        )
        out = executors.fabric_workspace_role(http)(
            {"target_id": "ws1", "principal_id": "g1", "role": "Member"}, False
        )

        assert out["detail"] == "already_present"
        assert http.writes == []

    @pytest.mark.parametrize("role", ["Admin", "Owner", "admin", "Whatever"])
    def test_refuses_to_assign_a_role_it_must_never_grant(self, role):
        # The gates refuse `Admin` too. This is the second lock, because a
        # wrongly granted workspace Admin cannot be undone by this tool.
        http = FakeHttp({ROLE_URL: {"value": []}})
        out = executors.fabric_workspace_role(http)(
            {"target_id": "ws1", "principal_id": "g1", "role": role}, False
        )

        assert out["ok"] is False
        assert out["error"].startswith(f"role:{role}")
        assert http.writes == []

    def test_a_dry_run_previews_the_exact_call(self):
        http = FakeHttp({ROLE_URL: {"value": []}})
        out = executors.fabric_workspace_role(http)(
            {"target_id": "ws1", "principal_id": "g1", "role": "Viewer"}, True
        )

        assert out["ok"] is True
        assert http.writes == []
        assert "POST" in out["detail"]

    def test_requires_an_explicit_role(self):
        with pytest.raises(ValueError, match="role"):
            executors.fabric_workspace_role(FakeHttp())(
                {"target_id": "ws1", "principal_id": "g1"}, True
            )


class TestRegistration:
    def test_registers_only_the_planes_that_have_a_transport(self):
        # A registered executor with no credential fails at the HTTP call and is
        # audited as `executor:failed`, which reads like the plane rejected us.
        # Not registering it says the truth: this deployment cannot write there.
        assert set(executors.build_executors(None, None)) == set()
        assert set(executors.build_executors(FakeHttp(), None)) == {"entra_group_member"}
        assert set(executors.build_executors(None, FakeHttp())) == {"fabric_workspace_role"}
        assert set(executors.build_executors(FakeHttp(), FakeHttp())) == {
            "entra_group_member",
            "fabric_workspace_role",
        }

    def test_admin_is_not_an_assignable_fabric_role(self):
        assert "Admin" not in executors.FABRIC_ROLES
