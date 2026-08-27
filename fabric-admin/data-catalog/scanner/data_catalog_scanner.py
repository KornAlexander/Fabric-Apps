# Fabric notebook source
# Data Catalog Scanner — crawls Power BI reports, semantic models, KPIs and
# current access across every accessible workspace and writes cat_* Delta
# tables into the attached catalog lakehouse (data_catalog_lh).
#
# Percent-cell format (# %%). Convert to .ipynb with scanner/build_ipynb.py.
# Attach data_catalog_lh as the DEFAULT lakehouse before running.

# %% [markdown]
# # Data Catalog Scanner
#
# Two-tier catalog — **scanner tier** (PLAN.md §4). Reuses `semantic-link-labs`.
#
# | Phase | What |
# |---|---|
# | 1 | Single-workspace scan → `cat_*` tables |
# | 2 | All accessible workspaces + folders + `cat_scan_runs` |
# | 2b | Current access: `cat_workspace_access`, `cat_rls_roles`, `cat_app_audiences` |
#
# Set `scan_scope="single"` + `single_workspace` for a Phase-1 smoke test, or
# `scan_scope="all"` for the full crawl. `capture_access` toggles Phase 2b.

# %% tags=["parameters"]
scan_scope = "single"          # "single" | "all"
single_workspace = ""          # workspace name or id (used when scan_scope == "single")
capture_access = True          # Phase 2b — capture current access
max_workspaces = 0             # 0 = no cap; >0 caps the number of workspaces (debug)

# %%
# Install semantic-link-labs (sempy itself is preinstalled in Fabric Runtime).
# NOTE: on the RunNotebook *job* path a standalone `%pip install` cell crashes
# the Spark session (System_Cancelled_Session_Statements_Failed). Install via a
# subprocess inside a try instead so the running session is never restarted.
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
import uuid
import datetime
import traceback

import pandas as pd
import sempy.fabric as fabric
import sempy_labs as labs
from sempy_labs.report import ReportWrapper
from pyspark.sql import SparkSession

spark = SparkSession.builder.getOrCreate()

RUN_ID = str(uuid.uuid4())
SCANNED_AT = datetime.datetime.utcnow().isoformat()
errors: list[dict] = []

fclient = fabric.FabricRestClient()


def log_error(stage: str, target: str, exc: Exception) -> None:
    errors.append({"stage": stage, "target": target, "error": str(exc)})
    print(f"  ! {stage} [{target}]: {exc}")


def _norm(col: str) -> str:
    return (
        str(col).strip().lower().replace(" ", "_").replace("/", "_").replace("-", "_")
    )


def save_delta(df, table: str, mode: str = "overwrite") -> int:
    """Write a pandas frame to a Delta table in the default lakehouse.

    All values are stringified for robustness (mixed dtypes from the various
    INFO/list functions). run_id + scanned_at are stamped on every row. The
    Direct Lake model casts numeric columns downstream.
    """
    if df is None or len(df) == 0:
        print(f"  {table}: 0 rows")
        return 0
    df = df.copy()
    df.columns = [_norm(c) for c in df.columns]
    df["run_id"] = RUN_ID
    df["scanned_at"] = SCANNED_AT
    for c in df.columns:
        df[c] = df[c].apply(
            lambda v: None
            if (v is None or (isinstance(v, float) and pd.isna(v)))
            else str(v)
        )
    sdf = spark.createDataFrame(df)
    (
        sdf.write.format("delta")
        .mode(mode)
        .option("overwriteSchema", "true")
        .saveAsTable(table)
    )
    print(f"  {table}: {len(df)} rows -> {mode}")
    return len(df)


# %%
# ---- Workspace enumeration -------------------------------------------------
def get_workspaces() -> pd.DataFrame:
    dfw = fabric.list_workspaces()
    # Normalise the id / name column names across sempy versions.
    id_col = "Id" if "Id" in dfw.columns else dfw.columns[0]
    name_col = "Name" if "Name" in dfw.columns else dfw.columns[1]
    dfw = dfw.rename(columns={id_col: "Id", name_col: "Name"})
    if scan_scope == "single" and single_workspace:
        dfw = dfw[(dfw["Name"] == single_workspace) | (dfw["Id"] == single_workspace)]
    if max_workspaces and max_workspaces > 0:
        dfw = dfw.head(max_workspaces)
    return dfw.reset_index(drop=True)


def folder_paths(ws_id: str) -> dict:
    """Map each item id -> 'Folder/Subfolder' path for the Topic view."""
    try:
        folders = fclient.get(f"/v1/workspaces/{ws_id}/folders").json().get("value", [])
        name = {f["id"]: f.get("displayName", "") for f in folders}
        parent = {f["id"]: f.get("parentFolderId") for f in folders}

        def path(fid):
            parts, seen = [], set()
            while fid and fid in name and fid not in seen:
                seen.add(fid)
                parts.append(name[fid])
                fid = parent.get(fid)
            return "/".join(reversed(parts))

        items = fclient.get(f"/v1/workspaces/{ws_id}/items").json().get("value", [])
        return {it["id"]: path(it.get("folderId")) for it in items}
    except Exception as exc:  # noqa: BLE001
        log_error("folders", ws_id, exc)
        return {}


# %%
# ---- Accumulators ----------------------------------------------------------
acc = {k: [] for k in (
    "workspaces", "reports", "models", "measures", "columns",
    "relationships", "dependencies", "usage",
    "workspace_access", "rls_roles", "app_audiences",
    "org_apps", "app_access", "entra_groups",
)}


def add(key: str, df, **extra):
    if df is None or len(df) == 0:
        return
    df = df.copy()
    for k, v in extra.items():
        df[k] = v
    acc[key].append(df)


# %%
# ---- Per-dataset scan ------------------------------------------------------
def scan_dataset(ws_id, ws_name, ds_id, ds_name, fmap):
    # Model inventory (KPI decision b + columns)
    try:
        add("measures", fabric.list_measures(dataset=ds_id, workspace=ws_id),
            dataset_id=ds_id, dataset_name=ds_name, workspace_id=ws_id)
    except Exception as exc:  # noqa: BLE001
        log_error("measures", f"{ws_name}/{ds_name}", exc)
    try:
        add("columns", fabric.list_columns(dataset=ds_id, workspace=ws_id),
            dataset_id=ds_id, dataset_name=ds_name, workspace_id=ws_id)
    except Exception as exc:  # noqa: BLE001
        log_error("columns", f"{ws_name}/{ds_name}", exc)
    try:
        add("relationships", fabric.list_relationships(dataset=ds_id, workspace=ws_id),
            dataset_id=ds_id, dataset_name=ds_name, workspace_id=ws_id)
    except Exception as exc:  # noqa: BLE001
        log_error("relationships", f"{ws_name}/{ds_name}", exc)

    # Within-model lineage (measure -> measure/column)
    try:
        add("dependencies",
            labs.get_model_calc_dependencies(dataset=ds_id, workspace=ws_id),
            dataset_id=ds_id, dataset_name=ds_name, workspace_id=ws_id)
    except Exception as exc:  # noqa: BLE001
        log_error("dependencies", f"{ws_name}/{ds_name}", exc)

    # RLS roles + members (Phase 2b)
    if capture_access:
        try:
            roles = fabric.get_roles(dataset=ds_id, workspace=ws_id, include_members=True)
            add("rls_roles", roles, dataset_id=ds_id, dataset_name=ds_name,
                workspace_id=ws_id)
        except Exception as exc:  # noqa: BLE001
            log_error("rls_roles", f"{ws_name}/{ds_name}", exc)


# %%
# ---- Per-workspace scan ----------------------------------------------------
def scan_workspace(ws_id, ws_name):
    print(f"\n== {ws_name} ({ws_id}) ==")
    fmap = folder_paths(ws_id)

    # Reports + KPI<->report edges. Iterate reports ONCE (O(reports)) and pull
    # each PBIR report's model-object references via ReportWrapper — far cheaper
    # than the per-model list_report_semantic_model_objects (O(models×reports)).
    try:
        rpt = fabric.list_reports(workspace=ws_id)
    except Exception as exc:  # noqa: BLE001
        log_error("reports", ws_name, exc)
        rpt = pd.DataFrame()

    if len(rpt):
        rid_col = "Id" if "Id" in rpt.columns else rpt.columns[0]
        rname_col = "Name" if "Name" in rpt.columns else rpt.columns[0]
        ds_id_col = "Dataset Id" if "Dataset Id" in rpt.columns else None
        ds_ws_col = "Dataset Workspace Id" if "Dataset Workspace Id" in rpt.columns else None
        rpt["folder_path"] = rpt[rid_col].map(lambda i: fmap.get(i, ""))
        add("reports", rpt, workspace_id=ws_id, workspace_name=ws_name)

        for _, rr in rpt.iterrows():
            rname = rr[rname_col]
            try:
                objs = ReportWrapper(report=rname, workspace=ws_name).list_semantic_model_objects()
                if objs is not None and len(objs):
                    objs = objs.copy()
                    objs["report_id"] = rr[rid_col]
                    objs["report_name"] = rname
                    objs["report_workspace_id"] = ws_id
                    objs["report_workspace_name"] = ws_name
                    objs["dataset_id"] = rr[ds_id_col] if ds_id_col else None
                    objs["dataset_workspace_id"] = rr[ds_ws_col] if ds_ws_col else None
                    acc["usage"].append(objs)
            except Exception as exc:  # noqa: BLE001
                log_error("usage", f"{ws_name}/{rname}", exc)

    # Datasets
    try:
        dss = fabric.list_datasets(workspace=ws_id)
    except Exception as exc:  # noqa: BLE001
        log_error("datasets", ws_name, exc)
        dss = pd.DataFrame()

    if len(dss):
        did_col = "Dataset Id" if "Dataset Id" in dss.columns else (
            "Id" if "Id" in dss.columns else dss.columns[0])
        dname_col = "Dataset Name" if "Dataset Name" in dss.columns else (
            "Name" if "Name" in dss.columns else dss.columns[1])
        dss["folder_path"] = dss[did_col].map(lambda i: fmap.get(i, ""))
        add("models", dss, workspace_id=ws_id, workspace_name=ws_name)
        for _, d in dss.iterrows():
            scan_dataset(ws_id, ws_name, d[did_col], d[dname_col], fmap)

    # Current workspace access (Phase 2b)
    if capture_access:
        try:
            ra = fclient.get(f"/v1/workspaces/{ws_id}/roleAssignments").json().get("value", [])
            rows = [{
                "workspace_id": ws_id,
                "workspace_name": ws_name,
                "principal_id": (r.get("principal") or {}).get("id"),
                "principal_type": (r.get("principal") or {}).get("type"),
                "principal_name": (r.get("principal") or {}).get("displayName"),
                "role": r.get("role"),
            } for r in ra]
            add("workspace_access", pd.DataFrame(rows))
        except Exception as exc:  # noqa: BLE001
            log_error("workspace_access", ws_name, exc)

        # Org apps + audiences (Fabric OrgApp / OrgAppAudience items)
        try:
            items = fclient.get(f"/v1/workspaces/{ws_id}/items").json().get("value", [])
            add("org_apps", pd.DataFrame([{
                "app_id": it.get("id"),
                "app_name": it.get("displayName"),
                "kind": "Fabric",
                "workspace_id": ws_id,
                "workspace_name": ws_name,
            } for it in items if it.get("type") == "OrgApp"]))
            add("app_audiences", pd.DataFrame([{
                "audience_id": it.get("id"),
                "audience_name": it.get("displayName"),
                "workspace_id": ws_id,
                "workspace_name": ws_name,
            } for it in items if it.get("type") == "OrgAppAudience"]))
        except Exception as exc:  # noqa: BLE001
            log_error("org_apps", ws_name, exc)


# %%
# ---- Tenant-level: classic Power BI org apps + their users/groups ----------
def scan_classic_apps():
    """Classic Power BI org apps + the users and Entra security groups that
    have access to each. Uses the admin API when available, else the
    caller-scoped apps list. (Fabric OrgApp audience membership is not exposed
    via the public API — those are captured as items/audiences only.)"""
    try:
        pbi = fabric.PowerBIRestClient()
    except Exception as exc:  # noqa: BLE001
        log_error("apps_client", "-", exc)
        return
    admin = True
    try:
        apps = pbi.get("/v1.0/myorg/admin/apps?$top=5000").json().get("value", [])
    except Exception:  # noqa: BLE001
        admin = False
        try:
            apps = pbi.get("/v1.0/myorg/apps").json().get("value", [])
        except Exception as exc:  # noqa: BLE001
            log_error("classic_apps", "-", exc)
            apps = []
    add("org_apps", pd.DataFrame([{
        "app_id": a.get("id"),
        "app_name": a.get("name"),
        "kind": "Classic",
        "workspace_id": a.get("workspaceId"),
        "published_by": a.get("publishedBy"),
        "last_update": a.get("lastUpdate"),
    } for a in apps]))
    if admin:
        for a in apps:
            try:
                users = pbi.get(f"/v1.0/myorg/admin/apps/{a['id']}/users").json().get("value", [])
                add("app_access", pd.DataFrame([{
                    "app_id": a.get("id"),
                    "app_name": a.get("name"),
                    "principal_type": u.get("principalType"),
                    "principal_name": u.get("displayName"),
                    "identifier": u.get("identifier"),
                    "graph_id": u.get("graphId"),
                    "access_right": u.get("appUserAccessRight"),
                    "user_type": u.get("userType"),
                } for u in users]))
            except Exception as exc:  # noqa: BLE001
                log_error("app_users", a.get("name"), exc)


# %%
# ---- Run the crawl ---------------------------------------------------------
wsdf = get_workspaces()
print(f"Scanning {len(wsdf)} workspace(s) — scope={scan_scope}, access={capture_access}")
add("workspaces", wsdf.rename(columns={"Id": "workspace_id", "Name": "workspace_name"}))

for _, w in wsdf.iterrows():
    try:
        scan_workspace(w["Id"], w["Name"])
    except Exception as exc:  # noqa: BLE001
        log_error("workspace", w["Name"], exc)
        traceback.print_exc()

if capture_access:
    scan_classic_apps()

# %%
# ---- Write cat_* tables ----------------------------------------------------
def flush(key: str, table: str):
    frames = acc.get(key) or []
    df = pd.concat(frames, ignore_index=True) if frames else None
    return save_delta(df, table)


print("\nWriting catalog tables:")
counts = {
    "cat_workspaces": flush("workspaces", "cat_workspaces"),
    "cat_reports": flush("reports", "cat_reports"),
    "cat_models": flush("models", "cat_models"),
    "cat_measures": flush("measures", "cat_measures"),
    "cat_columns": flush("columns", "cat_columns"),
    "cat_relationships": flush("relationships", "cat_relationships"),
    "cat_measure_dependencies": flush("dependencies", "cat_measure_dependencies"),
    "cat_report_object_usage": flush("usage", "cat_report_object_usage"),
}
if capture_access:
    counts["cat_workspace_access"] = flush("workspace_access", "cat_workspace_access")
    counts["cat_rls_roles"] = flush("rls_roles", "cat_rls_roles")
    counts["cat_app_audiences"] = flush("app_audiences", "cat_app_audiences")
    counts["cat_org_apps"] = flush("org_apps", "cat_org_apps")
    counts["cat_app_access"] = flush("app_access", "cat_app_access")

    # Derive the distinct Entra security groups currently entered anywhere
    # (org-app access + workspace roles). Group display names come straight
    # from the API responses — no Graph call needed.
    gframes = []

    def _collect_groups(frames, id_col, name_col, source):
        if not frames:
            return
        df = pd.concat(frames, ignore_index=True)
        if "principal_type" in df.columns:
            df = df[df["principal_type"] == "Group"]
        if len(df) and id_col in df.columns:
            g = df[[c for c in (id_col, name_col) if c in df.columns]].rename(
                columns={id_col: "group_id", name_col: "group_name"}
            )
            g = g.dropna(subset=["group_id"]).copy()
            if len(g):
                g["source"] = source
                gframes.append(g)

    _collect_groups(acc["app_access"], "graph_id", "principal_name", "OrgApp")
    _collect_groups(acc["workspace_access"], "principal_id", "principal_name", "Workspace")
    if gframes:
        allg = pd.concat(gframes, ignore_index=True).drop_duplicates(subset=["group_id", "source"])
        acc["entra_groups"].append(allg)
    counts["cat_entra_groups"] = flush("entra_groups", "cat_entra_groups")

# %%
# ---- Scan-run audit row (append history) -----------------------------------
run_row = pd.DataFrame([{
    "run_id": RUN_ID,
    "started_at": SCANNED_AT,
    "finished_at": datetime.datetime.utcnow().isoformat(),
    "scan_scope": scan_scope,
    "n_workspaces": len(wsdf),
    "n_reports": counts.get("cat_reports", 0),
    "n_models": counts.get("cat_models", 0),
    "n_measures": counts.get("cat_measures", 0),
    "n_usage_edges": counts.get("cat_report_object_usage", 0),
    "n_errors": len(errors),
    "error_json": str(errors)[:8000],
}])
# cat_scan_runs is append-only history; the cat_* snapshot tables are overwritten.
try:
    spark.createDataFrame(run_row).write.format("delta").mode("append").option(
        "mergeSchema", "true"
    ).saveAsTable("cat_scan_runs")
    print("  cat_scan_runs: +1 row (append)")
except Exception:
    save_delta(run_row, "cat_scan_runs", mode="overwrite")

print("\nDone.")
print("Counts:", counts)
print("Errors:", len(errors))
if errors:
    display(pd.DataFrame(errors))

# %%
# ---- Reframe the Direct Lake catalog model against the fresh scan ----------
# Direct Lake tables must be refreshed after the underlying Delta data changes,
# otherwise executeQueries returns "table not refreshed". Best-effort so a
# missing/renamed model never fails the scan job.
try:
    labs.refresh_semantic_model(dataset="Data Catalog Model")
    print("Refreshed 'Data Catalog Model'.")
except Exception as exc:  # noqa: BLE001
    print("Model refresh warning:", exc)
