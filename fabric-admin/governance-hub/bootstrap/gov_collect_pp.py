"""Gov Collect PowerPlatform — M-PP server-side collector (PLAN.md §15, Phase 3P).

Percent-cell source. Build with `python bootstrap/build_ipynb.py`.

Writes: gov_actual_pp_environments, gov_actual_pp_roles,
gov_actual_pp_role_privileges, gov_actual_pp_role_assignments,
gov_actual_pp_resources, gov_actual_pp_dlp, plus a gov_runs row.

**Licence position (verified, PLAN.md §8.5).** This collector needs **zero**
premium licences and does **not** require Managed Environments. It authenticates
as a service principal registered as a Power Platform management app, and reads
Dataverse through an **unlicensed application user** — which is also why it can
reach every environment: application users bypass environment security groups.
"""

# %% [markdown]
# # Gov Collect Power Platform
#
# Two flags in this notebook carry most of the product's Power Platform value,
# and both are documented Microsoft constraints, not opinions:
#
# * `is_customizable = false` on predefined roles — **Environment Maker cannot
#   be edited**. Planning around editing it is planning to fail.
# * `security_group_assignable = false` on Default and Developer environments —
#   security groups *cannot* be bound there. Combined with `Basic User` +
#   `Environment Maker` being auto-assigned in Default and surviving the opt-out,
#   this is the one hole the tool can only contain, never close.
#
# ⚠️ **A service principal cannot register itself** as a management app. A human
# Power Platform Administrator must run `New-PowerAppManagementApp` once. Until
# then this notebook fails at the first call, by design — a silent empty result
# would look like "no environments", which is a dangerous lie.

# %% tags=["parameters"]
dry_run = True
lakehouse_name = "governance_lh"
key_vault_uri = ""       # e.g. https://<your-key-vault>.vault.azure.net/
sp_client_id_secret = "gov-pp-client-id"
sp_secret_secret = "gov-pp-secret"
tenant_id = ""
# Dataverse resources are one request set per environment; cap for a first run.
max_environments = 0

# %%
#@include collectors/shape_common.py

# %%
#@include collectors/runtime.py

# %%
#@include collectors/shape_pp.py

# %%
import json
import urllib.parse
import urllib.request

steps = []


def log(step, status, detail=""):
    steps.append({"step": step, "status": status, "detail": detail})
    print(f"[{status:>22}] {step}{(' — ' + detail) if detail else ''}")


ledger = RunLedger("Gov Collect PowerPlatform", "pp", "T1")
print(f"run_id={ledger.run_id} dry_run={dry_run}")


def _secret(name):
    """Read a secret from the customer's Key Vault.

    The FULL vault URI is required — the short name fails with
    'Invalid vault uri' (learned in the Data Catalog build).
    """
    import notebookutils  # type: ignore

    return notebookutils.credentials.getSecret(key_vault_uri, name)


def sp_token(resource):
    """Client-credentials token for a service principal.

    The secret is read inside this notebook and never leaves it. It is never in
    the SPA bundle, which Fabric static hosting serves anonymously.
    """
    body = urllib.parse.urlencode(
        {
            "grant_type": "client_credentials",
            "client_id": _secret(sp_client_id_secret),
            "client_secret": _secret(sp_secret_secret),
            "scope": f"{resource}/.default",
        }
    ).encode()
    request = urllib.request.Request(
        f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token",
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(request) as response:  # noqa: S310 - fixed host
        return json.loads(response.read().decode())["access_token"]


def api_get(token, url):
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(request) as response:  # noqa: S310
        return json.loads(response.read().decode())


BAP = "https://api.bap.microsoft.com"
BAP_VERSION = "api-version=2020-10-01"

# %% [markdown]
# ## Environments

# %%
env_rows = []
raw_envs = []
try:
    bap_token = sp_token("https://service.powerapps.com")
    payload = api_get(
        bap_token,
        f"{BAP}/providers/Microsoft.BusinessAppPlatform/scopes/admin/environments"
        f"?$expand=properties&{BAP_VERSION}",
    )
    raw_envs = payload.get("value", []) or []
    env_rows = shape_environments(payload)
    ledger.count("gov_actual_pp_environments", len(env_rows))
    empty_warning = empty_environments_warning(payload)
    if empty_warning:
        ledger.error("environments", empty_warning)
        log("environments", "Unknown", "0 returned — recorded as under-reporting")
    else:
        log("environments", "Created", f"{len(env_rows)} found")
except Exception as exc:  # noqa: BLE001
    ledger.error("environments", exc)
    log("environments", "Failed", f"{type(exc).__name__}: {exc}")

if max_environments and len(raw_envs) > max_environments:
    raw_envs = raw_envs[:max_environments]
    ledger.error("environments", f"capped at {max_environments}")

# %% [markdown]
# ## Dataverse: roles, privileges, assignments, resources
#
# Only environments that actually have a Dataverse database have security roles.
# Everything below is read through the **unlicensed application user**.

# %%
role_rows = []
privilege_rows = []
assignment_rows = []
resource_rows = []

by_id = {r["environment_id"]: r for r in env_rows}

for env in raw_envs:
    env_id = env.get("name") or env.get("id")
    shaped = by_id.get(env_id, {})
    if shaped.get("has_dataverse") != "true":
        continue
    instance_url = (
        ((env.get("properties") or {}).get("linkedEnvironmentMetadata") or {})
        .get("instanceApiUrl")
    )
    if not instance_url:
        ledger.error(f"dataverse:{env_id}", "no instanceApiUrl")
        continue

    try:
        dv_token = sp_token(instance_url)
        api = f"{instance_url}/api/data/v9.2"

        roles_payload = api_get(dv_token, f"{api}/roles?$select=roleid,name")
        env_roles = shape_roles(env_id, roles_payload)
        role_rows.extend(env_roles)

        # Privileges only for roles that could gate agent authoring or that we
        # manage; pulling every privilege of every role is a very large read.
        for role in env_roles:
            if role["is_customizable"] != "true" and role["role_name"] != "Environment Maker":
                continue
            try:
                privileges = api_get(
                    dv_token,
                    f"{api}/roles({role['role_id']})/roleprivileges_association"
                    "?$select=name,privilegeid",
                )
                privilege_rows.extend(
                    shape_role_privileges(env_id, role["role_id"], privileges)
                )
            except Exception as exc:  # noqa: BLE001
                ledger.error(f"privileges:{env_id}:{role['role_name']}", exc)

        for entity, kind in (("systemusers", "User"), ("teams", "Team")):
            try:
                payload = api_get(dv_token, f"{api}/{entity}?$top=5000")
                for row in payload.get("value", []) or []:
                    row["principal_kind"] = kind
                assignment_rows.extend(shape_role_assignments(env_id, payload))
            except Exception as exc:  # noqa: BLE001
                ledger.error(f"assignments:{env_id}:{entity}", exc)

        for entity, resource_type in (
            ("bots", "Agent"),
            ("workflows", "Flow"),
            ("canvasapps", "CanvasApp"),
        ):
            try:
                payload = api_get(dv_token, f"{api}/{entity}?$top=5000")
                resource_rows.extend(shape_resources(env_id, resource_type, payload))
            except Exception as exc:  # noqa: BLE001
                ledger.error(f"resources:{env_id}:{entity}", exc)

    except Exception as exc:  # noqa: BLE001
        ledger.error(f"dataverse:{shaped.get('environment_name') or env_id}", exc)

ledger.count("gov_actual_pp_roles", len(role_rows))
ledger.count("gov_actual_pp_role_privileges", len(privilege_rows))
ledger.count("gov_actual_pp_role_assignments", len(assignment_rows))
ledger.count("gov_actual_pp_resources", len(resource_rows))
log("dataverse", "Created", f"{len(role_rows)} roles, {len(resource_rows)} resources")

# %% [markdown]
# ## Data policies
#
# No licence prerequisite and no Managed Environments requirement — the primary
# licence-free lever, especially for the Default environment.

# %%
dlp_rows = []
try:
    payload = api_get(
        bap_token,
        f"{BAP}/providers/PowerPlatform.Governance/v1/policies?{BAP_VERSION}",
    )
    dlp_rows = shape_dlp(payload)
    ledger.count("gov_actual_pp_dlp", len(dlp_rows))
    log("data policies", "Created", f"{len(dlp_rows)} policy/environment rows")
except Exception as exc:  # noqa: BLE001
    ledger.error("dlp", exc)
    log("data policies", "Skipped (no permission)", str(exc))

# %% [markdown]
# ## Tenant settings and tenant isolation
#
# These are the remaining licence-free levers the Default-environment posture
# scores against. Default cannot be bound to a security group, so this is what
# containment actually looks like there.

# %%
posture_rows = []
try:
    payload = api_get(
        bap_token,
        f"{BAP}/providers/Microsoft.BusinessAppPlatform/listtenantsettings?{BAP_VERSION}",
    )
    posture_rows.extend(shape_pp_tenant_settings(payload))
except Exception as exc:  # noqa: BLE001
    ledger.error("ppTenantSettings", exc)

try:
    payload = api_get(
        bap_token,
        f"{BAP}/providers/Microsoft.BusinessAppPlatform/scopes/admin/"
        f"tenantIsolationPolicy?{BAP_VERSION}",
    )
    posture_rows.extend(shape_tenant_isolation(payload))
except Exception as exc:  # noqa: BLE001
    ledger.error("tenantIsolation", exc)

ledger.count("gov_actual_pp_tenant_settings", len(posture_rows))
log("tenant settings", "Created", f"{len(posture_rows)} posture rows")

# %% [markdown]
# ## Write

# %%
TABLES = [
    ("gov_actual_pp_environments", env_rows),
    ("gov_actual_pp_roles", role_rows),
    ("gov_actual_pp_role_privileges", privilege_rows),
    ("gov_actual_pp_role_assignments", assignment_rows),
    ("gov_actual_pp_resources", resource_rows),
    ("gov_actual_pp_dlp", dlp_rows),
    ("gov_actual_pp_tenant_settings", posture_rows),
]

for table, rows in TABLES:
    write_table(
        spark,  # noqa: F821
        lakehouse_name,
        table,
        stamp(rows, ledger.run_id),
        dry_run=dry_run,
        log=log,
    )

finish(ledger, spark, lakehouse_name, dry_run=dry_run)  # noqa: F821
