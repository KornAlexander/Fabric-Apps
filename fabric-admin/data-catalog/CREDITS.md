# Credits & Acknowledgements

This project stands on the shoulders of the Microsoft Fabric community. In
particular, several designs and mechanisms are adopted from the open-source work
of **Andreas J. Rederer** ([@DaSenf1860](https://github.com/DaSenf1860)), a
member of the Fabric Customer Advisory Team. Thank you, Andreas. 🙏

All referenced repositories are MIT-licensed; this project reuses their **designs
and patterns** (re-implemented for a Rayfin/React + TypeScript stack) and, where
noted, their **Python packages** directly.

---

## `DaSenf1860/fabricplatformgovernance`
<https://github.com/DaSenf1860/fabricplatformgovernance> · MIT

The access-request & approval workflow (PLAN.md §7 / Phase 8) is modelled on this
Fabric governance portal. Elements adopted:

| Element from the governance portal | How it appears here | Status |
|---|---|---|
| **Request → Approve/Deny → Fulfil** loop with a persisted request store | `src/services/accessRequests.ts` + `RequestsPage`/`ApprovalsPage`; store = the Rayfin `AccessRequest` entity (their store is Azure SQL `Workspaces`) | **Implemented** |
| **Status lifecycle** on each request (`requested`→`created`/`denied`) | `Submitted → Approved → Fulfilled / Denied / Failed` | **Implemented** |
| **Service-principal role grant** — `FabricClientCore(...).add_workspace_role_assignment(principal, role)` | `scanner/catalog_grant.py` notebook — approving a request grants the workspace role under a dedicated grant SP, via `msfabricpysdkcore` (below) | **Implemented** (Approvals → auto-grant) |
| **Requester → object-id resolution** (`UserLookup` table) | requester `oid` captured on the `AccessRequest` (`user_id`) for the grant principal | **Implemented (adapted)** |
| **Role → privilege eligibility model** (Data Engineer / Scientist / Analyst / RTI → item types) | — | **Planned extension** (item-creation governance) |
| **Domain / Capacity / Region** metadata on requests + **workspace-creation** requests | — | **Planned extension** |

> The grant runs under a dedicated **service principal** ("Data Catalog Grant SP")
> using `msfabricpysdkcore.add_workspace_role_assignment` — the exact mechanism
> from the governance portal's `/approve` route. Setup: the SP's secret lives in
> Azure Key Vault (read at run time by `scanner/catalog_grant.py`); the tenant's
> "Service principals can use Fabric APIs" settings must be on; and the grant SP
> must be **Admin** on each workspace where auto-fulfilment should work. Admin
> grants are never automated. Verified end-to-end (grantee received `Viewer`).

## `DaSenf1860/ms-fabric-sdk-core` (PyPI `msfabricpysdkcore`)
<https://github.com/DaSenf1860/ms-fabric-sdk-core> · MIT

The comprehensive community Python SDK for the Fabric REST + Azure RM APIs — the
same SDK the governance portal uses. Adopted / planned:

- **Auto-grant (D6)** — **implemented**: `scanner/catalog_grant.py` uses a
  service-principal `FabricClientCore(tenant_id, client_id, client_secret)
  .add_workspace_role_assignment(...)` to fulfil approved requests automatically.
- **Scanner + deploy tooling** — *planned*: replace hand-rolled `az rest` /
  `urllib` calls (`list_workspaces`, `list_folders`, `update_item_definition`,
  `run_on_demand_item_job`, `create_item_schedule`, LRO waiting).
- **Richer access capture** — *planned*: Admin APIs (`list_workspace_access_details`,
  `list_access_entities`) and Tags for the `cat_*` catalog.

---

## Other community foundations
- **`microsoft/semantic-link-labs`** (sempy-labs) — the scanner's crawl of reports,
  models, measures, dependencies and report-object usage.
- **`microsoft/project-rayfin`** + **`awesome-rayfin`** — the Fabric-hosted app
  framework, auth provider, and the `pbi-fixer-app` sample this app's read-path
  plumbing (MSAL + `fabric_proxy` UDF) is based on.

If you build on this project, please keep this attribution intact.
