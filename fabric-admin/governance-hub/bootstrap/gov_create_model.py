"""Gov Create Model — the Direct Lake semantic model (PLAN.md §12.4, Phase 4).

Percent-cell source. Build with `python bootstrap/build_ipynb.py`.

Creates (or refreshes) the **Governance Model** over `governance_lh` so the app
can read every `gov_*` table through one `executeQueries` endpoint.
"""

# %% [markdown]
# # Gov Create Model
#
# A Direct Lake semantic model over `governance_lh`.
#
# **Two hard-won rules from the Data Catalog build, both load-bearing:**
#
# 1. Use the **SQL-endpoint `DatabaseQuery` expression** with schema `dbo`.
#    Going via OneLake directly hits the `schemaName` gotcha.
# 2. **Freeze the table list at creation.** The idempotent-refresh path does
#    *not* add new tables to an existing model, and regenerating changes the
#    model id — which silently breaks the app's `VITE_GOV_MODEL_ID` wiring.
#    Later tables must be added with TOM `add_table` in a migration, never by
#    regenerating. This notebook therefore refuses to recreate an existing model
#    unless you explicitly ask it to.
#
# The model deliberately includes **every** `gov_*` table, including those of
# disabled modules. They simply stay empty, which keeps the model's shape stable
# across deployments that enable different planes.

# %% tags=["parameters"]
dry_run = True
lakehouse_name = "governance_lh"
model_name = "Governance Model"
workspace_id = ""       # empty → the workspace this notebook runs in
# Guard rail: recreating changes the model id and breaks the app's config.
allow_recreate = False
# Only for a *schema-enabled* lakehouse. Gov Bootstrap creates a plain one
# (tables at `Tables/<name>`), and passing a schema there builds a model whose
# every partition points at a folder that does not exist — it deploys clean and
# then frames nothing. Leave empty unless the lakehouse really has schemas.
lakehouse_schema = ""

# %%
import json
import traceback

steps = []


# %% [markdown]
# ## Dependency
#
# `semantic-link-labs` is not in the stock Fabric runtime, and installing it
# **must happen before anything imports `sempy`** — it upgrades the same
# `semantic-link` package, and pip rewriting a module that is already loaded
# leaves the session broken (D40). So this runs first, before the workspace
# lookup below.

# %%
try:
    import sempy_labs  # type: ignore  # noqa: F401

    _labs_status = ("sempy_labs", "Already present", "")
except ImportError:
    try:
        import subprocess
        import sys

        subprocess.run(
            [sys.executable, "-m", "pip", "install", "-q", "semantic-link-labs"],
            check=True,
        )
        _labs_status = ("sempy_labs", "Created", "installed semantic-link-labs")
    except Exception as exc:  # noqa: BLE001
        _labs_status = ("sempy_labs", "Failed", f"{type(exc).__name__}: {exc}")


def record(step, status, detail=""):
    steps.append({"step": step, "status": status, "detail": detail})
    print(f"[{status:>22}] {step}{(' — ' + detail) if detail else ''}")


record(*_labs_status)


# Must match src/domain/govSchema.ts — a TypeScript test asserts they agree.
CORE_TABLES = ["gov_config", "gov_schema_migrations", "gov_runs", "gov_audit", "gov_dry_runs"]

MODULE_TABLES = {
    "fabric": [
        "gov_actual_tenant_settings",
        "gov_actual_capacity_overrides",
        "gov_actual_workspaces",
        "gov_actual_workspace_roles",
        "gov_actual_items",
        "gov_actual_orgapps",
        "gov_actual_orgapp_audiences",
    ],
    "entra": [
        "gov_actual_entra_groups",
        "gov_actual_entra_group_members",
        "gov_actual_licenses",
    ],
    "pp": [
        "gov_actual_pp_environments",
        "gov_actual_pp_roles",
        "gov_actual_pp_role_privileges",
        "gov_actual_pp_role_assignments",
        "gov_actual_pp_resources",
        "gov_actual_pp_dlp",
        "gov_actual_pp_tenant_settings",
    ],
    "agent": ["gov_actual_agents", "gov_actual_agent_blueprints"],
}

ALL_TABLES = list(CORE_TABLES)
for tables in MODULE_TABLES.values():
    ALL_TABLES.extend(tables)

record("plan", "Planned", f"{len(ALL_TABLES)} tables → '{model_name}'")

# %% [markdown]
# ## Resolve the workspace and check for an existing model

# %%
existing_model_id = None
ws = workspace_id
try:
    import notebookutils  # type: ignore
    import sempy.fabric as fabric  # type: ignore

    ws = workspace_id or notebookutils.runtime.context.get("currentWorkspaceId", "")
    datasets = fabric.list_datasets(workspace=ws)
    match = datasets[datasets["Dataset Name"] == model_name]
    if len(match) > 0:
        existing_model_id = match.iloc[0]["Dataset ID"]
        record("existing model", "Already present", str(existing_model_id))
    else:
        record("existing model", "Planned", "none found — will create")
except ImportError:
    record("existing model", "Skipped (no permission)", "sempy unavailable")
except Exception as exc:  # noqa: BLE001
    record("existing model", "Failed", f"{type(exc).__name__}: {exc}")

# %% [markdown]
# ## Create
#
# Refuses to recreate by default. A new model id means the deployed app stops
# finding its data, and the failure looks like "the collectors are broken".

# %%
result_model_id = existing_model_id

if existing_model_id and not allow_recreate:
    record(
        "create model",
        "Already present",
        "set allow_recreate=True to rebuild — this CHANGES the model id",
    )
elif dry_run:
    record("create model", "Planned", f"{len(ALL_TABLES)} tables over {lakehouse_name}")
else:
    try:
        import sempy_labs as labs  # type: ignore

        # `semantic-link-labs` renamed these arguments (lakehouse/lakehouse_tables
        # → source/tables) and dropped `schema`. A customer runs this notebook in
        # their own tenant against whatever version pip resolves that day, so the
        # call is built from the installed signature rather than pinned to one.
        import inspect

        generate = labs.directlake.generate_direct_lake_semantic_model
        params = inspect.signature(generate).parameters

        if "tables" in params:
            kwargs = {
                "dataset": model_name,
                "tables": ALL_TABLES,
                "source": lakehouse_name,
                "source_workspace": ws,
            }
        else:
            kwargs = {
                "dataset": model_name,
                "lakehouse_tables": ALL_TABLES,
                "lakehouse": lakehouse_name,
                "lakehouse_workspace": ws,
            }
        kwargs["workspace"] = ws
        kwargs["overwrite"] = bool(allow_recreate)
        kwargs["refresh"] = True
        if lakehouse_schema and "schema" in params:
            kwargs["schema"] = lakehouse_schema

        generate(**kwargs)
        record("create model", "Created", model_name)

        import sempy.fabric as fabric  # type: ignore

        datasets = fabric.list_datasets(workspace=ws)
        match = datasets[datasets["Dataset Name"] == model_name]
        if len(match) > 0:
            result_model_id = match.iloc[0]["Dataset ID"]
        else:
            record(
                "create model",
                "Failed",
                "the call returned but no model with that name exists",
            )
    except Exception as exc:  # noqa: BLE001
        record("create model", "Failed", f"{type(exc).__name__}: {exc}")

# %% [markdown]
# ## Result
#
# Copy `model_id` into `VITE_GOV_MODEL_ID` and rebuild the app. The Setup page
# then flips its "Governance lakehouse and semantic model" check to green.

# %%
counts = {}
for s in steps:
    counts[s["status"]] = counts.get(s["status"], 0) + 1

result = {
    "ok": counts.get("Failed", 0) == 0 and bool(dry_run or result_model_id),
    "dry_run": dry_run,
    "model_name": model_name,
    "model_id": str(result_model_id) if result_model_id else None,
    "workspace_id": ws,
    "table_count": len(ALL_TABLES),
    "counts": counts,
    "steps": steps,
    "next": "set VITE_GOV_MODEL_ID to model_id and rebuild the app",
}

# A REST caller or scheduler sees only the job status, never this exit value, so
# a run that produced no model must not report `Completed` (D39).
if not result["ok"]:
    failed = [s for s in steps if s["status"] == "Failed"]
    raise RuntimeError(
        "no semantic model was created: "
        + ("; ".join(f"{s['step']} — {s['detail']}" for s in failed[:5]) or "see steps")
    )

try:
    import notebookutils  # type: ignore

    notebookutils.notebook.exit(json.dumps(result))
except ImportError:
    print(json.dumps(result, indent=2))
except Exception:  # noqa: BLE001
    traceback.print_exc()
    print(json.dumps(result, indent=2))
