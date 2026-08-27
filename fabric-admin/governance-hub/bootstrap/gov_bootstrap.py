"""Gov Bootstrap — provisions a Governance Hub deployment from zero.

Percent-cell source for the Fabric notebook. Build with:
    python bootstrap/build_ipynb.py bootstrap/gov_bootstrap.py

PLAN.md §8.4 (a), §8.3, §12.

Design rules this notebook must never break:
  * **Idempotent.** Re-running is a no-op. Every step reports
    Created | Already present | Skipped (no permission) | Failed.
  * **Dry run first.** `dry_run=True` is the default, so the destructive path is
    always opt-in.
  * **No secrets.** Nothing here reads or writes a credential. Service-principal
    secrets live in the customer's Key Vault and are only touched by actuator
    notebooks in later phases.
  * **Self-hosted.** Every id comes from a parameter. No tenant is hard-coded.
"""

# %% [markdown]
# # Gov Bootstrap
#
# Provisions the Governance Hub storage layer in **this** workspace:
#
# 1. `governance_lh` lakehouse
# 2. the `gov_*` Delta tables (Phase 1 subset)
# 3. the `gov_schema_migrations` ledger row for this schema version
#
# Everything is **idempotent** and defaults to a **dry run**.
#
# The semantic model, collector schedules and per-module tables arrive in
# Tracks B and C — this notebook is written so those steps slot in as
# additional migrations rather than a rewrite.

# %% tags=["parameters"]
# Fabric injects these as notebook parameters.
dry_run = True
lakehouse_name = "governance_lh"
workspace_id = ""  # empty → the workspace this notebook runs in
actor = "bootstrap"

# %%
import json
import traceback
from datetime import datetime, timezone

SCHEMA_VERSION = 2
MIGRATION_ID = "0002_module_tables"

steps = []


def record(step, status, detail=""):
    """Every step reports one of four outcomes — never a silent success."""
    steps.append({"step": step, "status": status, "detail": detail})
    print(f"[{status:>16}] {step}{(' — ' + detail) if detail else ''}")


def utcnow():
    return datetime.now(timezone.utc)


print(f"dry_run={dry_run} lakehouse={lakehouse_name} version={SCHEMA_VERSION}")

# %% [markdown]
# ## Table definitions
#
# Only the Core tables ship in Phase 1. Each `gov_actual_*` table is owned by
# exactly one module and is created by that module's collector in Track B, so a
# deployment with a module switched off simply never materialises its tables —
# and every query must tolerate that.

# %%
# (table name, [(column, type)]) — Delta, all string ids so the app never has to
# care about a plane's native id format.
CORE_TABLES = [
    (
        "gov_config",
        [
            ("config_key", "string"),
            ("config_value", "string"),
            ("note", "string"),
            ("user_editable", "boolean"),
            ("updated_by", "string"),
            ("updated_at", "timestamp"),
        ],
    ),
    (
        "gov_schema_migrations",
        [
            ("version", "int"),
            ("migration_id", "string"),
            ("status", "string"),
            ("notes", "string"),
            ("error", "string"),
            ("applied_by", "string"),
            ("applied_at", "timestamp"),
        ],
    ),
    (
        "gov_runs",
        [
            ("run_id", "string"),
            ("collector", "string"),
            ("module", "string"),
            ("tier", "string"),
            ("started_at", "timestamp"),
            ("finished_at", "timestamp"),
            ("n_objects", "int"),
            ("n_errors", "int"),
            ("error_json", "string"),
            ("duration_s", "double"),
        ],
    ),
    (
        "gov_audit",
        [
            ("audit_id", "string"),
            ("ts", "timestamp"),
            ("actor", "string"),
            ("actor_type", "string"),
            ("action", "string"),
            ("plane", "string"),
            ("target_type", "string"),
            ("target_id", "string"),
            ("before_json", "string"),
            ("after_json", "string"),
            ("request_id", "string"),
            ("correlation_id", "string"),
            ("outcome", "string"),
            ("error", "string"),
        ],
    ),
    (
        "gov_dry_runs",
        [
            ("binding_kind", "string"),
            ("scope_id", "string"),
            ("succeeded_at", "timestamp"),
            ("actor", "string"),
            ("correlation_id", "string"),
        ],
    ),
]

record("plan tables", "Planned", ", ".join(name for name, _ in CORE_TABLES))

# %% [markdown]
# ## Module tables (schema v2)
#
# Each `gov_actual_*` table is owned by **exactly one module**. A deployment
# with a module switched off simply never populates its tables — the tables are
# still created so the semantic model has a stable shape, and every query must
# tolerate an empty one.
#
# All columns are strings on purpose: every plane has its own id format, and
# coercing them into typed columns is how a join silently starts returning
# nothing. `run_id` + `scanned_at` carry provenance on every row.

# %%
def actual(*columns):
    """Standard `gov_actual_*` shape: string columns + run provenance."""
    return [(c, "string") for c in columns] + [
        ("run_id", "string"),
        ("scanned_at", "timestamp"),
    ]


MODULE_TABLES = {
    "fabric": [
        (
            "gov_actual_tenant_settings",
            actual(
                "setting_name", "title", "setting_group", "enabled", "scope",
                "can_specify_security_groups", "delegate_to_capacity",
                "delegate_to_domain", "delegate_to_workspace",
                "enabled_groups_json", "excluded_groups_json", "properties_json",
            ),
        ),
        (
            "gov_actual_capacity_overrides",
            actual("capacity_id", "setting_name", "enabled", "enabled_groups_json"),
        ),
        (
            "gov_actual_workspaces",
            actual(
                "workspace_id", "workspace_name", "workspace_type", "capacity_id",
                "state", "description",
            ),
        ),
        (
            "gov_actual_workspace_roles",
            actual(
                "workspace_id", "principal_id", "principal_type", "principal_name", "role"
            ),
        ),
        (
            "gov_actual_items",
            actual(
                "item_id", "item_type", "item_name", "workspace_id", "workspace_name",
                "description", "is_tenant_gated",
            ),
        ),
        (
            "gov_actual_orgapps",
            actual("app_id", "app_name", "kind", "workspace_id", "workspace_name"),
        ),
        (
            "gov_actual_orgapp_audiences",
            actual(
                "audience_id", "audience_name", "app_id", "workspace_id",
                # No public API exists for audience membership — these two
                # columns exist so the app can never imply it knows.
                "membership_source", "membership_known",
            ),
        ),
    ],
    "entra": [
        (
            "gov_actual_entra_groups",
            actual(
                "group_id", "display_name", "mail", "group_type", "security_enabled",
                "is_app_managed", "description",
            ),
        ),
        (
            "gov_actual_entra_group_members",
            actual(
                "group_id", "principal_id", "principal_type", "principal_name",
                "is_transitive", "depth",
            ),
        ),
        (
            "gov_actual_licenses",
            actual(
                "principal_id", "principal_name", "sku_id", "sku_name",
                "assigned_via", "group_id", "disabled_plans_json",
            ),
        ),
    ],
    "pp": [
        (
            "gov_actual_pp_environments",
            actual(
                "environment_id", "environment_name", "environment_type", "region",
                "has_dataverse", "security_group_id",
                # Documented: Default and Developer environments cannot take one.
                "security_group_assignable", "security_group_bound",
                "is_managed_env", "protection_level", "environment_group_id",
                "created_by", "created_at",
            ),
        ),
        (
            "gov_actual_pp_roles",
            actual(
                "environment_id", "role_id", "role_name", "is_predefined",
                # Environment Maker is not editable. This flag stops the app
                # planning a change Microsoft will reject.
                "is_customizable", "business_unit_id",
            ),
        ),
        (
            "gov_actual_pp_role_privileges",
            actual(
                "environment_id", "role_id", "privilege_name", "table_logical_name",
                "privilege", "depth", "gates_agent_authoring",
            ),
        ),
        (
            "gov_actual_pp_role_assignments",
            actual(
                "environment_id", "principal_id", "principal_type", "principal_name",
                "team_type", "azure_group_id", "role_id", "role_name",
            ),
        ),
        (
            "gov_actual_pp_resources",
            actual(
                "environment_id", "resource_type", "resource_id", "resource_name",
                "owner_name", "created_at", "state", "is_orphaned",
            ),
        ),
        (
            "gov_actual_pp_dlp",
            actual(
                "policy_id", "policy_name", "environment_id", "scope",
                "default_connector_group", "blocks_new_connectors_by_default",
                "blocks_custom_connector_urls", "connector_groups_json",
            ),
        ),
        (
            "gov_actual_pp_tenant_settings",
            actual("setting_name", "value", "is_set", "source", "detail_json"),
        ),
    ],
    "agent": [
        (
            "gov_actual_agents",
            actual(
                "agent_id", "name", "platform", "source", "state",
                "owner_principal", "sponsor_principal", "blueprint_id",
                "agent_identity_id", "environment_id", "risk_flags_json",
                "created_at", "sources_json", "is_shadow", "is_ownerless",
            ),
        ),
        (
            "gov_actual_agent_blueprints",
            actual(
                "blueprint_id", "display_name", "is_multitenant",
                "sponsor_principal", "granted_permissions_json", "is_app_managed",
            ),
        ),
    ],
}

ALL_TABLES = list(CORE_TABLES)
for module_id, tables in MODULE_TABLES.items():
    ALL_TABLES.extend(tables)
    record(f"plan tables [{module_id}]", "Planned", ", ".join(n for n, _ in tables))

# %% [markdown]
# ## Lakehouse
#
# Attached lakehouses are resolved via `notebookutils`. When the lakehouse is
# missing and this is a dry run we only report the intent.
#
# Everything below addresses the lakehouse by its **explicit OneLake path**, not
# by the Spark catalog name. A bootstrap that *creates* the lakehouse can never
# have it attached to its own session, so `governance_lh.<table>` does not
# resolve — see D39.

# %%
lakehouse_ready = False
lakehouse_id = ""
tables_root = ""
try:
    import notebookutils  # type: ignore

    ws = workspace_id or notebookutils.runtime.context.get("currentWorkspaceId", "")

    def _lakehouse_ids():
        return {lh["displayName"]: lh["id"] for lh in notebookutils.lakehouse.list(ws)}

    lakehouse_id = _lakehouse_ids().get(lakehouse_name, "")
    if lakehouse_id:
        record("lakehouse", "Already present", lakehouse_name)
    elif dry_run:
        record("lakehouse", "Planned", f"would create {lakehouse_name} in {ws}")
    else:
        created = notebookutils.lakehouse.create(lakehouse_name, workspaceId=ws)
        lakehouse_id = (created or {}).get("id") or _lakehouse_ids().get(lakehouse_name, "")
        record("lakehouse", "Created", lakehouse_name)

    if lakehouse_id:
        tables_root = (
            f"abfss://{ws}@onelake.dfs.fabric.microsoft.com/{lakehouse_id}/Tables"
        )
        lakehouse_ready = True
    elif not dry_run:
        record("lakehouse", "Failed", "could not resolve the lakehouse id")
except ImportError:
    record("lakehouse", "Skipped (no permission)", "notebookutils unavailable")
except Exception as exc:  # noqa: BLE001 — a bootstrap must never hard-fail
    record("lakehouse", "Failed", f"{type(exc).__name__}: {exc}")

# %% [markdown]
# ## Tables
#
# Writing an empty Delta table with `mode("ignore")` is the whole idempotency
# story here: if the path already holds a table the write is a no-op. A second
# run must change nothing, which is exactly what the Phase-1 exit criterion
# checks. Fabric discovers any folder under `Tables/` as a table, so the SQL
# endpoint and Direct Lake still see them under the plain lakehouse name.

# %%
SPARK_TYPES = {
    "string": "StringType",
    "boolean": "BooleanType",
    "int": "IntegerType",
    "double": "DoubleType",
    "timestamp": "TimestampType",
}

TABLE_COLUMNS = dict(ALL_TABLES)


def table_path(name):
    return f"{tables_root}/{name}"


def spark_schema(columns):
    """Build a StructType without importing pyspark at module import time."""
    from pyspark.sql import types as T  # noqa: N812

    return T.StructType(
        [T.StructField(c, getattr(T, SPARK_TYPES[t])(), True) for c, t in columns]
    )


def empty_table(columns, path):
    (
        spark.createDataFrame([], spark_schema(columns))  # noqa: F821
        .write.format("delta")
        .mode("ignore")
        .save(path)
    )


for table_name, columns in ALL_TABLES:
    if dry_run:
        record(
            f"table {table_name}",
            "Planned",
            f"{table_name} ({len(columns)} columns) → Tables/{table_name}",
        )
        continue
    if not lakehouse_ready:
        record(f"table {table_name}", "Skipped (no permission)", "lakehouse not ready")
        continue
    try:
        empty_table(columns, table_path(table_name))
        record(f"table {table_name}", "Created")
    except Exception as exc:  # noqa: BLE001
        record(f"table {table_name}", "Failed", f"{type(exc).__name__}: {exc}")

# %% [markdown]
# ## Seed configuration
#
# Shipped defaults are deliberately inert: writes off, no binding kinds armed,
# an empty scope allow-list. A fresh install must be **incapable** of changing
# anything until a human deliberately arms it (PLAN.md §19).

# %%
SEED_CONFIG = [
    ("modules.enabled", json.dumps(["fabric", "pp", "agent", "entra"]), True),
    ("writes.enabled", json.dumps(False), True),
    ("writes.kinds", json.dumps([]), True),
    ("writes.scopeAllowlist", json.dumps([]), True),
    ("locale.default", json.dumps("en"), True),
    ("approvers.emails", json.dumps([]), True),
    # Not a setting a deployment can turn on. Present so that "we send nothing"
    # is auditable rather than merely asserted.
    ("telemetry.enabled", json.dumps(False), False),
]

for key, value, editable in SEED_CONFIG:
    if dry_run:
        record(f"config {key}", "Planned", value)
        continue
    if not lakehouse_ready:
        record(f"config {key}", "Skipped (no permission)", "lakehouse not ready")
        continue
    try:
        path = table_path("gov_config")
        already = (
            spark.read.format("delta")  # noqa: F821
            .load(path)
            .where(f"config_key = '{key}'")
            .limit(1)
            .count()
        )
        if already:
            record(f"config {key}", "Already present")
            continue
        row = [(key, value, None, editable, actor, utcnow())]
        (
            spark.createDataFrame(row, spark_schema(TABLE_COLUMNS["gov_config"]))  # noqa: F821
            .write.format("delta")
            .mode("append")
            .save(path)
        )
        record(f"config {key}", "Created")
    except Exception as exc:  # noqa: BLE001
        record(f"config {key}", "Failed", f"{type(exc).__name__}: {exc}")

# %% [markdown]
# ## Migration ledger
#
# Reusable IP without an upgrade path orphans every customer on the next
# release, so the ledger is written from the very first version.

# %%
if dry_run:
    record("migration", "Planned", f"{MIGRATION_ID} → v{SCHEMA_VERSION}")
elif lakehouse_ready:
    try:
        path = table_path("gov_schema_migrations")
        already = (
            spark.read.format("delta")  # noqa: F821
            .load(path)
            .where(f"migration_id = '{MIGRATION_ID}'")
            .limit(1)
            .count()
        )
        if already:
            record("migration", "Already present", MIGRATION_ID)
        else:
            row = [
                (
                    SCHEMA_VERSION,
                    MIGRATION_ID,
                    "Applied",
                    "Core + per-module gov_actual_* tables",
                    None,
                    actor,
                    utcnow(),
                )
            ]
            (
                spark.createDataFrame(  # noqa: F821
                    row, spark_schema(TABLE_COLUMNS["gov_schema_migrations"])
                )
                .write.format("delta")
                .mode("append")
                .save(path)
            )
            record("migration", "Created", MIGRATION_ID)
    except Exception as exc:  # noqa: BLE001
        record("migration", "Failed", f"{type(exc).__name__}: {exc}")
else:
    record("migration", "Skipped (no permission)", "lakehouse not ready")

# %% [markdown]
# ## Result
#
# The exit value is the actuator contract from PLAN.md §14 — the app parses it
# and shows it verbatim on the Setup page.

# %%
counts = {}
for s in steps:
    counts[s["status"]] = counts.get(s["status"], 0) + 1

result = {
    "ok": counts.get("Failed", 0) == 0,
    "dry_run": dry_run,
    "schema_version": SCHEMA_VERSION,
    "migration_id": MIGRATION_ID,
    "counts": counts,
    "steps": steps,
    "finished_at": utcnow().isoformat(),
}

# %% [markdown]
# ## Fail loudly
#
# A scheduler or REST caller sees **only** the job status, never the exit value,
# so a run whose every table failed must not report `Completed` (D39). This has
# to happen *before* `notebookutils.notebook.exit`, which ends the notebook.
# The raised message carries the first failures, so the failure reason on the
# job instance is diagnostic on its own.

# %%
if not result["ok"]:
    failed = [s for s in steps if s["status"] == "Failed"]
    raise RuntimeError(
        f"{len(failed)} step(s) failed: "
        + "; ".join(f"{s['step']} — {s['detail']}" for s in failed[:5])
    )

# %%
try:
    import notebookutils  # type: ignore

    notebookutils.notebook.exit(json.dumps(result))
except ImportError:
    print(json.dumps(result, indent=2))
except Exception:  # noqa: BLE001
    traceback.print_exc()
    print(json.dumps(result, indent=2))
