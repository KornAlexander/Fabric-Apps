"""M-PP shaping (PLAN.md §12.2, §8.5, §8.6).

Two flags in here carry most of the product's Power Platform value, and both are
documented Microsoft constraints rather than opinions:

  * ``is_customizable = false`` for predefined Dataverse roles — **Environment
    Maker cannot be edited**. The screenshot that started this project showed
    exactly that banner. A governance tool that lets someone plan around editing
    it is worse than useless.
  * ``security_group_assignable = false`` for Default and Developer environments
    — *"Security groups can't be assigned to default and developer environment
    types."* Combined with `Basic User` + `Environment Maker` being auto-assigned
    in Default (and surviving the opt-out), this is the one hole the tool cannot
    close, only contain.
"""

from __future__ import annotations

from typing import Any

try:
    from .shape_common import as_json, as_str
except ImportError:  # pragma: no cover - notebook path
    from shape_common import as_json, as_str  # type: ignore


#: Predefined Dataverse roles. Microsoft: "You can't edit these roles."
PREDEFINED_ROLES = {
    "Environment Maker",
    "Basic User",
    "System Administrator",
    "System Customizer",
    "Delegate",
    "Environment Admin",
    "Service Reader",
    "Support User",
    "SharePoint custom form maker",
}

#: Environment types that cannot be bound to an Entra security group.
NO_SECURITY_GROUP_TYPES = {"Default", "Developer"}

#: Dataverse tables whose privileges gate agent authoring in Copilot Studio.
AGENT_AUTHORING_TABLES = {"bot", "botcomponent", "conversationtranscript"}


def empty_environments_warning(payload: dict[str, Any]) -> str | None:
    """Return a warning when the admin API reports *no* environments at all.

    Every tenant has at least a Default environment, so an empty list almost
    always means the caller was never registered with
    ``New-PowerAppManagementApp`` (§17.2 A2) — the API answers **200 with an
    empty list**, not 403, so nothing else distinguishes "not allowed to see
    them" from "there are none".

    Recording that as a clean `0 found` would let the Can-Do Explorer answer
    *"nobody can do this in Power Platform"* from an unknown, which is the one
    inference this product must never make (D41).
    """
    if payload.get("value") or []:
        return None
    return (
        "the Power Platform admin API returned 200 with zero environments — "
        "every tenant has at least a Default environment, so this most likely "
        "means the management app was never registered "
        "(New-PowerAppManagementApp). Treating M-PP as under-reporting rather "
        "than reporting an empty tenant."
    )


def shape_environments(payload: dict[str, Any]) -> list[dict]:
    """`GET .../scopes/admin/environments?$expand=properties`."""
    rows: list[dict] = []
    for env in payload.get("value", []) or []:
        props = env.get("properties") or {}
        env_type = as_str((props.get("environmentSku") or props.get("environmentType")))
        governance = props.get("governanceConfiguration") or {}
        protection = as_str(governance.get("protectionLevel"))
        security_group_id = as_str(
            (props.get("linkedEnvironmentMetadata") or {}).get("securityGroupId")
            or props.get("securityGroupId")
        )
        assignable = env_type not in NO_SECURITY_GROUP_TYPES

        rows.append(
            {
                "environment_id": as_str(env.get("name") or env.get("id")),
                "environment_name": as_str(props.get("displayName")),
                "environment_type": env_type,
                "region": as_str(props.get("azureRegion") or props.get("location")),
                "has_dataverse": as_str(bool(props.get("linkedEnvironmentMetadata"))),
                "security_group_id": security_group_id,
                # The governance-critical pair: is a security group *possible*
                # here, and is one actually bound?
                "security_group_assignable": as_str(assignable),
                "security_group_bound": as_str(bool(security_group_id)),
                "is_managed_env": as_str(bool(protection and protection != "Basic")),
                "protection_level": protection,
                "environment_group_id": as_str(props.get("parentEnvironmentGroup", {}).get("id"))
                if isinstance(props.get("parentEnvironmentGroup"), dict)
                else None,
                "created_by": as_str((props.get("createdBy") or {}).get("displayName")),
                "created_at": as_str(props.get("createdTime")),
            }
        )
    return rows


def shape_roles(environment_id: str, payload: dict[str, Any]) -> list[dict]:
    """Dataverse `roles` for one environment."""
    rows: list[dict] = []
    for role in payload.get("value", []) or []:
        name = as_str(role.get("name")) or ""
        rows.append(
            {
                "environment_id": as_str(environment_id),
                "role_id": as_str(role.get("roleid")),
                "role_name": name,
                "is_predefined": as_str(name in PREDEFINED_ROLES),
                # Predefined roles cannot be edited. This is the flag the app
                # uses to refuse to plan a change that Microsoft will reject.
                "is_customizable": as_str(name not in PREDEFINED_ROLES),
                "business_unit_id": as_str(
                    (role.get("_businessunitid_value") or role.get("businessunitid"))
                ),
            }
        )
    return rows


#: Dataverse privilege depth, least → most reach.
DEPTH_BY_CODE = {0: "None", 1: "User", 2: "BusinessUnit", 4: "Parent", 8: "Organization"}

_PRIVILEGE_PREFIXES = (
    ("prvCreate", "Create"),
    ("prvRead", "Read"),
    ("prvWrite", "Write"),
    ("prvDelete", "Delete"),
    ("prvAppendTo", "AppendTo"),
    ("prvAppend", "Append"),
    ("prvAssign", "Assign"),
    ("prvShare", "Share"),
)


def parse_privilege_name(name: str) -> tuple[str | None, str | None]:
    """`prvCreatebot` → (`Create`, `bot`).

    Order matters: `prvAppendTo` must be tested before `prvAppend`, or every
    AppendTo privilege is mis-parsed as an Append on a table called `To…`.
    """
    for prefix, verb in _PRIVILEGE_PREFIXES:
        if name.startswith(prefix):
            return verb, name[len(prefix) :] or None
    return None, None


def shape_role_privileges(
    environment_id: str, role_id: str, payload: dict[str, Any]
) -> list[dict]:
    """Table privileges held by one role, filtered to what governs creation."""
    rows: list[dict] = []
    for privilege in payload.get("value", []) or []:
        raw_name = str(privilege.get("name") or "")
        verb, table = parse_privilege_name(raw_name)
        if not verb or not table:
            continue
        depth_code = privilege.get("depth")
        rows.append(
            {
                "environment_id": as_str(environment_id),
                "role_id": as_str(role_id),
                "privilege_name": raw_name,
                "table_logical_name": table,
                "privilege": verb,
                "depth": DEPTH_BY_CODE.get(depth_code, as_str(depth_code)),
                # The agent-authoring flag: `Create` on `bot` is the supported
                # lever for "who may build a Copilot Studio agent here".
                "gates_agent_authoring": as_str(
                    table in AGENT_AUTHORING_TABLES and verb in {"Create", "Write"}
                ),
            }
        )
    return rows


def shape_role_assignments(environment_id: str, payload: dict[str, Any]) -> list[dict]:
    """`systemuserroles` / `teamroles` → who holds which role.

    Group *teams* are the preferred assignment target: they let an entitlement
    compile onto an Entra group instead of a person.
    """
    rows: list[dict] = []
    for assignment in payload.get("value", []) or []:
        team_type = assignment.get("teamtype")
        is_team = assignment.get("principal_kind") == "Team" or team_type is not None
        rows.append(
            {
                "environment_id": as_str(environment_id),
                "principal_id": as_str(
                    assignment.get("systemuserid") or assignment.get("teamid")
                ),
                "principal_type": "Team" if is_team else "User",
                "principal_name": as_str(
                    assignment.get("fullname")
                    or assignment.get("name")
                    or assignment.get("domainname")
                ),
                "team_type": as_str(assignment.get("teamtype_label") or team_type),
                "azure_group_id": as_str(assignment.get("azureactivedirectoryobjectid")),
                "role_id": as_str(assignment.get("roleid")),
                "role_name": as_str(assignment.get("role_name")),
            }
        )
    return rows


def shape_resources(
    environment_id: str, resource_type: str, payload: dict[str, Any]
) -> list[dict]:
    """Canvas apps / flows / agents in one environment."""
    rows: list[dict] = []
    for resource in payload.get("value", []) or []:
        owner = (
            resource.get("owner")
            or resource.get("createdby")
            or resource.get("_ownerid_value")
        )
        owner_name = owner.get("displayName") if isinstance(owner, dict) else as_str(owner)
        rows.append(
            {
                "environment_id": as_str(environment_id),
                "resource_type": resource_type,
                "resource_id": as_str(
                    resource.get("name") or resource.get("botid") or resource.get("id")
                ),
                "resource_name": as_str(
                    resource.get("displayName")
                    or resource.get("name")
                    or resource.get("schemaname")
                ),
                "owner_name": as_str(owner_name),
                "created_at": as_str(
                    resource.get("createdTime") or resource.get("createdon")
                ),
                "state": as_str(resource.get("statecode") or resource.get("state")),
                "is_orphaned": as_str(not owner_name),
            }
        )
    return rows


def shape_dlp(payload: dict[str, Any]) -> list[dict]:
    """Data (DLP) policies and the environments they cover.

    No licence prerequisite and no Managed Environments requirement — this is
    the primary licence-free lever, especially for the Default environment.
    """
    rows: list[dict] = []
    for policy in payload.get("value", []) or []:
        environments = (policy.get("environments") or {}).get("environments") or []
        env_ids = [as_str(e.get("name") or e.get("id")) for e in environments] or [None]
        default_group = as_str(policy.get("defaultConnectorClassification"))
        groups = policy.get("connectorGroups") or []
        # A custom-connector URL pattern rule is one of the six licence-free
        # levers for hardening the Default environment, so it gets its own flag
        # rather than being buried in the JSON blob.
        blocks_custom = any(
            (g.get("classification") == "Blocked")
            and (g.get("connectors") or g.get("customConnectorUrlPatternsDefinition"))
            for g in groups
            if isinstance(g, dict)
        )
        for env_id in env_ids:
            rows.append(
                {
                    "policy_id": as_str(policy.get("name") or policy.get("policyName")),
                    "policy_name": as_str(policy.get("displayName")),
                    "environment_id": env_id,
                    "scope": as_str(policy.get("environmentType")),
                    "default_connector_group": default_group,
                    "blocks_new_connectors_by_default": as_str(
                        default_group == "Blocked"
                    ),
                    "blocks_custom_connector_urls": as_str(blocks_custom),
                    "connector_groups_json": as_json(groups),
                }
            )
    return rows


#: Tenant-level Power Platform settings the Default-environment posture scores
#: against. Keys are the paths inside the BAP `listtenantsettings` response.
POSTURE_SETTINGS = {
    "disableShareWithEveryone": ("powerPlatform", "powerApps", "disableShareWithEveryone"),
    "disableEnvironmentCreationByNonAdminUsers": (
        "powerPlatform",
        "governance",
        "disableEnvironmentCreationByNonAdminUsers",
    ),
    "disableTrialEnvironmentCreationByNonAdminUsers": (
        "powerPlatform",
        "governance",
        "disableTrialEnvironmentCreationByNonAdminUsers",
    ),
    "disableDeveloperEnvironmentCreationByNonAdminUsers": (
        "powerPlatform",
        "governance",
        "disableDeveloperEnvironmentCreationByNonAdminUsers",
    ),
    "disableCapacityAllocationByEnvironmentAdmins": (
        "powerPlatform",
        "governance",
        "disableCapacityAllocationByEnvironmentAdmins",
    ),
}


def _dig(payload: dict[str, Any], path: tuple[str, ...]) -> Any:
    node: Any = payload
    for key in path:
        if not isinstance(node, dict):
            return None
        node = node.get(key)
    return node


def shape_pp_tenant_settings(payload: dict[str, Any]) -> list[dict]:
    """`POST .../listtenantsettings` → one row per governance-relevant setting.

    Flattened rather than stored as a blob so the posture page can score against
    named settings without re-parsing nested JSON in the browser.
    """
    rows: list[dict] = []
    for name, path in POSTURE_SETTINGS.items():
        value = _dig(payload, path)
        rows.append(
            {
                "setting_name": name,
                "value": as_str(value),
                "is_set": as_str(value is not None),
                "source": "TenantSettings",
                # Same key set as the isolation row below: Spark infers one
                # schema for the whole table, and a row with a missing key is
                # how that inference silently drops a column.
                "detail_json": None,
            }
        )
    return rows


def shape_tenant_isolation(payload: dict[str, Any]) -> list[dict]:
    """`Get-PowerAppTenantIsolationPolicy` → a single posture row.

    Cross-tenant isolation is one of the six licence-free Default-environment
    levers, and it is tenant-wide rather than per-environment — hence its own
    row in the same table instead of a column somewhere.
    """
    properties = payload.get("properties") or payload
    enabled = properties.get("isDisabled")
    # The API expresses this as `isDisabled`, which is easy to invert by
    # accident. Normalise once, here, where it is tested.
    is_enabled = None if enabled is None else (not bool(enabled))
    rules = properties.get("allowedTenants") or []
    return [
        {
            "setting_name": "tenantIsolation",
            "value": as_str(is_enabled),
            "is_set": as_str(enabled is not None),
            "source": "TenantIsolation",
            "detail_json": as_json(rules),
        }
    ]

