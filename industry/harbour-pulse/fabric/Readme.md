# Fabric items

Every Fabric artefact HarbourPulse depends on lives here as a git-tracked
definition, so the whole solution can be rebuilt in another workspace or tenant.

| Folder | What it does |
| --- | --- |
| `EnvLakehouse.Lakehouse` | Holds `Files/.env` read by the loader notebook. |
| `SydneyFerriesEventhouse.Eventhouse` | Real-Time Intelligence cluster. |
| `SydneyFerriesKustoDB.KQLDatabase` | Tables, ingestion mapping and functions (`DatabaseSchema.kql`). |
| `SydneyFerriesEH.Eventstream` | Custom endpoint to Eventhouse direct ingestion. |
| `SydneyFerriesEventLoader.Notebook` | Polls the TfNSW GTFS-realtime feed and pushes to the Eventstream. |
| `*.KQLQueryset`, `*.KQLDashboard` | Saved queries and the RTI dashboard. |

## Deploy

```powershell
$env:FABRIC_WORKSPACE_ID = '<target workspace guid>'
python deploy.py
```

Authentication uses `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET`
when all three are set (CI), otherwise the current `az login` session.

`parameter.yml` rebinds every environment-specific id — workspace, Eventhouse,
KQL database, lakehouse and the Kusto cluster URI — against the *target*
workspace, so nothing in the definitions needs hand-editing for a new tenant.

For a green-field build (workspace, Entra app, Fabric items, Rayfin app,
redirect URIs) use `../scripts/provision-environment.ps1` instead.

## Re-export after portal edits

Changes made in the Fabric portal are not tracked automatically. After editing
anything in the browser, pull it back down:

```powershell
./export.ps1 -WorkspaceId <workspace guid>
```

The script warns if an exported definition contains something that looks like a
secret. Externalise it before committing — the loader notebook, for example,
reads its Event Hub connection string from the lakehouse `.env` rather than
embedding it.

## Not covered by automation

- **`EnvLakehouse/Files/.env`.** Upload `TRANSPORT_APIKEY` and
  `EVENTSTREAM_CONNECTION_STRING` (copied from the Eventstream custom endpoint)
  after the Eventstream exists.
- **Fabric SQL schema.** The app's only SQL dependency is the `VesselChecks`
  table, which `rayfin up` creates from `rayfin/data/VesselCheck.ts`. Nothing
  here writes to Fabric SQL — live positions are read straight from the
  Eventhouse.
- **`DataAgent`.** Present in the reference workspace but not part of the app;
  intentionally out of scope.
