"""The licence-free Power Platform write set (PLAN.md §8.5, §14, Phase 10).

The exit criterion of Phase 10 lives here: *"agent author in env X" granted via
a group team, with zero premium licences consumed.*
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from collectors import executors_pp  # noqa: E402


class FakeHttp:
    """Replays canned responses by URL fragment and records every call."""

    def __init__(self, responses: dict | None = None):
        self.responses = responses or {}
        self.calls: list[tuple[str, str, dict | None]] = []

    def __call__(self, method: str, url: str, body: dict | None):
        self.calls.append((method, url, body))
        for key, value in self.responses.items():
            if key in url:
                return value
        return {}

    @property
    def writes(self):
        return [c for c in self.calls if c[0] not in ("GET",)]


ENV_URL = "https://contoso.crm4.dynamics.com"


class TestEnvironmentSecurityGroup:
    def test_binds_a_group_to_a_production_environment(self):
        http = FakeHttp({"/environments/e1": {"properties": {"environmentSku": "Production"}}})
        out = executors_pp.pp_env_security_group(http)(
            {"target_id": "e1", "principal_id": "g1"}, False
        )

        assert out["ok"] is True
        assert out["detail"] == "created"
        method, url, body = http.writes[0]
        assert method == "PATCH"
        assert body["properties"]["linkedEnvironmentMetadata"]["securityGroupId"] == "g1"

    @pytest.mark.parametrize("sku", ["Default", "Developer"])
    def test_refuses_default_and_developer_with_the_real_reason(self, sku):
        # There is no supported way to do this. Failing with a raw BAP error
        # would send an admin hunting for a permission that would not help.
        http = FakeHttp({"/environments/e1": {"properties": {"environmentSku": sku}}})
        out = executors_pp.pp_env_security_group(http)(
            {"target_id": "e1", "principal_id": "g1"}, False
        )

        assert out["ok"] is False
        assert out["error"] == "platform:security-group-not-assignable"
        assert "data policy" in out["detail"]
        assert http.writes == []

    def test_is_a_no_op_when_the_same_group_is_already_bound(self):
        http = FakeHttp(
            {
                "/environments/e1": {
                    "properties": {
                        "environmentSku": "Production",
                        "linkedEnvironmentMetadata": {"securityGroupId": "g1"},
                    }
                }
            }
        )
        out = executors_pp.pp_env_security_group(http)(
            {"target_id": "e1", "principal_id": "g1"}, False
        )

        assert out["detail"] == "already_present"
        assert out["verified"] is True
        assert http.writes == []

    def test_records_that_a_previous_group_was_displaced(self):
        # Replacing the binding locks out the old group's members, so the audit
        # row has to show it happened.
        http = FakeHttp(
            {
                "/environments/e1": {
                    "properties": {
                        "environmentSku": "Production",
                        "linkedEnvironmentMetadata": {"securityGroupId": "old"},
                    }
                }
            }
        )
        out = executors_pp.pp_env_security_group(http)(
            {"target_id": "e1", "principal_id": "new"}, False
        )

        assert out["before"] == {"security_group_id": "old"}
        assert out["after"]["replaced"] is True
        assert out["detail"] == "changed"

    def test_a_dry_run_writes_nothing(self):
        http = FakeHttp({"/environments/e1": {"properties": {"environmentSku": "Production"}}})
        out = executors_pp.pp_env_security_group(http)(
            {"target_id": "e1", "principal_id": "g1"}, True
        )
        assert out["ok"] is True
        assert http.writes == []


class TestDataverseRole:
    def _http(self, roles=None, held=None):
        return FakeHttp(
            {
                "/roles?": {"value": roles if roles is not None else [{"roleid": "r1"}]},
                "teamroles_association?": {"value": held or []},
            }
        )

    def test_assigns_a_role_to_a_group_team(self):
        http = self._http()
        out = executors_pp.pp_dataverse_role(http)(
            {
                "target_id": "e1",
                "environment_url": ENV_URL,
                "principal_id": "t1",
                "principal_type": "Team",
                "role": "Agent Author",
            },
            False,
        )

        assert out["ok"] is True
        assert out["detail"] == "created"
        method, url, body = http.writes[0]
        assert method == "POST"
        assert url.endswith("/teams(t1)/teamroles_association/$ref")
        assert body["@odata.id"].endswith("/roles(r1)")

    def test_refuses_to_assign_a_role_to_an_individual(self):
        # A role held by a person is access no group membership explains: the
        # Can-Do Explorer cannot derive it and revoking means hunting rows.
        http = self._http()
        out = executors_pp.pp_dataverse_role(http)(
            {
                "target_id": "e1",
                "environment_url": ENV_URL,
                "principal_id": "u1",
                "principal_type": "User",
                "role": "Agent Author",
            },
            False,
        )

        assert out["ok"] is False
        assert out["error"] == "principal:must-be-group-team"
        assert http.writes == []

    @pytest.mark.parametrize("role", ["System Administrator", "system customizer"])
    def test_refuses_the_elevated_dataverse_roles(self, role):
        out = executors_pp.pp_dataverse_role(self._http())(
            {
                "target_id": "e1",
                "environment_url": ENV_URL,
                "principal_id": "t1",
                "role": role,
            },
            True,
        )
        assert out["ok"] is False
        assert "never assignable" in out["error"]

    def test_is_a_no_op_when_the_team_already_holds_the_role(self):
        http = self._http(held=[{"roleid": "r1"}])
        out = executors_pp.pp_dataverse_role(http)(
            {
                "target_id": "e1",
                "environment_url": ENV_URL,
                "principal_id": "t1",
                "role": "Agent Author",
            },
            False,
        )

        assert out["detail"] == "already_present"
        assert http.writes == []

    def test_says_so_when_the_role_does_not_exist_in_that_environment(self):
        http = self._http(roles=[])
        out = executors_pp.pp_dataverse_role(http)(
            {
                "target_id": "e1",
                "environment_url": ENV_URL,
                "principal_id": "t1",
                "role": "Nonexistent",
            },
            True,
        )

        assert out["ok"] is False
        assert out["error"] == "role:not-found"

    def test_requires_the_environment_url(self):
        # Dataverse is per-environment; there is no tenant-wide endpoint.
        with pytest.raises(ValueError, match="environment_url"):
            executors_pp.pp_dataverse_role(self._http())(
                {"target_id": "e1", "principal_id": "t1", "role": "Agent Author"}, True
            )


class TestTenantSetting:
    def test_preserves_the_rest_of_the_settings_blob(self):
        # `Set-TenantSettings` replaces what it is given, so a naive
        # `{setting: value}` write silently resets its whole section.
        http = FakeHttp(
            {
                "listtenantsettings": {
                    "powerPlatform": {
                        "governance": {
                            "disableEnvironmentCreationByNonAdminUsers": False,
                            "disableTrialEnvironmentCreationByNonAdminUsers": True,
                        },
                        "powerApps": {"disableShareWithEveryone": True},
                    }
                }
            }
        )
        out = executors_pp.pp_tenant_setting(http)(
            {
                "target_id": "tenant",
                "setting_name": "disableEnvironmentCreationByNonAdminUsers",
                "value": True,
            },
            False,
        )

        assert out["ok"] is True
        body = [c for c in http.calls if "/tenantsettings?" in c[1]][0][2]
        governance = body["powerPlatform"]["governance"]
        assert governance["disableEnvironmentCreationByNonAdminUsers"] is True
        assert governance["disableTrialEnvironmentCreationByNonAdminUsers"] is True
        assert body["powerPlatform"]["powerApps"]["disableShareWithEveryone"] is True

    def test_never_claims_a_tenant_setting_is_verified(self):
        # They take minutes. Claiming otherwise reports a control that is not
        # yet in force.
        http = FakeHttp({"listtenantsettings": {}})
        out = executors_pp.pp_tenant_setting(http)(
            {"target_id": "tenant", "setting_name": "disableShareWithEveryone", "value": True},
            False,
        )
        assert out["verified"] is False
        assert out["verify_after_s"] >= 3600

    def test_is_a_no_op_when_the_value_already_matches(self):
        http = FakeHttp(
            {
                "listtenantsettings": {
                    "powerPlatform": {"governance": {"disableShareWithEveryone": True}}
                }
            }
        )
        out = executors_pp.pp_tenant_setting(http)(
            {"target_id": "tenant", "setting_name": "disableShareWithEveryone", "value": True},
            False,
        )
        assert out["detail"] == "already_present"
        assert [c for c in http.calls if "tenantsettings?" in c[1] and "list" not in c[1]] == []


class TestTenantIsolation:
    def test_speaks_enabled_and_inverts_is_disabled_once(self):
        # The API says `isDisabled`, which is trivially easy to get backwards —
        # and getting it backwards opens a tenant while reporting it hardened.
        http = FakeHttp({"tenantIsolationPolicy": {"properties": {"isDisabled": True}}})
        out = executors_pp.pp_tenant_isolation(http)(
            {"target_id": "tenant", "enabled": True}, False
        )

        assert out["before"] == {"enabled": False}
        method, _url, body = http.writes[0]
        assert method == "PUT"
        assert body["properties"]["isDisabled"] is False

    def test_is_a_no_op_when_already_in_the_wanted_state(self):
        http = FakeHttp({"tenantIsolationPolicy": {"properties": {"isDisabled": False}}})
        out = executors_pp.pp_tenant_isolation(http)(
            {"target_id": "tenant", "enabled": True}, False
        )
        assert out["detail"] == "already_present"
        assert http.writes == []

    def test_still_writes_when_only_the_allow_list_changes(self):
        http = FakeHttp({"tenantIsolationPolicy": {"properties": {"isDisabled": False}}})
        out = executors_pp.pp_tenant_isolation(http)(
            {"target_id": "tenant", "enabled": True, "allowed_tenants": [{"tenantId": "t2"}]},
            False,
        )
        assert out["detail"] == "changed"
        assert out["after"]["allowed_tenants"] == 1


class TestDataPolicy:
    def test_creates_a_blocking_policy(self):
        http = FakeHttp({"/policies": {"value": []}})
        out = executors_pp.pp_data_policy(http)(
            {"target_id": "tenant", "policy_name": "Default hardening"}, False
        )

        assert out["ok"] is True
        assert out["detail"] == "created"
        method, _url, body = http.writes[0]
        assert method == "POST"
        # Blocked-by-default is the primary licence-free Default-env lever.
        assert body["defaultConnectorClassification"] == "Blocked"

    def test_updates_an_existing_policy_of_the_same_name(self):
        http = FakeHttp(
            {
                "/policies": {
                    "value": [
                        {
                            "name": "p1",
                            "displayName": "Default hardening",
                            "defaultConnectorClassification": "General",
                        }
                    ]
                }
            }
        )
        out = executors_pp.pp_data_policy(http)(
            {"target_id": "tenant", "policy_name": "Default hardening"}, False
        )

        assert out["detail"] == "changed"
        assert out["before"]["default_connector_group"] == "General"
        assert http.writes[0][0] == "PATCH"

    def test_rejects_an_invalid_connector_classification(self):
        out = executors_pp.pp_data_policy(FakeHttp({"/policies": {"value": []}}))(
            {
                "target_id": "tenant",
                "policy_name": "Bad",
                "default_connector_group": "Whatever",
            },
            True,
        )
        assert out["ok"] is False
        assert "classification" in out["error"]


class TestRegistration:
    def test_registers_only_the_transports_that_exist(self):
        assert executors_pp.build_pp_executors(None, None) == {}
        bap_only = executors_pp.build_pp_executors(FakeHttp(), None)
        # Dataverse is a different audience per environment, so it is not
        # assumed to work just because BAP does.
        assert "pp_dataverse_role" not in bap_only
        assert set(bap_only) == {
            "pp_env_security_group",
            "pp_tenant_setting",
            "pp_tenant_isolation",
            "pp_data_policy",
        }
        both = executors_pp.build_pp_executors(FakeHttp(), FakeHttp())
        assert "pp_dataverse_role" in both

    def test_managed_environments_is_never_registered(self):
        # Enabling Managed Environments makes premium licences a requirement for
        # active usage. A governance tool must never trigger that as a side
        # effect of granting somebody access.
        both = executors_pp.build_pp_executors(FakeHttp(), FakeHttp())
        assert "pp_managed_env" not in both


class TestExitCriterion:
    """"Agent author in env X" via a group team — the Phase 10 exit criterion."""

    def test_grants_agent_authoring_through_a_group_team_only(self):
        bap = FakeHttp({"/environments/e-coe": {"properties": {"environmentSku": "Production"}}})
        dataverse = FakeHttp(
            {
                "/roles?": {"value": [{"roleid": "r-agent"}]},
                "teamroles_association?": {"value": []},
            }
        )
        executors = executors_pp.build_pp_executors(bap, dataverse)

        # 1 — the environment is bound to the governance group.
        bind = executors["pp_env_security_group"](
            {"target_id": "e-coe", "principal_id": "g-agent-author"}, False
        )
        # 2 — the group team holds the role that carries `prvCreatebot`.
        role = executors["pp_dataverse_role"](
            {
                "target_id": "e-coe",
                "environment_url": ENV_URL,
                "principal_id": "team-agent-author",
                "principal_type": "Team",
                "role": "Agent Author",
            },
            False,
        )

        assert bind["ok"] is True
        assert role["ok"] is True
        # Nothing touched a licence assignment or Managed Environments.
        all_urls = " ".join(c[1] for c in bap.calls + dataverse.calls)
        assert "governanceConfiguration" not in all_urls
        assert "assignLicense" not in all_urls
