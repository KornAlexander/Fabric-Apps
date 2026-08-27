"""Offline tests for the collector shaping layer (PLAN.md §18).

No tenant, no Spark, no network. Every assertion here is about a governance
claim the rest of the product depends on — not about JSON plumbing.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from collectors import shape_agent, shape_entra, shape_fabric, shape_pp  # noqa: E402
from collectors.shape_common import RunLedger, as_json, as_str, safe_each, stamp  # noqa: E402


# ── shared primitives ────────────────────────────────────────────────────────


class TestCommon:
    def test_as_str_preserves_absence(self):
        assert as_str(None) is None
        assert as_str("") == ""
        assert as_str(0) == "0"
        assert as_str(False) == "false"

    def test_as_json_is_stable(self):
        assert as_json({"b": 1, "a": 2}) == '{"a": 2, "b": 1}'
        assert as_json(None) is None

    def test_stamp_adds_run_provenance(self):
        rows = stamp([{"x": 1}], "run-1")
        assert rows[0]["run_id"] == "run-1"
        assert rows[0]["scanned_at"] is not None

    def test_ledger_records_errors_and_counts(self):
        ledger = RunLedger("fabric", "fabric", "T1")
        ledger.count("gov_actual_items", 3)
        ledger.error("ws-bad", ValueError("nope"))
        summary = ledger.finish()
        assert summary["n_objects"] == 3
        assert summary["n_errors"] == 1
        assert "nope" in summary["error_json"]
        assert summary["duration_s"] >= 0

    def test_safe_each_survives_a_bad_object(self):
        ledger = RunLedger("c", "m", "T1")

        def fn(item):
            if item == "bad":
                raise RuntimeError("boom")
            return [{"id": item}]

        rows = safe_each(["good", "bad", "also-good"], fn, ledger, lambda i: str(i))
        assert [r["id"] for r in rows] == ["good", "also-good"]
        assert len(ledger.errors) == 1
        assert ledger.errors[0]["scope"] == "bad"


# ── M-FABRIC ─────────────────────────────────────────────────────────────────


class TestFabric:
    @pytest.mark.parametrize(
        "setting,expected",
        [
            ({"enabled": False}, "Disabled"),
            ({"enabled": True}, "Everyone"),
            ({"enabled": True, "enabledSecurityGroups": [{"graphId": "g"}]}, "SecurityGroups"),
            ({"enabled": True, "excludedSecurityGroups": [{"graphId": "g"}]}, "Excluded"),
        ],
    )
    def test_tenant_setting_scope_is_the_governance_fact(self, setting, expected):
        # "Enabled" alone says nothing; *who it is enabled for* is the finding.
        rows = shape_fabric.shape_tenant_settings(
            {"tenantSettings": [{"settingName": "CreateWorkspaces", **setting}]}
        )
        assert rows[0]["scope"] == expected

    def test_tenant_settings_keep_delegation_flags(self):
        rows = shape_fabric.shape_tenant_settings(
            {
                "tenantSettings": [
                    {
                        "settingName": "S",
                        "enabled": True,
                        "delegateToCapacity": True,
                        "delegateToWorkspace": False,
                    }
                ]
            }
        )
        assert rows[0]["delegate_to_capacity"] == "true"
        assert rows[0]["delegate_to_workspace"] == "false"

    def test_capacity_overrides_flatten_per_setting(self):
        rows = shape_fabric.shape_capacity_overrides(
            {
                "value": [
                    {
                        "id": "cap-1",
                        "tenantSettings": [
                            {"settingName": "A", "enabled": True},
                            {"settingName": "B", "enabled": False},
                        ],
                    }
                ]
            }
        )
        assert len(rows) == 2
        assert {r["capacity_id"] for r in rows} == {"cap-1"}

    def test_workspaces_accept_admin_and_user_shapes(self):
        admin = shape_fabric.shape_workspaces({"workspaces": [{"id": "w", "displayName": "W"}]})
        user = shape_fabric.shape_workspaces({"value": [{"id": "w", "displayName": "W"}]})
        assert admin == user
        assert admin[0]["workspace_id"] == "w"

    def test_role_assignments_keep_principal_type(self):
        rows = shape_fabric.shape_workspace_roles(
            "ws-1",
            {
                "value": [
                    {
                        "principal": {"id": "g1", "type": "Group", "displayName": "GOV-X"},
                        "role": "Contributor",
                    }
                ]
            },
        )
        # A group holding Contributor is an entitlement; a user holding it
        # directly is usually drift. The distinction must survive.
        assert rows[0]["principal_type"] == "Group"
        assert rows[0]["role"] == "Contributor"

    def test_items_flag_tenant_gated_types(self):
        rows = shape_fabric.shape_items(
            {"id": "ws-1", "displayName": "W"},
            {
                "value": [
                    {"id": "i1", "type": "Report", "displayName": "R"},
                    {"id": "i2", "type": "OrgApp", "displayName": "A"},
                ]
            },
        )
        gated = {r["item_type"]: r["is_tenant_gated"] for r in rows}
        # Reports have no per-item-type gate — that is the documented gap.
        assert gated["Report"] == "false"
        assert gated["OrgApp"] == "true"

    def test_org_apps_are_projected_from_items(self):
        items = shape_fabric.shape_items(
            {"id": "ws-1", "displayName": "W"},
            {"value": [{"id": "a1", "type": "OrgApp", "displayName": "App"}]},
        )
        apps = shape_fabric.shape_org_apps(items)
        assert len(apps) == 1
        assert apps[0]["kind"] == "Fabric"

    def test_audiences_never_claim_to_know_membership(self):
        rows = shape_fabric.shape_orgapp_audiences(
            {"app_id": "a1", "workspace_id": "ws-1"},
            {"parts": [{"path": "audiences/Finance.OrgAppAudience"}, {"path": "definition.json"}]},
        )
        assert len(rows) == 1
        # There is no public API for audience membership. Saying otherwise
        # anywhere in the pipeline would be a lie the UI then repeats.
        assert rows[0]["membership_known"] == "false"
        assert rows[0]["membership_source"] == "Portal-manual"


# ── M-ENTRA ──────────────────────────────────────────────────────────────────


class TestEntra:
    def test_groups_flag_app_managed_by_convention(self):
        rows = shape_entra.shape_groups(
            {
                "value": [
                    {"id": "1", "displayName": "GOV-FAB-WS-Finance-Contributor"},
                    {"id": "2", "displayName": "All Employees", "groupTypes": ["Unified"]},
                ]
            }
        )
        assert rows[0]["is_app_managed"] == "true"
        assert rows[1]["is_app_managed"] == "false"
        assert rows[1]["group_type"] == "Microsoft365"

    def test_members_classify_principal_type(self):
        rows = shape_entra.shape_group_members(
            "g1",
            {
                "value": [
                    {"id": "u1", "@odata.type": "#microsoft.graph.user"},
                    {"id": "g2", "@odata.type": "#microsoft.graph.group"},
                    {"id": "s1", "@odata.type": "#microsoft.graph.servicePrincipal"},
                ]
            },
        )
        assert [r["principal_type"] for r in rows] == ["User", "Group", "ServicePrincipal"]

    def test_transitive_resolution_finds_nested_members(self):
        # parent → child → grandchild(user). The user is three hops from the
        # group an entitlement would be written against.
        direct = {
            "parent": [{"principal_id": "child", "principal_type": "Group", "principal_name": "C"}],
            "child": [
                {"principal_id": "grand", "principal_type": "Group", "principal_name": "G"}
            ],
            "grand": [{"principal_id": "user-1", "principal_type": "User", "principal_name": "U"}],
        }
        rows = shape_entra.resolve_transitive_members(direct)
        parent_rows = {r["principal_id"]: r for r in rows if r["group_id"] == "parent"}
        assert "user-1" in parent_rows
        assert parent_rows["user-1"]["is_transitive"] == "true"
        assert parent_rows["user-1"]["depth"] == "2"
        assert parent_rows["child"]["is_transitive"] == "false"

    def test_transitive_resolution_survives_a_cycle(self):
        direct = {
            "a": [{"principal_id": "b", "principal_type": "Group", "principal_name": "B"}],
            "b": [{"principal_id": "a", "principal_type": "Group", "principal_name": "A"}],
        }
        rows = shape_entra.resolve_transitive_members(direct)
        assert {r["principal_id"] for r in rows if r["group_id"] == "a"} == {"b", "a"}

    def test_transitive_resolution_deduplicates_diamonds(self):
        direct = {
            "root": [
                {"principal_id": "l", "principal_type": "Group", "principal_name": "L"},
                {"principal_id": "r", "principal_type": "Group", "principal_name": "R"},
            ],
            "l": [{"principal_id": "u", "principal_type": "User", "principal_name": "U"}],
            "r": [{"principal_id": "u", "principal_type": "User", "principal_name": "U"}],
        }
        rows = [r for r in shape_entra.resolve_transitive_members(direct) if r["group_id"] == "root"]
        assert len([r for r in rows if r["principal_id"] == "u"]) == 1

    def test_licences_distinguish_group_based_assignment(self):
        rows = shape_entra.shape_licenses(
            {
                "value": [
                    {
                        "id": "u1",
                        "userPrincipalName": "a@b.com",
                        "assignedLicenses": [{"skuId": "sku-1"}, {"skuId": "sku-2"}],
                        "licenseAssignmentStates": [
                            {"skuId": "sku-1", "assignedByGroup": "grp-1"},
                            {"skuId": "sku-2"},
                        ],
                    }
                ]
            },
            {"sku-1": "POWER_APPS_PREMIUM"},
        )
        by_sku = {r["sku_id"]: r for r in rows}
        # Only group-based assignment is something an entitlement can compile onto.
        assert by_sku["sku-1"]["assigned_via"] == "Group"
        assert by_sku["sku-1"]["group_id"] == "grp-1"
        assert by_sku["sku-1"]["sku_name"] == "POWER_APPS_PREMIUM"
        assert by_sku["sku-2"]["assigned_via"] == "Direct"

    def test_paging_follows_next_link_and_caps(self):
        pages = {
            "p1": {"value": [1], "@odata.nextLink": "p2"},
            "p2": {"value": [2]},
        }
        seen = list(shape_entra.paged(lambda url: pages[url], "p1"))
        assert len(seen) == 2

        # A self-referential nextLink must not spin forever.
        loop = {"p1": {"value": [1], "@odata.nextLink": "p1"}}
        assert len(list(shape_entra.paged(lambda url: loop[url], "p1", max_pages=3))) == 3


# ── M-PP ─────────────────────────────────────────────────────────────────────


class TestPowerPlatform:
    def test_zero_environments_is_reported_as_unknown_not_as_none(self):
        # The admin API answers 200 + empty list when the management app was
        # never registered, which is indistinguishable from an empty tenant —
        # except that no real tenant has zero environments. Verified against the
        # live demo tenant, which returns exactly this.
        warning = shape_pp.empty_environments_warning({"value": []})
        assert warning is not None
        assert "management app" in warning

    def test_a_populated_tenant_produces_no_warning(self):
        payload = {"value": [{"name": "e1", "properties": {"environmentSku": "Default"}}]}
        assert shape_pp.empty_environments_warning(payload) is None

    def test_default_environment_cannot_take_a_security_group(self):
        rows = shape_pp.shape_environments(
            {
                "value": [
                    {"name": "e1", "properties": {"displayName": "Default", "environmentSku": "Default"}},
                    {"name": "e2", "properties": {"displayName": "Dev", "environmentSku": "Developer"}},
                    {
                        "name": "e3",
                        "properties": {
                            "displayName": "Prod",
                            "environmentSku": "Production",
                            "linkedEnvironmentMetadata": {"securityGroupId": "sg-1"},
                        },
                    },
                ]
            }
        )
        by_id = {r["environment_id"]: r for r in rows}
        # Documented: security groups can't be assigned to Default or Developer.
        assert by_id["e1"]["security_group_assignable"] == "false"
        assert by_id["e2"]["security_group_assignable"] == "false"
        assert by_id["e3"]["security_group_assignable"] == "true"
        assert by_id["e3"]["security_group_bound"] == "true"
        assert by_id["e1"]["security_group_bound"] == "false"

    def test_managed_environment_detection(self):
        rows = shape_pp.shape_environments(
            {
                "value": [
                    {
                        "name": "e1",
                        "properties": {
                            "displayName": "A",
                            "environmentSku": "Production",
                            "governanceConfiguration": {"protectionLevel": "Standard"},
                        },
                    },
                    {
                        "name": "e2",
                        "properties": {
                            "displayName": "B",
                            "environmentSku": "Production",
                            "governanceConfiguration": {"protectionLevel": "Basic"},
                        },
                    },
                ]
            }
        )
        by_id = {r["environment_id"]: r for r in rows}
        assert by_id["e1"]["is_managed_env"] == "true"
        assert by_id["e2"]["is_managed_env"] == "false"

    def test_environment_maker_is_not_customizable(self):
        rows = shape_pp.shape_roles(
            "e1",
            {
                "value": [
                    {"roleid": "r1", "name": "Environment Maker"},
                    {"roleid": "r2", "name": "Agent Author"},
                ]
            },
        )
        by_name = {r["role_name"]: r for r in rows}
        # This is the banner from the screenshot that started the project.
        assert by_name["Environment Maker"]["is_customizable"] == "false"
        assert by_name["Environment Maker"]["is_predefined"] == "true"
        assert by_name["Agent Author"]["is_customizable"] == "true"

    @pytest.mark.parametrize(
        "name,expected",
        [
            ("prvCreatebot", ("Create", "bot")),
            ("prvWritebotcomponent", ("Write", "botcomponent")),
            # AppendTo must win over Append, or the table name is mangled.
            ("prvAppendToaccount", ("AppendTo", "account")),
            ("prvAppendaccount", ("Append", "account")),
            ("somethingElse", (None, None)),
        ],
    )
    def test_privilege_name_parsing(self, name, expected):
        assert shape_pp.parse_privilege_name(name) == expected

    def test_agent_authoring_privileges_are_flagged(self):
        rows = shape_pp.shape_role_privileges(
            "e1",
            "r1",
            {
                "value": [
                    {"name": "prvCreatebot", "depth": 8},
                    {"name": "prvReadbot", "depth": 1},
                    {"name": "prvCreateaccount", "depth": 1},
                    {"name": "notAPrivilege"},
                ]
            },
        )
        by_priv = {(r["table_logical_name"], r["privilege"]): r for r in rows}
        assert len(rows) == 3  # the unparseable one is dropped
        # Create on `bot` is the supported lever for agent authoring.
        assert by_priv[("bot", "Create")]["gates_agent_authoring"] == "true"
        assert by_priv[("bot", "Create")]["depth"] == "Organization"
        assert by_priv[("bot", "Read")]["gates_agent_authoring"] == "false"
        assert by_priv[("account", "Create")]["gates_agent_authoring"] == "false"

    def test_role_assignments_identify_group_teams(self):
        rows = shape_pp.shape_role_assignments(
            "e1",
            {
                "value": [
                    {"systemuserid": "u1", "fullname": "A User", "roleid": "r1"},
                    {
                        "teamid": "t1",
                        "name": "GOV Team",
                        "teamtype": 2,
                        "azureactivedirectoryobjectid": "aad-1",
                        "roleid": "r1",
                    },
                ]
            },
        )
        by_type = {r["principal_type"]: r for r in rows}
        assert by_type["User"]["principal_id"] == "u1"
        # Group teams are the preferred target: they let an entitlement compile
        # onto an Entra group instead of a person.
        assert by_type["Team"]["azure_group_id"] == "aad-1"

    def test_resources_flag_orphans(self):
        rows = shape_pp.shape_resources(
            "e1",
            "CanvasApp",
            {
                "value": [
                    {"name": "a1", "displayName": "App", "owner": {"displayName": "Owner"}},
                    {"name": "a2", "displayName": "Abandoned"},
                ]
            },
        )
        by_id = {r["resource_id"]: r for r in rows}
        assert by_id["a1"]["is_orphaned"] == "false"
        assert by_id["a2"]["is_orphaned"] == "true"

    def test_dlp_flags_blocked_by_default(self):
        rows = shape_pp.shape_dlp(
            {
                "value": [
                    {
                        "name": "p1",
                        "displayName": "Default hardening",
                        "defaultConnectorClassification": "Blocked",
                        "environments": {"environments": [{"name": "e1"}, {"name": "e2"}]},
                    }
                ]
            }
        )
        assert len(rows) == 2
        # Blocked-by-default is the primary licence-free Default-env lever.
        assert all(r["blocks_new_connectors_by_default"] == "true" for r in rows)

    def test_dlp_without_environments_still_produces_a_row(self):
        rows = shape_pp.shape_dlp({"value": [{"name": "p1", "displayName": "Tenant-wide"}]})
        assert len(rows) == 1
        assert rows[0]["environment_id"] is None

    def test_dlp_flags_custom_connector_url_patterns(self):
        rows = shape_pp.shape_dlp(
            {
                "value": [
                    {
                        "name": "p1",
                        "displayName": "With URL rules",
                        "connectorGroups": [
                            {
                                "classification": "Blocked",
                                "customConnectorUrlPatternsDefinition": [
                                    {"rules": [{"pattern": "https://*"}]}
                                ],
                            }
                        ],
                    },
                    {"name": "p2", "displayName": "Without"},
                ]
            }
        )
        by_id = {r["policy_id"]: r for r in rows}
        assert by_id["p1"]["blocks_custom_connector_urls"] == "true"
        assert by_id["p2"]["blocks_custom_connector_urls"] == "false"

    def test_tenant_settings_flatten_and_mark_absence(self):
        rows = shape_pp.shape_pp_tenant_settings(
            {
                "powerPlatform": {
                    "powerApps": {"disableShareWithEveryone": True},
                    "governance": {"disableEnvironmentCreationByNonAdminUsers": False},
                }
            }
        )
        by_name = {r["setting_name"]: r for r in rows}
        assert by_name["disableShareWithEveryone"]["value"] == "true"
        assert by_name["disableShareWithEveryone"]["is_set"] == "true"
        assert by_name["disableEnvironmentCreationByNonAdminUsers"]["value"] == "false"
        # A setting the API did not return is "we did not see it", never "off".
        missing = by_name["disableTrialEnvironmentCreationByNonAdminUsers"]
        assert missing["is_set"] == "false"
        assert missing["value"] is None
        # One schema for the whole table.
        assert all(set(r) == set(rows[0]) for r in rows)

    def test_tenant_isolation_inverts_is_disabled(self):
        on = shape_pp.shape_tenant_isolation(
            {"properties": {"isDisabled": False, "allowedTenants": [{"tenantId": "t1"}]}}
        )[0]
        # The API says `isDisabled`; the column says `tenantIsolation` is on.
        # Getting this backwards would score a wide-open tenant as hardened.
        assert on["value"] == "true"
        assert on["is_set"] == "true"
        assert json.loads(on["detail_json"])[0]["tenantId"] == "t1"

        off = shape_pp.shape_tenant_isolation({"properties": {"isDisabled": True}})[0]
        assert off["value"] == "false"

    def test_tenant_isolation_absent_is_unknown_not_false(self):
        row = shape_pp.shape_tenant_isolation({})[0]
        assert row["is_set"] == "false"
        assert row["value"] is None

    def test_tenant_settings_and_isolation_share_a_schema(self):
        settings = shape_pp.shape_pp_tenant_settings({})
        isolation = shape_pp.shape_tenant_isolation({})
        assert set(settings[0]) == set(isolation[0])


# ── M-AGENT ──────────────────────────────────────────────────────────────────


class TestAgent:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("MCS DA", "CopilotStudio"),
            ("Copilot Studio", "CopilotStudio"),
            ("declarative-agent", "AgentBuilder"),
            ("SharePoint", "SharePoint"),
            ("Microsoft Foundry", "Foundry"),
            ("Databricks Genie", "ThirdParty"),
            ("something-new", "Unknown"),
            (None, "Unknown"),
        ],
    )
    def test_platform_normalisation(self, raw, expected):
        assert shape_agent.normalise_platform(raw) == expected

    def test_dataverse_bots_distinguish_drafts(self):
        rows = shape_agent.shape_dataverse_bots(
            "e1",
            {
                "value": [
                    {"botid": "b1", "name": "Published", "publishedon": "2026-01-01"},
                    {"botid": "b2", "name": "Draft"},
                ]
            },
        )
        by_id = {r["agent_id"]: r for r in rows}
        # Dataverse is the only source that sees drafts.
        assert by_id["b1"]["state"] == "Published"
        assert by_id["b2"]["state"] == "Draft"

    def test_merge_prefers_richer_source_but_never_erases_data(self):
        registry = [
            {
                "agent_id": "a1",
                "agent_identity_id": "id-1",
                "name": "Sales Agent",
                "source": "A365Registry",
                "platform": "CopilotStudio",
                "owner_principal": "user-1",
                "sponsor_principal": None,
            }
        ]
        entra = [
            {
                "agent_id": "sp-1",
                "agent_identity_id": "id-1",
                "name": "Sales Agent",
                "source": "EntraAgentID",
                "platform": "CopilotStudio",
                "owner_principal": None,
                "sponsor_principal": "sponsor-1",
            }
        ]
        merged = shape_agent.merge_agents(registry, entra)
        assert len(merged) == 1
        row = merged[0]
        # Registry outranks Entra, but a sponsor known only to Entra survives.
        assert row["source"] == "A365Registry"
        assert row["sponsor_principal"] == "sponsor-1"
        assert row["owner_principal"] == "user-1"
        assert row["is_ownerless"] == "false"

    def test_shadow_agents_are_those_only_the_registry_saw(self):
        registry = [
            {"agent_id": "known", "agent_identity_id": "id-1", "name": "Known", "source": "A365Registry"},
            {"agent_id": "rogue", "agent_identity_id": "id-2", "name": "Rogue", "source": "A365Registry"},
        ]
        dataverse = [
            {"agent_id": "known-dv", "agent_identity_id": "id-1", "name": "Known", "source": "Dataverse"}
        ]
        merged = {r["name"]: r for r in shape_agent.merge_agents(registry, dataverse)}
        assert merged["Rogue"]["is_shadow"] == "true"
        assert merged["Known"]["is_shadow"] == "false"

    def test_ownerless_agents_are_flagged(self):
        merged = shape_agent.merge_agents(
            [{"agent_id": "a1", "name": "Nobody's", "source": "A365Registry"}]
        )
        # Critical finding: every agent identity requires a human sponsor.
        assert merged[0]["is_ownerless"] == "true"

    def test_merge_falls_back_to_name_when_ids_are_missing(self):
        merged = shape_agent.merge_agents(
            [{"name": "Same", "source": "A365Registry"}],
            [{"name": "Same", "source": "Dataverse"}],
        )
        assert len(merged) == 1
        assert json.loads(merged[0]["sources_json"]) == ["A365Registry", "Dataverse"]
        # Seen by a governed source too, so not shadow.
        assert merged[0]["is_shadow"] == "false"

    def test_blueprints_detect_multitenant_and_app_managed(self):
        rows = shape_agent.shape_blueprints(
            {
                "value": [
                    {"id": "b1", "displayName": "GOV-Agent-Standard", "signInAudience": "AzureADMyOrg"},
                    {"id": "b2", "displayName": "Vendor Blueprint", "signInAudience": "AzureADMultipleOrgs"},
                ]
            }
        )
        by_id = {r["blueprint_id"]: r for r in rows}
        assert by_id["b1"]["is_app_managed"] == "true"
        assert by_id["b1"]["is_multitenant"] == "false"
        assert by_id["b2"]["is_multitenant"] == "true"

    def test_agent_identity_sponsor_is_extracted(self):
        rows = shape_agent.shape_agent_identities(
            {
                "value": [
                    {
                        "id": "id-1",
                        "displayName": "Agent",
                        "sponsors": [{"id": "sponsor-1"}],
                        "agentIdentityBlueprintId": "bp-1",
                        "accountEnabled": True,
                    }
                ]
            }
        )
        assert rows[0]["sponsor_principal"] == "sponsor-1"
        assert rows[0]["blueprint_id"] == "bp-1"
        assert rows[0]["state"] == "Published"
