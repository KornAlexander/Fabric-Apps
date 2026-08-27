# Fabric notebook source
# Create / refresh the "Data Catalog Model" Direct Lake semantic model over the
# cat_* Delta tables in data_catalog_lh. Attach data_catalog_lh as the DEFAULT
# lakehouse before running. Convert with build_ipynb.py.

# %% [markdown]
# # Create Data Catalog Model (Direct Lake)
#
# Builds the read-path semantic model the Rayfin app queries via executeQueries
# (PLAN.md §6, read path D2). Uses the SQL-endpoint DatabaseQuery expression so
# there is no OneLake schema-name gotcha (all cat_* tables live under `dbo`).

# %% tags=["parameters"]
lakehouse = "data_catalog_lh"
model_name = "Data Catalog Model"

# %%
try:
    import sempy_labs  # noqa: F401
except ImportError:
    import importlib
    import subprocess
    import sys

    subprocess.run(
        [sys.executable, "-m", "pip", "install", "-q", "semantic-link-labs"],
        check=True,
    )
    importlib.invalidate_caches()

# %%
import inspect

import sempy.fabric as fabric
import sempy_labs as labs
from sempy_labs.lakehouse import get_lakehouse_tables

import notebookutils

# Only add tables that actually exist (rls/audience tables are absent when no
# workspace has them). Everything under the cat_ prefix is part of the catalog.
dfLT = get_lakehouse_tables(lakehouse=lakehouse)
cat_tables = sorted(t for t in dfLT["Table Name"].tolist() if t.startswith("cat_"))
print("Catalog tables:", cat_tables)

# Idempotent + stable model id: create the model only if it does not exist yet
# (so the daily flow keeps the same dataset id + app wiring); always refresh so
# the Direct Lake tables are framed against the latest scan.
dfD = fabric.list_datasets(mode="rest")
existing = dfD[dfD["Dataset Name"] == model_name]

if len(existing) == 0:
    gen = labs.directlake.generate_direct_lake_semantic_model
    params = list(inspect.signature(gen).parameters)
    print("generate params:", params)
    # Build a superset of possible kwargs, keep only those this version accepts
    # (the API has drifted: older uses lakehouse/lakehouse_tables, newer uses
    # source/source_type/tables/use_sql_endpoint).
    desired = {
        "dataset": model_name,
        "lakehouse_tables": cat_tables,
        "tables": cat_tables,
        "source": lakehouse,
        "lakehouse": lakehouse,
        "source_type": "Lakehouse",
        "use_sql_endpoint": True,
        "overwrite": True,
        "refresh": False,
    }
    kwargs = {k: v for k, v in desired.items() if k in params}
    print("calling with:", list(kwargs))
    gen(**kwargs)
    print(f"Created '{model_name}' with {len(cat_tables)} tables.")
    dfD = fabric.list_datasets(mode="rest")
    existing = dfD[dfD["Dataset Name"] == model_name]
else:
    print(f"'{model_name}' already exists — refreshing only.")

# Reframe Direct Lake against the latest scan.
try:
    labs.refresh_semantic_model(dataset=model_name)
    print("Refreshed.")
except Exception as exc:  # noqa: BLE001
    print("Refresh warning:", exc)

model_id = existing.iloc[0]["Dataset Id"] if len(existing) else ""
print("Model id:", model_id)

# %%
notebookutils.notebook.exit(model_id)
