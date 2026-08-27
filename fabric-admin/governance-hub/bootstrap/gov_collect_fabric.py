"""Gov Collect Fabric — M-FABRIC server-side collector (PLAN.md §15, Phase 3F).

Percent-cell source. Build with `python bootstrap/build_ipynb.py`.

Writes: gov_actual_tenant_settings, gov_actual_capacity_overrides,
gov_actual_workspaces, gov_actual_workspace_roles, gov_actual_items,
gov_actual_orgapps, gov_actual_orgapp_audiences, plus a gov_runs row.
"""

# %% [markdown]
# # Gov Collect Fabric
#
# Tenant-wide read of the Fabric / Power BI control plane.
#
# **Tier.** Runs at **T1** when the identity holds Fabric Administrator; falls
# back to the workspaces the identity can see and records `tier="T0"` on the run
# row so the app can say the inventory is partial. It never pretends.
#
# **Not a security boundary.** Microsoft is explicit that tenant settings
# "aren't a security measure". These rows are guardrail *evidence*; every
# 🟢 tenant-setting control is paired with a detective policy rule.

# %% tags=["parameters"]
dry_run = True
lakehouse_name = "governance_lh"
# Cap on workspaces expanded into items. 0 = no cap.
max_workspaces = 0

# %%
#@include collectors/shape_common.py

# %%
#@include collectors/runtime.py

# %%
#@include collectors/shape_fabric.py

# %%
steps = []


def log(step, status, detail=""):
    steps.append({"step": step, "status": status, "detail": detail})
    print(f"[{status:>22}] {step}{(' — ' + detail) if detail else ''}")


ledger = RunLedger("Gov Collect Fabric", "fabric", "T1")
client = fabric_client()
print(f"run_id={ledger.run_id} dry_run={dry_run}")

# %% [markdown]
# ## Tenant settings and capacity overrides
#
# The first thing an admin wants to see, and the cheapest to get.

# %%
tenant_setting_rows = []
try:
    payload = rest_get(client, "/v1/admin/tenantsettings")
    tenant_setting_rows = shape_tenant_settings(payload)
    ledger.count("gov_actual_tenant_settings", len(tenant_setting_rows))
except Exception as exc:  # noqa: BLE001
    # Losing admin read is not fatal — it downgrades the whole run to T0.
    ledger.tier = "T0"
    ledger.error("tenantsettings", exc)

capacity_override_rows = []
try:
    payload = rest_get(
        client, "/v1/admin/capacities/delegatedTenantSettingOverrides"
    )
    capacity_override_rows = shape_capacity_overrides(payload)
    ledger.count("gov_actual_capacity_overrides", len(capacity_override_rows))
except Exception as exc:  # noqa: BLE001
    ledger.error("capacityOverrides", exc)

# %% [markdown]
# ## Workspaces
#
# Admin list when we can, own list when we cannot. The `tier` on the run row is
# what tells the app which of the two it is looking at.

# %%
raw_workspaces = []
try:
    payload = rest_get(client, "/v1/admin/workspaces")
    raw_workspaces = payload.get("workspaces", []) or []
except Exception as exc:  # noqa: BLE001
    ledger.tier = "T0"
    ledger.error("adminWorkspaces", exc)
    try:
        payload = rest_get(client, "/v1/workspaces")
        raw_workspaces = payload.get("value", []) or []
    except Exception as inner:  # noqa: BLE001
        ledger.error("workspaces", inner)

workspace_rows = shape_workspaces({"workspaces": raw_workspaces})
ledger.count("gov_actual_workspaces", len(workspace_rows))
log("workspaces", "Created", f"{len(workspace_rows)} found, tier={ledger.tier}")

if max_workspaces and len(raw_workspaces) > max_workspaces:
    raw_workspaces = raw_workspaces[:max_workspaces]
    ledger.error("workspaces", f"capped at {max_workspaces}")

# %% [markdown]
# ## Role assignments and items
#
# One request per workspace, sequential. Parallel bursts against the admin APIs
# are the fastest route to a 429, and a throttled crawl that gives up
# under-reports access — the most dangerous direction to be wrong in.

# %%
role_rows = []
item_rows = []

for ws in raw_workspaces:
    ws_id = ws.get("id")
    if not ws_id:
        continue
    try:
        payload = rest_get(client, f"/v1/workspaces/{ws_id}/roleAssignments")
        role_rows.extend(shape_workspace_roles(ws_id, payload))
    except Exception as exc:  # noqa: BLE001
        ledger.error(f"roles:{ws.get('displayName') or ws_id}", exc)
    try:
        payload = rest_get(client, f"/v1/workspaces/{ws_id}/items")
        item_rows.extend(shape_items(ws, payload))
    except Exception as exc:  # noqa: BLE001
        ledger.error(f"items:{ws.get('displayName') or ws_id}", exc)

ledger.count("gov_actual_workspace_roles", len(role_rows))
ledger.count("gov_actual_items", len(item_rows))
log("roles + items", "Created", f"{len(role_rows)} roles, {len(item_rows)} items")

# %% [markdown]
# ## Org apps and audiences
#
# The audience *objects* are API-manageable. **Who is in an audience is not** —
# there is no documented public API for audience membership, so every audience
# row is stamped `membership_known='false'` and the app must never imply it
# knows who can see an org app.

# %%
org_app_rows = shape_org_apps(item_rows)
audience_rows = []

for app in org_app_rows:
    try:
        payload = rest_get(
            client,
            f"/v1/workspaces/{app['workspace_id']}/items/{app['app_id']}/getDefinition",
        )
        definition = payload.get("definition", payload)
        audience_rows.extend(shape_orgapp_audiences(app, definition))
    except Exception as exc:  # noqa: BLE001
        ledger.error(f"orgapp:{app.get('app_name')}", exc)

ledger.count("gov_actual_orgapps", len(org_app_rows))
ledger.count("gov_actual_orgapp_audiences", len(audience_rows))
log("org apps", "Created", f"{len(org_app_rows)} apps, {len(audience_rows)} audiences")

# %% [markdown]
# ## Write

# %%
TABLES = [
    ("gov_actual_tenant_settings", tenant_setting_rows),
    ("gov_actual_capacity_overrides", capacity_override_rows),
    ("gov_actual_workspaces", workspace_rows),
    ("gov_actual_workspace_roles", role_rows),
    ("gov_actual_items", item_rows),
    ("gov_actual_orgapps", org_app_rows),
    ("gov_actual_orgapp_audiences", audience_rows),
]

for table, rows in TABLES:
    write_table(
        spark,  # noqa: F821 — provided by the Fabric runtime
        lakehouse_name,
        table,
        stamp(rows, ledger.run_id),
        dry_run=dry_run,
        log=log,
    )

finish(ledger, spark, lakehouse_name, dry_run=dry_run)  # noqa: F821
