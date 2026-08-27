"""Gov Collect Entra — M-ENTRA server-side collector (PLAN.md §15, Phase 3E).

Percent-cell source. Build with `python bootstrap/build_ipynb.py`.

Writes: gov_actual_entra_groups, gov_actual_entra_group_members,
gov_actual_licenses, plus a gov_runs row.
"""

# %% [markdown]
# # Gov Collect Entra
#
# Entra is the compiler's target instruction set — security groups are the one
# currency all four planes accept — so the correctness that matters most here is
# **effective** membership. Nested groups mean the person who can create a Fabric
# data agent is often several hops from the group the entitlement was written
# against, and a collector that only records direct membership produces an
# entitlement report that is confidently wrong.

# %% tags=["parameters"]
dry_run = True
lakehouse_name = "governance_lh"
# Only expand membership for groups this app manages, by default. Expanding the
# whole directory is a very different cost profile in a large tenant.
app_managed_only = True
max_pages = 50

# %%
#@include collectors/shape_common.py

# %%
#@include collectors/runtime.py

# %%
#@include collectors/shape_entra.py

# %%
steps = []


def log(step, status, detail=""):
    steps.append({"step": step, "status": status, "detail": detail})
    print(f"[{status:>22}] {step}{(' — ' + detail) if detail else ''}")


ledger = RunLedger("Gov Collect Entra", "entra", "T1")
token = graph_token()
print(f"run_id={ledger.run_id} dry_run={dry_run} app_managed_only={app_managed_only}")

# %% [markdown]
# ## Groups

# %%
group_rows = []
try:
    fetch = lambda url: graph_get(token, url)  # noqa: E731
    url = "/v1.0/groups?$top=999&$select=id,displayName,mail,groupTypes,securityEnabled,description"
    pages = 0
    for payload in paged(fetch, url, max_pages=max_pages):
        group_rows.extend(shape_groups(payload))
        pages += 1
    if pages >= max_pages:
        ledger.error("groups", f"page cap {max_pages} reached — inventory is partial")
    ledger.count("gov_actual_entra_groups", len(group_rows))
    log("groups", "Created", f"{len(group_rows)} groups over {pages} pages")
except Exception as exc:  # noqa: BLE001
    ledger.tier = "T0"
    ledger.error("groups", exc)
    log("groups", "Skipped (no permission)", str(exc))

# %% [markdown]
# ## Membership
#
# Direct membership first, then transitive expansion offline. Graph does offer
# `/transitiveMembers`, but resolving locally keeps the *depth* and the
# direct-vs-inherited distinction, which is what makes a derivation path
# explainable in the Can-Do Explorer later.

# %%
targets = [
    g for g in group_rows if not app_managed_only or g.get("is_app_managed") == "true"
]
log("membership scope", "Planned", f"{len(targets)} of {len(group_rows)} groups")

direct: dict[str, list[dict]] = {}
for group in targets:
    group_id = group.get("group_id")
    if not group_id:
        continue
    try:
        payload = graph_get(
            token,
            f"/v1.0/groups/{group_id}/members?$top=999"
            "&$select=id,displayName,userPrincipalName",
        )
        direct[group_id] = shape_group_members(group_id, payload)
    except Exception as exc:  # noqa: BLE001
        ledger.error(f"members:{group.get('display_name') or group_id}", exc)

member_rows = resolve_transitive_members(direct)
ledger.count("gov_actual_entra_group_members", len(member_rows))
log(
    "membership",
    "Created",
    f"{len(member_rows)} effective rows from {len(direct)} groups",
)

# %% [markdown]
# ## Licences
#
# `assigned_via` is the governance-relevant column: only **group-based**
# licensing is something an entitlement can compile onto.

# %%
licence_rows = []
try:
    skus = index_sku_names(graph_get(token, "/v1.0/subscribedSkus"))
    fetch = lambda url: graph_get(token, url)  # noqa: E731
    url = (
        "/v1.0/users?$top=999"
        "&$select=id,userPrincipalName,displayName,assignedLicenses,licenseAssignmentStates"
    )
    pages = 0
    for payload in paged(fetch, url, max_pages=max_pages):
        licence_rows.extend(shape_licenses(payload, skus))
        pages += 1
    if pages >= max_pages:
        ledger.error("licenses", f"page cap {max_pages} reached — inventory is partial")
    ledger.count("gov_actual_licenses", len(licence_rows))
    log("licences", "Created", f"{len(licence_rows)} assignments")
except Exception as exc:  # noqa: BLE001
    ledger.error("licenses", exc)
    log("licences", "Skipped (no permission)", str(exc))

# %% [markdown]
# ## Write

# %%
TABLES = [
    ("gov_actual_entra_groups", group_rows),
    ("gov_actual_entra_group_members", member_rows),
    ("gov_actual_licenses", licence_rows),
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
