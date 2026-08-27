"""M-PP executors — the licence-free write set (PLAN.md §8.5, §14, Phase 10).

Five bindings, and the reason they are exactly these five is the product's
licence argument made executable:

| Binding | Needs a premium licence? | Needs Managed Environments? |
|---|---|---|
| `pp_env_security_group` | no | no |
| `pp_dataverse_role` (via **group team**) | no | no |
| `pp_data_policy` | no | no |
| `pp_tenant_isolation` | no | no |
| `pp_tenant_setting` | no | no |

All of it runs as an **unlicensed Dataverse application user** plus an admin
identity that, per Microsoft's own docs, *"can administer without a license"*.
`pp_managed_env` is deliberately **absent** — enabling Managed Environments makes
premium licences a requirement for active usage, so a governance tool must never
switch it on as a side effect of granting somebody access.

Two rules carry most of the risk here:

* **Group team, never a user.** Assigning a Dataverse role directly to a person
  produces access that no group membership explains, so the Can-Do Explorer
  cannot derive it and revoking means finding every individual row. The
  executor refuses a user principal outright.
* **Default and Developer environments cannot be bound to a security group.**
  This is a documented platform constraint, not a permission problem. The
  executor says so instead of failing with an opaque BAP error.
"""

from __future__ import annotations

from typing import Any, Callable

#: `(method, url, body) -> dict`, injected — same contract as the other planes.
HttpCall = Callable[[str, str, dict | None], Any]

BAP = "https://api.bap.microsoft.com/providers/Microsoft.BusinessAppPlatform"
BAP_API_VERSION = "2021-04-01"

#: Environment types where a security group **cannot** be bound. Not a
#: permission problem — there is no supported way to do it (PLAN.md §8.6).
SG_IMPOSSIBLE_TYPES = ("Default", "Developer")

#: Dataverse roles this tool must never assign, whatever it is asked.
DENIED_DATAVERSE_ROLES = ("system administrator", "system customizer")

#: Connector classifications a data policy may use.
DLP_CLASSIFICATIONS = ("General", "Confidential", "Blocked")

VERIFY_AFTER_S = 900
#: Tenant settings propagate slowly enough that a synchronous check is
#: meaningless; the Fabric build learned this the hard way.
TENANT_VERIFY_AFTER_S = 3600


def _need(binding: dict, *keys: str) -> None:
    missing = [k for k in keys if not binding.get(k)]
    if missing:
        raise ValueError(f"binding is missing {', '.join(missing)}")


def pp_env_security_group(http: HttpCall) -> Callable[[dict, bool], dict]:
    """Bind a Power Platform environment to an Entra security group.

    The single highest-leverage preventive control in Power Platform, and it
    costs nothing. Everything else in this module is containment around it.
    """

    def execute(binding: dict, dry_run: bool) -> dict:
        _need(binding, "target_id", "principal_id")
        environment_id = binding["target_id"]
        group_id = binding["principal_id"]
        url = f"{BAP}/scopes/admin/environments/{environment_id}?api-version={BAP_API_VERSION}"

        current = http("GET", url, None) or {}
        properties = current.get("properties") or {}
        environment_type = (
            properties.get("environmentSku")
            or (properties.get("environmentType") or "")
        )
        existing = (
            (properties.get("linkedEnvironmentMetadata") or {}).get("securityGroupId")
            or properties.get("securityGroupId")
            or ""
        )

        if environment_type in SG_IMPOSSIBLE_TYPES:
            # Reported as a refusal with the real reason, not as an API error.
            # "You did not have permission" would send an admin hunting for a
            # role that would not have helped.
            return {
                "ok": False,
                "error": "platform:security-group-not-assignable",
                "detail": (
                    f"{environment_type} environments cannot be bound to a security group; "
                    "contain them with a data policy, tenant isolation and "
                    "disableShareWithEveryone instead"
                ),
                "before": {"security_group_id": existing},
            }

        if existing == group_id:
            return {
                "ok": True,
                "before": {"security_group_id": existing},
                "after": {"security_group_id": group_id},
                "detail": "already_present",
                "verified": True,
            }

        body = {"properties": {"linkedEnvironmentMetadata": {"securityGroupId": group_id}}}
        if dry_run:
            return {
                "ok": True,
                "before": {"security_group_id": existing},
                "after": {"security_group_id": group_id, "planned": True},
                "detail": f"would PATCH {url}",
            }

        http("PATCH", url, body)
        return {
            "ok": True,
            "before": {"security_group_id": existing},
            # Replacing an existing binding locks out the previous group's
            # members, so the audit row must show what was displaced.
            "after": {"security_group_id": group_id, "replaced": bool(existing)},
            "detail": "changed" if existing else "created",
            "verified": False,
            "verify_after_s": VERIFY_AFTER_S,
        }

    return execute


def pp_dataverse_role(http: HttpCall) -> Callable[[dict, bool], dict]:
    """Assign a Dataverse security role to an Entra **group team**.

    This is the binding that grants Copilot Studio agent authoring per
    environment — the one genuinely preventive agent control that exists, since
    agent creation cannot be disabled tenant-wide.

    It targets a *group team*, never a person. A role assigned to an individual
    is access no group membership explains: the Can-Do Explorer cannot derive
    it, and revoking it means hunting down every individual row.
    """

    def execute(binding: dict, dry_run: bool) -> dict:
        _need(binding, "target_id", "principal_id", "role")
        env_url = (binding.get("environment_url") or "").rstrip("/")
        if not env_url:
            raise ValueError("binding is missing environment_url")

        role = binding["role"]
        if role.strip().lower() in DENIED_DATAVERSE_ROLES:
            return {
                "ok": False,
                "error": f"role:{role} is never assignable by this tool",
                "detail": "use a purpose-built role scoped to the tables the persona needs",
            }

        principal_type = (binding.get("principal_type") or "Team").strip()
        if principal_type.lower() not in ("team", "group"):
            return {
                "ok": False,
                "error": "principal:must-be-group-team",
                "detail": (
                    "Dataverse roles are only assigned to Entra group teams here. A role held "
                    "by an individual cannot be derived from any group membership, so it is "
                    "invisible to the entitlement model and hard to revoke."
                ),
            }

        api = f"{env_url}/api/data/v9.2"
        team_id = binding["principal_id"]
        role_id = binding.get("role_id")

        # Resolve the role by name when no id was compiled in. Roles are
        # per-environment, so a name is the portable identifier.
        if not role_id:
            escaped = role.replace("'", "''")
            found = http(
                "GET", f"{api}/roles?$select=roleid,name&$filter=name eq '{escaped}'", None
            )
            candidates = (found or {}).get("value", []) or []
            if not candidates:
                return {
                    "ok": False,
                    "error": "role:not-found",
                    "detail": f'no Dataverse role named "{role}" in this environment',
                }
            role_id = candidates[0].get("roleid")

        existing = http(
            "GET", f"{api}/teams({team_id})/teamroles_association?$select=roleid", None
        )
        held = {r.get("roleid") for r in (existing or {}).get("value", []) or []}
        if role_id in held:
            return {
                "ok": True,
                "before": {"has_role": True},
                "after": {"has_role": True},
                "detail": "already_present",
                "verified": True,
            }

        url = f"{api}/teams({team_id})/teamroles_association/$ref"
        body = {"@odata.id": f"{api}/roles({role_id})"}
        if dry_run:
            return {
                "ok": True,
                "before": {"has_role": False},
                "after": {"has_role": True, "planned": True, "role_id": role_id},
                "detail": f"would POST {url}",
            }

        http("POST", url, body)
        return {
            "ok": True,
            "before": {"has_role": False},
            "after": {"has_role": True, "role_id": role_id},
            "detail": "created",
            "verified": False,
            "verify_after_s": VERIFY_AFTER_S,
        }

    return execute


def pp_tenant_setting(http: HttpCall) -> Callable[[dict, bool], dict]:
    """Flip one governance-relevant tenant setting.

    Read-modify-write against the whole settings blob, because `Set-TenantSettings`
    replaces what it is given: a naive write of `{setting: value}` silently
    resets everything else in that section.
    """

    def execute(binding: dict, dry_run: bool) -> dict:
        _need(binding, "setting_name")
        name = binding["setting_name"]
        value = binding.get("value")
        if value is None:
            raise ValueError("binding is missing value")
        path = binding.get("setting_path") or ["powerPlatform", "governance", name]

        current = http("POST", f"{BAP}/listtenantsettings?api-version={BAP_API_VERSION}", {}) or {}

        node: Any = current
        for key in path[:-1]:
            if not isinstance(node, dict):
                node = {}
                break
            node = node.get(key) or {}
        before = node.get(path[-1]) if isinstance(node, dict) else None

        if before == value:
            return {
                "ok": True,
                "before": {name: before},
                "after": {name: value},
                "detail": "already_present",
                "verified": True,
            }

        # Rebuild the full payload with one leaf changed.
        updated = _set_in(current, path, value)
        url = f"{BAP}/tenantsettings?api-version={BAP_API_VERSION}"
        if dry_run:
            return {
                "ok": True,
                "before": {name: before},
                "after": {name: value, "planned": True},
                "detail": f"would POST {url} ({'.'.join(path)})",
            }

        http("POST", url, updated)
        return {
            "ok": True,
            "before": {name: before},
            "after": {name: value},
            "detail": "changed",
            # Tenant settings take minutes; claiming otherwise is how a
            # governance tool reports a control that is not yet in force.
            "verified": False,
            "verify_after_s": TENANT_VERIFY_AFTER_S,
        }

    return execute


def _set_in(payload: dict, path: list[str], value: Any) -> dict:
    """Copy `payload` with `path` set to `value`, creating intermediate dicts."""
    import copy

    result = copy.deepcopy(payload) if payload else {}
    node = result
    for key in path[:-1]:
        nxt = node.get(key)
        if not isinstance(nxt, dict):
            nxt = {}
            node[key] = nxt
        node = nxt
    node[path[-1]] = value
    return result


def pp_tenant_isolation(http: HttpCall) -> Callable[[dict, bool], dict]:
    """Turn cross-tenant isolation on (or off), with an allow-list.

    One of the six licence-free Default-environment levers. The API expresses
    the state as `isDisabled`, which is trivially easy to invert by accident —
    so the binding speaks in terms of `enabled` and the inversion happens here,
    once, where it is tested.
    """

    def execute(binding: dict, dry_run: bool) -> dict:
        enabled = binding.get("enabled")
        if enabled is None:
            raise ValueError("binding is missing enabled")
        allowed = binding.get("allowed_tenants") or []
        url = f"{BAP}/scopes/admin/tenantIsolationPolicy?api-version={BAP_API_VERSION}"

        current = http("GET", url, None) or {}
        properties = current.get("properties") or {}
        is_disabled = properties.get("isDisabled")
        before_enabled = None if is_disabled is None else (not bool(is_disabled))

        if before_enabled == bool(enabled) and not allowed:
            return {
                "ok": True,
                "before": {"enabled": before_enabled},
                "after": {"enabled": bool(enabled)},
                "detail": "already_present",
                "verified": True,
            }

        body = {
            "properties": {
                "isDisabled": not bool(enabled),
                "allowedTenants": allowed,
            }
        }
        if dry_run:
            return {
                "ok": True,
                "before": {"enabled": before_enabled},
                "after": {"enabled": bool(enabled), "planned": True},
                "detail": f"would PUT {url}",
            }

        http("PUT", url, body)
        return {
            "ok": True,
            "before": {"enabled": before_enabled},
            "after": {"enabled": bool(enabled), "allowed_tenants": len(allowed)},
            "detail": "changed",
            "verified": False,
            "verify_after_s": VERIFY_AFTER_S,
        }

    return execute


def pp_data_policy(http: HttpCall) -> Callable[[dict, bool], dict]:
    """Create or update a data policy — the primary licence-free lever.

    Data policies have **no licence prerequisite** and do not need Managed
    Environments, which is why this is the control the Default-environment
    posture score leans on.
    """

    def execute(binding: dict, dry_run: bool) -> dict:
        _need(binding, "policy_name")
        name = binding["policy_name"]
        default_group = binding.get("default_connector_group") or "Blocked"
        if default_group not in DLP_CLASSIFICATIONS:
            return {
                "ok": False,
                "error": f"classification:{default_group} is not a valid connector group",
                "detail": f"expected one of {', '.join(DLP_CLASSIFICATIONS)}",
            }

        environments = binding.get("environments") or []
        base = f"{BAP}/scopes/admin/v2/policies"
        existing_payload = http("GET", f"{base}?api-version={BAP_API_VERSION}", None) or {}
        existing = None
        for policy in existing_payload.get("value", []) or []:
            if policy.get("displayName") == name:
                existing = policy
                break

        before = (
            {
                "policy_id": existing.get("name"),
                "default_connector_group": existing.get("defaultConnectorClassification"),
            }
            if existing
            else {"policy_id": None}
        )

        if existing and existing.get("defaultConnectorClassification") == default_group:
            return {
                "ok": True,
                "before": before,
                "after": {"default_connector_group": default_group},
                "detail": "already_present",
                "verified": True,
            }

        body = {
            "displayName": name,
            "defaultConnectorClassification": default_group,
            "connectorGroups": binding.get("connector_groups") or [],
            "environmentType": "OnlyEnvironments" if environments else "AllEnvironments",
            "environments": [{"name": e} for e in environments],
        }

        if existing:
            method = "PATCH"
            url = f"{base}/{existing.get('name')}?api-version={BAP_API_VERSION}"
        else:
            method = "POST"
            url = f"{base}?api-version={BAP_API_VERSION}"

        if dry_run:
            return {
                "ok": True,
                "before": before,
                "after": {"default_connector_group": default_group, "planned": True},
                "detail": f"would {method} {url}",
            }

        created = http(method, url, body) or {}
        return {
            "ok": True,
            "before": before,
            "after": {
                "policy_id": created.get("name") or (existing or {}).get("name"),
                "default_connector_group": default_group,
            },
            "detail": "changed" if existing else "created",
            "verified": False,
            "verify_after_s": VERIFY_AFTER_S,
        }

    return execute


def build_pp_executors(
    bap_http: HttpCall | None,
    dataverse_http: HttpCall | None = None,
) -> dict:
    """Register the PP executors whose transport exists.

    `pp_dataverse_role` needs a Dataverse token per environment, which is a
    different credential from the BAP admin one — so it is registered
    separately rather than being assumed to work because BAP does.
    """
    executors: dict[str, Callable[[dict, bool], dict]] = {}
    if bap_http is not None:
        executors["pp_env_security_group"] = pp_env_security_group(bap_http)
        executors["pp_tenant_setting"] = pp_tenant_setting(bap_http)
        executors["pp_tenant_isolation"] = pp_tenant_isolation(bap_http)
        executors["pp_data_policy"] = pp_data_policy(bap_http)
    if dataverse_http is not None:
        executors["pp_dataverse_role"] = pp_dataverse_role(dataverse_http)
    return executors
