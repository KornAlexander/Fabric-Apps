"""Gov Collect Agents — M-AGENT server-side collector (PLAN.md §7, §15, Phase 3A).

Percent-cell source. Build with `python bootstrap/build_ipynb.py`.

Writes: gov_actual_agents, gov_actual_agent_blueprints, plus a gov_runs row.
"""

# %% [markdown]
# # Gov Collect Agents
#
# Three sources, one table, in precedence order:
#
# 1. **Agent 365 registry** — widest view, but **preview**, needs AI
#    Administrator, and does not show draft agents outside Copilot Studio.
# 2. **Entra Agent ID** — identities, blueprints, and the mandatory human sponsor.
# 3. **Dataverse `bot` table** — the Copilot Studio truth including drafts, and
#    the **licence-free fallback** when the tenant has no Agent 365 entitlement.
#
# The merge is where the value is: an agent seen *only* by the tenant-wide
# registry and by none of the sources we govern is a **shadow agent**, and an
# agent with neither owner nor sponsor is `is_ownerless`. Both are Critical
# findings, and neither is discoverable from a single source.
#
# **Agent 365 does not gate creation.** Everything here is post-hoc inventory;
# the only preventive, class-level lever is the blueprint, which arrives as an
# actuator in a later phase.

# %% tags=["parameters"]
dry_run = True
lakehouse_name = "governance_lh"
# When false, skip the registry entirely — the documented degraded path for a
# tenant without an Agent 365 licence.
use_agent365_registry = True

# %%
#@include collectors/shape_common.py

# %%
#@include collectors/runtime.py

# %%
#@include collectors/shape_agent.py

# %%
steps = []


def log(step, status, detail=""):
    steps.append({"step": step, "status": status, "detail": detail})
    print(f"[{status:>22}] {step}{(' — ' + detail) if detail else ''}")


ledger = RunLedger("Gov Collect Agents", "agent", "T1")
token = graph_token()
print(f"run_id={ledger.run_id} dry_run={dry_run} registry={use_agent365_registry}")

registry_rows = []
identity_rows = []
blueprint_rows = []
dataverse_rows = []

# %% [markdown]
# ## Source 1 — Agent 365 registry (preview)
#
# Read-only by design: Graph exposes list and get only. Block / Unblock /
# Delete / Reassign are UI-only, so those become 🟡 tasks, never writes.

# %%
if use_agent365_registry:
    try:
        payload = graph_get(
            token, "/beta/admin/microsoft365Copilot/packages?$top=999"
        )
        registry_rows = shape_registry_agents(payload)
        ledger.count("registry", len(registry_rows))
        log("agent 365 registry", "Created", f"{len(registry_rows)} agents")
    except Exception as exc:  # noqa: BLE001
        # Not fatal: the whole point of the merge is that we degrade to the
        # sources that need no Agent 365 licence.
        ledger.error("registry", exc)
        log("agent 365 registry", "Skipped (no permission)", str(exc))
else:
    log("agent 365 registry", "Skipped (no permission)", "disabled by parameter")

# %% [markdown]
# ## Source 2 — Entra Agent ID

# %%
try:
    payload = graph_get(
        token,
        "/beta/servicePrincipals?$filter=servicePrincipalType eq 'AgentIdentity'"
        "&$top=999&$select=id,displayName,accountEnabled,createdDateTime",
    )
    identity_rows = shape_agent_identities(payload)
    ledger.count("identities", len(identity_rows))
    log("entra agent id", "Created", f"{len(identity_rows)} identities")
except Exception as exc:  # noqa: BLE001
    ledger.error("agentIdentities", exc)
    log("entra agent id", "Skipped (no permission)", str(exc))

try:
    payload = graph_get(
        token,
        "/beta/applications?$top=999&$select=id,displayName,signInAudience,requiredResourceAccess",
    )
    blueprint_rows = shape_blueprints(payload)
    ledger.count("gov_actual_agent_blueprints", len(blueprint_rows))
    log("blueprints", "Created", f"{len(blueprint_rows)} blueprints")
except Exception as exc:  # noqa: BLE001
    ledger.error("blueprints", exc)

# %% [markdown]
# ## Source 3 — Dataverse `bot` table
#
# Read from what the Power Platform collector already wrote, so this notebook
# needs no Dataverse credentials of its own. It is also the only source that
# distinguishes a **draft** agent.

# %%
try:
    bots = spark.sql(  # noqa: F821
        f"SELECT environment_id, resource_id, resource_name, owner_name, created_at, state "
        f"FROM {lakehouse_name}.gov_actual_pp_resources WHERE resource_type = 'Agent'"
    ).collect()
    dataverse_rows = [
        {
            "agent_id": row["resource_id"],
            "name": row["resource_name"],
            "platform": "CopilotStudio",
            "source": "Dataverse",
            "state": row["state"] or "Draft",
            "owner_principal": row["owner_name"],
            "sponsor_principal": None,
            "blueprint_id": None,
            "agent_identity_id": None,
            "environment_id": row["environment_id"],
            "risk_flags_json": None,
            "created_at": row["created_at"],
        }
        for row in bots
    ]
    ledger.count("dataverse", len(dataverse_rows))
    log("dataverse bots", "Created", f"{len(dataverse_rows)} agents")
except Exception as exc:  # noqa: BLE001
    # Expected when the Power Platform collector has not run yet.
    ledger.error("dataverseBots", exc)
    log("dataverse bots", "Skipped (no permission)", str(exc))

# %% [markdown]
# ## Merge

# %%
agent_rows = merge_agents(registry_rows, identity_rows, dataverse_rows)
ledger.counts.pop("registry", None)
ledger.counts.pop("identities", None)
ledger.counts.pop("dataverse", None)
ledger.count("gov_actual_agents", len(agent_rows))

shadow = sum(1 for r in agent_rows if r.get("is_shadow") == "true")
ownerless = sum(1 for r in agent_rows if r.get("is_ownerless") == "true")
log(
    "merge",
    "Created",
    f"{len(agent_rows)} agents · {shadow} shadow · {ownerless} ownerless",
)

# %% [markdown]
# ## Write

# %%
TABLES = [
    ("gov_actual_agents", agent_rows),
    ("gov_actual_agent_blueprints", blueprint_rows),
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
