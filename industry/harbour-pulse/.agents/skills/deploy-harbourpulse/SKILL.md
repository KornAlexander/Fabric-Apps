---
name: deploy-harbourpulse
description: "Use when deploying, provisioning, or re-pointing the Harbour Pulse Sydney Ferries app into a Microsoft Fabric tenant or workspace. Triggers: deploy Harbour Pulse, provision-environment.ps1, new Fabric workspace, new tenant, deploy this repo to Fabric, set up the Eventhouse, SydneyFerriesEventLoader, EnvLakehouse, Files/.env, TFNSW_API_KEY, VITE_CESIUM_ION_TOKEN, Entra SPA app registration, Kusto user_impersonation, admin consent, hosting URL, redirect URIs, rayfin up, fabric/deploy.py, parameter.yml, ferries not showing, timetable empty, 403 from Eventhouse."
---

# Deploying Harbour Pulse

Stand up this repo in a Fabric tenant. Work from the repo root, in PowerShell.

## Rules

- **Never print or commit secret values.** `.env`, `rayfin/.env` and `*.local`
  are git-ignored; keep it that way. When checking a secret file exists, test
  for existence — do not read it back.
- **Ask before deleting anything**, and before anything that costs money.
- Report back after each step rather than running the whole sequence blind.
- `scripts/provision-environment.ps1` is idempotent. If it fails halfway,
  re-run it — do not hand-patch what it manages.

## What you need from the user

Ask for these up front; do not guess them:

| Value | How they find it |
|---|---|
| Tenant id | `az account show --query tenantId -o tsv` |
| Fabric capacity id | Fabric portal → Settings → Admin portal → Capacity settings → pick capacity → GUID is in the URL |
| Workspace name | A display name. An existing workspace id also works; a *name* that looks like a GUID does not. |

They also need two free API keys — see step 2.

## Step 1 — prerequisites

Check and report what is missing **before** changing anything: Node 20+,
Python 3.11+, Azure CLI, and an `az login --tenant <TENANT>` session belonging
to a user who can create Fabric workspaces.

Verify the session actually works:

```powershell
az ad signed-in-user show --query userPrincipalName -o tsv
```

A cached token can look valid and still be refused — continuous access
evaluation invalidates it after a policy change. If this fails, or you see
`TokenCreatedWithOutdatedPolicies`:

```powershell
az login --tenant <TENANT> --scope 'https://graph.microsoft.com//.default'
```

**The doubled slash is deliberate.** With one slash the CLI matches its cached
token and returns without prompting — useless when the cached token is the
problem. The CLI reports success either way, so re-check with
`az ad signed-in-user show`.

Then `npm ci` and `pip install -r fabric/requirements.txt`.

## Step 2 — secrets

Copy `.env.example` to `.env` and ask the user to paste:

- `TFNSW_API_KEY` — <https://opendata.transport.nsw.gov.au> → My Account →
  Applications. Server-side only. **Must be set before step 3**: that step
  builds the bundle, and the build bakes a 14-day timetable snapshot into it.
  Static hosting has no server to hold the key at runtime.
- `VITE_CESIUM_ION_TOKEN` — <https://ion.cesium.com> → Access Tokens. Optional;
  without it the globe falls back to keyless OpenStreetMap imagery.

Leave `VITE_KUSTO_CLUSTER`, `VITE_ENTRA_CLIENT_ID` and `VITE_ENTRA_TENANT_ID`
empty — step 3 generates them.

## Step 3 — provision

```powershell
./scripts/provision-environment.ps1 `
    -TenantId      <TENANT> `
    -WorkspaceName <WORKSPACE> `
    -CapacityId    <CAPACITY>
```

It resolves or creates the workspace, registers the Entra SPA app the browser
uses to get its Eventhouse token, publishes every Fabric item via
`fabric/deploy.py` (parameterised by `fabric/parameter.yml`, so no definition
needs hand-editing), writes the generated values back into `.env`, seeds
`Files/.env` in `EnvLakehouse`, runs `rayfin up`, then patches the app
registration's SPA redirect URIs with the hosting URL the deploy just minted.

Show the user the hosting URL it prints.

If an existing workspace is targeted, its capacity is left alone and
`-CapacityId` is ignored.

`-PruneOrphans` makes `fabric/deploy.py` delete every Lakehouse, Eventhouse,
KQL database, Eventstream and notebook in the workspace that this repo does not
define. It is off by default. Only pass it for a workspace dedicated to this
solution, and **ask first**.

## Step 4 — ingestion

The loader notebook reads credentials from OneLake, not from `.env`, and step 3
already wrote them: it reads the Eventstream connection string back over REST
and writes `Files/.env` in `EnvLakehouse` with `TRANSPORT_APIKEY` and
`EVENTSTREAM_CONNECTION_STRING`. Confirm that file exists rather than
recreating it, and never print its contents.

Then run `SydneyFerriesEventLoader` and confirm rows land in `SydneyFerries`:

```kusto
SydneyFerries | summarize rows = count(), vessels = dcount(ferry_name), latest = max(timestamp)
```

**The notebook stops itself after 10 minutes** (`RUN_MINUTES` in the last
cell), and while it runs its job status stays `NotStarted`, so it never reports
success on its own. Judge it by row count, not job status. A cold Spark session
takes several minutes before the first row. To stop it sooner, stop the cell
and then **Stop session** in the notebook's bottom-left corner — stopping the
cell alone leaves the session consuming capacity.

## Step 5 — access

The browser queries the Eventhouse directly with each user's own token, so
every user needs two grants. Tell the user exactly what to click.

**a) Admin consent on the SPA app.** Entra admin center → Entra ID → App
registrations → `HarbourPulse Kusto Client` → API permissions → **Grant admin
consent**. Requires **Cloud Application Administrator** or higher. Without it,
each first-time user hits an "approval required" screen.

The app requests nothing up front (`requiredResourceAccess` is empty) and
acquires Kusto `user_impersonation` dynamically, so the permission may only
appear after someone has signed in once.

**b) Viewer on the KQL database.** Fabric portal → workspace →
`SydneyFerriesKustoDB` → Manage permissions. Workspace membership also works.
Without it, sign-in succeeds and every query returns **403**.

## Step 6 — verify

Open the hosting URL and confirm: ferries render on the globe, the Timetable
panel is populated, and a vessel check saves and deletes. Report failures with
the exact error.

Warn the user before they try: on a first visit **Connect live data** opens a
sign-in pop-up that the browser will almost certainly block, and the button will
look dead. They should allow pop-ups for the site and press it again.

Expect **no wharf markers** — `ReferenceLocation` is created empty and this repo
ships no wharf rows.

## Troubleshooting

| Symptom | Cause |
|---|---|
| **Connect live data** appears to do nothing | Sign-in pop-up blocked. Allow pop-ups, press again. Normal on a first visit. |
| `TokenCreatedWithOutdatedPolicies`, or Graph 401 after a successful `az login` | Cached token. Re-login with the doubled-slash scope in step 1. |
| Static upload fails with a bare `500` while the backend deploys fine | Known transient. Re-run `npx rayfin up staticapp deploy`; the script already retries once. |
| Every KQL query returns 403 | Missing Viewer on the KQL database (step 5b). |
| "Approval required" on first sign-in | Missing admin consent (step 5a). |
| Globe renders but no ferries | Loader notebook is not running (it stops after 10 minutes), or `SydneyFerries` is empty. |
| Timetable panel empty | `TFNSW_API_KEY` was unset at build time, or the 14-day snapshot has aged out. Rebuild. |
| Deck occupancy shows zeros | Should not happen — `twinService.ts` falls back to simulation on an empty table. If it does, the fallback regressed. |

## Where secrets live

Three separate places, nothing shared between them. This is the most common
cause of a half-working deployment.

| Location | Holds | Used by |
|---|---|---|
| `.env` (git-ignored) | `TFNSW_API_KEY`, `VITE_CESIUM_ION_TOKEN`, generated `VITE_KUSTO_*` / `VITE_ENTRA_*` | Local dev, local `rayfin up`, `npm run build:fabric` |
| `Files/.env` in `EnvLakehouse` | `TRANSPORT_APIKEY`, `EVENTSTREAM_CONNECTION_STRING` | The loader notebook |
| GitHub repo secrets and variables | `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `TFNSW_API_KEY`, `VITE_CESIUM_ION_TOKEN`; vars `VITE_KUSTO_CLUSTER`, `VITE_KUSTO_DATABASE`, `VITE_ENTRA_CLIENT_ID`, `FABRIC_WORKSPACE_ID` | `.github/workflows/` |
