"""M-FABRIC shaping (PLAN.md §12.2, §15).

Turns Fabric / Power BI admin REST responses into `gov_actual_*` rows.

The governance-critical part is **not** the crawl, it is what each row asserts:
a tenant setting that is enabled org-wide is a very different finding from one
scoped to a security group, and that distinction has to survive into the table.
"""

from __future__ import annotations

from typing import Any

try:  # inlined into the notebook, where the module lives in the same cell
    from .shape_common import as_json, as_str
except ImportError:  # pragma: no cover - notebook path
    from shape_common import as_json, as_str  # type: ignore


def shape_tenant_settings(payload: dict[str, Any]) -> list[dict]:
    """`GET /v1/admin/tenantsettings` → one row per setting.

    `scope` is the field a policy rule actually keys on:
      * `Everyone`        — enabled with no security-group restriction
      * `SecurityGroups`  — enabled for named groups only
      * `Excluded`        — enabled for everyone *except* named groups
      * `Disabled`        — off
    Microsoft is explicit that tenant settings are *not* a security boundary, so
    these rows are guardrail evidence, always paired with a detective rule.
    """
    rows: list[dict] = []
    for setting in payload.get("tenantSettings", []) or []:
        enabled = bool(setting.get("enabled"))
        included = setting.get("enabledSecurityGroups") or []
        excluded = setting.get("excludedSecurityGroups") or []

        if not enabled:
            scope = "Disabled"
        elif included:
            scope = "SecurityGroups"
        elif excluded:
            scope = "Excluded"
        else:
            scope = "Everyone"

        rows.append(
            {
                "setting_name": as_str(setting.get("settingName")),
                "title": as_str(setting.get("title")),
                "setting_group": as_str(setting.get("tenantSettingGroup")),
                "enabled": as_str(enabled),
                "scope": scope,
                "can_specify_security_groups": as_str(
                    setting.get("canSpecifySecurityGroups")
                ),
                "delegate_to_capacity": as_str(setting.get("delegateToCapacity")),
                "delegate_to_domain": as_str(setting.get("delegateToDomain")),
                "delegate_to_workspace": as_str(setting.get("delegateToWorkspace")),
                "enabled_groups_json": as_json(included),
                "excluded_groups_json": as_json(excluded),
                "properties_json": as_json(setting.get("properties")),
            }
        )
    return rows


def shape_capacity_overrides(payload: dict[str, Any]) -> list[dict]:
    """`GET /v1/admin/capacities/delegatedTenantSettingOverrides` → per-capacity rows."""
    rows: list[dict] = []
    for override in payload.get("value", []) or []:
        capacity_id = as_str(override.get("id"))
        for setting in override.get("tenantSettings", []) or []:
            rows.append(
                {
                    "capacity_id": capacity_id,
                    "setting_name": as_str(setting.get("settingName")),
                    "enabled": as_str(setting.get("enabled")),
                    "enabled_groups_json": as_json(
                        setting.get("enabledSecurityGroups") or []
                    ),
                }
            )
    return rows


def shape_workspaces(payload: dict[str, Any]) -> list[dict]:
    """Admin (`workspaces`) or user-scoped (`value`) workspace list."""
    source = payload.get("workspaces")
    if source is None:
        source = payload.get("value") or []
    rows: list[dict] = []
    for ws in source:
        rows.append(
            {
                "workspace_id": as_str(ws.get("id")),
                "workspace_name": as_str(ws.get("displayName") or ws.get("name")),
                "workspace_type": as_str(ws.get("type")),
                "capacity_id": as_str(ws.get("capacityId")),
                "state": as_str(ws.get("state")),
                "description": as_str(ws.get("description")),
            }
        )
    return rows


def shape_workspace_roles(workspace_id: str, payload: dict[str, Any]) -> list[dict]:
    """`GET /v1/workspaces/{id}/roleAssignments`.

    `principal_type` matters as much as the role: a *group* holding Contributor
    is an entitlement that can be compiled onto; a *user* holding it directly is
    almost always drift.
    """
    rows: list[dict] = []
    for assignment in payload.get("value", []) or []:
        principal = assignment.get("principal") or {}
        rows.append(
            {
                "workspace_id": as_str(workspace_id),
                "principal_id": as_str(principal.get("id")),
                "principal_type": as_str(principal.get("type")),
                "principal_name": as_str(principal.get("displayName")),
                "role": as_str(assignment.get("role")),
            }
        )
    return rows


#: Item types that carry their own tenant-level creation switch. Everything else
#: is governed only by the workspace role, which is exactly the "no per-item-type
#: role" gap the product exists to make visible.
TENANT_GATED_ITEM_TYPES = {
    "OrgApp",
    "FabricApp",
    "Ontology",
    "DigitalTwinBuilder",
    "Plan",
    "DeploymentPlan",
}


def shape_items(workspace: dict[str, Any], payload: dict[str, Any]) -> list[dict]:
    rows: list[dict] = []
    workspace_id = as_str(workspace.get("id"))
    workspace_name = as_str(workspace.get("displayName") or workspace.get("name"))
    for item in payload.get("value", []) or []:
        item_type = as_str(item.get("type"))
        rows.append(
            {
                "item_id": as_str(item.get("id")),
                "item_type": item_type,
                "item_name": as_str(item.get("displayName")),
                "workspace_id": workspace_id,
                "workspace_name": workspace_name,
                "description": as_str(item.get("description")),
                "is_tenant_gated": as_str(item_type in TENANT_GATED_ITEM_TYPES),
            }
        )
    return rows


def shape_org_apps(items_rows: list[dict]) -> list[dict]:
    """Org apps, projected out of the item inventory."""
    return [
        {
            "app_id": row["item_id"],
            "app_name": row["item_name"],
            "kind": "Fabric",
            "workspace_id": row["workspace_id"],
            "workspace_name": row["workspace_name"],
        }
        for row in items_rows
        if row.get("item_type") == "OrgApp"
    ]


def shape_orgapp_audiences(app: dict[str, Any], definition: dict[str, Any]) -> list[dict]:
    """`OrgAppAudience` children of an org app.

    The audience *objects* are API-manageable; **who is in an audience is not**
    — there is no documented public API for audience membership. So every row is
    stamped `membership_source='Portal-manual'` and `membership_known='false'`,
    and the app must never imply it knows who can see an org app.
    """
    rows: list[dict] = []
    for child in definition.get("parts", []) or []:
        path = str(child.get("path", ""))
        if not path.endswith(".OrgAppAudience"):
            continue
        rows.append(
            {
                "audience_id": as_str(child.get("id") or path),
                "audience_name": as_str(path.rsplit("/", 1)[-1].replace(".OrgAppAudience", "")),
                "app_id": as_str(app.get("app_id")),
                "workspace_id": as_str(app.get("workspace_id")),
                "membership_source": "Portal-manual",
                "membership_known": "false",
            }
        )
    return rows
